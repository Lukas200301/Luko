import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileCode,
  KeyRound,
  Play,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  Settings2,
  Square,
  Terminal,
  Trash2,
  XCircle,
  MonitorPlay
} from 'lucide-react';
import { api } from '../lib/api';
import { useSaveSettings, useSettings } from '../lib/settings';
import { cn, formatBytes, formatTime, formatUptime, timeAgo } from '../lib/utils';
import type {
  BotSettings,
  ClientTestResult,
  LavalinkConfig,
  LavalinkNodeDetail,
  LavalinkOverview,
  ResamplingQuality,
  YoutubeAuthStatus
} from '../lib/types';
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
  Select,
  SettingRow,
  StatusDot,
  Switch,
  Tabs,
  Textarea,
  useConfirm,
  useToast
} from '../components/ui';
import { useMe } from '../lib/auth';

const SOURCES: { key: keyof LavalinkConfig['sources']; label: string }[] = [
  { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'bandcamp', label: 'Bandcamp' },
  { key: 'twitch', label: 'Twitch' },
  { key: 'vimeo', label: 'Vimeo' },
  { key: 'nico', label: 'Niconico' },
  { key: 'http', label: 'Direct links (HTTP)' },
  { key: 'local', label: 'Local files' }
];

const CLIENT_NOTES: Record<string, string> = {
  MUSIC: 'Search only (needed for /play)',
  TV: 'Plays with YouTube sign-in',
  TVHTML5_SIMPLY: 'Plays without sign-in',
  WEB: 'Plays, needs cipher server',
  MWEB: 'Plays, needs cipher server',
  WEBEMBEDDED: 'Embeddable videos only',
  ANDROID_VR: 'Plays, often blocked',
  ANDROID_MUSIC: 'Often blocked',
  ANDROID: 'Often broken',
  IOS: 'No Opus, needs transcoding'
};

function useOverview() {
  return useQuery({ queryKey: ['lavalink'], queryFn: () => api.get<LavalinkOverview>('/api/lavalink'), refetchInterval: 5000 });
}

