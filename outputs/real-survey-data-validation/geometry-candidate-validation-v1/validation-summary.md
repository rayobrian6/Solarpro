# Geometry Candidate Validation V1 Summary

All required validation commands for the controlled geometry-adjacent evidence pilot completed successfully with exit code `0`.

| Command | Log | Exit file | Result |
| --- | --- | --- | --- |
| `npm run check:engineering-boundaries` | `check-engineering-boundaries.log` | `check-engineering-boundaries.exit` | PASS |
| `npm run check:topology` | `check-topology.log` | `check-topology.exit` | PASS |
| `npm run check:assisted-evidence-boundaries` | `check-assisted-evidence-boundaries.log` | `check-assisted-evidence-boundaries.exit` | PASS |
| `npm run type-check` | `type-check.log` | `type-check.exit` | PASS |
| `npm test -- lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.test.ts` | `targeted-geometry-runtime.log` | `targeted-geometry-runtime.exit` | PASS |
| `npm test` | `npm-test.log` | `npm-test.exit` | PASS |
| `npm run build` | `build.log` | `build.exit` | PASS |
| `npm run lint` | `lint.log` | `lint.exit` | PASS |

The full `npm test` run passed 159 test files and 4,933 tests. Lint completed with warnings only and exit code `0`.

The passing boundary checks confirm that the pilot remains isolated from CAD, roof-plane, setback, layout, NEC, engineering, workflow, recommendation, BOM, plan-set, and canonical mutation authority. The targeted geometry runtime tests confirm deterministic replay behavior, registry governance, review-required lifecycle, candidate-only stale propagation, projection-only review behavior, and absence of active measurable geometry payload fields.
