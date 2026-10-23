import { Client, EmbedBuilder } from 'discord.js';
import { db } from './Database';

export interface Reminder {
    id: string;
    userId: string;
    channelId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

interface ReminderRow {
    id: string;
    user_id: string;
    channel_id: string;
    content: string;
    due_at: number;
    created_at: number;
}

function toReminder(row: ReminderRow): Reminder {
    return {
        id: row.id,
        userId: row.user_id,
        channelId: row.channel_id,
        content: row.content,
        dueAt: row.due_at,
        createdAt: row.created_at
    };
}

const statements = {
    insert: db.prepare('INSERT INTO reminders (id, user_id, channel_id, content, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    due: db.prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at'),
    byUser: db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at'),
    all: db.prepare('SELECT * FROM reminders ORDER BY due_at'),
    count: db.prepare('SELECT COUNT(*) AS n FROM reminders'),
    deleteById: db.prepare('DELETE FROM reminders WHERE id = ?'),
    deleteByIdAndUser: db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?')
};

export class ReminderManager {
    private client: Client;
    private interval: NodeJS.Timeout | null = null;

    constructor(client: Client) {
        this.client = client;
        console.log(`📅 Loaded ${this.count()} reminders.`);
        this.startLoop();
    }

    private startLoop(): void {
        if (this.interval) clearInterval(this.interval);

        this.interval = setInterval(() => this.checkReminders(), 5000);
    }

    private async checkReminders(): Promise<void> {
        // Wait until the bot is connected, otherwise due reminders would be dropped.
        if (!this.client.isReady()) return;

        const dueReminders = (statements.due.all(Date.now()) as unknown as ReminderRow[]).map(toReminder);

        if (dueReminders.length === 0) return;

        for (const reminder of dueReminders) {
            statements.deleteById.run(reminder.id);

            try {
                const channel = await this.client.channels.fetch(reminder.channelId);

                if (channel?.isSendable()) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('⏰ Reminder!')
                        .setDescription(reminder.content)
                        // Discord shows the timestamp next to the footer in each reader's own time zone.
                        .setFooter({ text: 'Reminder set' })
                        .setTimestamp(reminder.createdAt);

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

        statements.insert.run(reminder.id, reminder.userId, reminder.channelId, reminder.content, reminder.dueAt, reminder.createdAt);

        return reminder;
    }

    public getReminders(userId: string): Reminder[] {
        return (statements.byUser.all(userId) as unknown as ReminderRow[]).map(toReminder);
    }

    public getAllReminders(): Reminder[] {
        return (statements.all.all() as unknown as ReminderRow[]).map(toReminder);
    }

    public count(): number {
        return (statements.count.get() as { n: number }).n;
    }

    public removeReminderById(id: string): boolean {
        return Number(statements.deleteById.run(id).changes) > 0;
    }

    public removeReminder(id: string, userId: string): boolean {
        return Number(statements.deleteByIdAndUser.run(id, userId).changes) > 0;
    }
}
