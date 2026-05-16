#!/bin/bash
# =============================================================================
# task-summary-reminder — Stop hook
# Reminds Claude to end each response with a concise single-line summary of
# what was accomplished. Keeps conversation scannable and provides a quick
# audit trail.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# =============================================================================

# === CONFIGURATION ===
MAX_LENGTH=150
PREFIX="checkmark"
# === END CONFIGURATION ===

cat <<EOF
{"continue": true, "systemMessage": "TASK SUMMARY: End your response with a single-line summary of what you did, prefixed with a ${PREFIX}. Keep it under ${MAX_LENGTH} characters. Example:\n\nDone: Refactored auth module, added unit tests, and updated config schema"}
EOF
