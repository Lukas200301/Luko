import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { SlashCommand } from '../interfaces/Command';
import * as fs from 'fs';
import * as path from 'path';

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
      let reloadedCount = 0;
      const errors: string[] = [];
      
      function reloadCommands(dir: string): void {
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          
          if (stat.isDirectory()) {
            reloadCommands(filePath); 
          } else if (file.endsWith('.ts') || file.endsWith('.js')) {
            try {
              delete require.cache[require.resolve(filePath)];
              
              const commandModule = require(filePath);
              const cmd: SlashCommand = commandModule.default || commandModule.command;
              
              if (cmd && 'data' in cmd && 'execute' in cmd) {
                interaction.client.commands.set(cmd.data.name, cmd);
                reloadedCount++;
              }
            } catch (err) {
              errors.push(`${file}: ${err}`);
            }
          }
        }
      }
      
      const commandsDir = path.join(__dirname);
      reloadCommands(commandsDir);
      
      if (errors.length > 0) {
        await interaction.editReply(
          `⚠️ Reloaded ${reloadedCount} command(s) with ${errors.length} error(s):\n\`\`\`\n${errors.join('\n')}\n\`\`\``
        );
      } else {
        await interaction.editReply(
          `✅ Successfully reloaded ${reloadedCount} command(s) in memory!\n\n💡 Use \`/deploy\` to register them with Discord.`
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
