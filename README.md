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

### 📅 Special Commands
- **Song of the Day** - Discover music from history with extensive genre selection
  - 7 main genres (Rock, Pop, Electronic, Hip-Hop, Jazz, Metal, Classical)
  - 8 sub-genres per main genre (56 total sub-genres!)
  - "Surprise Me" random selection
  - MusicBrainz database integration

### 🎧 Music Commands
- `/play <query>` - Play a song or add it to the queue
- `/skip` - Skip the current track
- `/stop` - Stop playback and clear the queue
- `/queue` - View the current queue
- `/loop <mode>` - Set loop mode (off/track/queue)
- `/songoftheday` - Discover and play a song from music history

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
│       ├── loop.ts
│       └── songoftheday.ts
├── interfaces/
│   └── Command.ts        # Command interface
└── utils/
    └── QueueManager.ts   # Queue management system
```

## Setup

### Prerequisites
- Node.js 18+ 
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

3. Create a `.env` file in the root directory:
```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_bot_client_id
GUILD_ID=your_test_guild_id
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
```

4. Set up Lavalink:
   - Download [Lavalink.jar](https://github.com/lavalink-devs/Lavalink/releases)
   - Configure `application.yml` (see [MUSIC_SETUP.md](MUSIC_SETUP.md))
   - Run Lavalink: `java -jar Lavalink.jar`

5. Build and run the bot:
```bash
npm run build
npm start
```

For development with auto-reload:
```bash
npm run dev
```

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
- `npm run dev` - Run in development mode with auto-reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled bot
- `npm run deploy` - Deploy slash commands globally

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

### Song of the Day
The Song of the Day feature provides:
- **Two-tier genre selection** - Pick a main genre, then choose a specific sub-genre
- **56 sub-genres** across 7 main categories
- **Random options** at both levels
- **MusicBrainz integration** for authentic music discovery
- **Rich embeds** with song details, artist, year, and artwork

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

### Song of the Day returns no results
- MusicBrainz API may have rate limits
- Some genres have limited data in MusicBrainz
- Try different sub-genres or use "Surprise Me"

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
- [MusicBrainz](https://musicbrainz.org/) - Music metadata database

## Support

For bugs or feature requests, please open an issue on GitHub.

---

Made with ❤️ and TypeScript
