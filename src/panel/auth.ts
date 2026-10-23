import * as crypto from 'node:crypto';
import { Client } from 'discord.js';
import { db } from '../utils/Database';
import { PanelRole, PanelUser } from '../shared/types';

export const SESSION_COOKIE = 'luko_session';
export const STATE_COOKIE = 'luko_oauth_state';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface SessionRow {
  token_hash: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  role: PanelRole;
  method: PanelUser['method'];
  created_at: number;
  expires_at: number;
}

const statements = {
  insert: db.prepare(`
    INSERT INTO panel_sessions (token_hash, user_id, username, avatar_url, role, method, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  get: db.prepare('SELECT * FROM panel_sessions WHERE token_hash = ?'),
  updateRole: db.prepare('UPDATE panel_sessions SET role = ? WHERE token_hash = ?'),
  delete: db.prepare('DELETE FROM panel_sessions WHERE token_hash = ?'),
  deleteExpired: db.prepare('DELETE FROM panel_sessions WHERE expires_at < ?')
};

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

// Session store for the admin panel. Only SHA-256 hashes of session tokens are
// stored (in the panel_sessions table), never the tokens themselves.
export class PanelAuth {
  private client: Client;
  private failedLogins = new Map<string, { count: number; resetAt: number }>();

  constructor(client: Client) {
    this.client = client;
    statements.deleteExpired.run(Date.now());
  }

  get discordEnabled(): boolean {
    return !!process.env.CLIENT_ID && !!process.env.DISCORD_CLIENT_SECRET;
  }

  get passwordEnabled(): boolean {
    return !!process.env.PANEL_PASSWORD;
  }

  // The owner (OWNER_ID) and the admins listed in settings may use the panel.
  getRole(userId: string): PanelRole | null {
    if (userId === process.env.OWNER_ID) return 'owner';
    if (this.client.settings.get().panel.adminIds.includes(userId)) return 'admin';
    return null;
  }

  createSession(user: PanelUser): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    statements.insert.run(sha256(token).toString('hex'), user.id, user.username, user.avatarUrl, user.role, user.method, now, now + SESSION_TTL_MS);
    return token;
  }

  getSession(token: string | undefined): PanelUser | null {
    if (!token) return null;

    const hash = sha256(token).toString('hex');
    const session = statements.get.get(hash) as SessionRow | undefined;
    if (!session) return null;

    if (session.expires_at < Date.now()) {
      statements.delete.run(hash);
      return null;
    }

    let role = session.role;

    // Re-check Discord logins on every request, so removing someone from the
    // admin list locks them out immediately.
    if (session.method === 'discord') {
      const currentRole = this.getRole(session.user_id);
      if (!currentRole) {
        statements.delete.run(hash);
        return null;
      }
      if (currentRole !== role) {
        statements.updateRole.run(currentRole, hash);
        role = currentRole;
      }
    }

    return {
      id: session.user_id,
      username: session.username,
      avatarUrl: session.avatar_url,
      role,
      method: session.method
    };
  }

  destroySession(token: string | undefined): void {
    if (!token) return;
    statements.delete.run(sha256(token).toString('hex'));
  }

  isRateLimited(ip: string): boolean {
    const entry = this.failedLogins.get(ip);
    if (!entry) return false;
    if (entry.resetAt < Date.now()) {
      this.failedLogins.delete(ip);
      return false;
    }
    return entry.count >= MAX_LOGIN_ATTEMPTS;
  }

  recordFailedLogin(ip: string): void {
    const entry = this.failedLogins.get(ip);
    if (!entry || entry.resetAt < Date.now()) {
      this.failedLogins.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    } else {
      entry.count++;
    }
  }

  verifyPassword(input: string): boolean {
    const expected = process.env.PANEL_PASSWORD;
    if (!expected) return false;
    return crypto.timingSafeEqual(sha256(input), sha256(expected));
  }
}
