import * as fs from 'fs';
import * as path from 'path';
import { Client, TextChannel, MessageFlags, EmbedBuilder } from 'discord.js';

export interface Reminder {
    id: string;
    userId: string;
    channelId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

export class ReminderManager {
    private client: Client;
    private reminders: Reminder[] = [];
    private filePath: string;
    private interval: NodeJS.Timeout | null = null;

    constructor(client: Client) {
        this.client = client;
        this.filePath = path.join(process.cwd(), 'data', 'reminders.json');

        const dataDir = path.dirname(this.filePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.loadReminders();
        this.startLoop();
    }

    private loadReminders(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                this.reminders = JSON.parse(data);
                console.log(`📅 Loaded ${this.reminders.length} reminders.`);
            } else {
                this.saveReminders();
            }
        } catch (error) {
            console.error('❌ Failed to load reminders:', error);
            this.reminders = [];
        }
    }

    private saveReminders(): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.reminders, null, 2));
        } catch (error) {
            console.error('❌ Failed to save reminders:', error);
        }
    }

    private startLoop(): void {
        if (this.interval) clearInterval(this.interval);

        this.interval = setInterval(() => this.checkReminders(), 5000);
    }

    private async checkReminders(): Promise<void> {
        const now = Date.now();
        const dueReminders = this.reminders.filter(r => r.dueAt <= now);

        if (dueReminders.length === 0) return;

        this.reminders = this.reminders.filter(r => r.dueAt > now);
        this.saveReminders();

        for (const reminder of dueReminders) {
            try {
                const channel = await this.client.channels.fetch(reminder.channelId);

                if (channel && channel.isTextBased() && 'send' in channel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('⏰ Reminder!')
                        .setDescription(reminder.content)
                        .addFields(
                            { name: 'Time Set', value: `<t:${Math.floor(reminder.createdAt / 1000)}:R>`, inline: true }
                        )
                        .setFooter({ text: 'Luko Reminders' })
                        .setTimestamp();

                    await channel.send({
                        content: `<@${reminder.userId}>`,
                        embeds: [embed]
                    });
                }
            } catch (error) {
                console.error(`❌ Failed to send reminder ${reminder.id}:`, error);
            }
        }
    }

    public addReminder(userId: string, channelId: string, content: string, durationMs: number): Reminder {
        const now = Date.now();
        const reminder: Reminder = {
            id: Math.random().toString(36).substring(2, 15),
            userId,
            channelId,
            content,
            dueAt: now + durationMs,
            createdAt: now
        };

        this.reminders.push(reminder);
        this.saveReminders();

        return reminder;
    }

    public getReminders(userId: string): Reminder[] {
        return this.reminders.filter(r => r.userId === userId).sort((a, b) => a.dueAt - b.dueAt);
    }

    public removeReminder(id: string, userId: string): boolean {
        const index = this.reminders.findIndex(r => r.id === id && r.userId === userId);

        if (index !== -1) {
            this.reminders.splice(index, 1);
            this.saveReminders();
            return true;
        }

        return false;
    }
}
