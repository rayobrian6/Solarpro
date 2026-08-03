# WS-5 — FIELD-MEASUREMENT REACHABILITY AND VERIFIED-AUTHORITY CLOSURE

**Date:** 2026-08-02
**Branch:** `dev`
**Starting remote HEAD:** `9402824a279440497bd72209ae0acbe3a1cc71b3` (0 ahead / 0 behind at start)

---

## 1. BRANCH AND ANCESTRY VERIFICATION

`origin/dev` was fetched before any change. The remote HEAD was **exactly** the expected
baseline — the branch had not advanced, so no movement needed documenting.

```
origin/dev                = 9402824a279440497bd72209ae0acbe3a1cc71b3
local HEAD                = 9402824a279440497bd72209ae0acbe3a1cc71b3
ahead/behind              = 0 / 0
tracked working tree      = clean
```

The only tracked modification at start was `next-env.d.ts`, a Next-generated file
touched by a prior dev-server run; it was restored, not committed.

**Ancestry confirmed** (`git merge-base --is-ancestor` for each):

| Commit | Subject | Ancestor |
|---|---|---|
| `9402824a` | WS-5 part 1 — source/state separation | ✔ |
| `78320084` | R8 — dev as the integration branch | ✔ |
| `eb2cde6f` | SOC 2 / ISO 27001 merge + Next 15 / React 19 | ✔ |
| `88b328b6` | Next 15 codemod leftovers + ssr:false repair | ✔ |
| `6a3cf0ed` | next 14.2.35 → 15.5.15, react 18 → 19 | ✔ |
| `f944906a` | D1 — route ownership | ✔ |
| `b108164b` | D2 — segment-specific grounding | ✔ |
| `f088e72a` | D3 — equipment schedule completeness | ✔ |
| `97468283` / `35b830bc` / `87f35c41` | D4 — embedded font pack + closure | ✔ |
| `1d2d7922` | WS-3 — conduit callout derivation | ✔ |
| `503ec7a9` | controlled rendering environment | ✔ |

`package.json` confirms `next 15.5.15`, `react 19.2.0`, `react-dom 19.2.0`.
No history was rewound, reset or force-pushed.

---

## 2. THE PERSISTENT DATA MODEL

`FieldRouteMeasurement` (`lib/fieldMeasurement/types.ts`) carries every field the
directive specifies. Two design decisions are worth stating because they are
adaptations to what this schema actually supports:

**TENANCY.** SolarPro projects carry no organization column — `projects.user_id` is
the only owner pointer, and the organization lives on the USER (`users.org_id`, and
the `organization_members` table from migration 105). The tenant of a project is
therefore DERIVED from its owner and must be expressible for both an org-owned
project and a solo operator's. The canonical key is a TEXT string —
`org:<uuid>` | `user:<uuid>` — with `tenant_organization_id UUID REFERENCES
organizations(id)` carrying the REAL foreign key for the org case and NULL for the
solo case. A UUID column alone could express only half the model.

**ROUTE SEGMENTS ARE NOT RELATIONAL ROWS.** `route_segment_id` is a
`RouteSegmentRecord.segmentId` (`BRANCH_RUN`, `FEEDER_RUN`, …), derived each build
from the design by `buildPermitDesignSnapshot`. It has no table and no surrogate
key, so there is nothing to reference. Integrity is enforced in the service
instead: a measurement is refused unless the named segment exists in the project's
current canonical snapshot AND its route authority applies. That check is a domain
read, and it is tested as one.

**Invariants, and where each is enforced:**

| Invariant | Enforced by |
|---|---|
| Exactly one tenant, one project | column + every query scoped by both |
| Route exists in the project's snapshot | service (`routeFact` + `routeAcceptsProjectMeasurement`) |
| Utility-owned EXCLUDED routes refuse the workflow | service (`ROUTE_NOT_APPLICABLE`, 422) **and** the build (fail-closed skip) |
| Length finite, positive, within engineering bounds | DB `CHECK (>0 AND ≤10000)` + service policy `[0.5, 2000] ft`, REFUSED not clamped |
| Method required, from the vocabulary | DB `CHECK` + `isMeasurementMethod` |
| Measured-by identity required | DB `NOT NULL` + server-stamped from the session |
| Measurement timestamp required, not future | DB `NOT NULL` + service (1-minute skew allowance) |
| Record timestamp system-generated | service (`recordedAt = now()`), never a request field |
| Default state `REPORTED_UNVERIFIED` | DB `DEFAULT` + `newMeasurementState()` (a constant function, not a defaulted parameter) |
| Verified records not overwritten in place | conditional `UPDATE … WHERE verification_state = 'REPORTED_UNVERIFIED'` |
| Rejected / superseded retain history | append-only; no `DELETE` exists in the schema or the service |
| Every transition audited | second table, written in the SAME transaction |
| Cross-tenant access fails closed | tenant predicate on every read and every guard |

---

## 3. MIGRATION REPORT

**`lib/migrations/118_field_route_measurements.sql`** — the next identifier after
117. Migration 117 was not modified; nothing was renumbered.

| | |
|---|---|
| Identifier | `118` |
| Tables | `field_route_measurements`, `field_route_measurement_events` |
| Statement shape | `CREATE TABLE IF NOT EXISTS` ×2, `CREATE INDEX IF NOT EXISTS` ×8 |
| Forbidden tokens found | **none** (`DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT/GRANT/REVOKE/RENAME/COPY/VACUUM/CREATE OR REPLACE`) |
| Seeded rows | **zero** |
| Static gate | `analyzeRegistryMigration('118', …)` → `ok: true`, `problems: []` |

**Indexes**

```
idx_frm_tenant_project      (tenant_id, project_id, recorded_at DESC)
idx_frm_project_segment     (project_id, route_segment_id, recorded_at DESC)
idx_frm_segment_state       (route_segment_id, verification_state)
idx_frm_project_state       (project_id, verification_state)
idx_frm_supersedes          (supersedes_measurement_id)
idx_frme_measurement        (measurement_id, occurred_at ASC)
idx_frme_project_segment    (project_id, route_segment_id, occurred_at DESC)
idx_frme_tenant             (tenant_id, occurred_at DESC)
```

