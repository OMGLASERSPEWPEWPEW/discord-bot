// File: discord-bot/src/formatters/commit-formatter.js (relative to project root)

/**
 * Formats GitHub webhook commit data into engineer-friendly Discord messages
 * with diff stats, file changes, and scannable information
 */

/**
 * Creates a rich Discord embed for commit notifications
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Discord embed object
 */
function createCommitEmbed(payload) {
  console.log('discord-bot/src/formatters/commit-formatter.js:createCommitEmbed - processing payload');
  
  if (!payload.commits || payload.commits.length === 0) {
    console.log('discord-bot/src/formatters/commit-formatter.js:createCommitEmbed - no commits found');
    return null;
  }

  const commit = payload.commits[payload.commits.length - 1]; // Latest commit
  const repo = payload.repository;
  const branch = payload.ref ? payload.ref.replace('refs/heads/', '') : 'unknown';
  
  // Calculate total changes across all commits
  const totalStats = calculateTotalChanges(payload.commits);
  
  const embed = {
    color: getCommitColor(commit),
    title: `📝 New commit to ${repo.name}`,
    url: commit.url,
    author: {
      name: commit.author.name,
      icon_url: commit.author.avatar || undefined
    },
    description: formatCommitMessage(commit.message),
    fields: [
      {
        name: '🌿 Branch',
        value: `\`${branch}\``,
        inline: true
      },
      {
        name: '📊 Changes',
        value: formatChangeStats(totalStats),
        inline: true
      },
      {
        name: '🔧 Files Modified',
        value: formatFileChanges(commit),
        inline: false
      }
    ],
    footer: {
      text: `${commit.id.substring(0, 7)} • ${new Date(commit.timestamp).toLocaleString()}`
    },
    timestamp: commit.timestamp
  };

  console.log('discord-bot/src/formatters/commit-formatter.js:createCommitEmbed - embed created with %d fields', embed.fields.length);
  return embed;
}

/**
 * Formats the commit message for Discord display
 * @param {string} message - Raw commit message
 * @returns {string} Formatted commit message
 */
function formatCommitMessage(message) {
  console.log('discord-bot/src/formatters/commit-formatter.js:formatCommitMessage - formatting message');
  
  // Split on first line break to get title
  const lines = message.split('\n');
  const title = lines[0];
  
  // Truncate if too long for Discord
  if (title.length > 100) {
    return `${title.substring(0, 97)}...`;
  }
  
  return title;
}

/**
 * Calculates total additions/deletions across all commits
 * @param {Array} commits - Array of commit objects
 * @returns {Object} Total change statistics
 */
function calculateTotalChanges(commits) {
  console.log('discord-bot/src/formatters/commit-formatter.js:calculateTotalChanges - processing %d commits', commits.length);
  
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalModified = 0;

  commits.forEach(commit => {
    totalAdded += commit.added?.length || 0;
    totalRemoved += commit.removed?.length || 0;
    totalModified += commit.modified?.length || 0;
  });

  return {
    added: totalAdded,
    removed: totalRemoved,
    modified: totalModified,
    total: totalAdded + totalRemoved + totalModified
  };
}

/**
 * Formats change statistics for display
 * @param {Object} stats - Change statistics object
 * @returns {string} Formatted stats string
 */
function formatChangeStats(stats) {
  console.log('discord-bot/src/formatters/commit-formatter.js:formatChangeStats - formatting stats');
  
  const parts = [];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`-${stats.removed}`);
  if (stats.modified > 0) parts.push(`~${stats.modified}`);
  
  return parts.length > 0 ? parts.join(' ') : 'No changes';
}

/**
 * Formats the list of changed files for Discord
 * @param {Object} commit - Commit object with file arrays
 * @returns {string} Formatted file list
 */
function formatFileChanges(commit) {
  console.log('discord-bot/src/formatters/commit-formatter.js:formatFileChanges - formatting file changes');
  
  const allFiles = [
    ...(commit.added || []).map(f => `+ ${f}`),
    ...(commit.modified || []).map(f => `~ ${f}`),
    ...(commit.removed || []).map(f => `- ${f}`)
  ];

  if (allFiles.length === 0) {
    return 'No files changed';
  }

  // Truncate if too many files
  if (allFiles.length > 10) {
    const showing = allFiles.slice(0, 10);
    const remaining = allFiles.length - 10;
    return `\`\`\`diff\n${showing.join('\n')}\n... and ${remaining} more\`\`\``;
  }

  return `\`\`\`diff\n${allFiles.join('\n')}\`\`\``;
}

/**
 * Determines embed color based on commit content
 * @param {Object} commit - Commit object
 * @returns {number} Discord color code
 */
function getCommitColor(commit) {
  // Green for additions, orange for mixed, red for deletions
  const hasAdditions = commit.added && commit.added.length > 0;
  const hasDeletions = commit.removed && commit.removed.length > 0;
  
  if (hasAdditions && !hasDeletions) return 0x28a745; // Green
  if (hasDeletions && !hasAdditions) return 0xdc3545; // Red
  if (hasAdditions && hasDeletions) return 0xffc107; // Orange
  return 0x6f42c1; // Purple for modifications only
}

/**
 * Creates a simple text message as fallback
 * @param {Object} payload - GitHub webhook payload
 * @returns {string} Simple commit notification
 */
function createSimpleCommitMessage(payload) {
  console.log('discord-bot/src/formatters/commit-formatter.js:createSimpleCommitMessage - creating fallback message');
  
  if (!payload.commits || payload.commits.length === 0) {
    return 'New activity on repository (no commit details)';
  }

  const commit = payload.commits[payload.commits.length - 1];
  const repo = payload.repository.name;
  const author = commit.author.name;
  const message = formatCommitMessage(commit.message);
  
  return `🔨 **${author}** pushed to **${repo}**:\n"${message}"\n${commit.url}`;
}

module.exports = {
  createCommitEmbed,
  createSimpleCommitMessage,
  formatCommitMessage,
  formatFileChanges,
  calculateTotalChanges
};

// File length: 4,847 characters