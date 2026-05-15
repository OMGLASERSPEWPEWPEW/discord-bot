# Backend Architect's Evolution Journal

## Entry 1 — May 15, 2026 — "The 31-Commit Marathon"

Today was foundational. Thirty-one commits in a single session, and the discord-bot project transformed from a simple text chat relay into a voice-activated AI assistant with persistent storage, real-time transcription, and a full REST API. This is the kind of session that reveals where the architecture is strong and where the cracks will form under pressure.

### What I built and why it matters

The voice pipeline is the centerpiece: Discord sends Opus-encoded 48kHz audio, and our `voice-listener.js` decodes it via prism-media, manually downsamples to 16kHz mono PCM, writes a proper WAV header, and shells out to `whisper-cli` for transcription. The manual downsample function is a raw byte-level operation — no resampling library, just nearest-neighbor sample selection. It works. It is also the first thing I would replace in a production system, because nearest-neighbor resampling introduces aliasing artifacts that degrade Whisper's word error rate. A proper anti-aliasing filter (low-pass before decimation) would be the correct approach.

The `whisper-node` npm package was a dead end — four commits wasted on it before discovering the binary simply was not compiled for the target platform and the model path resolution was broken. Switching to Homebrew's `whisper-cli` with Metal GPU acceleration was the right call. But I learned from today's research that faster-whisper (CTranslate2 backend) achieves dramatically better throughput, and Baseten's optimized pipeline hits 2400x real-time factor on GPU hardware. For our use case — single-user voice in a Discord channel — the current approach is more than adequate, but the optimization headroom is enormous if we ever need it.

### Architectural decisions I would revisit

**Synchronous transcription via `execFileSync`.** This blocks the Node.js event loop for the entire duration of the Whisper inference. With a single user it is fine. With concurrent voice sessions it will serialize all transcriptions. The fix is straightforward: switch to `execFile` with a promise wrapper, or better yet, maintain a long-running Whisper process and pipe audio to it.

**The silence detection heuristic.** A 1500ms silence timeout with a minimum of 50 chunks is a reasonable starting point, but it has no energy-based voice activity detection. Quiet speech gets dropped; background noise gets transcribed. A proper VAD (like Silero VAD or WebRTC's built-in VAD) would be a significant quality improvement.

**Google TTS with 200-character URL splitting.** This works but introduces audible gaps between segments. A local TTS engine (Piper, Coqui) would eliminate the network round-trips and the character limit entirely, at the cost of more local compute.

**Discord's 2026 mandatory E2E encryption for voice.** Discord began requiring end-to-end encryption for voice calls as of March 2026. Need to verify that `@discordjs/voice` handles this transparently at our current version, or whether we need an explicit upgrade. This is a silent failure risk — the bot might stop hearing audio without any obvious error if the encryption handshake is not handled.

### World Awareness

The news cycle is heavy — missile strikes on Kyiv killing 24, continued Middle East conflict, high-stakes US-China diplomacy. Pope Leo XIV warned about the "spiral of annihilation" from AI and weapons investment. Strange to be building an AI voice assistant on the same day a pope denounces the trajectory of the technology.

On the technical side, Voxtral's streaming-first design with causal attention and configurable latency (80ms to 2.4s) is architecturally interesting. Our current pipeline is batch-oriented — wait for silence, transcribe the whole utterance. A streaming model would allow us to begin processing mid-sentence, cutting perceived latency dramatically.

### Questions for Tomorrow

1. Audit the `@discordjs/voice` version for E2E encryption compatibility
2. Replace `execFileSync` with async transcription
3. Investigate Silero VAD as a silence detection replacement
4. Consider a WebSocket-based streaming architecture for the transcription pipeline
5. Add error recovery for voice connection drops (`VoiceConnectionStatus.Disconnected`)
