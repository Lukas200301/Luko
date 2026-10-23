import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  OAuth2Scopes,
  PermissionFlagsBits
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the bot invite link'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Manage Messages is needed for auto-deleting responses
    const inviteLink = interaction.client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseApplicationCommands
      ]
    });

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
      flags: MessageFlags.Ephemeral
    });
  }
};
