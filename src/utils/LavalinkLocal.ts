import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Document, parseDocument } from 'yaml';
import {
  LAVALINK_SOURCES,
  LavalinkConfig,
  LavalinkLocalStatus,
  LavalinkProcessInfo,
  ResamplingQuality
} from '../shared/types';

const execFileAsync = promisify(execFile);

// The bot's folder (works from both src/utils and dist/utils).
const BOT_ROOT = path.resolve(__dirname, '..', '..');

// Lavalink installed next to the bot by scripts/setup-lavalink.(ps1|sh).
export const LAVALINK_DIR = process.env.LAVALINK_DIR ? path.resolve(process.env.LAVALINK_DIR) : path.join(BOT_ROOT, 'lavalink');
const CONFIG_PATH = path.join(LAVALINK_DIR, 'application.yml');
const ECOSYSTEM_PATH = path.join(LAVALINK_DIR, 'ecosystem.config.js');
const VERSION_PATH = path.join(LAVALINK_DIR, 'VERSION');
const PM2_BIN = path.join(BOT_ROOT, 'node_modules', 'pm2', 'bin', 'pm2');

export const DEFAULT_YOUTUBE_CLIENTS = ['MUSIC', 'WEB', 'MWEB', 'WEBEMBEDDED', 'IOS', 'ANDROID_VR', 'TVHTML5_SIMPLY', 'TV'];
export const YOUTUBE_CLIENTS = ['MUSIC', 'TV', 'TVHTML5_SIMPLY', 'WEB', 'MWEB', 'WEBEMBEDDED', 'ANDROID_VR', 'ANDROID_MUSIC', 'ANDROID', 'IOS'];

const OAUTH_CODE_PATTERN = /^(\S+).*go to (https:\/\/www\.google\.com\/device) and enter code ([A-Z0-9-]+)/i;

let updateRunning = false;

export function isInstalled(): boolean {
  return fs.existsSync(CONFIG_PATH) && fs.existsSync(path.join(LAVALINK_DIR, 'Lavalink.jar'));
}

function pm2Available(): boolean {
  return fs.existsSync(PM2_BIN);
}

async function pm2(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [PM2_BIN, ...args], {
    cwd: LAVALINK_DIR,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout;
}

// The pm2 app name and heap size, as written by the setup script.
function readEcosystem(): { name: string; memoryMB: number } {
  const text = fs.existsSync(ECOSYSTEM_PATH) ? fs.readFileSync(ECOSYSTEM_PATH, 'utf-8') : '';
  return {
    name: /name:\s*'([^']+)'/.exec(text)?.[1] ?? 'lavalink',
    memoryMB: Number(/-Xmx(\d+)M/.exec(text)?.[1] ?? 1024)
  };
}

interface Pm2App {
  name: string;
  pid: number;
  monit?: { memory: number; cpu: number };
  pm2_env?: { status: string; pm_uptime: number; restart_time: number; pm_out_log_path?: string };
}

async function findProcess(): Promise<Pm2App | null> {
  if (!pm2Available()) return null;
  try {
    // pm2 may print an "out-of-date" banner before the JSON when the daemon and CLI versions differ.
    const output = await pm2(['jlist']);
    const json = output.split(/\r?\n/).reverse().find(line => line.trim().startsWith('['));
    const apps = JSON.parse(json ?? '[]') as Pm2App[];
    return apps.find(app => app.name === readEcosystem().name) ?? null;
  } catch {
    return null;
  }
}

export async function getStatus(): Promise<LavalinkLocalStatus> {
  const installed = isInstalled();
  let processInfo: LavalinkProcessInfo | null = null;

  if (installed) {
    const app = await findProcess();
    if (app) {
      const online = app.pm2_env?.status === 'online';
      processInfo = {
        name: app.name,
        status: app.pm2_env?.status ?? 'unknown',
        pid: app.pid || null,
        uptime: online && app.pm2_env?.pm_uptime ? Date.now() - app.pm2_env.pm_uptime : null,
        restarts: app.pm2_env?.restart_time ?? 0,
        memory: app.monit?.memory ?? 0,
        cpu: app.monit?.cpu ?? 0
      };
    }
  }

  return {
    installed,
    dir: LAVALINK_DIR,
    version: fs.existsSync(VERSION_PATH) ? fs.readFileSync(VERSION_PATH, 'utf-8').trim() : null,
    pm2Available: pm2Available(),
    process: processInfo,
    updateRunning
  };
}

export async function controlProcess(action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (!isInstalled()) throw new Error('Lavalink is not installed next to the bot. Run scripts/setup-lavalink first.');
  if (!pm2Available()) throw new Error('pm2 is not installed. Run npm install in the bot folder.');

  const { name } = readEcosystem();
  if (action === 'start' || (action === 'restart' && !(await findProcess()))) {
    await pm2(['start', ECOSYSTEM_PATH]);
  } else {
    await pm2([action, name]);
  }
  await pm2(['save']).catch(() => {});
}

