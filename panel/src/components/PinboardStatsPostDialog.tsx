import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Save, Send } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthConfig } from '../lib/auth';
import { useLive } from '../lib/live';
import { rememberMentions } from '../lib/discord';
import { cn } from '../lib/utils';
import type { EmbedPreviewResponse, PinboardBoardStatus, PinboardRange, PinboardStatsList, PinboardStatsPost, PinboardStatsSection } from '../lib/types';
import { Button, Dialog, Field, Input, Notice, PageLoader, Select, SettingRow, Spinner, Switch, Tabs, Textarea, useToast } from './ui';
import { ChannelSelect } from './pickers';
import { DiscordEmbed } from './DiscordEmbed';

const SECTIONS: Record<PinboardStatsSection, { label: string; hint: string }> = {
  totals: { label: 'Overview', hint: 'Pins, reactions, average and record' },
  timeline: { label: 'Pins over time', hint: 'A bar chart image of the time range' },
  authors: { label: 'Top authors', hint: 'Who gets pinned most' },
  channels: { label: 'Top channels', hint: 'Where pinned messages come from' },
  emojis: { label: 'Top emojis', hint: 'Which reactions pin the most' },
  topPins: { label: 'Most reactions', hint: 'The best pins, with links' }
};
const ALL_SECTIONS = Object.keys(SECTIONS) as PinboardStatsSection[];
const LISTS: PinboardStatsSection[] = ['authors', 'channels', 'emojis', 'topPins'];
const MAX_ENTRIES = 25;

const RANGES: { value: PinboardRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last year' },
  { value: 'all', label: 'All time' }
];

