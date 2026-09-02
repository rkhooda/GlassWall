#!/usr/bin/env bash
# The privacy boundary, as greps. Every check here is a hard rule from CLAUDE.md.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

EXT=apps/extension/src
MANIFEST=apps/extension/manifest.json
GATEWAY=$(sed -n "s/.*GATEWAY_ORIGIN = '\([^']*\)'.*/\1/p" "$EXT/shared/config.ts")

# Strip // comments before matching so prose about a rule does not trip the rule.
code_grep() { # pattern paths...
  local pattern="$1"; shift
  grep -rIn --include='*.ts' --include='*.tsx' -E "$pattern" "$@" 2>/dev/null \
    | grep -v '\.test\.\|\.spec\.' \
    | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)' \
    | sed -E 's#//.*$##' \
    | grep -E "$pattern" || true
}

echo "[1/8] one fetch site in the extension (net.ts)"
HITS=$(code_grep '(^|[^A-Za-z0-9_.])fetch\(' "$EXT" | grep -v 'background/net.ts')
[ -z "$HITS" ] && pass "fetch() only in net.ts" || { fail "fetch() outside net.ts"; echo "$HITS"; }
for banned in XMLHttpRequest sendBeacon 'new WebSocket'; do
  HITS=$(code_grep "$banned" "$EXT")
  [ -z "$HITS" ] && pass "no $banned" || { fail "$banned used"; echo "$HITS"; }
done

echo "[2/8] no eval / Function / innerHTML / insertAdjacentHTML in the extension"
for banned in '\beval\(' 'new Function' '\.innerHTML\s*=' 'insertAdjacentHTML'; do
  HITS=$(code_grep "$banned" "$EXT")
  [ -z "$HITS" ] && pass "no $banned" || { fail "$banned used"; echo "$HITS"; }
done

echo "[3/8] bench instrumentation attributes absent from the built bundle"
if [ -d apps/extension/dist ]; then
  if grep -rq "data-glasswall-" apps/extension/dist/assets 2>/dev/null; then fail "data-glasswall- in bundle"; else pass "bundle clean"; fi
else
  echo "  ⚠️  no build; run pnpm --filter @glasswall/extension build"
fi

echo "[3b/8] negative-control code compiled out of the shipped bundle"
if [ -d apps/extension/dist ]; then
  if grep -rq "UNSAFE negative control" apps/extension/dist/manifest.json 2>/dev/null; then fail "dist/ is the unsafe build"; else pass "dist/ is a safe build"; fi
fi

echo "[4/8] CSP connect-src pinned to the gateway ($GATEWAY)"
CSP=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['content_security_policy']['extension_pages'])")
case "$CSP" in
  *"connect-src 'self' $GATEWAY"*) pass "connect-src pinned" ;;
  *) fail "connect-src not pinned: $CSP" ;;
esac

echo "[5/8] host_permissions limited to the gateway (sites are optional, requested per origin)"
HP=$(python3 -c "import json;print(' '.join(json.load(open('$MANIFEST')).get('host_permissions',[])))")
[ "$HP" = "$GATEWAY/*" ] && pass "host_permissions = $HP" || fail "host_permissions = '$HP'"

echo "[6/8] vault never persisted to storage.local or IndexedDB"
HITS=$(code_grep 'storage\.local|indexedDB' packages/privacy/src "$EXT/background")
[ -z "$HITS" ] && pass "session storage only" || { fail "persistent storage in vault path"; echo "$HITS"; }

echo "[7/8] net.ts accepts SafePayload only"
if grep -q "send(p: SafePayload)" "$EXT/background/net.ts" && ! grep -qE "export (async )?function [a-z]+\(" <(grep -v "send(p: SafePayload)" "$EXT/background/net.ts"); then
  pass "single exported send(p: SafePayload)"
else
  fail "net.ts exports more than send(p: SafePayload)"
fi

echo "[8/8] extractor reads no values or storage"
HITS=$(code_grep '\.value\b|\.innerHTML|\.outerHTML|document\.cookie|localStorage|sessionStorage|indexedDB' "$EXT/content/extractor" "$EXT/content/identity.ts")
[ -z "$HITS" ] && pass "extractor is value-blind" || { fail "forbidden read in extractor"; echo "$HITS"; }

echo
if [ "$FAIL" -eq 0 ]; then echo "verify:boundary ✅ all checks passed"; else echo "verify:boundary ❌ $FAIL check(s) failed"; exit 1; fi
