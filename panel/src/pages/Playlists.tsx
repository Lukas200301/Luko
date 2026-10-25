import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ListMusic, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDuration, timeAgo } from '../lib/utils';
import type { PlaylistDetail, PlaylistSummary, PlaylistTrackInfo } from '../lib/types';
import {
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  SettingRow,
  Switch,
  useConfirm,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect } from '../components/pickers';
import { Artwork, TrackSearch } from '../components/MusicParts';

function totalDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function NameDialog({ open, title, initial, onClose, onSave, saving }: {
  open: boolean;
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => { if (open) setName(initial); }, [open, initial]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  };
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><Input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Road trip" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PlayDialog({ playlist, open, onClose }: { playlist: PlaylistSummary; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [guildId, setGuildId] = useState('');
  const [voiceChannelId, setVoiceChannelId] = useState('');
  const [textChannelId, setTextChannelId] = useState('');
  const [shuffle, setShuffle] = useState(false);
  useEffect(() => { setVoiceChannelId(''); setTextChannelId(''); }, [guildId]);

  const { data: music } = useQuery({ queryKey: ['music'], queryFn: () => api.get<{ queues: { guildId: string }[] }>('/api/music'), enabled: open });
  const playing = !!music?.queues.some(q => q.guildId === guildId);

  const play = useMutation({
    mutationFn: () => api.post<{ added: number; joined: boolean }>(`/api/playlists/${playlist.id}/play`, { guildId, voiceChannelId, textChannelId, shuffle }),
    onSuccess: (result) => {
      toast.success(`${result.joined ? 'Playing' : 'Added'} ${result.added} songs from ${playlist.name}`);
      onClose();
    },
    onError: (error) => toast.error(error)
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Play "${playlist.name}"`}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => play.mutate()} loading={play.isPending} disabled={!guildId || (!playing && (!voiceChannelId || !textChannelId))}><Play className="size-4" />{playing ? 'Add to queue' : 'Play'}</Button></>}
    >
      <div className="space-y-4">
        <Field label="Server"><GuildSelect value={guildId} onChange={setGuildId} /></Field>
        {playing ? (
          <p className="text-sm text-muted">Music is already playing on this server; the songs are added to its queue.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voice channel"><ChannelSelect guildId={guildId} kind="voice" value={voiceChannelId} onChange={setVoiceChannelId} /></Field>
            <Field label="Messages channel" hint='For "Now playing" messages'><ChannelSelect guildId={guildId} kind="text" value={textChannelId} onChange={setTextChannelId} /></Field>
          </div>
        )}
        <SettingRow title="Shuffle" description="Play the songs in random order"><Switch checked={shuffle} onChange={setShuffle} label="Shuffle" /></SettingRow>
      </div>
    </Dialog>
  );
}

function SortableRow({ id, index, track, onRemove }: { id: string; index: number; track: PlaylistTrackInfo; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group flex items-center gap-3 bg-surface px-4 py-2', isDragging && 'relative z-10 rounded-lg shadow-lg ring-1 ring-accent/40')}
    >
      <button className="cursor-grab touch-none text-muted hover:text-fg active:cursor-grabbing" {...attributes} {...listeners} aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 text-right text-xs text-muted tabular-nums">{index + 1}</span>
      <Artwork src={track.artworkUrl} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.uri ? <a href={track.uri} target="_blank" rel="noreferrer" className="hover:underline">{track.title}</a> : track.title}</div>
        <div className="truncate text-xs text-muted">{track.author ?? 'Unknown artist'}</div>
      </div>
      <span className="text-xs text-muted tabular-nums">{formatDuration(track.duration)}</span>
      <Button variant="ghost" size="icon" className="opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" onClick={onRemove} title="Remove"><Trash2 className="size-3.5" /></Button>
    </div>
  );
}

function PlaylistView({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tracks, setTracks] = useState<PlaylistTrackInfo[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { data: playlist } = useQuery({ queryKey: ['playlist', id], queryFn: () => api.get<PlaylistDetail>(`/api/playlists/${id}`) });
  useEffect(() => setTracks(playlist?.tracks ?? []), [playlist?.tracks]);

  const changed = (updated?: PlaylistDetail | null) => {
    if (updated) queryClient.setQueryData(['playlist', id], updated);
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const rename = useMutation({
    mutationFn: (name: string) => api.patch<PlaylistDetail>(`/api/playlists/${id}`, { name }),
    onSuccess: (updated) => { changed(updated); setRenaming(false); },
    onError: (e) => toast.error(e)
  });
  const reorder = useMutation({
    mutationFn: (order: number[]) => api.patch<PlaylistDetail>(`/api/playlists/${id}`, { order }),
    onSuccess: changed,
    onError: (e) => toast.error(e)
  });
  const removeTrack = useMutation({
    mutationFn: (trackId: number) => api.delete<PlaylistDetail>(`/api/playlists/${id}/tracks/${trackId}`),
    onSuccess: changed,
    onError: (e) => toast.error(e)
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/playlists/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['playlists'] }); onDeleted(); },
    onError: (e) => toast.error(e)
  });

  const add = async (query: string) => {
    try {
      const result = await api.post<{ added: number; title: string; playlist: PlaylistDetail }>(`/api/playlists/${id}/tracks`, { query });
      changed(result.playlist);
      toast.success(result.added > 1 ? `Added ${result.added} songs from ${result.title}` : `Added ${result.title}`);
    } catch (error) {
      toast.error(error);
    }
  };

  if (!playlist) return <Card><PageLoader /></Card>;

  const ids = tracks.map(t => String(t.id));
  const onDragEnd = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(tracks, from, to);
    setTracks(next);
    reorder.mutate(next.map(t => t.id));
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 border-b border-border p-5">
        <Artwork src={playlist.artworkUrl} className="size-20" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{playlist.name}</h2>
          <div className="text-sm text-muted">{playlist.trackCount} songs · {totalDuration(playlist.duration)} · by {playlist.ownerName ?? 'someone'} · updated {timeAgo(playlist.updatedAt)}</div>
          <div className="mt-1 text-xs text-muted">In Discord: <code className="rounded bg-surface-2 px-1">/playlist play {playlist.name}</code></div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setPlaying(true)} disabled={playlist.trackCount === 0}><Play className="size-4" />Play</Button>
          <Button variant="secondary" size="icon" onClick={() => setRenaming(true)} title="Rename"><Pencil className="size-4" /></Button>
          <Button
            variant="secondary"
            size="icon"
            title="Delete playlist"
            onClick={async () => {
              if (await confirm({ title: `Delete "${playlist.name}"?`, description: `All ${playlist.trackCount} songs are removed from it.`, confirmLabel: 'Delete', danger: true })) remove.mutate();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <CardBody className="border-b border-border"><TrackSearch onAdd={add} /></CardBody>

      {tracks.length === 0 ? (
        <EmptyState icon={<ListMusic className="size-5" />} title="No songs yet" description="Search above, paste a link, or use /playlist save in Discord to save a queue." />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-border">
              {tracks.map((track, index) => <SortableRow key={track.id} id={String(track.id)} index={index} track={track} onRemove={() => removeTrack.mutate(track.id)} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <NameDialog open={renaming} title="Rename playlist" initial={playlist.name} onClose={() => setRenaming(false)} onSave={(name) => rename.mutate(name)} saving={rename.isPending} />
      <PlayDialog playlist={playlist} open={playing} onClose={() => setPlaying(false)} />
    </Card>
  );
}

export function PlaylistsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: playlists, isLoading } = useQuery({ queryKey: ['playlists'], queryFn: () => api.get<PlaylistSummary[]>('/api/playlists') });
  const create = useMutation({
    mutationFn: (name: string) => api.post<PlaylistSummary>('/api/playlists', { name }),
    onSuccess: (playlist) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setSelected(playlist.id);
      setCreating(false);
    },
    onError: (e) => toast.error(e)
  });

  if (isLoading || !playlists) return <PageLoader />;
  const active = selected !== null && playlists.some(p => p.id === selected) ? selected : playlists[0]?.id ?? null;

  return (
    <div>
      <PageHeader
        title="Playlists"
        description="Saved playlists everyone can play with /playlist play"
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />New playlist</Button>}
      />

      {playlists.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListMusic className="size-5" />}
            title="No playlists yet"
            description="Create one here, or save the current queue in Discord with /playlist save."
            action={<Button onClick={() => setCreating(true)}><Plus className="size-4" />New playlist</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            <div className="px-1 text-xs font-medium text-muted">{playlists.length} playlists</div>
            {playlists.map(playlist => (
              <button
                key={playlist.id}
                onClick={() => setSelected(playlist.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                  active === playlist.id ? 'border-accent/50 bg-accent/8' : 'border-border bg-surface hover:border-accent/30'
                )}
              >
                <Artwork src={playlist.artworkUrl} className="size-11" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{playlist.name}</div>
                  <div className="truncate text-xs text-muted">{playlist.trackCount} songs · {totalDuration(playlist.duration)}</div>
                </div>
              </button>
            ))}
          </div>
          {active !== null && <PlaylistView key={active} id={active} onDeleted={() => setSelected(null)} />}
        </div>
      )}

      <NameDialog open={creating} title="New playlist" initial="" onClose={() => setCreating(false)} onSave={(name) => create.mutate(name)} saving={create.isPending} />
    </div>
  );
}
