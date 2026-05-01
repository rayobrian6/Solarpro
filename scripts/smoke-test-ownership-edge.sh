#!/usr/bin/env bash
# =============================================================================
# Wave 2: Ownership-routing edge cases against /api/webhooks/survey-complete.
#
#   T1a/b/c: malformed / nonexistent / empty solarpro_user_id -> default fallback
#   T2:     missing solarpro_user_id claim                     -> default fallback
#   T5:     idempotency — same event_id twice                  -> no duplicate project
#   T4:     3 parallel webhooks, same user, distinct ids       -> 3 distinct projects
#
# Verifies ownership by admin-login + /api/admin/projects?limit=500 lookup of
# owner_email (the response omits user_id/owner_id).
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-raymond.obrian@yahoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Ray1obrian#}"
ADMIN_ID="011526da-28fc-4c01-85a0-d52c0f578fdf"  # = SURVEY_INGEST_DEFAULT_USER_ID

if [[ -z "${SURVEY_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: SURVEY_WEBHOOK_SECRET env var not set" >&2
  exit 2
fi

COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR /tmp/sedge-*.json /tmp/sedge-par-*" EXIT

PASS=0; FAIL=0
declare -a FAIL_LIST
ok()   { printf '    [PASS] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '    [FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); FAIL_LIST+=("$*"); }
step() { printf '\n==== %s ====\n' "$*"; }
uuid() { python3 -c "import uuid; print(uuid.uuid4())"; }

send_webhook () {
  local body="$1" outfile="$2"
  local ts; ts=$(date +%s); export TS="$ts"
  local sig
  sig=$(printf '%s' "$body" | python3 -c "
import hmac, hashlib, os, sys
secret = os.environ['SURVEY_WEBHOOK_SECRET'].encode()
ts     = os.environ['TS'].encode()
body   = sys.stdin.buffer.read()
print('sha256=' + hmac.new(secret, ts + b'.' + body, hashlib.sha256).hexdigest())
")
  curl -sS -o "$outfile" -w '%{http_code}' \
    -X POST "$BASE_URL/api/webhooks/survey-complete" \
    -H 'Content-Type: application/json' \
    -H "X-Survey-Timestamp: $ts" \
    -H "X-Survey-Signature: $sig" \
    --data-raw "$body"
}

step "[0] Admin login"
LOGIN_HTTP=$(curl -sS -o /tmp/sedge-login.json -w '%{http_code}' \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login")
[[ "$LOGIN_HTTP" != "200" ]] && { echo "Admin login failed: $LOGIN_HTTP"; exit 2; }
echo "    Login OK"

lookup_user_id () {
  # Returns owner_email (/api/admin/projects response omits user_id/owner_id).
  local pid="$1"
  curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500" \
    | jq -r --arg pid "$pid" '(.data // .projects // [])[] | select(.id == $pid) | .owner_email // "-"'
}

run_default_fallback_test () {
  # $1=test-name  $2=body-template-json
  local name="$1" body="$2"
  local HTTP PID OWN_ID
  HTTP=$(send_webhook "$body" /tmp/sedge-$name.json)
  PID=$(jq -r '.projectId // empty' /tmp/sedge-$name.json)
  if [[ "$HTTP" =~ ^(200|202)$ ]] && [[ -n "$PID" ]]; then
    sleep 1
    OWN_ID=$(lookup_user_id "$PID")
    if [[ "$OWN_ID" == "$ADMIN_EMAIL" ]]; then
      ok "$name: project $PID -> admin (default) ✓  HTTP $HTTP"
    else
      bad "$name: project $PID owner_email=$OWN_ID expected $ADMIN_EMAIL"
    fi
  else
    bad "$name: HTTP $HTTP body=$(cat /tmp/sedge-$name.json)"
  fi
}

step "T2: Missing solarpro_user_id claim"
EID=$(uuid); SID=$(uuid)
B=$(jq -cn --arg eid "$EID" --arg sid "$SID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, completed_at:"2026-04-29T20:00:00Z"}')
run_default_fallback_test "t2" "$B"

step "T1a: Malformed solarpro_user_id (non-UUID)"
EID=$(uuid); SID=$(uuid)
B=$(jq -cn --arg eid "$EID" --arg sid "$SID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:"not-a-uuid-at-all"}')
run_default_fallback_test "t1a" "$B"

step "T1b: Well-formed but nonexistent UUID"
EID=$(uuid); SID=$(uuid)
B=$(jq -cn --arg eid "$EID" --arg sid "$SID" --arg uid "00000000-0000-0000-0000-000000000000" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:$uid}')
run_default_fallback_test "t1b" "$B"

step "T1c: Empty-string solarpro_user_id"
EID=$(uuid); SID=$(uuid)
B=$(jq -cn --arg eid "$EID" --arg sid "$SID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:""}')
run_default_fallback_test "t1c" "$B"

step "T5: Idempotency — same event_id sent twice"
EID=$(uuid); SID=$(uuid)
BODY=$(jq -cn --arg eid "$EID" --arg sid "$SID" --arg uid "$ADMIN_ID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:$uid}')
HTTP1=$(send_webhook "$BODY" /tmp/sedge-t5a.json)
PID1=$(jq -r '.projectId // empty' /tmp/sedge-t5a.json)
sleep 2
HTTP2=$(send_webhook "$BODY" /tmp/sedge-t5b.json)
PID2=$(jq -r '.projectId // empty' /tmp/sedge-t5b.json)
DUP2=$(jq -r '.duplicate // .data.duplicate // false' /tmp/sedge-t5b.json)
EXISTING2=$(jq -r '.data.existingDeliveryId // empty' /tmp/sedge-t5b.json)
if [[ -n "$PID1" && "$PID1" == "$PID2" ]]; then
  ok "T5 idempotent: same projectId on both calls ($PID1), http=$HTTP1/$HTTP2"
elif [[ "$DUP2" == "true" && -n "$EXISTING2" ]]; then
  ok "T5 idempotent: 2nd call returned duplicate:true, existingDeliveryId=$EXISTING2 (HTTP $HTTP2)"
elif [[ "$HTTP2" == "409" ]]; then
  ok "T5 idempotent: 2nd call rejected as duplicate (HTTP 409)"
else
  bad "T5 idempotent: pid1=$PID1 pid2=$PID2 dup2=$DUP2 http=$HTTP1/$HTTP2"
fi

step "T4: Concurrent — 3 parallel webhooks, same user, distinct ids"
E1=$(uuid); S1=$(uuid); E2=$(uuid); S2=$(uuid); E3=$(uuid); S3=$(uuid)
B1=$(jq -cn --arg e "$E1" --arg s "$S1" --arg u "$ADMIN_ID" \
  '{event:"survey.completed", event_id:$e, survey_id:$s, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:$u}')
B2=$(jq -cn --arg e "$E2" --arg s "$S2" --arg u "$ADMIN_ID" \
  '{event:"survey.completed", event_id:$e, survey_id:$s, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:$u}')
B3=$(jq -cn --arg e "$E3" --arg s "$S3" --arg u "$ADMIN_ID" \
  '{event:"survey.completed", event_id:$e, survey_id:$s, completed_at:"2026-04-29T20:00:00Z", solarpro_user_id:$u}')

(send_webhook "$B1" /tmp/sedge-par-1.out > /tmp/sedge-par-1.http) &
(send_webhook "$B2" /tmp/sedge-par-2.out > /tmp/sedge-par-2.http) &
(send_webhook "$B3" /tmp/sedge-par-3.out > /tmp/sedge-par-3.http) &
wait

H1=$(cat /tmp/sedge-par-1.http); H2=$(cat /tmp/sedge-par-2.http); H3=$(cat /tmp/sedge-par-3.http)
P1=$(jq -r '.projectId // empty' /tmp/sedge-par-1.out)
P2=$(jq -r '.projectId // empty' /tmp/sedge-par-2.out)
P3=$(jq -r '.projectId // empty' /tmp/sedge-par-3.out)
UNIQ=$(printf '%s\n%s\n%s\n' "$P1" "$P2" "$P3" | sort -u | grep -c . || true)
if [[ "$H1" =~ ^(200|202)$ ]] && [[ "$H2" =~ ^(200|202)$ ]] && [[ "$H3" =~ ^(200|202)$ ]] && [[ "$UNIQ" == "3" ]]; then
  ok "T4 concurrent: 3 distinct projects ($P1, $P2, $P3), http=$H1/$H2/$H3"
else
  bad "T4 concurrent: uniq=$UNIQ pids=($P1,$P2,$P3) http=$H1/$H2/$H3"
fi

echo
echo "==== Wave 2 Summary ===="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo; echo "FAILED:"; for t in "${FAIL_LIST[@]}"; do echo "  - $t"; done
  exit 1
fi