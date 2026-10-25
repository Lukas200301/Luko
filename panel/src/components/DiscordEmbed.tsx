import type { EmbedData } from '../lib/types';
import { DiscordText } from './DiscordText';

// An embed as Discord shows it (dark theme), with Discord markdown, mentions and emojis.
export function DiscordEmbed({ embed, botName, botAvatarUrl }: { embed: EmbedData; botName?: string; botAvatarUrl?: string | null }) {
  const color = embed.color !== undefined ? `#${embed.color.toString(16).padStart(6, '0')}` : '#1e1f22';
  const time = embed.timestamp ? `Today at ${new Date(embed.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '';

  return (
    <div className="rounded-lg bg-[#313338] p-4 text-[#dbdee1]">
      {botName && (
        <div className="mb-1 flex items-center gap-2">
          {botAvatarUrl ? <img src={botAvatarUrl} alt="" className="size-8 rounded-full" /> : <div className="size-8 rounded-full bg-[#5865f2]" />}
          <span className="text-sm font-medium text-white">{botName}</span>
          <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white">APP</span>
        </div>
      )}
      <div className="max-w-[520px] overflow-hidden rounded border-l-4 bg-[#2b2d31]" style={{ borderColor: color }}>
        <div className="flex gap-4 p-3 pr-4">
          <div className="min-w-0 flex-1 space-y-2">
            {embed.title && <div className="font-semibold text-white">{embed.title}</div>}
            {embed.description && <DiscordText text={embed.description} className="text-sm" />}
            {(embed.fields ?? []).length > 0 && (
              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                {embed.fields!.map((field, i) => (
                  <div key={i} className={field.inline ? 'col-span-1 min-w-0' : 'col-span-3'}>
                    <div className="text-xs font-semibold text-white">{field.name}</div>
                    <DiscordText text={field.value} className="text-sm" />
                  </div>
                ))}
              </div>
            )}
            {(embed.footer?.text || time) && (
              <div className="text-xs text-[#b5bac1]">{embed.footer?.text}{embed.footer?.text && time ? ' • ' : ''}{time}</div>
            )}
          </div>
          {embed.thumbnail?.url && <img src={embed.thumbnail.url} alt="" className="size-20 shrink-0 rounded object-cover" />}
        </div>
      </div>
    </div>
  );
}
