import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ChannelInfo, GuildSummary } from '../lib/types';
import { Select } from './ui';

export function useGuilds() {
  return useQuery({ queryKey: ['guilds'], queryFn: () => api.get<GuildSummary[]>('/api/guilds'), staleTime: 30_000 });
}

export function useChannels(guildId: string | null | undefined) {
  return useQuery({
    queryKey: ['channels', guildId],
    queryFn: () => api.get<ChannelInfo[]>(`/api/guilds/${guildId}/channels`),
    enabled: !!guildId,
    staleTime: 30_000
  });
}

export function GuildSelect({ value, onChange, placeholder = 'Choose a server…', className }: {
  value: string;
  onChange: (guildId: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { data: guilds = [], isLoading } = useGuilds();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {value && !isLoading && !guilds.some(g => g.id === value) && (
        <option value={value}>Unknown server ({value}), the bot isn't in it</option>
      )}
      {guilds.map(guild => (
        <option key={guild.id} value={guild.id}>{guild.name}</option>
      ))}
    </Select>
  );
}

const TEXT_TYPES: ChannelInfo['type'][] = ['text', 'announcement', 'voice'];
const VOICE_TYPES: ChannelInfo['type'][] = ['voice', 'stage'];

export function ChannelSelect({ guildId, value, onChange, kind, placeholder, className }: {
  guildId: string | null | undefined;
  value: string;
  onChange: (channelId: string) => void;
  kind: 'text' | 'voice';
  placeholder?: string;
  className?: string;
}) {
  const { data: channels = [], isLoading } = useChannels(guildId);
  const types = kind === 'text' ? TEXT_TYPES : VOICE_TYPES;
  const filtered = channels.filter(c => types.includes(c.type) && (kind === 'voice' || c.sendable));

  const groups = new Map<string, ChannelInfo[]>();
  for (const channel of filtered) {
    const key = channel.parentName ?? 'No category';
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!guildId || isLoading} className={className}>
      <option value="">{!guildId ? 'Choose a server first' : placeholder ?? (kind === 'text' ? 'Choose a text channel…' : 'Choose a voice channel…')}</option>
      {value && !isLoading && !filtered.some(c => c.id === value) && (
        <option value={value}>Unknown channel ({value})</option>
      )}
      {Array.from(groups.entries()).map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map(channel => (
            <option key={channel.id} value={channel.id}>
              {kind === 'text' ? '#' : '🔊 '}{channel.name}{channel.members ? ` (${channel.members})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
