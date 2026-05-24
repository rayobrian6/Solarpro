#!/usr/bin/env bash
set -u
VALIDATION_DIR="outputs/real-survey-data-validation/geometry-candidate-review-workspace-v1-validation"
SUMMARY="$VALIDATION_DIR/validation-summary.md"
: > "$SUMMARY"
printf '# Geometry Candidate Review Workspace V1 Validation Summary\n\n' >> "$SUMMARY"
run_check() {
  local name="$1"
  shift
  local log="$VALIDATION_DIR/${name}.log"
  printf '## %s\n\nCommand: `%s`\n\n' "$name" "$*" >> "$SUMMARY"
  set +e
  "$@" > "$log" 2>&1
  local exit_code=$?
  set -e
  printf 'Exit code: `%s`\n\nLog: `%s`\n\n' "$exit_code" "$log" >> "$SUMMARY"
  echo "$name exit=$exit_code"
  return "$exit_code"
}
set +e
FAILURES=0
run_check check-assisted-evidence-boundaries npm run check:assisted-evidence-boundaries || FAILURES=$((FAILURES+1))
run_check check-engineering-boundaries npm run check:engineering-boundaries || FAILURES=$((FAILURES+1))
run_check check-topology npm run check:topology || FAILURES=$((FAILURES+1))
run_check type-check npm run type-check || FAILURES=$((FAILURES+1))
run_check targeted-geometry-candidate-review-workspace npx vitest run tests/geometryCandidateReviewWorkspace.test.tsx --reporter=verbose || FAILURES=$((FAILURES+1))
run_check npm-test npm test || FAILURES=$((FAILURES+1))
run_check build npm run build || FAILURES=$((FAILURES+1))
run_check lint npm run lint || FAILURES=$((FAILURES+1))
printf '## Overall\n\nFailures: `%s`\n' "$FAILURES" >> "$SUMMARY"
exit "$FAILURES"
