import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LogEntry, Overview } from './types';

interface LiveState {
  connected: boolean;
  overview: Overview | null;
  logs: LogEntry[];
}

const LiveContext = createContext<LiveState>({ connected: false, overview: null, logs: [] });

const MAX_LOGS = 1000;

// Keeps one Server-Sent Events connection to the bot open for the whole panel:
// live stats, new log lines and "music changed" notifications.
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>({ connected: false, overview: null, logs: [] });

  useEffect(() => {
    let cancelled = false;

    // Also called after reconnects, to fill in lines missed while disconnected.
    const loadLogs = () => {
      fetch('/api/logs', { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : []))
        .then((logs: LogEntry[]) => {
          if (!cancelled) setState(s => ({ ...s, logs: mergeLogs(logs, s.logs) }));
        })
        .catch(() => {});
    };

    const source = new EventSource('/api/events');

    source.onopen = () => {
      setState(s => ({ ...s, connected: true }));
      loadLogs();
    };
    source.onerror = () => setState(s => ({ ...s, connected: false }));

    source.addEventListener('stats', (event) => {
      const overview = JSON.parse((event as MessageEvent).data) as Overview;
      setState(s => ({ ...s, overview }));
    });

    source.addEventListener('log', (event) => {
      const entry = JSON.parse((event as MessageEvent).data) as LogEntry;
      setState(s => ({ ...s, logs: mergeLogs(s.logs, [entry]) }));
    });

    source.addEventListener('music', (event) => {
      const { guildId } = JSON.parse((event as MessageEvent).data) as { guildId: string };
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['music', guildId] });
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, [queryClient]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

function mergeLogs(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const byId = new Map<number, LogEntry>();
  for (const entry of [...a, ...b]) byId.set(entry.id, entry);
  return Array.from(byId.values()).sort((x, y) => x.id - y.id).slice(-MAX_LOGS);
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}
