# PHASE A + B DIRECTIVE — Release Authority Integrity & Dead Requirement Recovery

**Scope:** audit Tier 0 and Tier 1 ONLY. Nothing else.
**Source of truth:** `_tmp_audit_REPORT.md` (08-24 audit, 66 cited defects). Read §3, §4, §5, §8 before
touching anything. Do NOT re-investigate what it already establishes with a file:line citation.
**Baseline:** dev `47e0092d`. Braidon = 5 open gates / 12 unresolved requirements.

---

## 0 · HARD BOUNDARIES

1. **TWO commits. Not one.** Phase A → verify → commit → push. Phase B → verify → commit → push. Stop.
2. **Do not touch pricing.** `lib/bom/distributorPricing.ts`, Tigo SKUs, catalogue prices — out of scope
   entirely, even if you notice something wrong. Note it, do not fix it.
3. **Do not attack the other 50+ defects.** Tier 2/3/4 are explicitly out of scope. If a Tier 2 fix looks
   like a one-liner, it is still out of scope. Record it and move on.
4. **Never manually close a gate.** No hand-editing a registry entry, no forcing `resolved: true`, no
   special-casing Braidon. You are repairing the authority system; the registry must resolve itself.
5. **LIVE DB WRITES ARE BLOCKED.** The Neon credential is unrotated (see the credential memory). You may
   read live, read-only, with `SET default_transaction_read_only = on` verified by `SHOW`. You may NOT
   insert a document row, verify a document, seed a designer, or record a review. **Every fire-and-clear
   proof must be built from manufactured state — fixtures and injected sockets — never from a live write.**
6. **Do not weaken a test to make it pass.** If a test breaks, either the change is wrong or the test pinned
   a defect. Say which, with evidence.

---

## 1 · THE TRAPS — read these before writing code

These are the things that will silently sabotage this phase.

- **Do NOT repair the four `manufacturer_document_registry` rows' `jurisdiction_boundary` in isolation.**
  Today the mailing-city stamp *clears* (a false clear) and the canonical stamp *hides* the row, because
  the selection filter is `dj.includes(jur)` with `jur` = the mailing city (`lib/documents/registry.ts:484-487`,
  criterion at `resolvers.ts:284, 287`). Fixing the data before the code moves the rows from
  "rejected" to "invisible". **Code first, and both sides — selection AND comparison — in the same change.**
- **Jurisdiction is never reached today anyway.** `pickVerifiedDocument` requires
  `extractedClaims.structural.hasStructuralCapacityClaim === true` and `asdAllowableLbs > 0`
  (`registry.ts:455-459`); `extracted_claims` is NULL on all three structural rows, and
  `racking-documents@v1` creates rows with no `extractedClaims` at all (`structuralResolvers.ts:325-353`).
  So a jurisdiction fix alone changes no live outcome. That is expected. Prove it on fixtures.
- **Every existing digest-stability test supplies `engineeringReview` alone.** `framingEngineerReview` is
  asserted non-null in ZERO tests (`tests/planset/prr-release-reachability.test.ts:318`). That is exactly
  why D44 survived. Your new tests must supply the full atomic patch.
- **PRR's flagship assertion is vacuity-tolerant** —
  `expect(unresolved).toEqual(['ENGINEERING-REVIEW-PENDING'])` yields the same array if every emitter went
  silent (`prr-release-reachability.test.ts:643-651`). Do not add more assertions of that shape.
- **A green suite has repeatedly meant nothing here.** D8, D13, D45 and D44 all shipped green. Every claim
  in this phase needs a test that FAILS before the fix.

---

## 2 · PHASE A — Release Authority Integrity

### A1 · Digest-bound professional approval (D44) — Tier 0 #1
`engineeringReviewRecordResolver` emits `engineeringReview` + `framingEngineerReview` + `framingReviewDigest`
atomically (`structuralResolvers.ts:934-944`). The latter two clear `FRAMING-AUTHORITY-UNVERIFIED`, which
mutates `structural.framingCapacityAuthority`, the registry, `geometry.moduleInstances` / rail substrate and
`sheetIndex` — all inside `canonicalDigestBody` (`digest.ts:209-216`). So the approval's own digest `D` no
longer matches the rebuilt `D″`, and `ENGINEERING-REVIEW-PENDING` stays open on the build the approval enabled.

