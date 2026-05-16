#!/bin/bash
# =============================================================================
# orchestrator-init — SessionStart hook
# Injects an orchestrator-first protocol so every user message is triaged
# by a named orchestrator agent before any other action.
#
# Hook type: SessionStart
# Lifecycle: Runs once at the beginning of each conversation
# =============================================================================

# === CONFIGURATION ===
ORCHESTRATOR_NAME="Orchestrator"
DELEGATION_MESSAGE="You MUST invoke ${ORCHESTRATOR_NAME} via Task tool as your FIRST action for EVERY user message — no exceptions. ${ORCHESTRATOR_NAME} triages: for simple asks it responds directly in 1-2 sentences; for complex work it analyzes scope and delegates to specialists. Do NOT respond to the user yourself before invoking ${ORCHESTRATOR_NAME}. Do NOT skip ${ORCHESTRATOR_NAME} for 'trivial' tasks — it decides what's trivial, not you."
# === END CONFIGURATION ===

cat << EOF
{
  "continue": true,
  "systemMessage": "${ORCHESTRATOR_NAME}-FIRST PROTOCOL (MANDATORY): ${DELEGATION_MESSAGE}"
}
EOF
exit 0
