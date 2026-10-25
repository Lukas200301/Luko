# Luko - Discord Music Bot 🎵

A feature-rich Discord music bot built with TypeScript, Discord.js v14, and Lavalink (Shoukaku).

## Features

### 🎵 Music Playback
- **High-quality audio** powered by Lavalink
- **YouTube Music search** integration
- **Queue management** with full control
- **Autoplay** to keep the music flowing
- **Loop modes** for tracks and queues
- **Volume control** and track skipping
- **Auto-delete responses** - Music command responses are deleted after 30 seconds for cleaner channels

### 🎧 Music Commands
- `/play <query>` - Play a song or add it to the queue
- `/skip` - Skip the current track
- `/stop` - Stop playback and clear the queue
- `/queue` - View the current queue
- `/loop <mode>` - Set loop mode (off/track/queue)
- `/playlist play|save|add|create|show|list|remove|delete` - Saved playlists everyone can play
- `/history` - Recently played and most played songs on the server

### 🎉 Community Commands
- `/poll <question> <options>` - Button poll with live results (optional duration, multiple choice, anonymous)
- `/birthday set|remove|show|upcoming` - Save your birthday; the bot congratulates you in the server's birthday channel
- `/remind <time> <message>` - Get reminded later

### 🔧 Utility Commands
- `/ping` - Check bot latency
- `/deploy` - Deploy slash commands (admin only)
- `/reload` - Reload commands (admin only)
- `/invite` - Get the bot invite link with proper permissions

## Tech Stack

- **TypeScript** - Type-safe JavaScript
- **Discord.js v14** - Discord API wrapper
- **Shoukaku v4** - Lavalink client for audio
- **Lavalink** - High-performance audio server
- **Node.js** - JavaScript runtime
- **Fastify** - Web server for the admin panel (runs inside the bot process)
- **React + Vite + Tailwind CSS** - Admin panel frontend

## Architecture

```
src/
├── index.ts              # Bot entry point
├── commands/             # Slash commands
│   ├── ping.ts
│   ├── deploy.ts
│   ├── reload.ts
│   └── music/
│       ├── play.ts
│       ├── skip.ts
│       ├── stop.ts
│       ├── queue.ts
│       └── loop.ts
├── interfaces/
│   └── Command.ts        # Command interface
├── panel/                # Admin panel backend (Fastify API, auth, live events)
├── shared/types.ts       # Types shared by the bot and the panel
└── utils/
    ├── QueueManager.ts   # Queue management system
    ├── MusicService.ts   # Shared playback logic (commands + panel)
    └── SettingsManager.ts# data/settings.json
panel/                    # Admin panel frontend (React + Vite)
```

## Setup

### Prerequisites
- Node.js 22.12+ 
- npm or yarn
- A Discord Bot Token
- A Lavalink server

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Lukas200301/luko.git
cd luko
```

2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in the secrets:
```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_bot_client_id
DEV_GUILD_ID=your_test_guild_id
OWNER_ID=your_discord_user_id
LAVALINK_PASSWORD=youshallnotpass
DISCORD_CLIENT_SECRET=   # for "Continue with Discord" in the admin panel
PANEL_PASSWORD=          # optional password login for the admin panel
```
   Everything else (settings, reminders, pinboard posts, command stats, panel logins and the audit log)
   lives in an SQLite database at `data/luko.db`, using Node's built-in `node:sqlite`. Settings are
   changed in the admin panel. Older JSON files in `data/` (including `settings.json`) are imported
   automatically on the first start and kept as `*.json.migrated`.

4. Set up Lavalink (needs Java 17+). The setup script downloads the latest Lavalink and the
   YouTube plugin, writes `application.yml` with the password from your `.env`, and runs it with pm2:
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts/setup-lavalink.ps1`
   - Linux/macOS: `bash scripts/setup-lavalink.sh`

   Run it again any time to update Lavalink. See [MUSIC_SETUP.md](MUSIC_SETUP.md) for options.

