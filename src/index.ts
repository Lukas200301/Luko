import { logManager } from './utils/LogManager';
logManager.install();

import {
  Client,
  GatewayIntentBits,
  Collection,
  MessageFlags,
  ActivityType,
  Partials,
  ActivitiesOptions
} from 'discord.js';
import { config } from 'dotenv';
import { SlashCommand } from './interfaces/Command';
import { ReminderManager } from './utils/ReminderManager';
import { Shoukaku } from 'shoukaku';
import { createShoukaku } from './utils/LavalinkConnection';
import { QueueManager } from './utils/QueueManager';
import { PinboardManager } from './utils/PinboardManager';
import { registerPinboard } from './utils/PinboardService';
import { SettingsManager } from './utils/SettingsManager';
import { StatsManager } from './utils/StatsManager';
import { AuditLog } from './utils/AuditLog';
import { AlertManager } from './utils/AlertManager';
import { BackupManager } from './utils/BackupManager';
import { BirthdayManager } from './utils/BirthdayManager';
import { PollManager } from './utils/PollManager';
import { MusicHistory } from './utils/MusicHistory';
import { PlaylistManager } from './utils/PlaylistManager';
import { startUpdateChecks } from './utils/Updater';
import { loadCommands } from './utils/CommandLoader';
import { MUSIC_COMMANDS, destroyQueue, isMusicAvailable } from './utils/MusicService';
import { ActivityKind } from './shared/types';
import { startPanel } from './panel/server';

config({ quiet: true });

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, SlashCommand>;
    shoukaku: Shoukaku;
    queueManager: QueueManager;
    reminderManager: ReminderManager;
    pinboardManager: PinboardManager;
    settings: SettingsManager;
    stats: StatsManager;
    auditLog: AuditLog;
    alerts: AlertManager;
    backups: BackupManager;
    birthdays: BirthdayManager;
    polls: PollManager;
    musicHistory: MusicHistory;
    playlists: PlaylistManager;
    startedAt: number;
  }
}

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

const settings = new SettingsManager();
const startupSettings = settings.get();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    // Privileged: only requested when switched on in the panel (and the Developer Portal).
    ...(startupSettings.intents.members ? [GatewayIntentBits.GuildMembers] : [])
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

client.startedAt = Date.now();
client.settings = settings;
client.commands = new Collection<string, SlashCommand>();
client.reminderManager = new ReminderManager(client);
client.pinboardManager = new PinboardManager();
client.queueManager = new QueueManager();
client.stats = new StatsManager(client);
client.auditLog = new AuditLog();
client.alerts = new AlertManager(client);
client.backups = new BackupManager(client);
client.birthdays = new BirthdayManager(client);
client.polls = new PollManager(client);
client.musicHistory = new MusicHistory(client);
client.playlists = new PlaylistManager();

if (startupSettings.features.music) {
  client.shoukaku = createShoukaku(client);
} else {
  console.log('🔇 Music features are disabled (turn them on in the admin panel under Settings)');
}

console.log(`📂 Loading commands...`);
const loadResult = loadCommands(client, { verbose: true });
for (const error of loadResult.errors) {
  console.error(`❌ Failed to load command ${error}`);
}

// Returns a reason why a command can't be used right now, or null if it can.
function getCommandBlockReason(commandName: string, guildId: string | null): string | null {
  const settings = client.settings.get();

  // Maintenance mode blocks every command for everyone, with the message set in the panel.
  if (settings.maintenance.enabled) {
    return settings.maintenance.message;
  }

  if (MUSIC_COMMANDS.has(commandName) && !isMusicAvailable(client)) {
    return '🚫 The music feature is currently deactivated.';
  }

  if (commandName === 'remind' && !settings.features.reminders) {
    return '🚫 Reminders are currently deactivated.';
  }

  if (commandName === 'birthday' && !settings.features.birthdays) {
    return '🚫 Birthdays are currently deactivated.';
  }

  if (commandName === 'poll' && !settings.features.polls) {
    return '🚫 Polls are currently deactivated.';
  }

  const commandSettings = settings.commands[commandName];
  if (commandSettings) {
    if (!commandSettings.enabled) {
      return '🚫 This command is currently disabled.';
    }
    if (guildId && commandSettings.disabledGuilds.includes(guildId)) {
      return '🚫 This command is disabled on this server.';
    }
  }

  return null;
}

const ACTIVITY_TYPES: Record<ActivityKind, ActivityType> = {
  Playing: ActivityType.Playing,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
  Custom: ActivityType.Custom
};

let presenceTimer: NodeJS.Timeout | null = null;
let presenceIndex = 0;

function fillPlaceholders(text: string): string {
  const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

  return text
    .replaceAll('{users}', users.toLocaleString())
    .replaceAll('{servers}', client.guilds.cache.size.toLocaleString())
    .replaceAll('{queues}', client.queueManager.size().toString())
    .replaceAll('{commands}', client.commands.size.toString());
}

function toActivity(type: ActivityKind, text: string): ActivitiesOptions {
  return type === 'Custom'
    ? { name: text, state: text, type: ActivityType.Custom }
    : { name: text, type: ACTIVITY_TYPES[type] };
}

