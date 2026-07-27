# Hierarchical Release-Gate Model — Architecture Report

Pass: RGM (RGM-1 model + RGM-2 rendering/closure). Directive: `docs/RELEASE-GATE-MODEL-DIRECTIVE.md`.
Baseline dev `ee718f28`. Evidence: `docs/evidence/braidon-release-gate-rollup.json`.

## 1. The problem, restated

Every unresolved CHILD requirement presented as an equal top-level blocker. The cover printed eight
verbatim blocker messages plus "+ 11 more active release blockers"; RS-1 printed a flat, domain-grouped
list headed "19 OPEN RELEASE BLOCKERS". A reviewer therefore read **nineteen unrelated engineering
failures** where the truth is **seven unresolved ROOT release gates that contain nineteen requirements**
— most of them one workflow away from each other (six of them are a single chain of unestablished
structural authority).

Nothing about the engineering was wrong. The *presentation* misrepresented the release condition.

## 2. Model design (RGM-1, `lib/permit/snapshot/releaseGates.ts`)

A pure, deterministic **projection over the existing `permitReadiness.registry`** — not a second
readiness engine:

* blocker codes remain THE source requirements; nothing is invented;
* severity and the five permit-acceptance impact axes come from `severityPolicy` (the single severity
  authority); the module only MAPS those onto the five RELEASE axes;
* domain / authorityPath / affectedSheets / explanation / resolutionAction / payload / provenance pass
  through from the registry record verbatim;
* the only NEW declarative facts are (a) which root gate a code belongs to, (b) its finding type,
  (c) a human title, and (d) for the electrical-closure gate, WHICH RESULT each unresolved input
  affects. All four live in ONE table (`RELEASE_GATE_DEFINITIONS` / `REQUIREMENT_DECLARATIONS`).

`ReleaseGateResult` and `ReleaseRequirement` carry exactly the directive's §1/§2 field lists.
Status is `OPEN | CLEARED | NOT_APPLICABLE` — never `PASS` while evidence is pending. A `resolved: true`
record WITHOUT a resolution audit reference stays OPEN (fail closed); `NOT-APPLICABLE:<ref>` is the only
way a requirement becomes NOT_APPLICABLE, and it takes a recorded authority to do it.

**Fail closed:** a registry code absent from the declarative map lands in the `RG-UNMAPPED`
`UNMAPPED_REQUIREMENT` gate, which is OPEN and blocks EVERY release axis, and
`verifyNoUnmappedRequirements` FAILS the harness. An unknown code can never disappear and can never be
softened.

### Requirement → gate map (§3)

| Gate | Code | Category | Braidon children |
|---|---|---|---|
| RG-1 | PROJECT_AND_AHJ_AUTHORITY | ADMINISTRATIVE / CODE AUTHORITY | CODE-AUTHORITY-INCOMPLETE · PROJECT-AUTHORITY-UNVERIFIED · PROJECT-NAME-NONPRODUCTION (3) |
| RG-2 | EQUIPMENT_RECONCILIATION | EQUIPMENT AUTHORITY | EQUIPMENT-IDENTITY-CONFLICT · MODULE-EXACT-DATASHEET-PENDING (2) |
| RG-3 | ENVIRONMENTAL_LOAD_AUTHORITY | STRUCTURAL AUTHORITY | ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED (1) |
| RG-4 | STRUCTURAL_ASSEMBLY_AUTHORITY | STRUCTURAL AUTHORITY | FRAMING-AUTHORITY-UNVERIFIED · PENDING-RACKING-ASSEMBLY-SELECTION · FASTENER-ASSEMBLY-UNVERIFIED · RACKING-CAPACITY-SOURCE-NOT-ARCHIVED · RACKING-CAPACITY-APPLICABILITY-GAP · EQUIPMENT-DOCUMENT-APPLICABILITY (6) |
| RG-5 | ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE | ELECTRICAL CLOSURE | ROUTE-LENGTH-ESTIMATE · CONDUIT-FILL-PENDING · TAP-CONDUCTOR-LENGTH-PENDING (3) |
| RG-6 | QCABLE_SYSTEM_CLOSURE | PROCUREMENT CLOSURE | QCABLE-PROCUREMENT-INSUFFICIENT · QCABLE-GROUNDING-AUTHORITY-UNVERIFIED (2) |
| RG-7 | PROFESSIONAL_RELEASE | PROFESSIONAL WORKFLOW | DESIGNER-OF-RECORD-MISSING · ENGINEERING-REVIEW-PENDING (2) |

3 / 2 / 1 / 6 / 3 / 2 / 2 = **7 gates, 19 requirements, 0 advisories**. The full map covers every code
the snapshot build can emit (38 codes including the two legacy aliases and the advisory
EQUIPMENT-DOCUMENT-UNVERIFIED), so no known code can reach RG-UNMAPPED.

RG-5 children each declare `affects` — which result the unresolved input blocks — so a route-length
estimate is never presented as invalidating ampacity, OCPD sizing, terminal ratings or equipment
selection.

