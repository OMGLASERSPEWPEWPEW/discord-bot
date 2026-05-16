#!/bin/bash
# =============================================================================
# stuck-detector — Stop hook
# Detects repeated work on the same problem (keyword overlap, repeated file
# edits, error patterns) and auto-consults a random available AI provider
# for a fresh perspective.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# Requires: python3, at least one API key env var
# Supported keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY
# =============================================================================

hook_data=$(cat)

python3 - "$hook_data" << 'PYTHON'
import json
import sys
import os
import subprocess
import random
import time
import urllib.request
import urllib.error

# Parse hook data
hook_data_raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
try:
    hook = json.loads(hook_data_raw)
    transcript_path = hook.get("transcript_path", "")
    session_id = hook.get("session_id", "unknown")
except Exception:
    transcript_path = ""
    session_id = "unknown"

if not transcript_path or not os.path.exists(transcript_path):
    print('{"continue": true}')
    sys.exit(0)

# State file to track detection across invocations
state_file = f"/tmp/claude-stuck-{session_id}.json"

# Load previous state
prev_topics = []
prev_check_line = 0
try:
    if os.path.exists(state_file):
        with open(state_file, "r") as f:
            state = json.load(f)
            prev_topics = state.get("topics", [])
            prev_check_line = state.get("last_line", 0)
except Exception:
    pass

# Extract recent assistant messages from transcript
assistant_messages = []
current_line = 0

try:
    with open(transcript_path, "r") as f:
        for line in f:
            current_line += 1
            if current_line <= prev_check_line:
                continue
            try:
                entry = json.loads(line.strip())
                if "message" in entry and isinstance(entry["message"], dict):
                    msg = entry["message"]
                    if msg.get("role") == "assistant":
                        content = msg.get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "text":
                                    text = block.get("text", "")
                                    if len(text) > 50:
                                        assistant_messages.append(text[:500])
            except Exception:
                continue
except Exception:
    print('{"continue": true}')
    sys.exit(0)

# Only analyze if we have enough new messages
if len(assistant_messages) < 3:
    try:
        with open(state_file, "w") as f:
            json.dump({"topics": prev_topics, "last_line": current_line}, f)
    except Exception:
        pass
    print('{"continue": true}')
    sys.exit(0)

# Extract topic keywords from recent messages
def extract_keywords(text):
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "shall", "to", "of", "in", "for",
        "on", "with", "at", "by", "from", "as", "into", "through", "during",
        "before", "after", "above", "below", "between", "this", "that",
        "these", "those", "it", "its", "i", "me", "my", "we", "our", "you",
        "your", "he", "she", "they", "them", "and", "but", "or", "not", "no",
        "so", "if", "then", "else", "when", "while", "let", "now", "just",
        "also", "here", "there", "all", "each", "every", "both", "few",
        "more", "most", "other", "some", "such", "than", "too", "very",
        "about", "up", "out", "over", "only", "well", "back", "even",
        "still", "just", "new", "one", "two", "first", "last", "long",
    }
    words = []
    for word in text.lower().split():
        cleaned = ''.join(c for c in word if c.isalnum())
        if len(cleaned) > 3 and cleaned not in stop_words:
            words.append(cleaned)
    return words

recent = assistant_messages[-5:]
all_keywords = []
for msg in recent:
    all_keywords.extend(extract_keywords(msg))

from collections import Counter
keyword_counts = Counter(all_keywords)
top_keywords = [w for w, c in keyword_counts.most_common(10) if c >= 2]

