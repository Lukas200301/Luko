import { Fragment, useState, type ReactNode } from 'react';
import { mentionName, roleColor } from '../lib/discord';
import { cn } from '../lib/utils';

// Renders message text the way Discord shows it: custom emojis, channel/user/role mentions,
// timestamps, links and markdown. `compact` keeps everything inline (for cards and previews).

interface Context {
  compact: boolean;
  jumbo: boolean;
}

interface Rule {
  re: RegExp;
  render: (match: RegExpExecArray, ctx: Context) => ReactNode;
}

const mentionClass = 'rounded-[3px] bg-accent/15 px-0.5 font-medium text-accent';

function CustomEmoji({ id, name, animated, jumbo }: { id: string; name: string; animated: boolean; jumbo: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>:{name}:</>;
  return (
    <img
      src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=${jumbo ? 96 : 48}`}
      alt={`:${name}:`}
      title={`:${name}:`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('inline-block object-contain', jumbo ? 'size-12' : 'size-[1.375em] align-[-0.3em]')}
    />
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      onClick={(e) => { if (!shown) { e.stopPropagation(); setShown(true); } }}
      className={cn('rounded-[3px] px-0.5 transition', shown ? 'bg-fg/10' : 'cursor-pointer bg-fg/80 text-transparent select-none [&_*]:invisible')}
    >
      {children}
    </span>
  );
}

const TIMESTAMP_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' }
};

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

// "in 3 days", "2 years ago": like Discord's relative timestamps, at any distance.
function relativeTime(time: number): string {
  const seconds = (time - Date.now()) / 1000;
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ['second', 1];
  return relativeFormat.format(Math.round(seconds / size), unit);
}

function timestamp(seconds: number, style = 'f'): string {
  const time = seconds * 1000;
  return style === 'R' ? relativeTime(time) : new Date(time).toLocaleString(undefined, TIMESTAMP_FORMATS[style] ?? TIMESTAMP_FORMATS.f);
}

function link(href: string, label: ReactNode) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
      {label}
    </a>
  );
}

// Checked in this order; at the same position the first rule wins.
const RULES: Rule[] = [
  { re: /\\([*_~`|\\<>#@:\-[\]()])/g, render: (m) => m[1] },
  { re: /```(?:[\w+-]*\n)?([\s\S]*?)```/g, render: (m) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{m[1].trim()}</code> },
  { re: /(`+)([\s\S]*?[^`])\1(?!`)/g, render: (m) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{m[2]}</code> },
  { re: /<(a?):(\w+):(\d+)>/g, render: (m, ctx) => <CustomEmoji id={m[3]} name={m[2]} animated={!!m[1]} jumbo={ctx.jumbo} /> },
  { re: /<#(\d+)>/g, render: (m) => <span className={mentionClass} title={m[1]}>#{mentionName('channel', m[1]) ?? 'unknown'}</span> },
  { re: /<@!?(\d+)>/g, render: (m) => <span className={mentionClass} title={m[1]}>@{mentionName('user', m[1]) ?? 'unknown-user'}</span> },
  {
    re: /<@&(\d+)>/g,
    render: (m) => {
      const color = roleColor(m[1]);
      const hex = color ? `#${color.toString(16).padStart(6, '0')}` : undefined;
      return (
        <span className={mentionClass} title={m[1]} style={hex ? { color: hex, backgroundColor: `${hex}26` } : undefined}>
          @{mentionName('role', m[1]) ?? 'deleted-role'}
        </span>
      );
    }
  },
  { re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, render: (m) => <span className="rounded-[3px] bg-fg/10 px-0.5">{timestamp(Number(m[1]), m[2])}</span> },
  { re: /<\/([\w -]{1,100}):\d+>/g, render: (m) => <span className={mentionClass}>/{m[1]}</span> },
  { re: /@(everyone|here)\b/g, render: (m) => <span className={mentionClass}>@{m[1]}</span> },
  { re: /\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/g, render: (m, ctx) => link(m[2], inline(m[1], ctx)) },
  { re: /<?(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?>])>?/g, render: (m) => link(m[1], m[1]) },
  { re: /\|\|([\s\S]+?)\|\|/g, render: (m, ctx) => <Spoiler>{inline(m[1], ctx)}</Spoiler> },
  { re: /\*\*([\s\S]+?)\*\*(?!\*)/g, render: (m, ctx) => <strong className="font-semibold">{inline(m[1], ctx)}</strong> },
  { re: /__([\s\S]+?)__(?!_)/g, render: (m, ctx) => <u>{inline(m[1], ctx)}</u> },
  { re: /\*(?![\s*])([\s\S]+?)\*(?!\*)/g, render: (m, ctx) => <em>{inline(m[1], ctx)}</em> },
  { re: /\b_([\s\S]+?)_\b/g, render: (m, ctx) => <em>{inline(m[1], ctx)}</em> },
  { re: /~~([\s\S]+?)~~/g, render: (m, ctx) => <s>{inline(m[1], ctx)}</s> }
];