**Constraints preventing impossible states**

```
ck_frm_length_positive      measured_length_ft > 0 AND ≤ 10000
ck_frm_method               method ∈ the five-value vocabulary
ck_frm_state                state ∈ the four-value vocabulary
ck_frm_mode                 mode NULL or ∈ the three-value vocabulary
ck_frm_verified_complete    VERIFIED ⇒ verifier AND time AND MODE all present
ck_frm_rejected_complete    REJECTED ⇒ rejector AND time AND non-empty reason
ck_frm_superseded_complete  SUPERSEDED ⇒ superseded_by pointer present
ck_frm_unverified_clean     REPORTED_UNVERIFIED ⇒ no verification or rejection facts
ck_frme_type                event_type ∈ the four-value vocabulary
```

`ck_frm_verified_complete` is the one that matters most: it makes "operator entry
silently became authority" a **storage error**, not a review finding.

**Foreign keys carry no `ON DELETE` clause.** That is deliberate, not an oversight:
the governed-registry static gate forbids the `DELETE` token outright, so
`REFERENCES organizations(id)` / `projects(id)` / `users(id)` are declared with the
default `NO ACTION`. It is stated in the migration header and pinned by a test.

**Governance wiring (all four gates, so the identifier is actually runnable):**

| Gate | Change |
|---|---|
| `REGISTRY_DEPLOYMENT` | `'118': { expectedTables: [field_route_measurements, field_route_measurement_events] }` |
| `REGISTRY_SEQUENCE` | `…, '117', '118'` |
| `TARGETED_RECOVERY_ALLOWLIST` | `…, '117', '118'` |
| Admin API action | `execute-field-measurements-118` |

**Governance test updates — honest literals, not manifest-derived:**

```
tests/phase1a-migration-governance.test.ts
  GOVERNED_MIGRATION_COUNT      114 → 115     (a LITERAL, deliberately not
                                               discoverMigrationFiles().count —
                                               deriving it would assert the manifest
                                               against itself and could never fail)
  HIGHEST_GOVERNED_MIGRATION    '117' → '118'
```

The count and the highest prefix move independently (the numbering is
non-contiguous); both were updated on purpose, and the test title now names 118.

**Migration is NOT run.** Migration 118 is written and governed; nobody has executed
it. Until an operator runs it through the console, the canonical resolver reports a
RETRYABLE store-unavailable failure naming that exact step, the CAD source stands,
and nothing is closed. That is the same posture migrations 113–117 are in.

---

## 4. REPOSITORY / SERVICE DESIGN

```
lib/fieldMeasurement/
  types.ts                 domain vocabulary, tenancy, bounds, authority projection,
                           input validation, structured errors
  capabilities.ts          the five capabilities, the org-role grant map, actor
                           resolution, requireCapability
  verificationPolicy.ts    the explicit policy evaluator (pure)
  evidence.ts              attachment resolution port + the site_survey_files adapter
  repository.ts            THE PORT + the in-memory adapter + audit-payload safety
  postgresRepository.ts    the migration-118 adapter (one sql.transaction per transition)
  service.ts               THE authoritative service
  resolver.ts              deterministic active selection + the authority bundle
                           + ROUTE_LENGTH_CLOSURE_POLICY
  permitAccess.ts          the permit path's READ-ONLY view + the route-fact source
  production.ts            production wiring + the HTTP error boundary
```

**Why a port.** Every transition must be atomic with its audit event: a
verification that commits without its event row is an unaudited promotion to
permit-grade authority, and an event without its transition is a lie in the audit
trail. Expressing that as "the service writes two rows" puts the requirement where
the next caller can forget it. Expressing it as `verify(command)` puts it in the
STORE CONTRACT, where both adapters must satisfy it and one shared suite proves
they do.

**Transaction boundaries.** Each Postgres transition is a single
`sql.transaction([...])`. The guard lives in the `WHERE` (`… AND verification_state
= 'REPORTED_UNVERIFIED'`), so it is atomic against a concurrent verifier; a
read-then-write would let two verifications both believe they won. The event
`INSERT … SELECT` matches on the exact marker our own `UPDATE` wrote, so a lost
race writes nothing at all.

**Service order, and it is load-bearing:** resolve the tenant OF THE PROJECT →
resolve the actor's capabilities within it → assert capability + project access →
read the route fact → resolve evidence FRESH → evaluate the policy → transition +
audit in one transaction → invalidate → mirror to the compliance log.

---

## 5. RBAC

```
route.measurement.read
route.measurement.record
route.measurement.verify
route.measurement.reject
route.measurement.supersede
```

Grants are keyed on the platform's OWN organization-role vocabulary (migration 105:
`owner | admin | member | viewer`). **No job title appears anywhere** — a test
greps the grant map for `installer / manager / engineer / foreman / technician /
electrician` and asserts none are present.

| Role | read | record | verify | reject | supersede |
|---|---|---|---|---|---|
| owner | ✔ | ✔ | ✔ | ✔ | ✔ |
| admin | ✔ | ✔ | ✔ | ✔ | ✔ |
| member | ✔ | ✔ | — | — | ✔ |
| viewer | ✔ | — | — | — | — |
| solo project owner | ✔ | ✔ | ✔ | ✔ | ✔ |

Verification sits above `member` because it is the act that converts an operator's
claim into permit-grade authority.

**Two independent gates, both required.** A capability without project access is
refused, and project access without the capability is refused. They are separate
fields on the actor and separate assertions, so one cannot silently satisfy the
other. Three refusals stay DISTINCT — `CROSS_TENANT`, `NO_PROJECT_ACCESS`,
`CAPABILITY_NOT_HELD` — because they are different security findings.

