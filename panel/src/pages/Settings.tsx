import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Cpu, Globe, KeyRound, Music, Network, Power, Save, Server, Shield, ToggleLeft, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthConfig } from '../lib/auth';
import { useSaveSettings, useSettings } from '../lib/settings';
import { formatBytes, formatDateTime, formatUptime } from '../lib/utils';
import type { BotSettings, PanelUser, SystemInfo } from '../lib/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  SettingRow,
  Switch,
  useConfirm,
  useToast
} from '../components/ui';

interface DiscordUserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

function FeaturesCard({ settings }: { settings: BotSettings }) {
  const save = useSaveSettings();
  const features = settings.features;
  const update = (patch: Partial<BotSettings['features']>) => save.mutate({ section: 'features', value: { ...features, ...patch } });

  return (
    <Card>
      <CardHeader title="Features" description="Turn whole parts of the bot on or off" icon={<ToggleLeft className="size-4" />} />
      <CardBody className="divide-y divide-border py-1">
        <SettingRow title="Music" description="All music commands. Turning music on after the bot started needs a restart.">
          <Switch checked={features.music} onChange={(music) => update({ music })} label="Music" />
        </SettingRow>
        <SettingRow title="Pinboard" description="Repost messages with enough reactions to the pinboard channel">
          <Switch checked={features.pinboard} onChange={(pinboard) => update({ pinboard })} label="Pinboard" />
        </SettingRow>
        <SettingRow title="Reminders" description="The /remind command (existing reminders are still delivered)">
          <Switch checked={features.reminders} onChange={(reminders) => update({ reminders })} label="Reminders" />
        </SettingRow>
        <SettingRow title="Birthdays" description="The /birthday command and the daily birthday messages">
          <Switch checked={features.birthdays} onChange={(birthdays) => update({ birthdays })} label="Birthdays" />
        </SettingRow>
        <SettingRow title="Polls" description="The /poll command (running polls still end on time)">
          <Switch checked={features.polls} onChange={(polls) => update({ polls })} label="Polls" />
        </SettingRow>
        <SettingRow title="Music history" description="Record every played song for the music stats and /history">
          <Switch checked={features.musicHistory} onChange={(musicHistory) => update({ musicHistory })} label="Music history" />
        </SettingRow>
        <SettingRow
          title={<span className="flex items-center gap-2">Full member list <Badge tone="warning">Restart required</Badge></span>}
          description={
            <>
              Lets the panel list every member of a server (for example when picking who to remind). First turn on
              <b> Server Members Intent</b> in the Discord Developer Portal (your app → Bot → Privileged Gateway Intents),
              then switch this on and restart. If the portal setting is off, Discord refuses the bot's login.
            </>
          }
        >
          <Switch checked={settings.intents.members} onChange={(members) => save.mutate({ section: 'intents', value: { members } })} label="Full member list" />
        </SettingRow>
      </CardBody>
    </Card>
  );
}

function MusicCard({ settings }: { settings: BotSettings }) {
  const save = useSaveSettings();
  const [music, setMusic] = useState(settings.music);

  useEffect(() => setMusic(settings.music), [settings.music]);

  return (
    <Card>
      <CardHeader title="Music" icon={<Music className="size-4" />} />
      <CardBody className="space-y-5">
        <div className="divide-y divide-border">
          <SettingRow title="Auto-delete music replies" description="Keeps channels clean by removing the bot's music command responses">
            <Switch checked={music.autoDeleteResponses} onChange={(autoDeleteResponses) => setMusic({ ...music, autoDeleteResponses })} label="Auto-delete" />
          </SettingRow>
          <SettingRow title="Delete after (seconds)">
            <Input type="number" min={5} max={600} className="w-24" value={music.autoDeleteSeconds} disabled={!music.autoDeleteResponses} onChange={(e) => setMusic({ ...music, autoDeleteSeconds: Number(e.target.value) })} />
          </SettingRow>
          <SettingRow title="Leave when alone" description="Disconnect when everyone else leaves the voice channel">
            <Switch checked={music.leaveWhenAlone} onChange={(leaveWhenAlone) => setMusic({ ...music, leaveWhenAlone })} label="Leave when alone" />
          </SettingRow>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => save.mutate({ section: 'music', value: music })} loading={save.isPending && save.variables?.section === 'music'}>
            <Save className="size-4" />Save music settings
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-5 text-sm">
          <span className="text-muted">Lavalink connection, stats, config and YouTube sign-in</span>
          <Link to="/lavalink"><Button variant="outline" size="sm">Open Lavalink page</Button></Link>
        </div>
      </CardBody>
    </Card>
  );
}