**Repair:** consume the engineering-review record in **PASS 2**, after `meta.digest` is frozen.
**Invariant to establish:** *an approval must not move the digest it approves.*

### A2 · Tautological / superseded-review clear (D45) — Tier 0 #1
`reviewEvidence.reviewedSnapshotDigest` and `currentDigest` are both `coverage.reviewedDigest`, so
`r.reviewedSnapshotDigest === input.currentDigest` is `x === x` (`framingAuthority.ts:158, 168-170, 224`).
Because the coverage lookup key is the **prior** digest, an approval of a **superseded design** clears a
`safety: true` structural requirement (`severityPolicy.ts:259-262`).

**Repair:** `currentDigest` must not be derived from the record being checked. Until A1 lands, branch 2 of
`resolveFramingCapacityAuthority` must **fail closed**.

### A3 · False "CLEARED FOR ISSUE" (D51) — Tier 0 #3
PASS 2 sets `resolved = true` with no `resolutionAuditRef` (`build.ts:2311-2314, 2920-2922`).
`permitReadiness.ready` filters on the raw boolean while `deriveRequirementStatus` returns `'OPEN'` for
exactly that shape (`releaseGates.ts:971-977, 1487-1495`). On the day an EOR approves, RS-1 prints
**"CLEARED FOR ISSUE — NO OPEN RELEASE GATES"** beside `data-release-open-gate-count="1"`.

**Repair:** supply a `resolutionAuditRef`, or make `permitReadiness.ready` use `deriveRequirementStatus`.
Also: `verifyIssueStateAgreement` exists to catch this and never runs — wire it (that half is D63; wiring the
assertion is in scope here, the rest of D63 is not).

### A4 · Fastener false-clear channel (D33) — Tier 0 #4
`racking-capacity-document@v1` declares `FASTENER-ASSEMBLY-UNVERIFIED` in its `requirementCodes`
(`resolvers.ts:272-276`) but never feeds the fastener predicate. If it ever returns `cleared: true` with an
audit ref, `build.ts:1978` stamps `resolved: true` on a record the emitter still pushes.

**Repair:** remove the code from that resolver's `requirementCodes` (B1 gives it a real writer).

### A5 · Manufacturer document jurisdiction matching (D24, D25) — Tier 0 #2
Pass the **canonical** `legalJurisdiction.{ahjName, ahjRecordId}` into BOTH:
- the document **selection** criterion (`resolvers.ts:284`), and
- the clearance **comparison** — thread `projectJurisdictionAuthorityId` + `requiredSubstrate` through
  `BuildRackingAssemblyOptions` → `rackingAssembly.ts:508-515`.

Both, in one change. Note `tests/planset/r7-d4-legal-jurisdiction.test.ts:49-54` exercises a branch
production cannot reach (T2) — fix the test to match the real call site.

### A6 · Canonical AHJ vs mailing-city selection (D1, D2, D3) — Tier 1 #9
`code-authority@v1` passes `city: str(p.city)` = `"GRANITE CITY"` while the verified boundary determination
(`unincorporated: true`, confidence 0.9) is on the bundle. `matchRegistryRows` is city-first, so
`allMatches = [il-madison-granite-city]` and the canonical `il-madison-county` row is **never inspected**
(`jurisdictionResolvers.ts:523-525`; `internalAhjRegistry.ts:152-164, 323-324`).

**Repair:** key the query on the verified boundary determination, not the mailing city. Declare
`legalJurisdiction` as a `requiredInput` so a jurisdiction correction re-dirties it
(`jurisdictionResolvers.ts:492`). Align the failure-path seed write with the queried row (D3).
**This is the prerequisite for any AHJ data acquisition to be worth doing.**

### A7 · ASCE authority propagation & conflict behaviour (D6, D7, D8) — Tier 1
- **D6:** `engine-default` is re-labelled `structural-engine-basis` one hop downstream, and the basis string
  strengthens from *"stated as a default"* to *"the engine computed under"*
  (`codeAuthority.ts:352-357, :373-377` vs `asceAuthority.ts:144-150`). The stronger claim reaches the sheets.
  **Repair: the label must not strengthen in transit.**
- **D8:** the **verified** archived hazard document names its edition (`sourceVersionOrDate: "ASCE 7-22"`,
  sha `cedb14f7…`) and the ASCE decision cannot read it — `resolveAsceEditionAuthority` reads only
  `environmentalRetrieval?.edition` (`asceAuthority.ts:111`; `resolvers.ts:369`).
  **Repair: let a verified archived hazard document establish the ASCE edition rank.**
