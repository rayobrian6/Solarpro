#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-test-battery.sh
#
# END-GOAL PROOF: verify that ANY user who completes a site survey has their
# survey land in THEIR OWN account — never the default/admin account.
#
# Runs the multi-user test against N different users (N=3 by default).
# Also runs a Case-1 ATTACH test to prove solarpro_project_id routing.
#
# Produces a human-readable receipt at scripts/smoke-test-battery-receipt.md
#
# USAGE:
#   ./scripts/smoke-test-battery.sh
#
# REQUIREMENTS:
#   - ADMIN_EMAIL, ADMIN_PASSWORD, SURVEY_WEBHOOK_SECRET env vars
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-raymond.obrian@yahoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Ray1obrian#}"
RECEIPT="${RECEIPT:-scripts/smoke-test-battery-receipt.md}"

if [[ -z "${SURVEY_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: SURVEY_WEBHOOK_SECRET env var not set" >&2
  exit 2
fi

COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR /tmp/sbattery-*.json" EXIT

# ---- Helpers ---------------------------------------------------------------
step()  { echo; echo "==> $1"; }
pass()  { echo "    ✅ $1"; }
fail()  { echo "    ❌ $1"; FAILS=$((FAILS + 1)); }
FAILS=0

sign_body() {
  local body="$1" ts="$2"
  TS="$ts" printf '%s' "$body" | TS="$ts" python3 -c "
import hmac, hashlib, os, sys
secret = os.environ['SURVEY_WEBHOOK_SECRET'].encode()
ts     = os.environ['TS'].encode()
body   = sys.stdin.buffer.read()
print('sha256=' + hmac.new(secret, ts + b'.' + body, hashlib.sha256).hexdigest())
"
}

send_webhook() {
  local body="$1" outfile="$2"
  local ts
  ts=$(date +%s)
  export TS="$ts"
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

build_envelope() {
  # $1=survey_id $2=event_id $3=solarpro_user_id $4=completed_at $5=[project_id_or_empty]
  local sid="$1" eid="$2" uid="$3" at="$4" pid="${5:-}"
  if [[ -n "$pid" ]]; then
    jq -cn --arg sid "$sid" --arg eid "$eid" --arg uid "$uid" \
           --arg at "$at" --arg base "$BASE_URL" --arg pid "$pid" \
      '{event:"survey.completed", event_id:$eid, survey_id:$sid,
        survey_url:($base+"/api/survey/mock/"+$sid), completed_at:$at,
        solarpro_user_id:$uid, solarpro_project_id:$pid}'
  else
    jq -cn --arg sid "$sid" --arg eid "$eid" --arg uid "$uid" \
           --arg at "$at" --arg base "$BASE_URL" \
      '{event:"survey.completed", event_id:$eid, survey_id:$sid,
        survey_url:($base+"/api/survey/mock/"+$sid), completed_at:$at,
        solarpro_user_id:$uid}'
  fi
}

# ---- Login as admin so we can verify ownership server-side -----------------
step "[0/N] Admin login (for server-side ownership checks)"
LOGIN=$(curl -sS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$LOGIN" | jq -e '.data.user.id' > /dev/null || { echo "admin login failed: $LOGIN"; exit 1; }
ADMIN_ID=$(echo "$LOGIN" | jq -r '.data.user.id')
ADMIN_ROLE=$(echo "$LOGIN" | jq -r '.data.user.role')
pass "admin=$ADMIN_ID role=$ADMIN_ROLE"

ADMIN_PROJECTS_BEFORE=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/projects" | jq '.data | length')
pass "admin's project count BEFORE test: $ADMIN_PROJECTS_BEFORE"

# ---- Define test users -----------------------------------------------------
# Format: id|email|name
declare -a USERS=(
  "195c3524-540b-43bc-8da1-43e3aa5f1eac|testagent.solarpro.2025@gmail.com|Test Agent"
  "45e7b558-9a5a-4335-909b-eb1f663c71fe|austinhancock47@gmail.com|Austin Hancock"
  "069416f6-87a6-4d8b-bf3f-ecf98b79c69b|jeff@solfence.solar|Jeff WIllis"
)

declare -a RESULTS=()

# ---- CASE 2 (CREATE_ORPHAN) for each user ---------------------------------
for entry in "${USERS[@]}"; do
  IFS='|' read -r USER_ID USER_EMAIL USER_NAME <<< "$entry"
  step "CASE 2 — CREATE_ORPHAN for $USER_EMAIL"

  [[ "$USER_ID" != "$ADMIN_ID" ]] || { fail "test user equals admin"; continue; }

  SID="battery-c2-$(date +%s%N)-$RANDOM"
  EID="evt-c2-$(date +%s%N)-$RANDOM"
  COMPLETED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  BODY=$(build_envelope "$SID" "$EID" "$USER_ID" "$COMPLETED")

  HTTP=$(send_webhook "$BODY" "/tmp/sbattery-c2-$USER_ID.json")

  if [[ "$HTTP" != "200" && "$HTTP" != "202" ]]; then
    fail "HTTP=$HTTP body=$(cat /tmp/sbattery-c2-$USER_ID.json)"
    RESULTS+=("| $USER_EMAIL | CASE-2 CREATE | ❌ HTTP $HTTP | - | - |")
    continue
  fi

  OK=$(jq -r '.success' /tmp/sbattery-c2-$USER_ID.json)
  PID=$(jq -r '.projectId' /tmp/sbattery-c2-$USER_ID.json)
  CREATED=$(jq -r '.created' /tmp/sbattery-c2-$USER_ID.json)
  [[ "$OK" == "true" && -n "$PID" && "$PID" != "null" ]] \
    || { fail "body shape bad: $(cat /tmp/sbattery-c2-$USER_ID.json)"; continue; }
  pass "webhook OK (HTTP=$HTTP, projectId=$PID, created=$CREATED)"

  # Verify ownership via admin projects endpoint
  ADMIN_VIEW=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=500")
  ACTUAL_OWNER=$(echo "$ADMIN_VIEW" | jq -r --arg pid "$PID" \
    '(.data // .projects // [])[] | select(.id == $pid) | .owner_email // "-"')

  if [[ "$ACTUAL_OWNER" == "$USER_EMAIL" ]]; then
    pass "ownership CORRECT: project $PID owned by $USER_EMAIL"
    RESULTS+=("| $USER_EMAIL | CASE-2 CREATE | ✅ | $PID | $ACTUAL_OWNER |")
  else
    fail "OWNERSHIP WRONG: project $PID owned by '$ACTUAL_OWNER', expected '$USER_EMAIL'"
    RESULTS+=("| $USER_EMAIL | CASE-2 CREATE | ❌ OWNER WRONG | $PID | $ACTUAL_OWNER |")
  fi

  # Verify it does NOT leak into admin's list
  LEAK=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/projects" \
    | jq --arg pid "$PID" '[.data[]? | select(.id == $pid)] | length')
  if [[ "$LEAK" == "0" ]]; then
    pass "project $PID NOT visible in admin's /api/projects (isolation OK)"
  else
    fail "project $PID LEAKED into admin's /api/projects (multi-tenancy broken)"
  fi

  # Remember the project_id for the ATTACH test
  declare -A CASE2_PROJECTS 2>/dev/null || true
  CASE2_PROJECTS[$USER_ID]="$PID"
done

# ---- CASE 1 (ATTACH) for first user ---------------------------------------
IFS='|' read -r USER_ID USER_EMAIL USER_NAME <<< "${USERS[0]}"
EXISTING_PID="${CASE2_PROJECTS[$USER_ID]:-}"

step "CASE 1 — ATTACH to existing project for $USER_EMAIL"
if [[ -z "$EXISTING_PID" ]]; then
  fail "no existing project id available for attach test"
  RESULTS+=("| $USER_EMAIL | CASE-1 ATTACH | ❌ no pid available | - | - |")
else
  SID="battery-c1-$(date +%s%N)-$RANDOM"
  EID="evt-c1-$(date +%s%N)-$RANDOM"
  COMPLETED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  BODY=$(build_envelope "$SID" "$EID" "$USER_ID" "$COMPLETED" "$EXISTING_PID")

  HTTP=$(send_webhook "$BODY" "/tmp/sbattery-c1.json")

  if [[ "$HTTP" != "200" && "$HTTP" != "202" ]]; then
    fail "HTTP=$HTTP body=$(cat /tmp/sbattery-c1.json)"
    RESULTS+=("| $USER_EMAIL | CASE-1 ATTACH | ❌ HTTP $HTTP | - | - |")
  else
    OK=$(jq -r '.success' /tmp/sbattery-c1.json)
    RETURNED_PID=$(jq -r '.projectId' /tmp/sbattery-c1.json)
    CREATED=$(jq -r '.created' /tmp/sbattery-c1.json)

    if [[ "$OK" == "true" && "$RETURNED_PID" == "$EXISTING_PID" && "$CREATED" == "false" ]]; then
      pass "attach OK: projectId=$RETURNED_PID, created=false (attached, not new)"
      RESULTS+=("| $USER_EMAIL | CASE-1 ATTACH | ✅ | $RETURNED_PID | attached (created=false) |")
    else
      fail "attach response unexpected: $(cat /tmp/sbattery-c1.json)"
      RESULTS+=("| $USER_EMAIL | CASE-1 ATTACH | ❌ $(cat /tmp/sbattery-c1.json) | - | - |")
    fi
  fi
fi

# ---- Isolation bookend: admin project count should not have grown ---------
step "FINAL — Admin's project count must not have grown"
ADMIN_PROJECTS_AFTER=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/projects" | jq '.data | length')
if [[ "$ADMIN_PROJECTS_AFTER" == "$ADMIN_PROJECTS_BEFORE" ]]; then
  pass "admin project count unchanged: $ADMIN_PROJECTS_AFTER (before=$ADMIN_PROJECTS_BEFORE)"
else
  fail "admin project count changed: $ADMIN_PROJECTS_BEFORE -> $ADMIN_PROJECTS_AFTER — surveys are leaking into admin"
fi

# ---- Write receipt --------------------------------------------------------
step "Writing receipt to $RECEIPT"
mkdir -p "$(dirname "$RECEIPT")"
{
  echo "# Multi-User Smoke Test Battery — Receipt"
  echo
  echo "**Run at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Target:** $BASE_URL"
  echo "**Admin:** $ADMIN_EMAIL ($ADMIN_ID)"
  echo "**Commit:** $(cd $(dirname $0)/.. 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo
  echo "## Goal"
  echo
  echo "Prove that when ANY user completes a site survey, the resulting project"
  echo "lands in THAT USER'S account — not the admin's, not a shared default."
  echo
  echo "## Results"
  echo
  echo "| User | Scenario | Status | Project ID | Owner as seen by admin |"
  echo "|------|----------|--------|------------|------------------------|"
  for line in "${RESULTS[@]}"; do
    echo "$line"
  done
  echo
  echo "## Isolation Check"
  echo
  echo "- Admin's project count BEFORE test: $ADMIN_PROJECTS_BEFORE"
  echo "- Admin's project count AFTER test:  $ADMIN_PROJECTS_AFTER"
  echo "- Delta: $((ADMIN_PROJECTS_AFTER - ADMIN_PROJECTS_BEFORE))"
  echo "- Expected delta: 0 (no survey should land in admin's account)"
  echo
  echo "## Verdict"
  echo
  if [[ "$FAILS" == "0" ]]; then
    echo "✅ **ALL CHECKS PASSED** — multi-tenant survey pipeline is working correctly."
    echo
    echo "Any user who completes a site survey will have it saved to their own"
    echo "account, not yours. The critical routing bug is fixed."
  else
    echo "❌ **$FAILS CHECK(S) FAILED** — see the table above for details."
  fi
} > "$RECEIPT"

cat "$RECEIPT"

echo
echo "==================================================================="
if [[ "$FAILS" == "0" ]]; then
  echo " ALL BATTERY TESTS PASSED (receipt: $RECEIPT)"
else
  echo " $FAILS FAILURE(S) — see receipt: $RECEIPT"
  exit 1
fi
echo "==================================================================="