import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../interfaces/Command';
import { deployCommands, DeployTarget } from '../utils/CommandLoader';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('[DEV] Deploy slash commands to Discord')
    .addStringOption(option =>
      option
        .setName('target')
        .setDescription('Where to deploy commands')
        .setRequired(true)
        .addChoices(
          { name: '🏠 Dev Guild Only (Fast Testing)', value: 'guild' },
          { name: '🌍 Global (Production)', value: 'global' },
          { name: '🔄 Both Guild & Global', value: 'both' }
        )
    ),

  private: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.user.id !== process.env.OWNER_ID) {
      await interaction.reply({
        content: '❌ Only the bot owner can use this command.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getString('target', true) as DeployTarget;

    try {
      const result = await deployCommands(interaction.client, target);

      let message = '';

      if (result.guild !== undefined) {
        message += `✅ Deployed ${result.guild} command(s) to **Dev Guild** (instant)\n`;
      }

      if (result.global !== undefined) {
        message += `✅ Deployed ${result.global} public command(s) **Globally** (may take up to 1 hour)\n`;
      }

      message += `\n📊 **Summary:**\n`;
      message += `• Public commands: ${result.publicCount}\n`;
      message += `• Private commands: ${result.privateCount}\n`;
      message += `• Total: ${result.publicCount + result.privateCount}`;

      await interaction.editReply(message);
    } catch (error) {
      console.error('❌ Error deploying commands:', error);
      await interaction.editReply(
        `❌ Failed to deploy commands: ${error}`
      );
    }
  }
};