- **D7:** `conflict` is permanently `false` by construction (`adoptedEdition` can never be non-null: no `asce`
  member on `RetrievedCodeAdoption`, no `asce_edition` column) and has **zero consumers**. The D13 test
  injects `registryField: 'StructuralCode'`, a value the real builder never emits, and never imports
  `buildCodeAdoptionAuthority` — 9/9 green and vacuous
  (`tests/planset/r7-d13-asce-edition-authority.test.ts:42-61`).
  **Repair: make the conflict branch reachable and give it at least one consumer, or delete it and say so.
  A permanently-false safety flag is worse than no flag.**

**D9 (nothing recomputes if the adopted IBC names a different ASCE edition) is OUT OF SCOPE** — it is a
source-of-truth change to the structural engine. Record the boundary explicitly in the commit message.

### Phase A acceptance
- `tsc --noEmit` exit 0
- `npx vitest run tests/planset tests/goldens --maxWorkers 2` — 0 failures
- `npx next build` exit 0
- Live read-only Braidon regen completes; record digest, sheet count, gate count, unresolved count
- **A test that FAILS at `47e0092d` and passes after, for each of A1, A2, A3, A5, A6, A7-D8**
- Commit. Push. **Then stop and report before starting Phase B.**

---

## 3 · PHASE B — Dead Requirement Recovery

Three requirements have **no writer at all** for the field their predicate reads. A gate that cannot close
is worse than an open one.

### B1 · Authoritative fastener assembly writer (D22) — Tier 1 #6
`resolveFastenerVerification` reads `ra.datasheetSource ?? ra.capacitySource`
(`structuralProjection.ts:494-511`) — both compiled-in catalogue strings.
`documentRoles.fastenerAuthority` / `installationAuthority` are unconditional `unfilledRole` calls.

**Repair:** wire `manufacturer_document_registry` into those roles so a verified installation document can
satisfy the predicate. **ESR-3575 is a flashing / water-resistance report and is NOT fastener authority** —
it must not satisfy it.

### B2 · Document applicability / alias evidence (D21) — Tier 1 #7
The only non-source-edit exit from `evaluateDocumentApplicability` needs `aliasEvidence`, hardcoded `null`
at `structuralAuthority.ts:1001` and `build.ts:2749`, **with no producer anywhere**.

**Repair, pick one and justify it:**
(a) decide applicability from the **archived registry document** instead of the static asset's `docTitle` —
the canonical `equipmentDocumentAuthority` region already does this and is bypassed by all three call sites
(`structuralAuthority.ts:171, 1001`; `build.ts:2681`); or
(b) implement a real producer for `DocumentApplicabilityAlias`.

(a) is preferred: the version-exact RT-MINI manual is already archived and hashed.
**Also fix D28:** give the requirement a META entry (`sheets: ['PV-3','DS-3','APP-A']`) or classify it
`structural` — today `affectedSheets: []` means `requirementAffectsSheet` is false for every sheet.

### B3 · Tap conductor length state machine (D34) — Tier 1 #5
`state: 'pending'` is an unconditional literal (`build.ts:914`); grep `state: 'pass'` / `'fail'` over `lib/`
returns **zero**. No assignment to any topology object's `.lengthFt` / `.constraints` exists. No input socket.

#### ⚖ DESIGNER RULING (Ray, 2026-08-24) — BINDING. Supersedes the earlier "emit a TAP_CONDUCTOR_RUN" plan.

> For the current Braidon service topology, `svc-tap-conductors` and `DISCO_TO_METER_RUN` refer to **the same
> physical conductor span** between the fused AC disconnect and the supply-side service tap point, **viewed
> from opposite directions. They must not maintain independent physical-length authority.**

**This is now visible on the delivered sheet.** Both render as rows of the PV-4B table
*"CONDUCTOR SCHEDULE — PHYSICAL SECTIONS"* (sheet 10 of 19), under a caption reading
*"Each row is a DISTINCT canonical physical section"* (`lib/permit/sections/electricalPages.ts:231`):

| row | endpoints as rendered | raceway as rendered |
|---|---|---|
| `DISCO_TO_METER_RUN` | AC DISCONNECT → MAIN SERVICE PANEL | `RW-DISCO_TO_METER_RUN`, PVC Sch 80 1-1/4", fill 29.0%, `#10` EGC in raceway |
| `svc-tap-conductors` | SUPPLY-SIDE TAP POINT → FUSED AC DISCONNECT | "PER SERVICE ENTRANCE", open air, `#6` EGC with the service conductors |

