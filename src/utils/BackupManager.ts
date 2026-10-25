import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'discord.js';
import { BACKUP_DIR, DATABASE_PATH, RESTORE_MARKER, db } from './Database';
import { BackupInfo, BackupKind } from '../shared/types';

// Copies of data/luko.db in data/backups: made by hand in the panel, automatically once a day,
// and before restoring or updating. SQLite's VACUUM INTO writes a consistent copy while the bot runs.

const FILE_NAME = /^luko-(auto|manual|before-restore|before-update)-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.db$/;
const CHECK_INTERVAL = 10 * 60 * 1000;

const statements = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
  vacuumInto: db.prepare('VACUUM INTO ?')
};

function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export class BackupManager {
  private timer: NodeJS.Timeout | null = null;
  private retryAfter = 0;

  constructor(private client: Client) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runScheduled(), CHECK_INTERVAL);
    setTimeout(() => this.runScheduled(), 30_000);
  }

  list(): BackupInfo[] {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .flatMap((name): BackupInfo[] => {
        const match = FILE_NAME.exec(name);
        if (!match) return [];
        const stats = fs.statSync(path.join(BACKUP_DIR, name));
        return [{ name, kind: match[1] as BackupKind, size: stats.size, createdAt: stats.mtimeMs }];
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  databaseSize(): number {
    return ['', '-wal'].reduce((sum, suffix) => sum + (fs.existsSync(DATABASE_PATH + suffix) ? fs.statSync(DATABASE_PATH + suffix).size : 0), 0);
  }

  lastAutoBackup(): number | null {
    const row = statements.getMeta.get('backup_last_auto') as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  // Full path of a backup, or null for names that aren't backups (keeps requests inside the folder).
  pathOf(name: string): string | null {
    if (!FILE_NAME.test(name)) return null;
    const file = path.join(BACKUP_DIR, name);
    return fs.existsSync(file) ? file : null;
  }

  create(kind: BackupKind): BackupInfo {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const name = `luko-${kind}-${stamp()}.db`;
    const file = path.join(BACKUP_DIR, name);
    statements.vacuumInto.run(file);
    if (kind === 'auto') statements.setMeta.run('backup_last_auto', String(Date.now()));
    return { name, kind, size: fs.statSync(file).size, createdAt: Date.now() };
  }

  delete(name: string): boolean {
    const file = this.pathOf(name);
    if (!file) return false;
    fs.rmSync(file);
    return true;
  }

  // Keeps the newest `keep` automatic backups (manual ones are only deleted by hand).
  prune(keep: number): void {
    for (const backup of this.list().filter(b => b.kind === 'auto').slice(keep)) {
      this.delete(backup.name);
    }
  }

  // Saves the current database, then marks `name` to replace it on the next start.
  // The caller restarts the bot.
  prepareRestore(name: string): BackupInfo {
    if (!this.pathOf(name)) throw new Error('Backup not found.');
    const safety = this.create('before-restore');
    fs.writeFileSync(RESTORE_MARKER, JSON.stringify({ name, requestedAt: Date.now() }));
    return safety;
  }

  private runScheduled(): void {
    const settings = this.client.settings.get().backups;
    if (!settings.enabled || Date.now() < this.retryAfter) return;

    const now = new Date();
    const last = this.lastAutoBackup();
    if (now.getHours() < settings.hour || (last && sameDay(new Date(last), now))) return;

    try {
      const backup = this.create('auto');
      this.prune(settings.keep);
      console.log(`🗄️ Daily backup saved: data/backups/${backup.name} (${Math.round(backup.size / 1024)} KB)`);
    } catch (error) {
      console.error('❌ The daily database backup failed:', error);
      // Try again in an hour, not every 10 minutes.
      this.retryAfter = Date.now() + 60 * 60 * 1000;
      void this.client.alerts.send('backups', '🗄️ The daily backup failed', `The automatic backup of the database could not be written:\n\`\`\`${String(error).slice(0, 500)}\`\`\``);
    }
  }
}
