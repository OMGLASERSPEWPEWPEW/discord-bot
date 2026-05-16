#!/bin/bash
# =============================================================================
# docs-review-reminder — Stop hook
# After each task, checks whether source files were modified and reminds
# Claude to review project documentation for needed updates.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# =============================================================================

# === CONFIGURATION ===
PROJECT_NAME="project"
SOURCE_PATTERN="*.ts"
EXCLUDE_PATTERN="*.test.ts"
DOC_FILES="CLAUDE.md"
# === END CONFIGURATION ===

# Auto-detect source directory (handles monorepos)
if [ -d "src" ]; then
  SOURCE_DIR="src"
else
  SOURCE_DIR=$(find . -maxdepth 2 -name "src" -type d | grep -v node_modules | head -1 | sed 's|^\./||')
fi
if [ -z "$SOURCE_DIR" ]; then echo '{"continue": true}'; exit 0; fi

MARKER="/tmp/${PROJECT_NAME}-docs-reviewed"

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

# Build a display list of doc files to check
DOC_LIST=""
IFS=',' read -ra DOC_ARRAY <<< "$DOC_FILES"
for doc in "${DOC_ARRAY[@]}"; do
  trimmed=$(echo "$doc" | xargs)
  DOC_LIST="${DOC_LIST}  - ${trimmed}\n"
done

MSG="Source files in ${SOURCE_DIR}/ were modified. Check if project documentation needs updating:\\n$(echo -e "$DOC_LIST")\\nReview areas:\\n  - Module descriptions and file listings\\n  - Architecture and data flow documentation\\n  - Configuration and environment variable references\\n  - API or interface changes\\n  - New dependencies or removed code\\n\\nOnly update docs if the changes are meaningful."

printf '{"continue":true,"systemMessage":"%s"}\n' "$MSG"
