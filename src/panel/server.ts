import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'discord.js';
import Fastify, { FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { PanelAuth, SESSION_COOKIE } from './auth';
import { PanelContext } from './context';
import { getLanUrls, isPrivateAddress } from './network';
import { registerAuthRoutes } from './routes/auth';
import { registerSystemRoutes } from './routes/system';
import { registerMusicRoutes } from './routes/music';
import { registerGuildRoutes } from './routes/guilds';
import { registerCommandRoutes } from './routes/commands';
import { registerCommunityRoutes } from './routes/community';
import { registerSettingsRoutes } from './routes/settings';
import { registerEmojiRoutes } from './routes/emojis';
import { registerLavalinkRoutes } from './routes/lavalink';

// The built React app (npm run build:panel) lives here, both under tsx and in dist/.
const UI_DIR = path.resolve(__dirname, '..', '..', 'dist', 'panel-ui');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function startPanel(client: Client): Promise<void> {
  const panelSettings = client.settings.get().panel;
  const mode = panelSettings.publicUrl ? 'domain' : 'local';

  const app = Fastify({
    // Behind a reverse proxy (domain mode) the real client IP and protocol come from X-Forwarded-* headers.
    trustProxy: mode === 'domain',
    bodyLimit: 1024 * 1024
  });

  const ctx: PanelContext = { client, auth: new PanelAuth(client), mode, port: panelSettings.port };

  await app.register(fastifyCookie);
  app.decorateRequest('panelUser', null);

  app.addHook('onRequest', async (request, reply) => {
    // Without a domain the panel is meant for the local network only.
    if (mode === 'local' && !isPrivateAddress(request.ip)) {
      return reply.code(403).type('text/plain').send('The Luko admin panel is only reachable from the local network.');
    }

    // Custom header check against cross-site request forgery: browsers never add it on
    // cross-origin form posts, and we don't allow CORS.
    if (MUTATING_METHODS.has(request.method) && request.url.startsWith('/api/') && request.headers['x-luko-panel'] !== '1') {
      return reply.code(403).send({ error: 'Missing panel request header' });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      console.error(`❌ Panel error on ${request.method} ${request.url}:`, error);
    }
    reply.code(status).send({ error: error.message || 'Something went wrong' });
  });

  registerAuthRoutes(app, ctx);

  await app.register(async (api) => {
    api.addHook('preHandler', async (request, reply) => {
      request.panelUser = ctx.auth.getSession(request.cookies[SESSION_COOKIE]);
      if (!request.panelUser) {
        return reply.code(401).send({ error: 'Not logged in' });
      }
    });

    registerSystemRoutes(api, ctx);
    registerMusicRoutes(api, ctx);
    registerGuildRoutes(api, ctx);
    registerCommandRoutes(api, ctx);
    registerCommunityRoutes(api, ctx);
    registerSettingsRoutes(api, ctx);
    registerEmojiRoutes(api, ctx);
    registerLavalinkRoutes(api, ctx);
  }, { prefix: '/api' });

  const uiBuilt = fs.existsSync(path.join(UI_DIR, 'index.html'));

  if (uiBuilt) {
    // wildcard mode looks files up on each request, so a rebuilt panel is served without a restart.
    await app.register(fastifyStatic, { root: UI_DIR, wildcard: true });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!uiBuilt) {
      return reply.type('text/html').send(
        '<h1>Luko admin panel</h1><p>The panel UI has not been built yet. Run <code>npm run build</code> and restart the bot.</p>'
      );
    }
    // Single-page app: let the React router handle every other path.
    return reply.type('text/html').sendFile('index.html');
  });

  await app.listen({ host: panelSettings.host, port: panelSettings.port });

  if (mode === 'domain') {
    console.log(`🖥️ Admin panel running at ${panelSettings.publicUrl} (listening on port ${panelSettings.port})`);
  } else {
    console.log(`🖥️ Admin panel running in local mode on port ${panelSettings.port}`);
    for (const url of getLanUrls(panelSettings.port)) {
      console.log(`   → ${url}`);
    }
  }

  if (!ctx.auth.discordEnabled && !ctx.auth.passwordEnabled) {
    console.warn('⚠️ No panel login method is configured. Set DISCORD_CLIENT_SECRET and/or PANEL_PASSWORD in .env.');
  }
}
