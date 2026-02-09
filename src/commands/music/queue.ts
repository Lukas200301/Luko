import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display the current music queue'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const queue = interaction.client.queueManager.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({
        content: '❌ There is no music playing right now!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Music Queue')
      .setTimestamp();
    
    embed.addFields({
      name: '🎶 Now Playing',
      value: `**[${queue.current.title}](${queue.current.uri})**\nRequested by: ${queue.current.requestedBy}\nDuration: ${formatDuration(queue.current.duration)}`
    });
    
    if (queue.size() > 0) {
      const upcoming = queue.tracks
        .slice(0, 10) 
        .map((track, index) => {
          return `**${index + 1}.** [${track.title}](${track.uri}) - \`${formatDuration(track.duration)}\``;
        })
        .join('\n');
      
      embed.addFields({
        name: `📃 Up Next (${queue.size()} track${queue.size() === 1 ? '' : 's'})`,
        value: upcoming
      });
      
      if (queue.size() > 10) {
        embed.setFooter({ text: `And ${queue.size() - 10} more...` });
      }
    } else {
      embed.addFields({
        name: '📃 Up Next',
        value: 'Queue is empty. Add more songs with `/play`!'
      });
    }
    
    if (queue.loop) {
      embed.setDescription('� Track Loop is enabled');
    } else if (queue.queueLoop) {
      embed.setDescription('🔁 Queue Loop is enabled');
    }
    
    if (queue.autoplay) {
      const currentDesc = embed.data.description || '';
      embed.setDescription(currentDesc + (currentDesc ? ' • ' : '') + '🔁 Autoplay is enabled');
    }
    
    await interaction.reply({ embeds: [embed] });
  }
};

function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
