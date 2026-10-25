import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client, EmbedBuilder } from 'discord.js';
import { FilterOptions, LoadType, Node, Track } from 'shoukaku';
import { MusicQueue, QueueTrack } from './QueueManager';
import { botEvents } from './botEvents';

const execFileAsync = promisify(execFile);

export const MUSIC_COMMANDS = new Set([
  'play', 'skip', 'stop', 'queue', 'loop', 'pause', 'volume',
  'shuffle', 'autoplay', 'nowplaying', 'search', 'clearqueue',
  'filter', 'seek', 'jump', 'move', 'remove', 'previous', 'playlist', 'history'
]);

export type MusicSource =
  | 'auto'
  | 'ytmsearch'
  | 'ytsearch'
  | 'spsearch'
  | 'scsearch'
  | 'amsearch'
  | 'dzsearch'
  | 'bcsearch';

export const MUSIC_SOURCE_CHOICES: Array<{ name: string; value: MusicSource }> = [
  { name: 'Auto (Best Match)', value: 'auto' },
  { name: 'YouTube Music', value: 'ytmsearch' },
  { name: 'YouTube', value: 'ytsearch' },
  { name: 'Spotify', value: 'spsearch' },
  { name: 'SoundCloud', value: 'scsearch' },
  { name: 'Apple Music', value: 'amsearch' },
  { name: 'Deezer', value: 'dzsearch' },
  { name: 'Bandcamp', value: 'bcsearch' }
];

const KNOWN_SEARCH_PREFIXES = [
  'ytmsearch:',
  'ytsearch:',
  'scsearch:',
  'spsearch:',
  'amsearch:',
  'dzsearch:',
  'bcsearch:',
  'ymsearch:',
  'ftts:'
];

const SHORT_LINK_HOSTS = new Set([
  'on.soundcloud.com',
  'snd.sc',
  'spotify.link',
  'spoti.fi',
  'deezer.page.link',
  'dzr.page.link',
  'apple.co',
  'vm.tiktok.com',
  'vt.tiktok.com'
]);

export const FILTER_PRESETS: Record<string, { label: string; filters: FilterOptions }> = {
  none: { label: 'No filter', filters: {} },
  nightcore: {
    label: 'Nightcore',
    filters: { timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 } }
  },
  vaporwave: {
    label: 'Vaporwave',
    filters: {
      timescale: { speed: 0.8, pitch: 0.8, rate: 1.0 },
      equalizer: [
        { band: 0, gain: 0.3 },
        { band: 1, gain: 0.3 }
      ]
    }
  },
  bassboost: {
    label: 'Bassboost',
    filters: {
      equalizer: [
        { band: 0, gain: 0.6 },
        { band: 1, gain: 0.67 },
        { band: 2, gain: 0.67 },
        { band: 3, gain: 0.4 }
      ]
    }
  },
  '8d': {
    label: '8D Audio',
    filters: { rotation: { rotationHz: 0.2 } }
  },
  karaoke: {
    label: 'Karaoke',
    filters: { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 } }
  },
  tremolo: {
    label: 'Tremolo',
    filters: { tremolo: { frequency: 4.0, depth: 0.75 } }
  }
};

