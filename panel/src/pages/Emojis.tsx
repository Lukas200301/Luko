import { BotEmojis } from '../components/BotEmojis';
import { PageHeader } from '../components/ui';

export function EmojisPage() {
  return (
    <div>
      <PageHeader
        title="Emojis"
        description="Upload, rename and delete the bot's own emojis. They also show up in the Discord Developer Portal under Emojis."
      />
      <BotEmojis />
    </div>
  );
}
