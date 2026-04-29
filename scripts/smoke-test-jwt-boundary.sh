#!/usr/bin/env bash
# =============================================================================
# Wave 3: JWT / SSO boundary tests against /api/survey/submit
#
#   T11: Expired JWT (iat 20 min ago, exp 10 min ago)  -> 401
#   T12: JWT signed with wrong secret                   -> 401
#   T8-jwt: Missing token                               -> 400
#
# We mint tokens locally with `node -e` using the jsonwebtoken lib that's
# already in the repo. The secret we use is the CORRECT SOLARPRO_HANDOFF_SECRET
# that we set on solarpro-dev (prod_handoff_secret_2026_rotate_me).
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
HANDOFF_SECRET="${SOLARPRO_HANDOFF_SECRET:-prod_handoff_secret_2026_rotate_me}"
ADMIN_ID="011526da-28fc-4c01-85a0-d52c0f578fdf"
ADMIN_EMAIL="raymond.obrian@yahoo.com"

PASS=0; FAIL=0
declare -a FAIL_LIST
ok()   { printf '  [PASS] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); FAIL_LIST+=("$*"); }
step() { printf '\n==== %s ====\n' "$*"; }

uuid() { python3 -c "import uuid; print(uuid.uuid4())"; }

mint_token () {
  # $1=secret  $2=expires_in_seconds (negative = already expired)
  local secret="$1"
  local exp_offset="$2"
  SECRET="$secret" EXP_OFFSET="$exp_offset" ADMIN_ID="$ADMIN_ID" ADMIN_EMAIL="$ADMIN_EMAIL" \
    node -e "
const jwt = require('jsonwebtoken');
const now = Math.floor(Date.now() / 1000);
const offset = parseInt(process.env.EXP_OFFSET, 10);
const payload = {
  sub: process.env.ADMIN_ID,
  solarpro_user_id: process.env.ADMIN_ID,
  email: process.env.ADMIN_EMAIL,
  project_id: 'test-project-id',
  exp: now + offset,
  jti: require('crypto').randomBytes(8).toString('hex'),
};
console.log(jwt.sign(payload, process.env.SECRET, { algorithm: 'HS256' }));
"
}

call_submit () {
  # $1=token  $2=outfile  -> echoes http_code
  local token="$1" outfile="$2"
  # Minimal payload; we just want to see whether the token is accepted
  local body
  body=$(jq -cn --arg t "$token" \
    '{token:$t, payload:{
      projectId:"test-project-id",
      surveyId:"'"$(uuid)"'",
      completedAt:"2026-04-29T20:00:00Z"
    }}')
  curl -sS -o "$outfile" -w '%{http_code}' \
    -X POST "$BASE_URL/api/survey/submit" \
    -H 'Content-Type: application/json' \
    --data-raw "$body"
}

cd "$(dirname "$0")/.."  # ensure node can find node_modules

# ---------------------------------------------------------------------------
step "T11: Expired JWT (exp 10 min in past) -> 401"
# ---------------------------------------------------------------------------
EXPIRED_TOKEN=$(mint_token "$HANDOFF_SECRET" "-600")  # 10 minutes ago
if [[ -z "$EXPIRED_TOKEN" ]]; then bad "T11: could not mint expired token"; else
  HTTP=$(call_submit "$EXPIRED_TOKEN" /tmp/jwt-t11.json)
  BD=$(cat /tmp/jwt-t11.json)
  if [[ "$HTTP" == "401" ]]; then
    ok "T11 expired-JWT -> 401; body=$BD"
  else
    bad "T11 expired-JWT: expected 401 got $HTTP; body=$BD"
  fi
fi

# ---------------------------------------------------------------------------
step "T12: JWT signed with wrong secret -> 401"
# ---------------------------------------------------------------------------
BAD_TOKEN=$(mint_token "completely_wrong_secret_abcdef123456" "600")  # fresh but wrong sig
if [[ -z "$BAD_TOKEN" ]]; then bad "T12: could not mint bad-secret token"; else
  HTTP=$(call_submit "$BAD_TOKEN" /tmp/jwt-t12.json)
  BD=$(cat /tmp/jwt-t12.json)
  if [[ "$HTTP" == "401" ]]; then
    ok "T12 wrong-secret-JWT -> 401; body=$BD"
  else
    bad "T12 wrong-secret-JWT: expected 401 got $HTTP; body=$BD"
  fi
fi

# ---------------------------------------------------------------------------
step "T8-jwt: Missing token field -> 400"
# ---------------------------------------------------------------------------
body='{"payload":{"projectId":"test","surveyId":"abc","completedAt":"2026-04-29T20:00:00Z"}}'
HTTP=$(curl -sS -o /tmp/jwt-t8.json -w '%{http_code}' \
  -X POST "$BASE_URL/api/survey/submit" \
  -H 'Content-Type: application/json' --data-raw "$body")
BD=$(cat /tmp/jwt-t8.json)
if [[ "$HTTP" == "400" ]]; then
  ok "T8-jwt missing-token -> 400; body=$BD"
else
  bad "T8-jwt missing-token: expected 400 got $HTTP; body=$BD"
fi

# ---------------------------------------------------------------------------
step "T13: Token garbled (malformed JWT) -> 401"
# ---------------------------------------------------------------------------
HTTP=$(call_submit "not.a.valid.jwt.at.all" /tmp/jwt-t13.json)
BD=$(cat /tmp/jwt-t13.json)
if [[ "$HTTP" == "401" ]]; then
  ok "T13 garbled-JWT -> 401; body=$BD"
else
  bad "T13 garbled-JWT: expected 401 got $HTTP; body=$BD"
fi

# ---------------------------------------------------------------------------
echo
echo "==== Wave 3 Summary ===="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo; echo "FAILED:"; for t in "${FAIL_LIST[@]}"; do echo "  - $t"; done
  exit 1
fi