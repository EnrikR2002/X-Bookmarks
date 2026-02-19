/**
 * /make-actionable command handler
 * Generates an Opus-ready prompt for a specific bookmark
 */

import { ChatInputCommandInteraction, CacheType } from 'discord.js';
import { BookmarkFetcher } from '../services/bookmark-fetcher.js';
import { ClaudeAnalyzer } from '../services/claude-analyzer.js';
import { DigestFormatter } from '../services/digest-formatter.js';
import { UserStore } from '../database/user-store.js';
import { UsageStore } from '../database/usage-store.js';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export async function handleMakeActionable(
  interaction: ChatInputCommandInteraction<CacheType>
) {
  try {
    await interaction.deferReply();

    const discordUserId = interaction.user.id;

    // Get bookmark ID from input (support both URLs and raw IDs)
    const input = interaction.options.get('bookmark-id', true).value as string;
    const bookmarkId = extractTweetId(input);

    if (!bookmarkId) {
      const embed = DigestFormatter.buildStatusEmbed(
        '❌ Invalid bookmark ID or URL. Please provide a valid tweet ID or URL.',
        true
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Ensure user has registered tokens
    if (!UserStore.hasAuthTokens(discordUserId)) {
      const embed = DigestFormatter.buildStatusEmbed(
        `❌ Please register your X auth tokens first:\n\`/register-auth auth_token:<token> ct0:<token>\``,
        true
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const user = UserStore.getOrCreateUser(discordUserId);

    // Fetch the specific bookmark
    const bookmark = await BookmarkFetcher.fetchBookmarkById(bookmarkId, {
      authToken: user.auth_token,
      ct0: user.ct0,
    });

    // Quick analysis with Groq
    const analyzer = new ClaudeAnalyzer();
    const { analyses, inputTokens, outputTokens, totalCost } =
      await analyzer.analyzeBookmarks([bookmark]);

    const analysis = analyses[0];

    // Track cost (persistent)
    UsageStore.logUsage({
      userId: discordUserId,
      model: GROQ_MODEL,
      inputTokens,
      outputTokens,
      costUsd: totalCost,
      operation: 'make-actionable',
    });

    // Build Opus-ready prompt
    const opusPrompt = buildOpusPrompt(bookmark, analysis);

    // Build and send embed
    const embed = DigestFormatter.buildActionableEmbed(analysis, opusPrompt);

    await interaction.editReply({ embeds: [embed] });

    console.log(
      `✅ Actionable prompt sent to ${interaction.user.tag} for bookmark ${bookmarkId}`
    );
  } catch (error) {
    const err = error as Error;
    console.error('Error in make-actionable command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed to generate actionable prompt:\n${err.message}`,
      true
    );

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

/**
 * Extract tweet ID from URL or return raw ID
 */
function extractTweetId(input: string): string | null {
  // If it's already just an ID (numeric string)
  if (/^\d+$/.test(input)) {
    return input;
  }

  // Try to extract from URL
  const urlMatch = input.match(/status\/(\d+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}

/**
 * Build a comprehensive Opus-ready prompt
 */
function buildOpusPrompt(bookmark: any, analysis: any): string {
  return `You're analyzing this bookmarked tweet for actionable insights:

**Author:** @${bookmark.author.username} (${bookmark.author.name})
**Tweet:** ${bookmark.text}
**Engagement:** ${bookmark.likeCount} likes, ${bookmark.retweetCount} retweets
**Category:** ${analysis.category}

**Your task:**
1. Extract the core insight or framework from this tweet
2. Identify specific action steps I can take
3. If it's a tool/repo: create a setup plan and testing approach
4. If it's strategy: build an implementation roadmap
5. If it's content idea: draft an outline in my voice
6. If it's a question/discussion: research deeper and summarize findings

**Goal:** Deliver a comprehensive action plan, not just a summary. Be specific and tactical.

What should I do with this bookmark?`;
}
