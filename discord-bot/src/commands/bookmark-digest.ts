/**
 * /bookmark-digest command handler
 * Fetches bookmarks, analyzes with Groq, and posts digest
 */

import { ChatInputCommandInteraction, CacheType } from 'discord.js';
import { BookmarkFetcher } from '../services/bookmark-fetcher.js';
import { ClaudeAnalyzer } from '../services/claude-analyzer.js';
import { DigestFormatter } from '../services/digest-formatter.js';
import { UserStore } from '../database/user-store.js';
import { UsageStore } from '../database/usage-store.js';
import { BookmarkStore } from '../database/bookmark-store.js';
import { DigestStats } from '../types/digest.js';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export async function handleBookmarkDigest(
  interaction: ChatInputCommandInteraction<CacheType>
) {
  try {
    // Defer reply (we need more than 3 seconds to process)
    await interaction.deferReply();

    const discordUserId = interaction.user.id;
    // How many NEW bookmarks to analyze
    const analysisTarget = (interaction.options.get('count')?.value as number) || 10;

    // Ensure user has registered X tokens
    if (!UserStore.hasAuthTokens(discordUserId)) {
      const embed = DigestFormatter.buildStatusEmbed(
        `❌ Please register your X auth tokens first:\n\`/register-auth auth_token:<token> ct0:<token>\`\n\nGet your tokens from: DevTools → Application → Cookies → find \`auth_token\` and \`ct0\``,
        true
      );
      await interaction.editReply({ content: '', embeds: [embed] });
      return;
    }

    // Get user's tokens from DB
    const user = UserStore.getOrCreateUser(discordUserId);
    const { auth_token: authToken, ct0 } = user;

    // Step 1: Fetch bookmarks iteratively until we have enough new ones.
    // Start with a small batch, triple the fetch window if we need more.
    await interaction.editReply('🔍 Fetching bookmarks...');
    let bookmarks: Awaited<ReturnType<typeof BookmarkFetcher.fetchBookmarks>> = [];
    let newBookmarks: typeof bookmarks = [];
    let skippedCount = 0;
    const MAX_FETCH = 200;

    for (let fetchCount = Math.max(analysisTarget + 10, 20); ; fetchCount = Math.min(fetchCount * 3, MAX_FETCH)) {
      bookmarks = await BookmarkFetcher.fetchBookmarks({ count: fetchCount, authToken, ct0 });
      const alreadyAnalyzed = BookmarkStore.hasBeenAnalyzed(discordUserId, bookmarks.map((b) => b.id));
      newBookmarks = bookmarks.filter((b) => !alreadyAnalyzed.has(b.id)).slice(0, analysisTarget);
      skippedCount = alreadyAnalyzed.size;

      // Done if we have enough new ones, or we've hit the fetch ceiling
      if (newBookmarks.length >= analysisTarget || fetchCount >= MAX_FETCH) break;

      // Need more — let the user know we're looking further back
      await interaction.editReply(
        `🔍 Found ${newBookmarks.length}/${analysisTarget} new — looking further back (${Math.min(fetchCount * 3, MAX_FETCH)} total)...`
      );
    }

    if (skippedCount > 0) {
      console.log(`⏭️ Skipped ${skippedCount} already-analyzed bookmarks`);
    }

    if (newBookmarks.length === 0) {
      const embed = DigestFormatter.buildStatusEmbed(
        `✨ All caught up! No new bookmarks to analyze (checked last ${bookmarks.length}).`,
        false
      );
      await interaction.editReply({ content: '', embeds: [embed] });
      return;
    }

    await interaction.editReply(
      `🔍 Found ${newBookmarks.length} new bookmark${newBookmarks.length !== 1 ? 's' : ''} — starting analysis...`
    );

    // Step 2: Analyze with Groq (with progress updates)
    const analyzer = new ClaudeAnalyzer();

    // Show progress as batches complete
    analyzer.setProgressCallback(async (processed, total, status) => {
      try {
        if (status) {
          await interaction.editReply(`⏳ ${status}`);
        } else if (processed >= total) {
          await interaction.editReply(`📊 Formatting ${total} bookmark${total !== 1 ? 's' : ''} into digest...`);
        } else {
          await interaction.editReply(
            `⏳ Analyzing bookmarks... ${processed}/${total} done`
          );
        }
      } catch {
        // Ignore edit failures during progress updates
      }
    });

    const { analyses, totalCost, inputTokens, outputTokens } =
      await analyzer.analyzeBookmarks(newBookmarks, { authToken, ct0 });

    // Save to cache for future dedup + stats
    BookmarkStore.saveAnalyses(discordUserId, analyses);

    // Step 3: Track usage (persistent)
    UsageStore.logUsage({
      userId: discordUserId,
      model: GROQ_MODEL,
      inputTokens,
      outputTokens,
      costUsd: totalCost,
      operation: 'digest',
    });

    const monthlyTotal = UsageStore.getMonthlyTotal(discordUserId);

    // Step 4: Update user's last seen bookmark ID
    const mostRecentId = bookmarks[0]?.id;
    if (mostRecentId) {
      UserStore.updateLastSeenBookmarkId(discordUserId, mostRecentId);
      UserStore.updateLastDigestAt(discordUserId);
    }

    // Step 5: Build stats
    const categoryCounts = analyses.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const stats: DigestStats = {
      newCount: analyses.length,
      cost: totalCost,
      monthlyTotal,
      categoryCounts: categoryCounts as any,
    };

    // Step 6: Format and send embeds (may be multiple if content is long)
    const embeds = DigestFormatter.buildDigestEmbeds(analyses, stats);

    // Discord allows up to 10 embeds per message
    await interaction.editReply({ content: '', embeds: embeds.slice(0, 10) });

    console.log(
      `✅ Digest sent to ${interaction.user.tag}: ${bookmarks.length} bookmarks, ${inputTokens + outputTokens} tokens (free)`
    );
  } catch (error) {
    const err = error as Error;
    console.error('Error in bookmark-digest command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed to generate digest:\n${err.message}`,
      true
    );

    if (interaction.deferred) {
      await interaction.editReply({ content: '', embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}
