# OUTAGE-RESILIENT AUTHORITY RETENTION — CLOSURE

**Branch:** `dev` · **Base:** `c926acf0` (transient-resolver digest drift)

**The rule:** accepted durable authority outranks temporary retrieval health.

---

## 1 · Proven defects

### A · A Census outage erased the accepted legal jurisdiction

Measured on the real path, one unchanged design, Census forced to time out:

| | Census up | Census down |
|---|---|---|
| `legalJurisdiction` | **Madison County B&Z `[verified]`** `il-madison-county` | **City of Granite City B&Z `[unverified]`** `il-madison-granite-city` |
| `resolutionAuthority.projectLegalAuthority` | PRESENT | **NULL** |
| rendered `project.ahjName` | Madison County | **City of Granite City** |
| `PROJECT-AUTHORITY-UNVERIFIED` | closed | **open** |

Granite City is the **mailing city**, seeded from the posted record by
`project-authority-key@v1`. The outage did not merely reopen a requirement and move
the digest — it re-stamped the package with the wrong governing jurisdiction, and
because `legalUsable` gates archival in `structuralResolvers`, it blocked document
archival at the same time. This is D4's defect reappearing at runtime, driven by
transport health.

On the **live** Braidon project the name does not revert (an earlier governed run
already corrected `project.ahjName` in the stored record) but the **verification
state does** — `verified → unverified` — which is what opens the requirement and
blocks archival. Both forms are real; the fixture shows the worse one.

### B · A retrieval timeout downgraded the accepted registry document

`racking-documents@v1` built its candidate pool **only** from attempts whose
`outcome === 'RETRIEVED'` *in this run*. The registry rows are durable and the
document id is content-derived, but the resolver reached them only through
`getDocument(id)` *after* a fetch produced the hash. So one timeout emptied the
pool and `selectEquipmentDocument` fell `REGISTRY_CANDIDATE → STATIC_ASSET`: an
unhashed render cache cited in place of the archived document already on file.
Measured previously at 111 canonical-body leaf paths.

---

## 2 · Audit answers

### Legal-jurisdiction path

1. **Where is the last accepted authority stored?** Nowhere dedicated. It is inside the
   snapshot the last governed run froze into `permit_input.json`. The route already
   reaches into exactly that file for `_priorSnapshotDigest`.
2. **Is it read before Census?** It was not. It is now (`readRetainedLegalAuthority`).
3. **Did the resolver distinguish the four cases?** No — only *no provider* (SKIPPED),
   *failed* (FAILED), *success* (RESOLVED). There was no notion of retained.
4. **What changed RESOLVED → FAILED?** `jurisdictionResolvers.ts` `!res.ok` →
   `result: 'FAILED'`, `cleared: false`, `auditRef: null`, for **every** failure kind.
5. **Did a failed refresh overwrite authority?** It did not patch the bundle — but the
   bundle then kept `project-authority-key@v1`'s mailing-derived value and
   `resolutionAuthority.projectLegalAuthority` became null. The projected authority
   was erased and silently replaced by a weaker, wrong one.
6. **What makes retained authority governed?** `ProjectLegalAuthorityRecord` carries
   `verified`, per-field `state`/`basis`, `sourceHash`, `boundaryEvidence` and
   `confirmationRequired[]`; the jurisdiction carries `verificationState` and a stable
   `ahjRecordId`. Retention requires **both** to be verified.
7. **Which fields stay material?** `ahjRecordId`, `ahjName`, `jurisdictionType`,
   `county`, `stateCode`, `unincorporated`, `verificationState`, provenance ref/basis.
8. **Where does refresh evidence live?** `snapshot.resolverAttemptEvidence`.

### Racking-document path

1. **Which registry facts exist before retrieval?** All of them — archived rows in
   `manufacturer_document_registry`, queryable by `equipmentId`.
2. **Why could a timeout replace them?** The pool was rebuilt from this run's fetches.
3. **What is retrieval for?** Bytes and hash. The resolver says so where it archives:
   *"Retrieval establishes existence + bytes, never applicability."*
4. **What precedence exists?** `selectEquipmentDocument` — REGISTRY_AUTHORITY >
   REGISTRY_CANDIDATE > STATIC_ASSET > UNAVAILABLE. **Correct and unchanged**; the
   defect was upstream, in the pool it was given.
5. **Did it conflate unavailable-registry with failed-attempt?** Yes. Now separated
   (`NO_REGISTRY_AUTHORITY` vs `RETRIEVAL_FAILED_RETAINED`).
6. **Do gate, digest and renderer consume the same document?** Yes — all read the
   frozen `snapshot.equipmentDocumentAuthority`.
7. **Can consumers recompute selection?** No. `selectEquipmentDocument` is called from
   exactly one place.

---

## 3 · Architecture

New module `lib/permit/snapshot/resolution/retainedAuthority.ts`:

- **Six legal states** — `NO_RETAINED_AUTHORITY`, `RETAINED_AUTHORITY_CURRENT`,
  `REFRESH_SUCCEEDED_SAME_AUTHORITY`, `REFRESH_SUCCEEDED_CHANGED_AUTHORITY`,
  `REFRESH_FAILED_RETAINED`, `AUTHORITY_CONFLICT`.
- **Six registry states** — `NO_REGISTRY_AUTHORITY`, `REGISTRY_AUTHORITY_ACCEPTED`,
  `RETRIEVAL_SUCCEEDED`, `RETRIEVAL_FAILED_RETAINED`, `REGISTRY_DOCUMENT_CHANGED`,
  `REGISTRY_AUTHORITY_INVALID`.