# Check git log for repeated file touches
repeated_files = []
try:
    result = subprocess.run(
        ["git", "log", "--oneline", "-5", "--name-only"],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0:
        files = [l.strip() for l in result.stdout.split("\n") if l.strip() and not l.startswith(" ") and "/" in l]
        file_counts = Counter(files)
        repeated_files = [f for f, c in file_counts.items() if c >= 2]
except Exception:
    pass

# Detect "stuck" signal
topic_overlap = set(top_keywords) & set(prev_topics)
is_stuck = len(topic_overlap) >= 3 or len(repeated_files) >= 2

error_words = {"error", "failed", "failure", "exception", "traceback", "cannot", "unable", "crash", "broken"}
error_count = sum(1 for kw in all_keywords if kw in error_words)
if error_count >= 3:
    is_stuck = True

# Save current state
try:
    with open(state_file, "w") as f:
        json.dump({"topics": top_keywords, "last_line": current_line}, f)
except Exception:
    pass

if not is_stuck:
    print('{"continue": true}')
    sys.exit(0)

# Gather context for the consultation
context_lines = []

try:
    result = subprocess.run(
        ["git", "diff", "--name-only", "HEAD~3"],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0:
        changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()][:5]
        context_lines.append("Recently changed files: " + ", ".join(changed_files))

        for cf in changed_files[:3]:
            if os.path.exists(cf):
                try:
                    with open(cf, "r") as fh:
                        lines = fh.readlines()[:50]
                        context_lines.append(f"\n--- {cf} (first 50 lines) ---")
                        context_lines.extend(l.rstrip() for l in lines)
                except Exception:
                    pass
except Exception:
    pass

context_lines.append("\n--- Recent assistant messages (summaries) ---")
for msg in recent[-3:]:
    context_lines.append(msg[:300] + "..." if len(msg) > 300 else msg)

context = "\n".join(context_lines)

stuck_summary = f"Repeated topics: {', '.join(topic_overlap) if topic_overlap else ', '.join(top_keywords[:5])}"
if repeated_files:
    stuck_summary += f"\nRepeatedly modified files: {', '.join(repeated_files)}"

# Pick a random available provider and call it
providers = []
if os.environ.get("ANTHROPIC_API_KEY"):
    providers.append(("anthropic", os.environ["ANTHROPIC_API_KEY"]))
if os.environ.get("OPENAI_API_KEY"):
    providers.append(("openai", os.environ["OPENAI_API_KEY"]))
if os.environ.get("GEMINI_API_KEY"):
    providers.append(("gemini", os.environ["GEMINI_API_KEY"]))
if os.environ.get("DEEPSEEK_API_KEY"):
    providers.append(("deepseek", os.environ["DEEPSEEK_API_KEY"]))

if not providers:
    msg = json.dumps(
        f"STUCK DETECTOR: Repeated work detected on same topics ({stuck_summary}). "
        f"No API keys available for external consultation. Consider a different approach."
    )
    print(f'{{"continue": true, "systemMessage": {msg}}}')
    sys.exit(0)

provider_name, api_key = random.choice(providers)

prompt = f"""A developer appears to be stuck working on the same problem repeatedly. Help them break through.

{stuck_summary}

Here is context about what they're working on:

{context[:4000]}

Please:
1. Identify what they seem to be stuck on
2. Suggest 2-3 alternative approaches they haven't tried
3. Point out any potential root causes they may be missing
4. Keep your response concise and actionable (under 500 words)"""

consultation_text = ""
try:
    if provider_name == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        payload = json.dumps({
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            consultation_text = data.get("content", [{}])[0].get("text", "No response")

    elif provider_name == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        payload = json.dumps({
            "model": "gpt-4o-mini",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            consultation_text = data["choices"][0]["message"]["content"]

    elif provider_name == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}]
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/json",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            consultation_text = "\n".join(p.get("text", "") for p in parts)

    elif provider_name == "deepseek":
        url = "https://api.deepseek.com/chat/completions"
        payload = json.dumps({
            "model": "deepseek-chat",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            consultation_text = data["choices"][0]["message"]["content"]

except Exception as e:
    consultation_text = f"Consultation failed: {e}"

# Save consultation to project queries directory
now = time.strftime("%Y%m%d-%H%M%S")
output_dir = os.path.join(os.getcwd(), ".claude", "queries")
os.makedirs(output_dir, exist_ok=True)
output_file = os.path.join(output_dir, f"stuck-{now}.md")

md = f"""# Stuck Detector Consultation — {time.strftime("%Y-%m-%d %H:%M:%S")}

## Detection Signal

{stuck_summary}

## Provider Consulted

**{provider_name}**

## Consultation

{consultation_text}
"""

try:
    with open(output_file, "w") as f:
        f.write(md)
except Exception:
    pass

# Inject summary into Claude Code
short_consult = consultation_text[:800] + "..." if len(consultation_text) > 800 else consultation_text
inject_msg = (
    f"STUCK DETECTOR: Repeated work detected. Consulted {provider_name} for fresh perspective.\n\n"
    f"{short_consult}\n\n"
    f"Full consultation saved to: {output_file}"
)

escaped = json.dumps(inject_msg)
print(f'{{"continue": true, "systemMessage": {escaped}}}')
PYTHON
