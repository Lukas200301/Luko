import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Radio, Save, Trash2, Wrench } from 'lucide-react';
import { useSaveSettings, useSettings } from '../lib/settings';
import type { ActivityKind, BotSettings, PresenceStatus } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  SettingRow,
  Switch,
  Textarea
} from '../components/ui';

const STATUS_OPTIONS: { value: PresenceStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: 'bg-success' },
  { value: 'idle', label: 'Idle', color: 'bg-warning' },
  { value: 'dnd', label: 'Do not disturb', color: 'bg-danger' },
  { value: 'invisible', label: 'Invisible', color: 'bg-muted' }
];

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  Playing: 'Playing',
  Listening: 'Listening to',
  Watching: 'Watching',
  Competing: 'Competing in',
  Custom: 'Custom status'
};

const PLACEHOLDERS = ['{users}', '{servers}', '{queues}', '{commands}'];

function MaintenanceCard({ maintenance }: { maintenance: BotSettings['maintenance'] }) {
  const save = useSaveSettings();
  const [message, setMessage] = useState(maintenance.message);

  useEffect(() => setMessage(maintenance.message), [maintenance.message]);

  return (
    <Card className={maintenance.enabled ? 'border-warning/50' : undefined}>
      <CardHeader
        title="Maintenance mode"
        description="No command can be used, by anyone. The bot replies with the message below instead and shows Do not disturb."
        icon={<Wrench className="size-4" />}
        actions={maintenance.enabled && <Badge tone="warning">Active</Badge>}
      />
      <CardBody className="space-y-4">
        <SettingRow title="Enable maintenance mode">
          <Switch checked={maintenance.enabled} onChange={(enabled) => save.mutate({ section: 'maintenance', value: { ...maintenance, enabled, message } })} label="Maintenance mode" />
        </SettingRow>
        <Field label="Message shown to users">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} className="min-h-20" />
        </Field>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => save.mutate({ section: 'maintenance', value: { ...maintenance, message } })} loading={save.isPending}>
            <Save className="size-4" />Save message
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function PresencePage() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [presence, setPresence] = useState<BotSettings['presence'] | null>(null);

  useEffect(() => {
    if (data) setPresence(data.settings.presence);
  }, [data]);

  if (!data || !presence) return <PageLoader />;

  const activities = presence.activities;
  const setActivities = (next: BotSettings['presence']['activities']) => setPresence({ ...presence, activities: next });
  const move = (index: number, delta: number) => {
    const next = [...activities];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setActivities(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Presence" description="What the bot shows as its status in Discord" />

      <Card>
        <CardHeader
          title="Status & activity"
          icon={<Radio className="size-4" />}
          actions={<Button onClick={() => save.mutate({ section: 'presence', value: presence })} loading={save.isPending}><Save className="size-4" />Save</Button>}
        />
        <CardBody className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Online status">
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPresence({ ...presence, status: option.value })}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${presence.status === option.value ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-2'}`}
                  >
                    <span className={`size-2.5 rounded-full ${option.color}`} />{option.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Rotate activities" hint="Cycle through the list below">
              <div className="pt-1"><Switch checked={presence.rotate} onChange={(rotate) => setPresence({ ...presence, rotate })} label="Rotate activities" /></div>
            </Field>
            <Field label="Rotation interval (seconds)" hint="Minimum 15 seconds">
              <Input type="number" min={15} max={3600} value={presence.intervalSeconds} disabled={!presence.rotate} onChange={(e) => setPresence({ ...presence, intervalSeconds: Number(e.target.value) })} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">Activities</div>
                <div className="text-xs text-muted">
                  Placeholders: {PLACEHOLDERS.map(p => <code key={p} className="mr-1 rounded bg-surface-2 px-1">{p}</code>)}
                  {!presence.rotate && ' · Only the first activity is shown when rotation is off.'}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setActivities([...activities, { type: 'Playing', text: '' }])} disabled={activities.length >= 25}>
                <Plus className="size-3.5" />Add activity
              </Button>
            </div>

            <div className="space-y-2">
              {activities.map((activity, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 sm:flex-nowrap">
                  <Select value={activity.type} className="sm:w-40" onChange={(e) => setActivities(activities.map((a, i) => i === index ? { ...a, type: e.target.value as ActivityKind } : a))}>
                    {Object.entries(ACTIVITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                  <Input value={activity.text} maxLength={128} placeholder="Activity text" onChange={(e) => setActivities(activities.map((a, i) => i === index ? { ...a, text: e.target.value } : a))} />
                  <label className="flex shrink-0 items-center gap-2 px-2 text-xs whitespace-nowrap text-muted" title="Only show this when the music feature is available">
                    <Switch checked={!!activity.musicOnly} onChange={(musicOnly) => setActivities(activities.map((a, i) => i === index ? { ...a, musicOnly } : a))} label="Music only" />
                    Music only
                  </label>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon" disabled={index === activities.length - 1} onClick={() => move(index, 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setActivities(activities.filter((_, i) => i !== index))} aria-label="Remove"><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              ))}
              {activities.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">No activity — the bot only shows its online status.</p>}
            </div>
          </div>
        </CardBody>
      </Card>

      <MaintenanceCard maintenance={data.settings.maintenance} />
    </div>
  );
}
