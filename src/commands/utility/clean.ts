import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  TextChannel,
  NewsChannel
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Delete bot messages from this channel')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to scan (2-100, default: 100)')
        .setMinValue(2)
        .setMaxValue(100)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !interaction.channel) {
      await interaction.reply({
        content: '❌ This command can only be used in a server!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const channel = interaction.channel;
    if (!(channel instanceof TextChannel || channel instanceof NewsChannel)) {
      await interaction.reply({
        content: '❌ This command can only be used in text channels!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const botPermissions = channel.permissionsFor(interaction.client.user!);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: '❌ I need the "Manage Messages" permission to delete messages!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const response = await interaction.deferReply({ withResponse: true });
    const deferredReplyId = response.resource?.message?.id;
    
    let amount = interaction.options.getInteger('amount') || 100;
    amount = amount < 100 ? amount + 1 : 100;
    
    try {
      const messages = await channel.messages.fetch({ limit: amount });
      
      const botMessages = messages.filter((m) => m.author.id === interaction.client.user!.id);
      
      if (botMessages.size === 0) {
        await interaction.editReply('❌ No bot messages found in the last ' + amount + ' messages!');
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            console.error('Failed to delete reply:', error);
          }
        }, 5000);
        return;
      }
      
      const botMessagesArray = Array.from(botMessages.values());
      const messagesToDelete = botMessagesArray.filter((msg) => msg.id !== deferredReplyId);
      
      const now = Date.now();
      const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);
      
      const recentMessages = messagesToDelete.filter((msg) => msg.createdTimestamp > twoWeeksAgo);
      const oldMessages = messagesToDelete.filter((msg) => msg.createdTimestamp <= twoWeeksAgo);
      
      let deletedCount = 0;
      
      if (recentMessages.length > 0) {
        try {
          const deleted = await channel.bulkDelete(recentMessages, true);
          deletedCount += deleted.size;
        } catch (error) {
          console.error('Bulk delete error:', error);
        }
      }
      
      if (oldMessages.length > 0) {
        console.log(`Deleting ${oldMessages.length} messages older than 14 days individually...`);
        for (const msg of oldMessages) {
          try {
            await msg.delete();
            deletedCount++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (error) {
            console.error('Failed to delete old message:', error);
          }
        }
      }
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setDescription(`✅ Deleted **${deletedCount}** bot message${deletedCount === 1 ? '' : 's'}!`)
        .setFooter({ text: 'This message will be deleted in 5 seconds' });
      
      await interaction.editReply({ embeds: [embed] });
      
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          console.error('Failed to delete reply:', error);
        }
      }, 5000);
      
    } catch (error) {
      console.error('Error in clean command:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      try {
        await interaction.editReply(`❌ An error occurred while cleaning messages: ${errorMessage}`);
      } catch (editError) {
        console.error('Failed to edit reply with error:', editError);
      }
    }
  }
};