**Self-verification.** Default rule: `measuredByUserId !== verifiedByUserId`. A
tenant may lift it only by holding an explicit policy
(`organizations.settings.routeMeasurement.allowAuthorizedSelfVerification === true`,
fail-closed on absence). When lifted, `verificationMode =
AUTHORIZED_SELF_VERIFICATION` is RECORDED AT VERIFICATION TIME. It is never
inferred afterwards by comparing two user ids — that would be a guess about intent.

---

## 6. VERIFICATION POLICY

`evaluateVerificationPolicy` is pure and returns the specified decision shape plus
two additions that make the verdict auditable — `satisfied[]` (what was actually
checked, not merely that nothing objected) and `usedEvidenceException`.

Checks, in evaluation order: project-owned applicable route · record is in a
verifiable state · positive in-bounds length · valid method · measured-by identity
· measurement timestamp · evidence or a DOCUMENTED authorised exception ·
authorised verifier with a recorded MODE · written notes where the policy requires
them · server-supplied verification instant.

Notes are REQUIRED for the two paths that rest on judgement rather than on a second
pair of eyes plus an artefact: a self-verification, and a verification on an
evidence exception. A one-word "exception" (< 12 chars) is refused as not a
documented reason.

A mode is carried ONLY on an allowed decision — returning a mode beside a refusal is
how "we allowed this because…" gets reconstructed from a decision that never
happened.

---

## 7. EVIDENCE INTEGRATION

Attachments are references into the EXISTING `site_survey_files` store (migration
016), joined through `site_surveys` to the project. The join IS the scoping: a
cross-project id simply does not come back and lands in `invalid` rather than being
silently accepted.

- Evidence is validated at RECORD time (a reference that does not resolve is
  refused, so the record never carries a pointer to nothing) but is NOT required —
  a field report is a claim, and a claim with no photo is still a claim.
- Evidence is **re-resolved at VERIFICATION time**, not trusted from record time.
  An attachment deleted since the report was filed stops satisfying the policy
  rather than keeping a verification silently alive. Tested.
- Audit records carry attachment **IDs and counts only**. `assertAuditSafeDetail`
  refuses any detail key matching `content|bytes|blob|base64|dataUrl|fileUrl|url|
  body|text|raw`, any `data:` / `http(s):` value, and any string over 512 chars —
  before it reaches either adapter.
- An unreadable attachment store is reported as `storeError` with
  `sufficient: false`: "we could not look" is not "there is evidence".

---

## 8. API IMPLEMENTATION

```
GET    /api/projects/:id/route-measurements                                        (project roll-up)
POST   /api/projects/:id/routes/:routeSegmentId/measurements                       (record)
GET    /api/projects/:id/routes/:routeSegmentId/measurements                       (history)
POST   /api/projects/:id/routes/:routeSegmentId/measurements/:measurementId/verify
POST   /api/projects/:id/routes/:routeSegmentId/measurements/:measurementId/reject
POST   /api/projects/:id/routes/:routeSegmentId/measurements/:measurementId/supersede
```

All five appear in the production build output.

**The server supplies** the tenant, the project authorization context,
`measuredByUserId` / `verifiedByUserId` / `rejectedByUserId` (all from the
authenticated session), `recordedAt`, `verifiedAt`, `rejectedAt`, and the
verification state. `body.verificationState`, `body.measuredByUserId`,
`body.verifiedByUserId` and `body.verifiedAt` are **never read** by any handler —
tested by posting all four and asserting the record is unaffected.

**Status mapping** (`measurementErrorResponse`, one place, so handlers cannot
drift):

| Kind | Status | Example code |
|---|---|---|
| VALIDATION | 400 | `LENGTH_OUT_OF_BOUNDS`, `REJECTION_REASON_REQUIRED` |
| FORBIDDEN | 403 | `CAPABILITY_NOT_HELD`, `NO_PROJECT_ACCESS` |
| NOT_FOUND | 404 | `ROUTE_NOT_FOUND`, `MEASUREMENT_NOT_FOUND` |
| CONFLICT | 409 | `VERIFY_CONFLICT`, `SUPERSEDE_CONFLICT` |
| POLICY | 422 | `ROUTE_NOT_APPLICABLE`, `VERIFICATION_REFUSED` |
| UNAVAILABLE | 503 | `MEASUREMENT_STORE_NOT_DEPLOYED` (names migration 118) |

Two narrowings on the way out: `CROSS_TENANT` is reported as **404**, and
`NO_PROJECT_ACCESS` drops its details — `accessBasis` names the project's owning
ORGANISATION, which is exactly what a probe from another tenant must not learn. The
service still records the precise finding for the audit trail.

A repeated record POST creates a SECOND report rather than overwriting — correcting
a measurement is `supersede`, and the API does not quietly discard the earlier
claim.

---

## 9. OPERATOR UI

`components/project/RouteMeasurementPanel.tsx`, mounted inside
`components/engineering/EngineeringTab.tsx` → **Electrical Engineering** section,
directly beneath the AC/DC numbers it qualifies. It is not a separate developer
page: the operator looking at a voltage drop is exactly the person who needs to see
whether its length was measured.

Per applicable route the panel shows route id, from/to, electrical function,
ownership, applicability, CAD estimated length, CAD routed length, current
calculation length, current source, verification state, release impact, measurement
history count and evidence count — plus **measured-by and verified-by as two
separate rows, always**, even when they are the same person (especially then).

The six states render verbatim as specified: `NO FIELD MEASUREMENT` ·
`FIELD REPORTED — AWAITING VERIFICATION` (amber) · `FIELD VERIFIED` (the only green
in the component) · `FIELD MEASUREMENT REJECTED` · `FIELD MEASUREMENT SUPERSEDED` ·
`UTILITY-OWNED — EXCLUDED`.

Actions — enter length / method / date-time / notes / evidence, submit, verify,
reject with reason, supersede, view history — are hidden when the capability is
absent. **That is a courtesy, not the control**: every write is re-authorised
server-side regardless of what the panel rendered.

The report form states, in the form itself, that submitting files a FIELD REPORTED —
UNVERIFIED record that "closes nothing until an authorised reviewer verifies it".

