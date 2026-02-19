/**
 * Digest Formatter Service
 * Builds Discord embeds for bookmark digests
 */

import { EmbedBuilder } from 'discord.js';
import { BookmarkAnalysis, BookmarkCategory } from '../types/bookmark.js';
import { DigestStats, CategoryGroup } from '../types/digest.js';

const CATEGORY_EMOJI: Record<BookmarkCategory, string> = {
  AI: '🤖',
  crypto: '₿',
  marketing: '📈',
  tools: '🛠️',
  personal: '💪',
  news: '📰',
  'content-ideas': '💡',
  other: '📌',
};

const TWITTER_BLUE = 0x1da1f2;
const MAX_FIELD_LENGTH = 1024; // Discord field value limit
const MAX_EMBED_TOTAL = 5800; // Stay under Discord's 6000 char embed limit

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

      const fieldName = `${group.emoji} ${group.category.toUpperCase()} (${group.items.length})`;

      // Build items for this category, potentially splitting across fields
      const itemTexts = group.items.map((item) => this.formatSingleItem(item));

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
    const icon = item.isActionable ? '🎯' : '📖';
    const engagement = item.likeCount > 0 ? ` (❤️${item.likeCount})` : '';

    // Ensure multi-line keyTakeaway gets proper blockquote formatting
    const blockquoted = item.keyTakeaway
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');

    return (
      `${icon} **${item.summary}** — @${item.authorUsername}${engagement}\n` +
      `${blockquoted}\n` +
      `→ *${item.action}*\n` +
      `\`ID: ${item.bookmarkId}\`\n\n`
    );
  }

  /**
   * Group analyses by category
   */
  private static groupByCategory(analyses: BookmarkAnalysis[]): CategoryGroup[] {
    const grouped = new Map<BookmarkCategory, BookmarkAnalysis[]>();

    for (const category of Object.keys(CATEGORY_EMOJI) as BookmarkCategory[]) {
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
        emoji: CATEGORY_EMOJI[category],
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
    analysis: BookmarkAnalysis,
    opusPrompt: string
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎯 Actionable Bookmark')
      .setColor(TWITTER_BLUE)
      .setDescription(
        `**Category:** ${analysis.category}\n` +
        `**From:** @${analysis.authorUsername}\n\n` +
        `${analysis.text.slice(0, 300)}${analysis.text.length > 300 ? '...' : ''}`
      )
      .addFields(
        {
          name: '📊 Engagement',
          value: `❤️ ${analysis.likeCount} | 🔁 ${analysis.retweetCount}`,
          inline: true,
        },
        {
          name: '🤖 Summary',
          value: `${analysis.summary}\n\n${analysis.keyTakeaway}`,
          inline: false,
        },
        {
          name: '✨ Suggested Action',
          value: analysis.action,
          inline: false,
        },
        {
          name: '🚀 Opus-Ready Prompt',
          value: `\`\`\`\n${opusPrompt.slice(0, 900)}${opusPrompt.length > 900 ? '...' : ''}\n\`\`\``,
          inline: false,
        }
      )
      .setFooter({
        text: 'Copy the prompt above and paste it into Claude Code (Opus) for deep analysis',
      })
      .setTimestamp();

    return embed;
  }
}
