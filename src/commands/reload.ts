import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { SlashCommand } from '../interfaces/Command';
import { loadCommands } from '../utils/CommandLoader';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('[DEV] Reload all bot commands without restarting'),

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

    try {
      const { loaded, errors } = loadCommands(interaction.client, { fresh: true });

      if (errors.length > 0) {
        await interaction.editReply(
          `⚠️ Reloaded ${loaded} command(s) with ${errors.length} error(s):\n\`\`\`\n${errors.join('\n')}\n\`\`\``
        );
      } else {
        await interaction.editReply(
          `✅ Successfully reloaded ${loaded} command(s) in memory!\n\n💡 Use \`/deploy\` to register them with Discord.`
        );
      }
    } catch (error) {
      console.error('❌ Error reloading commands:', error);
      await interaction.editReply(
        `❌ Failed to reload commands: ${error}`
      );
    }
  }
};
