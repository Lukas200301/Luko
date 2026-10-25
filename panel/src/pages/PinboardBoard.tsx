import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Download, Hash, Pin, RotateCw, Search, Send, Smile, Trophy, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { avatarUrl, rememberMentions } from '../lib/discord';
import { cn } from '../lib/utils';
import type {
  DiscordMentions,
  PinboardBoardStatus,
  PinboardEntry,
  PinboardEntryPage,
  PinboardRange,
  PinboardSort,
  PinboardStats
} from '../lib/types';
import {
  Avatar,
  Button,
  Dialog,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  Spinner,
  Tabs,
  useToast
} from '../components/ui';
import { EmojiPreview, emojiName } from '../components/EmojiPicker';
import { EntryAvatar, EntryCard, EntryDialog, EntrySkeletons } from '../components/PinboardEntries';
import { DiscordText } from '../components/DiscordText';
import { PinboardStatsPostDialog } from '../components/PinboardStatsPostDialog';

const TimelineChart = lazy(() => import('../components/TimelineChart').then(m => ({ default: m.TimelineChart })));

const PAGE_SIZE = 25;

const RANGES: { value: PinboardRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: 'Year' },
  { value: 'all', label: 'All time' }
];

const SORTS: { value: PinboardSort; label: string }[] = [
  { value: 'newest', label: 'Newest pins' },
  { value: 'oldest', label: 'Oldest pins' },
  { value: 'reactions', label: 'Most reactions' },
  { value: 'message', label: 'Newest messages' }
];

interface Filters {
  emoji?: { key: string; display: string };
}

// An author or channel whose pins are shown in a window.
type PinsTarget =
  | { kind: 'author'; key: string; name: string; avatarUrl: string | null }
  | { kind: 'channel'; id: string; name: string };

interface Overview {
  boards: PinboardBoardStatus[];
  mentions: DiscordMentions;
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

// A ranked list where every row can be clicked.
function Ranking<T>({ title, icon, description, items, empty, render, isActive, onPick }: {
  title: string;
  icon: ReactNode;
  description: string;
  items: T[];
  empty: string;
  render: (item: T) => { key: string; label: ReactNode; pins: number; reactions: number };
  isActive?: (item: T) => boolean;
  onPick: (item: T) => void;
}) {
  const max = Math.max(1, ...items.map(i => render(i).pins));
  return (
    <Card>
      <CardHeader title={title} icon={icon} description={description} />
      <CardBody className="space-y-1 p-3">
        {items.length === 0 ? <p className="px-2 py-4 text-center text-xs text-muted">{empty}</p> : items.map(item => {
          const row = render(item);
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onPick(item)}
              className={cn('relative w-full overflow-hidden rounded-lg px-3 py-2 text-left transition hover:bg-surface-2', isActive?.(item) && 'ring-2 ring-accent')}
            >
              <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${(row.pins / max) * 100}%` }} />
              <span className="relative flex items-center gap-3 text-sm">
                <span className="flex min-w-0 flex-1 items-center gap-2">{row.label}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{row.pins} pins · {row.reactions} reactions</span>
              </span>
            </button>
          );
        })}
      </CardBody>
    </Card>
  );
}

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Pages through a board's pins with the given filters; every page carries the names for its mentions.
function useEntryPages(boardId: string, params: URLSearchParams, scope = 'list') {
  return useInfiniteQuery({
    queryKey: ['pinboard-entries', boardId, scope, params.toString()],
    queryFn: ({ pageParam }) => api.get<PinboardEntryPage>(`/api/pinboard/boards/${boardId}/entries?${params}&offset=${pageParam}`).then(rememberMentions),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.entries.length < last.total ? last.offset + last.entries.length : undefined)
  });
}

// Grid of pin cards with loading, error and empty states and a "load more" footer.
function EntryGrid({ entries, board, empty, onOpen, columns = 'sm:grid-cols-2 xl:grid-cols-3' }: {
  entries: ReturnType<typeof useEntryPages>;
  board?: PinboardBoardStatus;
  empty: { title: string; description?: string };
  onOpen: (entry: PinboardEntry) => void;
  columns?: string;
}) {
  const list = entries.data?.pages.flatMap(p => p.entries) ?? [];
  const total = entries.data?.pages[0]?.total ?? 0;

  if (entries.isError) {
    return (
      <div className="p-5">
        <Notice tone="danger" title="Couldn't load the pinned messages">
          {entries.error instanceof Error ? entries.error.message : 'Unknown error'}
          <span className="mt-2 block"><Button size="sm" variant="secondary" onClick={() => entries.refetch()}><RotateCw className="size-3.5" />Try again</Button></span>
        </Notice>
      </div>
    );
  }
  if (entries.isLoading) return <div className={cn('grid gap-4 p-5', columns)}><EntrySkeletons count={6} /></div>;
  if (list.length === 0) return <EmptyState icon={<Pin className="size-5" />} title={empty.title} description={empty.description} />;

  return (
    <>
      <div className={cn('grid gap-4 p-5 transition-opacity', columns, entries.isFetching && !entries.isFetchingNextPage && 'opacity-60')}>
        {list.map(entry => <EntryCard key={entry.originalMessageId} entry={entry} board={board} onOpen={onOpen} />)}
        {entries.isFetchingNextPage && <EntrySkeletons count={3} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
        <span className="text-muted">Showing {list.length.toLocaleString()} of {total.toLocaleString()}</span>
        {entries.hasNextPage ? (
          <Button variant="secondary" onClick={() => entries.fetchNextPage()} loading={entries.isFetchingNextPage}>
            {entries.isFetchingNextPage ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, total - list.length)} more`}
          </Button>
        ) : (
          <span className="text-xs text-muted">All loaded</span>
        )}
      </div>
    </>
  );
}

