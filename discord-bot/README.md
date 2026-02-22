# X Bookmarks Discord Bot

A Discord bot that fetches your X/Twitter bookmarks, analyzes them with AI, and helps you take action on them. Runs 24/7 on Fly.io.

## Features

- **`/bookmark-digest`** — Fetch your latest bookmarks, categorize them with Groq AI, and get a structured digest. Skips already-analyzed bookmarks automatically.
- **`/make-actionable`** — Deep-dive a single bookmark: Groq reads the full content and returns specific action ideas + a ready-to-paste Opus prompt (delivered as a `.txt` file).
- **`/schedule-digest`** — Schedule automatic daily or weekly digests to any channel.
- **`/bookmark-stats`** — View stats on your analyzed bookmarks: category breakdown, actionable %, top authors, and token usage.
- **`/register-auth`** — Register your X auth tokens (stored AES-256-GCM encrypted in SQLite per user).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Bot framework | Discord.js v14 |
| Language | TypeScript (ESM) |
| AI analysis | Groq SDK — `llama-3.3-70b-versatile` (free tier) |
| Bookmark fetching | Bird CLI (`@steipete/bird`) |
| Database | SQLite via `better-sqlite3` |
| Token encryption | AES-256-GCM (Node.js `crypto`) |
| Scheduling | `node-cron` (polls every minute) |
| Hosting | Fly.io (free tier, always-on) |

## Setup

### 1. Prerequisites

- Node.js 20+
- Discord bot token — [create one here](https://discord.com/developers/applications)
- Groq API key — [get one here](https://console.groq.com/) (free)
- Bird CLI: `npm install -g @steipete/bird`
- X/Twitter `auth_token` and `ct0` cookies

### 2. Get X Auth Tokens

1. Open X/Twitter in your browser and log in
2. Open DevTools (F12) → Application → Cookies → `https://x.com`
3. Copy the value of `auth_token` and `ct0`

### 3. Environment Variables

Create a `.env` file in `discord-bot/`:

```bash
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
GROQ_API_KEY=your_groq_api_key
ENCRYPTION_KEY=a_random_32_character_string
```

`ENCRYPTION_KEY` must be exactly 32 characters — used to encrypt user auth tokens at rest.

### 4. Install & Run Locally

```bash
cd discord-bot
npm install
npm run build
npm start
```

### 5. Register Slash Commands

```bash
npm run register-commands
```

## Usage

### `/register-auth`

Register your X credentials so the bot can fetch your bookmarks. Tokens are encrypted before being stored.

```text
/register-auth auth_token:<your_auth_token> ct0:<your_ct0>
```

### `/bookmark-digest [count]`

Fetch and analyze your latest bookmarks. Already-analyzed bookmarks are skipped automatically (deduplication via SQLite). Default count: 10.

```text
/bookmark-digest
/bookmark-digest count:25
```

### `/make-actionable`

Deep-analyze a single bookmark. Groq reads the full content and generates specific, tactical action ideas. A ready-to-paste Claude Opus prompt is sent as a downloadable `.txt` file.

```text
/make-actionable bookmark-id:1234567890
/make-actionable bookmark-id:https://x.com/username/status/1234567890
```

### `/schedule-digest`

Set up automatic digests in any channel.

```text
/schedule-digest enable channel:#digest-channel frequency:weekly
/schedule-digest disable
```

### `/bookmark-stats [period]`

View a breakdown of your analyzed bookmarks.

```text
/bookmark-stats
/bookmark-stats period:week
/bookmark-stats period:month
```

## Project Structure

```text
discord-bot/
├── src/
│   ├── index.ts                        # Entry point, Discord client setup
│   ├── commands/
│   │   ├── register-commands.ts        # Slash command registration
│   │   ├── register-auth.ts            # /register-auth handler
│   │   ├── bookmark-digest.ts          # /bookmark-digest handler
│   │   ├── make-actionable.ts          # /make-actionable handler
│   │   ├── schedule-digest.ts          # /schedule-digest handler
│   │   └── bookmark-stats.ts           # /bookmark-stats handler
│   ├── services/
│   │   ├── bookmark-fetcher.ts         # Bird CLI wrapper + URL enricher caller
│   │   ├── claude-analyzer.ts          # Groq analysis (batch + single actionable)
│   │   ├── digest-formatter.ts         # Discord embed builders
│   │   ├── scheduler.ts                # Cron scheduler for auto-digests
│   │   ├── url-enricher.ts             # Fetches og:title/description from URLs
│   │   └── cost-tracker.ts             # Token usage tracking
│   ├── database/
│   │   ├── db.ts                       # SQLite singleton + migrations
│   │   ├── user-store.ts               # User tokens + schedule storage
│   │   ├── bookmark-store.ts           # Analyzed bookmark cache + dedup
│   │   └── usage-store.ts              # Token usage log
│   ├── utils/
│   │   └── crypto.ts                   # AES-256-GCM encrypt/decrypt
│   └── types/
│       ├── bird-cli.ts                 # Bird CLI JSON output types
│       ├── bookmark.ts                 # Internal bookmark types
│       └── digest.ts                   # Digest/analysis result types
├── data/
│   └── bookmarks.db                    # SQLite database (gitignored)
├── Dockerfile                          # Multi-stage build for Fly.io
├── fly.toml                            # Fly.io config (worker, no HTTP)
├── .env                                # Local secrets (gitignored)
├── package.json
└── tsconfig.json
```

## Deployment (Fly.io)

The bot runs as a persistent worker on Fly.io's free tier. No web server — just a Discord gateway connection.

### Deploy

```powershell
cd discord-bot
fly deploy
```

### View logs

```powershell
fly logs
```

### Set/update secrets

```powershell
fly secrets set DISCORD_TOKEN="..." GROQ_API_KEY="..."
```

### Update after code changes

```powershell
fly deploy
```

The SQLite database persists across deployments via a Fly volume mounted at `/app/data`.

## Troubleshooting

### "Invalid X auth tokens" on `/register-auth`

Your `auth_token` and `ct0` cookies may have expired. Re-login to X in your browser and copy fresh cookie values.

### "Bird CLI failed"

1. Check `fly logs` for the exact error
2. Verify bird is installed in the container (it's installed via Dockerfile)
3. Your X session cookies may have expired — re-register with `/register-auth`

### "No new bookmarks since last digest"

All fetched bookmarks have already been analyzed. Try a larger count: `/bookmark-digest count:50`.

### Bot not responding

1. Check `fly status` — machine should be `started`
2. Check `fly logs` for crash errors
3. Verify secrets are set: `fly secrets list`

## Cost

- **Groq API**: Free tier covers typical personal usage (6000 tokens/min, 500k tokens/day)
- **Fly.io**: Free tier — 1 shared-cpu-1x machine with 256MB RAM, 3GB volume storage
- **Total**: $0/month for personal use
