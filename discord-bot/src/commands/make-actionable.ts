/**
 * /make-actionable command handler
 * Deep single-bookmark analysis: Groq reads full content and returns specific action ideas
 */

import { ChatInputCommandInteraction, CacheType, AttachmentBuilder } from 'discord.js';
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
    await interaction.editReply('⏳ Fetching bookmark...');
    const bookmark = await BookmarkFetcher.fetchBookmarkById(bookmarkId, {
      authToken: user.auth_token,
      ct0: user.ct0,
    });

    // Deep analysis: Groq reads full content, returns specific action ideas
    await interaction.editReply('🔍 Reading full content and generating action ideas...');

    const analyzer = new ClaudeAnalyzer();
    const { category, summary, actionIdeas, inputTokens, outputTokens, totalCost } =
      await analyzer.analyzeForActionable(bookmark);

    // Log usage
    UsageStore.logUsage({
      userId: discordUserId,
      model: GROQ_MODEL,
      inputTokens,
      outputTokens,
      costUsd: totalCost,
      operation: 'make-actionable',
    });

    // Build Opus prompt (contains full content + action ideas)
    const opusPrompt = buildOpusPrompt(bookmark, { category, summary, actionIdeas });

    // Build and send the summary embed
    const embed = DigestFormatter.buildActionableEmbed(
      {
        category,
        summary,
        authorUsername: bookmark.author.username,
        likeCount: bookmark.likeCount,
        retweetCount: bookmark.retweetCount,
        text: bookmark.text,
        bookmarkId: bookmark.id,
      },
      actionIdeas,
      opusPrompt
    );

    await interaction.editReply({ content: '', embeds: [embed] });

    // Send full Opus prompt as a downloadable .txt file (no Discord 2000-char limit)
    const promptBuffer = Buffer.from(opusPrompt, 'utf-8');
    const attachment = new AttachmentBuilder(promptBuffer, {
      name: `opus-prompt-${bookmarkId}.txt`,
    });
    await interaction.followUp({
      content: `**Opus prompt for \`${bookmarkId}\`** — open the file, select all, paste into Claude:`,
      files: [attachment],
    });

    console.log(
      `✅ Actionable analysis sent to ${interaction.user.tag} for ${bookmarkId} (${actionIdeas.length} ideas)`
    );
  } catch (error) {
    const err = error as Error;
    console.error('Error in make-actionable command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed to generate actionable analysis:\n${err.message}`,
      true
    );

    if (interaction.deferred) {
      await interaction.editReply({ content: '', embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

/**
 * Extract tweet ID from URL or return raw ID
 */
function extractTweetId(input: string): string | null {
  if (/^\d+$/.test(input)) return input;
  const urlMatch = input.match(/status\/(\d+)/);
  return urlMatch ? urlMatch[1]! : null;
}

/**
 * Build the Opus prompt with full content + Groq's action ideas embedded
 */
function buildOpusPrompt(
  bookmark: any,
  analysis: { category: string; summary: string; actionIdeas: string[] }
): string {
  const ideasText = analysis.actionIdeas.join('\n');

  return `I bookmarked this content and want to take action on it.

Author: @${bookmark.author.username} (${bookmark.author.name})
Category: ${analysis.category}
Engagement: ${bookmark.likeCount} likes, ${bookmark.retweetCount} retweets

Content:
${bookmark.text}

Suggested actions (Groq's analysis):
${ideasText}

Pick the most valuable action above and help me actually execute it. Be specific and tactical — give me concrete next steps, commands, or a plan. Don't just summarize.`;
}
