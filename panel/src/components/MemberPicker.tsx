import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { MemberListResponse } from '../lib/types';
import { Avatar, Badge, Input, Spinner } from './ui';

// Lists the members of a server who can see the chosen channel, with search.
// Without the Server Members intent only searching (and recently active members) works.
export function MemberPicker({ guildId, channelId, value, onChange }: {
  guildId: string;
  channelId: string;
  value: string;
  onChange: (userId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const isId = /^\d{15,25}$/.test(debounced);
  const params = new URLSearchParams();
  if (channelId) params.set('channelId', channelId);
  if (debounced && !isId) params.set('q', debounced);

  const { data, isFetching } = useQuery({
    queryKey: ['members', guildId, channelId, isId ? '' : debounced],
    queryFn: () => api.get<MemberListResponse>(`/api/guilds/${guildId}/members?${params}`),
    enabled: !!guildId,
    staleTime: 30_000
  });

  if (!guildId) {
    return <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">Choose a server first</div>;
  }

  const members = data?.members ?? [];
  const selected = members.find(m => m.id === value);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, or paste a user ID"
          className="rounded-none border-0 pl-9 focus:ring-0"
        />
        {isFetching && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
      </div>

      <div className="scrollbar-thin max-h-64 overflow-y-auto">
        {isId && (
          <button
            type="button"
            onClick={() => onChange(debounced)}
            className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2', value === debounced && 'bg-accent/10')}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-2"><UserRound className="size-4 text-muted" /></span>
            <span className="flex-1">Use user ID <code>{debounced}</code></span>
            {value === debounced && <Check className="size-4 text-accent" />}
          </button>
        )}

        {members.map(member => (
          <button
            key={member.id}
            type="button"
            onClick={() => onChange(member.id)}
            className={cn('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2', value === member.id && 'bg-accent/10')}
          >
            <Avatar src={member.avatarUrl} name={member.displayName} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{member.displayName}</span>
              <span className="block truncate text-xs text-muted">@{member.username}</span>
            </span>
            {member.bot && <Badge>Bot</Badge>}
            {value === member.id && <Check className="size-4 shrink-0 text-accent" />}
          </button>
        ))}

        {!isFetching && members.length === 0 && !isId && (
          <div className="px-4 py-6 text-center text-xs text-muted">
            {debounced ? 'Nobody found with that name.' : 'No members to show yet. Search by name to find someone.'}
          </div>
        )}
      </div>

      {data && !data.complete && !debounced && (
        <div className="border-t border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Only recently active members are listed. Search by name to find anyone, or turn on <b>Full member list</b> in Settings to see everybody.
        </div>
      )}

      {value && !selected && !isId && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted">Selected: <code>{value}</code></div>
      )}
    </div>
  );
}
