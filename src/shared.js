const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { Client: McpClient } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const pathModule = require('path');
const { USAGE_FILE, LAST_SEEN_FILE, PRICE_INPUT, PRICE_OUTPUT, MAX_COST_PER_QUERY, TOOL_WINDOW, BOT_VERSION } = require('./config');

const anthropic = new Anthropic();

let mcpClient = null;
let mcpTools = [];

async function initMcpClient() {
  try {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [pathModule.join(__dirname, 'mcp/codebase-server.js')],
      stderr: 'inherit',
    });
    mcpClient = new McpClient({ name: 'discord-bot', version: BOT_VERSION });
    await mcpClient.connect(transport);
    const { tools } = await mcpClient.listTools();
    mcpTools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    console.log(`MCP codebase-reader connected (${mcpTools.length} tools)`);
  } catch (err) {
    console.error('MCP init failed (bot will work without codebase tools):', err.message);
    mcpClient = null;
    mcpTools = [];
  }
}

// Usage tracking
let usage = loadUsage();

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); }
  catch { return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, queries: 0, byUser: {}, byChannel: {} }; }
}

function saveUsage(u) {
  fs.mkdirSync(pathModule.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2));
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

function getUsage() { return usage; }

// Activity log
const activityLog = [];
const MAX_ACTIVITY = 200;

function logActivity(type, details) {
  activityLog.push({ timestamp: new Date().toISOString(), type, details });
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
}

function getActivityLog() { return activityLog; }

// Last seen tracking
function loadLastSeen() {
  try { return JSON.parse(fs.readFileSync(LAST_SEEN_FILE, 'utf-8')); }
  catch { return {}; }
}

function getLastSeenForRepo(repoConfig) {
  return loadLastSeen()[`${repoConfig.owner}/${repoConfig.repo}`] || null;
}

function saveLastSeenForRepo(repoConfig, sha) {
  const data = loadLastSeen();
  data[`${repoConfig.owner}/${repoConfig.repo}`] = sha;
  fs.mkdirSync(pathModule.dirname(LAST_SEEN_FILE), { recursive: true });
  fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(data, null, 2));
}

// Voice transcripts
const voiceTranscripts = [];
const MAX_TRANSCRIPTS = 50;
let voiceStatus = { connected: false, channel: null, state: 'idle' };

function logTranscript(type, text, query, cost) {
  voiceTranscripts.push({ timestamp: new Date().toISOString(), type, text, query, cost });
  if (voiceTranscripts.length > MAX_TRANSCRIPTS) voiceTranscripts.shift();
}

function getVoiceTranscripts() { return voiceTranscripts; }
function getVoiceStatus() { return voiceStatus; }
function setVoiceStatus(s) { Object.assign(voiceStatus, s); }

// Agentic tool loop
async function queryWithTools(query, systemPrompt, maxTokens, logPrefix, history = []) {
  history.push({ role: 'user', content: query });
  if (history.length > 20) history.splice(0, history.length - 20);
  const messages = [...history];
  const apiParams = { model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system: systemPrompt, messages };
  if (mcpTools.length > 0) apiParams.tools = mcpTools;

  let response = await anthropic.messages.create(apiParams);
  let rounds = 0;
  let totalInput = response.usage.input_tokens;
  let totalOutput = response.usage.output_tokens;
  console.log(`[${logPrefix}] round 0 | stop=${response.stop_reason} | ${response.usage.input_tokens}in/${response.usage.output_tokens}out`);

  while (response.stop_reason === 'tool_use') {
    rounds++;
    const runningCost = totalInput * PRICE_INPUT + totalOutput * PRICE_OUTPUT;
    if (runningCost >= MAX_COST_PER_QUERY) { console.log(`[${logPrefix}] cost cap hit`); break; }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    console.log(`[${logPrefix}] round ${rounds} | tools: ${toolUseBlocks.map(b => b.name).join(', ')}`);

    const toolResults = [];
    for (const block of toolUseBlocks) {
      try {
        const result = await mcpClient.callTool({ name: block.name, arguments: block.input });
        const text = result.content.map(c => c.text || '').join('\n');
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: text });
        console.log(`[${logPrefix}]   ${block.name}(${JSON.stringify(block.input).slice(0, 80)}) -> ${text.length} chars`);
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    if (rounds > TOOL_WINDOW) { messages.splice(1, 2); console.log(`[${logPrefix}] evicted oldest tool round`); }

    response = await anthropic.messages.create({ ...apiParams, messages });
    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    console.log(`[${logPrefix}] round ${rounds} done | stop=${response.stop_reason}`);
  }

  if (response.stop_reason === 'tool_use') {
    messages.push({ role: 'assistant', content: response.content });
    const forceResults = response.content.filter(b => b.type === 'tool_use').map(b => ({
      type: 'tool_result', tool_use_id: b.id,
      content: 'Wrap up now. Summarize what you found and respond to the user.',
      is_error: true,
    }));
    messages.push({ role: 'user', content: forceResults });
    const finalParams = { ...apiParams, messages };
    delete finalParams.tools;
    response = await anthropic.messages.create(finalParams);
    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  history.push({ role: 'assistant', content: text });
  console.log(`[${logPrefix}] done | ${rounds} rounds | ${totalInput + totalOutput} tokens | reply: ${text.length} chars`);
  return { text, totalInput, totalOutput, rounds };
}

module.exports = {
  anthropic, initMcpClient,
  recordUsage, formatCost, getUsage, loadUsage,
  logActivity, getActivityLog,
  getLastSeenForRepo, saveLastSeenForRepo,
  logTranscript, getVoiceTranscripts, getVoiceStatus, setVoiceStatus,
  queryWithTools,
};