// All pins of one author or one channel, with their own time range, sorting and search.
function PinsDialog({ target, board, boardId, initialRange, onClose, onOpen }: {
  target: PinsTarget;
  board?: PinboardBoardStatus;
  boardId: string;
  initialRange: PinboardRange;
  onClose: () => void;
  onOpen: (entry: PinboardEntry) => void;
}) {
  const [range, setRange] = useState(initialRange);
  const [sort, setSort] = useState<PinboardSort>('newest');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);

  const params = new URLSearchParams({ range, sort, limit: String(PAGE_SIZE) });
  if (target.kind === 'author') params.set('author', target.key);
  else params.set('channel', target.id);
  if (debouncedSearch) params.set('q', debouncedSearch);

  const entries = useEntryPages(boardId, params, 'dialog');
  const pins = entries.data?.pages[0]?.total;
  const authorId = target.kind === 'author' && !target.key.startsWith('name:') ? target.key : undefined;
  const rangeLabel = RANGES.find(r => r.value === range)?.label.toLowerCase();

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2.5">
          {target.kind === 'author'
            ? <Avatar src={avatarUrl(authorId, board?.guildId)} fallbackSrc={target.avatarUrl} name={target.name} className="size-8" />
            : <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent"><Hash className="size-4" /></span>}
          {target.kind === 'channel' ? `#${target.name}` : target.name}
        </span>
      }
      description={pins === undefined ? 'Loading pins…' : `${pins.toLocaleString()} ${pins === 1 ? 'pin' : 'pins'} · ${range === 'all' ? 'all time' : `last ${rangeLabel}`}`}
    >
      <div className="-mx-5 -my-4">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface px-5 py-3">
          <Tabs value={range} onChange={setRange} tabs={RANGES} />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-8 w-40 pl-8 text-xs" />
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value as PinboardSort)} className="h-8 w-40 text-xs">
            {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <EntryGrid
          entries={entries}
          board={board}
          onOpen={onOpen}
          columns="sm:grid-cols-2 lg:grid-cols-3"
          empty={{ title: 'No pins match', description: debouncedSearch || range !== 'all' ? 'Try another time range or search.' : undefined }}
        />
      </div>
    </Dialog>
  );
}

function BackfillNotice({ stats, board, onRefresh }: { stats: PinboardStats; board?: PinboardBoardStatus; onRefresh: () => void }) {
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.post(`/api/pinboard/boards/${board?.id}/backfill`),
    onSuccess: onRefresh,
    onError: (error) => toast.error(error)
  });
  const { pending, running, done, total } = stats.backfill;
  if (!running && pending === 0) return null;

  if (running) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2"><Spinner className="size-4" />Loading older pins from Discord… they're stored once, then everything is instant.</span>
          <span className="text-xs text-muted tabular-nums">{done.toLocaleString()} / {total.toLocaleString()}</span>
        </div>
        <div className="h-2 rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
      </Card>
    );
  }

  return (
    <Notice tone="warning" title={`${pending.toLocaleString()} older pins are missing their full message`}>
      {board?.botInGuild === false
        ? "The running bot isn't in this server, so they can't be read from Discord."
        : 'They will be read from the pinboard posts. Statistics for them may be incomplete until then.'}
      {board?.botInGuild !== false && (
        <span className="mt-2 block"><Button size="sm" variant="secondary" onClick={() => start.mutate()} loading={start.isPending}><Download className="size-3.5" />Load them now</Button></span>
      )}
    </Notice>
  );
}

