import { ChatInputCommandInteraction, CacheType, ChannelType, TextChannel } from 'discord.js';
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
      const permissions = (channel as unknown as TextChannel).permissionsFor(botMember!);
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
