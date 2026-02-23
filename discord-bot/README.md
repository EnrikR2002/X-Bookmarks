# X Bookmarks Discord Bot

Discord bot for turning X/Twitter bookmarks into structured digests and actionable next steps.

## What it does

- Fetches bookmarks from X via `bird` CLI.
- Re-fetches stub bookmarks (`t.co` only) to recover full article content.
- Enriches external links with title/description context.
- Analyzes bookmarks with Groq (`llama-3.3-70b-versatile`) in batches.
- Stores analyses in SQLite and skips already-analyzed bookmarks automatically.
- Sends category-grouped digest embeds to Discord.
- Supports one-off deep analysis (`/make-actionable`) with downloadable Opus prompt.
- Supports scheduled daily/weekly digests.

## Slash commands

- `/register-auth auth_token:<...> ct0:<...>`
  - Validates cookies with `bird whoami`, then stores encrypted per-user tokens.
- `/bookmark-digest [count]`
  - Finds up to `count` new bookmarks (default `10`, max `100`), analyzes them, and posts a digest.
- `/make-actionable bookmark-id:<tweet id or URL>`
  - Deep analysis of one bookmark + 3–5 action ideas + `.txt` Opus prompt attachment.
- `/schedule-digest enable channel:<#channel> frequency:<daily|weekly>`
  - Daily: 09:00 UTC (`0 9 * * *`)
  - Weekly: Monday 09:00 UTC (`0 9 * * 1`)
- `/schedule-digest disable`
- `/bookmark-stats [period:<week|month|all>]`
  - Shows totals, category distribution, actionable %, top authors, and token usage.

## Current digest format

Each category section is shown as `[CATEGORY]` and each item is formatted like:

- `Title - @author`
- 3–5 sentence breakdown
- `Bookmark ID: ...`
- `Link to the tweet: https://x.com/<author>/status/<id>`
- `Suggested actions:` with bullet points

The formatter enforces Discord embed limits (field chunking + truncation safeguards).

## Stack

- TypeScript + Discord.js v14
- Groq SDK (`llama-3.3-70b-versatile`)
- `@steipete/bird` for bookmark access
- SQLite (`better-sqlite3`) with WAL
- `node-cron` scheduler
- AES-256-GCM token encryption
- Fly.io deployment with persistent volume (`/app/data`)

## Local setup

1. Install dependencies:

```bash
npm install
```

1. Create `.env` in `discord-bot/`:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
# Optional but recommended for fast command registration during development
GUILD_ID=...

GROQ_API_KEY=...
ENCRYPTION_KEY=<64-hex-characters>

# Optional fallback tokens for single-user/local use
AUTH_TOKEN=...
CT0=...
```

1. Build + run:

```bash
npm run build
npm run start
```

1. Register slash commands:

```bash
npm run register-commands
```

## Deploy (Fly.io)

```bash
fly deploy
fly logs -a x-bookmarks-bot
```

## Storage model

- `users`: encrypted X tokens, schedule config, last digest metadata
- `analyzed_bookmarks`: cached analyses (category/summary/takeaway/actions/etc.) for dedup
- `usage_log`: model token usage by operation

## Notes on the original Claude Skill

This repo contains two separate things:

1. `discord-bot/` (the production bot)
2. `skills/x-bookmarks/` (Claude Skill docs/scripts)

Current status:

- The Discord bot does **not** import or execute `skills/x-bookmarks/SKILL.md`.
- There is no runtime wiring from `discord-bot/src/**` to the skill folder.
- The bot does include a concept inspired by that workflow: `/make-actionable` generates an “Opus-ready” prompt and sends it as a file.
- The shell helper scripts in `skills/x-bookmarks/scripts/` and `discord-bot/scripts/` are currently similar, but the bot itself uses direct `bird` process calls in code (`BookmarkFetcher`) rather than invoking the skill definition.

So: the Skill is currently reference material/inspiration, not an active runtime dependency.

## Troubleshooting

- `Invalid X auth tokens`: re-copy fresh `auth_token` + `ct0`, then run `/register-auth` again.
- `Bird CLI failed`: verify `bird` is installed and auth works with `bird whoami`.
- `No new bookmarks`: bot dedupes by bookmark ID; increase `count` or wait for newer bookmarks.
