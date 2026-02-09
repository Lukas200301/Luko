import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  MessageFlags,
  REST,
  Routes
} from 'discord.js';
import { SlashCommand } from '../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('[DEV] Remove duplicate commands from dev guild (keeps only private commands)'),
  
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
      const allCommands = Array.from(interaction.client.commands.values());
      const privateCommands = allCommands.filter(cmd => cmd.private).map(cmd => cmd.data.toJSON());
      
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
      
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.DEV_GUILD_ID!),
        { body: privateCommands }
      );
      
      let message = '✅ **Dev guild cleaned up!**\n\n';
      message += `✨ Only **${privateCommands.length} private command(s)** remain in dev guild:\n`;
      message += privateCommands.map(cmd => `• \`/${cmd.name}\``).join('\n');
      message += '\n\n📝 Public commands are now only visible globally.';
      
      await interaction.editReply(message);
    } catch (error) {
      console.error('❌ Error cleaning up commands:', error);
      await interaction.editReply(
        `❌ Failed to cleanup commands: ${error}`
      );
    }
  }
};
