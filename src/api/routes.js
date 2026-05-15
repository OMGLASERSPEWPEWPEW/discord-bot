const pathModule = require('path');
const { REPO_CONFIG, BOT_VERSION, PORT } = require('../config');
const { getUsage, loadUsage, getActivityLog, getVoiceStatus, getVoiceTranscripts } = require('../shared');
const { getStats } = require('../services/db-service');

function register(app, client) {
  app.use(require('express').static(pathModule.join(__dirname, '../../public')));

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

  app.get('/api/voice/status', (req, res) => {
    res.json(getVoiceStatus());
  });

  app.get('/api/voice/transcripts', (req, res) => {
    res.json(getVoiceTranscripts().slice(-30));
  });

  app.get('/api/db/stats', async (req, res) => {
    try {
      res.json(await getStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/activity', (req, res) => {
    res.json(getActivityLog().slice(-50));
  });
}

module.exports = { register };
