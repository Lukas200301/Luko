import { Client } from 'discord.js';
import { Constants, LoadType, Node } from 'shoukaku';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, num, requireOwner, str, strList } from '../context';
import * as local from '../../utils/LavalinkLocal';
import { reconnectLavalink } from '../../utils/LavalinkConnection';
import {
  ClientTestResult,
  LAVALINK_SOURCES,
  LavalinkConfig,
  LavalinkNodeDetail,
  LavalinkOverview,
  ResamplingQuality,
  YoutubeAuthStatus
} from '../../shared/types';

const STATE_NAMES: Record<number, string> = {
  [Constants.State.CONNECTING]: 'connecting',
  [Constants.State.CONNECTED]: 'connected',
  [Constants.State.DISCONNECTING]: 'disconnecting',
  [Constants.State.DISCONNECTED]: 'disconnected'
};

const infoCache = new Map<string, { at: number; info: LavalinkNodeDetail['info'] }>();

function baseUrl(client: Client): string {
  const { host, port, secure } = client.settings.get().lavalink;
  return `${secure ? 'https' : 'http'}://${host}:${port}`;
}

function lavalinkPassword(): string {
  return process.env.LAVALINK_PASSWORD || local.readPassword() || '';
}

// Lavalink's /v4/info rarely changes, so it is cached for a minute per node.
async function nodeInfo(node: Node): Promise<LavalinkNodeDetail['info']> {
  const cached = infoCache.get(node.name);
  if (cached && Date.now() - cached.at < 60_000) return cached.info;

  const raw = node.state === Constants.State.CONNECTED ? await node.rest.getLavalinkInfo().catch(() => undefined) : undefined;
  const info = raw ? {
    version: raw.version.semver,
    buildTime: raw.buildTime,
    jvm: raw.jvm,
    lavaplayer: raw.lavaplayer,
    sourceManagers: raw.sourceManagers,
    filters: raw.filters,
    plugins: raw.plugins.map(p => ({ name: p.name, version: p.version }))
  } : null;

  infoCache.set(node.name, { at: Date.now(), info });
  return info;
}

async function nodeDetails(client: Client): Promise<LavalinkNodeDetail[]> {
  if (!client.shoukaku) return [];

  return Promise.all(Array.from(client.shoukaku.nodes.values()).map(async (node) => {
    const stats = node.stats;
    return {
      name: node.name,
      connected: node.state === Constants.State.CONNECTED,
      state: STATE_NAMES[node.state] ?? 'unknown',
      stats: stats ? {
        players: stats.players,
        playingPlayers: stats.playingPlayers,
        uptime: stats.uptime,
        cpu: { cores: stats.cpu.cores, systemLoad: stats.cpu.systemLoad, lavalinkLoad: stats.cpu.lavalinkLoad },
        memory: { used: stats.memory.used, free: stats.memory.free, allocated: stats.memory.allocated, reservable: stats.memory.reservable },
        frameStats: stats.frameStats ? { sent: stats.frameStats.sent, nulled: stats.frameStats.nulled, deficit: stats.frameStats.deficit } : null
      } : null,
      info: await nodeInfo(node)
    };
  }));
}

