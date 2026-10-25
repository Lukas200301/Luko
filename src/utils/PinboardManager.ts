import { SQLInputValue } from 'node:sqlite';
import { db, transaction } from './Database';
import {
  PinboardEntry,
  PinboardEntryDetail,
  PinboardRange,
  PinboardReaction,
  PinboardSort,
  PinboardStats
} from '../shared/types';

export type PinboardMetadata = Omit<PinboardEntry, 'boardId' | 'originalMessageId' | 'pinboardMessageId' | 'channelName'>;

interface PinboardRow {
  board_id: string;
  original_message_id: string;
  pinboard_message_id: string;
  channel_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  excerpt: string | null;
  image_url: string | null;
  count: number | null;
  pinned_at: number | null;
  content: string | null;
  author_id: string | null;
  emoji: string | null;
  emoji_display: string | null;
  message_created_at: number | null;
}

function toEntry(row: PinboardRow): PinboardEntry {
  return {
    boardId: row.board_id,
    originalMessageId: row.original_message_id,
    pinboardMessageId: row.pinboard_message_id,
    channelId: row.channel_id ?? undefined,
    authorName: row.author_name ?? undefined,
    authorAvatarUrl: row.author_avatar_url ?? undefined,
    excerpt: row.excerpt ?? undefined,
    imageUrl: row.image_url ?? undefined,
    count: row.count ?? undefined,
    pinnedAt: row.pinned_at || undefined,
    content: row.content ?? undefined,
    authorId: row.author_id ?? undefined,
    emoji: row.emoji ?? undefined,
    emojiDisplay: row.emoji_display ?? undefined,
    messageCreatedAt: row.message_created_at ?? undefined
  };
}

const DAY = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<PinboardRange, number | null> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };

export function rangeStart(range: PinboardRange): number | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : Date.now() - days * DAY;
}

export interface EntryQuery {
  boardId: string;
  range: PinboardRange;
  sort: PinboardSort;
  emoji?: string;
  author?: string;
  channelId?: string;
  search?: string;
  limit: number;
  offset: number;
}

// "Authors" are keyed by Discord ID when known; older pins only have a name ("name:<name>").
const AUTHOR_KEY = "COALESCE(p.author_id, 'name:' || p.author_name)";

const statements = {
  get: db.prepare('SELECT * FROM pinboard WHERE board_id = ? AND original_message_id = ?'),
  all: db.prepare('SELECT * FROM pinboard ORDER BY pinned_at DESC'),
  byBoard: db.prepare('SELECT * FROM pinboard WHERE board_id = ? ORDER BY pinned_at DESC'),
  page: db.prepare('SELECT * FROM pinboard ORDER BY pinned_at DESC, rowid DESC LIMIT ? OFFSET ?'),
  boardPage: db.prepare('SELECT * FROM pinboard WHERE board_id = ? ORDER BY pinned_at DESC, rowid DESC LIMIT ? OFFSET ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM pinboard'),
  countsByBoard: db.prepare('SELECT board_id, COUNT(*) AS n FROM pinboard GROUP BY board_id'),
  upsert: db.prepare(`
    INSERT INTO pinboard (board_id, original_message_id, pinboard_message_id, channel_id, author_name, author_avatar_url,
      excerpt, image_url, count, pinned_at, content, author_id, emoji, emoji_display, message_created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (board_id, original_message_id) DO UPDATE SET
      pinboard_message_id = excluded.pinboard_message_id,
      channel_id = COALESCE(excluded.channel_id, pinboard.channel_id),
      author_name = COALESCE(excluded.author_name, pinboard.author_name),
      author_avatar_url = COALESCE(excluded.author_avatar_url, pinboard.author_avatar_url),
      excerpt = COALESCE(excluded.excerpt, pinboard.excerpt),
      image_url = COALESCE(excluded.image_url, pinboard.image_url),
      count = COALESCE(excluded.count, pinboard.count),
      pinned_at = COALESCE(pinboard.pinned_at, excluded.pinned_at),
      content = COALESCE(excluded.content, pinboard.content),
      author_id = COALESCE(excluded.author_id, pinboard.author_id),
      emoji = COALESCE(excluded.emoji, pinboard.emoji),
      emoji_display = COALESCE(excluded.emoji_display, pinboard.emoji_display),
      message_created_at = COALESCE(excluded.message_created_at, pinboard.message_created_at),
      updated_at = excluded.updated_at
  `),
  delete: db.prepare('DELETE FROM pinboard WHERE board_id = ? AND original_message_id = ?'),
  deleteBoard: db.prepare('DELETE FROM pinboard WHERE board_id = ?'),
  reactions: db.prepare('SELECT emoji, display, count FROM pinboard_reactions WHERE board_id = ? AND original_message_id = ? ORDER BY count DESC'),
  insertReaction: db.prepare('INSERT OR REPLACE INTO pinboard_reactions (board_id, original_message_id, emoji, display, count) VALUES (?, ?, ?, ?, ?)'),
  deleteReactions: db.prepare('DELETE FROM pinboard_reactions WHERE board_id = ? AND original_message_id = ?'),
  deleteBoardReactions: db.prepare('DELETE FROM pinboard_reactions WHERE board_id = ?'),
  missingContent: db.prepare('SELECT * FROM pinboard WHERE board_id = ? AND content IS NULL ORDER BY pinned_at DESC LIMIT ?'),
  countMissing: db.prepare('SELECT COUNT(*) AS n FROM pinboard WHERE board_id = ? AND content IS NULL')
};

