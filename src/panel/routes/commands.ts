import { RouteRegistrar, PanelError, audit, bodyOf, bool, str, strList } from '../context';
import { DeployTarget, deployCommands, loadCommands, scheduleCommandSync } from '../../utils/CommandLoader';
import { MUSIC_COMMANDS } from '../../utils/MusicService';
import { CommandInfo } from '../../shared/types';

export const registerCommandRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/commands', async (): Promise<CommandInfo[]> => {
    const commandSettings = client.settings.get().commands;

    return Array.from(client.commands.values())
      .map((command) => {
        const json = command.data.toJSON();
        const settings = commandSettings[json.name];
        const counter = client.stats.getCounter(json.name);

        return {
          name: json.name,
          description: json.description,
          category: command.private ? 'dev' : MUSIC_COMMANDS.has(json.name) ? 'music' : 'utility',
          private: !!command.private,
          options: json.options?.length ?? 0,
          enabled: settings?.enabled ?? true,
          disabledGuilds: settings?.disabledGuilds ?? [],
          uses: counter?.uses ?? 0,
          lastUsed: counter?.lastUsed ?? null
        } satisfies CommandInfo;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get('/commands/history', async () => client.stats.getHistory());

  app.put('/commands/:name', async (request) => {
    const { name } = request.params as { name: string };
    if (!client.commands.has(name)) throw new PanelError(404, 'Unknown command.');

    const body = bodyOf(request);
    const commands = { ...client.settings.get().commands };
    const current = commands[name] ?? { enabled: true, disabledGuilds: [] };

    commands[name] = {
      enabled: bool(body.enabled, current.enabled),
      disabledGuilds: Array.isArray(body.disabledGuilds) ? strList(body.disabledGuilds, 500) : current.disabledGuilds
    };

    client.settings.update('commands', commands);
    audit(ctx, request, commands[name].enabled ? 'Enabled command' : 'Disabled command', `/${name}`);

    const synced = current.enabled !== commands[name].enabled && scheduleCommandSync(client);
    return { ok: true, synced };
  });

  app.post('/commands/deploy', async (request) => {
    const target = str(bodyOf(request).target, 10) as DeployTarget;
    if (!['guild', 'global', 'both'].includes(target)) throw new PanelError(400, 'Invalid deploy target.');

    try {
      const result = await deployCommands(client, target);
      audit(ctx, request, 'Deployed commands', target);
      return result;
    } catch (error) {
      console.error('❌ Error deploying commands from panel:', error);
      throw new PanelError(500, `Deploy failed: ${error instanceof Error ? error.message : error}`);
    }
  });

  app.post('/commands/reload', async (request) => {
    const result = loadCommands(client, { fresh: true });
    audit(ctx, request, 'Reloaded commands', `${result.loaded} loaded, ${result.errors.length} errors`);
    return result;
  });
};
