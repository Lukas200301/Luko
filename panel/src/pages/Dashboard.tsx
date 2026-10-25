import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Bell, Cake, Clock, Cpu, Gauge, HardDrive, MemoryStick, Music, Pin, Server, Terminal, Thermometer, Users, Vote, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { cn, formatBytes, formatNumber, formatUptime, timeAgo } from '../lib/utils';
import type { Overview } from '../lib/types';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, PageLoader, StatusDot } from '../components/ui';

function StatCard({ icon, label, value, hint, to }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const content = (
    <Card className={cn('p-4 transition', to && 'hover:border-accent/40')}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="rounded-lg bg-accent/10 p-1.5 text-accent">{icon}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function MetricRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="flex items-center gap-2 text-muted">{icon}{label}</span>
      <span className="text-right font-medium whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

const MetricsChart = lazy(() => import('../components/MetricsChart').then(m => ({ default: m.MetricsChart })));

export function DashboardPage() {
  const live = useLive();
  const { data: fetched } = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/api/overview'),
    enabled: !live.overview
  });
  const overview = live.overview ?? fetched;

  if (!overview) return <PageLoader />;

  const { bot, counts, process: proc } = overview;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Live overview of your bot" />

      {!bot.ready && (
        <Notice tone="danger" title="The bot is not connected to Discord">
          The panel is running, but the bot is not logged in. Check the logs for login errors (for example an invalid DISCORD_TOKEN).
        </Notice>
      )}
      {overview.maintenance && (
        <Notice tone="warning" title="Maintenance mode is on">
          No commands can be used right now. Everyone who tries gets your maintenance message. Turn it off on the <Link className="text-accent underline" to="/presence">Presence</Link> page.
        </Notice>
      )}
      {overview.musicRestartRequired && (
        <Notice tone="warning" title="Restart needed for music">
          Music was enabled in the settings, but the music system only starts when the bot starts. Restart the bot to use music.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Server className="size-4" />} label="Servers" value={formatNumber(counts.guilds)} to="/servers" />
        <StatCard icon={<Users className="size-4" />} label="Users" value={formatNumber(counts.users)} hint="Across all servers" />
        <StatCard icon={<Music className="size-4" />} label="Active queues" value={counts.activeQueues} to="/music" hint={overview.musicAvailable ? 'Music enabled' : 'Music disabled'} />
        <StatCard icon={<Zap className="size-4" />} label="Commands today" value={formatNumber(counts.commandsToday)} to="/logs" hint={`${counts.commands} commands loaded`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><Suspense fallback={<Card className="h-80"><PageLoader /></Card>}><MetricsChart /></Suspense></div>

        <Card>
          <CardHeader title="Bot status" icon={<Gauge className="size-4" />} actions={<Badge tone={bot.ready ? 'success' : 'danger'}>{bot.ready ? 'Online' : 'Offline'}</Badge>} />
          <CardBody className="divide-y divide-border py-2">
            <MetricRow icon={<Clock className="size-4" />} label="Uptime" value={formatUptime(bot.uptime)} />
            <MetricRow icon={<Activity className="size-4" />} label="Websocket ping" value={bot.ping >= 0 ? `${bot.ping} ms` : '—'} />
            <MetricRow icon={<MemoryStick className="size-4" />} label="Memory (RSS)" value={formatBytes(proc.memoryRss)} />
            <MetricRow icon={<MemoryStick className="size-4" />} label="Heap" value={`${formatBytes(proc.heapUsed)} / ${formatBytes(proc.heapTotal)}`} />
            <MetricRow icon={<Cpu className="size-4" />} label="CPU" value={`${proc.cpuPercent}%`} />
            {overview.host.cpuTemp !== null && (
              <MetricRow
                icon={<Thermometer className="size-4" />}
                label="CPU temperature"
                value={<span className={cn(overview.host.cpuTemp >= 75 ? 'text-danger' : overview.host.cpuTemp >= 65 && 'text-warning')}>{overview.host.cpuTemp} °C</span>}
              />
            )}
            {overview.host.diskTotal > 0 && (
              <MetricRow
                icon={<HardDrive className="size-4" />}
                label="Disk"
                value={`${formatBytes(overview.host.diskUsed)} / ${formatBytes(overview.host.diskTotal)} (${Math.round((overview.host.diskUsed / overview.host.diskTotal) * 100)}%)`}
              />
            )}
            {overview.host.load.some(n => n > 0) && (
              <MetricRow icon={<Gauge className="size-4" />} label="System load" value={overview.host.load.map(n => n.toFixed(2)).join(' · ')} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Lavalink" description="Music server nodes" icon={<Music className="size-4" />} />
          <CardBody className="space-y-3">
            {overview.lavalink.length === 0 ? (
              <p className="text-sm text-muted">{overview.features.music ? 'No nodes configured yet (restart needed).' : 'Music is disabled.'}</p>
            ) : overview.lavalink.map(node => (
              <div key={node.name} className="rounded-lg bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium"><StatusDot online={node.connected} />{node.name}</span>
                  <Badge tone={node.connected ? 'success' : 'danger'}>{node.connected ? 'Connected' : 'Disconnected'}</Badge>
                </div>
                {node.connected && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                    <div><div className="font-medium text-fg tabular-nums">{node.playingPlayers}/{node.players}</div>players</div>
                    <div><div className="font-medium text-fg tabular-nums">{(node.cpuLoad * 100).toFixed(1)}%</div>CPU</div>
                    <div><div className="font-medium text-fg tabular-nums">{formatBytes(node.memoryUsed)}</div>memory</div>
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Features" icon={<Zap className="size-4" />} actions={<Link to="/settings" className="text-xs text-accent hover:underline">Manage</Link>} />
          <CardBody className="space-y-2">
            {[
              { label: 'Music', on: overview.features.music, icon: <Music className="size-4" />, to: '/music' },
              { label: 'Pinboard', on: overview.features.pinboard, icon: <Pin className="size-4" />, to: '/pinboard', extra: `${counts.pinboardEntries} pinned` },
              { label: 'Reminders', on: overview.features.reminders, icon: <Bell className="size-4" />, to: '/reminders', extra: `${counts.reminders} pending` },
              { label: 'Birthdays', on: overview.features.birthdays, icon: <Cake className="size-4" />, to: '/birthdays' },
              { label: 'Polls', on: overview.features.polls, icon: <Vote className="size-4" />, to: '/polls' }
            ].map(feature => (
              <Link key={feature.label} to={feature.to} className="flex items-center justify-between rounded-lg px-3 py-2.5 transition hover:bg-surface-2">
                <span className="flex items-center gap-2.5 text-sm"><span className="text-muted">{feature.icon}</span>{feature.label}</span>
                <span className="flex items-center gap-2">
                  {feature.extra && <span className="text-xs text-muted">{feature.extra}</span>}
                  <Badge tone={feature.on ? 'success' : 'neutral'}>{feature.on ? 'On' : 'Off'}</Badge>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent errors" icon={<AlertTriangle className="size-4" />} actions={<Link to="/logs" className="text-xs text-accent hover:underline">All logs</Link>} />
          <CardBody>
            {overview.recentErrors.length === 0 ? (
              <EmptyState icon={<Terminal className="size-5" />} title="No errors" description="Nothing has gone wrong since the bot started." />
            ) : (
              <div className="space-y-2">
                {overview.recentErrors.map(entry => (
                  <div key={entry.id} className="rounded-lg bg-danger/8 px-3 py-2">
                    <div className="line-clamp-2 font-mono text-xs break-all">{entry.message}</div>
                    <div className="mt-1 text-[11px] text-muted">{timeAgo(entry.t)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
