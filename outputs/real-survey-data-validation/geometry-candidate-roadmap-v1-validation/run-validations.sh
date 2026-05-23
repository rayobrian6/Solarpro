#!/usr/bin/env bash
set +euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT_DIR="$ROOT_DIR/outputs/real-survey-data-validation/geometry-candidate-roadmap-v1-validation"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR" || exit 1

run_check() {
  local name="$1"
  shift
  echo "Running $name: $*"
  "$@" > "$OUT_DIR/$name.log" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$OUT_DIR/$name.exit"
  echo "$name exit=$code"
}

run_check check-assisted-evidence-boundaries npm run check:assisted-evidence-boundaries
run_check check-engineering-boundaries npm run check:engineering-boundaries
run_check check-topology npm run check:topology
run_check type-check npm run type-check
run_check targeted-geometry-runtime npm test -- lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.test.ts
run_check npm-test npm test
run_check build npm run build
run_check lint npm run lint
