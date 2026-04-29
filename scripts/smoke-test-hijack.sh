#!/usr/bin/env bash
# =============================================================================
# Wave 2b: Cross-tenant hijack test.
#
# Scenario: User A sends a webhook claiming solarpro_user_id=A (legitimate)
#           but also provides solarpro_project_id=P where P is owned by User B.
#
# Expected behavior (the SAFE behavior):
#   Either
#     (a) Reject the attach because the project doesn't belong to the claimant, or
#     (b) Create a NEW orphan project under User A and ignore the bogus project_id.
#   NEVER: attach to User B's project and hand control to User A.
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-raymond.obrian@yahoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Ray1obrian#}"
ADMIN_ID="011526da-28fc-4c01-85a0-d52c0f578fdf"

if [[ -z "${SURVEY_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: SURVEY_WEBHOOK_SECRET env var not set" >&2
  exit 2
fi

COOKIE_JAR=$(mktemp); trap "rm -f $COOKIE_JAR /tmp/hijack-*.json" EXIT
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

# Admin login so we can look up real user UUIDs and verify end-state
curl -sS -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login" >/dev/null

# ---- Get two real non-admin user IDs from the admin users endpoint ----------
USERS_JSON=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/users?limit=50")
USER_A_ID=$(echo "$USERS_JSON" | jq -r --arg admin "$ADMIN_ID" \
  '(.users // .data // [])[] | select(.id != $admin) | .id' | head -1)
USER_A_EMAIL=$(echo "$USERS_JSON" | jq -r --arg id "$USER_A_ID" \
  '(.users // .data // [])[] | select(.id == $id) | .email // empty')
USER_B_ID=$(echo "$USERS_JSON" | jq -r --arg admin "$ADMIN_ID" --arg a "$USER_A_ID" \
  '(.users // .data // [])[] | select(.id != $admin and .id != $a) | .id' | head -1)
USER_B_EMAIL=$(echo "$USERS_JSON" | jq -r --arg id "$USER_B_ID" \
  '(.users // .data // [])[] | select(.id == $id) | .email // empty')

echo "User A (attacker): $USER_A_EMAIL ($USER_A_ID)"
echo "User B (victim):   $USER_B_EMAIL ($USER_B_ID)"

if [[ -z "$USER_A_ID" || -z "$USER_B_ID" ]]; then
  echo "ERROR: Could not find two distinct non-admin users."
  exit 2
fi

# -----------------------------------------------------------------------------
# STEP 1: Create a project OWNED BY USER B (the victim)
# -----------------------------------------------------------------------------
echo
echo "==== Step 1: Create victim project owned by User B ===="
EID=$(uuid); SID=$(uuid)
BODY_B=$(jq -cn --arg eid "$EID" --arg sid "$SID" --arg uid "$USER_B_ID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid,
    completed_at:"2026-04-29T20:00:00Z",
    solarpro_user_id:$uid,
    project_name:"SMOKE-HIJACK-VICTIM-projectB"}')
HTTP=$(send_webhook "$BODY_B" /tmp/hijack-victim.json)
VICTIM_PID=$(jq -r '.projectId // empty' /tmp/hijack-victim.json)
echo "  Victim project id: $VICTIM_PID (HTTP $HTTP)"
if [[ -z "$VICTIM_PID" ]]; then
  echo "ERROR: Could not create victim project; body=$(cat /tmp/hijack-victim.json)"
  exit 2
fi
sleep 2

VICTIM_OWNER=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500" \
  | jq -r --arg pid "$VICTIM_PID" '(.data // .projects // [])[] | select(.id == $pid) | .owner_email // "-"')
echo "  Victim project owner_email: $VICTIM_OWNER (expected $USER_B_EMAIL)"
if [[ "$VICTIM_OWNER" != "$USER_B_EMAIL" ]]; then
  echo "ERROR: Victim project not owned by User B (got $VICTIM_OWNER). Cannot proceed with hijack test."
  exit 2
fi

# -----------------------------------------------------------------------------
# STEP 2: User A (attacker) sends webhook claiming their own user_id
#         but targets User B's project_id via solarpro_project_id.
# -----------------------------------------------------------------------------
echo
echo "==== Step 2: Attacker (User A) tries to attach to User B's project ===="
EID=$(uuid); SID=$(uuid)
BODY_ATTACK=$(jq -cn --arg eid "$EID" --arg sid "$SID" \
                     --arg uid "$USER_A_ID" --arg pid "$VICTIM_PID" \
  '{event:"survey.completed", event_id:$eid, survey_id:$sid,
    completed_at:"2026-04-29T20:00:00Z",
    solarpro_user_id:$uid,
    solarpro_project_id:$pid,
    project_name:"SMOKE-HIJACK-ATTEMPT"}')
HTTP=$(send_webhook "$BODY_ATTACK" /tmp/hijack-attack.json)
ATTACK_PID=$(jq -r '.projectId // empty' /tmp/hijack-attack.json)
ATTACK_CREATED=$(jq -r '.created // empty' /tmp/hijack-attack.json)
echo "  HTTP: $HTTP"
echo "  projectId: $ATTACK_PID"
echo "  created:   $ATTACK_CREATED"
echo "  full body: $(cat /tmp/hijack-attack.json)"
sleep 2

# -----------------------------------------------------------------------------
# STEP 3: Verify the outcome.
# -----------------------------------------------------------------------------
echo
echo "==== Step 3: Verify end state ===="

NEW_VICTIM_OWNER=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500" \
  | jq -r --arg pid "$VICTIM_PID" '(.data // .projects // [])[] | select(.id == $pid) | .owner_email // "-"')
echo "  Victim project owner AFTER attack: $NEW_VICTIM_OWNER (expected unchanged: $USER_B_EMAIL)"

VERDICT="UNKNOWN"
ATTACK_REASON=$(jq -r '.reason // empty' /tmp/hijack-attack.json)
ATTACK_ERR=$(jq -r '.ingestError // empty' /tmp/hijack-attack.json)
ATTACK_CODE=$(jq -r '.ingestErrorCode // empty' /tmp/hijack-attack.json)

if [[ "$NEW_VICTIM_OWNER" != "$USER_B_EMAIL" ]]; then
  VERDICT="CRITICAL_VULN: victim project's owner changed to $NEW_VICTIM_OWNER"
elif [[ "$ATTACK_PID" == "$VICTIM_PID" ]]; then
  VERDICT="CRITICAL_VULN: attacker's webhook attached to victim project ($VICTIM_PID) — could overwrite data"
elif [[ "$ATTACK_REASON" == "INGEST_FAILED_BUT_LOGGED" ]] && \
     [[ "$ATTACK_CODE" == "DB_WRITE_FAILED" ]] && \
     [[ "$ATTACK_ERR" == *"ATTACH_TO_EXISTING"*"not found for owner"* ]]; then
  VERDICT="SAFE: ingest pipeline rejected cross-tenant attach with DB_WRITE_FAILED / ATTACH_TO_EXISTING (victim project untouched, no attacker project created)"
elif [[ -n "$ATTACK_PID" && "$ATTACK_PID" != "$VICTIM_PID" ]]; then
  ATTACK_OWNER=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500" \
    | jq -r --arg pid "$ATTACK_PID" '(.data // .projects // [])[] | select(.id == $pid) | .owner_email // "-"')
  echo "  Attacker's new project owner: $ATTACK_OWNER (expected $USER_A_EMAIL)"
  if [[ "$ATTACK_OWNER" == "$USER_A_EMAIL" ]]; then
    VERDICT="SAFE: attacker got new orphan project under their own account (not victim's)"
  else
    VERDICT="CONCERN: attacker got new project but owner is $ATTACK_OWNER (not User A)"
  fi
elif [[ "$HTTP" == "4"* ]] && [[ -z "$ATTACK_PID" ]]; then
  VERDICT="SAFE: attack rejected (HTTP $HTTP)"
else
  VERDICT="REVIEW: HTTP=$HTTP, projectId=$ATTACK_PID, created=$ATTACK_CREATED, reason=$ATTACK_REASON, err=$ATTACK_ERR"
fi

echo
echo "==== VERDICT: $VERDICT ===="