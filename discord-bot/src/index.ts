/**
 * Discord Bot Entry Point
 * X Bookmarks Analyzer Bot
 */

import { Client, GatewayIntentBits, Events, Interaction, ChatInputCommandInteraction } from 'discord.js';
import dotenv from 'dotenv';
import { handleBookmarkDigest } from './commands/bookmark-digest.js';
import { handleMakeActionable } from './commands/make-actionable.js';
import { handleRegisterAuth } from './commands/register-auth.js';
import { scheduler } from './services/scheduler.js';

// Load environment variables
dotenv.config();

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ Missing DISCORD_TOKEN in .env file');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Ready event
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} guild(s)`);
  scheduler.start(client);
});

// Interaction handler (slash commands)
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'bookmark-digest':
        await handleBookmarkDigest(interaction);
        break;

      case 'make-actionable':
        await handleMakeActionable(interaction);
        break;

      case 'register-auth':
        await handleRegisterAuth(interaction as ChatInputCommandInteraction);
        break;

      case 'schedule-digest':
        await import('./commands/schedule-digest.js').then((m) =>
          m.handleScheduleDigest(interaction as ChatInputCommandInteraction)
        );
        break;

      case 'bookmark-stats':
        await import('./commands/bookmark-stats.js').then((m) =>
          m.handleBookmarkStats(interaction as ChatInputCommandInteraction)
        );
        break;

      default:
        await interaction.reply({
          content: `❌ Unknown command: ${commandName}`,
          ephemeral: true,
        });
    }
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error handling command ${commandName}:`, err);

    const errorMessage = `An error occurred while executing the command:\n${err.message}`;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// Error handling
client.on(Events.Error, (error) => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

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

// Login to Discord
client.login(token);

console.log('🚀 Starting Discord bot...');
