const { Decoder: OpusDecoder } = require('prism-media').opus;
const { writeFileSync, unlinkSync, mkdirSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const TMP_DIR = join(__dirname, '../../data/tmp');
mkdirSync(TMP_DIR, { recursive: true });

const SILENCE_TIMEOUT = 1500;
const MIN_CHUNKS = 50;

function downsample(pcmBuffer, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const newLength = Math.floor(pcmBuffer.length / (2 * ratio)) * 2;
  const result = Buffer.alloc(newLength);
  for (let i = 0, j = 0; i < newLength; i += 2, j += 2 * ratio) {
    const srcIdx = Math.floor(j / 2) * 2;
    if (srcIdx + 1 < pcmBuffer.length) {
      result[i] = pcmBuffer[srcIdx];
      result[i + 1] = pcmBuffer[srcIdx + 1];
    }
  }
  return result;
}

function writeWav(pcmBuffer, filePath) {
  const resampled = downsample(pcmBuffer, 48000, 16000);
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = resampled.length;
  const headerSize = 44;

  const header = Buffer.alloc(headerSize);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + headerSize - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  writeFileSync(filePath, Buffer.concat([header, resampled]));
}

const WHISPER_BIN = '/opt/homebrew/opt/whisper-cpp/bin/whisper-cli';
const MODEL_PATH = join(__dirname, '../../node_modules/whisper-node/dist/whisper/models/ggml-base.en.bin');

function transcribeFile(filePath) {
  try {
    const output = execFileSync(WHISPER_BIN, [
      '-m', MODEL_PATH,
      '-f', filePath,
      '-l', 'en',
      '--no-timestamps',
      '--no-prints',
    ], { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    const text = output.replace(/\[.*?\]/g, '').trim();
    if (!text || text === '(null)' || text.length < 2) return null;
    return text;
  } catch (err) {
    console.error('[stt] Whisper CLI error:', err.message?.slice(0, 200));
    return null;
  }
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
