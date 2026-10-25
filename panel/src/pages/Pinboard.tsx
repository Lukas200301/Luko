import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, ChevronDown, Hash, Pin, Plus, Save, Smile, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { rememberMentions } from '../lib/discord';
import { useSaveSettings, useSettings } from '../lib/settings';
import { cn } from '../lib/utils';
import type { DiscordMentions, GuildDetail, PinboardBoard, PinboardBoardStatus, PinboardEntry } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  SettingRow,
  Switch,
  useConfirm
} from '../components/ui';
import { ChannelSelect, GuildSelect, useChannels } from '../components/pickers';
import { EmojiPicker } from '../components/EmojiPicker';
import { BotEmojis } from '../components/BotEmojis';
import { EntryCard, EntryDialog } from '../components/PinboardEntries';

interface PinboardResponse {
  enabled: boolean;
  boards: PinboardBoardStatus[];
  recent: PinboardEntry[];
  total: number;
  mentions: DiscordMentions;
}

function newBoard(): PinboardBoard {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: 'New pinboard',
    enabled: true,
    guildId: '',
    channelId: '',
    threshold: 5,
    emojis: [],
    ignoredChannelIds: [],
    ignoreSelfReactions: false,
    ignoreBotMessages: false,
    ignorePinboardPosts: false
  };
}

// Strips the status fields the API adds, leaving only what is saved in the settings.
function toBoard(status: PinboardBoardStatus | PinboardBoard): PinboardBoard {
  return {
    id: status.id,
    name: status.name,
    enabled: status.enabled,
    guildId: status.guildId,
    channelId: status.channelId,
    threshold: status.threshold,
    emojis: status.emojis,
    ignoredChannelIds: status.ignoredChannelIds,
    ignoreSelfReactions: status.ignoreSelfReactions,
    ignoreBotMessages: status.ignoreBotMessages,
    ignorePinboardPosts: status.ignorePinboardPosts
  };
}

