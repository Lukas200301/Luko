import { Client } from 'discord.js';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, currentUser, num, str } from '../context';
import { MusicQueue, QueueTrack } from '../../utils/QueueManager';
import {
  FILTER_PRESETS,
  destroyQueue,
  formatDuration,
  isMusicAvailable,
  resolveTracks,
  startPlayback,
  toQueueTrack
} from '../../utils/MusicService';
import { botEvents } from '../../utils/botEvents';
import { MusicQueueDetail, MusicQueueSummary, SearchResult, TrackInfo } from '../../shared/types';

function trackInfo(track: QueueTrack): TrackInfo {
  return {
    title: track.title,
    author: track.track.info.author,
    uri: track.uri,
    duration: track.duration,
    artworkUrl: track.track.info.artworkUrl ?? null,
    requestedBy: track.requestedBy,
    isStream: track.track.info.isStream
  };
}

function summarize(client: Client, guildId: string, queue: MusicQueue): MusicQueueSummary {
  const guild = client.guilds.cache.get(guildId);
  const voiceChannel = guild?.members.me?.voice.channel ?? null;

  return {
    guildId,
    guildName: guild?.name ?? guildId,
    guildIconUrl: guild?.iconURL({ size: 64 }) ?? null,
    current: queue.current ? trackInfo(queue.current) : null,
    paused: queue.player?.paused ?? false,
    queueLength: queue.size(),
    voiceChannelName: voiceChannel?.name ?? null,
    listeners: voiceChannel ? voiceChannel.members.filter(m => !m.user.bot).size : 0
  };
}

function detail(client: Client, guildId: string, queue: MusicQueue): MusicQueueDetail {
  return {
    ...summarize(client, guildId, queue),
    position: queue.player?.position ?? 0,
    volume: queue.volume,
    loop: queue.loop ? 'track' : queue.queueLoop ? 'queue' : 'off',
    autoplay: queue.autoplay,
    filter: queue.filter,
    tracks: queue.tracks.map(trackInfo),
    history: [...queue.history].reverse().slice(0, 25).map(trackInfo),
    textChannelId: queue.textChannelId
  };
}

function requireMusic(client: Client): void {
  if (!isMusicAvailable(client)) {
    throw new PanelError(400, 'The music feature is disabled or needs a restart to start.');
  }
}

function getQueue(client: Client, guildId: string): MusicQueue {
  const queue = client.queueManager.get(guildId);
  if (!queue || !queue.player) {
    throw new PanelError(404, 'Nothing is playing on this server.');
  }
  return queue;
}

function checkIndex(queue: MusicQueue, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= queue.size()) {
    throw new PanelError(400, 'Invalid queue position.');
  }
}