function updatePresence(): void {
  if (!client.user) return;

  const settings = client.settings.get();

  if (settings.maintenance.enabled) {
    client.user.setPresence({ status: 'dnd', activities: [toActivity('Custom', '🛠️ Maintenance')] });
    return;
  }

  const musicAvailable = isMusicAvailable(client);
  const activities = settings.presence.activities.filter(a => a.text.trim() && (!a.musicOnly || musicAvailable));

  if (activities.length === 0) {
    client.user.setPresence({ status: settings.presence.status, activities: [] });
    return;
  }

  const activity = settings.presence.rotate
    ? activities[presenceIndex++ % activities.length]
    : activities[0];

  client.user.setPresence({
    status: settings.presence.status,
    activities: [toActivity(activity.type, fillPlaceholders(activity.text))]
  });
}

function schedulePresence(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  updatePresence();

  const seconds = Math.max(15, client.settings.get().presence.intervalSeconds);
  presenceTimer = setInterval(updatePresence, seconds * 1000);
}

client.settings.on('change', (section: string) => {
  if (section === 'presence' || section === 'maintenance' || section === 'features') {
    schedulePresence();
  }
});

client.once('clientReady', async () => {
  console.log(`🤖 ${client.user?.tag} is online!`);
  console.log('💡 Commands are loaded in memory. Use /deploy or the admin panel to register them with Discord.');

  schedulePresence();
  client.alerts.start();
  client.backups.start();
  client.birthdays.start();
  client.polls.start();
  startUpdateChecks(client);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (getCommandBlockReason(interaction.commandName, interaction.guildId)) {
      try { await interaction.respond([]); } catch (e) {}
      return;
    }

    const command = client.commands.get(interaction.commandName);

    if (!command || !command.autocomplete) {
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`❌ Error handling autocomplete for ${interaction.commandName}:`, error);
      try { await interaction.respond([]); } catch (e) {}
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('poll:')) {
    try {
      await client.polls.handleButton(interaction);
    } catch (error) {
      console.error('❌ Error handling a poll button:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong with this poll.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`⚠️ No command matching ${interaction.commandName} was found.`);
    return;
  }

  const settings = client.settings.get();

  const blockReason = getCommandBlockReason(interaction.commandName, interaction.guildId);
  if (blockReason) {
    await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
    return;
  }

  let success = true;

  try {
    await command.execute(interaction);

    // Auto-delete music command responses after the configured delay
    if (MUSIC_COMMANDS.has(interaction.commandName) && settings.music.autoDeleteResponses) {
      setTimeout(async () => {
        try {
          // Only delete if the reply is not ephemeral
          const reply = await interaction.fetchReply().catch(() => null);
          if (reply && reply.deletable) {
            await interaction.deleteReply();
          }
        } catch (error) {
          // Silently fail if message was already deleted or interaction expired
          console.log(`Could not delete ${interaction.commandName} response:`, error);
        }
      }, settings.music.autoDeleteSeconds * 1000);
    }
  } catch (error) {
    success = false;
    console.error(`❌ Error executing ${interaction.commandName}:`, error);

    const errorMessage = '❌ There was an error executing this command!';

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      console.error('❌ Failed to send error response:', replyError);
    }
  } finally {
    client.stats.recordCommand({
      t: Date.now(),
      command: interaction.commandName,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      guildId: interaction.guildId,
      guildName: interaction.guild?.name ?? null,
      success
    });
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!isMusicAvailable(client) || !client.settings.get().music.leaveWhenAlone) return;
  if (!oldState.channel) return;

  if (oldState.channelId !== newState.channelId) {
    const queue = client.queueManager.get(oldState.guild.id);

    if (!queue || !queue.player) return;

    const voiceChannel = oldState.channel;

    // Only react when people leave the channel the bot is actually in
    if (oldState.guild.members.me?.voice.channelId !== voiceChannel.id) return;

    const members = voiceChannel.members.filter(m => !m.user.bot);

    if (members.size === 0) {
      console.log(`👋 Everyone left the voice channel in ${oldState.guild.name}, disconnecting...`);

      try {
        const channel = await client.channels.fetch(queue.textChannelId);
        if (channel?.isSendable()) {
          const message = await channel.send('👋 Left the voice channel because everyone else left.');

          setTimeout(async () => {
            try {
              await message.delete();
            } catch (error) {
              console.error('Failed to delete leave message:', error);
            }
          }, 30000);
        }
      } catch (error) {
        console.error('Failed to send leave message:', error);
      }

      await destroyQueue(client, oldState.guild.id);
    }
  }
});

registerPinboard(client);

if (startupSettings.panel.enabled) {
  startPanel(client).catch((error) => {
    console.error('❌ Failed to start the admin panel:', error);
  });
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  if (/disallowed intents/i.test(String(error?.message))) {
    console.error(
      '❌ Discord refused the login because the Server Members intent is not enabled for this bot. ' +
      'Either enable "Server Members Intent" in the Discord Developer Portal (Bot tab), ' +
      'or turn off "Full member list" in the admin panel under Settings and restart.'
    );
  } else {
    console.error('❌ Failed to log in to Discord:', error);
  }
});
