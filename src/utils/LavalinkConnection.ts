import { Client } from 'discord.js';
import { Connectors, NodeOption, Shoukaku } from 'shoukaku';
import { botEvents } from './botEvents';

// Delays (seconds) between attempts to bring a lost Lavalink node back. The last one repeats forever.
const RETRY_DELAYS = [5, 10, 20, 30, 60];

let retryTimer: NodeJS.Timeout | null = null;
let retryAttempt = 0;
let outageSince: number | null = null;
let connectionErrorLogged = false;

function nodeOption(client: Client): NodeOption {
  const { name, host, port, secure } = client.settings.get().lavalink;
  return { name, url: `${host}:${port}`, auth: process.env.LAVALINK_PASSWORD || '', secure };
}

function isConnectionRefused(error: unknown): boolean {
  const text = String((error as { code?: string })?.code ?? '') + String((error as Error)?.message ?? error);
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|closed before a connection/i.test(text);
}

// Music sessions on a lost node can't continue: Lavalink forgets its players when it restarts.
async function dropSessions(client: Client, nodeName: string): Promise<void> {
  for (const [guildId, queue] of client.queueManager.entries()) {
    if (queue.player && queue.player.node.name !== nodeName) continue;

    queue.isDestroying = true;
    client.queueManager.delete(guildId);
    await client.shoukaku.leaveVoiceChannel(guildId).catch(() => {});
    botEvents.emit('music', guildId);

    try {
      const channel = await client.channels.fetch(queue.textChannelId);
      if (channel?.isSendable()) {
        await channel.send('⚠️ The music stopped because the connection to the music server was lost. Use `/play` again in a moment.');
      }
    } catch {
      // The channel may be gone; nothing else to do.
    }
  }
}

function scheduleRetry(client: Client, shoukaku: Shoukaku): void {
  if (retryTimer) return;

  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
  retryAttempt++;
  console.warn(`🔌 Lavalink is unreachable. Trying again in ${delay}s (attempt ${retryAttempt}).`);

  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!client.settings.get().features.music) return;

    // Shoukaku removes a node from its pool after giving up; add it back to start over.
    const option = nodeOption(client);
    if (!shoukaku.nodes.has(option.name)) {
      shoukaku.addNode(option);
    }
  }, delay * 1000);
}

function resetRetries(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

// Creates the Shoukaku client and keeps it connected: when Lavalink is down (not started yet,
// restarting, updating), the node is added back again and again until Lavalink answers.
export function createShoukaku(client: Client): Shoukaku {
  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [nodeOption(client)], {
    moveOnDisconnect: false,
    resume: false,
    resumeTimeout: 30,
    reconnectTries: 3,
    reconnectInterval: 5,
    restTimeout: 10000
  });

  shoukaku.on('ready', (name, reconnected) => {
    if (outageSince) {
      console.log(`🎵 Lavalink node "${name}" is back after ${Math.round((Date.now() - outageSince) / 1000)}s.`);
    } else {
      console.log(`🎵 Lavalink node "${name}" is ${reconnected ? 'reconnected' : 'ready'}!`);
    }
    outageSince = null;
    connectionErrorLogged = false;
    resetRetries();
  });

  shoukaku.on('error', (name, error) => {
    // While Lavalink is down every attempt fails the same way; log that only once per outage.
    if (isConnectionRefused(error)) {
      if (connectionErrorLogged) return;
      connectionErrorLogged = true;
      console.error(`❌ Can't reach Lavalink node "${name}": ${(error as Error)?.message ?? error}`);
      return;
    }
    console.error(`❌ Lavalink node "${name}" error:`, error);
  });

  shoukaku.on('close', (name, code, reason) => {
    if (!outageSince) {
      console.warn(`⚠️ Lavalink node "${name}" closed with code ${code}${reason ? `. Reason: ${reason}` : ''}`);
    }
  });

  // When Shoukaku gives up on a node it silently removes it from its pool (the node's
  // "disconnect" event is not forwarded to the manager), so check for a missing node instead.
  setInterval(() => {
    if (!client.isReady() || !client.settings.get().features.music) return;

    const name = client.settings.get().lavalink.name;
    if (shoukaku.nodes.has(name)) return;

    if (!outageSince) {
      outageSince = Date.now();
      console.warn(`⚠️ Lost the connection to Lavalink node "${name}".`);
      void dropSessions(client, name);
    }
    scheduleRetry(client, shoukaku);
  }, 5000).unref();

  return shoukaku;
}

// Re-creates the Lavalink connection with the current settings (used by the admin panel).
export function reconnectLavalink(client: Client): boolean {
  if (!client.shoukaku) return false;

  resetRetries();
  for (const name of Array.from(client.shoukaku.nodes.keys())) {
    client.shoukaku.removeNode(name, 'Reconnecting from the admin panel');
  }

  const option = nodeOption(client);
  client.shoukaku.addNode(option);
  console.log(`🔄 Reconnecting to Lavalink at ${option.url}`);
  return true;
}
