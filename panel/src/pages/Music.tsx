import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  History,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  Wand2
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDuration } from '../lib/utils';
import type { FilterPresetInfo, LoopMode, MusicQueueDetail, MusicQueueSummary, SearchResult, TrackInfo } from '../lib/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  Tabs,
  useConfirm,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect } from '../components/pickers';

interface MusicOverview {
  available: boolean;
  restartRequired: boolean;
  filters: FilterPresetInfo[];
  queues: MusicQueueSummary[];
}

function useControl(guildId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/music/${guildId}/control`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['music'] });
    },
    onError: (error) => toast.error(error)
  });
}

function Artwork({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent', className)}>
        <Music2 className="size-1/3" />
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className={cn('shrink-0 rounded-lg object-cover', className)} />;
}

function TrackSearch({ onAdd, disabled }: { onAdd: (query: string, title: string) => Promise<void>; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const isUrl = debounced.startsWith('http');
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['music-search', debounced],
    queryFn: () => api.get<SearchResult[]>(`/api/music/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && !isUrl,
    staleTime: 60_000
  });

  const add = async (value: string, title: string) => {
    setAdding(value);
    try {
      await onAdd(value, title);
      setQuery('');
    } finally {
      setAdding(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) add(query.trim(), query.trim());
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a song or paste a YouTube / Spotify / SoundCloud URL"
            className="pl-9"
            disabled={disabled}
          />
        </div>
        <Button type="submit" disabled={!query.trim() || disabled} loading={adding === query.trim()}>
          <Plus className="size-4" />Add
        </Button>
      </form>

      {isFetching && <p className="text-xs text-muted">Searching…</p>}

      {!isUrl && results.length > 0 && query.trim() && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {results.map(result => (
            <div key={result.uri || result.title} className="flex items-center gap-3 px-3 py-2">
              <Artwork src={result.artworkUrl} className="size-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{result.title}</div>
                <div className="truncate text-xs text-muted">{result.author} · {formatDuration(result.duration)}</div>
              </div>
              <Button size="sm" variant="secondary" loading={adding === (result.uri || result.title)} onClick={() => add(result.uri || result.title, result.title)}>
                <Plus className="size-3.5" />Add
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableTrack({ id, index, track, onRemove, onJump }: {
  id: string;
  index: number;
  track: TrackInfo;
  onRemove: () => void;
  onJump: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group flex items-center gap-3 bg-surface px-3 py-2', isDragging && 'relative z-10 rounded-lg shadow-lg ring-1 ring-accent/40')}
    >
      <button className="cursor-grab touch-none text-muted hover:text-fg active:cursor-grabbing" {...attributes} {...listeners} aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 text-right text-xs text-muted tabular-nums">{index + 1}</span>
      <Artwork src={track.artworkUrl} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        <div className="truncate text-xs text-muted">{track.author} · {track.requestedBy}</div>
      </div>
      <span className="text-xs text-muted tabular-nums">{track.isStream ? 'Live' : formatDuration(track.duration)}</span>
      <div className="flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
        <Button variant="ghost" size="icon" onClick={onJump} title="Play now"><Play className="size-3.5" /></Button>
        <Button variant="ghost" size="icon" onClick={onRemove} title="Remove"><Trash2 className="size-3.5" /></Button>
      </div>
    </div>
  );
}

function QueueList({ queue }: { queue: MusicQueueDetail }) {
  const control = useControl(queue.guildId);
  const [tracks, setTracks] = useState(queue.tracks);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => setTracks(queue.tracks), [queue.tracks]);

  // Track URIs can repeat in a queue, so the position is part of the ID.
  const ids = tracks.map((track, index) => `${index}:${track.uri}`);

  const onDragEnd = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    setTracks(t => arrayMove(t, from, to));
    control.mutate({ action: 'move', from, to });
  };

  if (tracks.length === 0) {
    return <EmptyState icon={<ListMusic className="size-5" />} title="The queue is empty" description="Search for a song above to add it." />;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-border">
          {tracks.map((track, index) => (
            <SortableTrack
              key={ids[index]}
              id={ids[index]}
              index={index}
              track={track}
              onRemove={() => control.mutate({ action: 'remove', index })}
              onJump={() => control.mutate({ action: 'jump', index })}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function NowPlaying({ queue, filters, fetchedAt }: { queue: MusicQueueDetail; filters: FilterPresetInfo[]; fetchedAt: number }) {
  const control = useControl(queue.guildId);
  const confirm = useConfirm();
  const [volume, setVolume] = useState(queue.volume);
  const [now, setNow] = useState(Date.now());
  const current = queue.current;

  useEffect(() => setVolume(queue.volume), [queue.volume]);

  useEffect(() => {
    if (queue.paused || !current) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [queue.paused, current]);

  const position = current
    ? Math.min(current.duration, queue.position + (queue.paused ? 0 : Math.max(0, now - fetchedAt)))
    : 0;
  const progress = current && current.duration > 0 ? (position / current.duration) * 100 : 0;

  const seek = (event: MouseEvent<HTMLDivElement>) => {
    if (!current || current.isStream) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    control.mutate({ action: 'seek', value: Math.round(ratio * current.duration) });
  };

  const stop = async () => {
    if (await confirm({ title: 'Stop music?', description: 'The bot leaves the voice channel and the queue is cleared.', confirmLabel: 'Stop', danger: true })) {
      control.mutate({ action: 'stop' });
    }
  };

  const loopModes: { value: LoopMode; label: ReactNode }[] = [
    { value: 'off', label: 'Off' },
    { value: 'track', label: <span className="flex items-center gap-1"><Repeat1 className="size-3.5" />Track</span> },
    { value: 'queue', label: <span className="flex items-center gap-1"><Repeat className="size-3.5" />Queue</span> }
  ];

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        {current?.artworkUrl && (
          <img src={current.artworkUrl} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-20 blur-2xl" />
        )}
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
          <Artwork src={current?.artworkUrl ?? null} className="size-28 shadow-lg sm:size-32" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={queue.paused ? 'warning' : 'success'}>{queue.paused ? 'Paused' : 'Playing'}</Badge>
              {queue.voiceChannelName && <span className="truncate text-xs text-muted">🔊 {queue.voiceChannelName} · {queue.listeners} listening</span>}
            </div>
            {current ? (
              <>
                <a href={current.uri} target="_blank" rel="noreferrer" className="line-clamp-2 text-lg font-semibold hover:underline">{current.title}</a>
                <div className="truncate text-sm text-muted">{current.author} · requested by {current.requestedBy}</div>
              </>
            ) : (
              <div className="text-lg font-semibold text-muted">Nothing playing</div>
            )}

            <div className="mt-4">
              <div className="group relative h-2 cursor-pointer rounded-full bg-border" onClick={seek} title="Click to seek">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
                <span>{formatDuration(position)}</span>
                <span>{current?.isStream ? 'Live' : formatDuration(current?.duration ?? 0)}</span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="icon" onClick={() => control.mutate({ action: 'previous' })} title="Previous"><SkipBack className="size-4" /></Button>
              <Button size="icon" className="size-11 justify-center rounded-full" onClick={() => control.mutate({ action: 'pause', value: !queue.paused })} title={queue.paused ? 'Resume' : 'Pause'}>
                {queue.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
              </Button>
              <Button variant="secondary" size="icon" onClick={() => control.mutate({ action: 'skip' })} title="Skip"><SkipForward className="size-4" /></Button>
              <Button variant="secondary" size="icon" onClick={() => control.mutate({ action: 'shuffle' })} title="Shuffle queue"><Shuffle className="size-4" /></Button>
              <Button variant="secondary" size="icon" onClick={stop} title="Stop and leave"><Square className="size-4" /></Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={<span className="flex items-center gap-1.5"><Volume2 className="size-3.5" />Volume · {volume}%</span>}>
          <input
            type="range"
            min={0}
            max={200}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={() => control.mutate({ action: 'volume', value: volume })}
            onKeyUp={() => control.mutate({ action: 'volume', value: volume })}
            className="mt-2 w-full"
          />
        </Field>
        <Field label="Loop">
          <Tabs value={queue.loop} onChange={(value) => control.mutate({ action: 'loop', value })} tabs={loopModes} />
        </Field>
        <Field label={<span className="flex items-center gap-1.5"><Wand2 className="size-3.5" />Audio filter</span>}>
          <Select value={queue.filter} onChange={(e) => control.mutate({ action: 'filter', value: e.target.value })}>
            {filters.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
          </Select>
        </Field>
        <Field label="Autoplay" hint="Play related songs when the queue ends">
          <Switch checked={queue.autoplay} onChange={(value) => control.mutate({ action: 'autoplay', value })} label="Autoplay" />
        </Field>
      </div>
    </Card>
  );
}

function QueueView({ guildId, filters }: { guildId: string; filters: FilterPresetInfo[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const control = useControl(guildId);
  const confirm = useConfirm();
  const [tab, setTab] = useState<'queue' | 'history'>('queue');

  const { data, dataUpdatedAt, isLoading } = useQuery({
    queryKey: ['music', guildId],
    queryFn: () => api.get<{ queue: MusicQueueDetail | null }>(`/api/music/${guildId}`),
    refetchInterval: 3000
  });

  if (isLoading) return <PageLoader />;
  const queue = data?.queue;
  if (!queue) {
    return <Card><EmptyState icon={<Music2 className="size-5" />} title="This session has ended" description="Pick another server or start a new session." /></Card>;
  }

  const addTrack = async (query: string) => {
    try {
      const result = await api.post<{ added: string }>(`/api/music/${guildId}/play`, { query });
      toast.success(`Added ${result.added}`);
      queryClient.invalidateQueries({ queryKey: ['music'] });
    } catch (error) {
      toast.error(error);
    }
  };

  const clear = async () => {
    if (await confirm({ title: 'Clear the queue?', description: `${queue.tracks.length} upcoming tracks will be removed.`, confirmLabel: 'Clear', danger: true })) {
      control.mutate({ action: 'clear' });
    }
  };

  return (
    <div className="space-y-6">
      <NowPlaying queue={queue} filters={filters} fetchedAt={dataUpdatedAt} />

      <Card>
        <CardHeader title="Add to queue" icon={<Plus className="size-4" />} />
        <CardBody><TrackSearch onAdd={addTrack} /></CardBody>
      </Card>

      <Card>
        <CardHeader
          title={tab === 'queue' ? `Up next · ${queue.tracks.length}` : 'Recently played'}
          icon={tab === 'queue' ? <ListMusic className="size-4" /> : <History className="size-4" />}
          actions={
            <>
              <Tabs value={tab} onChange={setTab} tabs={[{ value: 'queue', label: 'Queue' }, { value: 'history', label: 'History' }]} />
              {tab === 'queue' && queue.tracks.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clear}><Trash2 className="size-3.5" />Clear</Button>
              )}
            </>
          }
        />
        {tab === 'queue' ? (
          <QueueList queue={queue} />
        ) : queue.history.length === 0 ? (
          <EmptyState icon={<History className="size-5" />} title="No history yet" />
        ) : (
          <div className="divide-y divide-border">
            {queue.history.map((track, index) => (
              <div key={`${index}:${track.uri}`} className="flex items-center gap-3 px-4 py-2">
                <Artwork src={track.artworkUrl} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{track.title}</div>
                  <div className="truncate text-xs text-muted">{track.author} · {track.requestedBy}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => addTrack(track.uri || track.title)}><Plus className="size-3.5" />Queue again</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StartSessionDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (guildId: string) => void }) {
  const toast = useToast();
  const [guildId, setGuildId] = useState('');
  const [voiceChannelId, setVoiceChannelId] = useState('');
  const [textChannelId, setTextChannelId] = useState('');

  useEffect(() => {
    setVoiceChannelId('');
    setTextChannelId('');
  }, [guildId]);

  const start = async (query: string) => {
    if (!guildId || !voiceChannelId || !textChannelId) {
      toast.error('Choose a server, a voice channel and a text channel first.');
      return;
    }
    try {
      const result = await api.post<{ added: string }>(`/api/music/${guildId}/play`, { query, voiceChannelId, textChannelId });
      toast.success(`Now playing ${result.added}`);
      onStarted(guildId);
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Start a music session" description="The bot joins the voice channel and starts playing." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Server"><GuildSelect value={guildId} onChange={setGuildId} /></Field>
          <Field label="Voice channel"><ChannelSelect guildId={guildId} kind="voice" value={voiceChannelId} onChange={setVoiceChannelId} /></Field>
          <Field label="Messages channel" hint='For "Now playing" messages'><ChannelSelect guildId={guildId} kind="text" value={textChannelId} onChange={setTextChannelId} /></Field>
        </div>
        <TrackSearch onAdd={start} disabled={!guildId || !voiceChannelId || !textChannelId} />
      </div>
    </Dialog>
  );
}

export function MusicPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['music'],
    queryFn: () => api.get<MusicOverview>('/api/music'),
    refetchInterval: 5000
  });

  const queues = data?.queues ?? [];
  const activeId = selected && queues.some(q => q.guildId === selected) ? selected : queues[0]?.guildId ?? null;

  if (isLoading || !data) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Music"
        description="Control playback on every server in real time"
        actions={data.available && <Button onClick={() => setStarting(true)}><Play className="size-4" />Start session</Button>}
      />

      {!data.available && (
        <Notice tone="warning" title={data.restartRequired ? 'Restart needed' : 'Music is disabled'} className="mb-6">
          {data.restartRequired
            ? 'Music was turned on in the settings. Restart the bot so the connection to Lavalink can start.'
            : 'Turn on the music feature in Settings to use these controls.'}
        </Notice>
      )}

      {queues.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Music2 className="size-5" />}
            title="Nothing is playing right now"
            description="Start a session from here, or use /play in Discord."
            action={data.available && <Button onClick={() => setStarting(true)}><Play className="size-4" />Start session</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            <div className="px-1 text-xs font-medium text-muted">Active sessions · {queues.length}</div>
            {queues.map(queue => (
              <button
                key={queue.guildId}
                onClick={() => setSelected(queue.guildId)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                  activeId === queue.guildId ? 'border-accent/50 bg-accent/8' : 'border-border bg-surface hover:border-accent/30'
                )}
              >
                <Avatar src={queue.guildIconUrl} name={queue.guildName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{queue.guildName}</div>
                  <div className="truncate text-xs text-muted">{queue.paused ? '⏸ ' : '▶ '}{queue.current?.title ?? 'Idle'}</div>
                </div>
                {queue.queueLength > 0 && <Badge>{queue.queueLength}</Badge>}
              </button>
            ))}
          </div>
          {activeId && <QueueView key={activeId} guildId={activeId} filters={data.filters} />}
        </div>
      )}

      <StartSessionDialog
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(guildId) => {
          setSelected(guildId);
          queryClient.invalidateQueries({ queryKey: ['music'] });
        }}
      />
    </div>
  );
}
