# TRANSIENT RESOLVER DIGEST-DRIFT — CLOSURE

**Branch:** `dev` · **Date:** 2026-08-06

**The target.** An unchanged permit design must not receive a different digest merely
because a transient resolver retrieval outcome changed.

---

## 1 · The proven drift path

The suspected cause recorded during D13 — *"RUN_INSTANT_KEYS excludes WHEN a resolver ran,
but the snapshot still digests WHAT the resolver recorded"* — is **confirmed**, and the
injection widened it to three more paths that inspection alone would have missed.

### 1.1 Primary proof — deterministic injection through the real path

Live stored Braidon design, real resolver lifecycle through the real `ResolutionDeps`
DI seams (`safeDbRead`, `providers`), real snapshot build, real renderer.
**The clock was FIXED for every variant** (`generatedAtIso = 2026-08-06T12:00:00.000Z`),
so the transient attempt outcome was the only variable. Read-only: every WRITE label was
refused identically in every variant; `NEARMAP_AI_CACHE_ONLY=1`.

Forcing `safeDbRead('resolveRackingCapacityDocument')` to fail transiently:

| | before repair | after repair |
|---|---|---|
| canonical-body leaf diff vs clean run | **6 paths** | **0 paths** |
| differing HTML lines | **31** | **0** |
| snapshot digest | **MOVED** | stable |
| HTML digest | **MOVED** | stable |
| accepted authority | identical | identical |
| release verdict + all 12 gates | identical | identical |

The entire before-diff:

```
permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].failureReason
  "no matching verified capacity document"
    → "resolveRackingCapacityDocument: ETIMEDOUT connection timed out after 30000ms"
permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].retryability
  "REQUIRES_INPUT" → "RETRYABLE"
```

**Two different wordings of the same temporary failure produced two different digests.**
The 31 differing HTML lines match the D13 field observation exactly.

Variant summary on the live design (7 variants):

| | before | after |
|---|---|---|
| distinct snapshot digests | **5** | **2** |
| distinct HTML digests | **5** | **2** |

The remaining pair is C1/C2 — two different *provider* error wordings — and they are
**identical to each other**. They differ from the rest only because the injected
document-retrieval outage genuinely changed the **selected document**
(`capacityDocumentId: doc-rooftech-rtmini2-pe-letter-73a74973091c → null`,
`selectedDocument.tier: REGISTRY_CANDIDATE → STATIC_ASSET`). Under the materiality rules
a changed selected document **must** move the digest. See §6 for the follow-up this exposes.

### 1.2 Full leak surface (audit)

Every field was classified by mutating it on the live snapshot and recomputing the hash.

**C — operational attempt evidence that was moving the digest (all repaired):**

| path | how it leaked |
|---|---|
| `permitReadiness.registry[].payload.resolutionEvidence[]` | whole attempt array: `failureReason`, `retryability`, `iteration`, `operatorAction`, `confidence`, `sourceQueried`, `inputs` |
| `permitReadiness.registry[].payload.resolutionEvidenceCount` | attempt count |
| `permitReadiness.registry[].payload.attemptedResolvers` | attempt order |
| `permitReadiness.registry[].payload.retryability` / `.resolutionConfidence` | attempt quality |
| `permitReadiness.registry[].payload.resolutionBlockingReason` | resolvers interpolated the raw `read.error` / `res.failure` into `clearance.reasons` (7 sites) |
| `resolutionAuthority.structuralDocumentRetrieval.attempts[]` | `httpStatus`, `contentType`, `byteLength`, `failure`, `proof`, `notes`, `archival.failure` |
| `resolutionAuthority.projectPersonnel.storeError` | raw `read.error` |
| `resolutionAuthority.moduleDatasheetBinding.modules[].registryLookup.failure` | raw `read.error` |
| `resolutionAuthority.environmentalRetrieval.registryArchival.failure` | raw archival error |

**A/B — material authority, correctly still moving the digest (verified unchanged):**
`equipment.*.datasheet.capturedAtIso` (the D11 guard), accepted document id + SHA-256,
`registry[].resolved`, `resolutionAuditRef`, `permitReadiness.ready`, module wattage,
`NO_COVERAGE` and `AMBIGUOUS` retrieval answers.

**Already excluded before this phase (controls, re-verified):** `atIso`,
`lastResolutionAttempt`, `framingRetrieval.attemptedAtIso`, `meta.generatedAtIso`,
`permitReadiness.registry[].createdAtIso`.

### 1.3 Supplementary — 20 live read-only generations

Unmodified production path (real DB, real providers, real clock),
`NEARMAP_AI_CACHE_ONLY=1`, no new AI parcels, no writes to the Braidon design.

