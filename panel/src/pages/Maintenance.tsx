import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, BellRing, CheckCircle2, Database, Download, GitCommitHorizontal, History, RefreshCw, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSaveSettings, useSettings } from '../lib/settings';
import { cn, formatBytes, formatDateTime, timeAgo } from '../lib/utils';
import type { BackupInfo, BackupKind, BackupOverview, BotSettings, PanelUser, UpdateStatus } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  SettingRow,
  Spinner,
  Switch,
  useConfirm,
  useToast
} from '../components/ui';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));

// ---------- Updates ----------

function UpdatesCard({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const logRef = useRef<HTMLPreElement>(null);

  const { data: status } = useQuery({
    queryKey: ['updates'],
    queryFn: () => api.get<UpdateStatus>('/api/updates'),
    // Follow the log while an update runs. Afterwards the bot may restart, so keep asking a little longer.
    refetchInterval: (q) => (q.state.data?.running || (q.state.data?.success && q.state.data.pm2 && q.state.data.step === 'Restarting') ? 1000 : false),
    retry: true
  });

  const check = useMutation({
    mutationFn: () => api.post<UpdateStatus>('/api/updates/check'),
    onSuccess: (data) => {
      queryClient.setQueryData(['updates'], data);
      if (data.checkError) toast.error(data.checkError);
      else toast.success(data.behind > 0 ? `${data.behind} new ${data.behind === 1 ? 'update' : 'updates'} available` : 'The bot is up to date');
    },
    onError: (error) => toast.error(error)
  });

  const install = useMutation({
    mutationFn: () => api.post<UpdateStatus>('/api/updates/install'),
    onSuccess: (data) => queryClient.setQueryData(['updates'], data),
    onError: (error) => toast.error(error)
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status?.log.length]);

  if (!status) return <Card><PageLoader /></Card>;

  const startInstall = async () => {
    if (await confirm({
      title: 'Install the update?',
      description: status.pm2
        ? 'The bot downloads the update, builds it and restarts. Music stops for a moment. The database is backed up first.'
        : 'The bot downloads and builds the update. It is not running under pm2, so you have to restart it yourself afterwards. The database is backed up first.',
      confirmLabel: 'Update now'
    })) install.mutate();
  };

  const showLog = status.running || status.log.length > 0;

  return (
    <Card>
      <CardHeader
        title="Updates"
        description="Install new versions from GitHub without the command line"
        icon={<ArrowDownToLine className="size-4" />}
        actions={status.gitAvailable && (
          <Button size="sm" variant="secondary" onClick={() => check.mutate()} loading={check.isPending} disabled={status.running}>
            <RefreshCw className="size-3.5" />Check now
          </Button>
        )}
      />
      <CardBody className="space-y-4">
        {!status.gitAvailable ? (
          <Notice tone="warning" title="Updating from the panel isn't available">{status.checkError}</Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <GitCommitHorizontal className="size-4 text-muted" />
                <span className="text-muted">Installed:</span>
                <span className="font-medium">{status.current?.subject ?? 'unknown'}</span>
                {status.current && <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs">{status.current.hash.slice(0, 7)}</code>}
              </span>
              {status.branch && <span className="text-muted">Branch <b className="text-fg">{status.branch}</b></span>}
              <span className="text-xs text-muted">{status.checkedAt ? `Checked ${timeAgo(status.checkedAt)}` : 'Not checked yet'} · checks every 6 hours</span>
            </div>

            {status.checkError && <Notice tone="warning">{status.checkError}</Notice>}

            {status.changedFiles.filter(f => f !== 'package-lock.json').length > 0 && (
              <Notice tone="warning" title="Files were changed on the server">
                An update would overwrite them, so it won't start until they are committed or undone:
                <span className="mt-1 block font-mono text-xs">{status.changedFiles.filter(f => f !== 'package-lock.json').join(', ')}</span>
              </Notice>
            )}

            {status.behind > 0 ? (
              <div className="rounded-xl border border-accent/30 bg-accent/5">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium">{status.behind} new {status.behind === 1 ? 'update' : 'updates'} on GitHub</span>
                  {isOwner
                    ? <Button onClick={startInstall} loading={install.isPending} disabled={status.running}><Download className="size-4" />Install update</Button>
                    : <span className="text-xs text-muted">Only the owner can install updates</span>}
                </div>
                <div className="max-h-56 divide-y divide-border overflow-y-auto border-t border-accent/20">
                  {status.commits.map(commit => (
                    <div key={commit.hash} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <code className="text-xs text-muted">{commit.hash.slice(0, 7)}</code>
                      <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                      <span className="shrink-0 text-xs text-muted">{commit.author} · {timeAgo(commit.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : !status.running && !status.checkError && (status.checkedAt
              ? <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" />The bot is up to date.</div>
              : <p className="text-sm text-muted">Click <b>Check now</b> to look for updates on GitHub.</p>)}

            {showLog && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {status.running ? <Spinner className="size-4" /> : status.success ? <CheckCircle2 className="size-4 text-success" /> : null}
                  <span className={cn('font-medium', status.success === false && 'text-danger')}>{status.step}</span>
                  {status.finishedAt && !status.running && <span className="text-xs text-muted">{timeAgo(status.finishedAt)}</span>}
                </div>
                {status.success && status.step === 'Restarting' && (
                  <Notice tone="info">The bot is restarting with the new version. This page reconnects by itself in a few seconds.</Notice>
                )}
                <pre ref={logRef} className="scrollbar-thin max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {status.log.join('\n') || 'Starting…'}
                </pre>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Backups ----------

const KIND_LABELS: Record<BackupKind, { label: string; tone: 'accent' | 'neutral' | 'warning' | 'success' }> = {
  auto: { label: 'Daily', tone: 'neutral' },
  manual: { label: 'Manual', tone: 'accent' },
  'before-restore': { label: 'Before restore', tone: 'warning' },
  'before-update': { label: 'Before update', tone: 'success' }
};

function BackupRow({ backup, isOwner, canRestore }: { backup: BackupInfo; isOwner: boolean; canRestore: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const kind = KIND_LABELS[backup.kind];

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/backups/${backup.name}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
    onError: (error) => toast.error(error)
  });

  const restore = useMutation({
    mutationFn: () => api.post<{ safety: string }>(`/api/backups/${backup.name}/restore`),
    onSuccess: () => toast.success('Restoring… the bot restarts now and is back in a few seconds.'),
    onError: (error) => toast.error(error)
  });

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Database className="size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">{formatDateTime(backup.createdAt)} <Badge tone={kind.tone}>{kind.label}</Badge></div>
        <div className="truncate font-mono text-[11px] text-muted">{backup.name} · {formatBytes(backup.size)}</div>
      </div>
      {isOwner && (
        <div className="flex shrink-0 gap-1">
          <a href={`/api/backups/${backup.name}/download`} download><Button variant="ghost" size="sm"><Download className="size-3.5" />Download</Button></a>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canRestore}
            loading={restore.isPending}
            onClick={async () => {
              if (await confirm({
                title: 'Restore this backup?',
                description: `Everything (settings, pins, reminders, playlists, …) goes back to ${formatDateTime(backup.createdAt)}. The current data is saved as a backup first, and the bot restarts.`,
                confirmLabel: 'Restore',
                danger: true
              })) restore.mutate();
            }}
          >
            <RotateCcw className="size-3.5" />Restore
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete backup"
            loading={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Delete this backup?', description: backup.name, confirmLabel: 'Delete', danger: true })) remove.mutate();
            }}
          >
            {!remove.isPending && <Trash2 className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

function BackupsCard({ settings, isOwner }: { settings: BotSettings; isOwner: boolean }) {
  const toast = useToast();
  const save = useSaveSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(settings.backups);
  useEffect(() => setForm(settings.backups), [settings.backups]);

  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupOverview>('/api/backups') });
  const create = useMutation({
    mutationFn: () => api.post<BackupInfo>('/api/backups'),
    onSuccess: (backup) => {
      toast.success(`Backup saved (${formatBytes(backup.size)})`);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error) => toast.error(error)
  });

  const changed = JSON.stringify(form) !== JSON.stringify(settings.backups);

  return (
    <Card>
      <CardHeader
        title="Database backups"
        description="Copies of data/luko.db with all settings, pins, reminders, birthdays, polls and playlists"
        icon={<History className="size-4" />}
        actions={<Button size="sm" onClick={() => create.mutate()} loading={create.isPending}><Save className="size-3.5" />Back up now</Button>}
      />
      <CardBody className="space-y-1 py-1">
        <SettingRow
          title="Daily backup"
          description={data?.lastAutoBackup ? `Last one ${timeAgo(data.lastAutoBackup)}` : 'Saves a copy once a day at the chosen time (server time)'}
        >
          <Switch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="Daily backup" />
        </SettingRow>
        <SettingRow title="Time">
          <Select className="w-28" value={form.hour} disabled={!form.enabled} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
            {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </Select>
        </SettingRow>
        <SettingRow title="Keep" description="Older daily backups are deleted automatically. Manual ones stay until you delete them.">
          <span className="flex items-center gap-2 text-sm">
            <Input type="number" min={1} max={90} className="w-20" value={form.keep} disabled={!form.enabled} onChange={(e) => setForm({ ...form, keep: Number(e.target.value) })} />
            days
          </span>
        </SettingRow>
        {changed && (
          <div className="flex justify-end pb-3">
            <Button variant="secondary" size="sm" onClick={() => save.mutate({ section: 'backups', value: form })} loading={save.isPending}><Save className="size-3.5" />Save</Button>
          </div>
        )}
      </CardBody>

      <div className="border-t border-border">
        {!data ? <PageLoader /> : data.backups.length === 0 ? (
          <EmptyState icon={<Database className="size-5" />} title="No backups yet" description="Create one now, or wait for the daily backup." />
        ) : (
          <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {data.backups.map(backup => <BackupRow key={backup.name} backup={backup} isOwner={isOwner} canRestore={data.canRestore} />)}
          </div>
        )}
        {data && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted">
            <span>Database: {formatBytes(data.databaseSize)} · stored in <code>{data.dir}</code></span>
            {isOwner && !data.canRestore && <span>Restoring needs the bot to run under pm2.</span>}
            {!isOwner && <span>Only the owner can download, restore or delete backups.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- Alerts ----------

const ALERT_KINDS: { key: 'lavalinkDown' | 'errors' | 'disk' | 'temperature' | 'updates' | 'backups'; title: string; description: string }[] = [
  { key: 'lavalinkDown', title: 'Lavalink down', description: 'No connection to Lavalink for 2 minutes (and when it is back)' },
  { key: 'errors', title: 'Many errors', description: '5 or more errors within 10 minutes, with the latest ones' },
  { key: 'disk', title: 'Disk almost full', description: 'At most once every 12 hours' },
  { key: 'temperature', title: 'CPU hot', description: 'Linux / Raspberry Pi only, at most once an hour' },
  { key: 'updates', title: 'New update', description: 'Once per new version on GitHub' },
  { key: 'backups', title: 'Backup failed', description: 'When the daily backup could not be written' }
];

function AlertsCard({ settings }: { settings: BotSettings }) {
  const toast = useToast();
  const save = useSaveSettings();
  const [form, setForm] = useState(settings.alerts);
  useEffect(() => setForm(settings.alerts), [settings.alerts]);

  const test = useMutation({
    mutationFn: () => api.post('/api/alerts/test'),
    onSuccess: () => toast.success('Test alert sent. Check your Discord DMs.'),
    onError: (error) => toast.error(error)
  });

  const changed = JSON.stringify(form) !== JSON.stringify(settings.alerts);

  return (
    <Card>
      <CardHeader
        title="Alerts"
        description="Get a Discord DM (to OWNER_ID) when something needs your attention"
        icon={<BellRing className="size-4" />}
        actions={<Switch checked={form.enabled} onChange={(enabled) => save.mutate({ section: 'alerts', value: { ...form, enabled } })} label="Alerts" />}
      />
      <CardBody className={cn('space-y-1 py-1', !form.enabled && 'opacity-60')}>
        {ALERT_KINDS.map(kind => (
          <SettingRow key={kind.key} title={kind.title} description={kind.description}>
            <span className="flex items-center gap-3">
              {kind.key === 'disk' && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  from <Input type="number" min={50} max={99} className="h-8 w-16 text-xs" value={form.diskPercent} disabled={!form.enabled || !form.disk} onChange={(e) => setForm({ ...form, diskPercent: Number(e.target.value) })} />%
                </span>
              )}
              {kind.key === 'temperature' && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  from <Input type="number" min={40} max={100} className="h-8 w-16 text-xs" value={form.temperatureC} disabled={!form.enabled || !form.temperature} onChange={(e) => setForm({ ...form, temperatureC: Number(e.target.value) })} />°C
                </span>
              )}
              <Switch checked={form[kind.key]} disabled={!form.enabled} onChange={(on) => setForm({ ...form, [kind.key]: on })} label={kind.title} />
            </span>
          </SettingRow>
        ))}
        <div className="flex flex-wrap justify-end gap-2 py-3">
          <Button variant="outline" size="sm" onClick={() => test.mutate()} loading={test.isPending} disabled={!settings.alerts.enabled}><Send className="size-3.5" />Send test alert</Button>
          {changed && <Button variant="secondary" size="sm" onClick={() => save.mutate({ section: 'alerts', value: form })} loading={save.isPending}><Save className="size-3.5" />Save</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

export function MaintenancePage({ user }: { user: PanelUser }) {
  const { data } = useSettings();
  const isOwner = user.role === 'owner';

  if (!data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance" description="Updates, backups and alerts for the server the bot runs on" />
      <UpdatesCard isOwner={isOwner} />
      <div className="grid gap-6 xl:grid-cols-2">
        <BackupsCard settings={data.settings} isOwner={isOwner} />
        <AlertsCard settings={data.settings} />
      </div>
    </div>
  );
}
