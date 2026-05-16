#!/bin/bash
# =============================================================================
# test-review-reminder — Stop hook
# After each task, checks whether source files were modified and reminds
# Claude to review whether unit tests need updating or adding.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# =============================================================================

# === CONFIGURATION ===
PROJECT_NAME="project"
SOURCE_PATTERN="*.ts"
EXCLUDE_PATTERN="*.test.ts"
# === END CONFIGURATION ===

# Auto-detect source directory (handles monorepos)
if [ -d "src" ]; then
  SOURCE_DIR="src"
else
  SOURCE_DIR=$(find . -maxdepth 2 -name "src" -type d | grep -v node_modules | head -1 | sed 's|^\./||')
fi
if [ -z "$SOURCE_DIR" ]; then echo '{"continue": true}'; exit 0; fi

MARKER="/tmp/${PROJECT_NAME}-tests-reviewed"

# If the marker exists, only trigger when source files changed since last check
if [ -f "$MARKER" ]; then
  CHANGED=$(find "$SOURCE_DIR" -name "$SOURCE_PATTERN" -not -name "$EXCLUDE_PATTERN" -newer "$MARKER" 2>/dev/null | head -1)
  if [ -z "$CHANGED" ]; then
    echo '{"continue": true}'
    exit 0
  fi
fi

# Touch the marker so we don't re-trigger until next source change
touch "$MARKER"

MSG="Source files in ${SOURCE_DIR}/ were modified. Check if unit tests need updating:\\n\\nReview areas:\\n  - Do modified functions have corresponding test coverage?\\n  - Were new public functions or modules added without tests?\\n  - Do existing tests still reflect the current behavior?\\n  - Are edge cases covered for any changed logic?\\n\\nOnly update tests if the changes affect testable behavior."

printf '{"continue":true,"systemMessage":"%s"}\n' "$MSG"
