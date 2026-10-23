import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Hash, LogOut, Music, Save, Search, Server, Shield, Smile, Users, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDateTime, formatNumber, timeAgo } from '../lib/utils';
import type { CommandInfo, GuildDetail } from '../lib/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  PageLoader,
  Switch,
  Tabs,
  useConfirm,
  useToast
} from '../components/ui';
import { useGuilds } from '../components/pickers';

function ServerList() {
  const { data: guilds = [], isLoading } = useGuilds();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(
    () => guilds.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()) || g.id.includes(filter)),
    [guilds, filter]
  );

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Servers"
        description={`Luko is in ${guilds.length} server${guilds.length === 1 ? '' : 's'}`}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search servers…" className="w-64 pl-9" />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <Card><EmptyState icon={<Server className="size-5" />} title="No servers found" /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(guild => (
            <Link key={guild.id} to={`/servers/${guild.id}`}>
              <Card className="flex items-center gap-4 p-4 transition hover:border-accent/40">
                <Avatar src={guild.iconUrl} name={guild.name} className="size-12 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{guild.name}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1"><Users className="size-3.5" />{formatNumber(guild.memberCount)}</span>
                    {guild.joinedAt && <span>joined {timeAgo(guild.joinedAt)}</span>}
                  </div>
                </div>
                {guild.hasQueue && <Badge tone="success"><Music className="size-3" />Playing</Badge>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ServerCommands({ guild }: { guild: GuildDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: commands = [] } = useQuery({ queryKey: ['commands'], queryFn: () => api.get<CommandInfo[]>('/api/commands') });
  const [disabled, setDisabled] = useState<Set<string>>(new Set(guild.disabledCommands));

  useEffect(() => setDisabled(new Set(guild.disabledCommands)), [guild.disabledCommands]);

  const save = useMutation({
    mutationFn: () => api.put(`/api/guilds/${guild.id}/commands`, { disabled: Array.from(disabled) }),
    onSuccess: () => {
      toast.success('Server commands saved');
      queryClient.invalidateQueries({ queryKey: ['guild', guild.id] });
      queryClient.invalidateQueries({ queryKey: ['commands'] });
    },
    onError: (error) => toast.error(error)
  });

  const visible = commands.filter(c => !c.private);

  return (
    <Card>
      <CardHeader
        title="Commands on this server"
        description="Turn off commands just for this server"
        actions={<Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="size-3.5" />Save</Button>}
      />
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
        {visible.map(command => (
          <div key={command.name} className="flex items-center justify-between gap-3 border-border px-5 py-2.5 sm:border-b">
            <div className="min-w-0">
              <div className="font-mono text-sm">/{command.name}</div>
              {!command.enabled && <div className="text-[11px] text-warning">Disabled everywhere</div>}
            </div>
            <Switch
              checked={!disabled.has(command.name)}
              onChange={(on) => {
                const next = new Set(disabled);
                if (on) next.delete(command.name); else next.add(command.name);
                setDisabled(next);
              }}
              label={`/${command.name}`}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ServerDetail({ guildId }: { guildId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'channels' | 'roles' | 'emojis' | 'permissions'>('channels');
  const [nickname, setNickname] = useState('');

  const { data: guild, isLoading } = useQuery({
    queryKey: ['guild', guildId],
    queryFn: () => api.get<GuildDetail>(`/api/guilds/${guildId}`)
  });

  useEffect(() => setNickname(guild?.botNickname ?? ''), [guild?.botNickname]);

  const saveNickname = useMutation({
    mutationFn: () => api.put(`/api/guilds/${guildId}/nickname`, { nickname }),
    onSuccess: () => {
      toast.success('Nickname updated');
      queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
    },
    onError: (error) => toast.error(error)
  });

  const leave = useMutation({
    mutationFn: () => api.post(`/api/guilds/${guildId}/leave`),
    onSuccess: () => {
      toast.success('Left the server');
      queryClient.invalidateQueries({ queryKey: ['guilds'] });
      navigate('/servers');
    },
    onError: (error) => toast.error(error)
  });

  if (isLoading) return <PageLoader />;
  if (!guild) return <Card><EmptyState icon={<Server className="size-5" />} title="Server not found" description="The bot may have left this server." /></Card>;

  const textChannels = guild.channels.filter(c => c.type !== 'voice' && c.type !== 'stage');
  const voiceChannels = guild.channels.filter(c => c.type === 'voice' || c.type === 'stage');

  return (
    <div className="space-y-6">
      <Link to="/servers" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />All servers</Link>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Avatar src={guild.iconUrl} name={guild.name} className="size-16 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{guild.name}</h1>
            {guild.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{guild.description}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge><Users className="size-3" />{formatNumber(guild.memberCount)} members</Badge>
              <Badge><Hash className="size-3" />{guild.channels.length} channels</Badge>
              {guild.boostTier > 0 && <Badge tone="accent">Boost level {guild.boostTier} · {guild.boosts} boosts</Badge>}
              {guild.hasQueue && <Badge tone="success"><Music className="size-3" />Music playing</Badge>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(guild.id); toast.success('Server ID copied'); }}>
            <Copy className="size-3.5" />Copy ID
          </Button>
        </div>
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          <div className="bg-surface px-5 py-3"><div className="text-xs text-muted">Created</div><div className="text-sm">{formatDateTime(guild.createdAt)}</div></div>
          <div className="bg-surface px-5 py-3"><div className="text-xs text-muted">Bot joined</div><div className="text-sm">{guild.joinedAt ? formatDateTime(guild.joinedAt) : '—'}</div></div>
          <div className="bg-surface px-5 py-3"><div className="text-xs text-muted">Owner ID</div><div className="font-mono text-sm">{guild.ownerId}</div></div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Bot nickname" description="Shown instead of the bot's username on this server" />
          <CardBody className="flex gap-2">
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={32} placeholder="Default name" />
            <Button onClick={() => saveNickname.mutate()} loading={saveNickname.isPending}>Save</Button>
          </CardBody>
        </Card>

        <Card className="border-danger/30">
          <CardHeader title="Leave server" description="The bot leaves this server. It can only come back with a new invite." />
          <CardBody>
            <Button
              variant="danger"
              loading={leave.isPending}
              onClick={async () => {
                if (await confirm({ title: `Leave ${guild.name}?`, description: 'This cannot be undone from the panel.', confirmLabel: 'Leave server', danger: true })) {
                  leave.mutate();
                }
              }}
            >
              <LogOut className="size-4" />Leave server
            </Button>
          </CardBody>
        </Card>
      </div>

      <ServerCommands guild={guild} />

      <Card>
        <CardHeader
          title="Details"
          actions={
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'channels', label: `Channels (${guild.channels.length})` },
                { value: 'roles', label: `Roles (${guild.roles.length})` },
                { value: 'emojis', label: `Emojis (${guild.emojis.length})` },
                { value: 'permissions', label: 'Bot permissions' }
              ]}
            />
          }
        />
        <CardBody>
          {tab === 'channels' && (
            <div className="grid gap-6 md:grid-cols-2">
              {[{ title: 'Text', icon: <Hash className="size-3.5" />, items: textChannels }, { title: 'Voice', icon: <Volume2 className="size-3.5" />, items: voiceChannels }].map(group => (
                <div key={group.title}>
                  <div className="mb-2 text-xs font-medium text-muted">{group.title} channels</div>
                  <div className="space-y-1">
                    {group.items.map(channel => (
                      <div key={channel.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                        <span className="flex min-w-0 items-center gap-2"><span className="text-muted">{group.icon}</span><span className="truncate">{channel.name}</span></span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                          {channel.parentName && <span className="hidden sm:inline">{channel.parentName}</span>}
                          {channel.members !== undefined && channel.members > 0 && <Badge tone="success">{channel.members}</Badge>}
                          {group.title === 'Text' && !channel.sendable && <Badge tone="warning">No access</Badge>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'roles' && (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {guild.roles.map(role => (
                <div key={role.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: role.color === '#000000' ? 'var(--muted)' : role.color }} />
                    <span className="truncate">{role.name}</span>
                  </span>
                  <span className="text-xs text-muted">{role.members}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'emojis' && (
            guild.emojis.length === 0 ? <EmptyState icon={<Smile className="size-5" />} title="No custom emojis" /> : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-12">
                {guild.emojis.map(emoji => (
                  <button
                    key={emoji.id}
                    title={`:${emoji.name}: — click to copy`}
                    onClick={() => { navigator.clipboard.writeText(emoji.display); toast.success(`Copied ${emoji.display}`); }}
                    className="flex aspect-square items-center justify-center rounded-lg bg-surface-2 transition hover:bg-border"
                  >
                    <img src={emoji.url} alt={emoji.name} className="size-8 object-contain" />
                  </button>
                ))}
              </div>
            )
          )}

          {tab === 'permissions' && (
            <div className="flex flex-wrap gap-1.5">
              {guild.botPermissions.includes('Administrator') && <Badge tone="warning"><Shield className="size-3" />Administrator (all permissions)</Badge>}
              {guild.botPermissions.map(permission => (
                <Badge key={permission} tone="neutral" className={cn(permission === 'Administrator' && 'hidden')}>{permission.replace(/([a-z])([A-Z])/g, '$1 $2')}</Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function ServersPage() {
  const { guildId } = useParams();
  return guildId ? <ServerDetail guildId={guildId} /> : <ServerList />;
}

