/**
 * Register slash commands with Discord
 * Run this script once to register commands: npm run register-commands
 */

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('bookmark-digest')
    .setDescription('Fetch and analyze your latest X/Twitter bookmarks')
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription('Number of bookmarks to fetch (default: 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName('make-actionable')
    .setDescription('Get a detailed Opus-ready prompt for a specific bookmark')
    .addStringOption((option) =>
      option
        .setName('bookmark-id')
        .setDescription('Tweet ID or URL of the bookmark')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('register-auth')
    .setDescription('Register your X/Twitter auth tokens (private, encrypted storage)')
    .addStringOption((option) =>
      option
        .setName('auth_token')
        .setDescription('Your X auth_token cookie (DevTools → Application → Cookies)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('ct0')
        .setDescription('Your X ct0 cookie (DevTools → Application → Cookies)')
        .setRequired(true)
    ),
].map((command) => command.toJSON());

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId) {
    throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    if (guildId) {
      // Register guild commands (instant, for development)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`Successfully registered commands to guild ${guildId}`);
    } else {
      // Register global commands (takes up to 1 hour to propagate)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log('Successfully registered global commands');
    }

    console.log('Commands registered:');
    commands.forEach((cmd) => {
      console.log(`  /${cmd.name} - ${cmd.description}`);
    });
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exit(1);
  }
}

registerCommands();