### Release-impact axes and responsible role

Both are DERIVED, never hand-set per code. The impact formula maps the five acceptance axes onto the
five release axes (documented in the module header); `administrativeRelease` is derived from the finding
type, which is what makes an administrative-only hold distinguishable from a procurement-only hold
instead of every axis lighting up together. `responsibleRole` is a documented (gate category × finding
type) matrix — including the standing rule that EQUIPMENT-IDENTITY-CONFLICT is OPERATOR-ONLY.

## 3. Readiness axes and issue-state integration (§8) — decision

**Decision: the existing issue-state machine is NOT replaced.** `deriveIssueState` /
`PROJECT_ISSUE_STATES` / `evaluateIssuedForPermitGate` are untouched. The model exposes a derived
`readinessAxes` object plus `issueStatePredicates` (`designReview`, `readyForEngineeringReview`,
`readyForPermitSubmission`, `procurementReady`, `administrativeReleaseReady`,
`professionalReleaseComplete`) that express §8's conditions in gate terms. Rationale:

* the directive explicitly permits "a derived readiness-axis object" and forbids destabilising existing
  issue-state behaviour;
* the digest-bound approval + seal half of PERMIT-READY lives in `evaluateIssuedForPermitGate` and must
  not be duplicated — a predicate that *looked* authoritative would be a second gate;
* the harness asserts AGREEMENT (gate 12) rather than substitution: no gate may be open while the
  package claims a release state, and the rendered "Derived issue state" on RS-1 must be the one the
  existing machine produced.

`PROCUREMENT_READY` is tracked independently on the procurement axis and is false while any
procurement-impacting gate is open.

## 4. Rendering (RGM-2)

### RS-1 — `lib/permit/sections/reviewStatus.ts`

* **Leads with the seven-row root-gate table**: Gate · Category · Status · Unresolved · Release Impact ·
  Primary Resolution · Responsible Role. Every cell is read from the model accessor
  (`projectReleaseGates`) — no renderer re-derivation, no renderer-local grouping.
* **Child requirements group beneath their ONE primary gate**, each row keeping: status badge +
  requirement status, code, finding-type chip, title, canonical explanation, the per-record payload
  detail box (still selected by `BLOCKER_PAYLOAD_SCHEMA`), authority path, evidence references,
  resolution action, responsible role, the RG-5 `AFFECTS` clause and affected sheets.
* **Seven visual treatment classes** (§5): root-gate hold · strong (technical conflict AND verified
  deficiency) · pending · field · administrative · review-workflow · advisory. Each differs from every
  other in at least two HUE-FREE channels — border-left width, border-left style
  (solid/double/dashed/dotted/groove/ridge), font weight, font style, text decoration, letter spacing,
  fill luminance. Colour only adds on-screen emphasis on top of an already-monochrome-distinguishable
  design. Enforced by permanent gate 17 over all seven DECLARED classes (not merely the ones a given
  input renders) plus a grayscale render.
* **Text floor unchanged**: the ≥6.5pt effective floor (8.5–8.7px) is kept for every requirement string
  and applies to the NEW gate-table and authority/evidence lines too. Nothing was shrunk to make the
  hierarchy fit — that is what the continuation sheets are for.
* **RS-1.n continuations** on the existing machinery: ONE deterministic layout function
  (`reviewStatusLayout` / `reviewStatusContPageCount`) shared by the sheet manifest and the page
  assembly, exactly like `schedContPageCount` for SCHED-n. Heights are measured off the rendered
  fixture (Playwright layout metrics) with a stated safety margin; the geometry page-fit gate enforces
  them. A second, BALANCING pass spreads the requirement groups evenly across the sheet count the first
  pass established, so the last sheet is never a near-empty page (greedy packing left one 94px group
  alone on a 998px sheet). Page count is decided by pass 1 and can never grow in pass 2.
* On the frozen Braidon fixture (15 unresolved requirements) this renders **RS-1 + RS-1.1 + RS-1.2**.

### Cover — `lib/permit/utils/releaseStatusBlock.ts`

Replaces the blocker-list banner with the RELEASE STATUS block: the model headline
("7 OPEN RELEASE GATES / 15 UNRESOLVED REQUIREMENTS / 0 ADVISORIES / NOT FOR PERMIT SUBMISSION"), the
PENDING ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION identity (unchanged), the OPEN root gates
NUMBERED with their own child counts, and "SEE RS-1 FOR ALL n REQUIREMENTS". When — and only when — the
package carries a CONFIRMED condition, the single most severe one (finding-type precedence:
VERIFIED_DEFICIENCY then TECHNICAL_CONFLICT) is highlighted. The cover never duplicates the registry.

### Banner-consumer audit (§4 count semantics)