export function isMusicAvailable(client: Client): boolean {
  return client.settings.get().features.music && !!client.shoukaku;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function toQueueTrack(track: Track, requestedBy: string, requestedById?: string): QueueTrack {
  return {
    track,
    requestedBy,
    requestedById,
    title: track.info.title,
    uri: track.info.uri || '',
    duration: track.info.length
  };
}

export interface ResolvedTracks {
  tracks: Track[];
  playlistName: string | null;
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

function hasKnownPrefix(input: string): boolean {
  const lower = input.toLowerCase();
  return KNOWN_SEARCH_PREFIXES.some(prefix => lower.startsWith(prefix));
}

async function normalizeAndUnshortenUrl(rawUrl: string): Promise<string> {
  let current = rawUrl.trim();
  try {
    const parsed = new URL(current);
    const host = parsed.hostname.toLowerCase();

    if (SHORT_LINK_HOSTS.has(host)) {
      try {
        const res = await fetch(current, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (res.url && isHttpUrl(res.url)) {
          current = res.url;
        }
      } catch {
        // Keep original URL if unshortening fails
      }
    }

    const finalUrl = new URL(current);
    const finalHost = finalUrl.hostname.toLowerCase();

    // Normalize Spotify international paths (/intl-de/track/... -> /track/...) and strip tracking params
    if (finalHost.endsWith('spotify.com')) {
      finalUrl.pathname = finalUrl.pathname.replace(/^\/intl-[a-z]{2}(?:-[a-z]{2})?\//i, '/');
      finalUrl.search = '';
      return finalUrl.toString();
    }

    // Strip SoundCloud social sharing tracking parameters (?si=..., utm_*) except secret_token (?s-...)
    if (finalHost.endsWith('soundcloud.com')) {
      const secret = finalUrl.searchParams.get('secret_token');
      finalUrl.search = '';
      if (secret) {
        finalUrl.searchParams.set('secret_token', secret);
      }
      return finalUrl.toString();
    }

    return finalUrl.toString();
  } catch {
    return current;
  }
}

async function resolveIdentifierOnNode(node: Node, identifier: string): Promise<ResolvedTracks | null> {
  try {
    const result = await node.rest.resolve(identifier);
    if (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR) {
      return null;
    }

    switch (result.loadType) {
      case LoadType.PLAYLIST:
        return result.data.tracks.length > 0
          ? { tracks: result.data.tracks, playlistName: result.data.info.name }
          : null;
      case LoadType.SEARCH:
        return result.data.length > 0
          ? { tracks: result.data, playlistName: null }
          : null;
      case LoadType.TRACK:
        return { tracks: [result.data], playlistName: null };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function resolveBySearchChain(
  node: Node,
  searchText: string,
  prefixes: string[] = ['ytmsearch:', 'ytsearch:', 'scsearch:']
): Promise<ResolvedTracks | null> {
  const clean = searchText.trim();
  if (!clean) return null;

  for (const prefix of prefixes) {
    const resolved = await resolveIdentifierOnNode(node, `${prefix}${clean}`);
    if (resolved && resolved.tracks.length > 0) {
      return resolved;
    }
  }
  return null;
}

interface ExternalTrackMeta {
  title: string;
  artist?: string;
  uri?: string;
  artworkUrl?: string;
  durationMs?: number;
}

function applyMetadataToTrack(track: Track, meta: ExternalTrackMeta): Track {
  if (meta.title && (!track.info.title || track.info.title === 'Unknown title')) {
    track.info.title = meta.title;
  }
  if (meta.artist && (!track.info.author || track.info.author === 'Unknown artist')) {
    track.info.author = meta.artist;
  }
  if (meta.artworkUrl && !track.info.artworkUrl) {
    track.info.artworkUrl = meta.artworkUrl;
  }
  if (meta.uri && !track.info.uri) {
    track.info.uri = meta.uri;
  }
  return track;
}

async function resolveExternalTrackList(
  node: Node,
  items: ExternalTrackMeta[],
  playlistName: string | null = null,
  preferredPrefixes: string[] = ['ytmsearch:', 'ytsearch:', 'scsearch:']
): Promise<ResolvedTracks | null> {
  const limited = items.slice(0, 30);
  const tracks: Track[] = [];
  const batchSize = 5;

  for (let i = 0; i < limited.length; i += batchSize) {
    const batch = limited.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (item) => {
        const searchStr = item.artist ? `${item.artist} - ${item.title}` : item.title;
        const resolved = await resolveBySearchChain(node, searchStr, preferredPrefixes);
        if (!resolved || resolved.tracks.length === 0) return null;
        const best = resolved.tracks[0];
        if (item.artworkUrl && !best.info.artworkUrl) {
          best.info.artworkUrl = item.artworkUrl;
        }
        return best;
      })
    );
    for (const track of results) {
      if (track) tracks.push(track);
    }
  }

  return tracks.length > 0 ? { tracks, playlistName } : null;
}

// Fallback for Spotify URLs when LavaSrc Spotify credentials are not configured or token fails.
async function resolveSpotifyUrlFallback(node: Node, url: string): Promise<ResolvedTracks | null> {
  const match = url.match(/open\.spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/i);
  if (!match) return null;

  const [, entityType, entityId] = match;
  try {
    const embedUrl = `https://open.spotify.com/embed/${entityType.toLowerCase()}/${entityId}`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(7000)
    });

    if (res.ok) {
      const html = await res.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
      if (nextDataMatch) {
        const json = JSON.parse(nextDataMatch[1]);
        const entity = json?.props?.pageProps?.state?.data?.entity;
        if (entity) {
          const coverUrl: string | undefined =
            entity.visualIdentity?.image?.[0]?.url ||
            entity.coverArt?.sources?.[0]?.url;

          if (entity.type === 'track' || entityType.toLowerCase() === 'track') {
            const title: string = entity.title || entity.name || '';
            const artist: string =
              entity.subtitle ||
              (Array.isArray(entity.artists) ? entity.artists.map((a: { name?: string }) => a.name).filter(Boolean).join(', ') : '');
            if (title) {
              return resolveExternalTrackList(node, [{ title, artist, uri: url, artworkUrl: coverUrl }], null);
            }
          } else if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
            const playlistName: string = entity.title || entity.name || 'Spotify Playlist';
            const items: ExternalTrackMeta[] = entity.trackList
              .map((t: { title?: string; subtitle?: string }) => ({
                title: t.title || '',
                artist: (t.subtitle || '').replace(/\u00a0/g, ' ').trim(),
                artworkUrl: coverUrl
              }))
              .filter((t: ExternalTrackMeta) => Boolean(t.title));

            if (items.length > 0) {
              return resolveExternalTrackList(node, items, playlistName);
            }
          }
        }
      }
    }
  } catch {
    // Fall through to oEmbed
  }

  // Secondary fallback: Spotify public oEmbed endpoint
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (oembedRes.ok) {
      const data = await oembedRes.json() as { title?: string; thumbnail_url?: string };
      if (data.title) {
        return resolveExternalTrackList(node, [{ title: data.title, uri: url, artworkUrl: data.thumbnail_url }], null);
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

// Fallback for SoundCloud URLs via SoundCloud public oEmbed API.
async function resolveSoundCloudUrlFallback(node: Node, url: string): Promise<ResolvedTracks | null> {
  try {
    const oembedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;

    const data = await res.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    if (!data.title) return null;

    const query = data.author_name && !data.title.toLowerCase().includes(data.author_name.toLowerCase())
      ? `${data.author_name} - ${data.title}`
      : data.title;

    return resolveExternalTrackList(
      node,
      [{ title: query, artworkUrl: data.thumbnail_url, uri: url }],
      null,
      ['scsearch:', 'ytmsearch:', 'ytsearch:']
    );
  } catch {
    return null;
  }
}

// Resolves Deezer URLs or dzsearch queries using Deezer's free public API.
async function resolveDeezer(node: Node, queryOrUrl: string, isSearch: boolean): Promise<ResolvedTracks | null> {
  try {
    if (isSearch) {
      const res = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(queryOrUrl)}&limit=5`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return null;
      const json = await res.json() as {
        data?: Array<{ title?: string; artist?: { name?: string }; album?: { cover_big?: string }; link?: string }>;
      };
      if (!json.data || json.data.length === 0) return null;

      const items: ExternalTrackMeta[] = json.data
        .filter(item => Boolean(item.title))
        .map(item => ({
          title: item.title!,
          artist: item.artist?.name,
          artworkUrl: item.album?.cover_big,
          uri: item.link
        }));

      return resolveExternalTrackList(node, items, null);
    }

    const match = queryOrUrl.match(/deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/i);
    if (!match) return null;
    const [, type, id] = match;

    const res = await fetch(`https://api.deezer.com/${type.toLowerCase()}/${id}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      title?: string;
      artist?: { name?: string };
      album?: { cover_big?: string };
      cover_big?: string;
      picture_big?: string;
      tracks?: { data?: Array<{ title?: string; artist?: { name?: string }; album?: { cover_big?: string } }> };
    };

    if (type.toLowerCase() === 'track' && data.title) {
      return resolveExternalTrackList(node, [{
        title: data.title,
        artist: data.artist?.name,
        artworkUrl: data.album?.cover_big,
        uri: queryOrUrl
      }], null);
    }

    if (data.tracks?.data && data.tracks.data.length > 0) {
      const cover = data.cover_big || data.picture_big;
      const items: ExternalTrackMeta[] = data.tracks.data
        .filter(t => Boolean(t.title))
        .map(t => ({
          title: t.title!,
          artist: t.artist?.name || data.artist?.name,
          artworkUrl: t.album?.cover_big || cover
        }));
      return resolveExternalTrackList(node, items, data.title || 'Deezer Playlist');
    }
  } catch {
    // Ignore
  }
  return null;
}

// Fallback for Apple Music URLs or amsearch queries using iTunes public API.
async function resolveAppleMusicFallback(node: Node, queryOrUrl: string, isSearch: boolean): Promise<ResolvedTracks | null> {
  try {
    if (isSearch) {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(queryOrUrl)}&media=music&entity=song&limit=5`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return null;
      const json = await res.json() as {
        results?: Array<{ trackName?: string; artistName?: string; artworkUrl100?: string; trackViewUrl?: string }>;
      };
      if (!json.results || json.results.length === 0) return null;

      const items: ExternalTrackMeta[] = json.results
        .filter(r => Boolean(r.trackName))
        .map(r => ({
          title: r.trackName!,
          artist: r.artistName,
          artworkUrl: r.artworkUrl100?.replace('100x100bb', '600x600bb'),
          uri: r.trackViewUrl
        }));
      return resolveExternalTrackList(node, items, null);
    }

    const parsed = new URL(queryOrUrl);
    const trackId = parsed.searchParams.get('i') || parsed.pathname.split('/').pop();
    if (trackId && /^\d+$/.test(trackId)) {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}&entity=song`, {
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const json = await res.json() as {
          results?: Array<{ wrapperType?: string; collectionName?: string; trackName?: string; artistName?: string; artworkUrl100?: string }>;
        };
        const songs = (json.results || []).filter(r => r.wrapperType === 'track' && r.trackName);
        if (songs.length > 0) {
          const collection = json.results?.find(r => r.wrapperType === 'collection');
          const items: ExternalTrackMeta[] = songs.map(s => ({
            title: s.trackName!,
            artist: s.artistName,
            artworkUrl: s.artworkUrl100?.replace('100x100bb', '600x600bb')
          }));
          return resolveExternalTrackList(node, items, songs.length > 1 ? (collection?.collectionName || 'Apple Music') : null);
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

function findYtDlpBinary(): string {
  const winPath = 'C:\\Program Files\\YT-DLP\\yt-dlp.exe';
  if (process.platform === 'win32' && fs.existsSync(winPath)) {
    return winPath;
  }
  return 'yt-dlp';
}

// Universal yt-dlp extractor fallback for direct URLs (SoundCloud, YouTube, TikTok, Bandcamp, Reddit, etc.)
async function resolveWithYtDlpFallback(node: Node, url: string): Promise<ResolvedTracks | null> {
  try {
    const bin = findYtDlpBinary();
    const { stdout } = await execFileAsync(
      bin,
      [
        '--no-playlist',
        '--no-warnings',
        '--dump-single-json',
        '-f',
        'bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio[protocol^=http]/bestaudio/best',
        url
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
    );

    const info = JSON.parse(stdout.trim()) as {
      url?: string;
      title?: string;
      track?: string;
      artist?: string;
      uploader?: string;
      thumbnail?: string;
      webpage_url?: string;
      duration?: number;
    };

    const title = info.track || info.title || 'Unknown Title';
    const artist = info.artist || info.uploader || 'Unknown Artist';

    // Try resolving the direct stream URL via Lavalink's HTTP source first
    if (info.url && isHttpUrl(info.url)) {
      const directResolved = await resolveIdentifierOnNode(node, info.url);
      if (directResolved && directResolved.tracks.length > 0) {
        const track = applyMetadataToTrack(directResolved.tracks[0], {
          title,
          artist,
          uri: info.webpage_url || url,
          artworkUrl: info.thumbnail,
          durationMs: info.duration ? Math.round(info.duration * 1000) : undefined
        });
        track.info.title = title;
        track.info.author = artist;
        track.info.uri = info.webpage_url || url;
        if (info.thumbnail) track.info.artworkUrl = info.thumbnail;
        return { tracks: [track], playlistName: null };
      }
    }

    // Otherwise resolve by extracted artist + title metadata
    if (info.title || info.track) {
      const searchStr = info.artist && info.track ? `${info.artist} - ${info.track}` : `${artist} - ${title}`;
      return resolveBySearchChain(node, searchStr);
    }
  } catch {
    // yt-dlp not installed or failed for this URL
  }
  return null;
}

// Resolves a URL or search text into tracks across all supported platforms.
export async function resolveTracks(
  client: Client,
  query: string,
  source: MusicSource = 'auto'
): Promise<ResolvedTracks | null> {
  const node = client.shoukaku?.getIdealNode();
  if (!node) {
    throw new Error('No Lavalink nodes are available right now.');
  }

  const trimmed = query.trim();
  if (!trimmed) return null;

  // 1. Handle explicit search prefix typed in the query (e.g. "scsearch:..." or "spsearch:...")
  if (hasKnownPrefix(trimmed)) {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('dzsearch:')) {
      const dzQuery = trimmed.slice('dzsearch:'.length).trim();
      return (await resolveIdentifierOnNode(node, trimmed)) ?? (await resolveDeezer(node, dzQuery, true));
    }
    const direct = await resolveIdentifierOnNode(node, trimmed);
    if (direct) return direct;

    const rawQuery = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (lower.startsWith('spsearch:')) {
      return resolveBySearchChain(node, rawQuery, ['ytmsearch:', 'ytsearch:', 'scsearch:']);
    }
    if (lower.startsWith('amsearch:')) {
      return (await resolveAppleMusicFallback(node, rawQuery, true)) ?? (await resolveBySearchChain(node, rawQuery));
    }
    if (lower.startsWith('bcsearch:')) {
      return resolveBySearchChain(node, `${rawQuery} bandcamp`, ['ytsearch:', 'ytmsearch:', 'scsearch:']);
    }
    return resolveBySearchChain(node, rawQuery);
  }

  // 2. Handle URLs (Spotify, YouTube, SoundCloud, Apple Music, Deezer, Bandcamp, Twitch, Vimeo, HTTP, etc.)
  if (isHttpUrl(trimmed)) {
    const normalizedUrl = await normalizeAndUnshortenUrl(trimmed);
    const lowerUrl = normalizedUrl.toLowerCase();

    // Deezer URLs can be resolved via Deezer's public API if LavaSrc Deezer is disabled
    if (lowerUrl.includes('deezer.com/')) {
      const direct = await resolveIdentifierOnNode(node, normalizedUrl);
      if (direct) return direct;
      return resolveDeezer(node, normalizedUrl, false);
    }

    // Try direct resolution through Lavalink first
    const directResolved = await resolveIdentifierOnNode(node, normalizedUrl);
    if (directResolved && directResolved.tracks.length > 0) {
      return directResolved;
    }

    // Platform-specific fallbacks if Lavalink returned EMPTY or ERROR
    if (lowerUrl.includes('spotify.com/')) {
      const spFallback = await resolveSpotifyUrlFallback(node, normalizedUrl);
      if (spFallback) return spFallback;
    }

    if (lowerUrl.includes('soundcloud.com/')) {
      const scFallback = await resolveSoundCloudUrlFallback(node, normalizedUrl);
      if (scFallback) return scFallback;
    }

    if (lowerUrl.includes('music.apple.com/') || lowerUrl.includes('itunes.apple.com/')) {
      const amFallback = await resolveAppleMusicFallback(node, normalizedUrl, false);
      if (amFallback) return amFallback;
    }

    // Universal yt-dlp fallback for any URL that Lavalink couldn't load directly
    return resolveWithYtDlpFallback(node, normalizedUrl);
  }

  // 3. Plain-text search using the requested source
  switch (source) {
    case 'spsearch': {
      const sp = await resolveIdentifierOnNode(node, `spsearch:${trimmed}`);
      if (sp && sp.tracks.length > 0) return sp;
      return resolveBySearchChain(node, trimmed, ['ytmsearch:', 'ytsearch:', 'scsearch:']);
    }
    case 'scsearch': {
      return resolveBySearchChain(node, trimmed, ['scsearch:', 'ytmsearch:', 'ytsearch:']);
    }
    case 'amsearch': {
      const am = await resolveIdentifierOnNode(node, `amsearch:${trimmed}`);
      if (am && am.tracks.length > 0) return am;
      return (await resolveAppleMusicFallback(node, trimmed, true)) ?? (await resolveBySearchChain(node, trimmed));
    }
    case 'dzsearch': {
      const dz = await resolveIdentifierOnNode(node, `dzsearch:${trimmed}`);
      if (dz && dz.tracks.length > 0) return dz;
      return (await resolveDeezer(node, trimmed, true)) ?? (await resolveBySearchChain(node, trimmed));
    }
    case 'bcsearch': {
      return resolveBySearchChain(node, `${trimmed} bandcamp`, ['ytsearch:', 'ytmsearch:', 'scsearch:']);
    }
    case 'ytsearch': {
      return resolveBySearchChain(node, trimmed, ['ytsearch:', 'ytmsearch:', 'scsearch:']);
    }
    case 'ytmsearch': {
      return resolveBySearchChain(node, trimmed, ['ytmsearch:', 'ytsearch:', 'scsearch:']);
    }
    case 'auto':
    default: {
      return resolveBySearchChain(node, trimmed, ['ytmsearch:', 'ytsearch:', 'scsearch:', 'spsearch:']);
    }
  }
}

export interface StartPlaybackOptions {
  guildId: string;
  shardId: number;
  voiceChannelId: string;
  textChannelId: string;
  tracks: QueueTrack[];
}

export interface StartPlaybackResult {
  queue: MusicQueue;
  // True when the bot was idle and started playing the first added track right away.
  startedNow: boolean;
}

// Adds tracks to a guild's queue, joins the voice channel if needed and starts playback when idle.
export async function startPlayback(client: Client, options: StartPlaybackOptions): Promise<StartPlaybackResult> {
  let queue = client.queueManager.get(options.guildId);
  if (!queue) {
    queue = client.queueManager.create(options.guildId, options.textChannelId);
  }

  for (const track of options.tracks) {
    queue.add(track);
  }

  let startedNow = false;

  if (!queue.player) {
    const existingPlayer = client.shoukaku.players.get(options.guildId);
    queue.player = existingPlayer ?? await client.shoukaku.joinVoiceChannel({
      guildId: options.guildId,
      channelId: options.voiceChannelId,
      shardId: options.shardId
    });
    queue.voiceChannelId = options.voiceChannelId;
    attachPlayerEvents(client, options.guildId, queue);

    const firstTrack = queue.next();
    if (firstTrack) {
      await queue.player.playTrack({ track: { encoded: firstTrack.track.encoded } });
      startedNow = true;
    }
  }

  botEvents.emit('music', options.guildId);
  return { queue, startedNow };
}

export async function destroyQueue(client: Client, guildId: string): Promise<void> {
  const queue = client.queueManager.get(guildId);
  if (queue) {
    queue.isDestroying = true;
    queue.player?.stopTrack();
    queue.clear();
    client.queueManager.delete(guildId);
  }
  await client.shoukaku?.leaveVoiceChannel(guildId);
  botEvents.emit('music', guildId);
}

async function announce(client: Client, queue: MusicQueue, embed: EmbedBuilder): Promise<void> {
  try {
    const channel = await client.channels.fetch(queue.textChannelId);
    if (channel?.isSendable()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Failed to send now playing message:', error);
  }
}

async function playAutoplayTrack(client: Client, queue: MusicQueue, previousTrack: QueueTrack): Promise<boolean> {
  const resolved = await resolveTracks(client, previousTrack.title);
  if (!resolved || resolved.tracks.length < 2) {
    return false;
  }

  // Skip the first result, which is usually the track that just played.
  const randomIndex = Math.floor(Math.random() * (Math.min(resolved.tracks.length, 5) - 1)) + 1;
  const track = resolved.tracks[randomIndex];
  const queueTrack = toQueueTrack(track, 'Autoplay');

  queue.current = queueTrack;
  queue.addToHistory(queueTrack);
  await queue.player!.playTrack({ track: { encoded: track.encoded } });

  await announce(client, queue, new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🔁 Autoplay')
    .setDescription(`**[${track.info.title}](${track.info.uri})**`)
    .addFields({ name: 'Duration', value: formatDuration(track.info.length), inline: true })
    .setThumbnail(track.info.artworkUrl || null));

  return true;
}

// Attempts to find a playable alternative stream (e.g. SoundCloud or yt-dlp) when a track fails mid-playback.
async function tryFallbackPlayback(client: Client, queue: MusicQueue, failedTrack: QueueTrack): Promise<boolean> {
  const node = client.shoukaku?.getIdealNode();
  if (!node || !queue.player) return false;

  const author = failedTrack.track.info.author;
  const searchQuery = author && !failedTrack.title.toLowerCase().includes(author.toLowerCase())
    ? `${author} - ${failedTrack.title}`
    : failedTrack.title;

  // Try SoundCloud search first if YouTube failed, or YouTube Music if SoundCloud failed
  const failedSource = (failedTrack.track.info.sourceName || '').toLowerCase();
  const fallbackPrefixes = failedSource.includes('soundcloud')
    ? ['ytmsearch:', 'ytsearch:']
    : ['scsearch:', 'ytsearch:'];

  const fallbackResolved = await resolveBySearchChain(node, searchQuery, fallbackPrefixes);
  const candidate = fallbackResolved?.tracks.find(t => t.info.identifier !== failedTrack.track.info.identifier);

  if (candidate) {
    const recoveredTrack: QueueTrack = {
      track: candidate,
      requestedBy: failedTrack.requestedBy,
      requestedById: failedTrack.requestedById,
      title: failedTrack.title || candidate.info.title,
      uri: failedTrack.uri || candidate.info.uri || '',
      duration: candidate.info.length || failedTrack.duration
    };
    queue.current = recoveredTrack;
    await queue.player.playTrack({ track: { encoded: candidate.encoded } });
    return true;
  }

  // Last resort: try yt-dlp direct stream extraction on the track URI
  if (failedTrack.uri && isHttpUrl(failedTrack.uri)) {
    const ytdlpResolved = await resolveWithYtDlpFallback(node, failedTrack.uri);
    const ytdlpTrack = ytdlpResolved?.tracks[0];
    if (ytdlpTrack) {
      queue.current = {
        track: ytdlpTrack,
        requestedBy: failedTrack.requestedBy,
        requestedById: failedTrack.requestedById,
        title: failedTrack.title,
        uri: failedTrack.uri,
        duration: ytdlpTrack.info.length || failedTrack.duration
      };
      await queue.player.playTrack({ track: { encoded: ytdlpTrack.encoded } });
      return true;
    }
  }

  return false;
}

export function attachPlayerEvents(client: Client, guildId: string, queue: MusicQueue): void {
  const player = queue.player;
  if (!player) return;

  player.removeAllListeners('end');
  player.removeAllListeners('exception');
  player.removeAllListeners('start');

  const retriedTracks = new Set<string>();

  player.on('start', () => {
    if (queue.current) client.musicHistory.record(guildId, queue.current);
    botEvents.emit('music', guildId);
  });

  player.on('end', async (event) => {
    // "replaced" fires when /previous, /jump or the panel start another track directly,
    // and "cleanup" when the player is destroyed. Neither should advance the queue.
    if (queue.isDestroying || event.reason === 'replaced' || event.reason === 'cleanup') {
      return;
    }

    const previousTrack = queue.current;

    // Automatic fallback if a track failed to load/stream (e.g. YouTube client block)
    if (event.reason === 'loadFailed' && previousTrack) {
      const retryKey = `${previousTrack.uri}|${previousTrack.title}`;
      if (!retriedTracks.has(retryKey)) {
        retriedTracks.add(retryKey);
        try {
          console.warn(`⚠️ Track load failed for "${previousTrack.title}", attempting fallback source...`);
          if (await tryFallbackPlayback(client, queue, previousTrack)) {
            console.log(`✅ Recovered playback for "${previousTrack.title}" via fallback source`);
            return;
          }
        } catch (fallbackErr) {
          console.error('Fallback playback attempt failed:', fallbackErr);
        }
      }
    }

    const nextTrack = queue.next();

    try {
      if (nextTrack) {
        await player.playTrack({ track: { encoded: nextTrack.track.encoded } });

        await announce(client, queue, new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎵 Now Playing')
          .setDescription(`**[${nextTrack.title}](${nextTrack.uri})**`)
          .addFields(
            { name: 'Duration', value: formatDuration(nextTrack.duration), inline: true },
            { name: 'Requested by', value: nextTrack.requestedBy, inline: true }
          )
          .setThumbnail(nextTrack.track.info.artworkUrl || null));
        return;
      }

      if (queue.autoplay && previousTrack && await playAutoplayTrack(client, queue, previousTrack)) {
        return;
      }
    } catch (error) {
      console.error('❌ Failed to continue playback:', error);
    }

    console.log(`👋 Queue finished in guild ${guildId}, leaving voice channel`);
    await destroyQueue(client, guildId);
  });

  player.on('exception', (data) => {
    console.error('Player exception:', data.exception?.message ?? data);
  });
}