One physical span, rendered twice, with **two different raceway treatments and two different EGC
assignments**, under a caption asserting they are distinct sections.

**⚠ REQUIRED CHECK — do this before designing the fix:** determine whether that duplication also
**double-counts conductors in the BOM / procurement** (two `#6 AWG` inventories for one span). Report the
answer either way. If it does, that is a finding, not a licence to widen scope.

#### Ownership split — preserve it

- **`DISCO_TO_METER_RUN` (canonical route object) owns the PHYSICAL span:** endpoints, raceway, conductor
  inventory, measured/CAD length, field-verification provenance.
- **`svc-tap-conductors` remains the service-topology / TAP-RULE authority.** It **consumes** the canonical
  route length and decides whether that span satisfies the applicable tap-conductor length constraint.

#### Prohibitions

- **Do NOT create a `TAP_CONDUCTOR_RUN` segment.** That was my earlier recommendation and the ruling
  overrides it — it would create the second length authority the ruling forbids.
- **Do NOT add a second tap-conductor measurement field.**
- **Do NOT synchronise two copied length values.** Link the service-topology object to the canonical route by
  **stable object ID / reference**, not by copying the number.
- **Do NOT merge `COMBINER_TO_DISCO_RUN` into this span.** It is a separate physical segment
  (AC COMBINER → AC DISCONNECT) and stays independent.

#### Required behaviour — all three states

| state | route-length authority | tap-rule evaluation | requirements |
|---|---|---|---|
| no authoritative measurement | pending / estimated | not evaluable | `TAP-CONDUCTOR-LENGTH-PENDING` **remains blocking** |
| authoritative length **≤ 10 ft** | **established** | **PASS** | both applicable requirements **may clear — each through its own predicate and its own audit record** |
| authoritative length **> 10 ft** | **established** | **FAIL / noncompliant** | the route-estimate requirement may clear; **the tap requirement must remain blocking, or transition to an explicit failure state. It must NEVER disappear merely because a measurement exists.** |

**⚠ The >10 ft branch probably needs a NEW requirement code.** The existing code is literally named
`…-LENGTH-PENDING`; once a length exists, that name asserts the opposite of the actual condition. Expect to
add something like `TAP-CONDUCTOR-LENGTH-EXCEEDED` — which means **the full five registrations**:
`releaseGates.ts` declaration · `build.ts` meta map · `severityPolicy.ts` impact · `projectAuthority.ts`
domain · `reviewStatus.ts` treatment. Missing any one fails closed into `RG-UNMAPPED`.
If you instead keep one code across both states, you must justify why a requirement whose name says
"pending" is the right carrier for a proven violation.

#### Rendering

Correct the PV-4B caption at `electricalPages.ts:231` if both rows continue to render. They are **two
authority views of one physical span**, not two distinct canonical physical sections. Either re-caption, or
render the tap row in a way that shows it as a rule view over `DISCO_TO_METER_RUN` rather than a peer section.
Note `build.ts:2065` carries related "distinct physical sections" language for the branch-raceway model —
that one is about the Q-Cable trunk vs the shared home-run raceway and is **correct**; do not disturb it.

#### Proof required

Prove the relationship through canonical object lineage and tests, end to end:

```
field/CAD measurement → canonical route length (DISCO_TO_METER_RUN)
                      → route authority  +  tap-rule evaluation (svc-tap-conductors, by reference)
```

Three tests minimum, one per state above. The >10 ft test is the one that matters most — it must prove the
tap requirement **does not vanish** when a measurement arrives. **The DB needs no change**
(`118_field_route_measurements.sql:97` is unconstrained).

### B4 · Fire-and-clear tests (T1, T3, T4, T6)
For each of the three recovered requirements, and for A1/A2/A5:
- **emission-positive** — a state where it fires
- **emission-negative** — a state where it does not
- **automatic-clear** — supply the authority through the **real service/socket** and prove the registry entry
  **disappears**, not merely that an upstream field changed. T5 exists because FRAMING and RAIL-SELECTION
  both stop one hop short of this.
