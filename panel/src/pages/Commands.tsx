import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Globe, Home, RefreshCw, Rocket, Search, Terminal } from 'lucide-react';
import { api } from '../lib/api';
import { useSaveSettings, useSettings } from '../lib/settings';
import { timeAgo } from '../lib/utils';
import type { CommandInfo, DeployTarget } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  PageLoader,
  Select,
  SettingRow,
  Switch,
  Tabs,
  useConfirm,
  useToast
} from '../components/ui';

function CommandSyncCard() {
  const { data } = useSettings();
  const save = useSaveSettings();
  if (!data) return null;
  const sync = data.settings.commandSync;

  return (
    <Card className="mb-6">
      <CardBody className="py-1">
        <SettingRow
          title={<span className="flex items-center gap-2"><EyeOff className="size-4 text-muted" />Hide disabled commands in Discord</span>}
          description="When a command is turned off here, the command list is deployed again without it, so it disappears from Discord's / menu. Global changes can take a few minutes to show up. Commands turned off for a single server can't be hidden; they reply that they're disabled instead."
        >
          <Switch checked={sync.enabled} onChange={(enabled) => save.mutate({ section: 'commandSync', value: { ...sync, enabled } })} label="Hide disabled commands" />
        </SettingRow>
        {sync.enabled && (
          <SettingRow title="Sync to" description="Where your commands are registered. Use Global for the live bot.">
            <Select
              value={sync.target}
              className="w-48"
              onChange={(e) => save.mutate({ section: 'commandSync', value: { ...sync, target: e.target.value as DeployTarget } })}
            >
              <option value="global">Global (all servers)</option>
              <option value="guild">Dev server only</option>
              <option value="both">Dev server and global</option>
            </Select>
          </SettingRow>
        )}
      </CardBody>
    </Card>
  );
}

type Category = 'all' | CommandInfo['category'];

const CATEGORY_TONE = { music: 'accent', utility: 'success', dev: 'warning' } as const;

export function CommandsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<Category>('all');
  const [filter, setFilter] = useState('');

  const { data: commands = [], isLoading } = useQuery({ queryKey: ['commands'], queryFn: () => api.get<CommandInfo[]>('/api/commands') });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => api.put<{ synced: boolean }>(`/api/commands/${name}`, { enabled }),
    onMutate: ({ name, enabled }) => {
      queryClient.setQueryData<CommandInfo[]>(['commands'], old => old?.map(c => (c.name === name ? { ...c, enabled } : c)));
    },
    onSuccess: (result, { name, enabled }) => {
      toast.success(result.synced
        ? `/${name} ${enabled ? 'enabled' : 'disabled'}. Updating Discord's command list…`
        : `/${name} ${enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (error) => {
      toast.error(error);
      queryClient.invalidateQueries({ queryKey: ['commands'] });
    }
  });

  const deploy = useMutation({
    mutationFn: (target: 'guild' | 'global' | 'both') =>
      api.post<{ guild?: number; global?: number }>('/api/commands/deploy', { target }),
    onSuccess: (result) => {
      const parts = [];
      if (result.guild !== undefined) parts.push(`${result.guild} to the dev server`);
      if (result.global !== undefined) parts.push(`${result.global} globally (can take up to an hour)`);
      toast.success(`Deployed ${parts.join(' and ')}`);
    },
    onError: (error) => toast.error(error)
  });

  const reload = useMutation({
    mutationFn: () => api.post<{ loaded: number; errors: string[] }>('/api/commands/reload'),
    onSuccess: (result) => {
      if (result.errors.length > 0) {
        toast.error(`Reloaded ${result.loaded} commands with ${result.errors.length} errors: ${result.errors.join(', ')}`);
      } else {
        toast.success(`Reloaded ${result.loaded} commands from disk`);
      }
      queryClient.invalidateQueries({ queryKey: ['commands'] });
    },
    onError: (error) => toast.error(error)
  });

  const filtered = useMemo(() => commands.filter(c =>
    (category === 'all' || c.category === category) &&
    (c.name.includes(filter.toLowerCase()) || c.description.toLowerCase().includes(filter.toLowerCase()))
  ), [commands, category, filter]);

  if (isLoading) return <PageLoader />;

  const deployTo = async (target: 'guild' | 'global' | 'both') => {
    const labels = { guild: 'the dev server', global: 'all servers (global)', both: 'the dev server and globally' };
    if (await confirm({ title: 'Deploy slash commands?', description: `Registers the current commands with Discord for ${labels[target]}.`, confirmLabel: 'Deploy' })) {
      deploy.mutate(target);
    }
  };

  return (
    <div>
      <PageHeader
        title="Commands"
        description="Turn commands on or off, see how often they're used, and push them to Discord"
        actions={
          <>
            <Button variant="outline" onClick={() => reload.mutate()} loading={reload.isPending}><RefreshCw className="size-4" />Reload from disk</Button>
            <Button variant="secondary" onClick={() => deployTo('guild')} loading={deploy.isPending && deploy.variables === 'guild'}><Home className="size-4" />Deploy to dev server</Button>
            <Button onClick={() => deployTo('global')} loading={deploy.isPending && deploy.variables === 'global'}><Globe className="size-4" />Deploy globally</Button>
          </>
        }
      />

      <CommandSyncCard />

      <Card>
        <CardHeader
          title={`${filtered.length} commands`}
          icon={<Terminal className="size-4" />}
          actions={
            <>
              <Tabs
                value={category}
                onChange={setCategory}
                tabs={[{ value: 'all', label: 'All' }, { value: 'music', label: 'Music' }, { value: 'utility', label: 'Utility' }, { value: 'dev', label: 'Developer' }]}
              />
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" className="h-8 w-44 pl-8 text-xs" />
              </div>
            </>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState icon={<Rocket className="size-5" />} title="No commands match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Command</th>
                  <th className="px-5 py-2.5 font-medium">Category</th>
                  <th className="px-5 py-2.5 text-right font-medium">Uses</th>
                  <th className="px-5 py-2.5 font-medium">Last used</th>
                  <th className="px-5 py-2.5 font-medium">Per-server</th>
                  <th className="px-5 py-2.5 text-right font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(command => (
                  <tr key={command.name} className="hover:bg-surface-2/50">
                    <td className="px-5 py-3">
                      <div className="font-mono font-medium">/{command.name}</div>
                      <div className="max-w-md truncate text-xs text-muted">{command.description}</div>
                    </td>
                    <td className="px-5 py-3"><Badge tone={CATEGORY_TONE[command.category]} className="capitalize">{command.category}</Badge></td>
                    <td className="px-5 py-3 text-right tabular-nums">{command.uses.toLocaleString()}</td>
                    <td className="px-5 py-3 text-muted">{command.lastUsed ? timeAgo(command.lastUsed) : 'Never'}</td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {command.disabledGuilds.length > 0 ? `Off on ${command.disabledGuilds.length} server${command.disabledGuilds.length === 1 ? '' : 's'}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Switch checked={command.enabled} onChange={(enabled) => toggle.mutate({ name: command.name, enabled })} label={`Enable /${command.name}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