export const registerMusicRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/music', async () => ({
    available: isMusicAvailable(client),
    restartRequired: client.settings.get().features.music && !client.shoukaku,
    filters: Object.entries(FILTER_PRESETS).map(([id, preset]) => ({ id, label: preset.label })),
    queues: client.queueManager.entries().map(([guildId, queue]) => summarize(client, guildId, queue))
  }));

  app.get('/music/search', async (request): Promise<SearchResult[]> => {
    requireMusic(client);
    const query = str((request.query as Record<string, unknown>).q, 200);
    if (query.length < 2) return [];

    const resolved = await resolveTracks(client, query);
    return (resolved?.tracks ?? []).slice(0, 10).map(track => ({
      title: track.info.title,
      author: track.info.author,
      uri: track.info.uri || '',
      duration: track.info.length,
      artworkUrl: track.info.artworkUrl ?? null
    }));
  });

  app.get('/music/:guildId', async (request) => {
    const { guildId } = request.params as { guildId: string };
    const queue = client.queueManager.get(guildId);
    return { queue: queue ? detail(client, guildId, queue) : null };
  });

  app.post('/music/:guildId/play', async (request) => {
    requireMusic(client);
    const user = currentUser(request);
    const { guildId } = request.params as { guildId: string };
    const body = bodyOf(request);
    const query = str(body.query, 500);

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new PanelError(404, 'Server not found.');
    if (!query) throw new PanelError(400, 'Enter a song name or URL.');

    const existing = client.queueManager.get(guildId);
    const voiceChannelId = existing?.voiceChannelId ?? guild.members.me?.voice.channelId ?? str(body.voiceChannelId, 30);
    const textChannelId = existing?.textChannelId ?? str(body.textChannelId, 30);

    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel?.isVoiceBased()) throw new PanelError(400, 'Choose a voice channel for the bot to join.');
    if (!textChannelId || !guild.channels.cache.get(textChannelId)?.isSendable()) {
      throw new PanelError(400, 'Choose a text channel for "Now playing" messages.');
    }

    const permissions = voiceChannel.permissionsFor(guild.members.me!);
    if (!permissions?.has(['Connect', 'Speak'])) {
      throw new PanelError(400, 'The bot cannot connect or speak in that voice channel.');
    }

    const resolved = await resolveTracks(client, query);
    if (!resolved || resolved.tracks.length === 0) {
      throw new PanelError(404, `No results found for "${query}".`);
    }

    const tracks = resolved.playlistName ? resolved.tracks : [resolved.tracks[0]];
    await startPlayback(client, {
      guildId,
      shardId: guild.shardId,
      voiceChannelId: voiceChannel.id,
      textChannelId,
      tracks: tracks.map(track => toQueueTrack(track, `${user.username} (panel)`))
    });

    const added = resolved.playlistName ? `${tracks.length} tracks from ${resolved.playlistName}` : tracks[0].info.title;
    audit(ctx, request, 'Added music', `${added} on ${guild.name}`);
    return { ok: true, added };
  });

  app.post('/music/:guildId/control', async (request) => {
    requireMusic(client);
    const { guildId } = request.params as { guildId: string };
    const body = bodyOf(request);
    const action = str(body.action, 30);
    const queue = getQueue(client, guildId);
    const player = queue.player!;
    const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;
    let details = '';

    switch (action) {
      case 'pause': {
        const paused = bool(body.value, !player.paused);
        await player.setPaused(paused);
        details = paused ? 'Paused' : 'Resumed';
        break;
      }
      case 'skip':
        details = `Skipped ${queue.current?.title ?? 'track'}`;
        await player.stopTrack();
        break;
      case 'previous': {
        const previous = queue.getPrevious();
        if (!previous) throw new PanelError(400, 'There are no previous tracks in history.');
        queue.current = previous;
        await player.playTrack({ track: { encoded: previous.track.encoded } });
        details = `Went back to ${previous.title}`;
        break;
      }
      case 'stop':
        await destroyQueue(client, guildId);
        audit(ctx, request, 'Stopped music', guildName);
        return { ok: true };
      case 'shuffle':
        queue.shuffle();
        details = 'Shuffled queue';
        break;
      case 'clear':
        details = `Cleared ${queue.size()} tracks`;
        queue.clear();
        break;
      case 'volume': {
        const volume = Math.round(num(body.value, queue.volume, 0, 200));
        await player.setGlobalVolume(volume * 5);
        queue.volume = volume;
        details = `Volume ${volume}%`;
        break;
      }
      case 'seek': {
        const position = Math.round(num(body.value, 0, 0, queue.current?.duration ?? 0));
        await player.seekTo(position);
        details = `Seeked to ${formatDuration(position)}`;
        break;
      }
      case 'loop': {
        const mode = str(body.value, 10);
        queue.loop = mode === 'track';
        queue.queueLoop = mode === 'queue';
        details = `Loop ${mode || 'off'}`;
        break;
      }
      case 'autoplay':
        queue.autoplay = bool(body.value, !queue.autoplay);
        details = `Autoplay ${queue.autoplay ? 'on' : 'off'}`;
        break;
      case 'filter': {
        const filterId = str(body.value, 30);
        const preset = FILTER_PRESETS[filterId];
        if (!preset) throw new PanelError(400, 'Unknown filter.');
        await player.setFilters(preset.filters);
        queue.filter = filterId;
        details = `Filter ${preset.label}`;
        break;
      }
      case 'remove': {
        const index = num(body.index, -1);
        checkIndex(queue, index);
        details = `Removed ${queue.remove(index)?.title}`;
        break;
      }
      case 'move': {
        const from = num(body.from, -1);
        const to = num(body.to, -1);
        checkIndex(queue, from);
        checkIndex(queue, to);
        queue.move(from, to);
        details = `Moved track ${from + 1} to ${to + 1}`;
        break;
      }
      case 'jump': {
        const index = num(body.index, -1);
        checkIndex(queue, index);
        const target = queue.jumpTo(index);
        if (target) {
          await player.playTrack({ track: { encoded: target.track.encoded } });
          details = `Jumped to ${target.title}`;
        }
        break;
      }
      default:
        throw new PanelError(400, 'Unknown action.');
    }

    botEvents.emit('music', guildId);
    audit(ctx, request, 'Music control', `${details} on ${guildName}`);
    return { ok: true };
  });
};
