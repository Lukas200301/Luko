import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('lavalink')
    .setDescription('Display Lavalink node statistics and health'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const shoukaku = interaction.client.shoukaku;

    if (!shoukaku || shoukaku.nodes.size === 0) {
      await interaction.reply({
        content: '❌ No Lavalink nodes are configured or connected.',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Lavalink Node Statistics')
      .setDescription('Current status and performance metrics of all Lavalink nodes')
      .setTimestamp();

    let hasConnectedNode = false;

    for (const [name, node] of shoukaku.nodes) {
      console.log(`Node ${name} state:`, node.state, 'Stats:', node.stats ? 'Available' : 'Not Available');

      const isConnected = node.state === 2 || !!(node.stats && Object.keys(node.stats).length > 0);
      hasConnectedNode = hasConnectedNode || isConnected;

      const statusIcon = isConnected ? '🟢' : '🔴';
      const statusText = isConnected ? 'Connected' : 'Disconnected';

      if (isConnected && node.stats) {
        const stats = node.stats;

        const uptimeMs = stats.uptime || 0;
        const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
        const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        const uptimeString = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
        const cpuCores = stats.cpu?.cores || 0;
        const cpuSystemLoad = ((stats.cpu?.systemLoad || 0) * 100).toFixed(2);
        const cpuLavalinkLoad = ((stats.cpu?.lavalinkLoad || 0) * 100).toFixed(2);

        const memUsed = ((stats.memory?.used || 0) / 1024 / 1024 / 1024).toFixed(2);
        const memAllocated = ((stats.memory?.allocated || 0) / 1024 / 1024 / 1024).toFixed(2);
        const memReservable = ((stats.memory?.reservable || 0) / 1024 / 1024 / 1024).toFixed(2);

        const playingPlayers = stats.playingPlayers || 0;
        const totalPlayers = stats.players || 0;

        let frameStats = '';
        if (stats.frameStats) {
          const avgSent = stats.frameStats.sent > 0 ?
            Math.floor(stats.frameStats.sent / 60) : 0;
          const avgDeficit = stats.frameStats.deficit > 0 ?
            Math.floor(stats.frameStats.deficit / 60) : 0;
          frameStats = `\nFrames: ${avgSent}/s (Deficit: ${avgDeficit})`;
        }

        embed.addFields({
          name: `${statusIcon} ${name}`,
          value: [
            '```yaml',
            `Status: ${statusText}`,
            `Uptime: ${uptimeString}`,
            '',
            `Players: ${playingPlayers} active / ${totalPlayers} total`,
            '',
            'CPU Load:',
            `  System: ${cpuSystemLoad}% (${cpuCores} cores)`,
            `  Lavalink: ${cpuLavalinkLoad}%`,
            '',
            'Memory:',
            `  Used: ${memUsed} GB`,
            `  Allocated: ${memAllocated} GB`,
            `  Reservable: ${memReservable} GB${frameStats}`,
            '```'
          ].join('\n'),
          inline: false
        });
      } else {
        embed.addFields({
          name: `${statusIcon} ${name}`,
          value: [
            '```',
            `Status: ${statusText}`,
            'No statistics available',
            '```'
          ].join('\n'),
          inline: false
        });
      }
    }

    if (!hasConnectedNode) {
      embed.setColor(0xFF0000);
      embed.setDescription('⚠️ All Lavalink nodes are currently disconnected!');
    }

    embed.setFooter({
      text: `${shoukaku.nodes.size} node${shoukaku.nodes.size === 1 ? '' : 's'} configured`
    });

    await interaction.reply({ embeds: [embed] });
  }
};