5. Build and run the bot (this also builds the admin panel):
```bash
npm run build
npm start
```

For development, run straight from the TypeScript source:
```bash
npm run dev
```

## Admin Panel

Luko comes with a web admin panel that runs inside the bot on port **5000**. It has:

- **Dashboard** - live status, uptime, ping, memory/CPU charts, Lavalink health, recent errors
- **Music** - live player for every server: pause, skip, seek, volume, loop, filters, autoplay, drag-and-drop queue, search and add songs, start a session from the browser
- **Pinboard** - any number of pinboards across servers, each with its own channel, emojis, reactions needed (per board and per emoji), ignored channels and options; per-board statistics (pins over time, emojis, top authors and channels, record pins) and a searchable list sortable by date or reactions and filterable by emoji, author and channel
- **Emojis** - upload, rename and delete the bot's own (application) emojis, usable in every server
- **Playlists** - create playlists, add songs by search or link, reorder by drag and drop, play them on any server
- **Music stats** - songs played over time, top songs, artists and listeners, time of day, and the full play history
- **Reminders** - see, create and delete all reminders, picking the user from the server's member list
- **Birthdays** - everyone's birthdays, the announcement channel per server, message and time
- **Polls** - start polls, watch results live, end or delete them
- **Servers** - server details, channels, roles, emojis, bot permissions, bot nickname, per-server command toggles, leave server
- **Commands** - enable/disable commands (disabled ones are removed from Discord's / menu automatically), usage counts, deploy, reload from disk
- **Messages** - send messages and embeds as the bot, with a live preview
- **Presence** - online status, rotating activities with placeholders, maintenance mode
- **Lavalink** - live stats, connection settings, YouTube playback test and sign-in, and for a local install: start/stop/restart, update, config editor and log
- **Logs & Activity** - live console, command usage history, audit log of panel changes
- **Maintenance** - install updates from GitHub with one click (pull, install, build, restart, with a live log),
  database backups (daily automatic plus manual, download and restore), and owner alerts by DM
  (Lavalink down, many errors, disk almost full, CPU hot, new update, failed backup), each one switchable
- **Settings** - feature toggles, music settings, member list, admin list, web access, restart (pm2)

### Who can log in
Only the owner (`OWNER_ID`) and the admins you add in **Settings → Panel access**. Two login methods:
- **Discord** - set `DISCORD_CLIENT_SECRET` and add the redirect URL shown on the login page
  (`http://<server-ip>:5000/auth/callback` or `https://your-domain/auth/callback`) in the
  Discord Developer Portal under *OAuth2 → Redirects*.
- **Password** - set `PANEL_PASSWORD`. This signs you in as the owner.

### Local network mode (default)
With no domain configured, the panel is reachable at `http://<server-ip>:5000` from devices on the
same network only; requests from outside the local network are blocked. The login page and the
sidebar show a notice about this, and the bot prints the URLs on startup.

### Using a domain
Set **Public URL** in *Settings → Panel access* (or `panel.publicUrl` in `data/settings.json`),
restart the bot, and put a reverse proxy with HTTPS in front of port 5000. Example with Caddy:
```
panel.example.com {
    reverse_proxy localhost:5000
}
```

### Updates from the panel
*Maintenance → Updates* checks GitHub every 6 hours. **Install update** backs up the database, runs `git pull`,
`npm install` (only when dependencies changed) and `npm run build`, then restarts the bot through pm2. It refuses to run
while files on the server have local changes (`package-lock.json` is reset automatically), so a pull can't fail halfway.

### Backups
Backups are written to `data/backups/` (daily at the chosen time, before every update and before every restore).
Restoring replaces the database with the backup and restarts the bot (needs pm2); the current data is backed up first.
Copy a few backups to another device now and then: they don't help if the SD card itself dies.

### Locked out?
If a wrong domain or port setting keeps you out of the panel, run `npm run panel:reset` on the server
and restart the bot. It switches the panel back to local network mode on port 5000 (the admin list stays).

### Full member list
Picking users (for reminders) works by name search out of the box. To list every member of a server,
enable **Server Members Intent** in the Discord Developer Portal (your app → Bot), then turn on
**Full member list** in *Settings* and restart the bot.

### Panel development
`npm run dev:panel` starts Vite with hot reload on port 5173 and forwards API calls to the bot on port 5000.

## Upgrading from an older version

Older versions stored their data as JSON files in `data/` (`reminders.json`, `pinboard.json`, `settings.json`, …).
You don't need to convert anything by hand:

1. Stop the bot and **make a copy of the `data/` folder**. `data/reminders.json` used to be part of the repository,
   so `git pull` deletes it; copy it back into `data/` after pulling.
2. Pull the new code and run `npm install` and `npm run build`.
3. Start the bot as usual. On the first start it imports every JSON file it finds in `data/` into `data/luko.db`
   and renames the files to `*.json.migrated` as a backup. The log says what was imported.
4. Check the panel (Pinboard, Reminders, Settings). Once everything is there, you can delete the `*.json.migrated` files.

The import only runs once. If something went wrong, stop the bot, delete `data/luko.db` (and `luko.db-wal` / `luko.db-shm`),
rename the `*.json.migrated` files back to `*.json` and start the bot again.

## Configuration

### Lavalink Configuration
See [MUSIC_SETUP.md](MUSIC_SETUP.md) for detailed Lavalink setup instructions.

### Bot Permissions
ThView Channels
- Send Messages
- Manage Messages (for auto-deleting responses)
- Embed Links
- Connect (Voice)
- Speak (Voice)
- Use Application Commands

### Invite Link
Generate an invite link with the required permissions using `/invite` command, or use this template:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2151557120
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36785152&scope=bot%20applications.commands
```

## Development

### Project Structure
- `src/` - Source TypeScript files
- `dist/` - Compiled JavaScript files
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

### Available Scripts
- `npm run dev` - Run directly from TypeScript source (via tsx)
- `npm run dev:panel` - Admin panel frontend with hot reload (needs the bot running)
- `npm run build` - Compile the bot and build the admin panel
- `npm start` - Run the compiled bot
- `npm run typecheck` - Type-check the bot and the panel
- `npm run pm2:start` - Build and run under pm2 (enables restarting from the panel)
- Slash commands are deployed with `/deploy` or from the admin panel's Commands page

### Adding New Commands

1. Create a new file in `src/commands/` or `src/commands/music/`
2. Implement the `SlashCommand` interface:
```typescript
import { SlashCommand } from '../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('yourcommand')
    .setDescription('Your description'),
  
  execute: async (interaction) => {
    // Your command logic
  }
};
```

3. The command will be automatically loaded by the bot

## Features in Detail

### Queue System
- Tracks are managed in a custom queue per guild
- Supports track metadata (title, artist, duration, requester)
- Automatic player cleanup when queue ends
- Autoplay feature to continue playback

### Event Handling
The bot handles player events:
- `end` - Automatically plays next track or stops
- `exception` - Logs errors and continues
- Voice channel disconnect detection

## Troubleshooting

### Bot doesn't respond to commands
- Ensure slash commands are registered: use `/deploy`
- Check bot has proper permissions in the server
- Verify the bot is online and connected

### Music doesn't play
- Confirm Lavalink is running and accessible
- Check `.env` configuration matches Lavalink settings
- Ensure bot has voice permissions in the channel
- Verify YouTube/YouTube Music search is working

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API library
- [Shoukaku](https://github.com/Deivu/Shoukaku) - Lavalink client
- [Lavalink](https://github.com/lavalink-devs/Lavalink) - Audio delivery server

## Support

For bugs or feature requests, please open an issue on GitHub.

---

Made with ❤️ and TypeScript
