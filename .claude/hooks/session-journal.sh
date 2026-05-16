#!/bin/bash
# =============================================================================
# session-journal — Multi-lifecycle hook
# Stamps a per-session journal in .claude/journals/<session_id>.md tracking
# tool usage, state transitions, and session lifecycle events.
#
# Hook type: PreToolUse, PostToolUse, Notification, SessionStart, Stop
# Lifecycle: Runs on every lifecycle event
# Requires: python3
# =============================================================================

hook_data=$(cat)

python3 - "$hook_data" << 'PYTHON'
import json, os, re, sys
from datetime import datetime

raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
try:
    hook = json.loads(raw)
except Exception:
    hook = {}

event = hook.get("hook_event_name") or "unknown"

def emit():
    if event == "Stop":
        print(json.dumps({"continue": True}))
    elif event == "PreToolUse":
        print(json.dumps({"decision": "allow"}))

try:
    session_id = hook.get("session_id") or "unknown"
    tool_name = hook.get("tool_name") or ""
    cwd = hook.get("cwd") or os.getcwd()
    transcript = hook.get("transcript_path") or ""

    safe_session = re.sub(r"[^A-Za-z0-9_-]", "_", str(session_id))[:64]
    journals_dir = os.path.join(cwd, ".claude", "journals")
    os.makedirs(journals_dir, exist_ok=True)
    path = os.path.join(journals_dir, f"{safe_session}.md")

    now = datetime.now().isoformat(timespec="seconds")

    if event == "SessionStart":
        state = "starting"
    elif event == "PreToolUse":
        state = f"awaiting:{tool_name}" if tool_name else "awaiting"
    elif event == "PostToolUse":
        state = "running"
    elif event == "Notification":
        state = "notify"
    elif event == "Stop":
        state = "idle"
    elif event == "SessionEnd":
        state = "ended"
    else:
        state = event.lower()

    line = f"- {now} [{event}] state={state}"
    if tool_name:
        line += f" tool={tool_name}"
    if transcript:
        line += f" transcript={os.path.basename(transcript)}"

    header = ""
    if not os.path.exists(path):
        header = (
            f"---\n"
            f"session_id: {session_id}\n"
            f"pid: {os.getpid()}\n"
            f"cwd: {cwd}\n"
            f"started_at: {now}\n"
            f"---\n\n"
        )

    with open(path, "a") as f:
        if header:
            f.write(header)
        f.write(line + "\n")
except Exception:
    pass

emit()
PYTHON
