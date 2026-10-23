import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { LogEntry, LogLevel } from '../shared/types';

const MAX_ENTRIES = 1000;

// Mirrors everything written to console.log/warn/error into a ring buffer,
// so the admin panel can show (and live-stream) the bot's logs.
class LogManager extends EventEmitter {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private installed = false;

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const wrap = (level: LogLevel, original: (...args: unknown[]) => void) => {
      return (...args: unknown[]) => {
        original(...args);
        this.add(level, args);
      };
    };

    console.log = wrap('info', console.log.bind(console));
    console.info = wrap('info', console.info.bind(console));
    console.warn = wrap('warn', console.warn.bind(console));
    console.error = wrap('error', console.error.bind(console));
  }

  private add(level: LogLevel, args: unknown[]): void {
    const message = args
      .map(arg => typeof arg === 'string' ? arg : inspect(arg, { depth: 3, breakLength: 120 }))
      .join(' ');

    const entry: LogEntry = { id: this.nextId++, t: Date.now(), level, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
    this.emit('entry', entry);
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }

  getRecentErrors(limit: number): LogEntry[] {
    return this.entries.filter(e => e.level === 'error').slice(-limit).reverse();
  }
}

export const logManager = new LogManager();
