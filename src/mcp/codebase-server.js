const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const path = require('path');
const fs = require('fs/promises');
const { execSync } = require('child_process');
const os = require('os');

const log = (...args) => console.error('[mcp-codebase]', ...args);
console.log = log;

const DEVELOPMENT_ROOT = path.resolve(os.homedir(), 'Development');
const MAX_FILE_LINES = 500;
const MAX_SEARCH_RESULTS = 50;
const MAX_LIST_ENTRIES = 200;
const SEARCH_TIMEOUT_MS = 5000;

const BLOCKED_NAMES = ['.env', '.env.local', '.env.development', '.env.production', '.env.staging',
  'credentials', 'secrets', '.secret', '.credentials'];

const NOISE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'target', 'Pods', '.gradle'];

function isBlockedName(name) {
  const lower = name.toLowerCase();
  return BLOCKED_NAMES.some(b => lower === b || lower.startsWith(b + '.'));
}

function validatePath(project, relativePath) {
  if (!project || project.includes('..') || project.includes('/')) {
    throw new Error(`Invalid project name: ${project}`);
  }

  const full = relativePath
    ? path.resolve(DEVELOPMENT_ROOT, project, relativePath)
    : path.resolve(DEVELOPMENT_ROOT, project);

  if (!full.startsWith(DEVELOPMENT_ROOT + path.sep) && full !== DEVELOPMENT_ROOT) {
    throw new Error('Path outside ~/Development is not allowed');
  }

  const parts = full.slice(DEVELOPMENT_ROOT.length + 1).split(path.sep);
  for (const part of parts) {
    if (isBlockedName(part)) {
      throw new Error(`Access to ${part} is blocked for security`);
    }
  }

  return full;
}

