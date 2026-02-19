# X Bookmarks Discord Bot - Phases 3-4 Development Handoff

> **Copy the content under each phase heading and paste into a new Claude Code session to continue development.**

---

## Project Location

`C:\Users\enrik\Desktop\Coding Projects\X Bookmarks\discord-bot\`

Working directory: Windows machine with Git Bash. Use Unix shell syntax in all commands.

---

## What Phases 1 & 2 Built (Do Not Modify Unless Necessary)

A Discord bot that:

- Runs `bird` CLI to fetch X/Twitter bookmarks (per-user tokens from encrypted SQLite DB)
- Re-fetches stub bookmarks (bare t.co links) to get full X Article content
- Enriches with URL metadata (page titles/descriptions)
- Analyzes via Groq's `llama-3.3-70b-versatile` (free tier)
- Rate-limits with token bucket (5600 token/62s window)
- Posts as Discord embeds (each item shows a `ID: <bookmarkId>` for reference)
- Stores analyzed bookmarks, user records, and usage logs in SQLite (`data/bookmarks.db`)
- Users register their own X tokens via `/register-auth` (AES-256-GCM encrypted at rest)

**Working Commands:**

- `/register-auth` — user registers their X auth_token + ct0 (ephemeral reply, encrypted storage)
- `/bookmark-digest [count: 1–100]` — fetches new bookmarks since last digest, analyzes, posts
- `/make-actionable <bookmark-id>` — single bookmark analysis with Opus-ready prompt

**Tech Stack:** Node.js + TypeScript (ES modules), Discord.js v14, Groq SDK, `better-sqlite3`, `node-cron` (installed, not yet used for scheduling).

**Key Files (don't break these):**
- `src/index.ts` — Discord client & command router
- `src/commands/bookmark-digest.ts` — main digest handler (uses UserStore, UsageStore)
- `src/commands/make-actionable.ts` — single bookmark analysis
- `src/commands/register-auth.ts` — token registration command
- `src/commands/register-commands.ts` — slash command registration script
- `src/services/bookmark-fetcher.ts` — bird CLI wrapper (has `validateTokens()`, `sinceId` support)
- `src/services/claude-analyzer.ts` — Groq orchestration (internally calls url-enricher + refetchFullContent)
- `src/services/digest-formatter.ts` — Discord embed builder
- `src/services/url-enricher.ts` — URL metadata fetcher (called internally by ClaudeAnalyzer)
- `src/database/db.ts` — SQLite singleton + migrations
- `src/database/user-store.ts` — user CRUD with encrypted token storage
- `src/database/bookmark-store.ts` — analyzed bookmark cache
- `src/database/usage-store.ts` — persistent usage logging (replaces old in-memory CostTracker)
- `src/utils/crypto.ts` — AES-256-GCM encrypt/decrypt
- `src/types/` — TypeScript types

**Important:** `ClaudeAnalyzer.analyzeBookmarks()` already handles URL enrichment and stub re-fetching internally. Do NOT call `enrichBookmarksWithUrls()` separately before passing bookmarks to the analyzer — that causes double processing.

---

# PHASE 3: Weekly Auto-Digest via Cron Scheduler

**Goal:** Users can schedule weekly (or daily) auto-digests to post to a specific Discord channel.

---

## Phase 3 Overview

Build:
1. New slash command: `/schedule-digest`
2. Cron scheduler service using `node-cron`
3. Background job that runs scheduled digests and posts to the configured channel
4. Incremental fetching (only new bookmarks since last run via `sinceId`)

---

## Phase 3 Implementation

### 1. Create `/schedule-digest` Command

**Create `src/commands/schedule-digest.ts`:**

```typescript
import { ChatInputCommandInteraction, CacheType, ChannelType } from 'discord.js';
import { UserStore } from '../database/user-store.js';
import { DigestFormatter } from '../services/digest-formatter.js';

