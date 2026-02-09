import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if Luko is online and get latency'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply('🏓 Pinging...');
    
    const sent = await interaction.fetchReply();
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    
    await interaction.editReply(
      `🏓 **Luko is online!** | Latency: ${latency}ms`
    );
  }
};
