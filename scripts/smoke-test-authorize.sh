#!/usr/bin/env bash
# =============================================================================
# Wave 3 (revised): /api/auth/authorize — SolarPro-side SSO boundary
#
# The original Wave 3 targeted /api/survey/submit with bad JWTs, but that
# endpoint is middleware-gated AND not used by the mobile app flow. The real
# JWT minting boundary on the SolarPro side is /api/auth/authorize, which:
#
#   - Requires a logged-in session (cookie)
#   - Takes redirect_uri + state query params
#   - Returns a 302 with a minted JWT in the fragment or query
#
# Tests:
#   T14a: /api/auth/authorize without session   -> 401 or redirect to /auth/login
#   T14b: /api/auth/authorize with valid session + valid redirect_uri -> 302 with token
#   T14c: /api/auth/authorize with open-redirect payload (attacker URL) -> 4xx OR sanitized
#   T14d: Minted JWT has required claims (sub, email, iat, exp, jti)
#   T14e: Minted JWT is signed correctly (verifies with SOLARPRO_HANDOFF_SECRET)
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-raymond.obrian@yahoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Ray1obrian#}"
HANDOFF_SECRET="${SOLARPRO_HANDOFF_SECRET:-prod_handoff_secret_2026_rotate_me}"

COOKIE_JAR=$(mktemp); trap "rm -f $COOKIE_JAR /tmp/autho-*.txt /tmp/autho-*.json" EXIT

PASS=0; FAIL=0
declare -a FAIL_LIST
ok()   { printf '  [PASS] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); FAIL_LIST+=("$*"); }
step() { printf '\n==== %s ====\n' "$*"; }

# ---------------------------------------------------------------------------
step "T14a: /api/auth/authorize without session -> 401 or redirect to login"
# ---------------------------------------------------------------------------
HTTP=$(curl -sS -o /tmp/autho-nosess.txt -w '%{http_code}' -D /tmp/autho-nosess-hdr.txt \
  "$BASE_URL/api/auth/authorize?redirect_uri=sitesurvey://login&state=testabc")
LOC=$(grep -i '^location:' /tmp/autho-nosess-hdr.txt | head -1 | tr -d '\r\n')
if [[ "$HTTP" == "401" || "$HTTP" == "302" || "$HTTP" == "307" ]]; then
  ok "T14a no-session -> HTTP $HTTP ($LOC)"
else
  bad "T14a no-session -> HTTP $HTTP (expected 401/302/307); body=$(cat /tmp/autho-nosess.txt)"
fi

# ---------------------------------------------------------------------------
step "T0: Admin login (for subsequent tests)"
# ---------------------------------------------------------------------------
HTTP=$(curl -sS -o /tmp/autho-login.json -w '%{http_code}' -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login")
[[ "$HTTP" != "200" ]] && { echo "Admin login failed: $HTTP"; exit 2; }
echo "    Login OK"

# ---------------------------------------------------------------------------
step "T14b: /api/auth/authorize with session + sitesurvey:// redirect -> 302 with token"
# ---------------------------------------------------------------------------
HTTP=$(curl -sS -o /tmp/autho-ok.txt -w '%{http_code}' -D /tmp/autho-ok-hdr.txt \
  -b "$COOKIE_JAR" \
  "$BASE_URL/api/auth/authorize?redirect_uri=sitesurvey://login&state=test1234")
LOC=$(grep -i '^location:' /tmp/autho-ok-hdr.txt | head -1 | sed 's/^location: //I' | tr -d '\r\n')
# Extract token from location (supports ?token=... or #token=...)
TOKEN=$(echo "$LOC" | sed -E 's/.*[?#&]token=([^&]+).*/\1/' | head -1)
if [[ "$HTTP" == "302" || "$HTTP" == "307" ]] && [[ -n "$TOKEN" && "$TOKEN" != "$LOC" ]]; then
  ok "T14b valid-session -> HTTP $HTTP, token present (len=${#TOKEN}, first 20 chars: ${TOKEN:0:20}...)"
else
  bad "T14b valid-session -> HTTP $HTTP, Location='$LOC', token='$TOKEN'"
  TOKEN=""
fi

# ---------------------------------------------------------------------------
step "T14c: /api/auth/authorize with attacker redirect_uri (http://evil.example/) -> should refuse OR sanitize"
# ---------------------------------------------------------------------------
HTTP=$(curl -sS -o /tmp/autho-evil.txt -w '%{http_code}' -D /tmp/autho-evil-hdr.txt \
  -b "$COOKIE_JAR" \
  "$BASE_URL/api/auth/authorize?redirect_uri=https://evil.example/phish&state=xyz")
LOC=$(grep -i '^location:' /tmp/autho-evil-hdr.txt | head -1 | sed 's/^location: //I' | tr -d '\r\n')
echo "  HTTP: $HTTP"
echo "  Location: $LOC"
if [[ "$HTTP" == "400" || "$HTTP" == "403" ]]; then
  ok "T14c evil-redirect rejected with HTTP $HTTP (ideal)"
elif [[ "$LOC" == https://evil.example/* ]]; then
  bad "T14c evil-redirect: open-redirect vulnerability — server 302'd to $LOC"
elif [[ "$LOC" != https://evil.example/* ]]; then
  ok "T14c evil-redirect: not redirected to attacker URL (Location=$LOC, HTTP=$HTTP)"
else
  bad "T14c evil-redirect: review needed (HTTP=$HTTP, Location=$LOC)"
fi

# ---------------------------------------------------------------------------
step "T14d + T14e: Decode minted JWT and verify claims + signature"
# ---------------------------------------------------------------------------
if [[ -z "$TOKEN" ]]; then
  bad "T14d/e: no token minted in T14b, skipping"
else
  # Decode (no verify) to show claims
  HEADER=$(echo "$TOKEN" | cut -d. -f1 | tr '_-' '/+' | { base64 -d 2>/dev/null || true; } )
  PAYLOAD=$(echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | { base64 -d 2>/dev/null || true; } )
  echo "  Header:  $HEADER"
  echo "  Payload: $PAYLOAD"

  # Check required claims
  MISSING=()
  for c in sub email iat exp jti; do
    if ! echo "$PAYLOAD" | jq -e --arg k "$c" 'has($k)' >/dev/null 2>&1; then
      MISSING+=("$c")
    fi
  done
  if [[ ${#MISSING[@]} -eq 0 ]]; then
    ok "T14d: all required claims present (sub, email, iat, exp, jti)"
  else
    bad "T14d: missing claims: ${MISSING[*]}"
  fi

  # Verify signature using node + jsonwebtoken
  export TOKEN HANDOFF_SECRET
  VERIFY_OUT=$(node -e "
    const jwt = require('jsonwebtoken');
    try {
      const d = jwt.verify(process.env.TOKEN, process.env.HANDOFF_SECRET, { algorithms: ['HS256'] });
      console.log('VERIFIED');
      console.log(JSON.stringify(d));
    } catch (e) { console.log('FAILED: ' + e.message); }
  " 2>&1)
  if echo "$VERIFY_OUT" | head -1 | grep -q '^VERIFIED'; then
    ok "T14e: JWT verifies with SOLARPRO_HANDOFF_SECRET (HS256)"
    echo "    Decoded: $(echo "$VERIFY_OUT" | sed -n 2p)"
  else
    bad "T14e: JWT did NOT verify — $VERIFY_OUT"
  fi
fi

echo
echo "==== Wave 3 (revised) Summary ===="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo; echo "FAILED:"; for t in "${FAIL_LIST[@]}"; do echo "  - $t"; done
  exit 1
fi