export async function handleScheduleDigest(
  interaction: ChatInputCommandInteraction<CacheType>
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    // Ensure user has registered tokens before scheduling
    if (!UserStore.hasAuthTokens(discordUserId)) {
      const embed = DigestFormatter.buildStatusEmbed(
        `❌ Please register your X auth tokens first:\n\`/register-auth auth_token:<token> ct0:<token>\``,
        true
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const action = interaction.options.getSubcommand();

    if (action === 'enable') {
      const channel = interaction.options.getChannel('channel', true);
      const frequency = interaction.options.getString('frequency', true);

      // Validate channel is a text channel
      if (channel.type !== ChannelType.GuildText) {
        const embed = DigestFormatter.buildStatusEmbed(
          '❌ Please select a text channel',
          true
        );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Check bot has send permissions
      const botMember = await interaction.guild?.members.fetchMe();
      const permissions = channel.permissionsFor(botMember!);
      if (!permissions?.has('SendMessages')) {
        const embed = DigestFormatter.buildStatusEmbed(
          `❌ I don't have permission to send messages in ${channel.toString()}`,
          true
        );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Convert frequency to cron expression
      const cronExpr = frequency === 'daily' ? '0 9 * * *' : '0 9 * * 1';

      // Save schedule
      UserStore.setSchedule(discordUserId, channel.id, cronExpr);

      const embed = DigestFormatter.buildStatusEmbed(
        `✅ Scheduled ${frequency} digest to ${channel.toString()} at 9am UTC`,
        false
      );
      await interaction.editReply({ embeds: [embed] });

      console.log(`📅 User ${interaction.user.tag} scheduled ${frequency} digest to ${channel.name}`);
    } else if (action === 'disable') {
      UserStore.clearSchedule(discordUserId);

      const embed = DigestFormatter.buildStatusEmbed(
        '✅ Digest schedule disabled',
        false
      );
      await interaction.editReply({ embeds: [embed] });

      console.log(`📅 User ${interaction.user.tag} disabled scheduled digests`);
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error in schedule-digest command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed:\n${err.message}`,
      true
    );
    await interaction.editReply({ embeds: [embed] });
  }
}
```

---

### 2. Register `/schedule-digest` Command

**Add to `src/commands/register-commands.ts`** (in the array before `.map(...)`):

```typescript
  new SlashCommandBuilder()
    .setName('schedule-digest')
    .setDescription('Enable or disable scheduled weekly/daily digests')
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enable scheduled digests')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post digests to')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('frequency')
            .setDescription('How often to send digests')
            .setRequired(true)
            .addChoices(
              { name: 'Daily at 9am UTC', value: 'daily' },
              { name: 'Weekly on Monday at 9am UTC', value: 'weekly' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName('disable').setDescription('Disable scheduled digests')
    ),
```

**Add to command router in `src/index.ts`:**

```typescript
case 'schedule-digest':
  await import('./commands/schedule-digest.js').then((m) =>
    m.handleScheduleDigest(interaction as ChatInputCommandInteraction)
  );
  break;
```

---

### 3. Cron Scheduler Service

**Create `src/services/scheduler.ts`:**

```typescript
import cron from 'node-cron';
import { Client } from 'discord.js';
import { UserStore } from '../database/user-store.js';
import { BookmarkFetcher } from './bookmark-fetcher.js';
import { ClaudeAnalyzer } from './claude-analyzer.js';
import { DigestFormatter } from './digest-formatter.js';
import { UsageStore } from '../database/usage-store.js';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export class Scheduler {
  private client: Client | null = null;
  private task: cron.ScheduledTask | null = null;

  start(client: Client): void {
    this.client = client;

    // Run every minute to check if any scheduled digests are due
    this.task = cron.schedule('* * * * *', () => {
      this.checkAndRunDigests().catch((err) =>
        console.error('❌ Scheduler error:', err)
      );
    });

    console.log('⏰ Scheduler started (checks every minute)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    console.log('⏰ Scheduler stopped');
  }

  private async checkAndRunDigests(): Promise<void> {
    if (!this.client) return;

    const scheduledUsers = UserStore.getAllScheduledUsers();

    for (const user of scheduledUsers) {
      if (this.shouldRunNow(user.cron)) {
        try {
          await this.runDigestForUser(user);
        } catch (err) {
          console.error(`❌ Scheduled digest failed for user ${user.discord_id}:`, err);
        }
      }
    }
  }

  private shouldRunNow(cronExpr: string): boolean {
    const now = new Date();

    try {
      const parts = cronExpr.split(' ');
      if (parts.length !== 5) return false;

      const [minute, hour, , , weekday] = parts;

      if (minute !== '*' && parseInt(minute) !== now.getUTCMinutes()) return false;
      if (hour !== '*' && parseInt(hour) !== now.getUTCHours()) return false;
      if (weekday !== '*' && parseInt(weekday) !== now.getUTCDay()) return false;

      return true;
    } catch {
      return false;
    }
  }

  private async runDigestForUser(user: {
    discord_id: string;
    channel_id: string;
    auth_token: string;
    ct0: string;
  }): Promise<void> {
    if (!this.client) return;

    console.log(`📬 Running scheduled digest for user ${user.discord_id}...`);

    // Get user record for sinceId
    const userRecord = UserStore.getOrCreateUser(user.discord_id);

    // Fetch new bookmarks (incremental)
    const bookmarks = await BookmarkFetcher.fetchBookmarks({
      count: 50,
      authToken: user.auth_token,
      ct0: user.ct0,
      sinceId: userRecord.last_seen_bookmark_id || undefined,
    });

    if (bookmarks.length === 0) {
      console.log(`  (No new bookmarks for ${user.discord_id})`);
      return;
    }

    console.log(`  Fetched ${bookmarks.length} new bookmarks`);

    // Analyze (ClaudeAnalyzer handles URL enrichment + stub refetch internally)
    const analyzer = new ClaudeAnalyzer();
    const { analyses, inputTokens, outputTokens, totalCost } =
      await analyzer.analyzeBookmarks(bookmarks);

    // Build category counts for stats
    const categoryCounts = analyses.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const embeds = DigestFormatter.buildDigestEmbeds(analyses, {
      newCount: bookmarks.length,
      cost: totalCost,
      monthlyTotal: UsageStore.getMonthlyTotal(user.discord_id),
      categoryCounts: categoryCounts as any,
    });

    // Send to configured channel
    const channel = await this.client.channels.fetch(user.channel_id);
    if (channel?.isTextBased()) {
      await channel.send({
        content: `📬 Scheduled digest for <@${user.discord_id}>`,
        embeds: embeds.slice(0, 10),
      });
      console.log(`  ✅ Sent digest to channel ${user.channel_id}`);
    }

    // Update user record
    UserStore.updateLastSeenBookmarkId(user.discord_id, bookmarks[0]!.id);
    UserStore.updateLastDigestAt(user.discord_id);

    // Log usage
    UsageStore.logUsage({
      userId: user.discord_id,
      model: GROQ_MODEL,
      inputTokens,
      outputTokens,
      costUsd: totalCost,
      operation: 'scheduled_digest',
    });
  }
}

export const scheduler = new Scheduler();
```

---

### 4. Wire Scheduler into `src/index.ts`

Add import at top:

```typescript
import { scheduler } from './services/scheduler.js';
```

Update the `ClientReady` handler to start the scheduler:

```typescript
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} guild(s)`);
  scheduler.start(client);
});
```

Update the `SIGINT` and `SIGTERM` handlers to stop the scheduler:

```typescript
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down bot...');
  scheduler.stop();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down bot...');
  scheduler.stop();
  client.destroy();
  process.exit(0);
});
```

---

### 5. Register Commands

After adding `/schedule-digest`, run:

```bash
npx tsx src/commands/register-commands.ts
```

---

## Phase 3 Testing Checklist

- [ ] TypeScript check passes: `npx tsc --noEmit`
- [ ] `/schedule-digest enable` works and validates channel permissions
- [ ] `/schedule-digest disable` clears the schedule
- [ ] Scheduler starts on bot ready (log: `⏰ Scheduler started`)
- [ ] Scheduled digest only fetches new bookmarks (`sinceId` works)
- [ ] Scheduled digest posts to the correct channel
- [ ] Usage logged to DB with operation `scheduled_digest`
- [ ] Graceful shutdown stops the scheduler

---

# PHASE 4: Quality of Life & Stats

**Goal:** Add `/bookmark-stats`, deduplication in digests, and complete `/make-actionable` with cache lookup.

---

## Phase 4 Overview

Build:

1. New `/bookmark-stats` command with category breakdown and top authors
2. Deduplication in `/bookmark-digest` (skip already-analyzed bookmarks)
3. Cache lookup in `/make-actionable` (check BookmarkStore before re-analyzing)
4. Save analyses to BookmarkStore in `/bookmark-digest` (enables dedup + stats)

---

## Phase 4 Implementation

### 1. Save Analyses in `/bookmark-digest`

In `src/commands/bookmark-digest.ts`, add these imports:

```typescript
import { BookmarkStore } from '../database/bookmark-store.js';
```

After the `const { analyses, totalCost, inputTokens, outputTokens }` call, **before** building stats, add deduplication and caching:

```typescript
// Check for already-analyzed bookmarks (skip re-analysis)
const alreadyAnalyzed = BookmarkStore.hasBeenAnalyzed(
  discordUserId,
  bookmarks.map((b) => b.id)
);

const newBookmarks = bookmarks.filter((b) => !alreadyAnalyzed.has(b.id));
const skippedCount = bookmarks.length - newBookmarks.length;

if (skippedCount > 0) {
  console.log(`⏭️ Skipped ${skippedCount} already-analyzed bookmarks`);
}

if (newBookmarks.length === 0) {
  const embed = DigestFormatter.buildStatusEmbed(
    `✨ All ${bookmarks.length} bookmarks have already been analyzed!`,
    false
  );
  await interaction.editReply({ content: '', embeds: [embed] });
  return;
}

// Analyze only new bookmarks
const { analyses, totalCost, inputTokens, outputTokens } =
  await analyzer.analyzeBookmarks(newBookmarks);

// Save to cache for future dedup + stats
BookmarkStore.saveAnalyses(discordUserId, analyses);
```

> **Note:** The deduplication block replaces the existing `const { analyses, ... } = await analyzer.analyzeBookmarks(bookmarks)` call — replace that line with the block above.

---

### 2. Cache Lookup in `/make-actionable`

In `src/commands/make-actionable.ts`, add this import:

```typescript
import { BookmarkStore } from '../database/bookmark-store.js';
```

After fetching the bookmark and before calling the analyzer, add a cache check:

```typescript
// Check cache first to avoid re-analyzing
let analysis = BookmarkStore.getAnalysis(discordUserId, bookmark.id);

if (!analysis) {
  await interaction.editReply(`⏳ Analyzing bookmark...`);

  const analyzer = new ClaudeAnalyzer();
  const { analyses, inputTokens, outputTokens, totalCost } =
    await analyzer.analyzeBookmarks([bookmark]);

  analysis = analyses[0]!;

  // Save to cache
  BookmarkStore.saveAnalyses(discordUserId, [analysis]);

  // Log usage
  UsageStore.logUsage({
    userId: discordUserId,
    model: GROQ_MODEL,
    inputTokens,
    outputTokens,
    costUsd: totalCost,
    operation: 'make-actionable',
  });
} else {
  console.log(`✅ Cache hit for bookmark ${bookmark.id}`);
}
```

---

### 3. Add `/bookmark-stats` Command

**Create `src/commands/bookmark-stats.ts`:**

```typescript
import { ChatInputCommandInteraction, CacheType, EmbedBuilder } from 'discord.js';
import { BookmarkStore } from '../database/bookmark-store.js';
import { UsageStore } from '../database/usage-store.js';
import { UserStore } from '../database/user-store.js';
import { DigestFormatter } from '../services/digest-formatter.js';

export async function handleBookmarkStats(
  interaction: ChatInputCommandInteraction<CacheType>
) {
  try {
    await interaction.deferReply();

    const discordUserId = interaction.user.id;
    const period = interaction.options.getString('period', false) || 'month';

    if (!UserStore.hasAuthTokens(discordUserId)) {
      const embed = DigestFormatter.buildStatusEmbed(
        '❌ Please register your X auth tokens first:\n`/register-auth auth_token:<token> ct0:<token>`',
        true
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const limit = period === 'week' ? 50 : period === 'all' ? 10000 : 200;
    const analyses = BookmarkStore.getRecentAnalyses(discordUserId, limit);

    if (analyses.length === 0) {
      const embed = DigestFormatter.buildStatusEmbed(
        `📊 No bookmarks analyzed yet. Run \`/bookmark-digest\` first!`,
        false
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Compute stats
    const categoryBreakdown: Record<string, number> = {};
    const authorFreq: Record<string, number> = {};
    let actionableCount = 0;

    for (const a of analyses) {
      categoryBreakdown[a.category] = (categoryBreakdown[a.category] || 0) + 1;
      authorFreq[a.authorUsername] = (authorFreq[a.authorUsername] || 0) + 1;
      if (a.isActionable) actionableCount++;
    }

    // Top authors
    const topAuthors = Object.entries(authorFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([author, count]) => `@${author} (${count})`)
      .join('\n');

    // Category bar chart
    const maxCount = Math.max(...Object.values(categoryBreakdown));
    const categoryChart = Object.entries(categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => {
        const pct = Math.round((count / analyses.length) * 100);
        const bars = '█'.repeat(Math.ceil((count / maxCount) * 20));
        return `${cat.padEnd(15)} ${bars} ${count} (${pct}%)`;
      })
      .join('\n');

    const { input: inputTokens, output: outputTokens } = UsageStore.getTodayTokens(discordUserId);
    const monthlyTotal = UsageStore.getMonthlyTotal(discordUserId);

    const embed = new EmbedBuilder()
      .setTitle(`📊 Your Bookmark Stats (${period})`)
      .setAuthor({ name: interaction.user.username })
      .addFields(
        { name: '📈 Total Analyzed', value: `${analyses.length} bookmarks`, inline: true },
        {
          name: '🎯 Actionable',
          value: `${actionableCount} (${Math.round((actionableCount / analyses.length) * 100)}%)`,
          inline: true,
        },
        { name: '📚 Reference-Only', value: `${analyses.length - actionableCount}`, inline: true },
        { name: '🏆 Top Categories', value: '```\n' + categoryChart + '\n```', inline: false },
        { name: '👥 Top Authors', value: topAuthors || '(none)', inline: false },
        {
          name: '🤖 API Usage (Today)',
          value: `Input: ${inputTokens} | Output: ${outputTokens} tokens`,
          inline: true,
        },
        { name: '💰 Monthly Cost', value: `$${monthlyTotal.toFixed(2)}`, inline: true }
      )
      .setColor(0x3498db)
      .setFooter({ text: 'Powered by Groq (free tier)' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const err = error as Error;
    console.error('Error in bookmark-stats command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed:\n${err.message}`,
      true
    );
    await interaction.editReply({ embeds: [embed] });
  }
}
```

**Add to `src/commands/register-commands.ts`:**

```typescript
  new SlashCommandBuilder()
    .setName('bookmark-stats')
    .setDescription('View your bookmark statistics and trends')
    .addStringOption((opt) =>
      opt
        .setName('period')
        .setDescription('Time period to analyze')
        .setRequired(false)
        .addChoices(
          { name: 'This Week', value: 'week' },
          { name: 'This Month', value: 'month' },
          { name: 'All Time', value: 'all' }
        )
    ),
```

**Add to command router in `src/index.ts`:**

```typescript
case 'bookmark-stats':
  await import('./commands/bookmark-stats.js').then((m) =>
    m.handleBookmarkStats(interaction as ChatInputCommandInteraction)
  );
  break;
```

---

### 4. Register Commands

```bash
npx tsx src/commands/register-commands.ts
```

---

## Phase 4 Testing Checklist

- [ ] TypeScript check passes: `npx tsc --noEmit`
- [ ] `/bookmark-digest` skips already-analyzed bookmarks (check console for `⏭️ Skipped`)
- [ ] After running digest, `data/bookmarks.db` has rows in `analyzed_bookmarks`
- [ ] `/make-actionable <id>` uses cache on second call (check console for `✅ Cache hit`)
- [ ] `/bookmark-stats` shows category breakdown and top authors
- [ ] Bar chart renders correctly in Discord

---

## Final Checklist (All Phases)

- [ ] Database file at `data/bookmarks.db`
- [ ] Multi-user: two users can independently `/register-auth` and `/bookmark-digest`
- [ ] Scheduled digests run at configured times
- [ ] Incremental fetching only gets new bookmarks
- [ ] All commands registered with Discord (`npx tsx src/commands/register-commands.ts`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Bot runs without crashing (`npm run dev` or `npm start`)

---

## Troubleshooting

**Q: `bird whoami` validation fails**
A: `bird whoami` does NOT support `--json`. The `validateTokens()` method calls it without flags — do not add `--json`.

**Q: Tokens stored but can't be decrypted**
A: Ensure `ENCRYPTION_KEY` in `.env` is 64 hex characters (32 bytes). If you change it, old tokens won't decrypt — users must re-register.

**Q: Scheduled digests don't run**
A: Check bot has `SendMessages` permission in the target channel. The cron matcher uses UTC time — `0 9 * * 1` = Monday 9am UTC.

**Q: Double URL enrichment / slow analysis**
A: Do NOT call `enrichBookmarksWithUrls()` before `analyzer.analyzeBookmarks()`. The analyzer handles enrichment internally.

---

## End of Phases 3-4 Handoff
