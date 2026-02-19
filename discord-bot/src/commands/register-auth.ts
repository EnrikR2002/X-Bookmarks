/**
 * /register-auth command handler
 * Registers a user's X auth tokens (encrypted) so they can use /bookmark-digest
 */

import { ChatInputCommandInteraction, CacheType } from 'discord.js';
import { UserStore } from '../database/user-store.js';
import { BookmarkFetcher } from '../services/bookmark-fetcher.js';
import { DigestFormatter } from '../services/digest-formatter.js';

export async function handleRegisterAuth(
  interaction: ChatInputCommandInteraction<CacheType>
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const authToken = interaction.options.getString('auth_token', true);
    const ct0 = interaction.options.getString('ct0', true);

    // Validate tokens by calling bird whoami
    try {
      console.log('🔐 Validating X auth tokens...');
      await BookmarkFetcher.validateTokens(authToken, ct0);
    } catch (err) {
      const embed = DigestFormatter.buildStatusEmbed(
        '❌ Invalid X auth tokens. Please check your credentials and try again.',
        true
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Store encrypted tokens
    const discordId = interaction.user.id;
    UserStore.registerTokens(discordId, authToken, ct0);

    const embed = DigestFormatter.buildStatusEmbed(
      `✅ X auth tokens registered for <@${discordId}>\n\nYou can now use \`/bookmark-digest\` with your own bookmarks!`,
      false
    );
    await interaction.editReply({ embeds: [embed] });

    console.log(`✅ User ${interaction.user.tag} registered X tokens`);
  } catch (error) {
    const err = error as Error;
    console.error('Error in register-auth command:', err);

    const embed = DigestFormatter.buildStatusEmbed(
      `❌ Failed to register tokens:\n${err.message}`,
      true
    );
    await interaction.editReply({ embeds: [embed] });
  }
}
