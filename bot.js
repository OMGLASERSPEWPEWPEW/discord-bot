// Repository monitoring configuration
const REPO_CONFIG = [
  {
    owner: 'OMGLASERSPEWPEWPEW',
    repo: 'berghain-bot', 
    channelId: '1412917309328195644', // #berghain-comp
    displayName: 'Berghain Bot'
  },
  {
    owner: 'OMGLASERSPEWPEWPEW',
    repo: 'GlyffitiMobile',
    channelId: '1332457876643516416', // #glyffiti  
    displayName: 'Glyffiti Mobile'
  }
];

/*
 * File: discord-bot/bot.js
 */

// Load environment variables from the .env file
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { createCommitEmbed, createSimpleCommitMessage } = require('./src/formatters/commit-formatter');
const { checkForNewCommits, fetchCommitDetails } = require('./src/services/github-service');


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
  startGitHubMonitoring();
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

// Endpoint to receive Berghain game results
app.post('/berghain-results', (req, res) => {
  console.log('bot.js:berghain-results - received game results');
  const payload = req.body;
  
  const channel = client.channels.cache.get('1412917309328195644');
  if (channel) {
    const embed = formatBerghainResults(payload);
    channel.send({ embeds: [embed] });
    console.log('bot.js:berghain-results - posted results to #berghain-comp');
  } else {
    console.error('bot.js:berghain-results - #berghain-comp channel not found');
  }
  
  res.sendStatus(200);
});

/**
 * Gets the last commit hash from Discord channel history
 */
async function getLastCommitFromChannel(channelId) {
  console.log('bot.js:getLastCommitFromChannel - checking channel %s for last commit', channelId);
  
  try {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return null;
    
    const messages = await channel.messages.fetch({ limit: 10 });
    
    for (const message of messages.values()) {
      if (message.author.id === client.user.id && message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed.footer && embed.footer.text) {
          const commitHash = embed.footer.text.split(' • ')[0]; // Extract hash from "abc1234 • timestamp"
          console.log('bot.js:getLastCommitFromChannel - found last commit: %s', commitHash);
          return commitHash;
        }
      }
    }
    
    console.log('bot.js:getLastCommitFromChannel - no previous commits found in channel');
    return null;
  } catch (error) {
    console.error('bot.js:getLastCommitFromChannel - error reading channel history:', error.message);
    return null;
  }
}

/**
 * Formats Berghain game results into Discord message
 */
function formatBerghainResults(payload) {
  console.log('bot.js:formatBerghainResults - processing scenario %d result', payload.scenario);
  
  const status = payload.gameStatus === 'completed' ? '✅ COMPLETED' : '❌ FAILED';
  const bestIndicator = payload.summary.isPersonalBest ? '🏆 NEW PERSONAL BEST! 🏆' : '';
  
  // Create constraint status summary
  const constraintSummary = payload.constraints.map(c => {
    const statusIcon = c.satisfied ? '✅' : '❌';
    return `${statusIcon} **${c.attribute}**: ${c.actualCount}/${c.minCount} (${c.percentage}%)`;
  }).join('\n');
  
  const embed = {
    color: payload.gameStatus === 'completed' ? 0x28a745 : 0xdc3545,
    title: `🎯 Berghain Challenge - Scenario ${payload.scenario} ${status}`,
    fields: [
      {
        name: '📊 Final Score',
        value: `**${payload.rejectedCount}** rejections\n${bestIndicator}`,
        inline: true
      },
      {
        name: '🏢 Venue Status', 
        value: `${payload.admittedCount}/${payload.venueCapacity} filled\n${payload.summary.admitRate}% admit rate`,
        inline: true
      },
      {
        name: '📋 Constraints',
        value: constraintSummary,
        inline: false
      }
    ],
    footer: {
      text: `${payload.playerName} • ${new Date(payload.summary.completionTime).toLocaleString()}`
    },
    timestamp: payload.summary.completionTime
  };

  return embed;
}

// Start the Express server.
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

/**
 * Starts monitoring GitHub repo for new commits
 */
async function startGitHubMonitoring() {
  console.log('bot.js:startGitHubMonitoring - starting commit monitoring for %d repos', REPO_CONFIG.length);
  
  const checkInterval = 3 * 60 * 1000; // Check every 3 minutes
  
  // Create monitoring for each repo
  for (const repoConfig of REPO_CONFIG) {
    console.log('bot.js:startGitHubMonitoring - setting up monitoring for %s/%s', repoConfig.owner, repoConfig.repo);
    
    async function pollForCommits() {
      try {
        const { checkForNewCommits, fetchCommitDetails } = require('./src/services/github-service');
        const { getLastSeenCommit, updateLastSeenCommit } = require('./src/utils/commit-tracker');
        
        const lastSeen = await getLastCommitFromChannel(repoConfig.channelId);
        const newCommits = await checkForNewCommits(repoConfig.owner, repoConfig.repo, lastSeen);
        
        if (newCommits.length > 0) {
          console.log('bot.js:pollForCommits - found %d new commits for %s', newCommits.length, repoConfig.displayName);
          
          const channel = client.channels.cache.get(repoConfig.channelId);
          if (channel) {
            for (const commit of newCommits) {
              const details = await fetchCommitDetails(repoConfig.owner, repoConfig.repo, commit.sha);
              const enhancedCommit = { ...commit, ...details };
              
              const fakePayload = {
                commits: [enhancedCommit],
                repository: { name: repoConfig.displayName },
                ref: 'refs/heads/main'
              };
              
              const embed = createCommitEmbed(fakePayload);
              if (embed) {
                await channel.send({ embeds: [embed] });
              }
            }
            
            await updateLastSeenCommit(repoConfig.repo, newCommits[newCommits.length - 1].sha);
          }
        }
      } catch (error) {
        console.error('bot.js:pollForCommits - error polling %s:', repoConfig.displayName, error.message);
      }
    }
    
    // Initial check (staggered to avoid rate limits)
    setTimeout(pollForCommits, 5000 + (REPO_CONFIG.indexOf(repoConfig) * 2000));
    
    // Set up regular polling  
    setInterval(pollForCommits, checkInterval);
  }
}