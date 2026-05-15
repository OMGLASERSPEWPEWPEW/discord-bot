require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');

const { BOT_VERSION, PORT, GLYFFI_CHANNEL_ID } = require('./src/config');
const { initMcpClient, logActivity } = require('./src/shared');
const { ingestAllChannels } = require('./src/services/db-service');

const chatHandler = require('./src/handlers/chat-handler');
const voiceHandler = require('./src/handlers/voice-handler');
const commitHandler = require('./src/handlers/commit-handler');
const apiRoutes = require('./src/api/routes');

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

client.once('ready', async () => {
  console.log(`Glyffi v${BOT_VERSION} logged in as ${client.user.tag}!`);

  client.guilds.cache.forEach(guild => {
    console.log(` - ${guild.name} (${guild.id})`);
    guild.channels.cache.forEach(ch => {
      if (ch.type === 0) console.log(`   #${ch.name} (${ch.id})`);
    });
  });

  commitHandler.startGitHubMonitoring(client);
  initMcpClient();

  const glyffiChannel = client.channels.cache.get(GLYFFI_CHANNEL_ID);
  if (glyffiChannel) {
    const pins = await glyffiChannel.messages.fetchPinned();
    const hasIntroPin = pins.some(m => m.author.id === client.user.id && m.embeds.some(e => e.title === 'Welcome to #glyffi'));
    if (!hasIntroPin) {
      const introMsg = await glyffiChannel.send({
        embeds: [{
          color: 0x5865F2,
          title: 'Welcome to #glyffi',
          description: `Hey, I'm **Glyffi** — Harbor Moon's AI assistant.\n\n**What I do:**\n• Answer questions when you @mention me in any channel\n• Browse codebases in ~/Development with my built-in tools\n• Post ELI5 summaries here when my code gets updated\n• Log all server messages to PostgreSQL for long-term memory\n• Log DMs too — you can message me directly\n• Join voice channels and respond to voice commands\n\n**Dashboard:**\nhttp://localhost:${PORT}\nLive status, usage stats, activity feed, and DB stats.\n\n**Powered by** Claude Haiku 4.5 • PostgreSQL • MCP • Whisper STT`,
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
    console.log(`[db] Ingestion complete: ${totalNew} new messages across ${results.length} channels`);
    logActivity('ingest', { channels: results.length, messages: totalNew });

    if (totalNew > 0 && glyffiChannel) {
      const tableList = results.filter(r => r.ingested > 0)
        .map(r => `**#${r.channel}** → \`${r.table}\` (${r.ingested} messages)`).join('\n');
      await glyffiChannel.send({
        embeds: [{
          color: 0x5865F2,
          title: '📋 Glyffi Chat Log Update',
          description: `Hey! I just synced **${totalNew}** new messages from **${results.length}** channels into my PostgreSQL database.\n\nEvery message in this server is logged so I can remember conversations and provide better context. Each channel has its own table:\n\n${tableList}\n\nNew messages are logged in real-time as they happen.`,
          footer: { text: `Glyffi v${BOT_VERSION} • Postgres-backed memory` }
        }]
      });
    }
  }).catch(err => console.error('[db] Ingestion failed:', err.message));
});

chatHandler.register(client);
voiceHandler.register(client);

client.login(process.env.DISCORD_TOKEN);

const app = express();
app.use(bodyParser.json());
commitHandler.registerWebhookRoutes(app, client);
apiRoutes.register(app, client);
app.listen(PORT, () => console.log(`Glyffi dashboard at http://localhost:${PORT}`));