function sanitizeConfig(input: Record<string, unknown>, current: LavalinkConfig): LavalinkConfig {
  const sourcesInput = (typeof input.sources === 'object' && input.sources !== null ? input.sources : {}) as Record<string, unknown>;
  const youtubeInput = (typeof input.youtube === 'object' && input.youtube !== null ? input.youtube : {}) as Record<string, unknown>;
  const clients = Array.isArray(youtubeInput.clients)
    ? strList(youtubeInput.clients, 20).filter(c => local.YOUTUBE_CLIENTS.includes(c))
    : current.youtube.clients;
  const cipherUrl = str(youtubeInput.remoteCipherUrl, 300);
  if (cipherUrl && !/^https?:\/\//.test(cipherUrl)) throw new PanelError(400, 'The cipher server URL must start with http:// or https://');

  return {
    port: Math.round(num(input.port, current.port, 1, 65535)),
    memoryMB: Math.round(num(input.memoryMB, current.memoryMB, 256, 32768)),
    sources: Object.fromEntries(LAVALINK_SOURCES.map(s => [s, bool(sourcesInput[s], current.sources[s])])) as LavalinkConfig['sources'],
    youtube: {
      enabled: bool(youtubeInput.enabled, current.youtube.enabled),
      clients: clients.length > 0 ? Array.from(new Set(clients)) : local.DEFAULT_YOUTUBE_CLIENTS,
      oauthEnabled: bool(youtubeInput.oauthEnabled, current.youtube.oauthEnabled),
      hasRefreshToken: current.youtube.hasRefreshToken,
      remoteCipherUrl: cipherUrl,
      remoteCipherPassword: str(youtubeInput.remoteCipherPassword, 200)
    },
    bufferDurationMs: Math.round(num(input.bufferDurationMs, current.bufferDurationMs, 100, 10000)),
    opusEncodingQuality: Math.round(num(input.opusEncodingQuality, current.opusEncodingQuality, 0, 10)),
    resamplingQuality: (['LOW', 'MEDIUM', 'HIGH'] as ResamplingQuality[]).includes(input.resamplingQuality as ResamplingQuality)
      ? input.resamplingQuality as ResamplingQuality
      : current.resamplingQuality,
    youtubePlaylistLoadLimit: Math.round(num(input.youtubePlaylistLoadLimit, current.youtubePlaylistLoadLimit, 1, 100)),
    trackStuckThresholdMs: Math.round(num(input.trackStuckThresholdMs, current.trackStuckThresholdMs, 1000, 60000))
  };
}

async function pluginRefreshToken(client: Client): Promise<string | null | undefined> {
  try {
    const response = await fetch(`${baseUrl(client)}/youtube`, { headers: { Authorization: lavalinkPassword() }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const body = await response.json() as { refreshToken?: string | null };
    return body.refreshToken ?? null;
  } catch {
    return undefined;
  }
}

export const registerLavalinkRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/lavalink', async (): Promise<LavalinkOverview> => {
    const settings = client.settings.get();
    return {
      musicEnabled: settings.features.music,
      restartRequired: settings.features.music && !client.shoukaku,
      connection: settings.lavalink,
      baseUrl: baseUrl(client),
      nodes: await nodeDetails(client),
      local: await local.getStatus()
    };
  });

  app.post('/lavalink/reconnect', async (request) => {
    if (!reconnectLavalink(client)) throw new PanelError(400, 'Music is not running. Turn it on in Settings and restart the bot.');
    audit(ctx, request, 'Reconnected to Lavalink');
    return { ok: true };
  });

  // ---- Local install (lavalink/ next to the bot) ----

  app.post('/lavalink/local/:action', async (request) => {
    requireOwner(request);
    const { action } = request.params as { action: string };

    if (action === 'update') {
      try {
        local.runUpdate();
      } catch (error) {
        throw new PanelError(400, error instanceof Error ? error.message : String(error));
      }
      audit(ctx, request, 'Started Lavalink update');
      return { ok: true };
    }

    if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new PanelError(400, 'Unknown action.');
    try {
      await local.controlProcess(action);
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
    audit(ctx, request, { start: 'Started Lavalink', stop: 'Stopped Lavalink', restart: 'Restarted Lavalink' }[action]);
    return { ok: true };
  });

  app.get('/lavalink/local/logs', async (request) => {
    const lines = Math.round(num((request.query as Record<string, unknown>).lines, 300, 10, 2000));
    return { lines: await local.tailLog(lines) };
  });

  app.get('/lavalink/local/config', async () => {
    try {
      return { config: local.readConfig(), raw: local.readRawConfig(), clients: local.YOUTUBE_CLIENTS };
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
  });

  app.put('/lavalink/local/config', async (request) => {
    requireOwner(request);
    try {
      const config = sanitizeConfig(bodyOf(request), local.readConfig());
      local.writeConfig(config);
    } catch (error) {
      if (error instanceof PanelError) throw error;
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
    audit(ctx, request, 'Changed Lavalink config');
    return { ok: true, config: local.readConfig() };
  });

  app.put('/lavalink/local/config/raw', async (request) => {
    requireOwner(request);
    const text = typeof bodyOf(request).yaml === 'string' ? bodyOf(request).yaml as string : '';
    try {
      local.writeRawConfig(text);
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
    audit(ctx, request, 'Edited Lavalink application.yml');
    return { ok: true };
  });

  // ---- YouTube ----

  app.get('/lavalink/youtube/auth', async (): Promise<YoutubeAuthStatus> => {
    const config = local.isInstalled() ? local.readConfig() : null;
    const code = config?.youtube.oauthEnabled && !config.youtube.hasRefreshToken ? await local.findOauthCode() : null;
    const token = await pluginRefreshToken(client);
    return {
      oauthEnabled: !!config?.youtube.oauthEnabled,
      deviceCode: code?.code ?? null,
      verificationUrl: code?.url ?? null,
      codeShownAt: code?.at ?? null,
      tokenStored: !!config?.youtube.hasRefreshToken,
      tokenActive: token === undefined ? null : !!token
    };
  });

  // After signing in at google.com/device the plugin holds a refresh token. Saving it in
  // application.yml keeps the sign-in across Lavalink restarts.
  app.post('/lavalink/youtube/save-token', async (request) => {
    requireOwner(request);
    const token = await pluginRefreshToken(client);
    if (!token) throw new PanelError(400, 'Lavalink has no YouTube sign-in yet. Finish the sign-in at google.com/device first.');
    local.writeConfig({ ...local.readConfig(), youtube: { ...local.readConfig().youtube, oauthEnabled: true } }, token);
    audit(ctx, request, 'Saved YouTube sign-in for Lavalink');
    return { ok: true };
  });

  app.post('/lavalink/youtube/sign-out', async (request) => {
    requireOwner(request);
    const config = local.readConfig();
    local.writeConfig({ ...config, youtube: { ...config.youtube, oauthEnabled: false, clients: config.youtube.clients.filter(c => c !== 'TV') } }, null);
    audit(ctx, request, 'Removed YouTube sign-in from Lavalink');
    return { ok: true };
  });

  // Tries to stream a YouTube Music search result with each client, to show which ones work.
  app.post('/lavalink/youtube/test', async (): Promise<{ track: string; results: ClientTestResult[] }> => {
    const node = client.shoukaku?.getIdealNode();
    if (!node) throw new PanelError(400, 'Lavalink is not connected.');

    const search = await node.rest.resolve('ytmsearch:never gonna give you up');
    if (!search || search.loadType !== LoadType.SEARCH || search.data.length === 0) {
      throw new PanelError(400, 'YouTube Music search failed, so there is nothing to test playback with.');
    }
    const track = search.data[0].info;

    const clients = local.isInstalled()
      ? local.readConfig().youtube.clients.filter(c => c !== 'MUSIC')
      : local.DEFAULT_YOUTUBE_CLIENTS.filter(c => c !== 'MUSIC');

    const results = await Promise.all(clients.map(async (name): Promise<ClientTestResult> => {
      try {
        const response = await fetch(`${baseUrl(client)}/youtube/stream/${track.identifier}?withClient=${name}`, {
          headers: { Authorization: lavalinkPassword(), Range: 'bytes=0-1023' },
          signal: AbortSignal.timeout(30_000)
        });
        if (response.ok) {
          await response.body?.cancel();
          return { client: name, ok: true, status: response.status, message: 'Can play' };
        }
        const body = await response.json().catch(() => ({})) as { message?: string };
        return { client: name, ok: false, status: response.status, message: body.message ?? response.statusText };
      } catch (error) {
        return { client: name, ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
      }
    }));

    return { track: `${track.title} - ${track.author}`, results };
  });
};
