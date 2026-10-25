import * as os from 'node:os';
import { Client, EmbedBuilder } from 'discord.js';
import { Constants } from 'shoukaku';
import { BotSettings, LogEntry } from '../shared/types';
import { logManager } from './LogManager';
import { getHostInfo } from './HostInfo';

// Direct messages to the bot owner when something needs attention. Every kind can be switched
// off in the panel (Settings → Alerts), and repeats are held back by a cooldown.

export type AlertKind = 'lavalinkDown' | 'errors' | 'disk' | 'temperature' | 'updates' | 'backups';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CHECK_INTERVAL = MINUTE;
// Lavalink restarts take a few seconds; only report it when it stays down.
const LAVALINK_GRACE = 2 * MINUTE;
const ERROR_WINDOW = 10 * MINUTE;
const ERROR_LIMIT = 5;

const COLORS: Record<AlertKind | 'test', number> = {
  lavalinkDown: 0xED4245,
  errors: 0xED4245,
  disk: 0xFEE75C,
  temperature: 0xFEE75C,
  updates: 0x5865F2,
  backups: 0xED4245,
  test: 0x57F287
};

export interface AlertOptions {
  // Alerts with the same key are sent at most once per cooldown.
  key?: string;
  cooldownMs?: number;
  color?: number;
}

export class AlertManager {
  private lastSent = new Map<string, number>();
  private errors: LogEntry[] = [];
  private lavalinkDownSince: number | null = null;
  private lavalinkReported = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private client: Client) {
    logManager.on('entry', (entry: LogEntry) => {
      if (entry.level !== 'error') return;
      this.errors.push(entry);
      if (this.errors.length > 50) this.errors.shift();
    });
  }

  private get settings(): BotSettings['alerts'] {
    return this.client.settings.get().alerts;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL);
  }

  // Sends an alert if alerts and this kind are switched on (a test alert only needs the main switch).
  async send(kind: AlertKind | 'test', title: string, description: string, options: AlertOptions = {}): Promise<boolean> {
    const settings = this.settings;
    if (!settings.enabled || (kind !== 'test' && !settings[kind])) return false;

    const key = options.key ?? kind;
    const cooldown = options.cooldownMs ?? 6 * HOUR;
    const last = this.lastSent.get(key);
    if (kind !== 'test' && last && Date.now() - last < cooldown) return false;

    const ownerId = process.env.OWNER_ID;
    if (!ownerId || !this.client.isReady()) return false;

    try {
      const owner = await this.client.users.fetch(ownerId);
      await owner.send({
        embeds: [new EmbedBuilder()
          .setColor(options.color ?? COLORS[kind])
          .setTitle(title)
          .setDescription(description.slice(0, 4000))
          .setFooter({ text: `${this.client.user?.username ?? 'Luko'} on ${os.hostname()} · turn alerts off in the panel under Settings` })
          .setTimestamp()]
      });
      this.lastSent.set(key, Date.now());
      return true;
    } catch (error) {
      // Not console.error: a failing alert must not count as an error that triggers another alert.
      console.warn('⚠️ Could not send an alert to the owner (are DMs from server members allowed?):', error instanceof Error ? error.message : error);
      return false;
    }
  }

  private async check(): Promise<void> {
    if (!this.client.isReady() || !this.settings.enabled) return;
    await this.checkLavalink();
    await this.checkErrors();
    await this.checkHost();
  }

  private async checkLavalink(): Promise<void> {
    const shoukaku = this.client.shoukaku;
    if (!shoukaku || !this.client.settings.get().features.music) {
      this.lavalinkDownSince = null;
      return;
    }

    const connected = [...shoukaku.nodes.values()].some(node => node.state === Constants.State.CONNECTED);
    if (connected) {
      if (this.lavalinkReported) {
        this.lavalinkReported = false;
        await this.send('lavalinkDown', '✅ Lavalink is back', 'The connection to Lavalink works again. Music commands are available.', { key: 'lavalinkUp', cooldownMs: 0, color: 0x57F287 });
      }
      this.lavalinkDownSince = null;
      return;
    }

    this.lavalinkDownSince ??= Date.now();
    if (!this.lavalinkReported && Date.now() - this.lavalinkDownSince >= LAVALINK_GRACE) {
      const minutes = Math.round((Date.now() - this.lavalinkDownSince) / MINUTE);
      this.lavalinkReported = await this.send('lavalinkDown', '🔇 Lavalink is down',
        `The bot has had no connection to Lavalink for ${minutes} minutes, so music doesn't work. It keeps trying to reconnect.\n\n` +
        'Check the Lavalink page in the panel (start/restart it there if it runs on this server).',
        { cooldownMs: 0 });
    }
  }

  private async checkErrors(): Promise<void> {
    const recent = this.errors.filter(e => Date.now() - e.t < ERROR_WINDOW);
    if (recent.length < ERROR_LIMIT) return;

    const lines = recent.slice(-3).map(e => `\`\`\`${e.message.slice(0, 300)}\`\`\``).join('');
    const sent = await this.send('errors', `❌ ${recent.length} errors in the last 10 minutes`, `The latest ones:\n${lines}\nSee Logs & Activity in the panel for all of them.`, { cooldownMs: HOUR });
    if (sent) this.errors = [];
  }

  private async checkHost(): Promise<void> {
    const host = getHostInfo();
    const settings = this.settings;

    if (host.diskTotal > 0) {
      const percent = Math.round((host.diskUsed / host.diskTotal) * 100);
      if (percent >= settings.diskPercent) {
        const freeGb = ((host.diskTotal - host.diskUsed) / 1024 ** 3).toFixed(1);
        await this.send('disk', '💾 The disk is almost full', `The disk is **${percent}%** full (${freeGb} GB free). When it runs full, the database and logs can't be written anymore.`, { cooldownMs: 12 * HOUR });
      }
    }

    if (host.cpuTemp !== null && host.cpuTemp >= settings.temperatureC) {
      await this.send('temperature', '🌡️ The CPU is hot', `The CPU is at **${host.cpuTemp} °C** (alert from ${settings.temperatureC} °C). A Raspberry Pi slows itself down from about 80 °C.`, { cooldownMs: HOUR });
    }
  }
}
