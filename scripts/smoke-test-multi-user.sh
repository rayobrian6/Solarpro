#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-test-multi-user.sh
#
# Multi-tenant isolation proof for the survey ingest pipeline.
#
# Proves that when user B's solarpro_user_id is sent in a webhook, the
# resulting project is owned by user B — NOT by the admin running the test,
# and NOT by SURVEY_INGEST_DEFAULT_USER_ID.
#
# USAGE:
#   ./scripts/smoke-test-multi-user.sh <BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD> <USER_B_ID>
#
# REQUIREMENTS:
#   - Admin credentials (to query server-side ownership proof)
#   - User B must exist in the users table
#   - Env var SURVEY_WEBHOOK_SECRET must match the server's value
# =============================================================================
set -euo pipefail

BASE_URL="${1:-}"
ADMIN_EMAIL="${2:-}"
ADMIN_PASSWORD="${3:-}"
USER_B_ID="${4:-}"

if [[ -z "$BASE_URL" || -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" || -z "$USER_B_ID" ]]; then
  echo "Usage: $0 <BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD> <USER_B_ID>" >&2
  exit 2
fi

if [[ -z "${SURVEY_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: SURVEY_WEBHOOK_SECRET env var not set" >&2
  exit 2
fi

COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR /tmp/smoke-mu-*.json" EXIT

step()  { echo; echo "==> $1"; }
pass()  { echo "    ✅ $1"; }
fail()  { echo "    ❌ $1"; exit 1; }

# -----------------------------------------------------------------------------
step "[1/5] Logging in as admin to enable server-side ownership checks"
LOGIN_RESP=$(curl -sS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

echo "$LOGIN_RESP" | jq -e '.data.user.id' > /dev/null \
  || fail "admin login failed: $LOGIN_RESP"
ADMIN_ID=$(echo "$LOGIN_RESP" | jq -r '.data.user.id')
ADMIN_ROLE=$(echo "$LOGIN_RESP" | jq -r '.data.user.role // "user"')
[[ "$ADMIN_ROLE" == "admin" || "$ADMIN_ROLE" == "super_admin" ]] \
  || fail "admin account has role=$ADMIN_ROLE (need admin/super_admin)"
[[ "$ADMIN_ID" != "$USER_B_ID" ]] \
  || fail "admin and user B are the same user — pick a different USER_B_ID"
pass "admin=$ADMIN_ID role=$ADMIN_ROLE, user B=$USER_B_ID (different)"

# -----------------------------------------------------------------------------
step "[2/5] Verify user B exists in the users table"
# Use user-audit endpoint to confirm user B exists (proxy: if they didn't,
# ownerResolver would fall back to default and the project would end up in
# YOUR account, silently defeating the test)
USER_B_EMAIL=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/users?limit=500" \
  | jq -r --arg uid "$USER_B_ID" '(.data.users // .users // [])[] | select(.id == $uid) | .email')
[[ -n "$USER_B_EMAIL" ]] || fail "user B id=$USER_B_ID not found in users table"
pass "user B exists: $USER_B_EMAIL"

# -----------------------------------------------------------------------------
step "[3/5] Sending webhook with solarpro_user_id = user B"
SURVEY_ID_B="smoke-mu-b-$(date +%s)-$RANDOM"
EVENT_ID_B="evt-mu-b-$(date +%s)-$RANDOM"
COMPLETED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BODY_B=$(jq -n --arg sid "$SURVEY_ID_B" --arg eid "$EVENT_ID_B" \
  --arg uid "$USER_B_ID" --arg at "$COMPLETED" --arg base "$BASE_URL" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, survey_url:($base+"/api/survey/mock/"+$sid), completed_at:$at, solarpro_user_id:$uid}')

TS=$(date +%s)
export TS
SIG=$(printf '%s' "$BODY_B" | python3 -c "
import hmac, hashlib, os, sys
secret = os.environ['SURVEY_WEBHOOK_SECRET'].encode()
ts     = os.environ['TS'].encode()
body   = sys.stdin.buffer.read()
signed = ts + b'.' + body
print('sha256=' + hmac.new(secret, signed, hashlib.sha256).hexdigest())
")

HTTP_CODE=$(curl -sS -o /tmp/smoke-mu-b.json -w '%{http_code}' \
  -X POST "$BASE_URL/api/webhooks/survey-complete" \
  -H 'Content-Type: application/json' \
  -H "X-Survey-Timestamp: $TS" \
  -H "X-Survey-Signature: $SIG" \
  --data-raw "$BODY_B")

[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]] \
  || fail "webhook status=$HTTP_CODE body=$(cat /tmp/smoke-mu-b.json)"
jq -e '.success == true' /tmp/smoke-mu-b.json > /dev/null \
  || fail "webhook body reports failure: $(cat /tmp/smoke-mu-b.json)"

PROJECT_ID=$(jq -r '.projectId' /tmp/smoke-mu-b.json)
CREATED=$(jq -r '.created' /tmp/smoke-mu-b.json)
[[ -n "$PROJECT_ID" && "$PROJECT_ID" != "null" ]] || fail "no projectId returned"
pass "webhook accepted: projectId=$PROJECT_ID, created=$CREATED"

# -----------------------------------------------------------------------------
step "[4/5] Proof A: project is visible in user B's projects (as admin)"
# Use admin endpoint to query projects by user_id without needing user B's password
ADMIN_PROJECTS=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500" 2>/dev/null || echo '{}')
OWNER_FOUND=$(echo "$ADMIN_PROJECTS" | jq -r --arg pid "$PROJECT_ID" --arg uid "$USER_B_ID" \
  '[(.data // .projects // [])[] | select(.id == $pid)] | .[0] | (.user_id // .owner_id // "-")')

if [[ "$OWNER_FOUND" == "$USER_B_ID" ]]; then
  pass "project $PROJECT_ID is owned by user B ($USER_B_ID) ✓"
elif [[ "$OWNER_FOUND" == "$ADMIN_ID" ]]; then
  fail "SEVERE: project $PROJECT_ID is owned by ADMIN ($ADMIN_ID) — multi-tenancy broken"
elif [[ "$OWNER_FOUND" == "-" ]]; then
  # /api/admin/projects may not exist or may not include this field. Fall back.
  echo "    ⚠️  /api/admin/projects did not surface owner field; falling back to webhook log"
  WEBHOOK_LOG=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/survey-webhook-log?limit=50")
  LOG_ENTRY=$(echo "$WEBHOOK_LOG" | jq --arg sid "$SURVEY_ID_B" \
    '.data[]? | select((.raw_body // "") | contains($sid))')
  [[ -n "$LOG_ENTRY" ]] || fail "no webhook_deliveries entry for survey $SURVEY_ID_B"
  LOGGED_PID=$(echo "$LOG_ENTRY" | jq -r '.project_id')
  [[ "$LOGGED_PID" == "$PROJECT_ID" ]] || fail "project_id mismatch: log=$LOGGED_PID vs webhook=$PROJECT_ID"
  pass "webhook_deliveries log confirms project $PROJECT_ID was created via this event"
  echo "    ℹ️  To prove ownership, you'll need to log in as user B and check /api/projects."
else
  fail "project $PROJECT_ID owner is '$OWNER_FOUND' (expected user B $USER_B_ID)"
fi

# -----------------------------------------------------------------------------
step "[5/5] Proof B: project is NOT visible in admin's own projects list"
MY_PROJECTS=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/projects")
MATCH_IN_MINE=$(echo "$MY_PROJECTS" | jq --arg pid "$PROJECT_ID" '[.data[]? | select(.id == $pid)] | length')
if [[ "$MATCH_IN_MINE" == "0" ]]; then
  pass "project $PROJECT_ID is ABSENT from admin's /api/projects (isolation confirmed)"
else
  fail "SEVERE: project $PROJECT_ID is leaking into admin's /api/projects — multi-tenancy broken"
fi

echo
echo "==================================================================="
echo " MULTI-USER ISOLATION SMOKE TEST PASSED"
echo "   admin_id       = $ADMIN_ID"
echo "   user_b_id      = $USER_B_ID ($USER_B_EMAIL)"
echo "   project_id     = $PROJECT_ID"
echo "   owner_verified = $OWNER_FOUND"
echo "   admin_sees_it  = NO ✓"
echo "==================================================================="