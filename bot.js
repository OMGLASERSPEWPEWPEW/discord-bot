/*
 * File: discord-bot/bot.js
 */

// Load environment variables from the .env file
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');

// Create a new Discord client instance with required intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Log when the bot is ready.
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
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

  // Example handling for GitHub push events with commits.
  if (payload.commits && payload.commits.length > 0) {
    // For demonstration, we take the latest commit.
    const commit = payload.commits[payload.commits.length - 1];
    const commitMessage = commit.message;
    const author = commit.author.name;
    const url = commit.url;

    // Retrieve the channel by its ID.
    const channel = client.channels.cache.get('1332457876643516416');
    if (channel) {
      // Construct and send the notification message.
      channel.send(`New glyffiti commit by ${author}:\n"${commitMessage}"\n${url}`);
    } else {
      console.error('Channel not found. Check the CHANNEL_ID.');
    }
  }
  res.sendStatus(200);
});

// Start the Express server.
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});


// List all servers the bot is in
console.log('Servers:');
client.guilds.cache.forEach((guild) => {
  console.log(` - ${guild.name} (${guild.id})`);
});