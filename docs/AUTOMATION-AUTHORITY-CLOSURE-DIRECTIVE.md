# Automation Authority Closure — Directive

Status: ACTIVE 2026-07-27. Baseline dev @ `a6a225ae`. Artifact: `PermitPackage-BRAIDON
M PILLA — Solar TEST (9).html` (PDS-0B05747F0E8A, 24 sheets, 7 gates / 19
requirements / 0 advisories). Ray's mandate, supersedes the engine freeze for
UPSTREAM DOMAIN AUTOMATION only.

## Critical correction
The system detects, documents and displays blockers instead of RESOLVING them. The
correct lifecycle: load authoritative inputs + user selections → auto-reconcile
downstream records → retrieve public/manufacturer authority → deterministic
calculations from design geometry → propagate configuration → recalculate → retry
resolvers → build the REMAINING registry → render only genuine field/professional
requirements. Release gates are final safeguards, not substitutes for automation.

## User authority (mandatory)
1 user-selected equipment is authoritative; 2 reconcile every downstream record to
it; 3 auto-resolve AHJ + adopted codes from location; 4 auto-retrieve + archive
environmental design authority; 5 calculate Q-Cable topology/quantity from layout
geometry; 6 populate designer from system configuration; 7 never ask the user for
information the platform knows or can deterministically retrieve; 8 resolver history
belongs in the application audit record, not across permit sheets; 9 the planset must
get SMALLER as automation improves.

## Do not reopen closed visual work
No RS-1/seven-gate/visual redesign; no weakening fail-closed; no HTML patching; no
new diagnostic sheets; no more repeated blocker language; disclosures are not fixes;
no Braidon hardcoding; displaying a blocker more clearly is not success.

## Current excess (fix automation FIRST, then compact)
RS-1/.1/.2; SCHED/-2/-3/-4; APP-A duplicate reference; unsigned CERT placeholder;
DS-1..3 numbered as drawing sheets; repeated package-failure language. Expected final:
~11-12 core drawing sheets + manufacturer attachment appendix ≈ 14-16 pages. Never
reduce pages by hiding unresolved engineering.

## Required first deliverable: source-path audit
Audit the full source path for: user equipment selection; fleet/default equipment;
subsystem records; legacy migration values; snapshot construction; BOM; procurement
projection; datasheet registry/binding; calculation inputs; drawing annotations;
evidence records; environmental inputs; location normalization; AHJ/code records;
Q-Cable branch/geometry inputs; system configuration + personnel roles;
release-requirement construction; seven-gate aggregation; planset generation;
snapshot freezing/digest. For EVERY remaining Braidon requirement: ID, root gate,
current builder, source inputs, blocking condition, resolver exists?, resolver
invoked?, evidence persisted where?, is the renderer incorrectly determining domain
authority?, correct resolution mode, correct resolver insertion point, downstream
records requiring invalidation. Written audit document in-repo. Trace actual
implementation, no speculative architecture.

## Classification (every requirement exactly one)
AUTO_DERIVED (deterministic from existing project data/selections/config/geometry —
expected: EQUIPMENT-IDENTITY-CONFLICT, PROJECT-NAME-NONPRODUCTION,
DESIGNER-OF-RECORD-MISSING, CONDUIT-FILL-PENDING, QCABLE-PROCUREMENT-INSUFFICIENT
when geometry suffices, stale downstream records) · AUTO_RETRIEVED (authoritative
public/manufacturer retrieval — expected: PROJECT-AUTHORITY-UNVERIFIED,
CODE-AUTHORITY-INCOMPLETE, ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED, applicable
manufacturer documents, exact datasheets, compatibility docs, Q-Cable
grounding/bonding docs) · OPERATOR_CONFIRMATION (only genuine conflicts/bounded
ambiguity: boundary conflicts, overlapping authorities, disagreeing authoritative
sources, multiple genuinely active selections) · FIELD_VERIFICATION (only physical
conditions absent from records/geometry: actual service-conductor identity, actual
tap length, routing absent from CAD/survey, framing not in authoritative docs,
substrate/embedment/concealed) · PROFESSIONAL_APPROVAL (licensed judgment/release
only: structural judgment beyond prescriptive authority, digest-bound review,
signature, seal).

## WS-1 Resolver framework (build FIRST)
ResolutionMode enum (the five). RequirementResolutionState: resolutionMode,
resolverId, requiredInputs, resolutionEvidence[], confidence, blockingReason,
retryability (RETRYABLE|NON_RETRYABLE|REQUIRES_INPUT), lastResolutionAttempt,
lastResolutionResult (RESOLVED|FAILED|SKIPPED|NOT_ATTEMPTED). Adapt names to domain
conventions; no duplicate abstraction. Lifecycle: determine automatic requirements →
run AUTO_DERIVED → persist results+evidence → invalidate affected records →
recalculate → run AUTO_RETRIEVED → persist retrieved authority + source evidence →
recalculate → repeat to stability (bounded) → build final registry ONLY after
exhaustion → freeze snapshot → render. An automatic requirement may not emit
unresolved merely because its resolver was not called. Failed resolution persists:
resolver, inputs, source queried, failure reason, retryability, timestamp, minimal
operator action when genuinely necessary. Empty evidence / truthy flags are never
proof.