// ---------- Logs ----------

async function logPath(): Promise<string | null> {
  const app = await findProcess();
  const pm2Log = app?.pm2_env?.pm_out_log_path;
  if (pm2Log && fs.existsSync(pm2Log)) return pm2Log;
  const springLog = path.join(LAVALINK_DIR, 'logs', 'spring.log');
  return fs.existsSync(springLog) ? springLog : null;
}

export async function tailLog(maxLines = 300): Promise<string[]> {
  const file = await logPath();
  if (!file) return [];

  const size = fs.statSync(file).size;
  const length = Math.min(size, 512 * 1024);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }

  const lines = buffer.toString('utf-8').split(/\r?\n/).filter(Boolean);
  if (length < size) lines.shift(); // first line is probably cut off
  return lines.slice(-maxLines);
}

// The latest "go to google.com/device and enter code …" message from the YouTube plugin.
export async function findOauthCode(): Promise<{ code: string; url: string; at: number | null } | null> {
  const lines = await tailLog(2000);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = OAUTH_CODE_PATTERN.exec(lines[i]);
    if (match) {
      const at = Date.parse(match[1]);
      return { code: match[3], url: match[2], at: Number.isNaN(at) ? null : at };
    }
  }
  return null;
}

// ---------- Config ----------

function loadDocument(): Document {
  if (!isInstalled()) throw new Error('Lavalink is not installed next to the bot.');
  const doc = parseDocument(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (doc.errors.length > 0) throw new Error(`application.yml is invalid: ${doc.errors[0].message}`);
  return doc;
}

function saveDocument(doc: Document): void {
  fs.writeFileSync(CONFIG_PATH, doc.toString({ lineWidth: 0 }), 'utf-8');
}

function get<T>(doc: Document, keys: string[], fallback: T): T {
  const value = doc.getIn(keys);
  return (value === undefined || value === null ? fallback : (typeof value === 'object' && 'toJSON' in (value as object) ? (value as { toJSON(): unknown }).toJSON() : value)) as T;
}

export function readConfig(): LavalinkConfig {
  const doc = loadDocument();
  const sources = Object.fromEntries(
    LAVALINK_SOURCES.map(source => [source, get(doc, ['lavalink', 'server', 'sources', source], false)])
  ) as LavalinkConfig['sources'];

  return {
    port: get(doc, ['server', 'port'], 2333),
    memoryMB: readEcosystem().memoryMB,
    sources,
    youtube: {
      enabled: get(doc, ['plugins', 'youtube', 'enabled'], false),
      clients: get<string[]>(doc, ['plugins', 'youtube', 'clients'], DEFAULT_YOUTUBE_CLIENTS),
      oauthEnabled: get(doc, ['plugins', 'youtube', 'oauth', 'enabled'], false),
      hasRefreshToken: !!get(doc, ['plugins', 'youtube', 'oauth', 'refreshToken'], ''),
      remoteCipherUrl: get(doc, ['plugins', 'youtube', 'remoteCipher', 'url'], ''),
      remoteCipherPassword: get(doc, ['plugins', 'youtube', 'remoteCipher', 'password'], '')
    },
    bufferDurationMs: get(doc, ['lavalink', 'server', 'bufferDurationMs'], 400),
    opusEncodingQuality: get(doc, ['lavalink', 'server', 'opusEncodingQuality'], 10),
    resamplingQuality: get<ResamplingQuality>(doc, ['lavalink', 'server', 'resamplingQuality'], 'LOW'),
    youtubePlaylistLoadLimit: get(doc, ['lavalink', 'server', 'youtubePlaylistLoadLimit'], 6),
    trackStuckThresholdMs: get(doc, ['lavalink', 'server', 'trackStuckThresholdMs'], 10000)
  };
}

// Writes the given settings into application.yml, keeping everything else (and comments) as is.
export function writeConfig(config: LavalinkConfig, refreshToken?: string | null): void {
  const doc = loadDocument();

  doc.setIn(['server', 'port'], config.port);
  for (const source of LAVALINK_SOURCES) {
    doc.setIn(['lavalink', 'server', 'sources', source], config.sources[source]);
  }
  // The plugin replaces Lavalink's deprecated built-in YouTube source.
  doc.setIn(['lavalink', 'server', 'sources', 'youtube'], false);

  const clients = [...config.youtube.clients];
  if (config.youtube.oauthEnabled && !clients.includes('TV')) {
    // OAuth only works through the TV client.
    clients.splice(clients[0] === 'MUSIC' ? 1 : 0, 0, 'TV');
  }

  doc.setIn(['plugins', 'youtube', 'enabled'], config.youtube.enabled);
  doc.setIn(['plugins', 'youtube', 'clients'], doc.createNode(clients, { flow: true }));
  doc.setIn(['plugins', 'youtube', 'oauth', 'enabled'], config.youtube.oauthEnabled);

  if (doc.getIn(['plugins', 'youtube', 'clientOptions', 'WEB', 'playback']) === false) {
    doc.setIn(['plugins', 'youtube', 'clientOptions', 'WEB', 'playback'], true);
  }
  if (doc.getIn(['plugins', 'youtube', 'clientOptions', 'MWEB', 'playback']) === false) {
    doc.setIn(['plugins', 'youtube', 'clientOptions', 'MWEB', 'playback'], true);
  }

  if (refreshToken === null) {
    doc.deleteIn(['plugins', 'youtube', 'oauth', 'refreshToken']);
    doc.deleteIn(['plugins', 'youtube', 'oauth', 'skipInitialization']);
  } else if (refreshToken) {
    doc.setIn(['plugins', 'youtube', 'oauth', 'refreshToken'], refreshToken);
    doc.setIn(['plugins', 'youtube', 'oauth', 'skipInitialization'], true);
  }

  if (config.youtube.remoteCipherUrl) {
    doc.setIn(['plugins', 'youtube', 'remoteCipher', 'url'], config.youtube.remoteCipherUrl);
    if (config.youtube.remoteCipherPassword) {
      doc.setIn(['plugins', 'youtube', 'remoteCipher', 'password'], config.youtube.remoteCipherPassword);
    } else {
      doc.deleteIn(['plugins', 'youtube', 'remoteCipher', 'password']);
    }
    doc.setIn(['plugins', 'youtube', 'remoteCipher', 'userAgent'], 'luko');
  } else {
    doc.deleteIn(['plugins', 'youtube', 'remoteCipher']);
  }

  doc.setIn(['lavalink', 'server', 'bufferDurationMs'], config.bufferDurationMs);
  doc.setIn(['lavalink', 'server', 'opusEncodingQuality'], config.opusEncodingQuality);
  doc.setIn(['lavalink', 'server', 'resamplingQuality'], config.resamplingQuality);
  doc.setIn(['lavalink', 'server', 'youtubePlaylistLoadLimit'], config.youtubePlaylistLoadLimit);
  doc.setIn(['lavalink', 'server', 'trackStuckThresholdMs'], config.trackStuckThresholdMs);

  saveDocument(doc);
  setMemory(config.memoryMB);
}

function setMemory(memoryMB: number): void {
  if (!fs.existsSync(ECOSYSTEM_PATH)) return;
  const text = fs.readFileSync(ECOSYSTEM_PATH, 'utf-8');
  fs.writeFileSync(ECOSYSTEM_PATH, text.replace(/-Xmx\d+M/, `-Xmx${memoryMB}M`), 'utf-8');
}

export function readRawConfig(): string {
  if (!isInstalled()) throw new Error('Lavalink is not installed next to the bot.');
  return fs.readFileSync(CONFIG_PATH, 'utf-8');
}

export function writeRawConfig(text: string): void {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  if (!doc.getIn(['lavalink', 'server', 'password'])) throw new Error('lavalink.server.password is missing.');
  fs.writeFileSync(CONFIG_PATH, text, 'utf-8');
}

export function readPassword(): string | null {
  try {
    return String(loadDocument().getIn(['lavalink', 'server', 'password']) ?? '') || null;
  } catch {
    return null;
  }
}

// ---------- Update ----------

// Runs the setup script again (downloads the newest Lavalink and YouTube plugin, then restarts).
// Its output goes to the bot's log, which the panel shows live.
export function runUpdate(): void {
  if (updateRunning) throw new Error('An update is already running.');

  const scripts = path.join(BOT_ROOT, 'scripts');
  const { name, memoryMB } = readEcosystem();
  const [command, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'setup-lavalink.ps1'), '-InstallDir', LAVALINK_DIR, '-Name', name, '-MemoryMB', String(memoryMB)]]
    : ['bash', [path.join(scripts, 'setup-lavalink.sh'), '--dir', LAVALINK_DIR, '--name', name, '--memory', String(memoryMB)]];

  updateRunning = true;
  console.log('🔄 [lavalink] Updating Lavalink with the setup script…');

  const child = spawn(command, args, { cwd: BOT_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const forward = (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/)) {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      if (clean.trim()) console.log(`[lavalink] ${clean}`);
    }
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);

  // 'exit' (not 'close'): pm2 may keep the output pipes open after the script is done.
  child.on('exit', (code) => {
    updateRunning = false;
    if (code === 0) console.log('✅ [lavalink] Update finished.');
    else console.error(`❌ [lavalink] Update failed (exit code ${code}). See the lines above.`);
  });
  child.on('error', (error) => {
    updateRunning = false;
    console.error('❌ [lavalink] Could not run the setup script:', error);
  });
}
