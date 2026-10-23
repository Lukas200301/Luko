# 🎵 Luko Music System

The Luko bot includes a complete music system powered by **Lavalink** and **Shoukaku**.

## 📋 Prerequisites

Before using the music system, you need a **Lavalink server**. The setup scripts install and update it for you.

### Installing Lavalink (automatic)

The setup scripts in `scripts/` install or update Lavalink and keep it running with pm2. You need
**Java 17 or newer** (for example `winget install EclipseAdoptium.Temurin.21.JRE` on Windows or
`sudo apt install openjdk-21-jre-headless` on Debian/Ubuntu) and `npm install` done in the bot folder.

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-lavalink.ps1
```

**Linux / macOS:**
```bash
bash scripts/setup-lavalink.sh
```

What the script does:
1. Checks Java and pm2
2. Downloads the newest `Lavalink.jar` from GitHub into `lavalink/` (skipped if already up to date)
3. Creates `lavalink/application.yml` with the official [YouTube plugin](https://github.com/lavalink-devs/youtube-source)
   and a [cipher server](https://github.com/kikkia/yt-cipher) that decodes YouTube's stream signatures.
   Lavalink's built-in YouTube source is deprecated and turned off.
4. Uses `LAVALINK_PASSWORD` from `.env` (or generates one and adds it to `.env`)
5. Starts Lavalink with pm2 as `lavalink` and waits until it answers

The **PowerShell script** additionally sets up:
- [LavaSrc](https://github.com/topi314/LavaSrc) for Spotify and Apple Music (uses `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` from `.env`)
- YouTube sign-in from `YOUTUBE_REFRESH_TOKEN` in `.env`, if you have one
- a small plugin for SoundCloud Opus streams and a yt-dlp fallback (`lavalink/plugins/`)

The Bash script doesn't do these three yet.

**Updating:** run the script again, or click **Update** on the admin panel's Lavalink page. It downloads a newer
Lavalink if there is one and bumps the plugin versions. Your own changes to `application.yml` are kept.

**Options:**

| PowerShell | Bash | Default | Meaning |
|---|---|---|---|
| `-InstallDir` | `--dir` | `lavalink/` | Where Lavalink is installed |
| `-Port` | `--port` | `2333` | Port (only used when `application.yml` is created) |
| `-Password` | `--password` | from `.env` | Lavalink password |
| `-YouTubeRefreshToken` | | from `.env` | YouTube sign-in token (PowerShell only) |
| `-MemoryMB` | `--memory` | `1024` | Java heap size in MB |
| `-Name` | `--name` | `lavalink` | pm2 process name |

**Useful pm2 commands:** `pm2 logs lavalink`, `pm2 restart lavalink`, `pm2 stop lavalink`.
On Linux, run `pm2 startup` once (and follow its instructions) so pm2 starts at boot. On Windows, use
[pm2-installer](https://github.com/jessety/pm2-installer) to run pm2 as a service.

After installing, open the admin panel's **Lavalink** page and set the host and port under **Connection**.
Use `localhost` when Lavalink runs on the same machine as the bot. Saving reconnects right away.

## 🖥️ Managing Lavalink in the admin panel

The **Lavalink** page (under System) shows:
- **Live stats:** players, CPU, memory, frame stats, Lavalink version, plugins and sources
- **Connection:** host, port and TLS. Saving reconnects without restarting the bot
- **YouTube:** *Test playback* tries every YouTube client and shows which ones can play from your server,
  and *Sign in to YouTube* walks you through the sign-in (see below)

When Lavalink runs next to the bot (installed with the setup script into `lavalink/`), you also get:
- pm2 status with **Start**, **Stop**, **Restart** and **Update** (owner only)
- a **config editor** for port, memory, sources, YouTube client order, cipher server and audio quality,
  plus a raw YAML editor that checks the file before saving
- the live **Lavalink log**

## 🔌 Automatic reconnect

If Lavalink isn't running when the bot starts, or it restarts, crashes or gets updated, the bot keeps trying to
reconnect: first after 5 seconds, then 10, 20 and 30 seconds, and then every minute until Lavalink answers.
Music sessions that were playing on the lost connection are stopped, and the bot tells the channel to use `/play`
again. Nothing else is needed: once Lavalink is back, music works again.

## ▶️ When YouTube won't play

YouTube regularly blocks servers. Typical errors in the log:

| Error | Cause | Fix |
|---|---|---|
| `Must find sig function` | YouTube changed its player; the plugin can't decode signatures | Use a cipher server (`remoteCipher.url`, set by the setup script) |
| `This video requires login` / `This video cannot be loaded` | YouTube's bot check for your IP | Sign in with a spare Google account (below) |
| `All clients failed to load the item` | Every client in the list failed | Run **Test playback** on the Lavalink page to see why |

**Signing in to YouTube.** Use a **spare** Google account, never your main one: YouTube can restrict accounts used this way.
1. Lavalink page → **Sign in to YouTube**. Lavalink restarts and shows a code.
2. Open [google.com/device](https://www.google.com/device), sign in with the spare account and enter the code.
3. Click **Save sign-in**. The token is stored in `application.yml`, so it survives restarts.

Without the panel: set `plugins.youtube.oauth.enabled: true`, add `TV` to the clients, restart Lavalink and follow
the code in its log, or put an existing token in `.env` as `YOUTUBE_REFRESH_TOKEN` and run the PowerShell setup script.

## 🎮 Music Commands

### `/play <query> [source]`
Play a song or playlist by name or URL.
- **Usage:** `/play <song name or URL>`
- **source** (optional): where to search by name: Auto, YouTube Music, YouTube, Spotify, SoundCloud, Apple Music, Deezer or Bandcamp
- **URLs:** YouTube, Spotify, SoundCloud, Apple Music, Deezer, Bandcamp, Twitch, Vimeo and direct audio links.
  Short links (`spotify.link`, `on.soundcloud.com`, …) are followed automatically.
- **Examples:**
  - `/play Never Gonna Give You Up`
  - `/play https://www.youtube.com/watch?v=dQw4w9WgXcQ`
  - `/play https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8`

