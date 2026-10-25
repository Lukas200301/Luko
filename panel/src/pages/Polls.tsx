import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ExternalLink, Flag, Plus, Trash2, Vote, X } from 'lucide-react';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import { cn, formatDateTime, timeAgo } from '../lib/utils';
import type { PollInfo } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  SettingRow,
  Switch,
  Tabs,
  useConfirm,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect } from '../components/pickers';

const MAX_OPTIONS = 10;
const DURATIONS = [
  { minutes: 0, label: 'Until ended' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '1 week' }
];

function CreatePollDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(true);

  const filled = options.map(o => o.trim()).filter(Boolean);
  const create = useMutation({
    mutationFn: () => api.post<PollInfo & { url: string }>('/api/polls', { channelId, question, options: filled, durationMinutes, multiple, anonymous }),
    onSuccess: () => {
      toast.success('Poll posted');
      queryClient.invalidateQueries({ queryKey: ['polls'] });
      setQuestion('');
      setOptions(['', '']);
      onClose();
    },
    onError: (error) => toast.error(error)
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Start a poll"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!channelId || !question.trim() || filled.length < 2}>Post poll</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Server"><GuildSelect value={guildId} onChange={(id) => { setGuildId(id); setChannelId(''); }} /></Field>
          <Field label="Channel"><ChannelSelect guildId={guildId} kind="text" value={channelId} onChange={setChannelId} /></Field>
        </div>
        <Field label="Question"><Input value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we play tonight?" /></Field>
        <Field label={`Answers · ${filled.length}/${MAX_OPTIONS}`}>
          <div className="space-y-2">
            {options.map((option, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={option}
                  maxLength={70}
                  placeholder={`Answer ${i + 1}`}
                  onChange={(e) => {
                    const next = [...options];
                    next[i] = e.target.value;
                    // A new empty field appears while typing in the last one.
                    if (i === next.length - 1 && e.target.value && next.length < MAX_OPTIONS) next.push('');
                    setOptions(next);
                  }}
                />
                {options.length > 2 && (
                  <Button variant="ghost" size="icon" aria-label="Remove answer" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                )}
              </div>
            ))}
          </div>
        </Field>
        <div className="divide-y divide-border rounded-lg border border-border px-4">
          <SettingRow title="Duration">
            <Select className="w-40" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
              {DURATIONS.map(d => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title="Multiple choice" description="People may pick more than one answer">
            <Switch checked={multiple} onChange={setMultiple} label="Multiple choice" />
          </SettingRow>
          <SettingRow title="Anonymous" description="Hide who voted for what">
            <Switch checked={anonymous} onChange={setAnonymous} label="Anonymous" />
          </SettingRow>
        </div>
      </div>
    </Dialog>
  );
}

function PollCard({ poll }: { poll: PollInfo }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['polls'] });

  const end = useMutation({ mutationFn: () => api.post(`/api/polls/${poll.id}/end`), onSuccess: refresh, onError: (e) => toast.error(e) });
  const remove = useMutation({ mutationFn: () => api.delete(`/api/polls/${poll.id}`), onSuccess: refresh, onError: (e) => toast.error(e) });

  const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const top = Math.max(...poll.options.map(o => o.votes));
  const ended = poll.endedAt !== null;
  const url = poll.guildId && poll.messageId ? `https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.messageId}` : null;

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="font-semibold">{poll.question}</h3>
        <Badge tone={ended ? 'neutral' : 'success'}>{ended ? 'Ended' : 'Running'}</Badge>
      </div>
      <div className="mb-4 text-xs text-muted">
        {poll.guildName ?? 'Unknown server'} · #{poll.channelName ?? 'unknown'} · by {poll.creatorName} · {timeAgo(poll.createdAt)}
      </div>

      <div className="space-y-2.5">
        {poll.options.map((option, i) => {
          const percent = total ? Math.round((option.votes / total) * 100) : 0;
          const winning = top > 0 && option.votes === top;
          return (
            <div key={i}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className={cn('truncate', winning && 'font-medium')}>{option.label}{ended && winning && ' 🏆'}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{option.votes} · {percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-border"><div className={cn('h-full rounded-full transition-[width]', winning ? 'bg-accent' : 'bg-accent/40')} style={{ width: `${percent}%` }} /></div>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-muted">
        <span>
          {poll.voters} {poll.voters === 1 ? 'voter' : 'voters'} · {poll.anonymous ? 'anonymous' : 'public'} · {poll.multiple ? 'multiple choice' : 'one choice'}
          {!ended && poll.endsAt && ` · ends ${formatDateTime(poll.endsAt)}`}
          {ended && ` · ended ${timeAgo(poll.endedAt!)}`}
        </span>
        <span className="flex gap-1">
          {url && <a href={url} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink className="size-3.5" />Open</Button></a>}
          {!ended && <Button variant="ghost" size="sm" loading={end.isPending} onClick={() => end.mutate()}><Flag className="size-3.5" />End</Button>}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete poll"
            onClick={async () => {
              if (await confirm({ title: 'Delete this poll?', description: 'The poll message in Discord is deleted too.', confirmLabel: 'Delete', danger: true })) remove.mutate();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </span>
      </div>
    </Card>
  );
}

export function PollsPage() {
  const { data: settingsData } = useSettings();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<'running' | 'ended'>('running');
  const { data: polls, isLoading } = useQuery({ queryKey: ['polls'], queryFn: () => api.get<PollInfo[]>('/api/polls'), refetchInterval: 10_000 });

  const running = polls?.filter(p => p.endedAt === null) ?? [];
  const ended = polls?.filter(p => p.endedAt !== null) ?? [];
  const shown = tab === 'running' ? running : ended;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Polls"
        description="Button polls with live results, started with /poll or from here"
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />Start a poll</Button>}
      />

      {settingsData && !settingsData.settings.features.polls && (
        <Notice tone="warning" title="Polls are switched off">The /poll command is blocked. Turn polls on in <Link className="text-accent underline" to="/settings">Settings</Link>.</Notice>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'running', label: `Running · ${running.length}` }, { value: 'ended', label: `Ended · ${ended.length}` }]} />

      {isLoading || !polls ? <PageLoader /> : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={tab === 'running' ? <Vote className="size-5" /> : <BarChart3 className="size-5" />}
            title={tab === 'running' ? 'No running polls' : 'No ended polls yet'}
            description={tab === 'running' ? 'Start one here or with /poll in Discord.' : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {shown.map(poll => <PollCard key={poll.id} poll={poll} />)}
        </div>
      )}

      <CreatePollDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
