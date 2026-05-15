function createEli5Embed(eli5Text, commit, repoName, version) {
  return {
    color: 0x5865F2,
    title: `What's New in ${repoName}?`,
    description: eli5Text,
    fields: [{
      name: 'The Nerdy Details',
      value: `\`${commit.sha.substring(0, 7)}\` ${commit.message.split('\n')[0].substring(0, 80)}`,
      inline: false
    }],
    footer: {
      text: `v${version} | ELI5 by Glyffi`
    },
    timestamp: commit.timestamp || new Date().toISOString()
  };
}

module.exports = { createEli5Embed };