**Run A — before the `jurisdictionResolvers` repair: 20 COMPLETED, 0 ERRORED, but
2 distinct digests.** Runs 2, 3 and 4 differed. **Natural live drift DID reproduce.**
The cause was isolated exactly: `PROJECT-AUTHORITY-UNVERIFIED` went `RESOLVED → FAILED`
during a Census outage, opening a 13th requirement. Accepted-authority identities were
identical across all 20 runs. That observation is what found the third leak family — the
provider failure string in `clearance.reasons` — which inspection of `safeDbRead` alone had
missed, and it is why the anti-vacuity sweep now covers providers as well.

**Run B — after the repair: 20 COMPLETED, 0 ERRORED.**

| measure | value |
|---|---|
| unique snapshot digests | **1** — `653f21013d093a588bd238fd5417fd24b95ac7e5c79248a3a3eb83dc94440f0e` |
| unique HTML digests | **1** — `486a02566d08be02aad77fc6d0cd4054a6d29b7aea9ebddefe5863fa2f96b965` |
| unique HTML byte counts | **1** — 2 233 923 B |
| sheet count (title block, `SHEET 1 OF 25`) | 25 |
| release verdict | NOT READY (all 20) |
| open gates | `RG-1, RG-2, RG-4, RG-5, RG-7` — OPEN (all 20) |
| unresolved requirements | 12, identical set (all 20) |
| resolver-outcome maps | 1 |
| accepted-authority identities | 1 — Q.PEAK DUO BLK ML-G10+ 400 W / 400 W / RT-MINI / rail null / NEC 2020 |

**Honest qualification.** Run B's single digest was obtained while the Census provider was
available throughout. Run A shows that when it is *not*, the digest still moves — for the
separate reason in §6 item 1, which this phase did not close.

---

## 2 · Architecture

### Before

One function, `resolutionStatePayload`, flattened the whole `RequirementResolutionState`
— accepted authority *and* attempt evidence together — into
`permitReadiness.registry[].payload`, which is digest input and RS-1 render input. Resolvers
independently interpolated raw transport errors into `clearance.reasons`, which is also
digested. `MCC §0`'s `RUN_INSTANT_KEYS` excluded *when* a resolver ran and nothing excluded
*what it recorded about the attempt*.

### After — an explicit typed projection boundary

New module `lib/permit/snapshot/resolution/authorityProjection.ts`:

- **`ResolvedAuthorityProjection`** — the ONE canonical resolver-derived shape that may enter
  the digest: resolver id + implementation state, resolution mode + residual, `authorityState`
  (`ESTABLISHED | NOT_ESTABLISHED | NOT_APPLICABLE | RESOLVER_NOT_IMPLEMENTED | NOT_YET_ATTEMPTED`),
  the permit-safe display scalar, an enumerated `unresolvedReasonCode`, the material
  blocking reason, and the material required inputs.
- **`ResolverAttemptEvidence`** — *identified*, not duplicated: the existing
  `ResolutionEvidenceRecord` already is the attempt record (attempt instant, raw failure
  message, retryability, last attempted source, inputs, iteration). A second near-identical
  interface would have been a duplicate concept created to satisfy a name.
- **`OPERATIONAL_AUTHORITY_FIELDS` + `elideOperationalAuthority`** — an explicit, closed,
  per-record map of the operational fields on the `resolutionAuthority` records. Named by
  record and field, so a same-named field elsewhere in the snapshot is untouched.
- **`materialRetrievalReason`** — splits `RetrievalFailure.failure` by **failure kind**:
  `TRANSPORT` / `PARSE` describe the attempt and are replaced by a stable sentence;
  `NO_COVERAGE`, `AMBIGUOUS`, `NOT_CONFIGURED`, `INSUFFICIENT_QUERY` are the source's
  *answer about this site* and stay in the digest verbatim.
- **`snapshot.resolverAttemptEvidence`** — ONE declared container for everything operational.
  `computeSnapshotDigest` skips this single top-level key, the same structural device already
  used for `meta.digest`. **This is a container exclusion, not a key-name exclusion** — a broad
  recursive rule on `failure` / `reason` / `source` / `timestamp` would have deleted
  `equipment.*.datasheet.capturedAtIso`, which is real document provenance (D11).

Storing the container *inside* the snapshot rather than attaching it after the hash keeps
archived packages diffable without a second artifact.

### Files changed

| file | change |
|---|---|
| `lib/permit/snapshot/resolution/authorityProjection.ts` | **new** — the boundary |
| `lib/permit/snapshot/resolution/evidence.ts` | `resolutionStatePayload` returns the projection only |
| `lib/permit/snapshot/digest.ts` | `canonicalDigestBody` exported (durable diagnostic); container excluded |
| `lib/permit/snapshot/types.ts` | `resolverAttemptEvidence` on `PermitDesignSnapshot` |
| `lib/permit/snapshot/build.ts` | populates the container; elides operational fields from `resolutionAuthority`; PASS-2 review record elided too |
| `lib/permit/generatePermit.ts` | threads the full lifecycle attempt trail |
| `lib/permit/snapshot/resolution/resolvers.ts` | 4 sites: material reason no longer carries `read.error` |
| `lib/permit/snapshot/resolution/jurisdictionResolvers.ts` | 3 sites: material reason split by failure kind |
| `tests/planset/tr-transient-resolver-digest.test.ts` | **new** — 14 tests |
| `tests/planset/aac-ws3-ws4-ahj-environmental.test.ts` | 1 assertion re-pointed (see §4) |

