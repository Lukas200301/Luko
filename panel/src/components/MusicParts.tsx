import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Music2, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDuration } from '../lib/utils';
import type { SearchResult } from '../lib/types';
import { Button, Input } from './ui';

// Shared by the Music and Playlists pages.

export function Artwork({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent', className)}>
        <Music2 className="size-1/3" />
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className={cn('shrink-0 rounded-lg object-cover', className)} />;
}

export function TrackSearch({ onAdd, disabled }: { onAdd: (query: string, title: string) => Promise<void>; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const isUrl = debounced.startsWith('http');
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['music-search', debounced],
    queryFn: () => api.get<SearchResult[]>(`/api/music/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && !isUrl,
    staleTime: 60_000
  });

  const add = async (value: string, title: string) => {
    setAdding(value);
    try {
      await onAdd(value, title);
      setQuery('');
    } finally {
      setAdding(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) add(query.trim(), query.trim());
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a song or paste a YouTube / Spotify / SoundCloud URL"
            className="pl-9"
            disabled={disabled}
          />
        </div>
        <Button type="submit" disabled={!query.trim() || disabled} loading={adding === query.trim()}>
          <Plus className="size-4" />Add
        </Button>
      </form>

      {isFetching && <p className="text-xs text-muted">Searching…</p>}

      {!isUrl && results.length > 0 && query.trim() && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {results.map(result => (
            <div key={result.uri || result.title} className="flex items-center gap-3 px-3 py-2">
              <Artwork src={result.artworkUrl} className="size-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{result.title}</div>
                <div className="truncate text-xs text-muted">{result.author} · {formatDuration(result.duration)}</div>
              </div>
              <Button size="sm" variant="secondary" loading={adding === (result.uri || result.title)} onClick={() => add(result.uri || result.title, result.title)}>
                <Plus className="size-3.5" />Add
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
