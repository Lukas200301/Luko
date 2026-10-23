import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if Luko is online and get latency'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const response = await interaction.reply({ content: '🏓 Pinging...', withResponse: true });

    const sent = response.resource?.message;
    const latency = (sent?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp;
    
    await interaction.editReply(
      `🏓 **Luko is online!** | Latency: ${latency}ms`
    );
  }
};