---

## 3 · Consumer audit

| consumer | reads | verdict |
|---|---|---|
| canonical digest | `permitReadiness.registry[].payload`, `resolutionAuthority.*` | **REPAIRED** (mandatory 1) |
| approval coverage / staleness | `meta.digest` only | **fixed by the digest repair** (mandatory 2) — no separate change needed |
| requirement + release-gate projection | `projectReleaseGates(snapshot)` — a pure projection of the same frozen registry | material state no longer depends on attempt detail (mandatory 3) |
| RS-1 renderer | `renderBlockerPayload` → `payloadGeneric`, prints the payload's primitives | **fixed by the payload change** — no renderer redesign (mandatory 4) |
| planset sheets, BOM/procurement, calculations | do not read `resolutionAuthority` or attempt evidence at all (verified: zero references outside `build.ts`) | **no change required** |

---

## 4 · Existing tests

No test was weakened. Three assertions in `aac-ws3-ws4-ahj-environmental.test.ts` failed on
the first repair because it over-collapsed `res.failure`. Two of those failures were **real
regressions I introduced** — `AMBIGUOUS` (both overlapping authorities named with their
editions) and `NO_COVERAGE` ("ground snow load NOT retrieved") are material findings about the
site, not attempt evidence. That is what forced the `failureKind` split in §2, and both
assertions now pass unmodified.

The third assertion genuinely asserted the defect: it required a `TimeoutError` to appear in
the **digested** `blockingReason`. It was **re-pointed, not deleted** — the exact transport
failure is still asserted present, on the evidence record where it now lives, plus a new
assertion that it is *absent* from `blockingReason`, plus a new assertion that the
`NO_COVERAGE` answer *is* still digested. The guarantee ("the exact failure is never
swallowed") is unchanged; only its home is.

---

## 5 · Verification

| gate | result |
|---|---|
| new targeted tests | **14 / 14 pass** |
| full suite (`npx vitest run --maxWorkers 3`) | **440 files, 9948 tests pass**, 17 files / 490 skipped, **0 failed**, exit 0 |
| `npx tsc --noEmit` | **exit 0** |
| production build | attempt 1 **failed** — `spawn UNKNOWN` (errno −4094) collecting page data, the known local worker exhaustion immediately after the full suite. **Clean rerun: exit 0**, all routes emitted. Both reported. |

### Anti-vacuity

The sweep in `TR §A` fails each of the **16 real `safeDbRead` labels** the production
lifecycle issues, twice each with different wordings, and demands one digest across the
whole sweep. A second sweep does the same for **provider** failures. The provider sweep was
verified non-vacuous by temporarily restoring the old behaviour — it failed with exactly:

```
permitReadiness.registry[10].payload.resolutionBlockingReason:
  "census-property-identity: ETIMEDOUT …" → "census-property-identity: ECONNRESET …"
```

---

## 6 · Remaining risks — stated honestly

1. **A transient external retrieval failure can still change the release-relevant
   conclusion, and that still moves the digest.** Found by the live 20-run observation, not by
   inspection: `project-authority@v1` calls the live Census provider, and when it is down the
   requirement `PROJECT-AUTHORITY-UNVERIFIED` flips `RESOLVED → FAILED` and *opens*. Under the
   phase's own materiality rules ("a requirement opens or closes" ⇒ digest changes) that
   movement is correct — but it means an unchanged design can still receive a different digest
   while Census is unavailable. Closing it means **retaining** a previously-retrieved legal
   authority across a provider blip, which needs persistence the engine does not have. That is
   a separate phase; it requires writes, and this phase is read-only.

2. **A transient document-retrieval outage changes which document the design cites.**
   Variant C: with `documentRetrieval` failing, `racking-documents@v1` aborts before publishing
   its DB-derived `documentRegistryFacts`, so the design falls back from `REGISTRY_CANDIDATE`
   to `STATIC_ASSET` and loses facts it could have read from the database. A resilience defect,
   not a digest-projection defect.

3. **`resolutionAuthority.rackingAssemblySelection.probes[]`** is digest-sensitive to order.
   The probe list is declared statically, so it cannot vary at runtime — **documented, not
   redesigned**, as instructed.

4. **`computeSnapshotDigest(storedSnapshot) ≠ storedSnapshot.meta.digest`** in general, because
   `certification`, `projectAuthority` and `resolutionAuthority.engineeringReview` are rebuilt
   in PASS 2 *after* the hash. Pre-existing and deliberate (PRR §1: the digest identifies the
   design, not its approval state). Noted because it defeats naive digest re-verification of a
   stored snapshot.

5. **Digests move once.** The payload schema changed, so every existing snapshot digest is
   superseded. No test pinned an absolute digest value; all digest tests are relative.
