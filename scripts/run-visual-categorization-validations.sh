#!/usr/bin/env bash
set -u
OUT_DIR="outputs/real-survey-data-validation/visual-categorization-validation-v1"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/validation-summary.txt"
: > "$SUMMARY"

run_check() {
  local name="$1"
  shift
  local log="$OUT_DIR/${name}.log"
  echo "=== $name ===" | tee -a "$SUMMARY"
  echo "command: $*" | tee -a "$SUMMARY"
  "$@" > "$log" 2>&1
  local exit_code=$?
  echo "exit_code: $exit_code" | tee -a "$SUMMARY"
  echo "log: $log" | tee -a "$SUMMARY"
  echo | tee -a "$SUMMARY"
  return 0
}

run_check check-engineering-boundaries npm run check:engineering-boundaries
run_check check-topology npm run check:topology
run_check check-assisted-evidence-boundaries npm run check:assisted-evidence-boundaries
run_check type-check npm run type-check
run_check targeted-visual-runtime-tests npm exec vitest -- lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.test.ts --run
run_check npm-test npm test
run_check build npm run build
run_check lint npm run lint

if grep -q "exit_code: [^0]" "$SUMMARY"; then
  echo "VALIDATION_STATUS=failed" | tee -a "$SUMMARY"
  exit 1
fi

echo "VALIDATION_STATUS=passed" | tee -a "$SUMMARY"
