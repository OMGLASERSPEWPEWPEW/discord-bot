const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const { startListening } = require('../services/voice-listener');
const { DARKLIGHT_ID, GLYFFI_PATTERN, VOICE_SYSTEM_PROMPT, PORT } = require('../config');
const { anthropic, recordUsage, formatCost, logActivity, logTranscript, setVoiceStatus, queryWithTools } = require('../shared');

let activeListener = null;
let voiceHistory = [];

function playTTS(player, text) {
  const cleanText = text.replace(/[^\w\s.,!?'-]/g, '');
  const urls = googleTTS.getAllAudioUrls(cleanText, { lang: 'en', slow: false });
  let index = 0;

  function playNext() {
    if (index >= urls.length) return;
    const resource = createAudioResource(urls[index].url);
    player.play(resource);
    index++;
  }

  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.on(AudioPlayerStatus.Idle, playNext);
  playNext();

  return new Promise(resolve => {
    const origListener = () => {
      if (index >= urls.length) {
        player.removeListener(AudioPlayerStatus.Idle, origListener);
        resolve();
      }
    };
    player.on(AudioPlayerStatus.Idle, origListener);
    if (urls.length === 0) resolve();
  });
}

function register(client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.id !== DARKLIGHT_ID) return;

    const joined = !oldState.channelId && newState.channelId;
    const left = oldState.channelId && !newState.channelId;
    const switched = oldState.channelId && newState.channelId
                     && oldState.channelId !== newState.channelId;

    if (joined || switched) {
      const channel = newState.channel;
      let connection;
      try {
        connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        });
        setVoiceStatus({ connected: true, channel: channel.name, state: 'greeting' });
        console.log(`[voice] Joined ${channel.name}`);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          console.log('[voice] Disconnected — attempting reconnect...');
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
            console.log('[voice] Reconnecting...');
          } catch {
            console.log('[voice] Reconnect failed — destroying connection');
            connection.destroy();
            if (activeListener) { activeListener.stop(); activeListener = null; }
            setVoiceStatus({ connected: false, channel: null, state: 'idle' });
          }
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
          console.log('[voice] Connection destroyed');
          setVoiceStatus({ connected: false, channel: null, state: 'idle' });
        });
      } catch (err) {
        console.error('[voice] Failed to join voice channel:', err.message);
      }

      try {
        const greeting = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: 'You are Glyffi, a friendly Discord bot. Generate a short, unique greeting (1-2 sentences) for DarkLight who just joined a voice channel. Be warm, playful, and vary your style. Use an emoji or two. Do NOT use emoji in the text — it will be spoken aloud.',
          messages: [{ role: 'user', content: `DarkLight just joined the "${channel.name}" voice channel.` }]
        });
        const text = greeting.content[0].text;
        const voiceCost = recordUsage(greeting.usage.input_tokens, greeting.usage.output_tokens, 'Glyffi-Voice', channel.id);
        const totalTokens = greeting.usage.input_tokens + greeting.usage.output_tokens;
        await channel.send(text + `\n-# ${formatCost(voiceCost.cost)} | ${totalTokens.toLocaleString()} tokens\n-# 📊 Dashboard: http://localhost:${PORT}`);
        logActivity('voice-join', { user: 'DarkLight', channel: channel.name });
        console.log(`[voice] Greeted DarkLight in #${channel.name}`);

        if (connection) {
          const player = createAudioPlayer();
          connection.subscribe(player);
          console.log(`[voice] Playing TTS greeting in ${channel.name}`);
          await playTTS(player, text);
          console.log(`[voice] TTS playback finished`);
          setVoiceStatus({ connected: true, channel: channel.name, state: 'listening' });

          if (activeListener) activeListener.resume();
          else {
            activeListener = startListening(connection, DARKLIGHT_ID, channel, async (transcript) => {
              if (!GLYFFI_PATTERN.test(transcript)) {
                console.log(`[stt] No keyword, ignoring: "${transcript.slice(0, 80)}"`);
                return;
              }
              const query = transcript.replace(GLYFFI_PATTERN, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
              if (!query) return;
              console.log(`[voice] Processing query: "${query}"`);
              setVoiceStatus({ connected: true, channel: channel.name, state: 'thinking' });
              logTranscript('heard', transcript, query, null);
              activeListener.pause();
              const thinkingMsg = await channel.send(`-# 💭 Thinking about: "${query.slice(0, 80)}"`).catch(() => null);

              try {
                const voiceResp = await queryWithTools(query, VOICE_SYSTEM_PROMPT, 300, 'voice-query', voiceHistory);
                if (thinkingMsg) await thinkingMsg.delete().catch(() => {});
                const reply = voiceResp.text || "I looked into it but couldn't form a clear answer.";
                const vcost = recordUsage(voiceResp.totalInput, voiceResp.totalOutput, 'Glyffi-Voice', channel.id);
                const vtokens = voiceResp.totalInput + voiceResp.totalOutput;
                await channel.send(reply + `\n-# ${formatCost(vcost.cost)} | ${vtokens.toLocaleString()} tokens | ${voiceResp.rounds} tool rounds`);
                logActivity('voice-reply', { user: 'DarkLight', channel: channel.name, query: query.slice(0, 80), rounds: voiceResp.rounds });

                setVoiceStatus({ connected: true, channel: channel.name, state: 'speaking' });
                logTranscript('response', reply, query, vcost.cost);
                console.log(`[voice] Playing response TTS`);
                activeListener.pause();
                await playTTS(player, reply);
                console.log(`[voice] Response TTS finished`);
                setVoiceStatus({ connected: true, channel: channel.name, state: 'listening' });
                activeListener.resume();
              } catch (err) {
                console.error('[voice] Voice response failed:', err.message);
                activeListener.resume();
              }
            });
          }

          player.on('error', err => {
            console.error('[voice] TTS playback error:', err.message);
          });
        }
      } catch (err) {
        console.error('[voice] greeting failed:', err.message);
        await channel.send('Hey DarkLight! 👋').catch(e => console.error('[voice] fallback greeting failed:', e.message));
      }
    }

    if (left) {
      const channel = oldState.channel;
      if (activeListener) { activeListener.stop(); activeListener = null; }
      voiceHistory = [];
      setVoiceStatus({ connected: false, channel: null, state: 'idle' });
      try {
        const connection = getVoiceConnection(oldState.guild.id);
        if (connection) connection.destroy();
        console.log(`[voice] Left ${channel.name}`);
      } catch (err) {
        console.error('[voice] Failed to leave voice channel:', err.message);
      }
      try {
        const farewell = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          system: 'You are Glyffi, a friendly Discord bot. Generate a short farewell (1 sentence) for DarkLight who just left a voice channel. Be warm and brief. One emoji.',
          messages: [{ role: 'user', content: `DarkLight just left the "${channel.name}" voice channel.` }]
        });
        const farewellCost = recordUsage(farewell.usage.input_tokens, farewell.usage.output_tokens, 'Glyffi-Voice', channel.id);
        const farewellTokens = farewell.usage.input_tokens + farewell.usage.output_tokens;
        await channel.send(farewell.content[0].text + `\n-# ${formatCost(farewellCost.cost)} | ${farewellTokens.toLocaleString()} tokens`);
        logActivity('voice-leave', { user: 'DarkLight', channel: channel.name });
        console.log(`[voice] Said bye to DarkLight in #${channel.name}`);
      } catch (err) {
        await channel.send('Later, DarkLight ✌️').catch(e => console.error('[voice] fallback farewell failed:', e.message));
      }
    }
  });
}

module.exports = { register };
