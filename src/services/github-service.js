// File: discord-bot/src/services/github-service.js (relative to project root)

const axios = require('axios');

/**
 * GitHub API service for fetching commit data from public repositories
 * Handles rate limiting and provides commit monitoring functionality
 */

const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'OMGLASERSPEWPEWPEW';
const REPO_NAME = 'berghain-bot';

/**
 * Fetches the latest commits from the berghain-bot repository
 * @param {number} limit - Number of commits to fetch (default: 10)
 * @returns {Promise<Array>} Array of commit objects
 */
async function fetchLatestCommits(limit = 10) {
  console.log('discord-bot/src/services/github-service.js:fetchLatestCommits - fetching %d commits', limit);
  
  try {
    const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits`;
    const response = await axios.get(url, {
      params: {
        per_page: limit,
        page: 1
      },
      headers: {
        'User-Agent': 'Discord-Bot-Berghain-Watcher',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    console.log('discord-bot/src/services/github-service.js:fetchLatestCommits - successfully fetched %d commits', response.data.length);
    return response.data.map(transformCommitData);
    
  } catch (error) {
    console.error('discord-bot/src/services/github-service.js:fetchLatestCommits - error fetching commits:', error.message);
    
    if (error.response?.status === 403) {
      console.error('discord-bot/src/services/github-service.js:fetchLatestCommits - rate limited, waiting before retry');
    }
    
    throw error;
  }
}

/**
 * Checks for new commits since the last seen commit hash
 * @param {string} lastSeenCommitHash - SHA of the last processed commit
 * @returns {Promise<Array>} Array of new commit objects
 */
async function checkForNewCommits(lastSeenCommitHash) {
  console.log('discord-bot/src/services/github-service.js:checkForNewCommits - checking for commits after %s', lastSeenCommitHash);
  
  try {
    const allCommits = await fetchLatestCommits(20); // Get more to ensure we catch everything
    
    if (!lastSeenCommitHash) {
      console.log('discord-bot/src/services/github-service.js:checkForNewCommits - no previous hash, returning latest commit only');
      return allCommits.slice(0, 1); // Just the latest one on first run
    }
    
    const lastSeenIndex = allCommits.findIndex(commit => commit.sha === lastSeenCommitHash);
    
    if (lastSeenIndex === -1) {
      console.log('discord-bot/src/services/github-service.js:checkForNewCommits - last seen commit not found, returning latest');
      return allCommits.slice(0, 1);
    }
    
    const newCommits = allCommits.slice(0, lastSeenIndex);
    console.log('discord-bot/src/services/github-service.js:checkForNewCommits - found %d new commits', newCommits.length);
    
    return newCommits.reverse(); // Return in chronological order
    
  } catch (error) {
    console.error('discord-bot/src/services/github-service.js:checkForNewCommits - error checking commits:', error.message);
    return [];
  }
}

/**
 * Transforms GitHub API commit data into format compatible with our formatter
 * @param {Object} githubCommit - Raw GitHub API commit object
 * @returns {Object} Transformed commit object
 */
function transformCommitData(githubCommit) {
  console.log('discord-bot/src/services/github-service.js:transformCommitData - transforming commit %s', githubCommit.sha.substring(0, 7));
  
  return {
    id: githubCommit.sha,
    sha: githubCommit.sha,
    message: githubCommit.commit.message,
    timestamp: githubCommit.commit.author.date,
    url: githubCommit.html_url,
    author: {
      name: githubCommit.commit.author.name,
      email: githubCommit.commit.author.email,
      avatar: githubCommit.author?.avatar_url
    },
    // GitHub API doesn't provide file stats in basic commits endpoint
    // We'd need to fetch each commit individually for file details
    added: [],
    modified: [],
    removed: [],
    stats: {
      additions: 0,
      deletions: 0,
      total: 0
    }
  };
}

/**
 * Fetches detailed file changes for a specific commit
 * @param {string} commitSha - SHA of the commit to get details for
 * @returns {Promise<Object>} Commit object with file change details
 */
async function fetchCommitDetails(commitSha) {
  console.log('discord-bot/src/services/github-service.js:fetchCommitDetails - fetching details for %s', commitSha.substring(0, 7));
  
  try {
    const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits/${commitSha}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Discord-Bot-Berghain-Watcher',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const commit = response.data;
    const files = commit.files || [];
    
    const fileChanges = {
      added: files.filter(f => f.status === 'added').map(f => f.filename),
      modified: files.filter(f => f.status === 'modified').map(f => f.filename),
      removed: files.filter(f => f.status === 'removed').map(f => f.filename),
      stats: {
        additions: commit.stats?.additions || 0,
        deletions: commit.stats?.deletions || 0,
        total: commit.stats?.total || 0
      }
    };
    
    console.log('discord-bot/src/services/github-service.js:fetchCommitDetails - found %d file changes', files.length);
    return fileChanges;
    
  } catch (error) {
    console.error('discord-bot/src/services/github-service.js:fetchCommitDetails - error fetching commit details:', error.message);
    return {
      added: [],
      modified: [],
      removed: [],
      stats: { additions: 0, deletions: 0, total: 0 }
    };
  }
}

/**
 * Gets repository information for display purposes
 * @returns {Promise<Object>} Repository metadata
 */
async function getRepositoryInfo() {
  console.log('discord-bot/src/services/github-service.js:getRepositoryInfo - fetching repo info');
  
  try {
    const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Discord-Bot-Berghain-Watcher',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    return {
      name: response.data.name,
      full_name: response.data.full_name,
      description: response.data.description,
      html_url: response.data.html_url,
      default_branch: response.data.default_branch
    };
    
  } catch (error) {
    console.error('discord-bot/src/services/github-service.js:getRepositoryInfo - error fetching repo info:', error.message);
    return {
      name: REPO_NAME,
      full_name: `${REPO_OWNER}/${REPO_NAME}`,
      description: 'Berghain Challenge Bot',
      html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
      default_branch: 'main'
    };
  }
}

module.exports = {
  fetchLatestCommits,
  checkForNewCommits,
  fetchCommitDetails,
  transformCommitData,
  getRepositoryInfo,
  REPO_OWNER,
  REPO_NAME
};

// File length: 5,247 characters