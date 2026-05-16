#!/bin/bash
# =============================================================================
# context-window — Stop hook
# Estimates the current context window usage by reading the most recent API
# call's token counts from the transcript. Displays a green/yellow/red gauge
# and warns when the conversation is approaching the model's context limit.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# Requires: python3
# =============================================================================

hook_data=$(cat)

python3 - "$hook_data" << 'PYTHON'
import json, sys, os

# === CONFIGURATION ===
# Context window size for your model (in tokens)
CONTEXT_LIMIT = 200_000

# Thresholds (as fractions of CONTEXT_LIMIT)
WARN_AT = 0.70    # 70% — heads up, start planning
ALERT_AT = 0.85   # 85% — consider clearing the conversation
# === END CONFIGURATION ===

hook_data_raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
try:
    hook = json.loads(hook_data_raw)
    transcript_path = hook.get("transcript_path", "")
except Exception:
    transcript_path = ""

if not transcript_path or not os.path.exists(transcript_path):
    print('{"continue": true}')
    sys.exit(0)

# Find the most recent API call's token usage.
# The last message's (input_tokens + cache_read + cache_creation) approximates
# how much of the context window is currently occupied.
last_context = 0

try:
    with open(transcript_path, "r") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                if "message" in entry and isinstance(entry["message"], dict):
                    usage = entry["message"].get("usage", {})
                    if usage:
                        msg_input = usage.get("input_tokens", 0)
                        msg_cache_read = usage.get("cache_read_input_tokens", 0)
                        msg_cache_write = usage.get("cache_creation_input_tokens", 0)
                        last_context = msg_input + msg_cache_read + msg_cache_write
            except Exception:
                continue
except Exception:
    print('{"continue": true}')
    sys.exit(0)

if last_context == 0:
    print('{"continue": true}')
    sys.exit(0)

pct = last_context / CONTEXT_LIMIT
pct_display = f"{pct:.0%}"

def fmt_tok(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1000:
        return f"{n/1000:.0f}k"
    return str(n)

if pct >= ALERT_AT:
    indicator = "\U0001f534"  # red circle
    advice = "Consider clearing the conversation soon."
elif pct >= WARN_AT:
    indicator = "\U0001f7e1"  # yellow circle
    advice = "Getting full. Plan to wrap up or clear."
else:
    indicator = "\U0001f7e2"  # green circle
    advice = ""

msg = f"CONTEXT WINDOW {indicator} {pct_display} ({fmt_tok(last_context)} / {fmt_tok(CONTEXT_LIMIT)})"
if advice:
    msg += f" \u2014 {advice}"

escaped = json.dumps(f"CONTEXT: {msg}")
print(f'{{"continue": true, "systemMessage": {escaped}}}')
PYTHON
