# 🎵 Luko Music System

The Luko bot now includes a complete music system powered by **Lavalink** and **Shoukaku**.

## 📋 Prerequisites

Before using the music system, you need to set up a **Lavalink server**.

### Installing Lavalink

1. **Download Lavalink:**
   - Get the latest `Lavalink.jar` from: https://github.com/lavalink-devs/Lavalink/releases

2. **Create `application.yml`:**
   ```yaml
   server:
     port: 2333
     address: 0.0.0.0
   lavalink:
     server:
       password: "youshallnotpass"
       sources:
         youtube: true
         bandcamp: true
         soundcloud: true
         twitch: true
         vimeo: true
         http: true
         local: false
       bufferDurationMs: 400
       frameBufferDurationMs: 5000
       youtubePlaylistLoadLimit: 6
       playerUpdateInterval: 5
       youtubeSearchEnabled: true
       soundcloudSearchEnabled: true
       gc-warnings: true
   ```

3. **Run Lavalink:**
   ```bash
   java -jar Lavalink.jar
   ```

## 🔧 Configuration

Update your `.env` file with Lavalink credentials:

```env
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
```

## 🎮 Music Commands

### `/play <query>`
Play a song from YouTube, Spotify, or SoundCloud.
- **Usage:** `/play <song name or URL>`
- **Examples:**
  - `/play Never Gonna Give You Up`
  - `/play https://www.youtube.com/watch?v=dQw4w9WgXcQ`
  - `/play spotify:track:3n3Ppam7vgaVa1iaRUc9Lp`

### `/skip`
Skip the current track and play the next one in the queue.

### `/stop`
Stop the music, clear the queue, and disconnect from the voice channel.

### `/queue`
Display the current music queue with all upcoming tracks.

### `/loop`
Toggle loop mode to repeat the current track indefinitely.

## 🎯 Features

✅ **Multi-Source Support** - YouTube, Spotify, SoundCloud, and more  
✅ **Queue System** - Add multiple songs and play them in order  
✅ **Auto-Disconnect** - Bot leaves when everyone exits the voice channel  
✅ **Loop Mode** - Repeat your favorite tracks  
✅ **Rich Embeds** - Beautiful displays for now playing and queue info  
✅ **Permission Checks** - Ensures users are in the correct voice channel  

## 🔗 Dependencies

The following npm package is required:
```bash
npm install shoukaku
```

Already included in `package.json`!

## 🚀 Usage Example

1. **Start Lavalink server** (in a separate terminal):
   ```bash
   java -jar Lavalink.jar
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
- **QueueManager**: Custom queue system for managing tracks per guild
- **Voice State Handling**: Automatic cleanup when users leave channels
- **Event-Driven**: Handles track endings, errors, and disconnections

## 📝 Notes

- The bot requires the `GuildVoiceStates` intent to track voice channel activity
- Lavalink must be running before starting the bot
- Make sure Java 17+ is installed for Lavalink
