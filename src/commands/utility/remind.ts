import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Set a reminder')
        .addStringOption(option =>
            option
                .setName('time')
                .setDescription('When to remind you (e.g., 10m, 1h, 2d)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('What to remind you about')
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const timeString = interaction.options.getString('time', true);
        const message = interaction.options.getString('message', true);

        const duration = parseDuration(timeString);

        if (!duration) {
            await interaction.reply({
                content: '❌ Invalid time format! Use format like `10m`, `1h`, `2d`, etc.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }



        try {
            if (!interaction.client.reminderManager) {
                throw new Error('ReminderManager not initialized');
            }

            const reminder = interaction.client.reminderManager.addReminder(
                interaction.user.id,
                interaction.channelId,
                message,
                duration
            );

            await interaction.reply({
                content: `✅ I will remind you about **"${message}"** <t:${Math.floor(reminder.dueAt / 1000)}:R>!`
            });

        } catch (error) {
            console.error('Error setting reminder:', error);
            await interaction.reply({
                content: '❌ Failed to set reminder.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

function parseDuration(timeStr: string): number | null {
    const regex = /^(\d+)([smhd])$/;
    const match = timeStr.match(regex);

    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}