## WS-2 Canonical equipment selection
Trace every source (explicit user / project / design / fleet / company defaults /
subsystem / legacy migration / BOM / procurement / datasheets / calcs / drawings /
evidence / snapshot). ONE canonical selection authority; explicit user selection
outranks fleet defaults, legacy values, generated subsystem records, stale
BOM/procurement, previously bound datasheets. Braidon: Qcells 400W canonical
everywhere; REC 405W only as superseded audit history; EQUIPMENT-IDENTITY-CONFLICT
clears unless genuinely two active authoritative selections. Behavior: persist
canonical identity (mfr, model, rating, registry id, revision, actor, timestamp);
supersede replaced; invalidate stale dependents; rebuild downstream; re-run
requirements; archive reconciliation evidence. Never manual operator reconciliation
of internal records.

## WS-3 AHJ/code authority (provider-based, testable)
From normalized address/coords/APN/municipality/county/state/utility: resolve
building/electrical/fire AHJ, permit office, adopted NEC/IBC/IRC/IFC (+ASCE where
relevant), local amendments, effective dates, source URL/document, retrieval
timestamp, boundary evidence, confidence, applicability → persisted authority record
(existing model). Never silently rely on: hardcoded tables without provenance,
title-block defaults, sourceless prior text, utility territory as AHJ proxy, generic
state assumption where local adoption controls. OPERATOR_CONFIRMATION only for:
boundary conflicts, incorporated/unincorporated ambiguity, disagreeing sources,
overlapping jurisdiction. Failed retrieval reports exact source + exact failure.
Editions never stay PENDING merely because nobody typed them.

## WS-4 Environmental authority
Trace wind/exposure/risk/ground+roof snow/seismic/elevation/frost sources. A value is
not authoritative because the calc is numerically correct. EnvironmentalAuthorityRecord
(projectId, snapshotId?, coordinates, sourceProvider, sourceDocumentOrTool, edition,
queryInputs, returnedValues, retrievedAt, sourceHash, applicability, confidence,
overrideHistory) adapted to the data model. Displayed + calculated values derive from
it. Overrides require value/reason/authority source/actor/timestamp/audit and never
destroy the original retrieval. Bind evidence to snapshot + digest.

## WS-5 Q-Cable topology + procurement engine
From module coords/orientation/dims, branch assignments, micro locations, ordered
drops, cable topology, array geometry, homeruns, roof transitions, branch endpoints:
deterministic topology object (branch id, ordered modules, drop coords, inter-module
segment lengths, row transitions, array transitions, branch start/end, homerun
transition, service-loop allowance, dead-drop treatment, cable ends, terminators,
sealing caps, extension requirements, installed length, procurement length, selected
stock configuration, geometry coverage, confidence, field-dependent portion). Never
renderer estimates. Engine determines: stock sufficient? different listed stock
config? verified listed extension? cable-end placement change? branch reassignment?
rebranch layout? genuine unknown field route? Braidon knows 31 drops / per-branch
lengths / 166.5 vs 152 / 14.5 short — the system must EVALUATE the valid options and
produce a complete solution or precise unresolved reason, not announce the shortage.
Procurement consumes the topology object; the gate inspects completed resolution.

## WS-6 Designer configuration propagation
Distinct roles: designer, preparer, reviewer, engineer of record, approving engineer
(no ambiguous single field). Configured designer auto-populates project record,
snapshot, title blocks, certification records, review records, evidence, planset
metadata, the designer requirement. Valid configured designer clears
DESIGNER-OF-RECORD-MISSING where only the designer role is needed. Never fabricates
PE/approval/signature/seal/digest approval. Project-specific authorized overrides
supersede the system default, audited.

## WS-7 Deterministic electrical closure
Audit electrical blockers classed as operator/field. CONDUIT-FILL-PENDING is
AUTO_DERIVED (raceway type/size, conductor type/size/qty, insulation, code edition
all known) — implement/repair the calculation, bind evidence to snapshot. Only route
length / routing conditions absent from geometry remain FIELD_VERIFICATION. An
unexecuted calculation is never field verification.

## WS-8 Structural authority separation
Automatic/retrievable: selected racking/attachment/fastener identity, manufacturer
installation manual, capacity tables, product revision, compatibility docs,
code-edition applicability, exact datasheet binding. Field: actual framing
dims/spacing where unavailable, substrate, concealed damage, undocumented embedment,
as-built deviations. Professional: judgment beyond prescriptive authority, digest
review, signature, seal. Never bundle all structural work into operator work because
one portion needs engineering approval.

