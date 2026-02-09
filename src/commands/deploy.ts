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
    
    const target = interaction.options.getString('target', true);
    
    try {
      const allCommands = Array.from(interaction.client.commands.values());
      const publicCommands = allCommands.filter(cmd => !cmd.private).map(cmd => cmd.data.toJSON());
      const privateCommands = allCommands.filter(cmd => cmd.private).map(cmd => cmd.data.toJSON());
      
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
      
      let message = '';
      
      if (target === 'guild' || target === 'both') {
        const guildCommands = [...publicCommands, ...privateCommands];
        
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.DEV_GUILD_ID!),
          { body: guildCommands }
        );
        
        message += `✅ Deployed ${guildCommands.length} command(s) to **Dev Guild** (instant)\n`;
      }
      
      if (target === 'global' || target === 'both') {
        await rest.put(
          Routes.applicationCommands(process.env.CLIENT_ID!),
          { body: publicCommands }
        );
        
        message += `✅ Deployed ${publicCommands.length} public command(s) **Globally** (may take up to 1 hour)\n`;
      }
      
      message += `\n📊 **Summary:**\n`;
      message += `• Public commands: ${publicCommands.length}\n`;
      message += `• Private commands: ${privateCommands.length}\n`;
      message += `• Total: ${allCommands.length}`;
      
      await interaction.editReply(message);
    } catch (error) {
      console.error('❌ Error deploying commands:', error);
      await interaction.editReply(
        `❌ Failed to deploy commands: ${error}`
      );
    }
  }
};
