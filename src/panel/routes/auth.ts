import * as crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { RouteRegistrar, PanelContext, bodyOf, str } from '../context';
import { SESSION_COOKIE, SESSION_TTL_MS, STATE_COOKIE } from '../auth';
import { getLanUrls } from '../network';
import { AuthConfig } from '../../shared/types';

function baseUrl(ctx: PanelContext, request: FastifyRequest): string {
  const publicUrl = ctx.client.settings.get().panel.publicUrl.replace(/\/+$/, '');
  return publicUrl || `${request.protocol}://${request.host}`;
}

function cookieOptions(ctx: PanelContext, request: FastifyRequest, maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: baseUrl(ctx, request).startsWith('https://'),
    maxAge: maxAgeSeconds
  };
}

function finishLogin(ctx: PanelContext, request: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, request, SESSION_TTL_MS / 1000));
}

export const registerAuthRoutes: RouteRegistrar = (app, ctx) => {
  app.get('/api/auth/config', async (request): Promise<AuthConfig> => {
    const user = ctx.client.user;
    return {
      discord: ctx.auth.discordEnabled,
      password: ctx.auth.passwordEnabled,
      mode: ctx.mode,
      publicUrl: ctx.client.settings.get().panel.publicUrl,
      lanUrls: getLanUrls(ctx.port),
      redirectUri: `${baseUrl(ctx, request)}/auth/callback`,
      botName: user?.username ?? 'Luko',
      botAvatarUrl: user?.displayAvatarURL({ size: 128 }) ?? null
    };
  });

  app.get('/api/auth/me', async (request) => {
    return { user: ctx.auth.getSession(request.cookies[SESSION_COOKIE]) };
  });

  app.post('/api/auth/password', async (request, reply) => {
    if (!ctx.auth.passwordEnabled) {
      return reply.code(400).send({ error: 'Password login is not enabled. Set PANEL_PASSWORD in .env.' });
    }

    if (ctx.auth.isRateLimited(request.ip)) {
      return reply.code(429).send({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    const password = str(bodyOf(request).password, 500);
    if (!ctx.auth.verifyPassword(password)) {
      ctx.auth.recordFailedLogin(request.ip);
      console.warn(`⚠️ Failed panel password login from ${request.ip}`);
      return reply.code(401).send({ error: 'Wrong password' });
    }

    const token = ctx.auth.createSession({
      id: process.env.OWNER_ID || 'password',
      username: 'Owner (password)',
      avatarUrl: null,
      role: 'owner',
      method: 'password'
    });
    finishLogin(ctx, request, reply, token);
    ctx.client.auditLog.add({ userId: process.env.OWNER_ID || 'password', username: 'Owner (password)', action: 'Logged in with password' });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    ctx.auth.destroySession(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Discord OAuth2: step 1, send the user to Discord's consent screen.
  app.get('/auth/discord', async (request, reply) => {
    if (!ctx.auth.discordEnabled) {
      return reply.redirect('/login?error=discord_disabled');
    }

    const state = crypto.randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, cookieOptions(ctx, request, 600));

    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID!,
      response_type: 'code',
      scope: 'identify',
      redirect_uri: `${baseUrl(ctx, request)}/auth/callback`,
      state,
      prompt: 'none'
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  // Discord OAuth2: step 2, Discord redirects back here with a code.
  app.get('/auth/callback', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const expectedState = request.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/' });

    if (query.error) {
      return reply.redirect('/login?error=cancelled');
    }

    if (!query.code || !query.state || !expectedState || query.state !== expectedState) {
      return reply.redirect('/login?error=state');
    }

    try {
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID!,
          client_secret: process.env.DISCORD_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          code: query.code,
          redirect_uri: `${baseUrl(ctx, request)}/auth/callback`
        })
      });

      if (!tokenResponse.ok) {
        console.error('❌ Discord OAuth token exchange failed:', tokenResponse.status, await tokenResponse.text());
        return reply.redirect('/login?error=oauth');
      }

      const { access_token: accessToken } = await tokenResponse.json() as { access_token: string };
      const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userResponse.ok) {
        return reply.redirect('/login?error=oauth');
      }

      const discordUser = await userResponse.json() as { id: string; username: string; global_name?: string; avatar?: string };
      const role = ctx.auth.getRole(discordUser.id);

      if (!role) {
        console.warn(`⚠️ Panel login denied for ${discordUser.username} (${discordUser.id}): not on the admin list`);
        return reply.redirect('/login?error=forbidden');
      }

      const username = discordUser.global_name || discordUser.username;
      const token = ctx.auth.createSession({
        id: discordUser.id,
        username,
        avatarUrl: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128` : null,
        role,
        method: 'discord'
      });

      finishLogin(ctx, request, reply, token);
      ctx.client.auditLog.add({ userId: discordUser.id, username, action: 'Logged in with Discord' });
      return reply.redirect('/');
    } catch (error) {
      console.error('❌ Discord OAuth login failed:', error);
      return reply.redirect('/login?error=oauth');
    }
  });
};
