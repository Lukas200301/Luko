import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Clock, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/utils';
import type { ReminderInfo } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Textarea,
  useConfirm,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect } from '../components/pickers';
import { MemberPicker } from '../components/MemberPicker';

function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function CreateReminderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [userId, setUserId] = useState('');
  const [content, setContent] = useState('');
  const [dueAt, setDueAt] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));

  const create = useMutation({
    mutationFn: () => api.post('/api/reminders', { userId, channelId, content, dueAt: new Date(dueAt).getTime() }),
    onSuccess: () => {
      toast.success('Reminder created');
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      setContent('');
      onClose();
    },
    onError: (error) => toast.error(error)
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New reminder"
      description="The bot pings the user in the chosen channel at the given time."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!channelId || !userId || !content}>Create reminder</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Server"><GuildSelect value={guildId} onChange={(id) => { setGuildId(id); setChannelId(''); setUserId(''); }} /></Field>
          <Field label="Channel"><ChannelSelect guildId={guildId} kind="text" value={channelId} onChange={setChannelId} /></Field>
        </div>
        <Field label="Who to remind" hint={channelId ? 'Only people who can see the chosen channel are listed' : undefined}>
          <MemberPicker guildId={guildId} channelId={channelId} value={userId} onChange={setUserId} />
        </Field>
        <Field label="When"><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        <Field label="Message"><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What should the bot remind them about?" maxLength={1500} /></Field>
      </div>
    </Dialog>
  );
}

export function RemindersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => api.get<ReminderInfo[]>('/api/reminders'),
    refetchInterval: 15_000
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/reminders/${id}`),
    onSuccess: () => {
      toast.success('Reminder deleted');
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (error) => toast.error(error)
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return reminders.filter(r => !q || r.content.toLowerCase().includes(q) || (r.userTag ?? r.userId).toLowerCase().includes(q));
  }, [reminders, filter]);

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Reminders"
        description="All pending reminders across every server"
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />New reminder</Button>}
      />

      <Card>
        <CardHeader
          title={`Pending · ${reminders.length}`}
          icon={<Bell className="size-4" />}
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-8 w-52 pl-8 text-xs" />
            </div>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState icon={<Clock className="size-5" />} title="No pending reminders" description="Reminders created with /remind or from here show up in this list." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Reminder</th>
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-5 py-2.5 font-medium">Channel</th>
                  <th className="px-5 py-2.5 font-medium">Due</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(reminder => (
                  <tr key={reminder.id} className="hover:bg-surface-2/50">
                    <td className="max-w-sm px-5 py-3"><div className="line-clamp-2 break-words">{reminder.content}</div></td>
                    <td className="px-5 py-3 text-muted">{reminder.userTag ?? <code className="text-xs">{reminder.userId}</code>}</td>
                    <td className="px-5 py-3 text-muted">{reminder.channelName ? `#${reminder.channelName}` : '—'}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div>{formatDateTime(reminder.dueAt)}</div>
                      <Badge tone="accent" className="mt-0.5">{timeAgo(reminder.dueAt)}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete reminder"
                        onClick={async () => {
                          if (await confirm({ title: 'Delete this reminder?', confirmLabel: 'Delete', danger: true })) {
                            remove.mutate(reminder.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateReminderDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
