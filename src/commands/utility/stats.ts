import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  version as djsVersion
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display bot statistics and performance metrics'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const startTime = Date.now();
    await interaction.deferReply();
    const responseTime = Date.now() - startTime;
    
    const client = interaction.client;
    
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const uptimeString = [
      days > 0 ? `${days}d` : '',
      hours > 0 ? `${hours}h` : '',
      minutes > 0 ? `${minutes}m` : '',
      `${seconds}s`
    ].filter(Boolean).join(' ');
    
    const memUsage = process.memoryUsage();
    const memUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const memTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
    const memRssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
    
    const guildCount = client.guilds.cache.size;
    const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    
    const apiLatency = client.ws.ping;
    const botLatency = responseTime;
    
    const activeQueues = interaction.client.queueManager?.size() ?? 0;
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Bot Statistics')
      .setDescription('Current performance metrics and status information')
      .addFields(
        {
          name: '🕒 Uptime',
          value: `\`\`\`${uptimeString}\`\`\``,
          inline: true
        },
        {
          name: '💾 Memory Usage',
          value: `\`\`\`Heap: ${memUsedMB}MB / ${memTotalMB}MB\nRSS: ${memRssMB}MB\`\`\``,
          inline: true
        },
        {
          name: '📡 Latency',
          value: `\`\`\`Websocket: ${apiLatency}ms\nResponse: ${botLatency}ms\`\`\``,
          inline: true
        },
        {
          name: '🌐 Servers',
          value: `\`\`\`${guildCount.toLocaleString()}\`\`\``,
          inline: true
        },
        {
          name: '👥 Users',
          value: `\`\`\`${userCount.toLocaleString()}\`\`\``,
          inline: true
        },
        {
          name: '🎵 Active Queues',
          value: `\`\`\`${activeQueues}\`\`\``,
          inline: true
        },
        {
          name: '⚙️ System',
          value: `\`\`\`Node.js: ${process.version}\nDiscord.js: v${djsVersion}\nPlatform: ${process.platform}\`\`\``,
          inline: false
        }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }
};
