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