export class PinboardManager {
  public getPinboardMessageId(boardId: string, originalMessageId: string): string | undefined {
    const row = statements.get.get(boardId, originalMessageId) as PinboardRow | undefined;
    return row?.pinboard_message_id;
  }

  public getEntry(boardId: string, originalMessageId: string): PinboardEntry | undefined {
    const row = statements.get.get(boardId, originalMessageId) as PinboardRow | undefined;
    return row ? toEntry(row) : undefined;
  }

  public getDetail(boardId: string, originalMessageId: string): PinboardEntryDetail | undefined {
    const entry = this.getEntry(boardId, originalMessageId);
    if (!entry) return undefined;
    const reactions = statements.reactions.all(boardId, originalMessageId) as unknown as PinboardReaction[];
    return { ...entry, reactions };
  }

  public setPinboardMessageId(boardId: string, originalMessageId: string, pinboardMessageId: string, metadata: PinboardMetadata = {}) {
    statements.upsert.run(
      boardId,
      originalMessageId,
      pinboardMessageId,
      metadata.channelId ?? null,
      metadata.authorName ?? null,
      metadata.authorAvatarUrl ?? null,
      metadata.excerpt ?? null,
      metadata.imageUrl ?? null,
      metadata.count ?? null,
      metadata.pinnedAt ?? Date.now(),
      metadata.content ?? null,
      metadata.authorId ?? null,
      metadata.emoji ?? null,
      metadata.emojiDisplay ?? null,
      metadata.messageCreatedAt ?? null,
      Date.now()
    );
  }

  // Replaces the stored reaction counts of a pinned message.
  public setReactions(boardId: string, originalMessageId: string, reactions: PinboardReaction[]) {
    transaction(db, () => {
      statements.deleteReactions.run(boardId, originalMessageId);
      for (const r of reactions) {
        statements.insertReaction.run(boardId, originalMessageId, r.emoji, r.display, r.count);
      }
    });
  }

  public removePinboardMessage(boardId: string, originalMessageId: string) {
    statements.delete.run(boardId, originalMessageId);
    statements.deleteReactions.run(boardId, originalMessageId);
  }

  public removeBoard(boardId: string) {
    statements.deleteBoard.run(boardId);
    statements.deleteBoardReactions.run(boardId);
  }

  public getEntries(boardId?: string): PinboardEntry[] {
    const rows = boardId ? statements.byBoard.all(boardId) : statements.all.all();
    return (rows as unknown as PinboardRow[]).map(toEntry);
  }

