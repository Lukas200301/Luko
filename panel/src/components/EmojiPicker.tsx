import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ChevronDown, Smile, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { emojiImageUrl, emojiNameFromFile, useBotEmojis, useUploadEmoji } from '../lib/emojis';
import type { EmojiInfo } from '../lib/types';
import { Button, Input, Spinner, Tabs } from './ui';

export function EmojiPreview({ value, className }: { value: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = emojiImageUrl(value);

  useEffect(() => setFailed(false), [value]);

  if (!value.trim()) return <Smile className={cn('size-5 text-muted', className)} />;
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} className={cn('size-6 object-contain', className)} />;
  if (url) return <span className={cn('text-xs text-muted', className)}>?</span>;
  return <span className={cn('text-xl leading-none', className)}>{value}</span>;
}

function EmojiGrid({ emojis, selected, onSelect, extra }: {
  emojis: EmojiInfo[];
  selected: string;
  onSelect: (emoji: EmojiInfo) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="scrollbar-thin grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto">
      {extra}
      {emojis.map(emoji => (
        <button
          key={emoji.id}
          type="button"
          title={`:${emoji.name}:`}
          onClick={() => onSelect(emoji)}
          className={cn(
            'flex aspect-square items-center justify-center rounded-lg transition hover:bg-surface-2',
            (selected === emoji.id || selected === emoji.display) && 'bg-accent/15 ring-2 ring-accent'
          )}
        >
          <img src={emoji.url} alt={emoji.name} className="size-7 object-contain" />
        </button>
      ))}
    </div>
  );
}

type PickerTab = 'server' | 'bot' | 'other';

// Picks an emoji from the server, from the bot's own emojis (with upload), or any Unicode emoji.
// `mode` decides what is stored: the emoji ID (to match reactions) or the "<:name:id>" display text.
export function EmojiPicker({ value, onChange, serverEmojis, mode, placeholder, allowEmpty }: {
  value: string;
  onChange: (value: string) => void;
  serverEmojis: EmojiInfo[];
  mode: 'id' | 'display';
  placeholder: string;
  allowEmpty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>(serverEmojis.length > 0 ? 'server' : 'bot');
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: botEmojis = [], isLoading, isError } = useBotEmojis();
  const upload = useUploadEmoji();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const label = (() => {
    if (!value) return allowEmpty ?? placeholder;
    const all = [...serverEmojis, ...botEmojis];
    const found = all.find(e => e.id === value || e.display === value);
    if (found) return `:${found.name}:`;
    return emojiImageUrl(value) ? 'Custom emoji' : value;
  })();

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const emoji = await upload.mutateAsync({ file, name: emojiNameFromFile(file.name) }).catch(() => null);
    if (emoji) pick(mode === 'id' ? emoji.id : emoji.display);
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 text-left text-sm transition hover:border-accent/50"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2"><EmojiPreview value={value} /></span>
        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted')}>{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-border bg-surface p-3 shadow-xl">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'server', label: `Server (${serverEmojis.length})` },
              { value: 'bot', label: `Bot (${botEmojis.length})` },
              { value: 'other', label: 'Other' }
            ]}
          />

          {tab === 'server' && (
            serverEmojis.length === 0
              ? <p className="py-6 text-center text-xs text-muted">No emojis available. The bot has to be in the pinboard server to list its emojis.</p>
              : <EmojiGrid emojis={serverEmojis} selected={value} onSelect={(e) => pick(mode === 'id' ? e.id : e.display)} />
          )}

          {tab === 'bot' && (
            <>
              {isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : isError ? (
                <p className="py-6 text-center text-xs text-muted">Bot emojis are unavailable while the bot is offline.</p>
              ) : (
                <EmojiGrid
                  emojis={botEmojis}
                  selected={value}
                  onSelect={(e) => pick(mode === 'id' ? e.id : e.display)}
                  extra={
                    <button
                      type="button"
                      title="Upload a new bot emoji"
                      onClick={() => fileRef.current?.click()}
                      className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-muted transition hover:border-accent hover:text-accent"
                    >
                      {upload.isPending ? <Spinner className="size-4" /> : <Upload className="size-4" />}
                    </button>
                  }
                />
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" className="hidden" onChange={onFile} />
              <p className="text-[11px] leading-relaxed text-muted">Bot emojis work in every server the bot is in. Max 256 KB.</p>
            </>
          )}

          {tab === 'other' && (
            <form
              className="space-y-2"
              onSubmit={(e) => { e.preventDefault(); if (text.trim()) pick(text.trim()); }}
            >
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="⭐ or an emoji ID" autoFocus />
              <p className="text-[11px] text-muted">Paste a Unicode emoji (⭐, 🔥) or a custom emoji ID.</p>
              <Button type="submit" size="sm" className="w-full justify-center" disabled={!text.trim()}>Use this emoji</Button>
            </form>
          )}

          {allowEmpty && value && (
            <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => pick('')}>{allowEmpty}</Button>
          )}
        </div>
      )}
    </div>
  );
}
