#!/usr/bin/env bash
# =============================================================================
# Wave 1: Security boundary tests for /api/webhooks/survey-complete.
#
# Tests:
#   T6: Wrong HMAC signature               -> 401
#   T7: Expired timestamp (15 min old)     -> 401
#   T8a/b/c: Missing required envelope fields -> 400
#   T9: Unsupported event type             -> 400
# =============================================================================
set -u  # intentionally not -e; we want per-test results

TARGET="${TARGET:-https://solarpro-dev.vercel.app}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-whsec_stage_test}"
TEST_USER_ID="${TEST_USER_ID:-011526da-28fc-4c01-85a0-d52c0f578fdf}"

PASS=0; FAIL=0
declare -a FAILED_TESTS

say()  { printf '\n==== %s ====\n' "$*"; }
ok()   { printf '  [PASS] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); FAILED_TESTS+=("$*"); }
uuid() { python3 -c "import uuid; print(uuid.uuid4())"; }

sign_body () {
  printf '%s.%s' "$1" "$2" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $2}'
}

send_webhook () {
  local BODY="$1"
  local TS="${2:-$(date -u +%s)}"
  local SIG="${3:-}"
  if [ -z "$SIG" ]; then SIG="$(sign_body "$TS" "$BODY")"; fi
  curl -sS -w '\n__HTTP__%{http_code}' \
    -X POST "$TARGET/api/webhooks/survey-complete" \
    -H 'Content-Type: application/json' \
    -H "X-Survey-Timestamp: $TS" \
    -H "X-Survey-Signature: sha256=$SIG" \
    --data "$BODY"
}

status_of () { echo "$1" | awk -F'__HTTP__' '{print $2}' | tr -d '[:space:]'; }
body_of   () { echo "$1" | awk -F'__HTTP__' '{print $1}'; }

say "T6: Wrong signature -> expect 401"
BODY='{"event":"survey.completed","event_id":"'"$(uuid)"'","survey_id":"'"$(uuid)"'","completed_at":"2026-04-29T20:00:00Z","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "" "deadbeef0000000000000000000000000000000000000000000000000000dead")
ST=$(status_of "$RESP")
if [ "$ST" = "401" ]; then ok "wrong signature -> 401"; else bad "wrong signature -> got $ST (expected 401); body: $(body_of "$RESP")"; fi

say "T7: Expired timestamp (15 min old) -> expect 401"
OLD_TS=$(($(date -u +%s) - 900))
BODY='{"event":"survey.completed","event_id":"'"$(uuid)"'","survey_id":"'"$(uuid)"'","completed_at":"2026-04-29T20:00:00Z","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "$OLD_TS" "")
ST=$(status_of "$RESP")
if [ "$ST" = "401" ]; then ok "expired timestamp -> 401"; else bad "expired timestamp -> got $ST (expected 401); body: $(body_of "$RESP")"; fi

say "T8a: Missing event_id -> expect 400"
BODY='{"event":"survey.completed","survey_id":"'"$(uuid)"'","completed_at":"2026-04-29T20:00:00Z","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "" "")
ST=$(status_of "$RESP")
if [ "$ST" = "400" ]; then ok "missing event_id -> 400"; else bad "missing event_id -> got $ST (expected 400); body: $(body_of "$RESP")"; fi

say "T8b: Missing survey_id -> expect 400"
BODY='{"event":"survey.completed","event_id":"'"$(uuid)"'","completed_at":"2026-04-29T20:00:00Z","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "" "")
ST=$(status_of "$RESP")
if [ "$ST" = "400" ]; then ok "missing survey_id -> 400"; else bad "missing survey_id -> got $ST (expected 400); body: $(body_of "$RESP")"; fi

say "T8c: Missing completed_at -> expect 400"
BODY='{"event":"survey.completed","event_id":"'"$(uuid)"'","survey_id":"'"$(uuid)"'","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "" "")
ST=$(status_of "$RESP")
if [ "$ST" = "400" ]; then ok "missing completed_at -> 400"; else bad "missing completed_at -> got $ST (expected 400); body: $(body_of "$RESP")"; fi

say "T9: Unsupported event type -> expect 400"
BODY='{"event":"survey.started","event_id":"'"$(uuid)"'","survey_id":"'"$(uuid)"'","completed_at":"2026-04-29T20:00:00Z","solarpro_user_id":"'"$TEST_USER_ID"'"}'
RESP=$(send_webhook "$BODY" "" "")
ST=$(status_of "$RESP")
if [ "$ST" = "400" ]; then ok "unsupported event type -> 400"; else bad "unsupported event type -> got $ST (expected 400); body: $(body_of "$RESP")"; fi

echo
echo "==== Wave 1 Summary ===="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo; echo "FAILED tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi