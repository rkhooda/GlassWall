#!/usr/bin/env bash
set -euo pipefail

echo "=== verify:boundary ==="
echo "Checking privacy boundary enforcement..."
echo

FAILURES=0

# Helper to run grep pipeline safely (grep -v returns 1 when no match)
safe_grep_count() {
  local pattern="$1"
  shift
  local count
  count=$(grep -r "$pattern" "$@" 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "background/net.ts" | grep -v "// " | wc -l || true)
  echo "$count" | tr -d ' \n'
}

# 1. Exactly one fetch in the entire repo (A's background/net.ts)
echo "[1/8] Checking for fetch / XMLHttpRequest / sendBeacon / WebSocket..."

FETCH_COUNT=$(safe_grep_count "\.fetch(" --include="*.ts" --include="*.tsx" apps/ packages/)
if [ "$FETCH_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $FETCH_COUNT unauthorized fetch() call(s) outside background/net.ts"
  grep -r "\.fetch(" --include="*.ts" --include="*.tsx" apps/ packages/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "background/net.ts" | grep -v "// "
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No unauthorized fetch() calls"
fi

XHR_COUNT=$(safe_grep_count "XMLHttpRequest" --include="*.ts" --include="*.tsx" apps/ packages/)
if [ "$XHR_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $XHR_COUNT XMLHttpRequest usage"
  grep -r "XMLHttpRequest" --include="*.ts" --include="*.tsx" apps/ packages/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// "
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No XMLHttpRequest usage"
fi

BEACON_COUNT=$(safe_grep_count "sendBeacon" --include="*.ts" --include="*.tsx" apps/ packages/)
if [ "$BEACON_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $BEACON_COUNT sendBeacon usage"
  grep -r "sendBeacon" --include="*.ts" --include="*.tsx" apps/ packages/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// "
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No sendBeacon usage"
fi

WS_COUNT=$(safe_grep_count "new WebSocket" --include="*.ts" --include="*.tsx" apps/ packages/)
if [ "$WS_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $WS_COUNT new WebSocket() usage"
  grep -r "new WebSocket" --include="*.ts" --include="*.tsx" apps/ packages/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// "
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No WebSocket usage"
fi

# 2. No eval / Function / innerHTML / insertAdjacentHTML in extension source
echo "[2/8] Checking for eval / Function / innerHTML / insertAdjacentHTML in extension..."

safe_grep_ext() {
  local pattern="$1"
  shift
  local count
  count=$(grep -r "$pattern" "$@" 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test" | wc -l || true)
  echo "$count" | tr -d ' \n'
}

EVAL_COUNT=$(safe_grep_ext "\beval(" --include="*.ts" --include="*.tsx" apps/extension/src/)
if [ "$EVAL_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $EVAL_COUNT eval() usage"
  grep -r "\beval(" --include="*.ts" --include="*.tsx" apps/extension/src/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No eval() usage"
fi

FUNC_COUNT=$(safe_grep_ext "new Function" --include="*.ts" --include="*.tsx" apps/extension/src/)
if [ "$FUNC_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $FUNC_COUNT new Function() usage"
  grep -r "new Function" --include="*.ts" --include="*.tsx" apps/extension/src/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No new Function() usage"
fi

INNER_COUNT=$(safe_grep_ext "\.innerHTML\s*=" --include="*.ts" --include="*.tsx" apps/extension/src/)
if [ "$INNER_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $INNER_COUNT innerHTML assignments"
  grep -r "\.innerHTML\s*=" --include="*.ts" --include="*.tsx" apps/extension/src/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No innerHTML assignments"
fi

ADJ_COUNT=$(safe_grep_ext "insertAdjacentHTML" --include="*.ts" --include="*.tsx" apps/extension/src/)
if [ "$ADJ_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $ADJ_COUNT insertAdjacentHTML usage"
  grep -r "insertAdjacentHTML" --include="*.ts" --include="*.tsx" apps/extension/src/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No insertAdjacentHTML usage"
fi

# 3. No data-glasswall- in built bundle
echo "[3/8] Checking for data-glasswall- in built bundle..."
if [ -d "apps/extension/dist" ]; then
  BUNDLE_REF=$(grep -r "data-glasswall-" apps/extension/dist/ 2>/dev/null | wc -l || true)
  BUNDLE_REF=$(echo "$BUNDLE_REF" | tr -d ' \n')
  if [ "$BUNDLE_REF" -gt 0 ] 2>/dev/null; then
    echo "  ❌ FAIL: Found $BUNDLE_REF data-glasswall- reference(s) in built bundle"
    grep -r "data-glasswall-" apps/extension/dist/ 2>/dev/null
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ PASS: No data-glasswall- in built bundle"
  fi
else
  echo "  ⚠️  SKIP: No built bundle found (run build first)"
fi

# 4. Manifest connect-src pinned to gateway
echo "[4/8] Checking manifest.json connect-src..."
MANIFEST="apps/extension/manifest.json"
if [ -f "$MANIFEST" ]; then
  CONNECT_SRC=$(grep -A2 '"connect_src"' "$MANIFEST" 2>/dev/null || grep -A2 "connect-src" "$MANIFEST" 2>/dev/null || echo "")
  if echo "$CONNECT_SRC" | grep -q "gateway"; then
    echo "  ✅ PASS: connect-src pinned to gateway"
  else
    echo "  ❌ FAIL: connect-src not pinned to gateway (expected in A's manifest)"
    echo "  Current CSP: $CONNECT_SRC"
    echo "  Note: A must update manifest.json with gateway origin"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  ⚠️  SKIP: manifest.json not found"
fi

# 5. No host_permissions with <all_urls>
echo "[5/8] Checking host_permissions..."
if [ -f "$MANIFEST" ]; then
  if grep -q '"<all_urls>"' "$MANIFEST"; then
    echo "  ❌ FAIL: host_permissions contains <all_urls>"
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ PASS: No <all_urls> in host_permissions"
  fi
else
  echo "  ⚠️  SKIP: manifest.json not found"
fi

# 6. No vault writes to storage.local or indexedDB
echo "[6/8] Checking for storage.local / indexedDB usage in vault..."

safe_grep_privacy() {
  local pattern="$1"
  local count
  count=$(grep -r "$pattern" --include="*.ts" apps/extension/src/background/privacy/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test" | wc -l || true)
  echo "$count" | tr -d ' \n'
}

LOCAL_COUNT=$(safe_grep_privacy "storage\.local")
if [ "$LOCAL_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $LOCAL_COUNT storage.local usage in privacy code"
  grep -r "storage\.local" --include="*.ts" apps/extension/src/background/privacy/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No storage.local in privacy code"
fi

IDB_COUNT=$(safe_grep_privacy "indexedDB")
if [ "$IDB_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ❌ FAIL: Found $IDB_COUNT indexedDB usage in privacy code"
  grep -r "indexedDB" --include="*.ts" apps/extension/src/background/privacy/ 2>/dev/null | grep -v "node_modules" | grep -v ".d.ts" | grep -v "// " | grep -v "test"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ PASS: No indexedDB in privacy code"
fi

# 7. Verify SafePayload brand enforcement (compile-time check via net.ts signature)
echo "[7/8] Checking SafePayload enforcement in net.ts..."
if [ -f "apps/extension/src/background/net.ts" ]; then
  if grep -q "SafePayload" apps/extension/src/background/net.ts; then
    echo "  ✅ PASS: net.ts references SafePayload"
  else
    echo "  ❌ FAIL: net.ts does not reference SafePayload (compile enforcement missing)"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  ⚠️  SKIP: net.ts not found"
fi

# 8. The extractor is the privacy boundary, not just a parser (PLAN.md §6.3 Layer 1,
#    CLAUDE.md hard rule 4). It must never read a value or a storage API. This is the
#    one invariant that is cheap to state, cheap to grep, and expensive to lose.
echo "[8/8] Checking extractor for forbidden reads..."
EXTRACTOR="apps/extension/src/content/extractor"
FORBIDDEN_READS='\.value\b|\.innerHTML|\.outerHTML|document\.cookie|localStorage|sessionStorage|indexedDB'
if [ -d "$EXTRACTOR" ]; then
  READ_HITS=$(grep -rInE "$FORBIDDEN_READS" --include="*.ts" "$EXTRACTOR" 2>/dev/null | grep -v "\.test\.ts" | grep -vE '^\s*//' || true)
  READ_COUNT=$(printf '%s' "$READ_HITS" | grep -c . || true)
  if [ "${READ_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "  ❌ FAIL: $READ_COUNT forbidden read(s) in the extractor"
    printf '%s\n' "$READ_HITS" | sed 's/^/    /'
    echo "  Note: A's file. Reading .value to derive value_state still reads it — the"
    echo "  boundary is meant to be grep-provable, and this makes it not. Logged in"
    echo "  docs/REQUESTS-TO-A.md and stated as a residual in SECURITY.md."
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ PASS: extractor reads no values or storage APIs"
  fi
else
  echo "  ⚠️  SKIP: extractor not found"
fi

echo
echo "=== Summary ==="
if [ "$FAILURES" -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED"
  exit 0
else
  echo "❌ $FAILURES CHECK(S) FAILED"
  exit 1
fi