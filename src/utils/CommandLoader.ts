import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client, REST, Routes } from 'discord.js';
import { SlashCommand } from '../interfaces/Command';
import { DeployTarget } from '../shared/types';

export type { DeployTarget };

export const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

export interface LoadResult {
  loaded: number;
  errors: string[];
}

// Loads (or with `fresh`, re-loads from disk) every command file into client.commands.
export function loadCommands(client: Client, options: { fresh?: boolean; verbose?: boolean } = {}): LoadResult {
  const result: LoadResult = { loaded: 0, errors: [] };

  const walk = (dir: string) => {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);

      if (fs.statSync(filePath).isDirectory()) {
        if (options.verbose) console.log(`📁 Scanning directory: ${file}`);
        walk(filePath);
        continue;
      }

      if (file.endsWith('.d.ts') || !(file.endsWith('.ts') || file.endsWith('.js'))) {
        continue;
      }

      try {
        if (options.fresh) {
          delete require.cache[require.resolve(filePath)];
        }

        const commandModule = require(filePath);
        const command: SlashCommand = commandModule.default || commandModule.command;

        if (command && 'data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          result.loaded++;
          if (options.verbose) console.log(`✅ Loaded command: ${command.data.name}`);
        } else {
          console.warn(`⚠️ Command at ${filePath} is missing required "data" or "execute" property.`);
        }
      } catch (error) {
        result.errors.push(`${file}: ${error}`);
      }
    }
  };

  walk(COMMANDS_DIR);
  return result;
}

export interface DeployResult {
  guild?: number;
  global?: number;
  publicCount: number;
  privateCount: number;
}

// Registers the slash commands with Discord. Private commands only go to the dev guild,
// and commands disabled in the settings are left out so they disappear from Discord.
export async function deployCommands(client: Client, target: DeployTarget): Promise<DeployResult> {
  const commandSettings = client.settings.get().commands;
  const allCommands = Array.from(client.commands.values())
    .filter(cmd => commandSettings[cmd.data.name]?.enabled !== false);
  const publicCommands = allCommands.filter(cmd => !cmd.private).map(cmd => cmd.data.toJSON());
  const privateCommands = allCommands.filter(cmd => cmd.private).map(cmd => cmd.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  const result: DeployResult = { publicCount: publicCommands.length, privateCount: privateCommands.length };

  if (target === 'guild' || target === 'both') {
    if (!process.env.DEV_GUILD_ID) {
      throw new Error('DEV_GUILD_ID is not set in .env');
    }
    const guildCommands = [...publicCommands, ...privateCommands];
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.DEV_GUILD_ID),
      { body: guildCommands }
    );
    result.guild = guildCommands.length;
  }

  if (target === 'global' || target === 'both') {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID!),
      { body: publicCommands }
    );
    result.global = publicCommands.length;
  }

  return result;
}

let syncTimer: NodeJS.Timeout | null = null;

// Re-deploys the commands shortly after they were enabled or disabled. Several quick
// toggles are bundled into one deploy, which keeps us well within Discord's rate limits.
export function scheduleCommandSync(client: Client): boolean {
  const sync = client.settings.get().commandSync;
  if (!sync.enabled || !client.isReady()) return false;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      const result = await deployCommands(client, client.settings.get().commandSync.target);
      const where = [result.guild !== undefined && 'dev server', result.global !== undefined && 'globally'].filter(Boolean).join(' and ');
      console.log(`🔄 Synced slash commands with Discord (${where})`);
    } catch (error) {
      console.error('❌ Failed to sync slash commands with Discord:', error);
    }
  }, 3000);

  return true;
}