If a track fails to load (for example YouTube blocks it), the bot automatically tries the same song from another
source before skipping it. When [yt-dlp](https://github.com/yt-dlp/yt-dlp) is installed, it is used as a last resort.

### `/search <query>`
Search and pick one of the results from a menu.

### `/skip`, `/previous`, `/jump`
Skip the current track, go back to the previous one, or jump to a position in the queue.

### `/stop`
Stop the music, clear the queue, and disconnect from the voice channel.

### `/queue`, `/nowplaying`
Show the queue or the current track with its progress.

### `/loop`, `/shuffle`, `/autoplay`, `/volume`, `/seek`, `/filter`
Loop the track or queue, shuffle, play related songs when the queue ends, change the volume, seek, or apply audio filters.

Everything can also be controlled from the admin panel's **Music** page.

## 🎯 Features

✅ **Multi-Source Support** - YouTube, Spotify, SoundCloud, Apple Music, Deezer and more
✅ **Queue System** - Add multiple songs and play them in order
✅ **Auto-Disconnect** - Bot leaves when everyone exits the voice channel
✅ **Auto-Reconnect** - Recovers by itself when Lavalink restarts
✅ **Fallback Sources** - Tries another source when a track fails to load
✅ **Loop Mode** - Repeat your favorite tracks or the whole queue
✅ **Rich Embeds** - Beautiful displays for now playing and queue info
✅ **Permission Checks** - Ensures users are in the correct voice channel

## 🚀 Usage Example

1. **Install and start Lavalink** (once):
   ```bash
   bash scripts/setup-lavalink.sh
   ```

2. **Start your bot**:
   ```bash
   npm run dev
   ```

3. **Use the commands in Discord**:
   - Join a voice channel
   - Type `/play Never Gonna Give You Up`
   - Enjoy! 🎵

## 🛠️ Architecture

- **Shoukaku**: Lavalink client for Discord.js
- **LavalinkConnection**: Keeps the Lavalink connection alive and reconnects automatically
- **MusicService**: Resolves queries and URLs across platforms and handles playback and fallbacks
- **QueueManager**: Queue per server
- **Voice State Handling**: Automatic cleanup when users leave channels

## 📝 Notes

- The bot requires the `GuildVoiceStates` intent to track voice channel activity
- Lavalink can be started before or after the bot; the bot connects as soon as it's available
- Make sure Java 17+ is installed for Lavalink
