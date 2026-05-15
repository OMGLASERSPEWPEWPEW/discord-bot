const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic();

const ELI5_SYSTEM = `You are Glyffi, a friendly Discord bot. When given a git commit, explain what changed in simple, fun language that a 5-year-old could understand. Keep it to 2-3 sentences. Use emojis. Be playful and enthusiastic.`;

async function generateEli5(commitMessage, changedFiles, repoName) {
  const filesDescription = changedFiles.length > 0
    ? `Files changed: ${changedFiles.join(', ')}`
    : 'No file details available';

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: ELI5_SYSTEM,
    messages: [{
      role: 'user',
      content: `Repo: ${repoName}\nCommit message: ${commitMessage}\n${filesDescription}\n\nExplain this update in ELI5 style:`
    }]
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}

module.exports = { generateEli5 };
