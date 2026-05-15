// Repository monitoring configuration
const REPO_CONFIG = [
  {
    owner: 'OMGLASERSPEWPEWPEW',
    repo: 'discord-bot',
    channelId: '1504906264742985779', // #glyffi
    displayName: 'Glyffi Bot',
    eli5: true
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
const Anthropic = require('@anthropic-ai/sdk');
const { Client: McpClient } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createCommitEmbed, createSimpleCommitMessage } = require('./src/formatters/commit-formatter');
const { ingestAllChannels, logMessage, getStats } = require('./src/services/db-service');
const { checkForNewCommits, fetchCommitDetails } = require('./src/services/github-service');

const fs = require('fs');
const pathModule = require('path');

const BOT_VERSION = require('./package.json').version;

const anthropic = new Anthropic();

const channelHistories = new Map();

let mcpClient = null;
let mcpTools = [];

// Haiku 4.5 pricing (per token)
const PRICE_INPUT = 0.80 / 1_000_000;
const PRICE_OUTPUT = 4.00 / 1_000_000;

const USAGE_FILE = pathModule.join(__dirname, 'data/usage.json');
const LAST_SEEN_FILE = pathModule.join(__dirname, 'data/last-seen.json');

function loadLastSeen() {
  try {
    return JSON.parse(fs.readFileSync(LAST_SEEN_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveLastSeen(data) {
  fs.mkdirSync(pathModule.dirname(LAST_SEEN_FILE), { recursive: true });
  fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(data, null, 2));
}

function getLastSeenForRepo(repoConfig) {
  const key = `${repoConfig.owner}/${repoConfig.repo}`;
  return loadLastSeen()[key] || null;
}

function saveLastSeenForRepo(repoConfig, sha) {
  const data = loadLastSeen();
  data[`${repoConfig.owner}/${repoConfig.repo}`] = sha;
  saveLastSeen(data);
}

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
  } catch {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, queries: 0, byUser: {}, byChannel: {} };
  }
}

function saveUsage(usage) {
  fs.mkdirSync(pathModule.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

let usage = loadUsage();

const activityLog = [];
const MAX_ACTIVITY = 200;

function logActivity(type, details) {
  activityLog.push({ timestamp: new Date().toISOString(), type, details });
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
}

function recordUsage(inputTokens, outputTokens, userName, channelId) {
  const cost = inputTokens * PRICE_INPUT + outputTokens * PRICE_OUTPUT;

  usage.totalInputTokens += inputTokens;
  usage.totalOutputTokens += outputTokens;
  usage.totalCost += cost;
  usage.queries++;

  if (!usage.byUser[userName]) usage.byUser[userName] = { inputTokens: 0, outputTokens: 0, cost: 0, queries: 0 };
  usage.byUser[userName].inputTokens += inputTokens;
  usage.byUser[userName].outputTokens += outputTokens;
  usage.byUser[userName].cost += cost;
  usage.byUser[userName].queries++;

  if (!usage.byChannel[channelId]) usage.byChannel[channelId] = { inputTokens: 0, outputTokens: 0, cost: 0, queries: 0 };
  usage.byChannel[channelId].inputTokens += inputTokens;
  usage.byChannel[channelId].outputTokens += outputTokens;
  usage.byChannel[channelId].cost += cost;
  usage.byChannel[channelId].queries++;

  saveUsage(usage);
  return { inputTokens, outputTokens, cost };
}

function formatCost(cost) {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function getUsageStats() { return usage; }


// Create a new Discord client instance with required intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [require('discord.js').Partials.Channel],
});

// Log when the bot is ready.
client.once('ready', () => {
  console.log(`Glyffi v${BOT_VERSION} logged in as ${client.user.tag}!`);
  
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
  initMcpClient();

  const glyffiChannel = client.channels.cache.get('1504906264742985779');
  if (glyffiChannel) {
    const pins = await glyffiChannel.messages.fetchPinned();
    const hasIntroPin = pins.some(m => m.author.id === client.user.id && m.embeds.some(e => e.title === 'Welcome to #glyffi'));
    if (!hasIntroPin) {
      const introMsg = await glyffiChannel.send({
        embeds: [{
          color: 0x5865F2,
          title: 'Welcome to #glyffi',
          description: `Hey, I'm **Glyffi** — Harbor Moon's AI assistant.\n\n**What I do:**\n• Answer questions when you @mention me in any channel\n• Browse codebases in ~/Development with my built-in tools\n• Post ELI5 summaries here when my code gets updated\n• Log all server messages to PostgreSQL for long-term memory\n• Log DMs too — you can message me directly\n\n**Dashboard:**\nhttp://localhost:3000\nLive status, usage stats, activity feed, and DB stats.\n\n**Powered by** Claude Haiku 4.5 • PostgreSQL • MCP`,
          footer: { text: `Glyffi v${BOT_VERSION}` }
        }]
      });
      await introMsg.pin();
      console.log('[glyffi] Pinned intro message in #glyffi');
    }
  }

  console.log('[db] Starting channel ingestion...');
  ingestAllChannels(client).then(async results => {
    const totalNew = results.reduce((sum, r) => sum + (r.ingested || 0), 0);
    const totalStored = results.reduce((sum, r) => sum + (r.ingested || 0), 0);
    console.log(`[db] Ingestion complete: ${totalNew} new messages across ${results.length} channels`);
    logActivity('ingest', { channels: results.length, messages: totalNew });

    if (totalNew > 0) {
      const glyffiChannel = client.channels.cache.get('1504906264742985779');
      if (glyffiChannel) {
        const tableList = results
          .filter(r => r.ingested > 0)
          .map(r => `**#${r.channel}** → \`${r.table}\` (${r.ingested} messages)`)
          .join('\n');

        await glyffiChannel.send({
          embeds: [{
            color: 0x5865F2,
            title: '📋 Glyffi Chat Log Update',
            description: `Hey! I just synced **${totalNew}** new messages from **${results.length}** channels into my PostgreSQL database.\n\nEvery message in this server is logged so I can remember conversations and provide better context. Each channel has its own table:\n\n${tableList}\n\nNew messages are logged in real-time as they happen. Ask me anything about past conversations!`,
            footer: { text: `Glyffi v${BOT_VERSION} • Postgres-backed memory` }
          }]
        });
        console.log('[glyffi] Posted ingestion summary to #glyffi');
      }
    }
  }).catch(err => {
    console.error('[db] Ingestion failed:', err.message);
  });
});

async function initMcpClient() {
  try {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [require('path').join(__dirname, 'src/mcp/codebase-server.js')],
      stderr: 'inherit',
    });

    mcpClient = new McpClient({ name: 'discord-bot', version: BOT_VERSION });
    await mcpClient.connect(transport);

    const { tools } = await mcpClient.listTools();
    mcpTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    console.log(`MCP codebase-reader connected (${mcpTools.length} tools)`);
  } catch (err) {
    console.error('MCP init failed (bot will work without codebase tools):', err.message);
    mcpClient = null;
    mcpTools = [];
  }
}

