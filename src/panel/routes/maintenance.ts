import * as fs from 'node:fs';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, requireOwner, str } from '../context';
import { BACKUP_DIR } from '../../utils/Database';
import { checkForUpdates, currentUpdateStatus, startUpdate, updateStatus } from '../../utils/Updater';
import { BackupOverview, UpdateStatus } from '../../shared/types';

// Backups of the database and updating the bot from GitHub.
export const registerMaintenanceRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;
  const underPm2 = () => process.env.pm_id !== undefined;

  // ---- Backups ----

  app.get('/backups', async (): Promise<BackupOverview> => ({
    backups: client.backups.list(),
    dir: BACKUP_DIR,
    databaseSize: client.backups.databaseSize(),
    lastAutoBackup: client.backups.lastAutoBackup(),
    canRestore: underPm2()
  }));

  app.post('/backups', async (request) => {
    const backup = client.backups.create('manual');
    audit(ctx, request, 'Created a database backup', backup.name);
    return backup;
  });

  // The backup holds everything (also login sessions), so only the owner can download it.
  app.get('/backups/:name/download', async (request, reply) => {
    requireOwner(request);
    const { name } = request.params as { name: string };
    const file = client.backups.pathOf(name);
    if (!file) throw new PanelError(404, 'Backup not found.');
    audit(ctx, request, 'Downloaded a database backup', name);
    return reply
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Cache-Control', 'no-store')
      .type('application/vnd.sqlite3')
      .send(fs.createReadStream(file));
  });

  app.delete('/backups/:name', async (request) => {
    requireOwner(request);
    const { name } = request.params as { name: string };
    if (!client.backups.delete(name)) throw new PanelError(404, 'Backup not found.');
    audit(ctx, request, 'Deleted a database backup', name);
    return { ok: true };
  });

  app.post('/backups/:name/restore', async (request) => {
    requireOwner(request);
    const { name } = request.params as { name: string };
    if (!underPm2()) throw new PanelError(400, 'Restoring restarts the bot, which only works when it runs under pm2.');
    if (!client.backups.pathOf(name)) throw new PanelError(404, 'Backup not found.');

    const safety = client.backups.prepareRestore(name);
    audit(ctx, request, 'Restored a database backup', `${name} (the current data was saved as ${safety.name})`);
    console.log(`🗄️ Restoring ${name} from the admin panel; the bot restarts now.`);
    setTimeout(() => process.exit(0), 750);
    return { ok: true, safety: safety.name };
  });

  // ---- Updates ----

  app.get('/updates', async (): Promise<UpdateStatus> => currentUpdateStatus());

  app.post('/updates/check', async (): Promise<UpdateStatus> => {
    await checkForUpdates(client);
    return updateStatus();
  });

  app.post('/updates/install', async (request): Promise<UpdateStatus> => {
    requireOwner(request);
    const rebuild = bool(bodyOf(request).rebuild, false);
    try {
      startUpdate(client, { rebuild });
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
    audit(ctx, request, rebuild ? 'Reinstalled and rebuilt the bot' : 'Started a bot update', rebuild ? undefined : str(updateStatus().commits[0]?.subject, 100));
    return updateStatus();
  });
};
