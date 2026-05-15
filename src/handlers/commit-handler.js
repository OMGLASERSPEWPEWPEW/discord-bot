const { REPO_CONFIG, BOT_VERSION } = require('../config');
const { recordUsage, logActivity, getLastSeenForRepo, saveLastSeenForRepo } = require('../shared');
const { createCommitEmbed, createSimpleCommitMessage } = require('../formatters/commit-formatter');
const { checkForNewCommits, fetchCommitDetails } = require('../services/github-service');
const { generateEli5 } = require('../services/eli5-service');
const { createEli5Embed } = require('../formatters/eli5-formatter');

async function getLastCommitFromChannel(client, channelId) {
  try {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return null;
    const messages = await channel.messages.fetch({ limit: 10 });
    for (const message of messages.values()) {
      if (message.author.id === client.user.id && message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed.footer && embed.footer.text) {
          const commitHash = embed.footer.text.split(' • ')[0];
          return commitHash;
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[commit] error reading channel history:', error.message);
    return null;
  }
}

function formatBerghainResults(payload) {
  const status = payload.gameStatus === 'completed' ? '✅ COMPLETED' : '❌ FAILED';
  const bestIndicator = payload.summary.isPersonalBest ? '🏆 NEW PERSONAL BEST! 🏆' : '';
  const constraintSummary = payload.constraints.map(c => {
    const statusIcon = c.satisfied ? '✅' : '❌';
    return `${statusIcon} **${c.attribute}**: ${c.actualCount}/${c.minCount} (${c.percentage}%)`;
  }).join('\n');

  return {
    color: payload.gameStatus === 'completed' ? 0x28a745 : 0xdc3545,
    title: `🎯 Berghain Challenge - Scenario ${payload.scenario} ${status}`,
    fields: [
      { name: '📊 Final Score', value: `**${payload.rejectedCount}** rejections\n${bestIndicator}`, inline: true },
      { name: '🏢 Venue Status', value: `${payload.admittedCount}/${payload.venueCapacity} filled\n${payload.summary.admitRate}% admit rate`, inline: true },
      { name: '📋 Constraints', value: constraintSummary, inline: false }
    ],
    footer: { text: `${payload.playerName} • ${new Date(payload.summary.completionTime).toLocaleString()}` },
    timestamp: payload.summary.completionTime
  };
}

function startGitHubMonitoring(client) {
  console.log('[commit] starting monitoring for %d repos', REPO_CONFIG.length);
  const checkInterval = 3 * 60 * 1000;

  for (const repoConfig of REPO_CONFIG) {
    console.log('[commit] monitoring %s/%s', repoConfig.owner, repoConfig.repo);

    async function pollForCommits() {
      try {
        let lastSeen = getLastSeenForRepo(repoConfig);
        if (!lastSeen) {
          lastSeen = await getLastCommitFromChannel(client, repoConfig.channelId);
          if (lastSeen) saveLastSeenForRepo(repoConfig, lastSeen);
        }
        const newCommits = await checkForNewCommits(repoConfig.owner, repoConfig.repo, lastSeen);

        if (newCommits.length > 0) {
          logActivity('commit', { repo: repoConfig.displayName, count: newCommits.length });
          console.log('[commit] found %d new commits for %s', newCommits.length, repoConfig.displayName);

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
              if (embed) await channel.send({ embeds: [embed] });

              if (repoConfig.eli5) {
                try {
                  const allFiles = [...(enhancedCommit.added || []), ...(enhancedCommit.modified || []), ...(enhancedCommit.removed || [])];
                  const eli5Result = await generateEli5(enhancedCommit.message, allFiles, repoConfig.displayName);
                  const eli5Embed = createEli5Embed(eli5Result.text, enhancedCommit, repoConfig.displayName, BOT_VERSION);
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
        console.error('[commit] error polling %s:', repoConfig.displayName, error.message);
      }
    }

    setTimeout(pollForCommits, 5000 + (REPO_CONFIG.indexOf(repoConfig) * 2000));
    setInterval(pollForCommits, checkInterval);
  }
}

function registerWebhookRoutes(app, client) {
  app.post('/webhook', (req, res) => {
    const payload = req.body;
    if (payload.commits && payload.commits.length > 0) {
      const channel = client.channels.cache.get('1412917309328195644');
      if (channel) {
        const embed = createCommitEmbed(payload);
        if (embed) channel.send({ embeds: [embed] });
        else channel.send(createSimpleCommitMessage(payload));
      }
    }
    res.sendStatus(200);
  });

  app.post('/berghain-results', (req, res) => {
    const payload = req.body;
    const channel = client.channels.cache.get('1412917309328195644');
    if (channel) {
      const embed = formatBerghainResults(payload);
      channel.send({ embeds: [embed] });
      logActivity('berghain', { player: payload.playerName, scenario: payload.scenario });
    }
    res.sendStatus(200);
  });
}

module.exports = { startGitHubMonitoring, registerWebhookRoutes };