const SYSTEM_PROMPT = `You are Glyffi, a helpful assistant in a Discord server. Keep responses concise and conversational. Use markdown formatting that works in Discord.

You have tools to browse local codebases in ~/Development. When someone asks about code, use the tools to look things up rather than guessing. Start with list_projects to see what's available, then explore with list_files and read_file. Use search_code to find specific patterns.`;

const TOOL_WINDOW = 12;
const MAX_COST_PER_QUERY = 0.50;

client.on('messageCreate', async message => {
  const tag = message.author.bot ? ' [BOT]' : '';
  const isDM = message.channel.type === 1;
  const chanLabel = isDM ? `DM:${message.author.username}` : `#${message.channel.name}`;
  const preview = message.content.slice(0, 120) || (message.embeds.length ? `[${message.embeds.length} embed(s)]` : '[no content]');
  console.log(`[msg] ${chanLabel} | ${message.author.displayName}${tag}: ${preview}`);
  logMessage(message);

  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!userMessage) {
    message.reply("Hey! Ask me something.");
    return;
  }

  const channelId = message.channel.id;
  const userName = message.author.displayName;
  console.log(`[chat] #${message.channel.name} | ${userName}: ${userMessage.slice(0, 100)}`);

  if (!channelHistories.has(channelId)) channelHistories.set(channelId, []);
  const history = channelHistories.get(channelId);

  history.push({ role: 'user', content: `${userName}: ${userMessage}` });
  if (history.length > 40) history.splice(0, history.length - 40);

  await message.channel.sendTyping();
  const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);

  try {
    const historyLen = history.length;
    const loopMessages = [...history];
    const apiParams = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: loopMessages,
    };
    if (mcpTools.length > 0) apiParams.tools = mcpTools;

    let response = await anthropic.messages.create(apiParams);
    let rounds = 0;
    let totalInput = response.usage.input_tokens;
    let totalOutput = response.usage.output_tokens;
    console.log(`[chat] round 0 | stop=${response.stop_reason} | tokens: ${response.usage.input_tokens}in/${response.usage.output_tokens}out`);

    while (response.stop_reason === 'tool_use') {
      rounds++;
      const runningCost = totalInput * PRICE_INPUT + totalOutput * PRICE_OUTPUT;
      if (runningCost >= MAX_COST_PER_QUERY) {
        console.log(`[chat] cost cap hit (${formatCost(runningCost)}), forcing text response`);
        break;
      }

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      console.log(`[chat] round ${rounds} | tools: ${toolUseBlocks.map(b => b.name).join(', ')}`);

      const toolResults = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await mcpClient.callTool({ name: block.name, arguments: block.input });
          const text = result.content.map(c => c.text || '').join('\n');
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: text });
          console.log(`[chat]   ${block.name}(${JSON.stringify(block.input).slice(0, 80)}) -> ${text.length} chars`);
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
          console.error(`[chat]   ${block.name} ERROR: ${err.message}`);
        }
      }

      loopMessages.push({ role: 'assistant', content: response.content });
      loopMessages.push({ role: 'user', content: toolResults });

      const toolRoundCount = (loopMessages.length - historyLen) / 2;
      if (toolRoundCount > TOOL_WINDOW) {
        const evictStart = historyLen;
        const evictCount = 2;
        const evicted = loopMessages[evictStart]?.content;
        const evictedTools = Array.isArray(evicted)
          ? evicted.filter(b => b.type === 'tool_use').map(b => b.name).join(', ')
          : '?';
        loopMessages.splice(evictStart, evictCount);
        console.log(`[chat] evicted oldest tool round (${evictedTools}), window: ${(loopMessages.length - historyLen) / 2} rounds`);
      }

      response = await anthropic.messages.create({ ...apiParams, messages: loopMessages });
      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;
      console.log(`[chat] round ${rounds} done | stop=${response.stop_reason} | tokens: ${response.usage.input_tokens}in/${response.usage.output_tokens}out`);
    }

    clearInterval(typingInterval);

    if (response.stop_reason === 'tool_use') {
      loopMessages.push({ role: 'assistant', content: response.content });
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const forceResults = toolUseBlocks.map(b => ({
        type: 'tool_result', tool_use_id: b.id,
        content: 'Wrap up now. Summarize everything you have gathered so far and respond to the user.',
        is_error: true,
      }));
      loopMessages.push({ role: 'user', content: forceResults });
      const finalParams = { ...apiParams, messages: loopMessages };
      delete finalParams.tools;
      response = await anthropic.messages.create(finalParams);
      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;
    }

    const queryCost = recordUsage(totalInput, totalOutput, userName, channelId);

    const textBlocks = response.content.filter(b => b.type === 'text');
    let reply = textBlocks.map(b => b.text).join('\n');
    if (!reply) reply = "I explored a lot but ran out of room to answer. Try asking about fewer projects at once.";

    const totalTokens = totalInput + totalOutput;
    const footer = `\n-# ${formatCost(queryCost.cost)} | ${totalTokens.toLocaleString()} tokens | ${rounds} tool rounds`;
    logActivity('chat', { user: userName, channel: channelId, cost: queryCost.cost, tokens: totalTokens });
    console.log(`[chat] done | ${rounds} rounds | ${totalTokens} tokens | ${formatCost(queryCost.cost)} | reply: ${reply.length} chars`);

    const fullReply = reply + footer;
    if (fullReply.length <= 2000) {
      await message.reply(fullReply);
    } else {
      const chunks = reply.match(/[\s\S]{1,2000}/g);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
      await message.channel.send(footer);
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error(`[chat] ERROR for ${userName}: ${err.message}`);
    console.error(err.stack);
    message.reply("Something went wrong talking to Claude. Try again in a sec.");
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
    logActivity('berghain', { player: payload.playerName, scenario: payload.scenario });
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

app.use(express.static(pathModule.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    version: BOT_VERSION,
    status: client.ws.status === 0 ? 'online' : 'offline',
    uptime: process.uptime(),
    botTag: client.user?.tag || 'unknown',
    guilds: client.guilds.cache.size,
    ping: client.ws.ping,
    monitoredRepos: REPO_CONFIG.map(r => `${r.owner}/${r.repo}`)
  });
});

