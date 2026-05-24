# Geometry Candidate Review Action UI V1

## UI Scope

The Engineering Intelligence admin workspace now displays the audited Geometry Candidate Review Action Path V1 for existing `possible_obstruction_candidate` candidates only. The workspace remains explicitly non-authoritative and review-only. It does not add drawing, measurement, CAD placement, roof-plane editing, setback creation, layout editing, NEC evaluation, engineering regeneration, workflow creation, recommendation triggering, canonical survey evidence mutation, or canonical geometry mutation controls.

## Controls

The UI renders exactly the two approved action labels as disabled buttons: `accept_for_review_projection` and `reject_candidate`. The controls are intentionally disabled in V1 because the audit did not identify an approved durable persistence pattern. The UI describes them as deterministic DTO previews and clearly states `NO LIVE DB WRITE`, `PROJECTION ONLY`, and `NO DOWNSTREAM AUTHORITY`.

## Read-Only Audit Display

For candidates still in `review_required` state, the workspace calls the audited lifecycle helpers with deterministic preview reviewer metadata and renders the returned audit DTO. The accept audit card shows action type, persistence mode, prior/resulting state, reviewer label, timestamp, projection ID/hash, candidate hash, runtime payload hash, source lineage, boundary policy, canonical mutation flag, CAD mutation flag, engineering influence flag, workflow/recommendation flags, and deterministic notes. The reject audit card shows action type, persistence mode, prior/resulting state, reviewer label, timestamp, null projection fields, rejection reason, candidate hash, runtime payload hash, source lineage, canonical mutation flag, CAD mutation flag, engineering influence flag, downstream authority flag, and deterministic notes.

## Non-Reviewable Candidates

If a candidate is not `review_required`, the workspace does not create action previews. It displays a read-only message that lifecycle helpers reject already-reviewed, invalidated, superseded, or unsupported candidates. This preserves the server-side review lifecycle validation in the UI.

## Safety Posture

The UI imports only the audited assisted-evidence lifecycle helpers and renders returned DTO fields. It does not define a form action, submit handler, live mutation handler, API call, database call, CAD call, engineering call, workflow call, recommendation call, or canonical evidence call. Targeted UI tests verify that only the approved disabled action buttons are present and that unsafe controls remain absent.
