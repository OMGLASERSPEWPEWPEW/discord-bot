const { Decoder: OpusDecoder } = require('prism-media').opus;
const { writeFileSync, unlinkSync, mkdirSync } = require('fs');
const { join } = require('path');
const { execFile } = require('child_process');

const TMP_DIR = join(__dirname, '../../data/tmp');
mkdirSync(TMP_DIR, { recursive: true });

const SILENCE_TIMEOUT = 1500;
const MIN_CHUNKS = 50;

const ffmpegPath = require('ffmpeg-static');
const { execFileSync } = require('child_process');

function writeWav(pcmBuffer, filePath) {
  const rawPath = filePath + '.raw';
  writeFileSync(rawPath, pcmBuffer);
  try {
    execFileSync(ffmpegPath, [
      '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', rawPath,
      '-ar', '16000', '-ac', '1', '-y', filePath
    ], { timeout: 10000, stdio: 'pipe' });
  } finally {
    try { unlinkSync(rawPath); } catch {}
  }
}

const WHISPER_BIN = '/opt/homebrew/opt/whisper-cpp/bin/whisper-cli';
const MODEL_PATH = join(__dirname, '../../node_modules/whisper-node/dist/whisper/models/ggml-base.en.bin');

function transcribeFile(filePath) {
  return new Promise(resolve => {
    execFile(WHISPER_BIN, [
      '-m', MODEL_PATH,
      '-f', filePath,
      '-l', 'en',
      '--no-timestamps',
      '--no-prints',
    ], { encoding: 'utf-8', timeout: 30000 }, (err, stdout) => {
      if (err) {
        console.error('[stt] Whisper CLI error:', err.message?.slice(0, 200));
        return resolve(null);
      }
      const text = stdout.replace(/\[.*?\]/g, '').trim();
      if (!text || text === '(null)' || text.length < 2) return resolve(null);
      resolve(text);
    });
  });
}

function startListening(connection, userId, channel, onTranscript) {
  const receiver = connection.receiver;
  let listening = true;
  let audioChunks = [];
  let silenceTimer = null;
  let processing = false;

  const opusStream = receiver.subscribe(userId, {
    end: { behavior: 'manual' }
  });

  const decoder = new OpusDecoder({ rate: 48000, channels: 1, frameSize: 960 });
  opusStream.pipe(decoder);

  decoder.on('data', (pcm) => {
    if (!listening || processing) return;
    audioChunks.push(pcm);

    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(async () => {
      if (processing) return;
      if (audioChunks.length < MIN_CHUNKS) {
        audioChunks = [];
        return;
      }

      processing = true;
      listening = false;
      const buffer = Buffer.concat(audioChunks);
      audioChunks = [];

      const wavPath = join(TMP_DIR, `voice_${Date.now()}.wav`);
      try {
        writeWav(buffer, wavPath);
        const sizeKB = (buffer.length / 1024).toFixed(0);
        const durationSec = (buffer.length / (48000 * 2)).toFixed(1);
        console.log(`[stt] Transcribing ${sizeKB}KB (~${durationSec}s) audio...`);
        const statusMsg = await channel.send(`-# 🎤 Processing ${durationSec}s of audio...`).catch(() => null);
        const transcript = await transcribeFile(wavPath);
        if (transcript) {
          console.log(`[stt] Transcript: "${transcript}"`);
          if (statusMsg) await statusMsg.edit(`-# 🎤 Heard: "${transcript}"`).catch(() => {});
          await onTranscript(transcript);
        } else {
          if (statusMsg) await statusMsg.edit(`-# 🎤 Couldn't make that out`).catch(() => {});
        }
      } catch (err) {
        console.error('[stt] Processing error:', err.message);
      } finally {
        try { unlinkSync(wavPath); } catch {}
        processing = false;
        listening = true;
      }
    }, SILENCE_TIMEOUT);
  });

  decoder.on('error', (err) => {
    console.error('[stt] Decoder error:', err.message);
  });

  opusStream.on('error', (err) => {
    console.error('[stt] Opus stream error:', err.message);
  });

  console.log(`[stt] Listening to user ${userId}`);

  return {
    pause: () => { listening = false; },
    resume: () => { listening = true; processing = false; },
    stop: () => {
      listening = false;
      if (silenceTimer) clearTimeout(silenceTimer);
      opusStream.destroy();
      decoder.destroy();
      console.log(`[stt] Stopped listening`);
    }
  };
}

module.exports = { startListening };
