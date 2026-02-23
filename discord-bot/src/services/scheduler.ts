import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { UserStore } from '../database/user-store.js';
import { BookmarkFetcher } from './bookmark-fetcher.js';
import { ClaudeAnalyzer } from './claude-analyzer.js';
import { DigestFormatter } from './digest-formatter.js';
import { UsageStore } from '../database/usage-store.js';
import { BookmarkStore } from '../database/bookmark-store.js';

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

    // Fetch bookmarks — dedup via BookmarkStore handles incrementality
    const bookmarks = await BookmarkFetcher.fetchBookmarks({
      count: 50,
      authToken: user.auth_token,
      ct0: user.ct0,
    });

    // Filter out already-analyzed bookmarks
    const alreadyAnalyzed = BookmarkStore.hasBeenAnalyzed(
      user.discord_id,
      bookmarks.map((b) => b.id)
    );
    const newBookmarks = bookmarks.filter((b) => !alreadyAnalyzed.has(b.id));

    if (newBookmarks.length === 0) {
      console.log(`  (No new bookmarks for ${user.discord_id})`);
      return;
    }

    console.log(`  Fetched ${newBookmarks.length} new bookmarks (${bookmarks.length - newBookmarks.length} skipped)`);

    // Analyze (ClaudeAnalyzer handles URL enrichment + stub refetch internally)
    const analyzer = new ClaudeAnalyzer();
    const { analyses, inputTokens, outputTokens, totalCost } =
      await analyzer.analyzeBookmarks(newBookmarks, { authToken: user.auth_token, ct0: user.ct0 });

    // Build category counts for stats
    const categoryCounts = analyses.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const embeds = DigestFormatter.buildDigestEmbeds(analyses, {
      newCount: newBookmarks.length,
      cost: totalCost,
      monthlyTotal: UsageStore.getMonthlyTotal(user.discord_id),
      categoryCounts: categoryCounts as any,
    });

    // Send to configured channel
    const channel = await this.client.channels.fetch(user.channel_id);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send({
        content: `📬 Scheduled digest for <@${user.discord_id}>`,
        embeds: embeds.slice(0, 10),
      });
      console.log(`  ✅ Sent digest to channel ${user.channel_id}`);
    }

    // Update user record
    UserStore.updateLastSeenBookmarkId(user.discord_id, newBookmarks[0]!.id);
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
