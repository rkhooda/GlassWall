#!/usr/bin/env bash
# CI grep - asserts forbidden tokens are absent from executor sources
# This enforces PLAN.md §14.3: no eval, Function, innerHTML, insertAdjacentHTML, or model-supplied selectors

set -euo pipefail

EXECUTOR_DIR="apps/extension/src/content/executor"

echo "Checking for forbidden tokens in $EXECUTOR_DIR..."

# Forbidden tokens that must not appear in the execution path
FORBIDDEN=(
  "eval"
  "Function"
  "innerHTML"
  "insertAdjacentHTML"
  "outerHTML"
  "document.write"
  "document.writeln"
  "setTimeout.*string"
  "setInterval.*string"
  "execScript"
)

FAILED=0

for token in "${FORBIDDEN[@]}"; do
  if grep -r -n --include="*.ts" --include="*.tsx" "$token" "$EXECUTOR_DIR" 2>/dev/null; then
    echo "❌ FORBIDDEN TOKEN FOUND: '$token' in $EXECUTOR_DIR"
    FAILED=1
  fi
done

# Also check that no model-supplied selectors are used
# (selectors from action payload should not reach querySelector directly)
if grep -r -n "querySelector.*action\." "$EXECUTOR_DIR" 2>/dev/null; then
  echo "❌ Model-supplied selector usage detected in $EXECUTOR_DIR"
  FAILED=1
fi

if [ $FAILED -eq 1 ]; then
  echo ""
  echo "FAILED: Forbidden tokens detected in executor sources"
  echo "This violates PLAN.md §14.3 and AGENTS.md hard rule #3"
  exit 1
else
  echo "✅ All forbidden token checks passed"
  exit 0
fi