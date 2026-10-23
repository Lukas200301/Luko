// Resets the admin panel's web access settings (local mode, 0.0.0.0:5000) in data/luko.db.
// Use it if a wrong domain or port locked you out of the panel:  npm run panel:reset
// The admin list is kept. Restart the bot afterwards.
import { db } from '../utils/Database';

const row = db.prepare("SELECT value FROM settings WHERE section = 'panel'").get() as { value: string } | undefined;
const panel = row ? JSON.parse(row.value) : {};
const reset = { ...panel, enabled: true, host: '0.0.0.0', port: 5000, publicUrl: '' };

db.prepare('INSERT INTO settings (section, value) VALUES (?, ?) ON CONFLICT (section) DO UPDATE SET value = excluded.value')
  .run('panel', JSON.stringify(reset));

console.log('✅ Panel access reset: local network mode on port 5000. Restart the bot to apply it.');
