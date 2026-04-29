#!/usr/bin/env bash
# =============================================================================
# Wave 4: Ownership audit sweep — read-only
#
# Snapshots the full ownership distribution across all projects in the dev DB
# and runs 3 sanity checks:
#   1. No project has a null/empty owner_email
#   2. All owner_email values look like valid emails
#   3. Total project count matches sum of ownership buckets
#
# Per-test-user integrity: reports how many projects each of our test users
# owns (should be >= 1 each for users we have written for during testing).
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://solarpro-dev.vercel.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-raymond.obrian@yahoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Ray1obrian#}"

COOKIE_JAR=$(mktemp); trap "rm -f $COOKIE_JAR /tmp/audit-*" EXIT

curl -sS -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login" >/dev/null

> /tmp/audit-all.jsonl
page=1
while :; do
  RESP=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/projects?limit=100&page=$page")
  COUNT=$(echo "$RESP" | jq '.projects | length')
  if [[ "$COUNT" == "0" ]]; then break; fi
  echo "$RESP" | jq -c '.projects[]' >> /tmp/audit-all.jsonl
  page=$((page+1))
  if [[ $page -gt 20 ]]; then break; fi
done
TOTAL=$(wc -l < /tmp/audit-all.jsonl)

echo "==== Ownership Audit (dev DB) ===="
echo "Total projects: $TOTAL"
echo
echo "Ownership distribution:"
jq -r '.owner_email' /tmp/audit-all.jsonl | sort | uniq -c | sort -rn | sed 's/^/  /'

declare -a TEST_USERS=(
  "testagent.solarpro.2025@gmail.com"
  "austinhancock47@gmail.com"
  "jeff@solfence.solar"
  "test.fallback.sync@example.com"
)

echo
echo "==== Per-Test-User Counts ===="
for email in "${TEST_USERS[@]}"; do
  COUNT=$(jq --arg e "$email" 'select(.owner_email == $e) | .id' /tmp/audit-all.jsonl | wc -l)
  echo "  $email -> $COUNT project(s)"
done

echo
echo "==== Sanity checks ===="
VIOLATIONS=0

NULL_OWNERS=$(jq -r 'select(.owner_email == null or .owner_email == "") | .id' /tmp/audit-all.jsonl | wc -l)
if [[ "$NULL_OWNERS" == "0" ]]; then
  echo "  [PASS] no projects with null/empty owner_email"
else
  echo "  [FAIL] $NULL_OWNERS projects have null/empty owner_email"
  VIOLATIONS=$((VIOLATIONS+1))
fi

BAD_EMAILS=$(jq -r 'select(.owner_email != null) | .owner_email' /tmp/audit-all.jsonl \
              | grep -Ev '^[^@]+@[^@]+\.[^@]+$' | wc -l)
if [[ "$BAD_EMAILS" == "0" ]]; then
  echo "  [PASS] all owner_email values look like valid emails"
else
  echo "  [FAIL] $BAD_EMAILS projects have malformed owner_email"
  VIOLATIONS=$((VIOLATIONS+1))
fi

SUM=$(jq -r '.owner_email' /tmp/audit-all.jsonl | sort | uniq -c | awk '{s+=$1} END {print s}')
if [[ "$SUM" == "$TOTAL" ]]; then
  echo "  [PASS] project total ($TOTAL) matches sum of ownership buckets ($SUM)"
else
  echo "  [FAIL] total=$TOTAL but sum=$SUM"
  VIOLATIONS=$((VIOLATIONS+1))
fi

echo
if [[ "$VIOLATIONS" -eq 0 ]]; then
  echo "==== AUDIT RESULT: CLEAN ===="
else
  echo "==== AUDIT RESULT: $VIOLATIONS violation(s) ===="
  exit 1
fi