---

## 10. AUDIT EVENTS

Domain events live in `field_route_measurement_events` and commit in the SAME
transaction as the transition:

```
ROUTE_MEASUREMENT_RECORDED · ROUTE_MEASUREMENT_VERIFIED
ROUTE_MEASUREMENT_REJECTED · ROUTE_MEASUREMENT_SUPERSEDED
```

Each row carries `tenant_id`, `tenant_organization_id`, `project_id`,
`route_segment_id`, `measurement_id`, `actor_user_id`, `previous_state`,
`new_state`, `snapshot_id`, `snapshot_digest`, `calculation_record_id`,
`detail` (ids and scalars only) and `occurred_at`.

**Durability is claimed precisely.** The atomic record is the event row. The
compliance `audit_log` (migration 100) is mirrored to on a **best-effort** basis and
is explicitly NOT the record of authority — `writeAuditLog` catches its own write
failure and falls back to a console line, which is right for a security log and
wrong for a domain state change. The mirror runs last and its failure is swallowed
by design; the durable record has already committed.

The remaining directive event names —
`ROUTE_LENGTH_RESOLVED` · `VOLTAGE_DROP_RECALCULATED` ·
`ROUTE_PROCUREMENT_RECALCULATED` · `RELEASE_REQUIREMENT_CLOSED` /
`REOPENED` — are **not** new audit-table rows. They are already the resolution
lifecycle's own evidence vocabulary: `field-route-measurement@v1` emits a
`ResolutionEvidenceRecord` plus a `ResolutionInvalidation` naming
`electrical.routeSegments[].calculationLengthFt / voltage drop / procurement
footage`, and the requirement's open/closed transition is the
`RequirementResolutionState` the RS-1 registry already renders. Adding a parallel
event table for facts the lifecycle already records would create a second place for
the same truth to live — the failure mode D1 and WS-3 both exist to prevent.

---

## 11. CANONICAL RESOLVER INTEGRATION

**Selection precedence (calculation):**

```
active FIELD_VERIFIED > active FIELD_REPORTED > CAD_ROUTE > CAD_DERIVED_ESTIMATE
```

**Release authority (closure):** `FIELD_VERIFIED` only.

Those are two different questions and they get two different functions —
`measurementSelectionRank()` and `closesFieldVerification()`.

**Determinism.** "The latest verified measurement" is ambiguous on a tie, and
"whatever the database returned first" is not a rule. The rule is stated, applied in
one function, and tested: VERIFIED outranks REPORTED_UNVERIFIED; within a rank the
later `verifiedAt` (or `recordedAt`) wins; ties break on the DESCENDING measurement
id — arbitrary but stable and total. Rejected and superseded records are excluded
BEFORE ranking, never ranked low. A test feeds the same rows in both orders and
asserts the same selection.

**Behaviour**

| State | lengthSource | verificationState | releaseSufficiency | closes? |
|---|---|---|---|---|
| field reported | `operator-entry` | `field-reported` | DESIGN_REVIEW_ONLY | no |
| field verified | `field-measurement` | `field-verified` | FINAL_RELEASE_READY | yes |
| rejected | — never selected — | | | |
| superseded | — never selected (retained as history) — | | | |

