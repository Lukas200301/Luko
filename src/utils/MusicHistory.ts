import { Client } from 'discord.js';
import { SQLInputValue } from 'node:sqlite';
import { db } from './Database';
import { QueueTrack } from './QueueManager';
import { buildTimeline, rangeStart } from './Timeline';
import { MusicHistoryPage, MusicPlay, MusicStats, StatsRange } from '../shared/types';

// Every song the bot played, for the music statistics and history in the panel.

interface PlayRow {
  id: number;
  guild_id: string;
  title: string;
  author: string | null;
  uri: string | null;
  source: string | null;
  duration: number;
  artwork_url: string | null;
  requested_by: string | null;
  requested_by_id: string | null;
  played_at: number;
}

// A failed track that is retried from another source starts twice; count it once.
const REPEAT_WINDOW = 60_000;

const statements = {
  insert: db.prepare(`
    INSERT INTO music_plays (guild_id, title, author, uri, source, duration, artwork_url, requested_by, requested_by_id, played_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  clear: db.prepare('DELETE FROM music_plays')
};

export class MusicHistory {
  private last = new Map<string, { title: string; t: number }>();

  constructor(private client: Client) {}

  record(guildId: string, track: QueueTrack): void {
    if (!this.client.settings.get().features.musicHistory) return;

    const previous = this.last.get(guildId);
    if (previous && previous.title === track.title && Date.now() - previous.t < REPEAT_WINDOW) return;
    this.last.set(guildId, { title: track.title, t: Date.now() });

    const info = track.track.info;
    statements.insert.run(
      guildId,
      track.title || info.title,
      info.author || null,
      track.uri || info.uri || null,
      info.sourceName || null,
      track.duration || info.length || 0,
      info.artworkUrl ?? null,
      track.requestedBy || null,
      track.requestedById ?? null,
      Date.now()
    );
  }

  clear(): void {
    statements.clear.run();
  }

  private toPlay(row: PlayRow): MusicPlay {
    return {
      id: row.id,
      guildId: row.guild_id,
      guildName: this.client.guilds.cache.get(row.guild_id)?.name ?? null,
      title: row.title,
      author: row.author,
      uri: row.uri,
      source: row.source,
      duration: row.duration,
      artworkUrl: row.artwork_url,
      requestedBy: row.requested_by,
      requestedById: row.requested_by_id,
      playedAt: row.played_at
    };
  }

  private filter(range: StatsRange, guildId?: string, search?: string): { where: string; params: SQLInputValue[] } {
    const where = ['1 = 1'];
    const params: SQLInputValue[] = [];
    const since = rangeStart(range);
    if (since !== null) {
      where.push('played_at >= ?');
      params.push(since);
    }
    if (guildId) {
      where.push('guild_id = ?');
      params.push(guildId);
    }
    if (search) {
      where.push("(title LIKE ? ESCAPE '\\' OR COALESCE(author, '') LIKE ? ESCAPE '\\' OR COALESCE(requested_by, '') LIKE ? ESCAPE '\\')");
      const like = `%${search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
      params.push(like, like, like);
    }
    return { where: where.join(' AND '), params };
  }

  page(options: { range: StatsRange; guildId?: string; search?: string; limit: number; offset: number }): MusicHistoryPage {
    const { where, params } = this.filter(options.range, options.guildId, options.search);
    const rows = db.prepare(`SELECT * FROM music_plays WHERE ${where} ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, options.limit, options.offset) as unknown as PlayRow[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM music_plays WHERE ${where}`).get(...params) as { n: number }).n;
    return { plays: rows.map(row => this.toPlay(row)), total, offset: options.offset, limit: options.limit };
  }

  // Most played songs, for /history and the panel.
  topTracks(range: StatsRange, guildId: string | undefined, limit: number): MusicStats['topTracks'] {
    const { where, params } = this.filter(range, guildId);
    return db.prepare(`
      SELECT MAX(title) AS title, MAX(author) AS author, uri, MAX(artwork_url) AS artworkUrl, COUNT(*) AS plays
      FROM music_plays WHERE ${where}
      GROUP BY COALESCE(uri, title) ORDER BY plays DESC, MAX(played_at) DESC LIMIT ?
    `).all(...params, limit) as MusicStats['topTracks'];
  }

  stats(range: StatsRange, guildId?: string): MusicStats {
    const { where, params } = this.filter(range, guildId);
    const run = <T>(sql: string, ...extra: SQLInputValue[]) => db.prepare(sql).all(...params, ...extra) as T[];

    const totals = db.prepare(`
      SELECT COUNT(*) AS plays, COALESCE(SUM(duration), 0) AS listeningTime,
        COUNT(DISTINCT COALESCE(uri, title)) AS uniqueTracks,
        COUNT(DISTINCT COALESCE(requested_by_id, requested_by)) AS uniqueRequesters
      FROM music_plays WHERE ${where}
    `).get(...params) as { plays: number; listeningTime: number; uniqueTracks: number; uniqueRequesters: number };

    const topArtists = run<MusicStats['topArtists'][number]>(`
      SELECT author, COUNT(*) AS plays FROM music_plays
      WHERE ${where} AND author IS NOT NULL AND author != ''
      GROUP BY author ORDER BY plays DESC LIMIT 10
    `);

    // Autoplay picks aren't anyone's request.
    const topRequesters = run<MusicStats['topRequesters'][number]>(`
      SELECT requested_by_id AS userId, MAX(requested_by) AS name, COUNT(*) AS plays FROM music_plays
      WHERE ${where} AND requested_by IS NOT NULL AND requested_by != 'Autoplay'
      GROUP BY COALESCE(requested_by_id, requested_by) ORDER BY plays DESC LIMIT 10
    `);

    const byHour = Array<number>(24).fill(0);
    const points = run<{ t: number }>(`SELECT played_at AS t FROM music_plays WHERE ${where} ORDER BY played_at`);
    for (const { t } of points) byHour[new Date(t).getHours()]++;

    const guilds = run<{ guildId: string; plays: number }>(`
      SELECT guild_id AS guildId, COUNT(*) AS plays FROM music_plays WHERE ${where}
      GROUP BY guild_id ORDER BY plays DESC LIMIT 20
    `).map(g => ({ ...g, name: this.client.guilds.cache.get(g.guildId)?.name ?? null }));

    return {
      range,
      ...totals,
      topTracks: this.topTracks(range, guildId, 10),
      topArtists,
      topRequesters,
      timeline: buildTimeline(points.map(p => ({ t: p.t, c: 0 })), range).map(({ label, start, n }) => ({ label, start, plays: n })),
      byHour,
      guilds
    };
  }
}
