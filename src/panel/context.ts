import { Client } from 'discord.js';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { PanelAuth } from './auth';
import { PanelUser } from '../shared/types';

declare module 'fastify' {
  interface FastifyRequest {
    panelUser: PanelUser | null;
  }
}

export interface PanelContext {
  client: Client;
  auth: PanelAuth;
  mode: 'local' | 'domain';
  port: number;
}

export type RouteRegistrar = (app: FastifyInstance, ctx: PanelContext) => void;

export class PanelError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function currentUser(request: FastifyRequest): PanelUser {
  if (!request.panelUser) {
    throw new PanelError(401, 'Not logged in');
  }
  return request.panelUser;
}

export function requireOwner(request: FastifyRequest): PanelUser {
  const user = currentUser(request);
  if (user.role !== 'owner') {
    throw new PanelError(403, 'Only the bot owner can do this');
  }
  return user;
}

export function audit(ctx: PanelContext, request: FastifyRequest, action: string, details?: string): void {
  const user = currentUser(request);
  ctx.client.auditLog.add({ userId: user.id, username: user.username, action, details });
}

// Small helpers for reading untrusted JSON request bodies.
export function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

export function str(value: unknown, maxLength = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function strList(value: unknown, maxItems = 100): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, maxItems)
    : [];
}

export function isSnowflake(value: string): boolean {
  return /^\d{15,25}$/.test(value);
}