- **anti-vacuity** — the branch must be proven reachable. Copy the shape of
  `ws5-field-measurement-reachability.test.ts:53-62, 244-281` — it is the only complete example in the repo:
  a separate controlled identity, the real service, recording ≠ verifying, reopen paths, and an
  `Object.isFrozen` + throwing-write guard.

**Manufacture the state. Never pin "this project is pending."** `synthetic-pending-grounding.ts` and
`synthetic-unresolved-procurement.ts` are the established pattern.

### Phase B acceptance
Same gates as Phase A, plus:
- Each of the three dead requirements has a test proving it **fires** AND a test proving it **clears**
- No test asserts a live-project state as a proxy for behaviour
- Commit. Push. **Stop.**

---

## 4 · THE REGENERATION — and what success actually looks like

After each phase, regenerate Braidon read-only and record: digest, sheet count, open gate count,
unresolved count, and the full unresolved code list.

**EXPECT THE COUNT TO STAY AT 12. That is success, not failure.**

Tier 0 + Tier 1 are propagation and plumbing repairs. They do not supply missing external evidence, and live
DB writes are blocked by the unrotated credential. Specifically:

| requirement | why it stays open after this phase |
|---|---|
| CODE-AUTHORITY-INCOMPLETE | county row is now *inspectable*, but is `seeded-unprovenanced` and can never clear |
| MODULE-EXACT-DATASHEET-PENDING | needs a registry row + a human verifier; out of scope, write-blocked |
| FRAMING-AUTHORITY-UNVERIFIED | needs a stamped document or PE review |
| PENDING-RACKING-ASSEMBLY-SELECTION | needs a design decision |
| FASTENER-ASSEMBLY-UNVERIFIED | now *clearable*; the document is still unverified |
| EQUIPMENT-DOCUMENT-APPLICABILITY | may clear if (a) is chosen and the archived manual satisfies it — **the one plausible natural drop** |
| RACKING-CAPACITY-{SOURCE,APPLICABILITY} | `extracted_claims` NULL; the declared split is Tier 3 |
| ROUTE-LENGTH-ESTIMATE | needs field measurement |
| TAP-CONDUCTOR-LENGTH-PENDING | now *clearable*; no measurement exists, and live writes are blocked |
| ROUTE-LENGTH-ESTIMATE ∧ TAP | ⚠ after B3 these become **coupled** — one measurement on `DISCO_TO_METER_RUN` feeds both. That is correct per the ruling, but it means a future field measurement moves two requirements at once. Say so in the regen report. |
| DESIGNER-OF-RECORD-MISSING | needs one admin write; write-blocked |
| ENGINEERING-REVIEW-PENDING | needs a PE |

**The deliverable is proof of REACHABILITY, not a lower number.** If the count drops, explain exactly which
authority object changed and why — an unexplained drop is a defect, not a win. If a requirement clears
without a `resolutionAuditRef`, that is A3 regressing.

---

## 5 · VERIFICATION RECIPE — this machine

```bash
npx tsc --noEmit
npx vitest run tests/planset tests/goldens --maxWorkers 2
npx next build
```

- **`--maxWorkers 2`.** At 3 the runner crashes on this box (`0xC0000409`), at baseline as well as with
  changes. A crash there is the machine, not your change — prove it by stashing.
- `next build` needs memory headroom. If it dies with `spawn UNKNOWN` (errno -4094) or `0xC0000409`, check
  commit charge and ask Ray to close browser windows; do not chase it as a code bug.
- `next build` rewrites `next-env.d.ts` every run. `git checkout -- next-env.d.ts` before committing.
- Live read-only probe pattern: `.db_url` is in the PARENT dir (`../.db_url`),
  `SET default_transaction_read_only = on` + verify with `SHOW`, `NEARMAP_AI_CACHE_ONLY=1`.
- Commit messages: write to a file and `git commit -F <file>`. PowerShell here-strings mangle them.
- Push: `git -c credential.helper=wincred push origin dev`. The first helper errors noisily and the push
  still succeeds — check for `dev -> dev`, not the stderr.
- Work on `dev`. Never push master.

---

## 6 · REPORTING

After each phase, report: a synopsis of every change (file, behaviour, old → new); which test failed before
and passes after, per defect; the four gate results; the Braidon regen numbers with the previous run beside
them; and anything you found and deliberately did NOT fix, with its defect id.

**If a repair turns out to be wrong or larger than the audit implied, stop and say so.** Do not widen scope
to make it fit.

**STOP after Phase B. Do not start Tier 2.**
