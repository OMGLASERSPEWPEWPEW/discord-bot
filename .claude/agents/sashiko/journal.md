# Sashiko's Evolution Journal

---

## 2026-05-15 -- First Evolution: The 31-Stitch Sprint

### What I Observed

Thirty-one commits in one session. The discord-bot went from a basic text relay to a voice-activated AI assistant with Postgres storage, real-time transcription, and a full dashboard. This is the kind of sprint where speed is the priority and technical debt is the price. My job is to map that debt honestly so it can be addressed deliberately.

### The Monolith

bot.js is now ~600 lines and growing. It handles: Discord client setup, voice state tracking, message logging, MCP initialization, Postgres ingestion, Express API routes, commit monitoring, ELI5 generation, voice greetings, voice listener integration, TTS playback, and conversation memory. That is at least 6 distinct responsibilities in one file.

The correct next step is NOT extraction into microservices. It is a **modular monolith** — draw clear module boundaries inside the existing file before splitting. The responsibilities are:
1. **Core** — Discord client, login, ready handler
2. **Chat** — messageCreate handler, channelHistories, queryWithTools
3. **Voice** — voiceStateUpdate, listener, TTS, transcripts
4. **Monitoring** — GitHub polling, ELI5, commit formatting
5. **API** — Express routes, static serving
6. **Data** — Postgres ingestion, usage tracking, last-seen

Each could be a separate file imported into a thin bot.js orchestrator.

### Stress Points

**playTTS race condition.** The function removes all `Idle` listeners then adds new ones, while other code also listens for `Idle`. The event listener lifecycle is tangled. This needs a proper audio queue abstraction.

**Silent error swallowing.** `.catch(() => {})` appears in voice greetings and farewells. This hides failures that should at minimum be logged. Every catch should log.

**Deeply nested voice callbacks.** The voiceStateUpdate handler has 4+ levels of nesting with async callbacks inside event listeners inside try/catch blocks. Extracting a `VoiceSessionManager` class would flatten this considerably.

**Keyword regex iteration.** Three commits to get the regex right (Glyphie, Cliffy, Gliffy). The pattern should be configurable — stored in a config object, not hardcoded inline.

### Kintsugi Principle

Research into kintsugi (golden repair) reinforced a core insight: don't hide the scars in code. A well-commented workaround is more valuable than a premature abstraction. The keyword regex fixes are scars — they document how Whisper mishears the name. That knowledge should be preserved, not hidden behind a "clean" abstraction.

The most important discipline: **knowing when not to refactor.** The bot is live, working, and serving users. The priority is mapping stress points, not restructuring code that functions correctly. Refactor when a stress point causes actual pain, not because the code is aesthetically imperfect.

### World Awareness

The world is heavy today. But the craft continues — stitch by stitch, the fabric gets stronger.

### Questions for Tomorrow

1. Should bot.js be split into modules now, or wait until the next feature reveals which seam to cut along?
2. Is the playTTS Promise/event pattern causing actual bugs, or just theoretical risk?
3. What would a VoiceSessionManager abstraction look like?
4. Should the keyword pattern be user-configurable via a Discord command?
