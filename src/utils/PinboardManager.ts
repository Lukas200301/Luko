import { db } from './Database';
import { PinboardEntry } from '../shared/types';

export type PinboardMetadata = Omit<PinboardEntry, 'boardId' | 'originalMessageId' | 'pinboardMessageId'>;

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
    pinnedAt: row.pinned_at ?? undefined
  };
}

const statements = {
  get: db.prepare('SELECT * FROM pinboard WHERE board_id = ? AND original_message_id = ?'),
  all: db.prepare('SELECT * FROM pinboard ORDER BY pinned_at DESC'),
  byBoard: db.prepare('SELECT * FROM pinboard WHERE board_id = ? ORDER BY pinned_at DESC'),
  page: db.prepare('SELECT * FROM pinboard ORDER BY pinned_at DESC, rowid DESC LIMIT ? OFFSET ?'),
  boardPage: db.prepare('SELECT * FROM pinboard WHERE board_id = ? ORDER BY pinned_at DESC, rowid DESC LIMIT ? OFFSET ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM pinboard'),
  countsByBoard: db.prepare('SELECT board_id, COUNT(*) AS n FROM pinboard GROUP BY board_id'),
  upsert: db.prepare(`
    INSERT INTO pinboard (board_id, original_message_id, pinboard_message_id, channel_id, author_name, author_avatar_url, excerpt, image_url, count, pinned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (board_id, original_message_id) DO UPDATE SET
      pinboard_message_id = excluded.pinboard_message_id,
      channel_id = COALESCE(excluded.channel_id, pinboard.channel_id),
      author_name = COALESCE(excluded.author_name, pinboard.author_name),
      author_avatar_url = COALESCE(excluded.author_avatar_url, pinboard.author_avatar_url),
      excerpt = COALESCE(excluded.excerpt, pinboard.excerpt),
      image_url = COALESCE(excluded.image_url, pinboard.image_url),
      count = COALESCE(excluded.count, pinboard.count),
      pinned_at = COALESCE(pinboard.pinned_at, excluded.pinned_at)
  `),
  delete: db.prepare('DELETE FROM pinboard WHERE board_id = ? AND original_message_id = ?'),
  deleteBoard: db.prepare('DELETE FROM pinboard WHERE board_id = ?')
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
      metadata.pinnedAt ?? Date.now()
    );
  }

  public removePinboardMessage(boardId: string, originalMessageId: string) {
    statements.delete.run(boardId, originalMessageId);
  }

  public removeBoard(boardId: string) {
    statements.deleteBoard.run(boardId);
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
}