function useDebouncedValue<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Which sections to show, in which order, and how many entries each list has.
// Every section is listed; unchecked ones are left out.
function SectionPicker({ value, onChange, limits, onLimitsChange }: {
  value: PinboardStatsSection[];
  onChange: (sections: PinboardStatsSection[]) => void;
  limits: Record<PinboardStatsList, number>;
  onLimitsChange: (limits: Record<PinboardStatsList, number>) => void;
}) {
  const order = [...value, ...ALL_SECTIONS.filter(s => !value.includes(s))];
  const move = (index: number, by: number) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next.filter(s => value.includes(s)));
  };

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {order.map((section, i) => {
        const on = value.includes(section);
        return (
          <div key={section} className={cn('flex items-center gap-3 px-3 py-2', !on && 'opacity-60')}>
            <Switch checked={on} onChange={(checked) => onChange(checked ? order.filter(s => s === section || value.includes(s)) : value.filter(s => s !== section))} label={SECTIONS[section].label} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{SECTIONS[section].label}</div>
              <div className="truncate text-xs text-muted">{SECTIONS[section].hint}</div>
            </div>
            {LISTS.includes(section) && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="How many entries to show">
                Top
                <Input
                  type="number"
                  min={1}
                  max={MAX_ENTRIES}
                  disabled={!on}
                  className="h-8 w-16 text-xs"
                  value={limits[section as PinboardStatsList]}
                  onChange={(e) => onLimitsChange({ ...limits, [section]: Math.min(MAX_ENTRIES, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </label>
            )}
            <Button variant="ghost" size="icon" disabled={!on || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" disabled={!on || i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ board, initial, onClose }: { board: PinboardBoardStatus; initial: PinboardStatsPost; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { overview } = useLive();
  const { data: authConfig } = useAuthConfig();
  const [config, setConfig] = useState(initial);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);
  const set = <K extends keyof PinboardStatsPost>(key: K, value: PinboardStatsPost[K]) => setConfig(c => ({ ...c, [key]: value }));

  const debounced = useDebouncedValue(config);
  const preview = useQuery({
    queryKey: ['stats-post-preview', board.id, JSON.stringify(debounced)],
    queryFn: () => api.post<EmbedPreviewResponse>(`/api/pinboard/boards/${board.id}/stats-post/preview`, debounced).then(rememberMentions),
    placeholderData: keepPreviousData
  });

  const saved = () => queryClient.setQueryData(['stats-post', board.id], config);
  const save = useMutation({
    mutationFn: () => api.put<PinboardStatsPost>(`/api/pinboard/boards/${board.id}/stats-post`, config),
    onSuccess: () => {
      saved();
      toast.success(config.schedule === 'off' ? 'Layout saved' : `Saved. Posted automatically ${config.schedule === 'weekly' ? 'every Monday' : 'on the 1st of every month'}.`);
    },
    onError: (error) => toast.error(error)
  });
  const send = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/pinboard/boards/${board.id}/stats-post/send`, config),
    onSuccess: (result) => {
      saved();
      setPostedUrl(result.url);
      toast.success('Statistics posted');
    },
    onError: (error) => toast.error(error)
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Post statistics to Discord"
      description="Choose what to show and how it looks. The preview is exactly what the bot posts."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending}><Save className="size-4" />Save layout</Button>
          <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!board.botInGuild || !config.channelId || config.sections.length === 0}><Send className="size-4" />Post now</Button>
        </>
      }
    >
      {!board.botInGuild && (
        <Notice tone="warning" className="mb-5" title="The bot isn't in this server">You can set up the layout, but posting only works once the bot is back in the server.</Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Channel"><ChannelSelect guildId={board.guildId} kind="text" value={config.channelId} onChange={(id) => set('channelId', id)} /></Field>
            <Field label="Time range">
              <Select value={config.range} onChange={(e) => set('range', e.target.value as PinboardRange)}>
                {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
            <Field label="Title"><Input value={config.title} maxLength={200} placeholder={`📌 ${board.name} statistics`} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Color"><Input type="color" className="h-10 p-1" value={config.color} onChange={(e) => set('color', e.target.value)} /></Field>
          </div>
          <Field label="Text" hint="Optional, shown above the statistics. Discord formatting works.">
            <Textarea rows={2} maxLength={1000} value={config.description} placeholder="Here's what made it onto the pinboard this month 👀" onChange={(e) => set('description', e.target.value)} />
          </Field>

          <Field label="Layout">
            <Tabs value={config.layout} onChange={(layout) => set('layout', layout)} tabs={[{ value: 'fields', label: 'Side by side' }, { value: 'list', label: 'One below another' }]} />
          </Field>

          <Field label="What to show">
            <SectionPicker value={config.sections} onChange={(sections) => set('sections', sections)} limits={config.limits} onLimitsChange={(limits) => set('limits', limits)} />
          </Field>

          <div className="divide-y divide-border rounded-lg border border-border px-4">
            <SettingRow title="Mention people" description="Shows authors as @name. Nobody gets pinged.">
              <Switch checked={config.mentionAuthors} onChange={(on) => set('mentionAuthors', on)} label="Mention people" />
            </SettingRow>
            <SettingRow title="Server icon">
              <Switch checked={config.thumbnail} onChange={(on) => set('thumbnail', on)} label="Server icon" />
            </SettingRow>
            <SettingRow title="Post automatically" description="Uses this layout and channel">
              <span className="flex items-center gap-2">
                <Select className="w-40" value={config.schedule} onChange={(e) => set('schedule', e.target.value as PinboardStatsPost['schedule'])}>
                  <option value="off">Never</option>
                  <option value="weekly">Every Monday</option>
                  <option value="monthly">1st of the month</option>
                </Select>
                <Select className="w-24" value={config.hour} disabled={config.schedule === 'off'} onChange={(e) => set('hour', Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              </span>
            </SettingRow>
          </div>
          {config.schedule !== 'off' && (
            <p className="text-xs text-muted">
              Tip: use {config.schedule === 'weekly' ? '"Last 7 days"' : '"Last 30 days"'} as the time range for {config.schedule === 'weekly' ? 'weekly' : 'monthly'} posts. Click <b>Save layout</b> to switch it on.
            </p>
          )}
        </div>

        <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">Preview {preview.isFetching && <Spinner className="size-3" />}</div>
          {preview.isError ? (
            <Notice tone="danger">{preview.error instanceof Error ? preview.error.message : 'Preview failed'}</Notice>
          ) : !preview.data ? <PageLoader /> : (
            <DiscordEmbed
              embeds={preview.data.embeds}
              botName={overview?.bot.tag?.split('#')[0] ?? authConfig?.botName ?? 'Luko'}
              botAvatarUrl={overview?.bot.avatarUrl ?? authConfig?.botAvatarUrl}
            />
          )}
          {config.sections.length === 0 && <Notice tone="warning">Pick at least one thing to show.</Notice>}
          {postedUrl && (
            <Notice tone="success" title="Posted">
              <a href={postedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Open in Discord <ExternalLink className="size-3" /></a>
            </Notice>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function PinboardStatsPostDialog({ board, onClose }: { board: PinboardBoardStatus; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['stats-post', board.id],
    queryFn: () => api.get<PinboardStatsPost>(`/api/pinboard/boards/${board.id}/stats-post`)
  });
  if (!data) return null;
  return <Editor board={board} initial={data} onClose={onClose} />;
}
