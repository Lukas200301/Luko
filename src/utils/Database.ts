import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.join(process.cwd(), 'data');
export const DATABASE_PATH = path.join(DATA_DIR, 'luko.db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    section TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    content TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reminders_due_at ON reminders (due_at);

  CREATE TABLE IF NOT EXISTS pinboard (
    board_id TEXT NOT NULL,
    original_message_id TEXT NOT NULL,
    pinboard_message_id TEXT NOT NULL,
    channel_id TEXT,
    author_name TEXT,
    author_avatar_url TEXT,
    excerpt TEXT,
    image_url TEXT,
    count INTEGER,
    pinned_at INTEGER,
    PRIMARY KEY (board_id, original_message_id)
  );

  CREATE TABLE IF NOT EXISTS command_stats (
    command TEXT PRIMARY KEY,
    uses INTEGER NOT NULL,
    last_used INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS command_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    command TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT NOT NULL,
    guild_id TEXT,
    guild_name TEXT,
    success INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS command_usage_t ON command_usage (t);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS panel_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL,
    method TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`;

function readJson<T>(file: string): T | null {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    console.error(`❌ Could not read ${file} for the database import:`, error);
    return null;
  }
}

// After a successful import the old file is kept as a backup, renamed to *.json.migrated.
function retireJson(file: string): void {
  const filePath = path.join(DATA_DIR, file);
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, `${filePath}.migrated`);
  }
}

// Pinboard entries created before multiple pinboards existed belong to the first board, "main".
export const LEGACY_BOARD_ID = 'main';

export function transaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// One-time import of the JSON files older versions of Luko wrote to data/.
function importLegacyJson(db: DatabaseSync): void {
  const imported: string[] = [];

  transaction(db, () => {
    const reminders = readJson<Array<{ id: string; userId: string; channelId: string; content: string; dueAt: number; createdAt: number }>>('reminders.json');
    if (reminders) {
      const insert = db.prepare('INSERT OR IGNORE INTO reminders (id, user_id, channel_id, content, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of reminders) insert.run(r.id, r.userId, r.channelId, r.content, r.dueAt, r.createdAt);
      imported.push(`${reminders.length} reminders`);
    }

    const pinboard = readJson<Record<string, string | Record<string, string | number | undefined>>>('pinboard.json');
    if (pinboard) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO pinboard (board_id, original_message_id, pinboard_message_id, channel_id, author_name, author_avatar_url, excerpt, image_url, count, pinned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [originalId, value] of Object.entries(pinboard)) {
        const entry = typeof value === 'string' ? { pinboardMessageId: value } : value;
        insert.run(
          LEGACY_BOARD_ID,
          originalId,
          String(entry.pinboardMessageId),
          (entry.channelId as string) ?? null,
          (entry.authorName as string) ?? null,
          (entry.authorAvatarUrl as string) ?? null,
          (entry.excerpt as string) ?? null,
          (entry.imageUrl as string) ?? null,
          (entry.count as number) ?? null,
          (entry.pinnedAt as number) ?? null
        );
      }
      imported.push(`${Object.keys(pinboard).length} pinboard entries`);
    }

    const stats = readJson<{
      counters?: Record<string, { uses: number; lastUsed: number }>;
      history?: Array<{ t: number; command: string; userId: string; userTag: string; guildId: string | null; guildName: string | null; success: boolean }>;
    }>('command-stats.json');
    if (stats) {
      const insertStat = db.prepare('INSERT OR REPLACE INTO command_stats (command, uses, last_used) VALUES (?, ?, ?)');
      for (const [command, counter] of Object.entries(stats.counters ?? {})) insertStat.run(command, counter.uses, counter.lastUsed);
      const insertUsage = db.prepare('INSERT INTO command_usage (t, command, user_id, user_tag, guild_id, guild_name, success) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const e of stats.history ?? []) insertUsage.run(e.t, e.command, e.userId, e.userTag, e.guildId, e.guildName, e.success ? 1 : 0);
      imported.push('command stats');
    }

    const audit = readJson<Array<{ t: number; userId: string; username: string; action: string; details?: string }>>('audit-log.json');
    if (audit) {
      const insert = db.prepare('INSERT INTO audit_log (t, user_id, username, action, details) VALUES (?, ?, ?, ?, ?)');
      for (const e of audit) insert.run(e.t, e.userId, e.username, e.action, e.details ?? null);
      imported.push(`${audit.length} audit entries`);
    }

    const sessions = readJson<Record<string, { id: string; username: string; avatarUrl: string | null; role: string; method: string; createdAt: number; expiresAt: number }>>('panel-sessions.json');
    if (sessions) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO panel_sessions (token_hash, user_id, username, avatar_url, role, method, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [hash, s] of Object.entries(sessions)) insert.run(hash, s.id, s.username, s.avatarUrl, s.role, s.method, s.createdAt, s.expiresAt);
      imported.push('panel sessions');
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('json_imported', ?)").run(String(Date.now()));
  });

  for (const file of ['reminders.json', 'pinboard.json', 'command-stats.json', 'audit-log.json', 'panel-sessions.json']) {
    retireJson(file);
  }

  if (imported.length > 0) {
    console.log(`🗄️ Imported old JSON data into data/luko.db: ${imported.join(', ')}. The old files were renamed to *.json.migrated.`);
  }
}

// Databases created by the first SQLite version keyed pinboard entries by message only.
function migratePinboardTable(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(pinboard)').all() as Array<{ name: string }>;
  if (columns.some(c => c.name === 'board_id')) return;

  transaction(db, () => {
    db.exec(`
      ALTER TABLE pinboard RENAME TO pinboard_old;
      CREATE TABLE pinboard (
        board_id TEXT NOT NULL,
        original_message_id TEXT NOT NULL,
        pinboard_message_id TEXT NOT NULL,
        channel_id TEXT,
        author_name TEXT,
        author_avatar_url TEXT,
        excerpt TEXT,
        image_url TEXT,
        count INTEGER,
        pinned_at INTEGER,
        PRIMARY KEY (board_id, original_message_id)
      );
      INSERT INTO pinboard
        SELECT '${LEGACY_BOARD_ID}', original_message_id, pinboard_message_id, channel_id, author_name, author_avatar_url, excerpt, image_url, count, pinned_at
        FROM pinboard_old;
      DROP TABLE pinboard_old;
    `);
  });
}

function openDatabase(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new DatabaseSync(DATABASE_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  // Convert an older pinboard table first; CREATE TABLE IF NOT EXISTS would otherwise keep the old shape.
  const hasPinboard = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinboard'").get();
  if (hasPinboard) migratePinboardTable(db);
  db.exec(SCHEMA);

  const alreadyImported = db.prepare("SELECT value FROM meta WHERE key = 'json_imported'").get();
  if (!alreadyImported) {
    importLegacyJson(db);
  }

  return db;
}

// Shared SQLite database (data/luko.db) for settings, reminders, pinboard, stats, audit log and panel sessions.
export const db = openDatabase();