function Meter({ label, value, max, format }: { label: string; value: number; max: number; format: (n: number) => string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-medium tabular-nums">{format(value)} / {format(max)}</span></div>
      <div className="h-1.5 rounded-full bg-border"><div className={cn('h-full rounded-full', percent > 85 ? 'bg-danger' : percent > 65 ? 'bg-warning' : 'bg-accent')} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function NodeCard({ node }: { node: LavalinkNodeDetail }) {
  const stats = node.stats;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><StatusDot online={node.connected} />{node.name}</span>}
        description={node.info ? `Lavalink ${node.info.version} · ${node.info.jvm} · Lavaplayer ${node.info.lavaplayer}` : 'Server info unavailable'}
        icon={<Server className="size-4" />}
        actions={<Badge tone={node.connected ? 'success' : 'danger'} className="capitalize">{node.state}</Badge>}
      />
      <CardBody className="space-y-5">
        {stats ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Players', value: `${stats.playingPlayers} / ${stats.players}`, hint: 'playing / total' },
                { label: 'Uptime', value: formatUptime(stats.uptime) },
                { label: 'CPU cores', value: String(stats.cpu.cores) },
                { label: 'Frames / min', value: stats.frameStats ? String(stats.frameStats.sent) : '—', hint: stats.frameStats ? `${stats.frameStats.nulled} nulled · ${stats.frameStats.deficit} deficit` : 'no active players' }
              ].map(item => (
                <div key={item.label} className="rounded-lg bg-surface-2/60 p-3">
                  <div className="text-xs text-muted">{item.label}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{item.value}</div>
                  {item.hint && <div className="text-[11px] text-muted">{item.hint}</div>}
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Meter label="Lavalink CPU" value={stats.cpu.lavalinkLoad * 100} max={100} format={(n) => `${n.toFixed(1)}%`} />
              <Meter label="System CPU" value={stats.cpu.systemLoad * 100} max={100} format={(n) => `${n.toFixed(1)}%`} />
              <Meter label="Memory used" value={stats.memory.used} max={stats.memory.allocated} format={formatBytes} />
              <Meter label="Memory allocated" value={stats.memory.allocated} max={stats.memory.reservable} format={formatBytes} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No statistics yet. They arrive about once a minute after connecting.</p>
        )}
        {node.info && (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5"><span className="w-16 text-muted">Plugins</span>{node.info.plugins.length === 0 ? <span className="text-muted">none</span> : node.info.plugins.map(p => <Badge key={p.name} tone="accent">{p.name} {p.version}</Badge>)}</div>
            <div className="flex flex-wrap items-center gap-1.5"><span className="w-16 text-muted">Sources</span>{node.info.sourceManagers.map(s => <Badge key={s}>{s}</Badge>)}</div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ConnectionCard({ connection }: { connection: BotSettings['lavalink'] }) {
  const save = useSaveSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(connection);
  useEffect(() => setForm(connection), [connection]);

  const reconnect = useMutation({
    mutationFn: () => api.post('/api/lavalink/reconnect'),
    onSuccess: () => { toast.success('Reconnecting to Lavalink…'); queryClient.invalidateQueries({ queryKey: ['lavalink'] }); },
    onError: (error) => toast.error(error)
  });

  return (
    <Card>
      <CardHeader
        title="Connection"
        description="Where the bot finds Lavalink. Saving reconnects right away (active music sessions stop)."
        icon={<Plug className="size-4" />}
        actions={<Button size="sm" variant="outline" onClick={() => reconnect.mutate()} loading={reconnect.isPending}><RefreshCw className="size-3.5" />Reconnect</Button>}
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Field label="Host" hint="localhost when Lavalink runs on this machine"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field>
          <Field label="Port"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></Field>
          <Field label="Node name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="TLS (wss/https)"><div className="pt-1.5"><Switch checked={form.secure} onChange={(secure) => setForm({ ...form, secure })} label="TLS" /></div></Field>
        </div>
        <p className="text-xs text-muted">The password comes from <code>LAVALINK_PASSWORD</code> in <code>.env</code>.</p>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate({ section: 'lavalink', value: form }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lavalink'] }) })} loading={save.isPending}>
            <Save className="size-4" />Save & reconnect
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function YoutubeCard({ installed, isOwner, connected }: { installed: boolean; isOwner: boolean; connected: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<{ track: string; results: ClientTestResult[] } | null>(null);

  const { data: auth } = useQuery({
    queryKey: ['youtube-auth'],
    queryFn: () => api.get<YoutubeAuthStatus>('/api/lavalink/youtube/auth'),
    refetchInterval: (query) => (query.state.data?.oauthEnabled && !query.state.data?.tokenStored ? 3000 : 15000)
  });

  const test = useMutation({
    mutationFn: () => api.post<{ track: string; results: ClientTestResult[] }>('/api/lavalink/youtube/test'),
    onSuccess: setResults,
    onError: (error) => toast.error(error)
  });

  const startSignIn = useMutation({
    mutationFn: async () => {
      const { config } = await api.get<{ config: LavalinkConfig }>('/api/lavalink/local/config');
      await api.put('/api/lavalink/local/config', { ...config, youtube: { ...config.youtube, oauthEnabled: true } });
      await api.post('/api/lavalink/local/restart');
    },
    onSuccess: () => {
      toast.info('Lavalink is restarting with YouTube sign-in enabled. The code appears here in a few seconds.');
      queryClient.invalidateQueries({ queryKey: ['youtube-auth'] });
      queryClient.invalidateQueries({ queryKey: ['lavalink-config'] });
    },
    onError: (error) => toast.error(error)
  });

  const saveToken = useMutation({
    mutationFn: () => api.post('/api/lavalink/youtube/save-token'),
    onSuccess: () => { toast.success('Sign-in saved. It stays active after Lavalink restarts.'); queryClient.invalidateQueries({ queryKey: ['youtube-auth'] }); },
    onError: (error) => toast.error(error)
  });

  const signOut = useMutation({
    mutationFn: async () => { await api.post('/api/lavalink/youtube/sign-out'); await api.post('/api/lavalink/local/restart'); },
    onSuccess: () => { toast.success('YouTube sign-in removed. Lavalink is restarting.'); queryClient.invalidateQueries({ queryKey: ['youtube-auth'] }); },
    onError: (error) => toast.error(error)
  });

  const signedIn = auth?.tokenStored;
  const waitingForCode = auth?.oauthEnabled && !signedIn;

  return (
    <Card>
      <CardHeader
        title="YouTube"
        description="YouTube often blocks playback for servers that aren't signed in. Test which clients work and sign in if needed."
        icon={<MonitorPlay className="size-4" />}
        actions={<Button size="sm" variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={!connected}><Play className="size-3.5" />Test playback</Button>}
      />
      <CardBody className="space-y-5">
        {results && (
          <div>
            <div className="mb-2 text-xs text-muted">Tried to stream <b className="text-fg">{results.track}</b> with each client:</div>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {results.results.map(r => (
                <div key={r.client} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {r.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                  <span className="w-36 font-mono text-xs">{r.client}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-xs', r.ok ? 'text-success' : 'text-muted')} title={r.message}>{r.message}</span>
                </div>
              ))}
            </div>
            {results.results.every(r => !r.ok) && (
              <Notice tone="warning" className="mt-3" title="No client can play right now">
                YouTube is blocking playback from this server. Signing in with a spare Google account (below) is the most reliable fix.
              </Notice>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-muted" />YouTube sign-in (OAuth)</div>
          {!installed ? (
            <p className="text-xs leading-relaxed text-muted">
              Lavalink isn't installed next to the bot, so the sign-in can't be set up from here. On the Lavalink server, set
              <code> plugins.youtube.oauth.enabled: true</code> in <code>application.yml</code>, add <code>TV</code> to the clients,
              restart it and follow the code shown in its log.
            </p>
          ) : signedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-success" />Signed in. The token is saved in <code>application.yml</code>.
                {auth?.tokenActive === false && <Badge tone="warning">Lavalink doesn't use it yet, restart it</Badge>}
              </div>
              {isOwner && <Button size="sm" variant="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending}><Trash2 className="size-3.5" />Sign out</Button>}
            </div>
          ) : waitingForCode ? (
            <div className="space-y-3">
              {auth?.deviceCode ? (
                <>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                    <li>Open <a href={auth.verificationUrl ?? 'https://www.google.com/device'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">google.com/device <ExternalLink className="size-3" /></a></li>
                    <li>Sign in with a <b>spare</b> Google account (not your main one) and enter this code:</li>
                  </ol>
                  <div className="flex items-center gap-3">
                    <code className="rounded-lg bg-surface-2 px-4 py-2 text-xl font-semibold tracking-widest">{auth.deviceCode}</code>
                    {auth.codeShownAt && <span className="text-xs text-muted">shown {timeAgo(auth.codeShownAt)}</span>}
                  </div>
                  <p className="text-xs text-muted">3. When Google says you're done, click <b>Save sign-in</b>. Codes expire after a while; restart Lavalink to get a new one.</p>
                </>
              ) : (
                <p className="text-sm text-muted">Waiting for Lavalink to show a sign-in code… (this takes a few seconds after the restart)</p>
              )}
              {isOwner && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => saveToken.mutate()} loading={saveToken.isPending} disabled={!auth?.tokenActive}>
                    <Save className="size-3.5" />Save sign-in
                  </Button>
                  {!auth?.tokenActive && <span className="self-center text-xs text-muted">Enabled once Google confirms the sign-in</span>}
                  <Button size="sm" variant="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending}>Cancel</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted">
                Lavalink plays YouTube through a Google account, which gets past most bot checks. <b>Use a spare account</b>: YouTube can
                restrict accounts used like this. Lavalink restarts to show a sign-in code.
              </p>
              {isOwner && <Button size="sm" onClick={() => startSignIn.mutate()} loading={startSignIn.isPending}><KeyRound className="size-3.5" />Sign in to YouTube</Button>}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ProcessCard({ overview, isOwner }: { overview: LavalinkOverview; isOwner: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const local = overview.local;
  const process = local.process;

  const control = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart' | 'update') => api.post(`/api/lavalink/local/${action}`),
    onSuccess: (_, action) => {
      toast.success({ start: 'Lavalink is starting', stop: 'Lavalink stopped', restart: 'Lavalink is restarting', update: 'Update started. Progress shows in the log below.' }[action]);
      queryClient.invalidateQueries({ queryKey: ['lavalink'] });
    },
    onError: (error) => toast.error(error)
  });

  if (!local.installed) {
    return (
      <Card>
        <CardHeader title="Local Lavalink server" icon={<Power className="size-4" />} />
        <CardBody>
          <Notice title="Lavalink isn't installed next to the bot">
            To start, stop, configure and update Lavalink from here, install it on this machine with the setup script, from the bot folder:
            <code className="mt-2 block">powershell -ExecutionPolicy Bypass -File scripts/setup-lavalink.ps1</code>
            <code className="mt-1 block">bash scripts/setup-lavalink.sh</code>
            Lavalink on another machine still works; only stats and the connection settings are available then.
          </Notice>
        </CardBody>
      </Card>
    );
  }

  const online = process?.status === 'online';

  return (
    <Card>
      <CardHeader
        title="Local Lavalink server"
        description={`Installed in ${local.dir}${local.version ? ` · version ${local.version}` : ''}`}
        icon={<Power className="size-4" />}
        actions={<Badge tone={online ? 'success' : process ? 'warning' : 'neutral'}>{process ? process.status : 'not running in pm2'}</Badge>}
      />
      <CardBody className="space-y-4">
        {!local.pm2Available && <Notice tone="warning">pm2 isn't installed in the bot folder. Run <code>npm install</code>.</Notice>}
        {process && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Uptime', value: process.uptime ? formatUptime(process.uptime) : '—' },
              { label: 'Memory', value: process.memory > 0 ? formatBytes(process.memory) : '—' },
              { label: 'CPU', value: process.memory > 0 ? `${process.cpu}%` : '—' },
              { label: 'Restarts', value: String(process.restarts) }
            ].map(item => (
              <div key={item.label} className="rounded-lg bg-surface-2/60 p-3">
                <div className="text-xs text-muted">{item.label}</div>
                <div className="mt-1 font-semibold tabular-nums">{item.value}</div>
              </div>
            ))}
          </div>
        )}
        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            {!online && <Button size="sm" onClick={() => control.mutate('start')} loading={control.isPending && control.variables === 'start'}><Play className="size-3.5" />Start</Button>}
            {online && <Button size="sm" variant="secondary" onClick={() => control.mutate('restart')} loading={control.isPending && control.variables === 'restart'}><RotateCw className="size-3.5" />Restart</Button>}
            {online && (
              <Button size="sm" variant="secondary" onClick={async () => {
                if (await confirm({ title: 'Stop Lavalink?', description: 'Music stops on every server until it is started again.', confirmLabel: 'Stop', danger: true })) control.mutate('stop');
              }} loading={control.isPending && control.variables === 'stop'}><Square className="size-3.5" />Stop</Button>
            )}
            <Button size="sm" variant="outline" disabled={local.updateRunning} onClick={async () => {
              if (await confirm({ title: 'Update Lavalink?', description: 'Downloads the newest Lavalink and YouTube plugin, then restarts Lavalink. Music stops briefly.', confirmLabel: 'Update' })) control.mutate('update');
            }} loading={(control.isPending && control.variables === 'update') || local.updateRunning}><Download className="size-3.5" />{local.updateRunning ? 'Updating…' : 'Update'}</Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Only the bot owner can start, stop or update Lavalink.</p>
        )}
      </CardBody>
    </Card>
  );
}

function ClientList({ value, onChange, available }: { value: string[]; onChange: (v: string[]) => void; available: string[] }) {
  const move = (i: number, d: number) => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item);
    onChange(next);
  };
  const unused = available.filter(c => !value.includes(c));

  return (
    <div className="space-y-2">
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {value.map((c, i) => (
          <div key={c} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-5 text-xs text-muted tabular-nums">{i + 1}</span>
            <span className="w-36 font-mono text-xs">{c}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{CLIENT_NOTES[c]}</span>
            <Button variant="ghost" size="icon" className="size-7 justify-center" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" className="size-7 justify-center" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" className="size-7 justify-center" disabled={value.length <= 1} onClick={() => onChange(value.filter(v => v !== c))} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
      </div>
      {unused.length > 0 && (
        <Select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} className="w-60">
          <option value="">Add a client…</option>
          {unused.map(c => <option key={c} value={c}>{c} — {CLIENT_NOTES[c]}</option>)}
        </Select>
      )}
    </div>
  );
}

function ConfigCard({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'settings' | 'yaml'>('settings');
  const { data, isLoading } = useQuery({
    queryKey: ['lavalink-config'],
    queryFn: () => api.get<{ config: LavalinkConfig; raw: string; clients: string[] }>('/api/lavalink/local/config')
  });
  const [form, setForm] = useState<LavalinkConfig | null>(null);
  const [raw, setRaw] = useState('');

  useEffect(() => { if (data) { setForm(data.config); setRaw(data.raw); } }, [data]);

  const save = useMutation({
    mutationFn: async ({ restart }: { restart: boolean }) => {
      if (tab === 'yaml') await api.put('/api/lavalink/local/config/raw', { yaml: raw });
      else await api.put('/api/lavalink/local/config', form);
      if (restart) await api.post('/api/lavalink/local/restart');
    },
    onSuccess: (_, { restart }) => {
      toast.success(restart ? 'Saved. Lavalink is restarting.' : 'Saved. Restart Lavalink to apply the changes.');
      queryClient.invalidateQueries({ queryKey: ['lavalink-config'] });
      queryClient.invalidateQueries({ queryKey: ['lavalink'] });
    },
    onError: (error) => toast.error(error)
  });

  if (isLoading || !form) return <Card><PageLoader /></Card>;

  const set = (patch: Partial<LavalinkConfig>) => setForm({ ...form, ...patch });
  const setYoutube = (patch: Partial<LavalinkConfig['youtube']>) => setForm({ ...form, youtube: { ...form.youtube, ...patch } });

  return (
    <Card>
      <CardHeader
        title="Configuration"
        description="application.yml of the local Lavalink. Changes apply after a restart."
        icon={<Settings2 className="size-4" />}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'settings', label: 'Settings' }, { value: 'yaml', label: <span className="flex items-center gap-1"><FileCode className="size-3.5" />YAML</span> }]} />}
      />
      <CardBody className="space-y-6">
        {tab === 'settings' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Port" hint="Also change it under Connection"><Input type="number" value={form.port} onChange={(e) => set({ port: Number(e.target.value) })} /></Field>
              <Field label="Memory (MB)" hint="Java heap size"><Input type="number" min={256} step={256} value={form.memoryMB} onChange={(e) => set({ memoryMB: Number(e.target.value) })} /></Field>
              <Field label="Opus quality" hint="0 (fast) – 10 (best)"><Input type="number" min={0} max={10} value={form.opusEncodingQuality} onChange={(e) => set({ opusEncodingQuality: Number(e.target.value) })} /></Field>
              <Field label="Resampling quality">
                <Select value={form.resamplingQuality} onChange={(e) => set({ resamplingQuality: e.target.value as ResamplingQuality })}>
                  <option value="LOW">Low (fast)</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
                </Select>
              </Field>
              <Field label="Buffer (ms)"><Input type="number" value={form.bufferDurationMs} onChange={(e) => set({ bufferDurationMs: Number(e.target.value) })} /></Field>
              <Field label="Stuck threshold (ms)" hint="Skip a track that stalls this long"><Input type="number" value={form.trackStuckThresholdMs} onChange={(e) => set({ trackStuckThresholdMs: Number(e.target.value) })} /></Field>
              <Field label="Playlist page limit" hint="Pages of 100 tracks to load"><Input type="number" value={form.youtubePlaylistLoadLimit} onChange={(e) => set({ youtubePlaylistLoadLimit: Number(e.target.value) })} /></Field>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium">Sources</div>
              <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
                {SOURCES.map(s => (
                  <label key={s.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    {s.label}
                    <Switch checked={form.sources[s.key]} onChange={(v) => set({ sources: { ...form.sources, [s.key]: v } })} label={s.label} />
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-5">
              <SettingRow title="YouTube plugin" description="Needed for YouTube and YouTube Music (/play searches YouTube Music)">
                <Switch checked={form.youtube.enabled} onChange={(enabled) => setYoutube({ enabled })} label="YouTube plugin" />
              </SettingRow>
              <Field label="Clients (tried in this order)" hint="MUSIC is only used for searching. Run Test playback (above) to see which ones work for you.">
                <ClientList value={form.youtube.clients} onChange={(clients) => setYoutube({ clients })} available={data?.clients ?? []} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cipher server URL" hint={<>Decodes YouTube's stream signatures. Default: the public <code>https://cipher.kikkia.dev/</code>. Empty = built-in decoder (often broken).</>}>
                  <Input value={form.youtube.remoteCipherUrl} placeholder="https://cipher.kikkia.dev/" onChange={(e) => setYoutube({ remoteCipherUrl: e.target.value })} />
                </Field>
                <Field label="Cipher server password" hint="Only for a self-hosted server with API_TOKEN">
                  <Input type="password" value={form.youtube.remoteCipherPassword} onChange={(e) => setYoutube({ remoteCipherPassword: e.target.value })} />
                </Field>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} className="min-h-[28rem] font-mono text-xs leading-relaxed" />
            <p className="text-xs text-muted">Checked for valid YAML before saving. The password here must match <code>LAVALINK_PASSWORD</code> in the bot's <code>.env</code>.</p>
          </div>
        )}

        {isOwner ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => save.mutate({ restart: false })} loading={save.isPending && !save.variables?.restart}><Save className="size-4" />Save</Button>
            <Button onClick={() => save.mutate({ restart: true })} loading={save.isPending && !!save.variables?.restart}><RotateCw className="size-4" />Save & restart</Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Only the bot owner can change the Lavalink configuration.</p>
        )}
      </CardBody>
    </Card>
  );
}

function LogsCard() {
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['lavalink-logs'],
    queryFn: () => api.get<{ lines: string[] }>('/api/lavalink/local/logs?lines=400'),
    refetchInterval: 5000
  });

  const lines = useMemo(() => (data?.lines ?? []).filter(l => !filter || l.toLowerCase().includes(filter.toLowerCase())), [data, filter]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  return (
    <Card>
      <CardHeader
        title="Lavalink log"
        description={`Last 400 lines · refreshed ${formatTime(Date.now())}`}
        icon={<Terminal className="size-4" />}
        actions={
          <>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-8 w-44 text-xs" />
            <Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching}><RefreshCw className="size-3.5" /></Button>
          </>
        }
      />
      <div ref={ref} className="scrollbar-thin h-96 overflow-y-auto bg-surface-2/40 px-4 py-3 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? <div className="py-10 text-center text-muted">No log lines</div> : lines.map((line, i) => (
          <div key={i} className={cn('break-all whitespace-pre-wrap', /\bERROR\b/.test(line) ? 'text-danger' : /\bWARN\b/.test(line) ? 'text-warning' : 'text-fg/80')}>{line}</div>
        ))}
      </div>
    </Card>
  );
}

export function LavalinkPage() {
  const { data, isLoading } = useOverview();
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isOwner = me?.user?.role === 'owner';

  if (isLoading || !data) return <PageLoader />;

  const connected = data.nodes.some(n => n.connected);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lavalink"
        description={<>The music server the bot plays audio through · <code>{data.baseUrl}</code></>}
        actions={<Badge tone={connected ? 'success' : 'danger'} className="px-2.5 py-1 text-xs">{connected ? 'Connected' : 'Not connected'}</Badge>}
      />

      {!data.musicEnabled && <Notice tone="warning" title="Music is turned off">Turn on Music in Settings to connect to Lavalink.</Notice>}
      {data.restartRequired && <Notice tone="warning" title="Restart the bot">Music was turned on after the bot started. Restart the bot to connect to Lavalink.</Notice>}

      {data.nodes.length === 0 ? (
        <Card><EmptyState icon={<Cpu className="size-5" />} title="No Lavalink connection" description="Once music is on and the bot is running, the connection shows up here." /></Card>
      ) : data.nodes.map(node => <NodeCard key={node.name} node={node} />)}

      <div className="grid gap-6 lg:grid-cols-2">
        <ConnectionCard connection={settings?.settings.lavalink ?? data.connection} />
        <ProcessCard overview={data} isOwner={isOwner} />
      </div>

      <YoutubeCard installed={data.local.installed} isOwner={isOwner} connected={connected} />

      {data.local.installed && <ConfigCard isOwner={isOwner} />}
      {data.local.installed && <LogsCard />}
    </div>
  );
}

