/**
 * Digest Formatter Service
 * Builds Discord embeds for bookmark digests
 */

import { EmbedBuilder } from 'discord.js';
import { BookmarkAnalysis, BookmarkCategory } from '../types/bookmark.js';
import { DigestStats, CategoryGroup } from '../types/digest.js';

const ALL_CATEGORIES: BookmarkCategory[] = [
  'AI',
  'crypto',
  'marketing',
  'tools',
  'personal',
  'news',
  'content-ideas',
  'other',
];

const TWITTER_BLUE = 0x1da1f2;
const MAX_FIELD_LENGTH = 1024; // Discord field value limit
const MAX_EMBED_TOTAL = 5800; // Stay under Discord's 6000 char embed limit
const MAX_KEY_TAKEAWAY_LENGTH = 700;
const MAX_ACTION_LENGTH = 180;

export class DigestFormatter {
  /**
   * Build digest embeds from analyzed bookmarks
   * Returns multiple embeds if content exceeds Discord limits
   */
  static buildDigestEmbeds(
    analyses: BookmarkAnalysis[],
    stats: DigestStats
  ): EmbedBuilder[] {
    if (analyses.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📚 Bookmark Digest')
        .setDescription('✨ All caught up! No new bookmarks since last digest.')
        .setColor(TWITTER_BLUE)
        .setTimestamp();
      return [embed];
    }

    const groups = this.groupByCategory(analyses);
    const embeds: EmbedBuilder[] = [];
    let currentEmbed = new EmbedBuilder()
      .setTitle(`📚 Bookmark Digest (${stats.newCount} new)`)
      .setColor(TWITTER_BLUE);
    let currentLength = 30; // approximate title length

    for (const group of groups) {
      if (group.items.length === 0) continue;

      const fieldName = `[${group.category.toUpperCase()}]`;

      // Build items for this category, splitting oversized items into safe chunks
      const itemTexts = group.items.flatMap((item) =>
        this.splitForField(this.formatSingleItem(item), MAX_FIELD_LENGTH)
      );

      let fieldValue = '';
      for (const itemText of itemTexts) {
        // Would this item overflow the current field?
        if (fieldValue.length + itemText.length > MAX_FIELD_LENGTH) {
          // Flush current field
          if (fieldValue) {
            // Would adding this field overflow the embed?
            if (currentLength + fieldName.length + fieldValue.length > MAX_EMBED_TOTAL) {
              currentEmbed.setTimestamp();
              embeds.push(currentEmbed);
              currentEmbed = new EmbedBuilder()
                .setTitle('📚 Bookmark Digest (continued)')
                .setColor(TWITTER_BLUE);
              currentLength = 40;
            }
            currentEmbed.addFields({ name: fieldName, value: fieldValue.trim(), inline: false });
            currentLength += fieldName.length + fieldValue.length;
          }
          fieldValue = itemText;
        } else {
          fieldValue += itemText;
        }
      }

      // Flush remaining items for this category
      if (fieldValue) {
        if (currentLength + fieldName.length + fieldValue.length > MAX_EMBED_TOTAL) {
          currentEmbed.setTimestamp();
          embeds.push(currentEmbed);
          currentEmbed = new EmbedBuilder()
            .setTitle('📚 Bookmark Digest (continued)')
            .setColor(TWITTER_BLUE);
          currentLength = 40;
        }
        currentEmbed.addFields({ name: fieldName, value: fieldValue.trim(), inline: false });
        currentLength += fieldName.length + fieldValue.length;
      }
    }

    // Add footer to last embed
    currentEmbed.setFooter({
      text: `Powered by Llama 3.3 via Groq (free) | ${stats.newCount} bookmarks analyzed`,
    });
    currentEmbed.setTimestamp();
    embeds.push(currentEmbed);

    return embeds;
  }

