import * as os from 'node:os';
import { Client, version as djsVersion } from 'discord.js';
import { Constants } from 'shoukaku';
import { RouteRegistrar, audit, requireOwner, PanelError } from '../context';
import { logManager } from '../../utils/LogManager';
import { botEvents } from '../../utils/botEvents';
import { isMusicAvailable } from '../../utils/MusicService';
import { DATABASE_PATH } from '../../utils/Database';

// package.json sits three folders up from both src/panel/routes and dist/panel/routes.
const { version: BOT_VERSION } = require('../../../package.json') as { version: string };
import { LavalinkNodeInfo, LogEntry, Overview, SystemInfo } from '../../shared/types';

function lavalinkNodes(client: Client): LavalinkNodeInfo[] {
  if (!client.shoukaku) return [];

  return Array.from(client.shoukaku.nodes.values()).map((node) => ({
    name: node.name,
    connected: node.state === Constants.State.CONNECTED,
    players: node.stats?.players ?? 0,
    playingPlayers: node.stats?.playingPlayers ?? 0,
    uptime: node.stats?.uptime ?? 0,
    cpuLoad: node.stats?.cpu?.lavalinkLoad ?? 0,
    memoryUsed: node.stats?.memory?.used ?? 0,
    memoryAllocated: node.stats?.memory?.allocated ?? 0
  }));
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function buildOverview(client: Client): Overview {
  const memory = process.memoryUsage();
  const settings = client.settings.get();

  return {
    bot: {
      ready: client.isReady(),
      tag: client.user?.tag ?? null,
      id: client.user?.id ?? null,
      avatarUrl: client.user?.displayAvatarURL({ size: 128 }) ?? null,
      ping: client.ws.ping ?? -1,
      uptime: Date.now() - client.startedAt,
      startedAt: client.startedAt
    },
    counts: {
      guilds: client.guilds.cache.size,
      users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
      commands: client.commands.size,
      activeQueues: client.queueManager.size(),
      reminders: client.reminderManager.count(),
      pinboardEntries: client.pinboardManager.size(),
      commandsToday: client.stats.countSince(startOfToday())
    },
    process: {
      memoryRss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      cpuPercent: client.stats.getCpuPercent()
    },
    features: settings.features,
    maintenance: settings.maintenance.enabled,
    musicAvailable: isMusicAvailable(client),
    musicRestartRequired: settings.features.music && !client.shoukaku,
    lavalink: lavalinkNodes(client),
    recentErrors: logManager.getRecentErrors(5)
  };
}

export const registerSystemRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/overview', async () => buildOverview(client));

  app.get('/metrics', async () => client.stats.getSamples());

  app.get('/logs', async () => logManager.getEntries());

  app.get('/audit', async () => client.auditLog.getEntries());

  app.get('/system', async (): Promise<SystemInfo> => ({
    botVersion: BOT_VERSION,
    nodeVersion: process.version,
    discordJsVersion: djsVersion,
    platform: `${os.type()} ${os.release()} (${process.arch})`,
    hostname: os.hostname(),
    pid: process.pid,
    osUptime: os.uptime() * 1000,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpuCount: os.availableParallelism(),
    pm2: process.env.pm_id !== undefined,
    startedAt: client.startedAt,
    panelMode: ctx.mode,
    panelPort: ctx.port,
    databasePath: DATABASE_PATH
  }));

  app.post('/system/restart', async (request) => {
    requireOwner(request);

    if (process.env.pm_id === undefined) {
      throw new PanelError(400, 'The bot is not running under pm2, so it cannot restart itself. Restart it manually.');
    }

    audit(ctx, request, 'Restarted the bot');
    console.log('🔄 Restart requested from the admin panel');
    setTimeout(() => process.exit(0), 750);
    return { ok: true };
  });

  // Server-Sent Events stream with live logs, stats and music updates.
  app.get('/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onLog = (entry: LogEntry) => send('log', entry);
    const onMusic = (guildId: string) => send('music', { guildId });

    logManager.on('entry', onLog);
    botEvents.on('music', onMusic);

    send('stats', buildOverview(client));
    const statsTimer = setInterval(() => send('stats', buildOverview(client)), 5000);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

    request.raw.on('close', () => {
      clearInterval(statsTimer);
      clearInterval(keepAlive);
      logManager.off('entry', onLog);
      botEvents.off('music', onMusic);
    });
  });
};
