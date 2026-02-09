import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Display the currently playing track with detailed information'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const queue = interaction.client.queueManager.get(interaction.guildId!);
    
    if (!queue || !queue.current || !queue.player) {
      await interaction.reply({
        content: '❌ There is no music playing right now!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const current = queue.current;
    const position = queue.player.position || 0;
    const duration = current.duration;
    
    const progress = Math.min(Math.floor((position / duration) * 20), 20);
    const progressBar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(20 - progress);
    
    const currentTime = formatDuration(position);
    const totalTime = formatDuration(duration);
    
    let loopStatus = '';
    if (queue.loop) {
      loopStatus = '🔂 Track Loop';
    } else if (queue.queueLoop) {
      loopStatus = '🔁 Queue Loop';
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${current.title}](${current.uri})**`)
      .addFields(
        { name: 'Duration', value: totalTime, inline: true },
        { name: 'Requested by', value: current.requestedBy, inline: true },
        { name: 'Volume', value: `${queue.volume}%`, inline: true },
        { 
          name: 'Progress', 
          value: `${progressBar}\n${currentTime} / ${totalTime}`, 
          inline: false 
        }
      )
      .setThumbnail(current.track.info.artworkUrl || null)
      .setTimestamp();
    
    if (loopStatus) {
      embed.addFields({ name: 'Loop Status', value: loopStatus, inline: true });
    }
    
    if (queue.player.paused) {
      embed.addFields({ name: 'Status', value: '⏸️ Paused', inline: true });
    }
    
    if (queue.size() > 0) {
      embed.addFields({ 
        name: 'Up Next', 
        value: `${queue.tracks[0].title} (+${queue.size() - 1} more)`, 
        inline: false 
      });
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