function IgnoredChannels({ guildId, value, onChange }: { guildId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const { data: channels = [] } = useChannels(guildId || null);
  const name = (id: string) => channels.find(c => c.id === id)?.name ?? id;

  return (
    <div className="space-y-2">
      <ChannelSelect
        guildId={guildId}
        kind="text"
        value=""
        placeholder="Add a channel to ignore…"
        onChange={(id) => { if (id && !value.includes(id)) onChange([...value, id]); }}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(id => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-1 pr-1 pl-2 text-xs">
              <Hash className="size-3 text-muted" />{name(id)}
              <button type="button" onClick={() => onChange(value.filter(v => v !== id))} className="rounded p-0.5 text-muted hover:bg-border hover:text-fg" aria-label="Stop ignoring">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardEditor({ status, isNew, onSave, onDelete, saving }: {
  status: PinboardBoardStatus | null;
  isNew: boolean;
  onSave: (board: PinboardBoard) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [board, setBoard] = useState<PinboardBoard>(() => (status ? toBoard(status) : newBoard()));
  const [open, setOpen] = useState(isNew);

  useEffect(() => {
    if (status) setBoard(toBoard(status));
  }, [status]);

  const { data: guild } = useQuery({
    queryKey: ['guild', board.guildId],
    queryFn: () => api.get<GuildDetail>(`/api/guilds/${board.guildId}`),
    enabled: !!board.guildId && (board.guildId !== status?.guildId || !!status?.botInGuild),
    retry: false
  });

  const serverEmojis = guild?.emojis ?? (board.guildId === status?.guildId ? status.guildEmojis : []);
  const set = (patch: Partial<PinboardBoard>) => setBoard(b => ({ ...b, ...patch }));
  const setEmoji = (index: number, patch: Partial<PinboardBoard['emojis'][number]>) =>
    set({ emojis: board.emojis.map((e, i) => (i === index ? { ...e, ...patch } : e)) });

  const summary = status
    ? [status.guildName ?? (status.guildId ? 'Unknown server' : 'No server'), status.channelName ? `#${status.channelName}` : null].filter(Boolean).join(' · ')
    : 'Not saved yet';

  return (
    <Card className={cn(!board.enabled && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="rounded-lg bg-warning/15 p-2 text-warning"><Pin className="size-4" /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{board.name}</span>
            <span className="block truncate text-xs text-muted">{summary} · {board.emojis.length === 0 ? 'any emoji' : `${board.emojis.length} emoji${board.emojis.length === 1 ? '' : 's'}`} · {board.threshold}+ reactions</span>
          </span>
          <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted transition', open && 'rotate-180')} />
        </button>
        {status && !status.botInGuild && <Badge tone="warning">Bot not in server</Badge>}
        {status && (
          <Link to={`/pinboard/${status.id}`}>
            <Button size="sm" variant="outline"><Pin className="size-3.5" />Pinned messages · {status.entryCount.toLocaleString()}</Button>
          </Link>
        )}
        <Switch checked={board.enabled} onChange={(enabled) => { set({ enabled }); if (status) onSave({ ...board, enabled }); }} label="Pinboard enabled" />
      </div>

      {open && (
        <div className="space-y-5 border-t border-border p-5">
          {status && !status.botInGuild && (
            <Notice tone="warning">
              The running bot is not a member of server <code>{status.guildId}</code>, so this pinboard can't work and its emojis can't be listed.
              If you're running a test bot, that's expected.
            </Notice>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name"><Input value={board.name} maxLength={50} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Server"><GuildSelect value={board.guildId} onChange={(guildId) => set({ guildId, channelId: '', ignoredChannelIds: [] })} /></Field>
            <Field label="Pinboard channel"><ChannelSelect guildId={board.guildId} kind="text" value={board.channelId} onChange={(channelId) => set({ channelId })} /></Field>
            <Field label="Default reactions needed">
              <Input type="number" min={1} max={1000} value={board.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
            </Field>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-xs font-medium">Emojis</div>
                <div className="mt-0.5 max-w-2xl text-xs text-muted">
                  <b>Reaction</b> is what members react with, <b>shown as</b> is how the bot displays it in the post, and <b>needed</b> overrides
                  the default count for that emoji. With no emojis, every emoji counts.
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => set({ emojis: [...board.emojis, { emoji: '', display: '', threshold: null }] })} disabled={board.emojis.length >= 25}>
                <Plus className="size-3.5" />Add emoji
              </Button>
            </div>

            {board.emojis.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                <Smile className="mx-auto mb-2 size-5" />Any emoji counts, {board.threshold} reactions needed.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden gap-2 px-1 text-[11px] font-medium tracking-wide text-muted uppercase sm:flex">
                  <span className="flex-1">Reaction</span><span className="w-4" /><span className="flex-1">Shown as</span><span className="w-28">Needed</span><span className="w-9" />
                </div>
                {board.emojis.map((row, index) => (
                  <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-center sm:border-0 sm:p-0">
                    <EmojiPicker value={row.emoji} onChange={(emoji) => setEmoji(index, { emoji })} serverEmojis={serverEmojis} mode="id" placeholder="Choose the reaction emoji" />
                    <ArrowRight className="hidden size-4 shrink-0 text-muted sm:block" />
                    <EmojiPicker value={row.display} onChange={(display) => setEmoji(index, { display })} serverEmojis={serverEmojis} mode="display" placeholder="Same as reaction" allowEmpty="Same as reaction" />
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      className="h-10 sm:w-28"
                      placeholder={`Default (${board.threshold})`}
                      value={row.threshold ?? ''}
                      onChange={(e) => setEmoji(index, { threshold: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <Button variant="ghost" size="icon" className="self-end sm:self-auto" onClick={() => set({ emojis: board.emojis.filter((_, i) => i !== index) })} aria-label="Remove emoji">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Field label="Ignored channels" hint="Messages in these channels (and their threads) are never pinned">
              <IgnoredChannels guildId={board.guildId} value={board.ignoredChannelIds} onChange={(ignoredChannelIds) => set({ ignoredChannelIds })} />
            </Field>
            <div className="divide-y divide-border">
              <SettingRow title="Don't count the author's own reaction" description="People can't push their own messages onto the pinboard">
                <Switch checked={board.ignoreSelfReactions} onChange={(ignoreSelfReactions) => set({ ignoreSelfReactions })} label="Ignore self reactions" />
              </SettingRow>
              <SettingRow title="Ignore messages from bots">
                <Switch checked={board.ignoreBotMessages} onChange={(ignoreBotMessages) => set({ ignoreBotMessages })} label="Ignore bot messages" />
              </SettingRow>
              <SettingRow title="Ignore pinboard posts" description="Posts of a pinboard (an old pinboard channel or another board) can't be pinned again. This board's own posts never are.">
                <Switch checked={board.ignorePinboardPosts} onChange={(ignorePinboardPosts) => set({ ignorePinboardPosts })} label="Ignore pinboard posts" />
              </SettingRow>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={onDelete}><Trash2 className="size-4" />{isNew ? 'Discard' : 'Delete pinboard'}</Button>
            <Button
              onClick={() => onSave({ ...board, emojis: board.emojis.filter(e => e.emoji.trim()) })}
              loading={saving}
              disabled={!board.guildId || !board.channelId}
              title={!board.guildId || !board.channelId ? 'Choose a server and a channel first' : undefined}
            >
              <Save className="size-4" />Save pinboard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RecentPinned({ data }: { data: PinboardResponse }) {
  const boardsById = useMemo(() => new Map(data.boards.map(b => [b.id, b])), [data.boards]);
  const [opened, setOpened] = useState<PinboardEntry | null>(null);

  return (
    <Card>
      <CardHeader
        title="Latest pinned messages"
        description={data.total > data.recent.length
          ? `The newest ${data.recent.length} of ${data.total.toLocaleString()}. Open a pinboard's "Pinned messages" for all of them and statistics.`
          : 'Newest first, across all pinboards'}
        icon={<Pin className="size-4" />}
      />
      {data.recent.length === 0 ? (
        <EmptyState icon={<Pin className="size-5" />} title="No pinned messages yet" description="Messages appear here once they reach the reaction threshold." />
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.recent.map(entry => (
            <EntryCard key={`${entry.boardId}:${entry.originalMessageId}`} entry={entry} board={boardsById.get(entry.boardId)} showBoard={data.boards.length > 1} onOpen={setOpened} />
          ))}
        </div>
      )}
      <EntryDialog entry={opened} board={opened ? boardsById.get(opened.boardId) : undefined} onClose={() => setOpened(null)} />
    </Card>
  );
}

export function PinboardPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const save = useSaveSettings();
  const { data: settingsData } = useSettings();
  const [drafts, setDrafts] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['pinboard'], queryFn: () => api.get<PinboardResponse>('/api/pinboard').then(rememberMentions) });

  if (isLoading || !data) return <PageLoader />;

  const savedBoards = data.boards.map(toBoard);

  const saveBoards = (boards: PinboardBoard[], boardId: string, draftDone?: string) => {
    setSavingId(boardId);
    save.mutate(
      { section: 'pinboard', value: { boards } },
      {
        onSuccess: () => {
          if (draftDone) setDrafts(d => d.filter(id => id !== draftDone));
          queryClient.invalidateQueries({ queryKey: ['pinboard'] });
        },
        onSettled: () => setSavingId(null)
      }
    );
  };

  const saveBoard = (board: PinboardBoard, draftId?: string) => {
    const exists = savedBoards.some(b => b.id === board.id);
    const boards = exists ? savedBoards.map(b => (b.id === board.id ? board : b)) : [...savedBoards, board];
    saveBoards(boards, draftId ?? board.id, draftId);
  };

  const deleteBoard = async (board: PinboardBoardStatus) => {
    if (await confirm({
      title: `Delete "${board.name}"?`,
      description: 'The pinboard stops working and its list of pinned messages is removed from the panel. Posts already in Discord stay.',
      confirmLabel: 'Delete',
      danger: true
    })) {
      saveBoards(savedBoards.filter(b => b.id !== board.id), board.id);
    }
  };

  const toggleFeature = (enabled: boolean) => {
    if (!settingsData) return;
    save.mutate(
      { section: 'features', value: { ...settingsData.settings.features, pinboard: enabled } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pinboard'] }) }
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pinboard"
        description="Highlight popular messages automatically, on as many servers as you like"
        actions={<Button onClick={() => setDrafts(d => [...d, Math.random().toString(36).slice(2, 10)])}><Plus className="size-4" />Add pinboard</Button>}
      />

      <Card>
        <CardBody className="py-2">
          <SettingRow
            title="Pinboard feature"
            description={`${data.boards.length} pinboard${data.boards.length === 1 ? '' : 's'} configured. Turning this off pauses all of them.`}
          >
            <Switch checked={data.enabled} onChange={toggleFeature} label="Pinboard feature" />
          </SettingRow>
        </CardBody>
      </Card>

      {data.boards.length === 0 && drafts.length === 0 && (
        <Card>
          <EmptyState
            icon={<Pin className="size-5" />}
            title="No pinboards yet"
            description="Add a pinboard for a server: pick the channel posts go to, which emojis count and how many reactions are needed."
            action={<Button onClick={() => setDrafts([Math.random().toString(36).slice(2, 10)])}><Plus className="size-4" />Add pinboard</Button>}
          />
        </Card>
      )}

      <div className="space-y-4">
        {data.boards.map(board => (
          <BoardEditor
            key={board.id}
            status={board}
            isNew={false}
            saving={savingId === board.id}
            onSave={(b) => saveBoard(b)}
            onDelete={() => deleteBoard(board)}
          />
        ))}
        {drafts.map(draftId => (
          <BoardEditor
            key={draftId}
            status={null}
            isNew
            saving={savingId === draftId}
            onSave={(b) => saveBoard(b, draftId)}
            onDelete={() => setDrafts(d => d.filter(id => id !== draftId))}
          />
        ))}
      </div>

      <BotEmojis compact />

      <RecentPinned data={data} />
    </div>
  );
}