app.get('/api/usage', (req, res) => {
  res.json(loadUsage());
});

app.get('/api/channels', (req, res) => {
  const channels = [];
  client.guilds.cache.forEach(guild => {
    guild.channels.cache.forEach(ch => {
      if (ch.type === 0 || ch.type === 2) {
        channels.push({ id: ch.id, name: ch.name, type: ch.type === 0 ? 'text' : 'voice', guild: guild.name });
      }
    });
  });
  res.json(channels);
});

app.get('/api/channel/:id/messages', async (req, res) => {
  try {
    const channel = client.channels.cache.get(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const messages = await channel.messages.fetch({ limit });
    const result = messages.map(m => ({
      id: m.id,
      author: m.author.displayName,
      bot: m.author.bot,
      content: m.content || null,
      embeds: m.embeds.map(e => ({ title: e.title, description: e.description?.slice(0, 200), color: e.color })),
      timestamp: m.createdAt.toISOString()
    }));
    res.json(result.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/activity', (req, res) => {
  res.json(activityLog.slice(-50));
});

app.listen(PORT, () => {
  console.log(`Glyffi dashboard at http://localhost:${PORT}`);
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
        
        let lastSeen = getLastSeenForRepo(repoConfig);
        if (!lastSeen) {
          lastSeen = await getLastCommitFromChannel(repoConfig.channelId);
          if (lastSeen) saveLastSeenForRepo(repoConfig, lastSeen);
        }
        const newCommits = await checkForNewCommits(repoConfig.owner, repoConfig.repo, lastSeen);
        
        if (newCommits.length > 0) {
          logActivity('commit', { repo: repoConfig.displayName, count: newCommits.length });
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

              if (repoConfig.eli5) {
                try {
                  const { generateEli5 } = require('./src/services/eli5-service');
                  const { createEli5Embed } = require('./src/formatters/eli5-formatter');

                  const allFiles = [
                    ...(enhancedCommit.added || []),
                    ...(enhancedCommit.modified || []),
                    ...(enhancedCommit.removed || [])
                  ];

                  const eli5Result = await generateEli5(
                    enhancedCommit.message,
                    allFiles,
                    repoConfig.displayName
                  );

                  const eli5Embed = createEli5Embed(
                    eli5Result.text,
                    enhancedCommit,
                    repoConfig.displayName,
                    BOT_VERSION
                  );

                  await channel.send({ embeds: [eli5Embed] });
                  recordUsage(eli5Result.inputTokens, eli5Result.outputTokens, 'Glyffi-ELI5', repoConfig.channelId);
                  logActivity('eli5', { repo: repoConfig.displayName, commit: enhancedCommit.sha.substring(0, 7) });
                  console.log('[eli5] Posted ELI5 for %s commit %s', repoConfig.displayName, enhancedCommit.sha.substring(0, 7));
                } catch (err) {
                  console.error('[eli5] Failed to generate ELI5:', err.message);
                }
              }
            }
            const latestPosted = newCommits[newCommits.length - 1];
            if (latestPosted) saveLastSeenForRepo(repoConfig, latestPosted.sha);
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