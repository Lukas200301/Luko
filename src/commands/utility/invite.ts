import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the bot invite link'),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Bot permissions needed:
    // - View Channels (1024)
    // - Send Messages (2048)
    // - Manage Messages (8192) - for auto-deleting responses
    // - Embed Links (16384)
    // - Connect (1048576)
    // - Speak (2097152)
    // - Use Application Commands (2147483648)
    // Total: 2151557120
    const permissions = '2151557120';
    const clientId = interaction.client.user.id;
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎵 Invite Luko to Your Server!')
      .setDescription(
        'Click the button below to invite me to your server!\n\n' +
        '**I need these permissions:**\n' +
        '• View Channels\n' +
        '• Send Messages\n' +
        '• Manage Messages\n' +
        '• Embed Links\n' +
        '• Connect (Voice)\n' +
        '• Speak (Voice)\n' +
        '• Use Application Commands'
      )
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setFooter({ text: 'Thanks for using Luko!' })
      .setTimestamp();
    
    const button = new ButtonBuilder()
      .setLabel('Invite Bot')
      .setStyle(ButtonStyle.Link)
      .setURL(inviteLink)
      .setEmoji('🎵');
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    
    await interaction.reply({ 
      embeds: [embed],
      components: [row],
      flags: require('discord.js').MessageFlags.Ephemeral
    });
  }
};
