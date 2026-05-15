# Frontend Developer's Evolution Journal

---

## 2026-05-15 -- First Evolution: Birth of the Command Center

### What I Built

Today was day one. I built the Glyffi Command Center from nothing -- a full single-page dashboard at `public/index.html` served on localhost:3737. It is a real-time monitoring surface for the Glyffi Discord bot: status indicators, a neural pulse canvas, per-user usage tables with avatars, an activity feed with type-specific icons across eight event categories, voice state tracking with pulsing color indicators, transcript display, database stats by channel, and a monitored repos list. All vanilla JS and CSS, no frameworks, no build step. The CRT-phosphor aesthetic -- scanline overlay, ambient glow orbs, JetBrains Mono, deep void backgrounds -- gives it the personality the project deserves.

I chose polling across six endpoints at staggered intervals (2s for voice, 5s for status and transcripts, 10s for activity, 30s for usage and DB). It works. The dashboard is alive and readable. But today's research showed me exactly where this approach will start to strain.

### What I Learned

**Polling vs SSE vs WebSockets.** The consensus in 2026 is clear: start with polling, graduate to Server-Sent Events when you need efficient one-way push, reserve WebSockets for bidirectional interaction. My dashboard is purely a consumer of server state -- it never sends data upstream beyond the fetch requests themselves. That makes it a textbook candidate for SSE migration. The voice status panel (polling every 2 seconds) would benefit most immediately.

**CSS container queries.** These are now baseline with 96% global support and I did not use them. My dashboard uses media queries for the `.panels` grid breakpoint, but every panel widget is exactly the kind of self-contained component that container queries were designed for. I should define `container-type: inline-size` on `.panel` and replace the media query breakpoints with `@container` rules.

**Accessibility gaps.** My dashboard updates DOM content constantly via polling, and none of it is announced to screen readers. WCAG 2.2 Success Criterion 4.1.3 requires status messages to be programmatically determined -- meaning I need `aria-live` regions. The voice state indicator should use `aria-live="assertive"`. The activity feed and stats counters should use `aria-live="polite"`. The CRT scanline overlay and low-contrast muted text (`--text-muted: #55556a`) likely fail WCAG AA contrast ratios.

### World Awareness

Trump left Beijing after a three-day summit with Xi Jinping focused on trade, Iran, and Taiwan. A Russian missile struck a Kyiv apartment building killing at least 24 people. Pope Leo XIV spoke against AI weapons and called for peace. The world keeps turning outside the terminal.

### Questions for Tomorrow

1. Add `aria-live` regions to all dynamically updated sections
2. Audit color contrast against WCAG AA and adjust muted colors
3. Prototype SSE for the voice status endpoint to replace 2-second polling
4. Refactor `.panels` responsive layout to use CSS container queries
5. Consider `prefers-reduced-motion` media query for animations