function isBinary(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

const server = new McpServer({ name: 'codebase-reader', version: '1.0.0' });

server.registerTool('list_projects', {
  description: 'List all projects in ~/Development with type hints (package.json, Cargo.toml, etc.)',
}, async () => {
  const entries = await fs.readdir(DEVELOPMENT_ROOT, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [];
  for (const dir of dirs) {
    const base = path.join(DEVELOPMENT_ROOT, dir.name);
    const markers = [];
    const checks = [
      ['package.json', 'node'],
      ['Cargo.toml', 'rust'],
      ['pyproject.toml', 'python'],
      ['go.mod', 'go'],
      ['Gemfile', 'ruby'],
      ['CLAUDE.md', 'has-claude-md'],
    ];
    for (const [file, label] of checks) {
      try {
        await fs.access(path.join(base, file));
        markers.push(label);
      } catch {}
    }
    const tag = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
    lines.push(`${dir.name}${tag}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') || 'No projects found.' }] };
});

server.registerTool('list_files', {
  description: 'List files and directories at a path within a project. Filters out node_modules, .git, etc.',
  inputSchema: {
    project: z.string().describe('Project directory name'),
    path: z.string().optional().default('').describe('Relative path within the project'),
  },
}, async ({ project, path: relPath }) => {
  const full = validatePath(project, relPath || '');

  let entries;
  try {
    entries = await fs.readdir(full, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { content: [{ type: 'text', text: `Path not found: ${project}/${relPath}` }] };
    throw err;
  }

  const filtered = entries
    .filter(e => !NOISE_DIRS.includes(e.name))
    .filter(e => !isBlockedName(e.name));
  filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const display = relPath ? `${project}/${relPath}` : project;

  if (filtered.length === 0) {
    return { content: [{ type: 'text', text: `${display}/ is empty (after filtering noise dirs).` }] };
  }

  const capped = filtered.slice(0, MAX_LIST_ENTRIES);
  const lines = capped.map(e => e.isDirectory() ? `${e.name}/` : e.name);

  let text = `${display}/\n${lines.join('\n')}`;
  if (filtered.length > MAX_LIST_ENTRIES) {
    text += `\n... and ${filtered.length - MAX_LIST_ENTRIES} more entries`;
  }

  return { content: [{ type: 'text', text }] };
});

server.registerTool('read_file', {
  description: 'Read the contents of a file. Returns line-numbered text. Blocks .env and credential files.',
  inputSchema: {
    project: z.string().describe('Project directory name'),
    path: z.string().describe('Relative file path within the project'),
    startLine: z.number().optional().describe('Start reading from this line (1-based)'),
    endLine: z.number().optional().describe('Stop reading at this line (inclusive)'),
  },
}, async ({ project, path: relPath, startLine, endLine }) => {
  const full = validatePath(project, relPath);

  let buf;
  try {
    buf = await fs.readFile(full);
  } catch (err) {
    if (err.code === 'ENOENT') return { content: [{ type: 'text', text: `File not found: ${project}/${relPath}` }] };
    throw err;
  }

  if (isBinary(buf)) {
    return { content: [{ type: 'text', text: `${project}/${relPath} is a binary file and cannot be displayed.` }] };
  }

  const allLines = buf.toString('utf-8').split('\n');
  const total = allLines.length;

  let start = (startLine && startLine > 0) ? startLine - 1 : 0;
  let end = (endLine && endLine > 0) ? Math.min(endLine, total) : Math.min(start + MAX_FILE_LINES, total);

  const slice = allLines.slice(start, end);
  const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`);

  let text = numbered.join('\n');
  if (total > MAX_FILE_LINES && !startLine && !endLine) {
    text += `\n\n[Showing first ${MAX_FILE_LINES} of ${total} lines. Use startLine/endLine to read more.]`;
  }

  return { content: [{ type: 'text', text }] };
});

server.registerTool('search_code', {
  description: 'Search for a text pattern across files in a project using grep. Excludes node_modules, .git, dist, and secret files.',
  inputSchema: {
    project: z.string().describe('Project directory name'),
    pattern: z.string().describe('Text or regex pattern to search for'),
    path: z.string().optional().default('').describe('Subdirectory to search within'),
    filePattern: z.string().optional().describe('File glob to filter, e.g. "*.ts" or "*.py"'),
  },
}, async ({ project, path: relPath, pattern, filePattern }) => {
  const searchRoot = validatePath(project, relPath || '');

  const excludes = NOISE_DIRS.map(d => `--exclude-dir=${d}`).join(' ');
  const fileFlag = filePattern ? `--include=${filePattern}` : '';
  const cmd = `grep -rn ${excludes} --exclude='*.env*' --exclude='*.min.js' --exclude='*.min.css' --exclude='*.map' ${fileFlag} -- ${JSON.stringify(pattern)} ${JSON.stringify(searchRoot)}`;

  let output;
  try {
    output = execSync(cmd, { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8' });
  } catch (err) {
    if (err.status === 1) return { content: [{ type: 'text', text: 'No matches found.' }] };
    if (err.killed) return { content: [{ type: 'text', text: 'Search timed out. Try a more specific pattern or narrower path.' }] };
    return { content: [{ type: 'text', text: `Search error: ${err.message}` }] };
  }

  const lines = output.trim().split('\n');
  const relative = lines.map(line => line.replace(DEVELOPMENT_ROOT + '/', ''));

  if (relative.length > MAX_SEARCH_RESULTS) {
    const capped = relative.slice(0, MAX_SEARCH_RESULTS);
    capped.push(`\n... ${relative.length - MAX_SEARCH_RESULTS} more matches. Narrow your search.`);
    return { content: [{ type: 'text', text: capped.join('\n') }] };
  }

  return { content: [{ type: 'text', text: relative.join('\n') }] };
});

const USAGE_FILE = path.join(__dirname, '../../data/usage.json');

server.registerTool('get_usage', {
  description: 'Get API usage and cost statistics. Shows total spend, per-user breakdown, and per-channel breakdown.',
}, async () => {
  let usage;
  try {
    const raw = await fs.readFile(USAGE_FILE, 'utf-8');
    usage = JSON.parse(raw);
  } catch {
    return { content: [{ type: 'text', text: 'No usage data recorded yet.' }] };
  }

  const lines = [
    `**Total Usage**`,
    `Queries: ${usage.queries}`,
    `Input tokens: ${usage.totalInputTokens.toLocaleString()}`,
    `Output tokens: ${usage.totalOutputTokens.toLocaleString()}`,
    `Total cost: $${usage.totalCost.toFixed(4)}`,
    '',
    '**By User**',
  ];

  for (const [user, data] of Object.entries(usage.byUser || {})) {
    lines.push(`${user}: ${data.queries} queries, $${data.cost.toFixed(4)}`);
  }

  lines.push('', '**By Channel**');
  for (const [ch, data] of Object.entries(usage.byChannel || {})) {
    lines.push(`<#${ch}>: ${data.queries} queries, $${data.cost.toFixed(4)}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('codebase-reader MCP server running on stdio');
}

main().catch(err => {
  log('Fatal:', err);
  process.exit(1);
});
