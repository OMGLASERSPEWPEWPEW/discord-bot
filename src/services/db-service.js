const { Pool } = require('pg');

const pool = new Pool({
  database: process.env.PGDATABASE || 'glyffi',
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || process.env.USER,
});

function tableName(channelId, channelName, isDM) {
  const safe = channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const prefix = isDM ? 'dm' : 'ch';
  return `${prefix}_${safe}_${channelId.slice(-6)}`;
}

async function ensureChannelTable(channelId, channelName, isDM = false) {
  const table = tableName(channelId, channelName, isDM);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      message_id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      author_id TEXT NOT NULL,
      is_bot BOOLEAN DEFAULT false,
      content TEXT,
      embeds JSONB,
      attachments JSONB,
      timestamp TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  return table;
}

async function getLatestMessageId(table) {
  const res = await pool.query(
    `SELECT message_id FROM ${table} ORDER BY timestamp DESC LIMIT 1`
  );
  return res.rows[0]?.message_id || null;
}

async function insertMessage(table, msg) {
  await pool.query(
    `INSERT INTO ${table} (message_id, author, author_id, is_bot, content, embeds, attachments, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_id) DO NOTHING`,
    [
      msg.id,
      msg.author.displayName || msg.author.username,
      msg.author.id,
      msg.author.bot || false,
      msg.content || null,
      msg.embeds.length > 0 ? JSON.stringify(msg.embeds.map(e => ({
        title: e.title, description: e.description, color: e.color,
        fields: e.fields, footer: e.footer?.text, url: e.url
      }))) : null,
      msg.attachments.size > 0 ? JSON.stringify(msg.attachments.map(a => ({
        name: a.name, url: a.url, contentType: a.contentType, size: a.size
      }))) : null,
      msg.createdAt
    ]
  );
}

async function ingestChannel(channel) {
  const table = await ensureChannelTable(channel.id, channel.name);
  const latestId = await getLatestMessageId(table);

  let total = 0;

  if (latestId) {
    let options = { limit: 100, after: latestId };
    let batch;
    do {
      batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;
      const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const msg of sorted) {
        await insertMessage(table, msg);
        total++;
      }
      options.after = sorted[sorted.length - 1].id;
    } while (batch.size === 100);
  } else {
    let options = { limit: 100 };
    let allMessages = [];
    let batch;
    do {
      batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;
      allMessages.push(...batch.values());
      options.before = batch.last().id;
    } while (batch.size === 100);

    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const msg of allMessages) {
      await insertMessage(table, msg);
      total++;
    }
  }

  return { table, ingested: total };
}

async function ingestAllChannels(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== 0 && channel.type !== 2) continue;
      try {
        const result = await ingestChannel(channel);
        console.log(`[db] #${channel.name} → ${result.table}: ${result.ingested} new messages`);
        results.push({ channel: channel.name, ...result });
      } catch (err) {
        console.error(`[db] #${channel.name} ingest failed: ${err.message}`);
        results.push({ channel: channel.name, error: err.message });
      }
    }
  }
  return results;
}

async function logMessage(msg) {
  try {
    const isDM = msg.channel.type === 1;
    const name = isDM ? msg.author.username : msg.channel.name;
    const table = await ensureChannelTable(msg.channel.id, name, isDM);
    await insertMessage(table, msg);
  } catch (err) {
    const label = msg.channel.type === 1 ? `DM:${msg.author.username}` : `#${msg.channel.name}`;
    console.error(`[db] failed to log message in ${label}: ${err.message}`);
  }
}

async function getStats() {
  const res = await pool.query(`
    SELECT table_name,
           (xpath('/row/cnt/text()', xml_count))[1]::text::int AS row_count
    FROM (
      SELECT table_name,
             query_to_xml('SELECT count(*) AS cnt FROM ' || table_name, false, true, '') AS xml_count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'ch_%'
    ) t
    ORDER BY table_name
  `);
  return res.rows;
}

module.exports = { pool, ingestAllChannels, logMessage, ensureChannelTable, getStats };