- `readRetainedLegalAuthority` + `isGovernedLegalAuthority` — **retention is not
  promotion**: an `unverified` / `conflict` jurisdiction, or one whose backing record
  was not verified, is refused.
- `isRefreshOutage` — retention applies **only** to `TRANSPORT` / `PARSE`.
  `NO_COVERAGE` and `AMBIGUOUS` are the source *answering about this parcel* and stay
  findings; `NOT_CONFIGURED` / `INSUFFICIENT_QUERY` are deployment facts.
- `registryRowToIdentity` / `isUsableRegistryAuthority` / `mergeRegistryIdentities` —
  a withdrawn, unarchived or unhashed row never enters the pool, so genuine
  invalidation is never disguised as an outage.

`resolutionAuthority.legalJurisdiction` is now **projected onto the snapshot**, making
the accepted authority durable and first-class. `racking-documents@v1` reads the
registry by equipment **before** any fetch, and mirrors `attemptableSources`' adopted-
edition preference when choosing the accepted capacity document, so the same document
is selected whether or not the fetch happened.

**One extra leak found and closed during the work:**
`structuralDocumentRetrieval.attempts[]` still moved the digest by *shape and length*
(TR had elided only its transient fields). It is now operational in full — safe to
drop only because the accepted document identity no longer derives from it.

### Files changed

| file | change |
|---|---|
| `resolution/retainedAuthority.ts` | **new** — states, guards, durable projections |
| `resolution/jurisdictionResolvers.ts` | retention, conflict path, six states |
| `resolution/structuralResolvers.ts` | durable pool, accepted document ids, edition mirroring |
| `resolution/authorityProjection.ts` | `attempts[]` operational in full; `chainFailures` elided |
| `snapshot/build.ts`, `snapshot/types.ts`, `generatePermit.ts` | project `legalJurisdiction` |
| `app/api/engineering/permit/route.ts` | attach `_priorSnapshot` |
| `tests/planset/oar-outage-resilient-authority.test.ts` | **new** — 16 tests |

---

## 4 · Live read-only injection proof

Real DB, real lifecycle, fixed clock, every WRITE label refused identically,
`NEARMAP_AI_CACHE_ONLY=1`. Two-pass: pass 1 (clean) produces the governed authority,
pass 2 consumes it as `_priorSnapshot`. **Nothing written back.**

Six variants — clean · Census outage #1 · Census outage #2 (different wording) ·
document-retrieval timeout · timeout (different wording) · both down:

| measure | result |
|---|---|
| distinct snapshot digests | **1** |
| distinct HTML digests | **1** |
| distinct accepted legal authority | **1** — Madison County B&Z `[verified]` |
| distinct selected documents | **1** — `REGISTRY_CANDIDATE doc-rooftech-rtmini-install-manual-2f6035586e94` |
| distinct open-blocking sets | **1** (12) |
| distinct sheet counts | **1** (25) |
| attempt evidence identical | **no** — the outages differ, as they must |

Progression while repairing: Census outage 134 → **0** leaf paths; retrieval timeout
15 → 1 → **0**.

**Control — no retained authority + Census outage:** digest MOVES, requirement opens
(13 blocking), `legalJurisdiction` drops to `[unverified]`. Nothing is fabricated.

### Material-change controls (fixtures, not live data)

- accepted registry document **hash** changes ⇒ digest moves (test 9)
- verification **revoked** ⇒ digest moves; **withdrawn** ⇒ leaves the pool (test 10)
- a genuinely different **verified** jurisdiction ⇒ `REFRESH_SUCCEEDED_CHANGED_AUTHORITY`,
  digest moves, prior approval no longer covers (test 5)
- an **unverified** refresh disagreeing with a governed authority ⇒ conflict, no
  auto-replace (test 5b)

---

## 5 · Verification

| gate | result |
|---|---|
| new targeted tests | **16 / 16 pass** |
| full suite (`--maxWorkers 3`) | **441 files, 9964 tests pass**, 17 files / 490 skipped, **0 failed**, exit 0 |
| `npx tsc --noEmit` | **exit 0** |
| production build | **exit 0** (one earlier failure was the known `spawn UNKNOWN` errno −4094 while the live harness was running concurrently) |

---

## 6 · Remaining live-data requirements and risks

1. **Retention needs one governed run to seed it.** The stored Braidon
   `permit_input.json` predates `resolutionAuthority.legalJurisdiction`, so the first
   real regeneration has nothing to retain and behaves exactly as before. From the
   next governed POST onward the authority is durable. The live proof therefore used a
   controlled two-pass rather than the stored artifact. **No Braidon data was written.**
2. **Retention rides on the stored snapshot, not a dedicated authority store.** If
   `permit_input.json` is absent or unparseable the route fails soft and there is
   nothing to retain — correct, but it means retention is only as durable as that
   artifact. A dedicated accepted-authority table would be stronger; it needs a
   migration and was out of scope.
3. **Multiple archived capacity letters per mount are genuinely ambiguous.** The
   registry holds RT-MINI II letters for ASCE 7-10 *and* 7-16. The durable pick mirrors
   `attemptableSources` (adopted edition first, then declared order, then documentId),
   which reproduces the retrieval's choice — but if the adopted edition is unknown the
   preference is declared-order, not evidence.
4. **`AUTHORITY_CONFLICT` keeps the retained identity at `verificationState: 'conflict'`.**
   That refuses document stamping and leaves the requirement open, which is the
   fail-closed posture — but it does not yet route to a governed operator-resolution
   workflow. Surfaced, not resolved.
5. **Digests move once.** `legalJurisdiction` is new digest content and
   `structuralDocumentRetrieval.attempts[]` left it. No test pinned an absolute digest.
