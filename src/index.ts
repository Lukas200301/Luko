import { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  REST, 
  Routes,
  ChatInputCommandInteraction,
  MessageFlags,
  ActivityType
} from 'discord.js';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand } from './interfaces/Command';
import { Shoukaku, Connectors } from 'shoukaku';
import { QueueManager } from './utils/QueueManager';

config();

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, SlashCommand>;
    shoukaku: Shoukaku;
    queueManager: QueueManager;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.commands = new Collection<string, SlashCommand>();

client.shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  [{
    name: 'Lavalink',
    url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
    auth: process.env.LAVALINK_PASSWORD!
  }],
  {
    moveOnDisconnect: false,
    resume: false,
    resumeTimeout: 30,
    reconnectTries: 2,
    restTimeout: 10000
  }
);

client.queueManager = new QueueManager();

client.shoukaku.on('ready', (name) => {
  console.log(`🎵 Lavalink node "${name}" is ready!`);
});

client.shoukaku.on('error', (name, error) => {
  console.error(`❌ Lavalink node "${name}" error:`, error);
});

client.shoukaku.on('close', (name, code, reason) => {
  console.warn(`⚠️ Lavalink node "${name}" closed with code ${code}. Reason: ${reason}`);
});

client.shoukaku.on('disconnect', (name, moved) => {
  console.warn(`⚠️ Lavalink node "${name}" disconnected. Moved: ${moved}`);
});

function loadCommands(dir: string): void {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      console.log(`📁 Scanning directory: ${file}`);
      loadCommands(filePath); 
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      const commandModule = require(filePath);
      const command: SlashCommand = commandModule.default || commandModule.command;
      
      if (command && 'data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Loaded command: ${command.data.name}`);
      } else {
        console.warn(`⚠️ Command at ${filePath} is missing required "data" or "execute" property.`);
      }
    }
  }
}

const commandsPath = path.join(__dirname, 'commands');
console.log(`📂 Loading commands...`);
loadCommands(commandsPath);

async function registerCommands(): Promise<void> {
  const allCommands = Array.from(client.commands.values());
  
  const publicCommands = allCommands.filter(cmd => !cmd.private).map(cmd => cmd.data.toJSON());
  const privateCommands = allCommands.filter(cmd => cmd.private).map(cmd => cmd.data.toJSON());
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  
  try {
    if (process.env.DEV_GUILD_ID) {
      const guildCommands = [...publicCommands, ...privateCommands];
      console.log(`🔄 Registering ${guildCommands.length} command(s) to dev guild for testing...`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.DEV_GUILD_ID),
        { body: guildCommands }
      );
      console.log('✅ Successfully registered commands to dev guild.');
      console.log('💡 Use /deploy to push commands globally when ready!');
    } else {
      console.log(`🔄 Registering ${publicCommands.length} public command(s) globally...`);
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: publicCommands }
      );
      console.log('✅ Successfully registered public commands globally.');
    }
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
}

client.once('clientReady', async () => {
  console.log(`🤖 ${client.user?.tag} is online!`);
  console.log('💡 Commands are loaded in memory. Use /deploy to register them with Discord.');
  
  const updateStatus = () => {
    if (!client.user) return;
    
    const serverCount = client.guilds.cache.size;
    const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    const queueCount = client.queueManager.size();
    
    const statuses = [
      { name: `music in ${serverCount} server${serverCount !== 1 ? 's' : ''}`, type: ActivityType.Playing },
      { name: `${userCount.toLocaleString()} users`, type: ActivityType.Listening },
      { name: `${queueCount} active queue${queueCount !== 1 ? 's' : ''}`, type: ActivityType.Watching },
      { name: '/play to start jamming', type: ActivityType.Playing },
      { name: 'your favorite songs 🎵', type: ActivityType.Listening }
    ];
    
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    
    client.user.setPresence({
      activities: [status],
      status: 'online'
    });
  };
  
  updateStatus();
  setInterval(updateStatus, 30000);
  
  // Automatic deployment disabled - use /deploy command instead
  // await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    
    if (!command || !command.autocomplete) {
      return;
    }
    
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`❌ Error handling autocomplete for ${interaction.commandName}:`, error);
    }
    return;
  }
  
  if (!interaction.isChatInputCommand()) return;
  
  const command = client.commands.get(interaction.commandName);
  
  if (!command) {
    console.warn(`⚠️ No command matching ${interaction.commandName} was found.`);
    return;
  }
  
  try {
    await command.execute(interaction as ChatInputCommandInteraction);
    
    // Auto-delete music command responses after 30 seconds
    const musicCommands = [
      'play', 'skip', 'stop', 'queue', 'loop', 'pause', 'volume',
      'shuffle', 'autoplay', 'nowplaying', 'search', 'clearqueue',
      'filter', 'seek', 'jump', 'move', 'remove', 'previous', 'songoftheday'
    ];
    
    if (musicCommands.includes(interaction.commandName)) {
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
      }, 30000);
    }
  } catch (error) {
    console.error(`❌ Error executing ${interaction.commandName}:`, error);
    
    const errorMessage = '❌ There was an error executing this command!';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
    }
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!oldState.channel) return;
  
  if (oldState.channelId !== newState.channelId) {
    const queue = client.queueManager.get(oldState.guild.id);
    
    if (!queue || !queue.player) return;
    
    const voiceChannel = oldState.channel;
    
    const members = voiceChannel.members.filter(m => !m.user.bot);
    
    if (members.size === 0) {
      console.log(`👋 Everyone left the voice channel in ${oldState.guild.name}, disconnecting...`);
      
      queue.isDestroying = true;
      
      if (queue.player) {
        queue.player.stopTrack();
      }
      
      try {
        const channel = await client.channels.fetch(queue.textChannelId);
        if (channel?.isTextBased() && 'send' in channel) {
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
      
      client.shoukaku.leaveVoiceChannel(oldState.guild.id);
      queue.clear();
      client.queueManager.delete(oldState.guild.id);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
