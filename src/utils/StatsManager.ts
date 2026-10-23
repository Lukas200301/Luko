import * as os from 'node:os';
import { Client } from 'discord.js';
import { db } from './Database';
import { CommandUsageEntry, MetricSample } from '../shared/types';

interface CommandCounter {
  uses: number;
  lastUsed: number;
}

interface UsageRow {
  t: number;
  command: string;
  user_id: string;
  user_tag: string;
  guild_id: string | null;
  guild_name: string | null;
  success: number;
}

const HISTORY_LIMIT = 300;
const USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 60_000;
const MAX_SAMPLES = 24 * 60;

const statements = {
  bumpCounter: db.prepare(`
    INSERT INTO command_stats (command, uses, last_used) VALUES (?, 1, ?)
    ON CONFLICT (command) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used
  `),
  insertUsage: db.prepare('INSERT INTO command_usage (t, command, user_id, user_tag, guild_id, guild_name, success) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  counter: db.prepare('SELECT uses, last_used FROM command_stats WHERE command = ?'),
  history: db.prepare('SELECT * FROM command_usage ORDER BY id DESC LIMIT ?'),
  countSince: db.prepare('SELECT COUNT(*) AS n FROM command_usage WHERE t >= ?'),
  prune: db.prepare('DELETE FROM command_usage WHERE t < ?')
};

export class StatsManager {
  private client: Client;
  private samples: MetricSample[] = [];
  private lastCpu = process.cpuUsage();
  private lastCpuTime = Date.now();
  private cpuPercent = 0;

  constructor(client: Client) {
    this.client = client;

    // All-time counts live in command_stats; the detailed usage log keeps the last 90 days.
    this.prune();
    setInterval(() => this.prune(), 24 * 60 * 60 * 1000).unref();
    setInterval(() => this.sample(), SAMPLE_INTERVAL_MS).unref();
  }

  private prune(): void {
    statements.prune.run(Date.now() - USAGE_RETENTION_MS);
  }

  recordCommand(entry: CommandUsageEntry): void {
    try {
      statements.bumpCounter.run(entry.command, entry.t);
      statements.insertUsage.run(entry.t, entry.command, entry.userId, entry.userTag, entry.guildId, entry.guildName, entry.success ? 1 : 0);
    } catch (error) {
      console.error('❌ Failed to record command usage:', error);
    }
  }

  getCounter(command: string): CommandCounter | undefined {
    const row = statements.counter.get(command) as { uses: number; last_used: number } | undefined;
    return row ? { uses: row.uses, lastUsed: row.last_used } : undefined;
  }

  getHistory(): CommandUsageEntry[] {
    return (statements.history.all(HISTORY_LIMIT) as unknown as UsageRow[]).map(row => ({
      t: row.t,
      command: row.command,
      userId: row.user_id,
      userTag: row.user_tag,
      guildId: row.guild_id,
      guildName: row.guild_name,
      success: row.success === 1
    }));
  }

  countSince(timestamp: number): number {
    return (statements.countSince.get(timestamp) as { n: number }).n;
  }

  // CPU usage of this process as a share of all cores since the last call.
  getCpuPercent(): number {
    const now = Date.now();
    const elapsedMs = now - this.lastCpuTime;
    if (elapsedMs >= 1000) {
      const usage = process.cpuUsage(this.lastCpu);
      const usedMs = (usage.user + usage.system) / 1000;
      this.cpuPercent = Math.min(100, (usedMs / elapsedMs / os.availableParallelism()) * 100);
      this.lastCpu = process.cpuUsage();
      this.lastCpuTime = now;
    }
    return Math.round(this.cpuPercent * 10) / 10;
  }

  private sample(): void {
    const memory = process.memoryUsage();
    this.samples.push({
      t: Date.now(),
      memoryRss: memory.rss,
      heapUsed: memory.heapUsed,
      ping: this.client.ws.ping ?? -1,
      guilds: this.client.guilds.cache.size,
      users: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
      queues: this.client.queueManager?.size() ?? 0,
      cpuPercent: this.getCpuPercent()
    });

    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  getSamples(): MetricSample[] {
    return this.samples;
  }
}
