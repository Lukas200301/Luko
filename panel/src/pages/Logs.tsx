import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, CheckCircle2, Download, History, Search, ShieldCheck, Terminal, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { cn, formatDateTime, formatTime, timeAgo } from '../lib/utils';
import type { AuditEntry, CommandUsageEntry, LogLevel } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Tabs } from '../components/ui';

type Tab = 'console' | 'commands' | 'audit';

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'text-fg/85',
  warn: 'text-warning',
  error: 'text-danger'
};

function ConsoleLogs() {
  const { logs, connected } = useLive();
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return logs.filter(entry => (level === 'all' || entry.level === level) && (!q || entry.message.toLowerCase().includes(q)));
  }, [logs, level, filter]);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, follow]);

  const download = () => {
    const text = filtered.map(e => `[${new Date(e.t).toISOString()}] ${e.level.toUpperCase()} ${e.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `luko-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">Console {connected && <Badge tone="success">Live</Badge>}</span>}
        description="The last 1000 lines the bot printed since it started"
        icon={<Terminal className="size-4" />}
        actions={
          <>
            <Tabs
              value={level}
              onChange={setLevel}
              tabs={[{ value: 'all', label: 'All' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors' }]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-8 w-44 pl-8 text-xs" />
            </div>
            <Button size="sm" variant={follow ? 'secondary' : 'ghost'} onClick={() => setFollow(!follow)} title="Auto-scroll to new lines">
              <ArrowDownToLine className="size-3.5" />Follow
            </Button>
            <Button size="sm" variant="ghost" onClick={download}><Download className="size-3.5" />Download</Button>
          </>
        }
      />
      <div
        ref={scrollRef}
        onWheel={(e) => { if (e.deltaY < 0) setFollow(false); }}
        className="scrollbar-thin h-[60vh] overflow-y-auto bg-surface-2/40 px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-muted">No log lines</div>
        ) : filtered.map(entry => (
          <div key={entry.id} className={cn('flex gap-3 border-b border-border/40 py-0.5', LEVEL_STYLE[entry.level])}>
            <span className="shrink-0 text-muted tabular-nums">{formatTime(entry.t)}</span>
            <span className="break-all whitespace-pre-wrap">{entry.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CommandHistory() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['command-history'],
    queryFn: () => api.get<CommandUsageEntry[]>('/api/commands/history'),
    refetchInterval: 10_000
  });

  if (isLoading) return <PageLoader />;

  return (
    <Card>
      <CardHeader title="Command usage" description="The last 300 slash commands people ran" icon={<History className="size-4" />} />
      {data.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="No commands used yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Command</th>
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-5 py-2.5 font-medium">Server</th>
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((entry, index) => (
                <tr key={`${entry.t}-${index}`} className="hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 font-mono">/{entry.command}</td>
                  <td className="px-5 py-2.5">{entry.userTag}</td>
                  <td className="px-5 py-2.5 text-muted">{entry.guildName ?? 'Direct message'}</td>
                  <td className="px-5 py-2.5 text-muted" title={formatDateTime(entry.t)}>{timeAgo(entry.t)}</td>
                  <td className="px-5 py-2.5">
                    {entry.success
                      ? <Badge tone="success"><CheckCircle2 className="size-3" />OK</Badge>
                      : <Badge tone="danger"><XCircle className="size-3" />Error</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AuditLog() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<AuditEntry[]>('/api/audit'),
    refetchInterval: 15_000
  });

  if (isLoading) return <PageLoader />;

  return (
    <Card>
      <CardHeader title="Panel activity" description="Every change made through this admin panel" icon={<ShieldCheck className="size-4" />} />
      {data.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="No panel activity yet" />
      ) : (
        <div className="divide-y divide-border">
          {data.map((entry, index) => (
            <div key={`${entry.t}-${index}`} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm"><span className="font-medium">{entry.username}</span> <span className="text-muted">·</span> {entry.action}</div>
                {entry.details && <div className="mt-0.5 truncate text-xs text-muted">{entry.details}</div>}
              </div>
              <div className="shrink-0 text-xs text-muted" title={formatDateTime(entry.t)}>{timeAgo(entry.t)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('console');

  return (
    <div>
      <PageHeader
        title="Logs & Activity"
        description="Console output, command usage and panel changes"
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'console', label: 'Console' }, { value: 'commands', label: 'Command usage' }, { value: 'audit', label: 'Panel activity' }]} />}
      />
      {tab === 'console' && <ConsoleLogs />}
      {tab === 'commands' && <CommandHistory />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}
