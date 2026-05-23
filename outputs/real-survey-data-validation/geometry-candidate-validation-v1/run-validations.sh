#!/usr/bin/env bash
set +e
run_and_capture() {
  local name="$1"
  shift
  echo "=== Running ${name}: $* ==="
  "$@" > "outputs/real-survey-data-validation/geometry-candidate-validation-v1/${name}.log" 2>&1
  local code=$?
  printf '%s\n' "$code" > "outputs/real-survey-data-validation/geometry-candidate-validation-v1/${name}.exit"
  echo "=== ${name} exit ${code} ==="
  return 0
}
run_and_capture check-engineering-boundaries npm run check:engineering-boundaries
run_and_capture check-topology npm run check:topology
run_and_capture check-assisted-evidence-boundaries npm run check:assisted-evidence-boundaries
run_and_capture type-check npm run type-check
run_and_capture targeted-geometry-runtime npm test -- lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.test.ts
run_and_capture npm-test npm test
run_and_capture build npm run build
run_and_capture lint npm run lint