  /**
   * Format a single bookmark item with rich detail
   */
  private static formatSingleItem(item: BookmarkAnalysis): string {
    const normalizedActions = Array.isArray(item.actions)
      ? item.actions
        .map((action) => this.truncateText(String(action || '').trim(), MAX_ACTION_LENGTH))
        .filter(Boolean)
        .slice(0, 5)
      : [];

    const actions = normalizedActions.length > 0
      ? normalizedActions
      : ['Review this bookmark and decide the most relevant next step.'];

    const actionsText = actions.map((action) => `- ${action}`).join('\n');
    const tweetUrl = `https://x.com/${item.authorUsername}/status/${item.bookmarkId}`;
    const keyTakeaway = this.truncateText(item.keyTakeaway, MAX_KEY_TAKEAWAY_LENGTH);

    return (
      `**${item.summary}** - @${item.authorUsername}\n\n` +
      `${keyTakeaway}\n\n` +
      `Bookmark ID: ${item.bookmarkId}\n` +
      `Link to the tweet: ${tweetUrl}\n` +
      `Suggested actions:\n` +
      `${actionsText}\n\n`
    );
  }

  private static splitForField(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const lines = text.split('\n');
    const chunks: string[] = [];
    let current = '';

    const pushCurrent = () => {
      if (current.trim().length > 0) {
        chunks.push(current.trimEnd());
        current = '';
      }
    };

    for (const line of lines) {
      const candidate = current.length > 0 ? `${current}\n${line}` : line;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }

      pushCurrent();

      if (line.length <= maxLength) {
        current = line;
        continue;
      }

      let remaining = line;
      while (remaining.length > maxLength) {
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      current = remaining;
    }

    pushCurrent();
    return chunks.length > 0 ? chunks : [this.truncateText(text, maxLength)];
  }

  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    const safeLength = Math.max(0, maxLength - 3);
    return `${text.slice(0, safeLength)}...`;
  }

  /**
   * Group analyses by category
   */
  private static groupByCategory(analyses: BookmarkAnalysis[]): CategoryGroup[] {
    const grouped = new Map<BookmarkCategory, BookmarkAnalysis[]>();

    for (const category of ALL_CATEGORIES) {
      grouped.set(category, []);
    }

    for (const analysis of analyses) {
      const existing = grouped.get(analysis.category) || [];
      existing.push(analysis);
      grouped.set(analysis.category, existing);
    }

    return Array.from(grouped.entries())
      .map(([category, items]) => ({
        category,
        items,
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }

  /**
   * Build a simple status embed for errors or info messages
   */
  static buildStatusEmbed(
    message: string,
    isError: boolean = false
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setDescription(message)
      .setColor(isError ? 0xff0000 : TWITTER_BLUE)
      .setTimestamp();
  }

  /**
   * Build an embed for a single actionable bookmark (used in /make-actionable)
   */
  static buildActionableEmbed(
    analysis: {
      category: string;
      summary: string;
      authorUsername: string;
      likeCount: number;
      retweetCount: number;
      text: string;
      bookmarkId: string;
    },
    actionIdeas: string[],
    opusPrompt: string
  ): EmbedBuilder {
    const contentPreview = analysis.text.length > 500
      ? analysis.text.slice(0, 500) + '...'
      : analysis.text;

    const ideasValue = actionIdeas.length > 0
      ? actionIdeas.join('\n')
      : 'No specific actions identified.';

    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${analysis.summary}`)
      .setColor(TWITTER_BLUE)
      .setDescription(
        `**@${analysis.authorUsername}** | **${analysis.category}** | ❤️ ${analysis.likeCount} 🔁 ${analysis.retweetCount}\n\n` +
        `${contentPreview}`
      )
      .addFields(
        {
          name: '🎯 Action Ideas',
          value: ideasValue.slice(0, MAX_FIELD_LENGTH),
          inline: false,
        },
        {
          name: '🚀 Opus Prompt (preview)',
          value: `\`\`\`\n${opusPrompt.slice(0, 800)}${opusPrompt.length > 800 ? '\n...' : ''}\n\`\`\``,
          inline: false,
        }
      )
      .setFooter({
        text: 'Full prompt sent below — copy and paste into Claude Opus',
      })
      .setTimestamp();

    return embed;
  }
}
