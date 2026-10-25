import { RouteRegistrar, PanelError, audit, bodyOf, bool, currentUser, isSnowflake, num, str } from '../context';
import { isMusicAvailable, resolveTracks, startPlayback, toQueueTrack } from '../../utils/MusicService';
import { MAX_PLAYLIST_TRACKS } from '../../utils/PlaylistManager';
import { MusicHistoryPage, MusicStats, PlaylistDetail, PlaylistSummary, StatsRange } from '../../shared/types';

const RANGES: StatsRange[] = ['7d', '30d', '90d', '365d', 'all'];
const rangeOf = (value: unknown): StatsRange => (RANGES.includes(value as StatsRange) ? value as StatsRange : '30d');

// Music statistics, the play history and saved playlists.
export const registerLibraryRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  // ---- History and statistics ----

  app.get('/music-history/stats', async (request): Promise<MusicStats> => {
    const query = request.query as Record<string, unknown>;
    const guildId = str(query.guild, 30);
    return client.musicHistory.stats(rangeOf(query.range), isSnowflake(guildId) ? guildId : undefined);
  });

  app.get('/music-history', async (request): Promise<MusicHistoryPage> => {
    const query = request.query as Record<string, unknown>;
    const guildId = str(query.guild, 30);
    return client.musicHistory.page({
      range: rangeOf(query.range),
      guildId: isSnowflake(guildId) ? guildId : undefined,
      search: str(query.q, 100) || undefined,
      limit: Math.round(num(query.limit, 50, 1, 100)),
      offset: Math.round(num(query.offset, 0, 0, Number.MAX_SAFE_INTEGER))
    });
  });

  app.delete('/music-history', async (request) => {
    client.musicHistory.clear();
    audit(ctx, request, 'Cleared the music history');
    return { ok: true };
  });

  // ---- Playlists ----

  const getPlaylist = (id: string): PlaylistDetail => {
    const playlist = client.playlists.get(Number(id));
    if (!playlist) throw new PanelError(404, 'Playlist not found.');
    return playlist;
  };

  const wrap = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
  };

  app.get('/playlists', async (): Promise<PlaylistSummary[]> => client.playlists.list());

  app.get('/playlists/:id', async (request): Promise<PlaylistDetail> => getPlaylist((request.params as { id: string }).id));

  app.post('/playlists', async (request) => {
    const user = currentUser(request);
    const playlist = wrap(() => client.playlists.create(str(bodyOf(request).name, 60), user.id, user.username));
    audit(ctx, request, 'Created a playlist', playlist.name);
    return playlist;
  });

  app.patch('/playlists/:id', async (request) => {
    const playlist = getPlaylist((request.params as { id: string }).id);
    const body = bodyOf(request);
    if (typeof body.name === 'string') wrap(() => client.playlists.rename(playlist.id, body.name as string));
    if (Array.isArray(body.order)) client.playlists.reorder(playlist.id, body.order.map(Number).filter(Number.isInteger));
    return client.playlists.get(playlist.id);
  });

  app.delete('/playlists/:id', async (request) => {
    const playlist = getPlaylist((request.params as { id: string }).id);
    client.playlists.delete(playlist.id);
    audit(ctx, request, 'Deleted a playlist', playlist.name);
    return { ok: true };
  });

  // Adds a song by search or URL (a playlist URL adds all of its songs).
  app.post('/playlists/:id/tracks', async (request) => {
    const playlist = getPlaylist((request.params as { id: string }).id);
    if (!isMusicAvailable(client)) throw new PanelError(400, 'Songs are looked up through Lavalink, which is not available right now.');
    const query = str(bodyOf(request).query, 500);
    if (!query) throw new PanelError(400, 'Enter a song name or URL.');

    const resolved = await resolveTracks(client, query);
    if (!resolved || resolved.tracks.length === 0) throw new PanelError(404, `No results found for "${query}".`);
    const tracks = resolved.playlistName ? resolved.tracks : [resolved.tracks[0]];
    const added = client.playlists.addTracks(playlist.id, tracks);
    if (added === 0) throw new PanelError(400, `The playlist is full (${MAX_PLAYLIST_TRACKS} songs).`);
    return { added, title: resolved.playlistName ?? tracks[0].info.title, playlist: client.playlists.get(playlist.id) };
  });

  app.delete('/playlists/:id/tracks/:trackId', async (request) => {
    const { id, trackId } = request.params as { id: string; trackId: string };
    const playlist = getPlaylist(id);
    if (!client.playlists.removeTrack(playlist.id, Number(trackId))) throw new PanelError(404, 'Song not found in this playlist.');
    return client.playlists.get(playlist.id);
  });

  // Queues a playlist on a server (joining the given voice channel when nothing is playing).
  app.post('/playlists/:id/play', async (request) => {
    if (!isMusicAvailable(client)) throw new PanelError(400, 'The music feature is disabled or needs a restart to start.');
    const user = currentUser(request);
    const playlist = getPlaylist((request.params as { id: string }).id);
    const body = bodyOf(request);
    const guild = client.guilds.cache.get(str(body.guildId, 30));
    if (!guild) throw new PanelError(404, 'Server not found.');

    const existing = client.queueManager.get(guild.id);
    const voiceChannelId = existing?.voiceChannelId ?? guild.members.me?.voice.channelId ?? str(body.voiceChannelId, 30);
    const textChannelId = existing?.textChannelId ?? str(body.textChannelId, 30);
    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel?.isVoiceBased()) throw new PanelError(400, 'Choose a voice channel for the bot to join.');
    if (!textChannelId || !guild.channels.cache.get(textChannelId)?.isSendable()) throw new PanelError(400, 'Choose a text channel for "Now playing" messages.');
    if (!voiceChannel.permissionsFor(guild.members.me!)?.has(['Connect', 'Speak'])) throw new PanelError(400, 'The bot cannot connect or speak in that voice channel.');

    let tracks = client.playlists.loadTracks(playlist.id);
    if (tracks.length === 0) throw new PanelError(400, 'This playlist has no songs yet.');
    if (bool(body.shuffle, false)) tracks = tracks.map(t => ({ t, k: Math.random() })).sort((a, b) => a.k - b.k).map(x => x.t);

    await startPlayback(client, {
      guildId: guild.id,
      shardId: guild.shardId,
      voiceChannelId: voiceChannel.id,
      textChannelId,
      tracks: tracks.map(track => toQueueTrack(track, `${user.username} (panel)`, user.id))
    });
    audit(ctx, request, 'Played a playlist', `${playlist.name} on ${guild.name}`);
    return { ok: true, added: tracks.length, joined: !existing };
  });
};
