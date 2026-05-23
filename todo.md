# Survey Ingestion Runtime Alignment V1 Todo

## Baseline and Audit
- [x] Confirm repository is on dev and inspect current state
- [x] Audit existing Survey V2 ingestion, photo handling, metadata, duplicate, blur, hashing, storage, and provenance flows
- [x] Generate survey ingestion runtime alignment audit report

## Runtime Intake and Bridge
- [x] Select safest metadata/photo-quality runtime package and document intake decision
- [x] Align governed runtime bridge with existing survey ingestion logic without duplicate truth systems
- [x] Expand boundary guard against runtime bypass, duplicate systems, and escalation paths
- [x] Expand review-only admin surfacing if needed for fixture versus runtime provenance

## Tests and Reports
- [x] Add deterministic audit-alignment, runtime governance, runtime behavior, and boundary tests
- [x] Generate metadata runtime intake, bridge, and boundary reports
- [x] Run required validations and capture logs/exits

## Delivery
- [x] Stage intended files and commit directly to dev
- [x] Push dev only
- [x] Provide final summary and safety guarantees