  // Newest first. Without a board, entries of all boards are mixed.
  public getPage(boardId: string | null, limit: number, offset: number): PinboardEntry[] {
    const rows = boardId ? statements.boardPage.all(boardId, limit, offset) : statements.page.all(limit, offset);
    return (rows as unknown as PinboardRow[]).map(toEntry);
  }

  public countsByBoard(): Map<string, number> {
    const rows = statements.countsByBoard.all() as Array<{ board_id: string; n: number }>;
    return new Map(rows.map(row => [row.board_id, row.n]));
  }

  public size(): number {
    return (statements.count.get() as { n: number }).n;
  }

  // Entries whose full message hasn't been stored yet (pinned by older versions).
  public missingContent(boardId: string, limit: number): PinboardEntry[] {
    return (statements.missingContent.all(boardId, limit) as unknown as PinboardRow[]).map(toEntry);
  }

  public countMissing(boardId: string): number {
    return (statements.countMissing.get(boardId) as { n: number }).n;
  }

  // ---------- Filtered lists ----------

  private filterSql(query: Omit<EntryQuery, 'sort' | 'limit' | 'offset'>): { join: string; where: string; params: SQLInputValue[] } {
    const where = ['p.board_id = ?'];
    const params: SQLInputValue[] = [query.boardId];
    let join = '';

    const since = rangeStart(query.range);
    if (since !== null) {
      where.push('p.pinned_at >= ?');
      params.push(since);
    }
    if (query.emoji) {
      join = 'JOIN pinboard_reactions r ON r.board_id = p.board_id AND r.original_message_id = p.original_message_id AND r.emoji = ?';
      params.unshift(query.emoji);
    }
    if (query.author) {
      where.push(`${AUTHOR_KEY} = ?`);
      params.push(query.author);
    }
    if (query.channelId) {
      where.push('p.channel_id = ?');
      params.push(query.channelId);
    }
    if (query.search) {
      where.push("(COALESCE(p.content, p.excerpt, '') LIKE ? ESCAPE '\\' OR COALESCE(p.author_name, '') LIKE ? ESCAPE '\\')");
      const like = `%${query.search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
      params.push(like, like);
    }

    return { join, where: where.join(' AND '), params };
  }

  public query(query: EntryQuery): { entries: PinboardEntry[]; total: number } {
    const { join, where, params } = this.filterSql(query);
    const order = {
      newest: 'p.pinned_at DESC, p.rowid DESC',
      oldest: 'p.pinned_at IS NULL, p.pinned_at ASC, p.rowid ASC',
      // With an emoji filter, "most reactions" means most of that emoji.
      reactions: query.emoji ? 'r.count DESC, p.pinned_at DESC' : 'p.count DESC, p.pinned_at DESC',
      message: 'p.message_created_at DESC'
    }[query.sort];

    const rows = db.prepare(`SELECT p.* FROM pinboard p ${join} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as unknown as PinboardRow[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM pinboard p ${join} WHERE ${where}`).get(...params) as { n: number }).n;

    return { entries: rows.map(toEntry), total };
  }

  // ---------- Statistics ----------

  public stats(boardId: string, range: PinboardRange): Omit<PinboardStats, 'channels' | 'backfill'> & { channels: { channelId: string; pins: number; reactions: number }[] } {
    const since = rangeStart(range);
    const inRange = since === null ? '' : 'AND p.pinned_at >= ?';
    const params: SQLInputValue[] = since === null ? [boardId] : [boardId, since];

    const totals = db.prepare(`
      SELECT COUNT(*) AS pins, COALESCE(SUM(p.count), 0) AS reactions, COALESCE(AVG(p.count), 0) AS average, COALESCE(MAX(p.count), 0) AS max
      FROM pinboard p WHERE p.board_id = ? ${inRange}
    `).get(...params) as { pins: number; reactions: number; average: number; max: number };

    const recentCount = db.prepare('SELECT COUNT(*) AS n FROM pinboard WHERE board_id = ? AND pinned_at >= ?');

    const emojis = db.prepare(`
      SELECT r.emoji AS emoji, MAX(r.display) AS display, COUNT(*) AS pins, SUM(r.count) AS reactions
      FROM pinboard_reactions r JOIN pinboard p ON p.board_id = r.board_id AND p.original_message_id = r.original_message_id
      WHERE p.board_id = ? ${inRange}
      GROUP BY r.emoji ORDER BY reactions DESC LIMIT 20
    `).all(...params) as PinboardStats['emojis'];

    const authors = db.prepare(`
      SELECT ${AUTHOR_KEY} AS key, MAX(p.author_name) AS name, MAX(p.author_avatar_url) AS avatarUrl,
        COUNT(*) AS pins, COALESCE(SUM(p.count), 0) AS reactions
      FROM pinboard p
      WHERE p.board_id = ? ${inRange} AND p.author_name IS NOT NULL AND p.author_name != 'Unknown author'
      GROUP BY key ORDER BY pins DESC, reactions DESC LIMIT 10
    `).all(...params) as PinboardStats['authors'];

    const channels = db.prepare(`
      SELECT p.channel_id AS channelId, COUNT(*) AS pins, COALESCE(SUM(p.count), 0) AS reactions
      FROM pinboard p WHERE p.board_id = ? ${inRange} AND p.channel_id IS NOT NULL
      GROUP BY p.channel_id ORDER BY pins DESC LIMIT 10
    `).all(...params) as { channelId: string; pins: number; reactions: number }[];

    const top = (db.prepare(`
      SELECT p.* FROM pinboard p WHERE p.board_id = ? ${inRange} AND p.count IS NOT NULL
      ORDER BY p.count DESC, p.pinned_at DESC LIMIT 5
    `).all(...params) as unknown as PinboardRow[]).map(toEntry);

    const points = db.prepare(`
      SELECT p.pinned_at AS t, COALESCE(p.count, 0) AS c FROM pinboard p
      WHERE p.board_id = ? ${inRange} AND p.pinned_at > 0 ORDER BY p.pinned_at
    `).all(...params) as { t: number; c: number }[];

    return {
      range,
      pins: totals.pins,
      reactions: totals.reactions,
      averageReactions: Math.round(totals.average * 10) / 10,
      maxReactions: totals.max,
      pinsLast7Days: (recentCount.get(boardId, Date.now() - 7 * DAY) as { n: number }).n,
      pinsLast30Days: (recentCount.get(boardId, Date.now() - 30 * DAY) as { n: number }).n,
      timeline: buildTimeline(points, range),
      emojis,
      authors,
      channels,
      top
    };
  }
}

// Groups pins into days (7/30 days), weeks (90 days) or months (year / all time), filling gaps with zero.
function buildTimeline(points: { t: number; c: number }[], range: PinboardRange): PinboardStats['timeline'] {
  const unit = range === '7d' || range === '30d' ? 'day' : range === '90d' ? 'week' : 'month';

  const startOf = (time: number): Date => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (unit === 'month') d.setDate(1);
    return d;
  };
  const next = (d: Date): Date => {
    const n = new Date(d);
    if (unit === 'day') n.setDate(n.getDate() + 1);
    else if (unit === 'week') n.setDate(n.getDate() + 7);
    else n.setMonth(n.getMonth() + 1);
    return n;
  };
  const label = (d: Date): string => unit === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const since = rangeStart(range);
  const first = since ?? points[0]?.t;
  if (first === undefined) return [];

  const buckets = new Map<number, { pins: number; reactions: number }>();
  for (const point of points) {
    const key = startOf(point.t).getTime();
    const bucket = buckets.get(key) ?? { pins: 0, reactions: 0 };
    bucket.pins++;
    bucket.reactions += point.c;
    buckets.set(key, bucket);
  }

  const timeline: PinboardStats['timeline'] = [];
  for (let d = startOf(first); d.getTime() <= Date.now() && timeline.length < 400; d = next(d)) {
    const bucket = buckets.get(d.getTime()) ?? { pins: 0, reactions: 0 };
    timeline.push({ label: label(d), start: d.getTime(), ...bucket });
  }
  return timeline;
}
