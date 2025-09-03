

/*
 * File: discord-bot/bot.js
 */

// Load environment variables from the .env file
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { createCommitEmbed, createSimpleCommitMessage } = require('./src/formatters/commit-formatter');

// Create a new Discord client instance with required intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Log when the bot is ready.
// Log when the bot is ready.
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // List all servers and channels the bot can see
  console.log('Servers and Channels:');
  client.guilds.cache.forEach((guild) => {
    console.log(` - ${guild.name} (${guild.id})`);
    guild.channels.cache.forEach((channel) => {
      if (channel.type === 0) { // Text channels only
        console.log(`   #${channel.name} (${channel.id})`);
      }
    });
  });
});

// Basic "hello" command.
client.on('messageCreate', message => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() === 'hello') {
    message.channel.send('Hello, World!');
  }
});

// Log in to Discord using the token from the environment variable.
client.login(process.env.DISCORD_TOKEN);

// Set up an Express server to handle Git webhook POST requests.
const app = express();
const PORT = process.env.PORT || 3000;

// Use JSON body parser middleware.
app.use(bodyParser.json());

// Endpoint to receive webhook data.
app.post('/webhook', (req, res) => {
  const payload = req.body;

  // Handle GitHub push events with enhanced formatting
  if (payload.commits && payload.commits.length > 0) {
    const channel = client.channels.cache.get('1412917309328195644');
    if (channel) {
      // Try to send rich embed, fallback to simple message
      const embed = createCommitEmbed(payload);
      if (embed) {
        channel.send({ embeds: [embed] });
      } else {
        const simpleMessage = createSimpleCommitMessage(payload);
        channel.send(simpleMessage);
      }
    } else {
      console.error('bot.js:webhook - Channel not found. Check the CHANNEL_ID.');
    }
  }
  res.sendStatus(200);
});

// Start the Express server.
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

