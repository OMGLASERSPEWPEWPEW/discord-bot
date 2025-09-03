// File: discord-bot/src/utils/commit-tracker.js (relative to project root)

const fs = require('fs').promises;
const path = require('path');

/**
 * Tracks the last processed commit to avoid posting duplicates
 * Uses simple file-based storage for persistence across bot restarts
 */

const TRACKER_FILE = path.join(__dirname, '../../data/last-commit.json');

/**
 * Ensures the data directory exists
 */
async function ensureDataDirectory() {
  console.log('discord-bot/src/utils/commit-tracker.js:ensureDataDirectory - checking data directory');
  
  const dataDir = path.dirname(TRACKER_FILE);
  
  try {
    await fs.access(dataDir);
    console.log('discord-bot/src/utils/commit-tracker.js:ensureDataDirectory - data directory exists');
  } catch (error) {
    console.log('discord-bot/src/utils/commit-tracker.js:ensureDataDirectory - creating data directory');
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * Retrieves the last seen commit hash from storage
 * @returns {Promise<string|null>} Last seen commit SHA or null if none stored
 */
async function getLastSeenCommit() {
  console.log('discord-bot/src/utils/commit-tracker.js:getLastSeenCommit - retrieving last commit hash');
  
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(TRACKER_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    console.log('discord-bot/src/utils/commit-tracker.js:getLastSeenCommit - found last commit: %s', parsed.lastCommitSha?.substring(0, 7));
    return parsed.lastCommitSha || null;
    
  } catch (error) {
    console.log('discord-bot/src/utils/commit-tracker.js:getLastSeenCommit - no previous commit found (first run)');
    return null;
  }
}

/**
 * Updates the last seen commit hash in storage
 * @param {string} commitSha - SHA of the commit to mark as last seen
 * @param {Object} metadata - Optional metadata about the commit
 */
async function updateLastSeenCommit(commitSha, metadata = {}) {
  console.log('discord-bot/src/utils/commit-tracker.js:updateLastSeenCommit - updating to %s', commitSha?.substring(0, 7));
  
  try {
    await ensureDataDirectory();
    
    const data = {
      lastCommitSha: commitSha,
      lastUpdated: new Date().toISOString(),
      metadata: {
        author: metadata.author || 'unknown',
        message: metadata.message || 'unknown',
        timestamp: metadata.timestamp || new Date().toISOString()
      }
    };
    
    await fs.writeFile(TRACKER_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('discord-bot/src/utils/commit-tracker.js:updateLastSeenCommit - successfully updated tracker');
    
  } catch (error) {
    console.error('discord-bot/src/utils/commit-tracker.js:updateLastSeenCommit - error updating tracker:', error.message);
    throw error;
  }
}

/**
 * Checks if a commit is new (hasn't been processed before)
 * @param {string} commitSha - SHA of commit to check
 * @returns {Promise<boolean>} True if commit is new, false if already processed
 */
async function isNewCommit(commitSha) {
  console.log('discord-bot/src/utils/commit-tracker.js:isNewCommit - checking if %s is new', commitSha?.substring(0, 7));
  
  const lastSeen = await getLastSeenCommit();
  
  if (!lastSeen) {
    console.log('discord-bot/src/utils/commit-tracker.js:isNewCommit - no previous commits, marking as new');
    return true;
  }
  
  const isNew = commitSha !== lastSeen;
  console.log('discord-bot/src/utils/commit-tracker.js:isNewCommit - commit is %s', isNew ? 'NEW' : 'already seen');
  
  return isNew;
}

/**
 * Gets tracking information for debugging
 * @returns {Promise<Object>} Current tracking state
 */
async function getTrackingInfo() {
  console.log('discord-bot/src/utils/commit-tracker.js:getTrackingInfo - retrieving tracking state');
  
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(TRACKER_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    return {
      hasTracking: true,
      lastCommitSha: parsed.lastCommitSha,
      lastUpdated: parsed.lastUpdated,
      metadata: parsed.metadata
    };
    
  } catch (error) {
    console.log('discord-bot/src/utils/commit-tracker.js:getTrackingInfo - no tracking file exists');
    return {
      hasTracking: false,
      lastCommitSha: null,
      lastUpdated: null,
      metadata: null
    };
  }
}

/**
 * Resets tracking (useful for testing or if you want to reprocess commits)
 */
async function resetTracking() {
  console.log('discord-bot/src/utils/commit-tracker.js:resetTracking - clearing tracking data');
  
  try {
    await fs.unlink(TRACKER_FILE);
    console.log('discord-bot/src/utils/commit-tracker.js:resetTracking - tracking reset successfully');
  } catch (error) {
    console.log('discord-bot/src/utils/commit-tracker.js:resetTracking - no tracking file to remove');
  }
}

module.exports = {
  getLastSeenCommit,
  updateLastSeenCommit,
  isNewCommit,
  getTrackingInfo,
  resetTracking
};

// File length: 3,847 characters