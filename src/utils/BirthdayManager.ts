import { Client } from 'discord.js';
import { db } from './Database';
import { BirthdayInfo } from '../shared/types';

// Birthdays per server, announced once a day in the server's birthday channel (Settings → Birthdays).

interface BirthdayRow {
  guild_id: string;
  user_id: string;
  user_name: string | null;
  day: number;
  month: number;
  year: number | null;
}

const CHECK_INTERVAL = 5 * 60 * 1000;

const statements = {
  upsert: db.prepare(`
    INSERT INTO birthdays (guild_id, user_id, user_name, day, month, year) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET user_name = excluded.user_name, day = excluded.day, month = excluded.month, year = excluded.year
  `),
  delete: db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  get: db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  byGuild: db.prepare('SELECT * FROM birthdays WHERE guild_id = ?'),
  all: db.prepare('SELECT * FROM birthdays'),
  onDay: db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?'),
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(month: number, year?: number | null): number {
  if (month === 2) return year ? (isLeapYear(year) ? 29 : 28) : 29;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// Midnight (server time) of the birthday in `year`; 29 February is celebrated on the 28th in other years.
function birthdayIn(year: number, day: number, month: number): Date {
  return new Date(year, month - 1, Math.min(day, daysInMonth(month, year)));
}

export function nextBirthday(day: number, month: number, from = new Date()): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisYear = birthdayIn(today.getFullYear(), day, month);
  return thisYear >= today ? thisYear : birthdayIn(today.getFullYear() + 1, day, month);
}

export function formatBirthday(day: number, month: number, year?: number | null): string {
  return `${day} ${MONTHS[month - 1]}${year ? ` ${year}` : ''}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export class BirthdayManager {
  private timer: NodeJS.Timeout | null = null;

  constructor(private client: Client) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.announceDue().catch(error => console.error('❌ Birthday announcement failed:', error)), CHECK_INTERVAL);
    setTimeout(() => this.announceDue().catch(() => {}), 20_000);
  }

  set(guildId: string, userId: string, userName: string | null, day: number, month: number, year: number | null): void {
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
      throw new Error(`${formatBirthday(day, month, year)} is not a valid date.`);
    }
    if (year !== null && (year < 1900 || birthdayIn(year, day, month) > new Date())) {
      throw new Error('That year is not possible.');
    }
    statements.upsert.run(guildId, userId, userName, day, month, year);
  }

  remove(guildId: string, userId: string): boolean {
    return statements.delete.run(guildId, userId).changes > 0;
  }

  get(guildId: string, userId: string): BirthdayInfo | null {
    const row = statements.get.get(guildId, userId) as BirthdayRow | undefined;
    return row ? this.toInfo(row) : null;
  }

  // Sorted by the next birthday.
  list(guildId?: string): BirthdayInfo[] {
    const rows = (guildId ? statements.byGuild.all(guildId) : statements.all.all()) as unknown as BirthdayRow[];
    return rows.map(row => this.toInfo(row)).sort((a, b) => a.nextAt - b.nextAt);
  }

  private toInfo(row: BirthdayRow): BirthdayInfo {
    const next = nextBirthday(row.day, row.month);
    const member = this.client.guilds.cache.get(row.guild_id)?.members.cache.get(row.user_id);
    const user = member?.user ?? this.client.users.cache.get(row.user_id);
    return {
      guildId: row.guild_id,
      userId: row.user_id,
      userName: member?.displayName ?? user?.displayName ?? row.user_name ?? 'Unknown user',
      avatarUrl: member?.displayAvatarURL({ size: 64 }) ?? user?.displayAvatarURL({ size: 64 }) ?? null,
      day: row.day,
      month: row.month,
      year: row.year,
      nextAt: next.getTime(),
      nextAge: row.year ? next.getFullYear() - row.year : null
    };
  }

  // Today's birthdays of a server (29 February counts on the 28th outside leap years).
  private birthdaysToday(guildId: string, now: Date): BirthdayRow[] {
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const rows = statements.onDay.all(guildId, month, day) as unknown as BirthdayRow[];
    if (month === 2 && day === 28 && !isLeapYear(now.getFullYear())) {
      rows.push(...(statements.onDay.all(guildId, 2, 29) as unknown as BirthdayRow[]));
    }
    return rows;
  }

  async announceDue(): Promise<void> {
    const settings = this.client.settings.get();
    if (!settings.features.birthdays || !this.client.isReady()) return;

    const now = new Date();
    if (now.getHours() < settings.birthdays.hour) return;

    for (const [guildId, channelId] of Object.entries(settings.birthdays.channels)) {
      const metaKey = `birthdays_announced:${guildId}`;
      const done = (statements.getMeta.get(metaKey) as { value: string } | undefined)?.value;
      if (done === dateKey(now)) continue;
      // Mark first, so a failing channel doesn't repeat messages every few minutes.
      statements.setMeta.run(metaKey, dateKey(now));

      const today = this.birthdaysToday(guildId, now);
      if (today.length === 0) continue;

      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) {
        console.warn(`⚠️ Can't post birthdays in channel ${channelId} (server ${guildId}): the channel is gone or the bot can't write there.`);
        continue;
      }

      for (const row of today) {
        await channel.send({
          content: this.message(settings.birthdays.message, row, now),
          allowedMentions: { users: [row.user_id] }
        }).catch(error => console.error('❌ Could not send a birthday message:', error));
      }
    }
  }

  message(template: string, row: Pick<BirthdayRow, 'user_id' | 'user_name' | 'year'>, now = new Date()): string {
    const name = this.client.users.cache.get(row.user_id)?.displayName ?? row.user_name ?? 'someone';
    return template
      .replaceAll('{user}', `<@${row.user_id}>`)
      .replaceAll('{name}', name)
      .replaceAll('{age}', row.year ? String(now.getFullYear() - row.year) : '')
      .replace(/\s+([!.?])/g, '$1')
      .trim();
  }
}
