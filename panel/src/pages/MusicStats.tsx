import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Clock, Disc3, History, Mic2, Music2, Search, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import { cn, formatDuration, formatNumber, timeAgo } from '../lib/utils';
import type { MusicHistoryPage, MusicStats, StatsRange } from '../lib/types';
import { Button, Card, CardBody, CardHeader, EmptyState, Input, Notice, PageHeader, PageLoader, Tabs, useConfirm, useToast } from '../components/ui';
import { GuildSelect } from '../components/pickers';
import { Artwork } from '../components/MusicParts';

const TimelineChart = lazy(() => import('../components/TimelineChart').then(m => ({ default: m.TimelineChart })));

const RANGES: { value: StatsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: 'Year' },
  { value: 'all', label: 'All time' }
];
const PAGE_SIZE = 50;

function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(ms / 60_000)} min`;
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">{label}<span className="rounded-lg bg-accent/10 p-1.5 text-accent">{icon}</span></div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
    </Card>
  );
}

// A ranked list with bars relative to the first entry.
function Ranked<T>({ title, icon, items, render }: { title: string; icon: ReactNode; items: T[]; render: (item: T) => { key: string; label: ReactNode; plays: number } }) {
  const max = Math.max(1, ...items.map(i => render(i).plays));
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <CardBody className="space-y-1 p-3">
        {items.length === 0 ? <p className="px-2 py-4 text-center text-xs text-muted">Nothing played in this time range</p> : items.map((item, i) => {
          const row = render(item);
          return (
            <div key={row.key} className="relative overflow-hidden rounded-lg px-3 py-2">
              <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${(row.plays / max) * 100}%` }} />
              <span className="relative flex items-center gap-3 text-sm">
                <span className="w-4 text-xs text-muted tabular-nums">{i + 1}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2">{row.label}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{row.plays}×</span>
              </span>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function HourChart({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour);
  return (
    <div className="flex h-32 items-end gap-0.5">
      {byHour.map((plays, hour) => (
        <div key={hour} className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${String(hour).padStart(2, '0')}:00 · ${plays} plays`}>
          <div className="flex w-full flex-1 items-end">
            <div className="w-full rounded-t bg-accent/70 transition group-hover:bg-accent" style={{ height: `${Math.max(2, (plays / max) * 100)}%` }} />
          </div>
          <span className={cn('text-[9px] text-muted tabular-nums', hour % 6 !== 0 && 'invisible')}>{hour}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryList({ range, guildId }: { range: StatsRange; guildId: string }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ range, limit: String(PAGE_SIZE) });
  if (guildId) params.set('guild', guildId);
  if (debounced) params.set('q', debounced);

  const history = useInfiniteQuery({
    queryKey: ['music-history', params.toString()],
    queryFn: ({ pageParam }) => api.get<MusicHistoryPage>(`/api/music-history?${params}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.plays.length < last.total ? last.offset + last.plays.length : undefined)
  });
  const plays = history.data?.pages.flatMap(p => p.plays) ?? [];
  const total = history.data?.pages[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader
        title={`History · ${formatNumber(total)}`}
        icon={<History className="size-4" />}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Song, artist or person…" className="h-8 w-56 pl-8 text-xs" />
          </div>
        }
      />
      {history.isLoading ? <PageLoader /> : plays.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title={debounced ? 'Nothing matches' : 'Nothing played yet'} />
      ) : (
        <>
          <div className={cn('divide-y divide-border transition-opacity', history.isFetching && !history.isFetchingNextPage && 'opacity-60')}>
            {plays.map(play => (
              <div key={play.id} className="flex items-center gap-3 px-5 py-2.5">
                <Artwork src={play.artworkUrl} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{play.uri ? <a href={play.uri} target="_blank" rel="noreferrer" className="hover:underline">{play.title}</a> : play.title}</div>
                  <div className="truncate text-xs text-muted">{play.author ?? 'Unknown artist'} · {formatDuration(play.duration)}{play.guildName && !guildId ? ` · ${play.guildName}` : ''}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  <div>{play.requestedBy ?? '—'}</div>
                  <div>{timeAgo(play.playedAt)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
            <span className="text-muted">Showing {plays.length.toLocaleString()} of {total.toLocaleString()}</span>
            {history.hasNextPage
              ? <Button variant="secondary" onClick={() => history.fetchNextPage()} loading={history.isFetchingNextPage}>Load more</Button>
              : <span className="text-xs text-muted">All loaded</span>}
          </div>
        </>
      )}
    </Card>
  );
}

export function MusicStatsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: settingsData } = useSettings();
  const [range, setRange] = useState<StatsRange>('30d');
  const [guildId, setGuildId] = useState('');

  const { data: stats, isError, error } = useQuery({
    queryKey: ['music-stats', range, guildId],
    queryFn: () => api.get<MusicStats>(`/api/music-history/stats?range=${range}${guildId ? `&guild=${guildId}` : ''}`)
  });

  const clear = useMutation({
    mutationFn: () => api.delete('/api/music-history'),
    onSuccess: () => {
      toast.success('Music history cleared');
      queryClient.invalidateQueries({ queryKey: ['music-stats'] });
      queryClient.invalidateQueries({ queryKey: ['music-history'] });
    },
    onError: (e) => toast.error(e)
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Music stats"
        description="What gets played, by whom and when"
        actions={
          <>
            <GuildSelect value={guildId} onChange={setGuildId} placeholder="All servers" className="w-48" />
            <Tabs value={range} onChange={setRange} tabs={RANGES} />
          </>
        }
      />

      {settingsData && !settingsData.settings.features.musicHistory && (
        <Notice tone="warning" title="The music history is switched off">New songs aren't recorded. Turn it on in <Link className="text-accent underline" to="/settings">Settings</Link>.</Notice>
      )}

      {isError ? (
        <Notice tone="danger" title="Couldn't load the statistics">{error instanceof Error ? error.message : 'Unknown error'}</Notice>
      ) : !stats ? <Card><PageLoader /></Card> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={<Music2 className="size-4" />} label="Songs played" value={formatNumber(stats.plays)} />
            <StatCard icon={<Clock className="size-4" />} label="Listening time" value={hours(stats.listeningTime)} />
            <StatCard icon={<Disc3 className="size-4" />} label="Different songs" value={formatNumber(stats.uniqueTracks)} />
            <StatCard icon={<Users className="size-4" />} label="People requesting" value={formatNumber(stats.uniqueRequesters)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Songs over time" icon={<BarChart3 className="size-4" />} />
              <CardBody className="h-64">
                {stats.plays === 0
                  ? <EmptyState icon={<BarChart3 className="size-5" />} title="Nothing played in this time range" />
                  : <Suspense fallback={<PageLoader />}><TimelineChart data={stats.timeline} dataKey="plays" name="Songs" /></Suspense>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Time of day" description="Server time" icon={<Clock className="size-4" />} />
              <CardBody><HourChart byHour={stats.byHour} /></CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Ranked
              title="Top songs"
              icon={<Music2 className="size-4" />}
              items={stats.topTracks}
              render={(t) => ({
                key: t.uri ?? t.title,
                plays: t.plays,
                label: <><Artwork src={t.artworkUrl} className="size-7" /><span className="min-w-0"><span className="block truncate">{t.title}</span><span className="block truncate text-xs text-muted">{t.author}</span></span></>
              })}
            />
            <Ranked title="Top artists" icon={<Mic2 className="size-4" />} items={stats.topArtists} render={(a) => ({ key: a.author, plays: a.plays, label: <span className="truncate">{a.author}</span> })} />
            <Ranked title="Top listeners" icon={<Users className="size-4" />} items={stats.topRequesters} render={(r) => ({ key: r.userId ?? r.name, plays: r.plays, label: <span className="truncate">{r.name.replace(/ \(panel\)$/, '')}</span> })} />
          </div>
        </>
      )}

      <HistoryList range={range} guildId={guildId} />

      <div className="flex justify-end">
        <Button
          variant="ghost"
          className="text-danger hover:text-danger"
          onClick={async () => {
            if (await confirm({ title: 'Clear the whole music history?', description: 'All recorded plays and these statistics are deleted. Playlists stay.', confirmLabel: 'Clear history', danger: true })) clear.mutate();
          }}
        >
          <Trash2 className="size-4" />Clear history
        </Button>
      </div>
    </div>
  );
}