function inline(text: string, ctx: Context): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  while (pos < text.length) {
    let best: { match: RegExpExecArray; rule: Rule } | null = null;
    for (const rule of RULES) {
      rule.re.lastIndex = pos;
      const match = rule.re.exec(text);
      if (match && match[0].length > 0 && (!best || match.index < best.match.index)) best = { match, rule };
    }
    if (!best) {
      out.push(text.slice(pos));
      break;
    }
    if (best.match.index > pos) out.push(text.slice(pos, best.match.index));
    out.push(<Fragment key={out.length}>{best.rule.render(best.match, ctx)}</Fragment>);
    pos = best.match.index + best.match[0].length;
  }
  return out;
}

// Only emojis (up to 27, like Discord): shown large.
function isEmojiOnly(text: string): boolean {
  const custom = text.match(/<a?:\w+:\d+>/g)?.length ?? 0;
  const rest = text.replace(/<a?:\w+:\d+>/g, '');
  const unicode = rest.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  const leftover = rest.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️\s]/gu, '');
  return leftover === '' && custom + unicode > 0 && custom + unicode <= 27;
}

// Block markdown (code blocks, quotes, headings, lists) for the full view.
function blocks(text: string, ctx: Context): ReactNode[] {
  const out: ReactNode[] = [];
  let plain: string[] = [];
  let quote: string[] = [];

  const flushPlain = () => {
    if (plain.length) out.push(<span key={out.length}>{inline(plain.join('\n'), ctx)}</span>);
    plain = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(<div key={out.length} className="border-l-4 border-border pl-3">{blocks(quote.join('\n'), ctx)}</div>);
    quote = [];
  };
  const block = (node: ReactNode) => {
    flushPlain();
    flushQuote();
    out.push(<Fragment key={out.length}>{node}</Fragment>);
  };

  const parts = text.split(/(```(?:[\w+-]*\n)?[\s\S]*?```)/g);
  for (const part of parts) {
    const code = /^```(?:[\w+-]*\n)?([\s\S]*?)```$/.exec(part);
    if (code) {
      block(<pre className="my-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-[0.85em] whitespace-pre">{code[1].replace(/\n$/, '')}</pre>);
      continue;
    }

    const lines = part.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const rest = /^>>> ([\s\S]*)$/.exec(line);
      if (rest) {
        flushPlain();
        quote.push(rest[1], ...lines.slice(i + 1));
        break;
      }
      const quoted = /^> (.*)$/.exec(line);
      if (quoted) {
        flushPlain();
        quote.push(quoted[1]);
        continue;
      }
      flushQuote();

      const heading = /^(#{1,3}) (.+)$/.exec(line);
      const subtext = /^-# (.+)$/.exec(line);
      const item = /^(\s*)[-*] (.+)$/.exec(line);
      if (heading) {
        const size = ['text-xl', 'text-lg', 'text-base'][heading[1].length - 1];
        block(<div className={cn('mt-1 font-bold', size)}>{inline(heading[2], ctx)}</div>);
      } else if (subtext) {
        block(<div className="text-xs text-muted">{inline(subtext[1], ctx)}</div>);
      } else if (item) {
        block(<div className="flex gap-2" style={{ paddingLeft: `${Math.min(item[1].length, 8) * 0.5}rem` }}><span className="text-muted">•</span><span>{inline(item[2], ctx)}</span></div>);
      } else {
        plain.push(line);
      }
    }
    flushPlain();
  }
  flushQuote();
  return out;
}

// Strips block markers so the text reads well on one line or a few clamped lines.
function compactText(text: string): string {
  return text
    .replace(/^>>> /gm, '')
    .replace(/^> /gm, '')
    .replace(/^#{1,3} /gm, '')
    .replace(/^-# /gm, '')
    .replace(/^(\s*)[-*] /gm, '$1• ');
}

export function DiscordText({ text, compact = false, className }: { text: string; compact?: boolean; className?: string }) {
  const ctx: Context = { compact, jumbo: !compact && isEmojiOnly(text) };
  return (
    <span className={cn('break-words', compact ? 'whitespace-pre-line' : 'block whitespace-pre-wrap', className)}>
      {compact ? inline(compactText(text), ctx) : blocks(text, ctx)}
    </span>
  );
}