## WS-9 Release-gate auto-clearing
Convert all requirements to the resolver lifecycle. Before generation: run
AUTO_DERIVED → reconcile invalidations → run AUTO_RETRIEVED → persist evidence →
recompute → re-evaluate children → recompute seven gates → freeze only after
stabilization. A gate stays open only while a legitimate child remains. The renderer
must not retrieve authority, choose equipment, mutate calcs, resolve requirements,
reconcile records, invent authority, or clear gates — it consumes the frozen
snapshot.

## WS-10 Planset compaction (ONLY after automation works)
Keep: PV-0 compressed, PV-1, PV-1B, PV-3, PV-4C, PV-4C.1, E-1, PV-4A, PV-4B, PV-5
merged w/ PV-6, one compact major-equipment schedule only when required, PE-1 only
when applicable + completed. Remove from core set: RS-1/.1/.2, SCHED-2/3/4, APP-A,
empty CERT. Move DS-1..3 to a manufacturer attachment appendix. Full resolver
evidence/audit/procurement BOM stays accessible in-app, snapshot-bound — not on
permit sheets. Cover shows ONE concise release status. Removing pages must never
remove a requirement from the internal registry.

## Braidon acceptance (live project, no hardcoding)
Expected: Qcells canonical everywhere, REC superseded-history only; module docs
auto-bound or precise retrieval failure; building/electrical/fire authority +
editions auto-resolved w/ archived evidence; environmental records created + bound;
wind/snow display derives from them; Q-Cable topology + procurement deterministic w/
option evaluation; conduit fill auto-calculated; configured designer populates;
automatic requirements clear BEFORE registry finalization; only genuine
field/professional remain; package materially shorter. Gate movement: 7/19 →
approximately 3 gates / 4-5 requirements — do NOT force exact counts; explain every
remaining requirement and prove it cannot be auto-resolved.

## Test requirements (failure-mode + anti-vacuity; abbreviated headings — full list
in the user mandate, ALL required)
Equipment (7 cases incl. two-active-selections still conflicts, superseded cannot
re-enter) · AHJ/code (7 incl. sourceless default cannot clear, utility ≠ AHJ proof) ·
Environmental (6 incl. empty evidence cannot clear, coordinate change invalidates) ·
Q-Cable (12 incl. sufficient-in-aggregate-invalid-per-branch, rebranch resolution, no
Braidon constants in production code) · Designer (6 incl. never populates EOR/PE) ·
Resolver lifecycle (8 incl. uncalled resolver cannot finalize a blocker, bounded
loops, renderer cannot mutate) · Planset output (6 incl. page removal cannot drop a
registry requirement).

## Required validation
Targeted resolver tests; failure-mode; anti-vacuity; DB/migration tests where
applicable; typecheck; lint if standard; full suite; production build; live Braidon
regeneration; before/after gate + requirement + sheet counts; evidence per
auto-cleared requirement; exact evidence per remaining blocker. Never report
unexecuted tests as passing. Providers unavailable in test env → dependency injection
+ deterministic fixtures, clearly distinguishing fixture proof from live retrieval
proof.

## Deliverables
Seven-gate automation audit; resolution-mode matrix; canonical equipment source map;
resolver architecture; the eight implementations (equipment, AHJ, environmental,
Q-Cable, designer, electrical, structural separation, gate auto-clearing); planset
compaction; failure-mode + anti-vacuity tests; Braidon before/after evidence;
regenerated live planset; separate commit on dev; closure doc
BRAIDON-AUTOMATION-AUTHORITY-CLOSURE.md (source-path findings, files changed, schema
changes, resolver map, providers, before/after requirement + gate + sheet tables,
test commands + actual results, build result, commit hash, remaining legitimate
work).

## Execution discipline
No stopping after the audit absent a real blocker; no asking the user for
determinable architecture; no placeholder always-unresolved resolvers; no clearing by
weakening; no blocker→advisory demotions to cut counts; no unverified default
authority; no swallowed retrieval failures; no Braidon-only code paths; no completion
claims while generation still prints auto-resolvable blockers. Dependency order:
audit → resolver framework → canonical equipment → designer → AHJ/code →
environmental → electrical → Q-Cable → structural separation → gate lifecycle →
Braidon acceptance → compaction → validation → commit.

## Final objective
Auto-resolve everything determinable from explicit selections, project location,
system configuration, authoritative public sources, verified manufacturer registries,
existing calculations, existing CAD/survey geometry. Ask the user only for physical
field observation, unavailable private records, conflicting-authority resolution,
licensed judgment, signature, seal. The engine's job is not to print a larger
explanation of why the planset fails — it is to do everything it can to make the
planset pass.