| Consumer | Sheets | Change |
|---|---|---|
| `releaseStatusBlockHtml` (new) | PV-0 | REPLACES the blocker list with the gate-semantics release block |
| `structuralBannerHtml` | PV-1, PV-1B, PV-3, PV-4C, SCHED, PE-1 | Requirement rows UNCHANGED (still the registry union — the W10 anti-ternary fix stands). Package-level line ADDED (`PACKAGE RELEASE STATUS: 7 OPEN RELEASE GATES / 15 UNRESOLVED REQUIREMENTS — SEE RS-1 …`); the remainder line's "+N more active release blockers" becomes "+N more unresolved release requirements" |
| `certificationGateBanner` | CERT, PE-1 and the cert blocks | Same treatment; the verbatim reason list capped 8 → 6 so the page still fits (no information lost — the remainder is stated and RS-1 prints everything) |
| PV-4A registry rows | PV-4A | UNCHANGED — a SHEET-SCOPED electrical list, not a package total. Its Blocking/Pending counters are domain-scoped and stay as they are |
| SCHED conclusion | SCHED | UNCHANGED — registry-derived, not a package "blocker count" phrase |

The single source for both new lines is `releasePackageLine(summary)`; the structural projection
(`structuralBanner`) carries `releaseSummary` + `releasePackageLine`, derived from the SAME registry, so
no consumer counts anything itself.

## 5. Backward compatibility (§9)

* No blocker code deleted, renamed or downgraded. `permitReadiness.blockers` and
  `permitReadiness.registry` are untouched and remain canonical.
* The gate model is **projected at read** (`projectReleaseGates` / `projectReleaseGatesFromInput`) —
  it is NOT stored on the snapshot. `releaseGates`, `releaseRequirements`, `releaseSummary` and
  `readinessAxes` are additive on the PROJECTION, not on the persisted object, so the release-gate model
  itself contributes **zero digest churn**.
* **One honest exception:** the package now contains RS-1.1 and RS-1.2, so
  `projectAuthority.sheetIndex` — a stored field — legitimately gains two entries and the snapshot id /
  digest change. That is the deliverable changing (the same class as SCHED-n pagination), not the model
  churning. The fixture snapshot moves `PDS-E17B052701C1 → PDS-0D1F9ADCF211`.
* No DB migration, no migration-governance change, no MFA change.
* No duplicated blocker-generation logic and no manual requirement list anywhere: the renderer, the
  cover, the banners, the evidence emitter and the harness all read the one model.

## 6. Evidence and verification (§10)

* `scripts/rgm-model-evidence.ts` emits `exportReleaseGateEvidence` + `verifyReleaseGateModel` +
  the requirement-multiset reconciliation + the nine ANTI-VACUITY probes (all seven open · one
  structural child clears · all structural children clear · NOT_APPLICABLE with authority · professional
  approval added · administrative-only hold · procurement-only hold · no active requirements · an
  UNKNOWN code fails closed into UNMAPPED and FAILS the verification). It also emits the declared
  visual-treatment table so gate 17 is never vacuous.
* `scripts/planset-evidence-rgm.mjs` runs the **17 permanent gates** against the RENDERED HTML plus that
  canonical evidence, in three modes:
  * **fixture** — the frozen acceptance fixture (15 requirements over all seven gates);
  * **insufficient** — the same design with the documented, clearly-synthetic Q-Cable service-loop
    allowance (stricter-only) so the VERIFIED DEFICIENCY / `strong` treatment and the cover's
    most-severe-condition line are non-vacuous (16 requirements);
  * **identity** — the same design with Braidon's real project-identity state (non-production name, no
    designer of record), so ADMINISTRATIVE_HOLD and gate 8 are non-vacuous (17 requirements). Both
    mutations only ADD requirements; neither clears, verifies, selects or approves anything.
* `scripts/braidon-rgm-regen.ts` produces all three packages through the PUBLIC API
  (`generatePermitHTML`) — no snapshot injection, no HTML patching.
* The frozen fixture carries **15 of the directive's 19** Braidon requirements (PROJECT-NAME-
  NONPRODUCTION, EQUIPMENT-IDENTITY-CONFLICT, DESIGNER-OF-RECORD-MISSING and QCABLE-PROCUREMENT-
  INSUFFICIENT do not fire on it). Gate 4 therefore asserts the rendered counts equal the model and the
  registry EXACTLY, and asserts the directive's own 19-code condition produces 7 / 19 / 0 with the
  3-2-1-6-3-2-2 distribution via the model probe — the expected table is verified, never assumed.

## 7. Honest state after this pass

Nothing was cleared. Nothing was weakened. No authority, reconciliation, selection, measurement or
approval was fabricated. Every requirement that was blocking before is blocking now, with the same
severity and the same impact. BRAIDON remains **NOT FOR PERMIT SUBMISSION**, issue state PENDING
ENGINEERING REVIEW, `permitReadiness.ready = false`, `permitReady = false`, `procurementReady = false`,
`engineeringReviewReady = false`.

What changed is that the package now says, on the cover and at the head of RS-1, what is actually true:
**seven unresolved root release gates containing fifteen (Braidon-live: nineteen) requirements** — not
that many unrelated engineering failures.