**§14's explicit CAD-geometry policy.** SolarPro already had one — the AAC §2.13
SPLIT ruling — but it lived as a bare `const ROUTE_GEOMETRY_SOURCES` array in one
resolver, where it read as an implementation detail rather than a decision. It is
now `ROUTE_LENGTH_CLOSURE_POLICY` with a stated basis, and both emitters (the
build's blocker and the derived resolver) call the same
`sourceClosesRouteLengthRequirement()`. It was NOT widened: `operator-entry` — an
unverified field report — is deliberately insufficient, and geometry still never
produces a VERIFIED_PASS voltage drop.

**Store unavailable ≠ store empty.** `unavailableFieldMeasurementAuthority` (42P01,
DB down) is RETRYABLE and names the console step; `emptyFieldMeasurementAuthority`
(readable, no rows) is REQUIRES_INPUT because retrying a read will not produce a
measurement — a person with a tape will. Both close nothing.

---

## 12. SNAPSHOT MAPPING AND INVALIDATION

Populated on the canonical `RouteSegmentRecord` when a measurement is active:
`calculationLengthFt`, `verifiedFieldLengthFt` (**only** from a VERIFIED record, so
a sheet can never read an unverified number out of a field named "verified"),
`oneWayFt`, `lengthSource`, `verificationState` / `verificationStatus`,
`lengthProvenance`, `procurementLengthFt`, `wasteFactor`, and `provenance` —
which carries `authority:fieldRouteMeasurement#<id>` plus the measurement, the
evidence count, the procurement derivation and the voltage-drop derivation.

A utility-owned EXCLUDED segment is skipped fail-closed even if an authority names
it. Tested with a deliberately forged authority.

**Invalidation.** Every transition writes a `snapshot_digest_invalidations` row
(migration 114) — scope `snapshot` for a record, `calculation` for a verify /
reject / supersede. `digest: null` is the ledger's "all current until rebuild" form,
which is the right claim: the measurement does not know which digest is live, and
naming the wrong one would leave the live artifact uninvalidated. Archived and
signed snapshots are never mutated. An invalidation failure is REPORTED to the
caller (`[INVALIDATION FAILED: …]`) rather than swallowed — a committed, audited
transition is not rolled back because the ledger was unreachable, but "the planset
may be stale" is never silent.

**Engine / schema version decision.** `PLANSET_ENGINE_VERSION` was **not** bumped
and the snapshot schema version was **not** changed. Reasoning: the fields WS-5
populates were already DECLARED on `RouteSegmentRecord` (WS-5 part 1 and the §10
length taxonomy) and were optional; no field was added, removed or retyped, and no
renderer contract changed. A project with no measurements produces a
byte-identical snapshot, so a version bump would invalidate every cached planset to
signal a change that did not occur for them. A project WITH a measurement gets a
different digest because its content genuinely differs, which is the correct
staleness signal and needs no version change to work.

---

## 13. VOLTAGE-DROP RECALCULATION

`recalculateRouteVoltageDrop` re-reads the conductor's DC resistance from its gauge
and recomputes `VD% = (2·I·R·L)/(V·1000)·100` from the segment's own current,
gauge and system voltage. It is a real recalculation, not a proportional rescale:
a shortcut would give the same answer today and would silently stop being right the
moment anything about the conductor is also re-resolved. Missing current, gauge or
voltage yields `null` → INDETERMINATE. A gauge the conductor table does not know
returns 0 from `calcVoltageDrop`, which is a refusal wearing the shape of a perfect
result; it is treated as indeterminate.

Grades are unchanged from WS-5 part 1 and were re-verified end to end:
verified + within criterion → `✓ VERIFIED PASS`; estimate / CAD route / unverified
report + within criterion → `PROVISIONAL PASS`; **any** usable length over the
criterion → `✗ FAIL`; missing inputs → `INDETERMINATE`.

**Two defects were found by doing this, both by looking at the rendered sheet
rather than by a unit test.**

1. **PV-4B printed "Vd = 0.37% over 89 ft"** — the pre-measurement percentage beside
   the measured length. `electrical.feeder.voltageDropPct` is a SECOND carrier of
   the same result and `projectCanonicalFeeder` prefers it over the segment.
   Patched in step; pinned by test 52, which asserts the projection and the segment
   agree.
2. **`RouteSegmentRecord.continuousCurrentA` / `operatingCurrentA` are null on
   EVERY run, on every project.** The mapper reads `r.continuousCurrentA` /
   `r.currentA`; the engine emits `continuousCurrent` (computed-system
   `RunSegment:196`). This is a PRE-EXISTING projection gap, NOT repaired here —
   populating those fields changes what PV-4B prints on every project. WS-5
   captures the engine's own current into a build-local map so the recalculation
   rests on the same basis the original result did, and names the gap in the code.
   **Recorded as an open defect.**

---

## 14. PROCUREMENT RECALCULATION

`lib/permit/snapshot/routeProcurementPolicy.ts` separates the length a conductor is
SIZED on from the length it is BOUGHT at, and itemises every foot of the difference:

| Allowance | Kind | Value | Basis |
|---|---|---|---|
| Termination | fixed | 2 ft | ~1 ft consumed in each of two enclosures making up to terminals; fixed because it does not grow with the run |
| Service loop | fixed | 1 ft | one documented loop at the equipment end |
| Route slack | multiplier | 1.05 | centre-line vs the path around supports, offsets and bends |
| Waste / cut | multiplier | 1.03 | reel cut loss — a yield figure, not a design margin |

Composed: `ceil(L × 1.05 × 1.03 + 3)`. On the controlled fixture, 87 ft measured →
98 ft ordered, `wasteFactor 1.0815`. Deliberately LESS than the legacy blanket 15%,
because a MEASURED route needs no allowance for being an estimate.

**The substitution happens once, at the engine.** Patching only the snapshot made
PV-4B correct and left the BOM wrong: conduit footage derives from
`RunSegment.onewayLengthFt` on the engine's run model, so a verified 89-ft run
printed 89 ft on the conductor schedule and ordered 23 ft of conduit — a package
contradicting itself about one run. `applyFieldMeasurementsToRuns` now runs before
the BOM and before the snapshot, on BOTH run models (the canonical one and the
second one `buildComputedRunsForPermit` derives for the BOM — a pre-existing
duplication this workstream does not restructure but does not let diverge either).

Measured (controlled fixture, verified): conduit **21 → 102 ft**, **23 → 103 ft**,
**18 → 104 ft**; couplings **2 → 10**; one-hole straps **4 → 12**. SCHED continuation
rows and the D3 reconciliation are preserved.

### Two documented open defects, NOT closed here

**`LEGACY_GLOBAL_SLACK`.** `lib/bom/deriveRunLengths.ts:44` multiplies every
heuristic run by `SLACK_FACTOR = 1.15` and stores the RESULT in `onewayLengthFt`,
which the snapshot then uses as the CALCULATION length. So on the estimate path the
voltage drop is computed against a procurement-padded number, and the 15% is never
decomposed into termination / service loop / route slack / waste. WS-5 does not
restate those numbers — unwinding them moves every existing VD result and BOM
footage on every project — but it does not extend the conflation to the
field-measured path, and it names the defect in code
(`routeProcurementPolicy.LEGACY_GLOBAL_SLACK`) rather than inheriting it silently.

**Two procurement numbers on a measured run.** `procurementLengthFt` on the
canonical segment uses the itemised policy (98/99/100/101 ft); the BOM engine's own
conduit rows still apply its 1.15 to the same measured length (102/103/104 ft).
Both are now derived from the MEASURED length — that is the WS-5 requirement — but
they use different allowance bases. Unifying them means changing the BOM engine's
factor, which moves every existing BOM quantity. **Recorded as an open defect.**

---

## 15. RELEASE CLOSURE AND REOPENING

Closure of `ROUTE-LENGTH-ESTIMATE` requires, per applicable project-owned segment:
a selected active measurement that is VERIFIED, not rejected, not superseded;
evidence policy satisfied; the verification action authorised; the canonical
calculation using the verified value; voltage drop recalculated; procurement
recalculated; the sheets projecting the verified source; and the snapshot digest
reflecting it. A field-reported unverified value closes nothing. Utility-owned
excluded routes remain excluded.

**Reopening is proven** for: a selected verified measurement REJECTED (the segment
falls back to the CAD source — not to the rejected number — and the requirement
returns naming that run), and a selected verified measurement SUPERSEDED without a
verified replacement (the replacement IS the calculation length at 93 ft and is
`field-reported`, so it closes nothing).

### A latent validator defect this made reachable

Invariant **V18** asserted that ANY estimate-grade segment must produce a
`ROUTE-LENGTH-ESTIMATE` blocker — unscoped by D1. It was latent while the
requirement was unclosable, because some project-owned run was always
estimate-grade and a blocker always existed. WS-5 makes closure reachable, and the
first fully measured project turned it into a hard build failure: every
project-owned run verified, the requirement correctly absent, and V18 firing
because the UTILITY-OWNED run still reads `cad-derived-estimate` — as it must, since
nobody may measure it. V18 is now D1-scoped, fail-closed on the applicability
decision, exactly like every other D1 consumer.

---

## 16. CONTROLLED REACHABILITY PROOF

`tests/planset/ws5-field-measurement-reachability.test.ts` — **21 tests, all
passing.**

**Braidon was not touched.** The proof runs on a controlled project identity
(`WS-5 CONTROLLED REACHABILITY FIXTURE`, `PROJECT_A`). Inserting an invented
measurement into Braidon to demonstrate reachability would make the live truth-state
a lie — the exact failure mode this workstream audits for.

**What runs for real:** the measurement service, the capability model, the
verification policy, the evidence resolver, the repository contract, the
deterministic selection rule, `buildFieldMeasurementAuthority`, and the whole
planset engine (`generatePermitHTML` → `buildPermitDesignSnapshot` → route
authority → `gradeVoltageDrop` → both `ROUTE-LENGTH-ESTIMATE` emitters).

**What is substituted:** the storage DRIVER and four external reads (project owner,
org membership, attachment lookup, route facts). Nothing writes a resolved snapshot
field, mutates a state directly, or bypasses RBAC or the policy service. Test 45
asserts the snapshots are frozen and that a direct write throws.

| Stage | source / state | calc | proc | VD | requirement |
|---|---|---|---|---|---|
| initial | `cad-derived-estimate` / `cad-derived-estimate` | 20 ft | — | 0.369% PROVISIONAL_PASS | **OPEN** |
| reported | `operator-entry` / `field-reported` | 89 ft | 100 ft | 1.642% PROVISIONAL_PASS | **OPEN** |
| verified | `field-measurement` / `field-verified` | 89 ft | 100 ft | 1.642% ✓ VERIFIED PASS | **CLOSED** |
| rejected | `cad-derived-estimate` / `cad-derived-estimate` | 20 ft | — | 0.369% PROVISIONAL_PASS | **REOPENED** |
| superseded (unverified replacement) | `operator-entry` / `field-reported` | 93 ft | 104 ft | recalculated | **REOPENED** |

Canonical resolver selection before: none (CAD source stands).
Canonical resolver selection after: the active VERIFIED measurement, by the stated
rule.

**Snapshot IDs (full profile, frozen fixture):**

```
no measurement          PDS-52CF36872161
field reported          PDS-375081B85CDB    (13 blockers)
field verified          PDS-DC49BF881C66    (12 blockers — ROUTE-LENGTH-ESTIMATE gone)
```

---

## 17. LIVE BRAIDON TRUTH-STATE

`tests/planset/ws5-braidon-truth-state.test.ts` — **11 tests, all passing.**

```
Verified field route measurements:      0
Project-owned unresolved routes:        4   ROOF_RUN, BRANCH_HOMERUN_RUN,
                                            COMBINER_TO_DISCO_RUN, DISCO_TO_METER_RUN
Project-owned geometry-derived routes:  1   BRANCH_RUN
Utility-owned excluded routes:          1   MSP_TO_UTILITY_RUN

BRANCH_RUN:   cad-route / geometry-derived, calculationLengthFt == oneWayFt
Voltage drop: PROVISIONAL PASS on every within-criterion route; no route reaches
              VERIFIED_PASS; every basis names its length source
ROUTE-LENGTH-ESTIMATE:  OPEN — "4 of 5 PROJECT-OWNED electrical run(s)…"
```

No segment claims field authority, `verifiedFieldLengthFt` is unset on every
segment, and no provenance references a measurement.

**One number needs a note.** The prompt's expected `BRANCH_RUN 64 ft` is the LIVE
Braidon project; the frozen 07-22 audit fixture the test corpus uses routes to
**58 ft**. Both are the same FACT — the branch cable path derived from the module
coordinates the model carries — and both are `cad-route / geometry-derived`. The
test pins the fact (`calculationLengthFt === oneWayFt`, one derivation, one number)
rather than a length that differs between corpora. The live 64 ft was not
re-measured in this pass because it requires the live DB; it is unchanged by this
work, which touches nothing on the no-measurement path.

**Workflow closure is complete. Braidon's project-specific field-evidence closure
is not, and must not be.**

---

## 18. SECURITY / TENANT TESTS

`tests/fieldMeasurement/security-and-policy.test.ts` — all twelve required proofs,
plus RBAC and policy coverage. **34 tests passing.**

1. Tenant A cannot read Tenant B measurements ✔
2. Tenant A cannot verify Tenant B measurements ✔
3. Project access required ✔
4. Route must belong to the project ✔
5. Attachment must belong to the tenant/project ✔
6. Recorder identity from the session ✔
7. Verifier identity from the session ✔
8. Client cannot submit a verified state — even as `owner` ✔
9. Client cannot submit a different measured-by identity ✔
10. Client cannot forge a verification timestamp ✔
11. Utility-owned excluded routes reject the workflow ✔
12. Audit events preserve tenant context ✔

---

## 19. TEST COMMANDS AND EXACT RESULTS

```
npx vitest run
  Test Files  414 passed | 17 skipped (431)
  Tests       9547 passed | 490 skipped (10037)     [baseline 9422 passed / 0 failed]

npx tsc --noEmit -p tsconfig.json          clean, no output
npx next lint                              0 errors (pre-existing no-console warnings only)
npx next build                             EXIT 0 — all five measurement endpoints present
```

**WS-5 suites**

| Suite | Result |
|---|---|
| `tests/fieldMeasurement/repository-contract.test.ts` | 15 passed, 1 skipped |
| `tests/fieldMeasurement/security-and-policy.test.ts` | 34 passed |
| `tests/fieldMeasurement/resolver-precedence.test.ts` | 17 passed |
| `tests/fieldMeasurement/api-endpoints.test.ts` | 14 passed |
| `tests/fieldMeasurement/operator-ui.test.tsx` | 9 passed |
| `tests/planset/ws5-field-measurement-reachability.test.ts` | 21 passed |
| `tests/planset/ws5-braidon-truth-state.test.ts` | 11 passed |
| `tests/targetedRegistryDeployment.test.ts` + `phase1a-migration-governance.test.ts` | 328 passed |

**Regression**

| Check | Result |
|---|---|
| D1 route ownership | 4 files / 91 tests passed (with D3, D4, AAC WS-5/WS-7) |
| D2 grounding | passing in the full suite |
| D3 BOM population | **48 rows, 48 row ids, 0 missing, 0 duplicate, 15 fitting rows** |
| D4 font manifest | passing; no host-font regression; no tofu in any capture |
| BRANCH_RUN | `cad-route / geometry-derived`, calc == oneWay |
| Blockers (frozen fixture, full) | **13**, unchanged; nothing suppressed |

### The honest limitation

**The PostgreSQL adapter is not executed in this environment.** There is no
`TEST_DATABASE_URL`, no local PostgreSQL and no running Docker daemon here, so the
Postgres block in the contract suite **SKIPS** (the 1 skipped test above) and is
reported as skipped rather than quietly omitted.

What DOES cover the Postgres path: the migration's static gate and DDL assertions
(`targetedRegistryDeployment.test.ts`, including that the default is
`REPORTED_UNVERIFIED` and that `ck_frm_verified_complete` demands a verifier and a
mode), typecheck over the adapter, and the shared contract suite that both adapters
must satisfy. What does NOT: live execution of its SQL. The reachability proof runs
against the in-memory adapter, which passes that identical contract suite. The
contract block is written so it executes the moment a database is reachable.

---

## 20. EVIDENCE HARNESS RESULTS (true exit codes, FULL profile)

Run as `node scripts/<harness>.mjs _tmp_ws5/braidon_full.html … ; echo $?` — never
piped, so the exit code is the harness's own.

| Harness | Exit |
|---|---|
| `planset-evidence` | **0** |
| `planset-evidence-w3` | **0** |
| `planset-evidence-w4` | **0** |
| `planset-evidence-ppc` | **0** |
| `planset-evidence-rp` | **0** |
| `planset-evidence-co` | **0** |
| `planset-evidence-bar` | **0** |
| `planset-evidence-bar-wse` | **0** |
| `planset-evidence-ep` | **0** |
| `planset-evidence-rgm` | **0** |
| `planset-evidence-ecd` | **2** — see below |

**`planset-evidence-ecd` exits 2, and it did so BEFORE this work.** Verified by
stashing every WS-5 change, regenerating from `9402824a` and re-running: exit 2 in
all three documented modes (`fixture`, `insufficient`, `identity`), with the same two
probe failures — gates 8 and 9, the Q-Cable connector-row promotion probes, which
report `real promotes=false (no CableExtensionSolution exists for this design)`. It
is a **pre-existing** condition of the ECD harness against this fixture, not a WS-5
regression. It is reported, not suppressed.

---

## 21. PAGE-FIT AND INTERNAL CLIPPING

```
braidon_design-review     EXIT 0  sheets=19  clipped=0  internal-clipped=0  sheet-specific-fails=0
braidon_permit            EXIT 0  sheets=18  clipped=0  internal-clipped=0  sheet-specific-fails=0
braidon_full              EXIT 0  sheets=25  clipped=0  internal-clipped=0  sheet-specific-fails=0
controlled-reported_full  EXIT 0  sheets=25  clipped=0  internal-clipped=0  sheet-specific-fails=0
controlled-verified_full  EXIT 0  sheets=24  clipped=0  internal-clipped=0  sheet-specific-fails=0
```

19 / 18 / 25 on the three Braidon profiles — unchanged. `missing-title-block=0` on
every run. The E-1 SLD gate and the PV-4C continuation-strip gate both pass.

---

## 22. PRODUCTION BUILD

`npx next build` — **EXIT 0**. All five measurement endpoints compiled as dynamic
route handlers.

---

## 23. AUTHORITATIVE PDFs

`scripts/ws5-pdf-and-shots.mjs` renders under **print media** at the exact 17×11in
envelope (screen media measures the browser, not the drawing).

```
_tmp_ws5/braidon_design-review.pdf      19 sheets
_tmp_ws5/braidon_permit.pdf             18 sheets
_tmp_ws5/braidon_full.pdf               25 sheets
_tmp_ws5/controlled-reported_full.pdf   25 sheets
_tmp_ws5/controlled-verified_full.pdf   24 sheets
```

Per-sheet PNGs alongside each, for PV-1, E-1, PV-4A, PV-4B, PV-4B.1, SCHED,
SCHED-2/3/4, CERT and PE-1.

---

## 24. VISUAL INSPECTION

Inspected directly (not merely asserted): PV-4B, E-1 and SCHED on the Braidon full
set, the controlled-reported set and the controlled-verified set.

| Check | Finding |
|---|---|
| No unqualified pass for provisional inputs | ✔ Braidon PV-4B reads `PROVISIONAL PASS` for 0.37% ≤ 3.0%; no bare checkmark anywhere |
| No field report presented as verified | ✔ controlled-reported PV-4B reads `PROVISIONAL PASS` at 89 ft; only the verified set shows `✓ VERIFIED PASS` |
| Measured-by / verified-by distinct | ✔ two separate rows in the panel; the snapshot carries both ids |
| Evidence status visible | ✔ attachment count per route in the panel; evidence count in the provenance |
| No stale calculation after verification | ✔ **found and fixed here** — PV-4B printed 0.37% beside 89 ft before the feeder record was patched in step; now 1.64% over 89 ft, consistent on the schedule, the interpretation line and the supply-side note |
| No stale procurement quantity | ✔ **found and fixed here** — SCHED ordered 23 ft of conduit for an 89-ft run; now 103 ft, with couplings 2→10 and straps 4→12 |
| No route source/state contradiction | ✔ every segment's pair is legal under `ROUTE_LENGTH_AUTHORITY_PAIRS`, measured or not |
| No D1/D2/D3/D4 regression | ✔ 48/48/15 BOM, ownership, grounding and font suites all pass |
| No tofu / font substitution | ✔ every capture renders the embedded pack cleanly |
| No clipping | ✔ 0 across all five artifacts |
| No fictional Braidon measurement | ✔ zero measurements; the requirement is OPEN and names the four runs |

---

## 25. FILE INVENTORY

**New**

```
lib/migrations/118_field_route_measurements.sql
lib/fieldMeasurement/{types,capabilities,verificationPolicy,evidence,repository,
                     postgresRepository,service,resolver,permitAccess,production}.ts
lib/permit/snapshot/{routeProcurementPolicy,routeVoltageDropRecalc,
                     applyFieldMeasurements}.ts
lib/permit/snapshot/resolution/fieldMeasurementResolver.ts
app/api/projects/[id]/route-measurements/route.ts
app/api/projects/[id]/routes/[routeSegmentId]/measurements/route.ts
app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/{verify,reject,supersede}/route.ts
components/project/RouteMeasurementPanel.tsx
scripts/{ws5-artifacts.ts,ws5-pdf-and-shots.mjs}
tests/fieldMeasurement/{fixtures.ts,repository-contract,security-and-policy,
                        resolver-precedence,api-endpoints}.test.ts
tests/fieldMeasurement/operator-ui.test.tsx
tests/planset/{ws5-field-measurement-reachability,ws5-braidon-truth-state}.test.ts
```

**Modified**

```
lib/migrations/{runner,targetedRegistryDeployment}.ts   118 through all four gates
app/api/admin/migrations/route.ts                       execute-field-measurements-118
lib/permit/generatePermit.ts                            apply measurements + thread authority
lib/permit/utils/computedRuns.ts                        same substitution on the BOM run model
lib/permit/snapshot/build.ts                            authority projection, VD + procurement,
                                                        feeder patch, named closure policy
lib/permit/snapshot/validate.ts                         V18 D1-scoped
lib/permit/snapshot/resolution/{types,lifecycle,resolvers,derived}.ts
                                                        bundle key, seed, resolver registration,
                                                        named closure policy
components/engineering/EngineeringTab.tsx               panel mounted in Electrical Engineering
tests/{phase1a-migration-governance,targetedRegistryDeployment}.test.ts
```

---

## 26. OPEN DEFECTS RECORDED, NOT CLOSED

1. **`LEGACY_GLOBAL_SLACK`** — `deriveRunLengths` bakes a blanket 1.15 into
   `onewayLengthFt`, which the snapshot consumes as the CALCULATION length. Named
   in `routeProcurementPolicy.ts`.
2. **Two procurement bases on a measured run** — the canonical segment uses the
   itemised policy; the BOM engine still applies its own 1.15.
3. **`continuousCurrentA` / `operatingCurrentA` null on every segment** — the
   mapper reads field names the engine does not emit. Named in `build.ts`.
4. **`planset-evidence-ecd` exits 2** — pre-existing, confirmed identical at
   `9402824a`.
5. **Migration 118 is not run** — the operator step, through the governed console.
6. **The Postgres adapter is not executed in this environment** — no
   `TEST_DATABASE_URL`; contract block skips and is reported as skipped.

---

## 27. FINAL COMMIT AND PUSH

```
Starting remote HEAD   9402824a279440497bd72209ae0acbe3a1cc71b3
Ending commit          eafdc6882320c6237ad3959dba0285d918cf9873
Push                   9402824a..eafdc688  dev -> dev
Verified after fetch   HEAD == origin/dev == eafdc688
Ahead / behind         0 / 0
Files changed          46  (+8383 / −19)
```

No history was rewound, reset or force-pushed. `dev` remains the integration branch
per R8.

---

## 28. ACCEPTANCE, POINT BY POINT

| Requirement | Status |
|---|---|
| Persistent measurement evidence | migration 118, two tables, governed through all four gates |
| Real API and UI workflow | five endpoints in the build; panel in the Electrical Engineering section |
| Operator entry defaults to unverified | constant function + DB DEFAULT + CHECK; tested for the org owner |
| Verification explicit, authorised, evidenced, audited | policy service; capability + project access; evidence re-resolved; atomic event |
| Tenant / project / route isolation fail-closed | every read and guard scoped; cross-tenant reported as 404 |
| Rejection and supersession preserve history | append-only; the retired value survives; no DELETE exists |
| Canonical resolver consumes active authority | deterministic selection → authority bundle → build |
| Field-reported supports only provisional conclusions | `DESIGN_REVIEW_ONLY`; PROVISIONAL PASS; closes nothing |
| Field-verified can support final conclusions | `FINAL_RELEASE_READY`; `✓ VERIFIED PASS`; closes the requirement |
| Requirement closure reachable through the real workflow | 21-test proof, real service → API → engine |
| Requirement reopening proven | rejection and supersession-without-verified-replacement |
| Voltage drop recalculates | resistance re-read from the gauge; feeder projection patched in step |
| Procurement recalculates | itemised policy on the segment; BOM footage 21/23/18 → 102/103/104 ft |
| Live Braidon honest and pending | 0 measurements, 4 unresolved, requirement OPEN |
| D1, D2, D3, D4 intact | 48/48/15; ownership, grounding, fonts all pass |
| All profiles unclipped | 19/18/25 + both controlled sets, zero clipping |
| Tests, lint, typecheck, harnesses, build, PDFs, visual review honestly reported | §19–§24, including the ECD exit-2 and the Postgres skip |
| Final commit pushed and verified | `eafdc688`, 0 / 0 |

**Not claimed:** live PostgreSQL execution of the adapter's SQL (§19), and the six
open defects in §26. WS-5's workflow is complete and reachable; Braidon's
project-specific field evidence is not, and truthfully should not be.
