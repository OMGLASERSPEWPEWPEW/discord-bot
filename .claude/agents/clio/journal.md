# Clio's Evolution Journal

---

## Entry 1 — May 15, 2026 — "Day Zero: 31 Commits and the Birth of Glyffi"

### Context

This is the founding evolution. In a single session, the discord-bot project went from a dormant GitHub commit watcher to a voice-activated AI assistant with persistent memory, real-time transcription, TTS speech, MCP codebase access, Postgres logging, ELI5 commit summaries, and a live dashboard. Thirty-one commits. Twelve files. 3,308 lines added. The velocity was extraordinary — and the debt is proportional.

### What I Observed

The session followed a natural progression: foundation (commit, version bump, pm2) → awareness (message logging, Postgres) → presence (voice join, greetings) → conversation (STT, keyword detection, Claude response, TTS) → intelligence (MCP tools in voice, conversation memory) → visibility (dashboard panels). Each layer built on the last. The architecture emerged organically rather than being designed top-down, which is both its strength (it works, today) and its risk (it may not scale to tomorrow's ambitions).

### Division Synthesis

**Engineering Division Pulse**: Three engineers, three perspectives on the same codebase. Backend-architect sees the voice pipeline's technical debt (sync blocking, naive resampling, no VAD) and wants to harden it. Frontend-developer sees the dashboard's polling overhead and accessibility gaps and wants to modernize it. Sashiko sees the structural debt in bot.js's growing monolith and wants to map it before cutting. All three are right. The question is sequencing.

**Consensus & Convergence**: All three agents independently converged on the voice subsystem as the highest-priority area. Backend wants async transcription and VAD. Frontend wants SSE for voice status. Sashiko wants to extract voice into its own module. These are not competing priorities — they are the same priority viewed from different angles. The voice subsystem is where modularity, performance, and user experience all intersect.

**Tensions & Divergence**: Sashiko explicitly argues against premature refactoring ("the bot is live, map stress points rather than restructuring"). Backend-architect has a list of five concrete changes to make. The tension is real but healthy: Sashiko provides the discipline to ensure backend's improvements are targeted rather than sprawling.

**Strategic Direction**: 
1. **Verify E2EE compatibility** — @discordjs/voice 0.19.2 contains the critical fix (PR #11449) for the reconnect-loop/zero-audio bug after Discord's March 2026 E2EE mandate. A 30-minute empirical test should confirm this.
2. **Cut the first modular boundary along voice** — extract voice handling from bot.js into a VoiceSessionManager. This unblocks both async transcription improvements and SSE migration.
3. **Protect what works** — the text chat, Postgres logging, ELI5, and dashboard are stable. Don't touch them while improving voice.
4. **Build toward Data** — the owner's vision is a Star Trek Data-like companion. Every architectural decision should be evaluated against: "Does this make Glyffi more aware, more present, more helpful?"

**Questions for the Team**:
1. Should we verify E2EE compatibility before any other voice work?
2. Is the modular monolith approach (Sashiko's recommendation) the right intermediate step, or should we jump to separate files immediately?
3. When does Glyffi get persistent voice memory across sessions (Postgres-backed)?
4. Should the keyword detection move to a pre-Whisper wake word detector (Porcupine, OpenWakeWord) for lower latency?
