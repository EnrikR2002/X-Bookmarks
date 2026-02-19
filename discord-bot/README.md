# X Bookmarks Discord Bot

A Discord bot that analyzes your X/Twitter bookmarks using Claude AI and delivers categorized weekly digests.

## Features

- 📚 **Fetch & Analyze Bookmarks**: Automatically fetch your X bookmarks and categorize them with Claude Haiku
- 🎯 **Actionable Insights**: Identify high-value bookmarks and generate action items
- 💰 **Cost Tracking**: Monitor Claude API usage and costs
- 🤖 **Opus-Ready Prompts**: Generate detailed prompts for deep-dive analysis with Claude Opus
- 📊 **Multi-Category Organization**: AI, crypto, marketing, tools, personal, news, content ideas

## Prerequisites

- Node.js 20+ installed
- Discord bot token ([Create one here](https://discord.com/developers/applications))
- Anthropic API key ([Get one here](https://console.anthropic.com/))
- X/Twitter auth tokens (AUTH_TOKEN and CT0)
- Bird CLI installed globally: `npm install -g @steipete/bird`

## Setup

### 1. Install Dependencies

```bash
cd discord-bot
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Discord
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
GUILD_ID=your_discord_server_id  # Optional, for dev

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# X/Twitter (get from browser DevTools cookies)
AUTH_TOKEN=your_x_auth_token
CT0=your_x_ct0_token

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

### 3. Get X/Twitter Auth Tokens

1. Open X/Twitter in your browser and log in
2. Open DevTools (F12) → Application → Cookies
3. Find `auth_token` cookie → copy value to `AUTH_TOKEN`
4. Find `ct0` cookie → copy value to `CT0`

### 4. Register Slash Commands

```bash
npm run register-commands
```

You should see:

```
✅ Successfully registered commands to guild [YOUR_GUILD_ID]
Commands registered:
  /bookmark-digest - Fetch and analyze your latest X/Twitter bookmarks
  /make-actionable - Get a detailed Opus-ready prompt for a specific bookmark
```

### 5. Start the Bot

Development mode (auto-reload):

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

You should see:

```
🚀 Starting Discord bot...
✅ Bot is ready! Logged in as YourBot#1234
📊 Serving 1 guild(s)
```

## Usage

### `/bookmark-digest [count]`

Fetch and analyze your latest bookmarks.

**Examples:**

```
/bookmark-digest
/bookmark-digest count:30
/bookmark-digest count:100
```

**Output:**

A categorized digest with:
- 🎯 Actionable bookmarks vs 📖 reference-only
- Summary and suggested action for each
- Cost breakdown
- Monthly spending total

### `/make-actionable [bookmark-id]`

Generate a detailed Opus-ready prompt for a specific bookmark.

**Examples:**

```
/make-actionable bookmark-id:1234567890
/make-actionable bookmark-id:https://twitter.com/username/status/1234567890
```

**Output:**

An embed with:
- Bookmark context and engagement stats
- Claude's analysis
- Suggested action
- Full Opus prompt you can copy/paste into Claude Code

## Project Structure

```
discord-bot/
├── src/
│   ├── index.ts                      # Entry point
│   ├── commands/
│   │   ├── bookmark-digest.ts        # Main command
│   │   ├── make-actionable.ts        # Opus prompt generator
│   │   └── register-commands.ts      # Slash command registration
│   ├── services/
│   │   ├── bookmark-fetcher.ts       # Bird CLI wrapper
│   │   ├── claude-analyzer.ts        # Haiku categorization
│   │   ├── digest-formatter.ts       # Discord embeds
│   │   └── cost-tracker.ts           # API usage tracking
│   └── types/
│       ├── bird-cli.ts               # Bird JSON types
│       ├── bookmark.ts               # Internal types
│       └── digest.ts                 # Digest structures
├── scripts/
│   └── fetch_bookmarks.sh            # Bird CLI wrapper script
├── .env                              # Your secrets (gitignored)
├── package.json
└── tsconfig.json
```

## Cost Estimates

Using **Claude 3.5 Haiku** ($1/1M input, $5/1M output):

- **50 bookmarks digest**: ~$0.02-0.05
- **Single `/make-actionable`**: ~$0.001
- **Weekly digest (50 bookmarks)**: ~$0.10/month

Total monthly cost for 1 user with weekly digests: **< $0.50**

## Troubleshooting

### "Missing X authentication tokens"

Make sure `AUTH_TOKEN` and `CT0` are set in your `.env` file.

### "Bird CLI failed"

1. Verify bird is installed: `bird --version`
2. Test bird directly: `bird bookmarks --json`
3. Check if your X cookies are still valid (re-login if needed)

### "Bot doesn't respond to commands"

1. Make sure you ran `npm run register-commands`
2. Verify the bot has proper permissions in your Discord server
3. Check bot logs for errors

### "Failed to parse Bird CLI output"

The bash script might not be executable. Run:

```bash
chmod +x scripts/fetch_bookmarks.sh
```

## Development

Run in development mode with auto-reload:

```bash
npm run dev
```

Build TypeScript:

```bash
npm run build
```

## Deployment (Production)

Using PM2 (Windows):

```bash
npm run build
npm install -g pm2
pm2 start dist/index.js --name "bookmark-bot"
pm2 save
pm2 startup
```

## Next Steps (Future Phases)

- **Phase 2**: Multi-user support with encrypted token storage
- **Phase 3**: Weekly auto-digests via cron scheduler
- **Phase 4**: Bookmark cleanup suggestions, pattern detection

## License

MIT
