const pathModule = require('path');

const REPO_CONFIG = [
  {
    owner: 'OMGLASERSPEWPEWPEW',
    repo: 'discord-bot',
    channelId: '1504906264742985779',
    displayName: 'Glyffi Bot',
    eli5: true
  }
];

const DARKLIGHT_ID = '85856344308973568';
const GLYFFI_CHANNEL_ID = '1504906264742985779';
const GLYFFI_PATTERN = /[gc][lr][iy](?:ff?|ph)[iey]e?/i;

const PRICE_INPUT = 0.80 / 1_000_000;
const PRICE_OUTPUT = 4.00 / 1_000_000;
const MAX_COST_PER_QUERY = 0.50;
const TOOL_WINDOW = 12;

const USAGE_FILE = pathModule.join(__dirname, '../data/usage.json');
const LAST_SEEN_FILE = pathModule.join(__dirname, '../data/last-seen.json');

const BOT_VERSION = require('../package.json').version;
const PORT = process.env.PORT || 3737;

const SYSTEM_PROMPT = `You are Glyffi, a helpful assistant in a Discord server. Keep responses concise and conversational. Use markdown formatting that works in Discord.

You have tools to browse local codebases in ~/Development. When someone asks about code, use the tools to look things up rather than guessing. Start with list_projects to see what's available, then explore with list_files and read_file. Use search_code to find specific patterns.`;

const VOICE_SYSTEM_PROMPT = `You are Glyffi, speaking in a voice channel. Keep responses to 1-3 sentences — concise and conversational, as if talking to a friend. No markdown, no formatting, no emojis.

You have tools to browse local codebases in ~/Development. When someone asks about code or projects, use the tools to look things up rather than guessing. Start with list_projects to see what's available, then explore with list_files and read_file. Use search_code to find specific patterns.

Note: speech-to-text may mishear project names. Common mappings: "bird game" or "berghain" = berghain-bot, "glyffiti" = GlyffitiMobile, "nib" = nib, "open claw" = openclaw. When in doubt, use list_projects to find the closest match.`;

module.exports = {
  REPO_CONFIG, DARKLIGHT_ID, GLYFFI_CHANNEL_ID, GLYFFI_PATTERN,
  PRICE_INPUT, PRICE_OUTPUT, MAX_COST_PER_QUERY, TOOL_WINDOW,
  USAGE_FILE, LAST_SEEN_FILE, BOT_VERSION, PORT,
  SYSTEM_PROMPT, VOICE_SYSTEM_PROMPT,
};
