import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cake, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSaveSettings, useSettings } from '../lib/settings';
import type { BirthdayInfo, BotSettings } from '../lib/types';
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
  Textarea,
  useConfirm,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect, useGuilds } from '../components/pickers';
import { MemberPicker } from '../components/MemberPicker';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function daysUntil(time: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((time - today.getTime()) / 86_400_000);
}

function whenText(time: number): string {
  const days = daysUntil(time);
  return days === 0 ? 'Today 🎉' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}

function SettingsCard({ settings }: { settings: BotSettings }) {
  const save = useSaveSettings();
  const { data: guilds = [] } = useGuilds();
  const [form, setForm] = useState(settings.birthdays);
  useEffect(() => setForm(settings.birthdays), [settings.birthdays]);

  const preview = form.message
    .replaceAll('{user}', '@Lukas')
    .replaceAll('{name}', 'Lukas')
    .replaceAll('{age}', '25')
    .trim();
  const changed = JSON.stringify(form) !== JSON.stringify(settings.birthdays);

  return (
    <Card>
      <CardHeader title="Announcements" description="Where and when the bot congratulates people" icon={<Settings2 className="size-4" />} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Message" hint="{user} mentions the person, {name} is their name, {age} their new age (empty without a birth year)">
            <Textarea rows={2} value={form.message} maxLength={500} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
          <Field label="Time" hint="Server time">
            <Select value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
              {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </Select>
          </Field>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="mr-2 text-xs text-muted">Preview</span>{preview}</div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Channel per server</div>
          {guilds.length === 0 && <p className="text-xs text-muted">The bot isn't in any server.</p>}
          {guilds.map(guild => (
            <div key={guild.id} className="flex flex-wrap items-center gap-3">
              <span className="flex min-w-40 flex-1 items-center gap-2 text-sm"><Avatar src={guild.iconUrl} name={guild.name} className="size-6" />{guild.name}</span>
              <ChannelSelect
                guildId={guild.id}
                kind="text"
                className="w-64"
                placeholder="No announcements"
                value={form.channels[guild.id] ?? ''}
                onChange={(channelId) => {
                  const channels = { ...form.channels };
                  if (channelId) channels[guild.id] = channelId;
                  else delete channels[guild.id];
                  setForm({ ...form, channels });
                }}
              />
            </div>
          ))}
        </div>

        {changed && (
          <div className="flex justify-end">
            <Button onClick={() => save.mutate({ section: 'birthdays', value: form })} loading={save.isPending}><Save className="size-4" />Save</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AddBirthdayDialog({ open, onClose, defaultGuild }: { open: boolean; onClose: () => void; defaultGuild: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [guildId, setGuildId] = useState(defaultGuild);
  const [userId, setUserId] = useState('');
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(1);
  const [year, setYear] = useState('');

  useEffect(() => {
    if (open) {
      setGuildId(defaultGuild);
      setUserId('');
    }
  }, [open, defaultGuild]);

  const save = useMutation({
    mutationFn: () => api.put(`/api/birthdays/${guildId}/${userId}`, { day, month, year: year ? Number(year) : null }),
    onSuccess: () => {
      toast.success('Birthday saved');
      queryClient.invalidateQueries({ queryKey: ['birthdays'] });
      onClose();
    },
    onError: (error) => toast.error(error)
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a birthday"
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!guildId || !userId}>Save</Button></>}
    >
      <div className="space-y-4">
        <Field label="Server"><GuildSelect value={guildId} onChange={(id) => { setGuildId(id); setUserId(''); }} /></Field>
        <Field label="Person"><MemberPicker guildId={guildId} channelId="" value={userId} onChange={setUserId} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Day"><Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} /></Field>
          <Field label="Month">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
            </Select>
          </Field>
          <Field label="Year" hint="Optional"><Input type="number" min={1900} max={new Date().getFullYear()} placeholder="–" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

export function BirthdaysPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: settingsData } = useSettings();
  const { data: guilds = [] } = useGuilds();
  const [guildFilter, setGuildFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: birthdays, isLoading } = useQuery({
    queryKey: ['birthdays', guildFilter],
    queryFn: () => api.get<BirthdayInfo[]>(`/api/birthdays${guildFilter ? `?guild=${guildFilter}` : ''}`)
  });

  const remove = useMutation({
    mutationFn: (b: BirthdayInfo) => api.delete(`/api/birthdays/${b.guildId}/${b.userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['birthdays'] }),
    onError: (error) => toast.error(error)
  });

  const guildNames = useMemo(() => new Map(guilds.map(g => [g.id, g.name])), [guilds]);

  if (!settingsData) return <PageLoader />;
  const settings = settingsData.settings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Birthdays"
        description="Everyone can save their birthday with /birthday set; the bot congratulates them on the day"
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" />Add birthday</Button>}
      />

      {!settings.features.birthdays && (
        <Notice tone="warning" title="Birthdays are switched off">Turn them on in <Link className="text-accent underline" to="/settings">Settings</Link> to use /birthday and the announcements.</Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_28rem]">
        <Card>
          <CardHeader
            title={`Upcoming · ${birthdays?.length ?? 0}`}
            icon={<Cake className="size-4" />}
            actions={<GuildSelect value={guildFilter} onChange={setGuildFilter} placeholder="All servers" className="h-8 w-48 text-xs" />}
          />
          {isLoading || !birthdays ? <PageLoader /> : birthdays.length === 0 ? (
            <EmptyState icon={<Cake className="size-5" />} title="No birthdays yet" description="Add one here, or ask people to use /birthday set." />
          ) : (
            <div className="divide-y divide-border">
              {birthdays.map(b => {
                const soon = daysUntil(b.nextAt) <= 7;
                return (
                  <div key={`${b.guildId}:${b.userId}`} className="flex items-center gap-3 px-5 py-3">
                    <Avatar src={b.avatarUrl} name={b.userName} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{b.userName}</div>
                      <div className="truncate text-xs text-muted">
                        {b.day} {MONTHS[b.month - 1]}{b.year ? ` ${b.year}` : ''}{!guildFilter && ` · ${guildNames.get(b.guildId) ?? 'Unknown server'}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge tone={daysUntil(b.nextAt) === 0 ? 'success' : soon ? 'accent' : 'neutral'}>{whenText(b.nextAt)}</Badge>
                      {b.nextAge && <div className="mt-1 text-xs text-muted">turns {b.nextAge}</div>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove birthday"
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${b.userName}'s birthday?`, confirmLabel: 'Remove', danger: true })) remove.mutate(b);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <SettingsCard settings={settings} />
      </div>

      <AddBirthdayDialog open={adding} onClose={() => setAdding(false)} defaultGuild={guildFilter} />
    </div>
  );
}
