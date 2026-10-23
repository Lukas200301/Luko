import { db } from './Database';
import { AuditEntry } from '../shared/types';

const MAX_ENTRIES = 5000;

const statements = {
  insert: db.prepare('INSERT INTO audit_log (t, user_id, username, action, details) VALUES (?, ?, ?, ?, ?)'),
  latest: db.prepare('SELECT t, user_id, username, action, details FROM audit_log ORDER BY id DESC LIMIT ?'),
  prune: db.prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?')
};

// Records every change made through the admin panel (who did what, and when).
export class AuditLog {
  add(entry: Omit<AuditEntry, 't'>): void {
    try {
      statements.insert.run(Date.now(), entry.userId, entry.username, entry.action, entry.details ?? null);
      statements.prune.run(MAX_ENTRIES);
    } catch (error) {
      console.error('❌ Failed to write audit log:', error);
    }
  }

  getEntries(limit = 500): AuditEntry[] {
    const rows = statements.latest.all(limit) as unknown as Array<{ t: number; user_id: string; username: string; action: string; details: string | null }>;
    return rows.map(row => ({
      t: row.t,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      details: row.details ?? undefined
    }));
  }
}
