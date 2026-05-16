#!/bin/bash
# =============================================================================
# test-runner — Stop hook
# After each task, runs the project's test suite if test files exist.
# Outputs the tail of the test results for quick feedback.
#
# Hook type: Stop
# Lifecycle: Runs after every agent response
# =============================================================================

# === CONFIGURATION ===
TEST_GLOB="*.test.ts"
OUTPUT_LINES=30
# === END CONFIGURATION ===

# Auto-detect source directory (handles monorepos)
if [ -d "src" ]; then
  SOURCE_DIR="src"
else
  SOURCE_DIR=$(find . -maxdepth 2 -name "src" -type d | grep -v node_modules | head -1 | sed 's|^\./||')
fi
if [ -z "$SOURCE_DIR" ]; then echo '{"continue": true}'; exit 0; fi

# Auto-detect test command
if [ -f "package.json" ]; then
  TEST_COMMAND="npm test"
else
  PKG_DIR=$(find . -maxdepth 2 -name "package.json" ! -path "*/node_modules/*" | head -1 | xargs dirname | sed 's|^\./||')
  [ -n "$PKG_DIR" ] && TEST_COMMAND="npm --prefix $PKG_DIR test" || TEST_COMMAND="npm test"
fi

# Check if any test files exist before running
TEST_FILES=$(find "$SOURCE_DIR" -name "$TEST_GLOB" 2>/dev/null | head -1)
if [ -z "$TEST_FILES" ]; then
  echo '{"continue": true}'
  exit 0
fi

RESULTS=$($TEST_COMMAND 2>&1 | tail -"$OUTPUT_LINES")
ESCAPED=$(echo "$RESULTS" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
printf '{"continue":true,"systemMessage":"[Hook: Test Results]\\n%s"}\n' "$(echo "$ESCAPED" | sed 's/^"//;s/"$//' )"
