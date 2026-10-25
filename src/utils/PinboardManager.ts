import { SQLInputValue } from 'node:sqlite';
import { db, transaction } from './Database';
import { buildTimeline, rangeStart } from './Timeline';
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

// The time a Discord ID (snowflake) was created.
export function snowflakeTime(id: string | undefined): number | undefined {
  return id && /^\d{15,25}$/.test(id) ? Number((BigInt(id) >> 22n) + 1420070400000n) : undefined;
}

// Text of a pinboard post's header ("<emoji> **<count>** <#channel>") with nothing else around it.
export const POST_HEADER = /^\s*(\S{1,64}?)\s*\*\*(\d+)\*\*\s*<#(\d+)>\s*$/;

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
      pinned_at = excluded.pinned_at,
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
  reposts: db.prepare(`
    SELECT * FROM pinboard WHERE board_id = ? AND content LIKE '%**%<#%' AND COALESCE(updated_at, 0) > ? LIMIT ?
  `),
  moveEntry: db.prepare(`
    UPDATE pinboard SET original_message_id = ?, channel_id = ?, author_id = ?, author_name = ?, author_avatar_url = ?,
      content = ?, excerpt = ?, image_url = ?, message_created_at = ?, updated_at = ?
    WHERE board_id = ? AND original_message_id = ?
  `),
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
  moveReactions: db.prepare('UPDATE pinboard_reactions SET original_message_id = ? WHERE board_id = ? AND original_message_id = ?'),
  setAvatar: db.prepare('UPDATE pinboard SET author_avatar_url = ? WHERE author_id = ? AND author_avatar_url IS NOT ?'),
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

  public getDetail(boardId: string, originalMessageId: string): Omit<PinboardEntryDetail, 'mentions'> | undefined {
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
      // The pinboard post's ID says when it was posted, which is when the message was pinned.
      snowflakeTime(pinboardMessageId) ?? metadata.pinnedAt ?? Date.now(),
      metadata.content ?? null,
      metadata.authorId ?? null,
      metadata.emoji ?? null,
      metadata.emojiDisplay ?? null,
      snowflakeTime(originalMessageId) ?? metadata.messageCreatedAt ?? null,
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
  // Stored pins whose text looks like the header of a pinboard post, changed since `since`:
  // most likely a pinboard post that was pinned again (see PinboardBackfill.unwrapRepost).
  public repostCandidates(boardId: string, since: number, limit: number): PinboardEntry[] {
    return (statements.reposts.all(boardId, since, limit) as unknown as PinboardRow[])
      .map(toEntry)
      .filter(entry => POST_HEADER.test(entry.content ?? ''));
  }

  // Points an entry at another original message, replacing everything about the message
  // but keeping its pinboard post and reactions.
  public moveEntry(boardId: string, fromMessageId: string, toMessageId: string, message: PinboardMetadata) {
    transaction(db, () => {
      statements.moveEntry.run(
        toMessageId,
        message.channelId ?? null,
        message.authorId ?? null,
        message.authorName ?? null,
        message.authorAvatarUrl ?? null,
        message.content ?? null,
        message.excerpt ?? null,
        message.imageUrl ?? null,
        snowflakeTime(toMessageId) ?? null,
        Date.now(),
        boardId,
        fromMessageId
      );
      statements.moveReactions.run(toMessageId, boardId, fromMessageId);
    });
  }

  // When reposted pins of a board were last looked for (see repostCandidates).
  public repostsCheckedAt(boardId: string): number {
    const row = statements.getMeta.get(`pinboard_reposts_checked:${boardId}`) as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  public setRepostsCheckedAt(boardId: string, time: number) {
    statements.setMeta.run(`pinboard_reposts_checked:${boardId}`, String(time));
  }

  // Keeps stored avatars current when a user changed theirs.
  public updateAvatar(authorId: string, url: string) {
    statements.setAvatar.run(url, authorId, url);
  }

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

  // `listLimit` raises the length of the ranked lists (authors, channels, emojis, top pins) for statistics posts.
  public stats(boardId: string, range: PinboardRange, listLimit = 10): Omit<PinboardStats, 'channels' | 'backfill' | 'mentions'> & { channels: { channelId: string; pins: number; reactions: number }[] } {
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
      GROUP BY r.emoji ORDER BY reactions DESC LIMIT ${Math.max(20, listLimit)}
    `).all(...params) as PinboardStats['emojis'];

    const authors = db.prepare(`
      SELECT ${AUTHOR_KEY} AS key, MAX(p.author_name) AS name, MAX(p.author_avatar_url) AS avatarUrl,
        COUNT(*) AS pins, COALESCE(SUM(p.count), 0) AS reactions
      FROM pinboard p
      WHERE p.board_id = ? ${inRange} AND p.author_name IS NOT NULL AND p.author_name != 'Unknown author'
      GROUP BY key ORDER BY pins DESC, reactions DESC LIMIT ${listLimit}
    `).all(...params) as PinboardStats['authors'];

    const channels = db.prepare(`
      SELECT p.channel_id AS channelId, COUNT(*) AS pins, COALESCE(SUM(p.count), 0) AS reactions
      FROM pinboard p WHERE p.board_id = ? ${inRange} AND p.channel_id IS NOT NULL
      GROUP BY p.channel_id ORDER BY pins DESC LIMIT ${listLimit}
    `).all(...params) as { channelId: string; pins: number; reactions: number }[];

    const top = (db.prepare(`
      SELECT p.* FROM pinboard p WHERE p.board_id = ? ${inRange} AND p.count IS NOT NULL
      ORDER BY p.count DESC, p.pinned_at DESC LIMIT ${listLimit}
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
      timeline: buildTimeline(points, range).map(({ label, start, n, sum }) => ({ label, start, pins: n, reactions: sum })),
      emojis,
      authors,
      channels,
      top
    };
  }
}