export function PinboardBoardPage() {
  const { boardId = '' } = useParams();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<PinboardRange>('all');
  const [sort, setSort] = useState<PinboardSort>('newest');
  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [chartMetric, setChartMetric] = useState<'pins' | 'reactions'>('pins');
  const [opened, setOpened] = useState<PinboardEntry | null>(null);
  const [pinsOf, setPinsOf] = useState<PinsTarget | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data: overview } = useQuery({ queryKey: ['pinboard'], queryFn: () => api.get<Overview>('/api/pinboard').then(rememberMentions) });
  const board = overview?.boards.find(b => b.id === boardId);

  const stats = useQuery({
    queryKey: ['pinboard-stats', boardId, range],
    queryFn: () => api.get<PinboardStats>(`/api/pinboard/boards/${boardId}/stats?range=${range}`).then(rememberMentions),
    // While older pins are being loaded, refresh to show the progress.
    refetchInterval: (q) => (q.state.data?.backfill.running ? 2000 : false)
  });

  // When the background loading finishes, the stored data changed: reload the list too.
  const backfillRunning = stats.data?.backfill.running;
  useEffect(() => {
    if (backfillRunning === false) queryClient.invalidateQueries({ queryKey: ['pinboard-entries', boardId] });
  }, [backfillRunning, boardId, queryClient]);

  const params = new URLSearchParams({ range, sort, limit: String(PAGE_SIZE) });
  if (filters.emoji) params.set('emoji', filters.emoji.key);
  if (debouncedSearch) params.set('q', debouncedSearch);

  const entries = useEntryPages(boardId, params);
  const total = entries.data?.pages[0]?.total ?? 0;
  const s = stats.data;
  const hasFilters = !!(filters.emoji || debouncedSearch);
  const toggle = <K extends keyof Filters>(key: K, value: Filters[K], same: boolean) => setFilters(f => ({ ...f, [key]: same ? undefined : value }));

  return (
    <div className="space-y-6">
      <Link to="/pinboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />All pinboards</Link>

      <PageHeader
        title={board ? board.name : 'Pinboard'}
        description={board ? [board.guildName ?? 'Unknown server', board.channelName ? `#${board.channelName}` : null].filter(Boolean).join(' · ') : undefined}
        actions={
          <>
            {board && <Button variant="secondary" onClick={() => setSharing(true)}><Send className="size-4" />Post to Discord</Button>}
            <Tabs value={range} onChange={setRange} tabs={RANGES} />
          </>
        }
      />

      {stats.isError ? (
        <Notice tone="danger" title="Couldn't load the statistics">
          {stats.error instanceof Error ? stats.error.message : 'Unknown error'}
          <span className="mt-2 block"><Button size="sm" variant="secondary" onClick={() => stats.refetch()}><RotateCw className="size-3.5" />Try again</Button></span>
        </Notice>
      ) : !s ? (
        <Card><PageLoader /></Card>
      ) : (
        <>
          <BackfillNotice stats={s} board={board} onRefresh={() => stats.refetch()} />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Pins" value={s.pins.toLocaleString()} hint={`${s.pinsLast7Days} this week · ${s.pinsLast30Days} in 30 days`} />
            <StatCard label="Reactions" value={s.reactions.toLocaleString()} hint="on pinned messages" />
            <StatCard label="Average" value={s.averageReactions.toLocaleString()} hint="reactions per pin" />
            <StatCard label="Record" value={s.maxReactions.toLocaleString()} hint="most reactions on one pin" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Over time"
                icon={<BarChart3 className="size-4" />}
                actions={<Tabs value={chartMetric} onChange={setChartMetric} tabs={[{ value: 'pins', label: 'Pins' }, { value: 'reactions', label: 'Reactions' }]} />}
              />
              <CardBody className="h-64">
                {s.timeline.length === 0 || s.pins === 0 ? (
                  <EmptyState icon={<BarChart3 className="size-5" />} title="No pins in this time range" />
                ) : (
                  <Suspense fallback={<PageLoader />}><TimelineChart data={s.timeline} dataKey={chartMetric} name={chartMetric === 'pins' ? 'Pins' : 'Reactions'} /></Suspense>
                )}
              </CardBody>
            </Card>

            <Ranking
              title="Emojis"
              icon={<Smile className="size-4" />}
              description="Click one to filter the list"
              items={s.emojis}
              empty="No reactions recorded yet"
              render={(e) => ({ key: e.emoji, label: <><EmojiPreview value={e.display || e.emoji} className="size-5" /><span className="truncate text-xs text-muted">{emojiName(e.display)}</span></>, pins: e.pins, reactions: e.reactions })}
              isActive={(e) => filters.emoji?.key === e.emoji}
              onPick={(e) => toggle('emoji', { key: e.emoji, display: e.display || e.emoji }, filters.emoji?.key === e.emoji)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Ranking
              title="Top authors"
              icon={<Users className="size-4" />}
              description="Click one to see their pins"
              items={s.authors}
              empty="No authors yet"
              render={(a) => ({
                key: a.key,
                label: <><Avatar src={avatarUrl(a.key, board?.guildId)} fallbackSrc={a.avatarUrl} name={a.name} className="size-6" /><span className="truncate">{a.name}</span></>,
                pins: a.pins,
                reactions: a.reactions
              })}
              onPick={(a) => setPinsOf({ kind: 'author', key: a.key, name: a.name, avatarUrl: a.avatarUrl })}
            />
            <Ranking
              title="Top channels"
              icon={<Hash className="size-4" />}
              description="Click one to see its pins"
              items={s.channels}
              empty="No channels yet"
              render={(c) => ({ key: c.channelId, label: <span className="truncate">#{c.name ?? 'unknown-channel'}</span>, pins: c.pins, reactions: c.reactions })}
              onPick={(c) => setPinsOf({ kind: 'channel', id: c.channelId, name: c.name ?? 'unknown-channel' })}
            />
          </div>

          {s.top.length > 0 && (
            <Card>
              <CardHeader title="Most reactions" icon={<Trophy className="size-4" />} />
              <div className="divide-y divide-border">
                {s.top.slice(0, 5).map((entry, i) => (
                  <button key={entry.originalMessageId} type="button" onClick={() => setOpened(entry)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-surface-2/60">
                    <span className="w-5 text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                    <EntryAvatar entry={entry} board={board} className="size-7" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {entry.content || entry.excerpt ? <DiscordText text={(entry.content || entry.excerpt)!} compact className="whitespace-nowrap" /> : entry.imageUrl ? 'Image' : 'No text'}
                      </span>
                      <span className="block truncate text-xs text-muted">{entry.authorName ?? 'Unknown author'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums">
                      {(entry.emojiDisplay || entry.emoji) && <EmojiPreview value={entry.emojiDisplay || entry.emoji!} className="size-4" />}
                      {entry.count}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader
          title={`Pinned messages · ${total.toLocaleString()}`}
          icon={<Pin className="size-4" />}
          actions={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text or author…" className="h-8 w-52 pl-8 text-xs" />
              </div>
              <Select value={sort} onChange={(e) => setSort(e.target.value as PinboardSort)} className="h-8 w-44 text-xs">
                {SORTS.map(o => <option key={o.value} value={o.value}>{o.value === 'reactions' && filters.emoji ? 'Most of this emoji' : o.label}</option>)}
              </Select>
            </>
          }
        />

        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 text-xs">
            <span className="text-muted">Filtered by</span>
            {filters.emoji && <FilterChip onRemove={() => setFilters(f => ({ ...f, emoji: undefined }))}><EmojiPreview value={filters.emoji.display} className="size-4" /></FilterChip>}
            {debouncedSearch && <FilterChip onRemove={() => setSearch('')}>“{debouncedSearch}”</FilterChip>}
            <button type="button" className="ml-auto text-accent hover:underline" onClick={() => { setFilters({}); setSearch(''); }}>Clear all</button>
          </div>
        )}

        <EntryGrid
          entries={entries}
          board={board}
          onOpen={setOpened}
          empty={hasFilters || range !== 'all'
            ? { title: 'Nothing matches these filters', description: 'Try another time range or remove a filter.' }
            : { title: 'No pinned messages yet', description: 'Messages appear here once they reach the reaction threshold.' }}
        />
      </Card>

      {pinsOf && (
        <PinsDialog
          key={pinsOf.kind === 'author' ? `a:${pinsOf.key}` : `c:${pinsOf.id}`}
          target={pinsOf}
          board={board}
          boardId={boardId}
          initialRange={range}
          onClose={() => setPinsOf(null)}
          onOpen={setOpened}
        />
      )}
      {sharing && board && <PinboardStatsPostDialog board={board} onClose={() => setSharing(false)} />}
      <EntryDialog entry={opened} board={board} onClose={() => setOpened(null)} />
    </div>
  );
}

function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-accent/12 py-0.5 pr-0.5 pl-2 text-accent">
      {children}
      <button type="button" onClick={onRemove} className="rounded p-0.5 hover:bg-accent/20" aria-label="Remove filter"><X className="size-3" /></button>
    </span>
  );
}