function AdminRow({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const { data } = useQuery({ queryKey: ['user', id], queryFn: () => api.get<DiscordUserInfo>(`/api/users/${id}`), staleTime: 300_000, retry: false });
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2">
      <Avatar src={data?.avatarUrl} name={data?.displayName ?? id} className="size-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{data?.displayName ?? 'Unknown user'}</div>
        <div className="truncate font-mono text-xs text-muted">{data ? `@${data.username} · ` : ''}{id}</div>
      </div>
      {onRemove
        ? <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove admin"><Trash2 className="size-4" /></Button>
        : <Badge tone="accent">Owner</Badge>}
    </div>
  );
}

function PanelAccessCard({ settings, ownerId, isOwner }: { settings: BotSettings; ownerId: string | null; isOwner: boolean }) {
  const save = useSaveSettings();
  const toast = useToast();
  const { data: config } = useAuthConfig();
  const [panel, setPanel] = useState(settings.panel);
  const [newAdmin, setNewAdmin] = useState('');

  useEffect(() => setPanel(settings.panel), [settings.panel]);

  const addAdmin = (event: FormEvent) => {
    event.preventDefault();
    const id = newAdmin.trim();
    if (!/^\d{15,25}$/.test(id)) {
      toast.error('Enter a Discord user ID (a long number).');
      return;
    }
    if (id === ownerId || panel.adminIds.includes(id)) {
      toast.info('That user already has access.');
      return;
    }
    const next = { ...panel, adminIds: [...panel.adminIds, id] };
    setPanel(next);
    save.mutate({ section: 'panel', value: next });
    setNewAdmin('');
  };

  const removeAdmin = (id: string) => {
    const next = { ...panel, adminIds: panel.adminIds.filter(a => a !== id) };
    setPanel(next);
    save.mutate({ section: 'panel', value: next });
  };

  if (!isOwner) {
    return (
      <Card>
        <CardHeader title="Panel access" icon={<Shield className="size-4" />} />
        <CardBody><Notice>Only the bot owner can change who has access to this panel and how it is reached.</Notice></CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Panel access" description="Who can log in, and how the panel is reached" icon={<Shield className="size-4" />} />
      <CardBody className="space-y-6">
        <div>
          <div className="mb-1 text-sm font-medium">Admins</div>
          <p className="mb-3 text-xs text-muted">
            The owner (<code>OWNER_ID</code> in .env) always has access. Admins log in with Discord and can use everything except this section and restarting.
          </p>
          <div className="space-y-2">
            {ownerId && <AdminRow id={ownerId} />}
            {panel.adminIds.map(id => <AdminRow key={id} id={id} onRemove={() => removeAdmin(id)} />)}
          </div>
          <form onSubmit={addAdmin} className="mt-3 flex gap-2">
            <Input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder="Discord user ID" />
            <Button type="submit" variant="secondary"><UserPlus className="size-4" />Add admin</Button>
          </form>
        </div>

        <div className="border-t border-border pt-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">Web access <Badge tone="warning">Restart required</Badge></div>

          {config?.mode === 'local' ? (
            <Notice tone="warning" title="Local network mode" className="mb-4">
              No domain is configured. With the current local setup, the panel and the login only work via the server's IP
              address{config.lanUrls[0] ? ` (e.g. ${config.lanUrls[0]})` : ''}, from devices on the same network. Requests from outside the local network are blocked.
            </Notice>
          ) : (
            <Notice tone="success" title="Domain mode" className="mb-4">
              The panel is served at {settings.panel.publicUrl}. Put a reverse proxy with HTTPS (for example Caddy or nginx) in front of port {settings.panel.port}.
            </Notice>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              label={<span className="flex items-center gap-1.5"><Globe className="size-3.5" />Public URL (domain)</span>}
              hint="Leave empty for local network mode, e.g. https://panel.example.com"
            >
              <Input value={panel.publicUrl} onChange={(e) => setPanel({ ...panel, publicUrl: e.target.value })} placeholder="https://panel.example.com" />
            </Field>
            <Field label="Listen address" hint="0.0.0.0 = all network interfaces">
              <Input value={panel.host} onChange={(e) => setPanel({ ...panel, host: e.target.value })} />
            </Field>
            <Field label="Port"><Input type="number" value={panel.port} onChange={(e) => setPanel({ ...panel, port: Number(e.target.value) })} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted">
            For Discord login, add <code>{(panel.publicUrl || config?.lanUrls[0] || `http://<server-ip>:${panel.port}`).replace(/\/+$/, '')}/auth/callback</code> as
            a redirect in the Discord Developer Portal (OAuth2 → Redirects).
          </p>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => save.mutate({ section: 'panel', value: panel })} loading={save.isPending}>
              <Save className="size-4" />Save web access
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function SystemCard({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/api/system'), refetchInterval: 30_000 });

  const restart = useMutation({
    mutationFn: () => api.post('/api/system/restart'),
    onSuccess: () => {
      toast.info('Restarting… the panel reconnects automatically.');
      setTimeout(() => window.location.reload(), 8000);
    },
    onError: (error) => toast.error(error)
  });

  if (!system) return <Card><PageLoader /></Card>;

  const rows: [string, string][] = [
    ['Luko', `v${system.botVersion}`],
    ['Node.js', system.nodeVersion],
    ['discord.js', `v${system.discordJsVersion}`],
    ['Platform', system.platform],
    ['Host name', system.hostname],
    ['Process ID', String(system.pid)],
    ['Bot started', formatDateTime(system.startedAt)],
    ['System uptime', formatUptime(system.osUptime)],
    ['System memory', `${formatBytes(system.totalMemory - system.freeMemory)} / ${formatBytes(system.totalMemory)}`],
    ['CPU cores', String(system.cpuCount)],
    ['Managed by pm2', system.pm2 ? 'Yes' : 'No'],
    ['Database', system.databasePath]
  ];

  return (
    <Card>
      <CardHeader title="System" icon={<Cpu className="size-4" />} />
      <CardBody className="space-y-5">
        <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 justify-between gap-4 border-b border-border/60 pb-2">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 truncate text-right font-medium" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        {isOwner && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2/60 p-4">
            <div>
              <div className="text-sm font-medium">Restart the bot</div>
              <div className="text-xs text-muted">{system.pm2 ? 'pm2 starts the bot again right away.' : 'Only available when the bot runs under pm2 (npm run pm2:start).'}</div>
            </div>
            <Button
              variant="danger"
              disabled={!system.pm2}
              loading={restart.isPending}
              onClick={async () => {
                if (await confirm({ title: 'Restart the bot?', description: 'Music stops and the bot is offline for a few seconds.', confirmLabel: 'Restart', danger: true })) {
                  restart.mutate();
                }
              }}
            >
              <Power className="size-4" />Restart
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function SettingsPage({ user }: { user: PanelUser }) {
  const { data } = useSettings();
  if (!data) return <PageLoader />;

  const isOwner = user.role === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={<>Stored in the database (<code>data/luko.db</code>). Secrets (tokens, passwords) stay in <code>.env</code>.</>} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <FeaturesCard settings={data.settings} />
          <MusicCard settings={data.settings} />
        </div>
        <div className="min-w-0 space-y-6">
          <PanelAccessCard settings={data.settings} ownerId={data.ownerId} isOwner={isOwner} />
          <SystemCard isOwner={isOwner} />
          <Card>
            <CardHeader title="Secrets in .env" icon={<KeyRound className="size-4" />} />
            <CardBody className="space-y-2 text-xs text-muted">
              <p><code>DISCORD_TOKEN</code>, <code>CLIENT_ID</code>, <code>OWNER_ID</code>, <code>DEV_GUILD_ID</code>: bot identity</p>
              <p><code>DISCORD_CLIENT_SECRET</code>: enables "Continue with Discord" on the login page</p>
              <p><code>PANEL_PASSWORD</code>: enables password login (signs in as the owner)</p>
              <p><code>LAVALINK_PASSWORD</code>: password of your Lavalink server</p>
              <p className="flex items-center gap-1.5 pt-1"><Server className="size-3.5" /><Network className="size-3.5" />Changes to .env need a restart.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
