const { SYSTEM_PROMPT } = require('../config');
const { recordUsage, formatCost, logActivity, queryWithTools } = require('../shared');
const { logMessage } = require('../services/db-service');

const channelHistories = new Map();

function register(client) {
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
    if (!userMessage) { message.reply("Hey! Ask me something."); return; }

    const channelId = message.channel.id;
    const userName = message.author.displayName;
    console.log(`[chat] ${chanLabel} | ${userName}: ${userMessage.slice(0, 100)}`);

    if (!channelHistories.has(channelId)) channelHistories.set(channelId, []);
    const history = channelHistories.get(channelId);
    history.push({ role: 'user', content: `${userName}: ${userMessage}` });
    if (history.length > 40) history.splice(0, history.length - 40);

    await message.channel.sendTyping();
    const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);

    try {
      const result = await queryWithTools(
        `${userName}: ${userMessage}`,
        SYSTEM_PROMPT,
        4096,
        'chat',
        [...history]
      );

      clearInterval(typingInterval);

      const reply = result.text || "I explored a lot but ran out of room to answer. Try asking about fewer projects at once.";
      const queryCost = recordUsage(result.totalInput, result.totalOutput, userName, channelId);
      const totalTokens = result.totalInput + result.totalOutput;
      const footer = `\n-# ${formatCost(queryCost.cost)} | ${totalTokens.toLocaleString()} tokens | ${result.rounds} tool rounds`;
      logActivity('chat', { user: userName, channel: channelId, cost: queryCost.cost, tokens: totalTokens });

      const fullReply = reply + footer;
      if (fullReply.length <= 2000) {
        await message.reply(fullReply);
      } else {
        const chunks = reply.match(/[\s\S]{1,2000}/g);
        for (const chunk of chunks) { await message.channel.send(chunk); }
        await message.channel.send(footer);
      }
    } catch (err) {
      clearInterval(typingInterval);
      console.error(`[chat] ERROR for ${userName}: ${err.message}`);
      message.reply("Something went wrong talking to Claude. Try again in a sec.");
    }
  });
}

module.exports = { register };
