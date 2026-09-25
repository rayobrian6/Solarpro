# Proposal Integrity — Verification of Research Claims

**Date:** 2026-09-25
**Method:** read-only inspection of committed source on disk. No tests run, no git operations, no product source edited.
**Note:** a security repair for a different proposal issue is parked in a git stash; it was deliberately ignored. Everything below judges the committed code as it stands.

---

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | `refresh_snapshot` has no status guard; does not re-freeze `pricingSnapshot` | **CONFIRMED** — and it is not the worst instance of this hole |
| 2 | Zero drift detection | **CONFIRMED** |
| 3 | Homeowner never sees the array; static map, no panels | **CONFIRMED** |
| 4 | Orphaned second renderer; `roadmapRE26.ts:931` claim false; `purchaseMode` disagreement | **PARTLY CONFIRMED** — "orphaned module" is wrong; the *route* is unreachable, the roadmap claim is false, `purchaseMode` does diverge |
| 5 | No multi-option concept | **CONFIRMED** |
| 6 | `buildCanonicalProposal` is one financial source of truth | **CONFIRMED** (call-site count understated) |

**Did not survive contact with the code:** the framing of claim 4 ("`renderProposalHTML.ts` has no UI caller"). It has a caller — `app/api/proposals/[id]/pdf/route.ts:231`. What has no caller is that *route*.

**Found during verification, not claimed by the research agent — and more severe than claim 1:** the live homeowner signing path has no idempotency guard, while a guarded one exists and is orphaned. See NEW-A below.

---

## NEW-A (highest severity) — the live signing path can overwrite a signature and re-date it

This was not in the claim list. It is the same defect class as claim 1, on the signature itself rather than the snapshot.

There are two signing implementations. The safe one is dead code.

**The guarded path (orphaned):**
- `components/proposals/SignatureBlock.tsx:210` → `POST /api/proposals/{id}/sign`
- `app/api/proposals/[id]/sign/route.ts:144-149` — explicit idempotency check:
  ```
  if (proposal.signed_at || proposal.status === 'accepted') {
    return NextResponse.json({ success: false, error: 'Proposal has already been signed.' }, { status: 409 });
  }
  ```
- `SignatureBlock` has **zero callers** outside its own test. Grep across `app/`, `components/`, `lib/` returns only `SignatureBlock.tsx` and `SignatureBlock.test.tsx`. The `/sign` route is therefore unreachable from the product UI.

**The live path (unguarded):**
- `app/proposals/view/[id]/page.tsx:14` imports `SignatureModal`; rendered at line 274. This is the only signing UI a homeowner reaches.
- `components/SignatureModal.tsx:159-167` → `PATCH /api/proposals/{id}?token=...` with `{ signature, signerName, signerEmail }`.
- `app/api/proposals/[id]/route.ts:208` routes that to `isSignatureSubmission`.
- `app/api/proposals/[id]/route.ts:224-284` — validates field lengths and the data-URL, verifies the share token with `timingSafeEqual`, then writes. **There is no `signed_at` check, no `status === 'accepted'` check, no 409.**
- Lines 251-260 rebuild `data_json` as `{...existingData, signature: {…}}` — the `signature` key is *replaced*, so a prior signer's name, email, IP and image are discarded.
- Lines 264-274 write `signed_at = NOW()`, re-dating an already-executed signature.

Consequence: anyone holding the share link can re-sign an executed proposal under a different name, and the record of who actually signed and when is destroyed. This is the recorded "a GET self-healed and re-dated issued packages" precedent, on the signature rather than the package.

Positive control that the codebase knows how to guard this: `app/api/cron/proposal-expiry/route.ts:90` and `:105` both filter `AND p.signed_at IS NULL`. The guard idiom exists and is used elsewhere — its absence on the write paths is an omission, not a project convention.

---

## Claim 1 — `refresh_snapshot` — CONFIRMED

**Where:** `app/api/proposals/[id]/route.ts:365-432` (PATCH, `body.action === 'refresh_snapshot'`).

**What it writes** (lines 416-429): `data_json` is replaced with
```
{ ...currentData2,
  project:             liveProject,             // re-queried live, lines 372-407
  snapshotAt:          new Date().toISOString(),
  snapshotRefreshedAt: new Date().toISOString(),
  dbUtilityRate:       freshDbRate }            // re-fetched, lines 410-414
```
via `UPDATE proposals SET data_json = …, updated_at = NOW() WHERE id = ${id}`.

`liveProject` is the full project row plus the joined `client`, `layout`, `production` and `costEstimate` (lines 372-407) — i.e. panel count, system size, production and cost estimate are all replaced with current values.

**Is there any status / `signed_at` / terminal-state check on that path?** No. The only gate reached before it is the ownership check at line 359 (`SELECT id FROM proposals WHERE id = ${id} AND user_id = ${user.id}`). Between line 359 and the write at line 424 there is no reference to `status`, `signed_at`, `accepted`, or any terminal state. An installer can press Refresh Snapshot (`app/proposals/page.tsx:164`, handler at `:374-382`) on a proposal the homeowner has already e-signed, and the figures behind that signature change.

**`pricingSnapshot` not re-frozen — CONFIRMED, and the direction matters.** `refreshedDataJson` spreads `...currentData2` and never sets `pricingSnapshot`, so the *old* pricing config survives while the project data becomes current. `app/proposals/view/[id]/page.tsx:141-143` and `app/api/proposals/[id]/pdf/route.ts:155` both read `pricingSnapshot` as the frozen authority. The result is a genuinely mixed-vintage document: today's system size and production priced against yesterday's `$/W`.

**Sibling with the same hole — `POST /api/proposals/[id]/share`.** `app/api/proposals/[id]/share/route.ts:55-94` re-queries the project and pricing and writes:
```
project:         freshProject,
pricingSnapshot: freshPricing ?? existingData.pricingSnapshot ?? null,   // line 66
snapshotAt:      new Date().toISOString(),
```
Ownership is checked (lines 34-43); status and `signed_at` are not. This is arguably worse than `refresh_snapshot`: it is the *Send / re-share* action, so it fires on an ordinary "send them the link again", and it rewrites `pricingSnapshot` too — mutating the frozen financials directly. Note the two paths refresh *complementary halves* of the snapshot, so calling both in either order still yields a mixed-vintage document.

**Other sibling writes on the same row:**

- **`status: 'viewed'` fires unconditionally on every page load.** `app/proposals/view/[id]/page.tsx:146-152` PATCHes `{status:'viewed'}` whenever a token is present, with no check of the current status. `app/api/proposals/[id]/route.ts:346-351` executes a bare `UPDATE proposals SET status = ${body.status}` — no terminal-state guard. A homeowner who signs and later revisits the link silently downgrades the proposal from `accepted` back to `viewed`.
- **Bulk status.** `app/api/proposals/bulk/route.ts:89-101` accepts any of `draft|sent|viewed|signed|accepted|rejected|archived` and writes it with no `signed_at` guard — an accepted proposal can be set back to `draft`.
- **`GET` mutates.** `app/api/proposals/[id]/route.ts:61-71` writes `data_json.viewCount` and `updated_at = NOW()` on a share-token read. Correctly scoped to `access.via === 'share-token'` (line 59), but it is still a write on a GET, including on signed proposals.

### NEW-B — `status` split-brain: signing is invisible to the installer

Two different fields are both called `status`, and the writers and readers disagree.

- The **column** `proposals.status` is what every signing path writes: `app/api/proposals/[id]/route.ts:266` and `:279`, `app/api/proposals/[id]/sign/route.ts:171` and `:185`. Also what the public status PATCH writes (`:348`).
- **`data_json.status`** is what the installer-facing list API reads: `app/api/proposals/route.ts:28` — `status: (dj.status as Proposal['status']) || 'draft'`.
- No write anywhere sets `data_json.status = 'accepted'`. It is set to `'draft'` at creation (`app/api/proposals/route.ts:164`) and thereafter only by an authenticated generic PATCH (`app/api/proposals/[id]/route.ts:436`) or the bulk route (`app/api/proposals/bulk/route.ts:79`, `:99`).

So a signed proposal continues to report `draft` to `app/proposals/page.tsx:886-897`, which renders the status pill and the `filterStatus` counts (`:533-534`, `:559`). The homeowner view is affected by the same precedence: `app/proposals/view/[id]/page.tsx:121` sets `status: raw.status` (the column) and line 125 then spreads `...dataJson`, so the stale `data_json.status` wins.

Compounding it, the view page's `accepted` flag is local React state initialised to `false` (`app/proposals/view/[id]/page.tsx:83`) and set only by `handleSignatureSuccess` in the same session (`:194-196`). A returning signer is shown the unsigned page with a live "Sign & Accept" button (`:2313-2333`) — and because the live PATCH path has no 409, pressing it succeeds and overwrites the signature (NEW-A).

---

## Claim 2 — zero drift detection — CONFIRMED

Case-insensitive grep for `stale|drift|outofdate|out_of_date|outOfSync` across `app/proposals`, `app/api/proposals`, `lib/proposal`, `lib/proposalPDF.ts`, `components/proposals` returns six hits, all comments or unrelated:

- `app/proposals/page.tsx:164`, `:374` — comments on the Refresh Snapshot button
- `app/api/proposals/route.ts:26` — comment "may have drifted"
- `app/api/proposals/[id]/route.ts:363` — comment on `refresh_snapshot`
- `lib/proposal/buildCanonicalProposal.ts:363` — a **dev-only** assertion, `process.env.NODE_ENV === 'development'` (line 364), and it checks internal arithmetic (`kW == count × W / 1000`), not snapshot-vs-live drift. Same gating in `assertTruth`, `:178`.
- `lib/proposal/buildCanonicalProposal.ts:528` — comment about a client-entered rate

`snapshotAt` and `snapshotRefreshedAt` are persisted but never compared against anything. Nothing computes, stores or displays a snapshot-vs-live delta, and nothing warns the installer or homeowner that a sent proposal no longer matches the design. Confirmed.

---

## Claim 3 — the homeowner never sees the array — CONFIRMED

**Exact construction**, `app/proposals/view/[id]/page.tsx:837-858`:

```
const hasCoords = clientLat && clientLng && !(clientLat === 33.4484 && clientLng === -112.074);
if (!hasCoords) return null;
const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${clientLat},${clientLng}&zoom=19&size=800x320&maptype=satellite&key=${GKEY}`;
```
Rendered as a plain `<img src={satUrl}>` (`:845-850`) with a gradient overlay (`:851`) and the caption at `:852-855`:
> "Your Property — system designed for this site"

**Does any panel geometry reach it?** No. The URL's only inputs are `clientLat` and `clientLng`. There is no `path=`, `markers=`, or polygon parameter; no `layout`, `panels`, `modules` or array geometry is referenced anywhere in the block; there is no canvas, SVG or overlay element drawn over the `<img>`. The gradient at `:851` is `pointer-events-none` decoration. The homeowner sees a bare satellite tile of their roof with nothing on it, captioned as though it depicted their design.

`app/proposals/page.tsx:1754` builds the identical URL for the installer-side preview, so neither audience sees the array.

Incidental: the Google Maps API key is hardcoded as a string literal in client-side source at `app/proposals/view/[id]/page.tsx:841` and `app/proposals/page.tsx:1753`, which ships it to every browser. Value not reproduced here; file:line only.

---

## Claim 4 — orphaned second renderer — PARTLY CONFIRMED

**Refuted as stated.** `lib/proposal/renderProposalHTML.ts` is *not* an orphaned module. It is imported and called at `app/api/proposals/[id]/pdf/route.ts:25` and invoked at `:231` (`renderProposalHTML(cp, proposal, finalBranding)`).

**Confirmed in substance.** The *route* has no caller. Grep across `app/`, `components/`, `lib/`, `e2e/`, `tests/` finds nothing that fetches `/api/proposals/{id}/pdf`. Both download buttons go elsewhere:

- `app/proposals/page.tsx:337-339` — `handleDownloadPDF` → `import('@/lib/proposalPDF')` → `generateProposalPDF`
- `app/proposals/view/[id]/page.tsx:200-208` — `handleDownloadPdf` → same, with the comment at `:205-206` explaining the choice: the html2canvas path "reads `#proposal-document` from the live DOM … better fidelity than a headless server render"

So `renderProposalHTML.ts` (1005 lines) plus the wkhtmltopdf/Puppeteer route are reachable only by typing the URL.

**The roadmap claim is false.** `lib/roadmapRE26.ts:931` (`notes` on the `proposal-pdf-export` entry, `status: 'done'`, `shippedIn: 'v62.0'`) states: "Download button wired in proposal viewer (handleDownloadPdf in ui-proposal-polish)". `handleDownloadPdf` exists at `app/proposals/view/[id]/page.tsx:200` but calls `lib/proposalPDF.ts`, not the route the entry describes. The entry's own `files` list (`:928-930`) names the route and `renderProposalHTML.ts`. Confirmed false.

**`purchaseMode` disagreement — CONFIRMED.**
- Web (both surfaces): React state defaulting to `'finance'`, toggled by the homeowner — `app/proposals/view/[id]/page.tsx:310` and `app/proposals/page.tsx:1312`, fed to `buildCanonicalProposal` at `:429` and `:1357`.
- PDF route: `app/api/proposals/[id]/pdf/route.ts:168` — `const purchaseMode: 'finance' | 'cash' = pricingCfg.purchaseMode === 'cash' ? 'cash' : 'finance';` — derived from the admin pricing config, passed to `buildCanonicalProposal` at `:215`. It never sees the homeowner's toggle.

If admin config says `cash`, that route's PDF prices the system differently from the page the homeowner read. Currently latent, because nothing in the UI calls the route — but it becomes live the moment anyone wires it up, which the roadmap already claims has happened.

---

## Claim 5 — no multi-option concept — CONFIRMED

Grep for `systemOption|proposalOption|variant|optionA|goodBetterBest|tierOption` across `app/proposals`, `app/api/proposals`, `lib/proposal`, `components/proposals` returns two hits, both prose in `components/proposals/SignatureBlock.tsx:26-27` describing the modal-vs-inline *component* variant. There is no option/variant/tier data model, no column, no `data_json` key, and no UI for presenting more than one system.

The only branch a homeowner can exercise is the binary Finance/Cash toggle (`app/proposals/view/[id]/page.tsx:310`, toggle UI `:1007-1015`), which re-prices one fixed system. Confirmed.

---

## Claim 6 — `buildCanonicalProposal` as single source of truth — CONFIRMED (strength)

`lib/proposal/buildCanonicalProposal.ts` (1005 lines), exported at `:301`, with the typed shape in `lib/proposal/canonicalProposal.ts` (574 lines).

Exactly three production call sites, one per surface:
- `app/proposals/page.tsx:1314` (installer list/preview)
- `app/proposals/view/[id]/page.tsx:382` (homeowner view)
- `app/api/proposals/[id]/pdf/route.ts:170` (server PDF)

Consumption is heavier than the ~89 reported. `cp.*` member accesses across the three renderers total **308**, over 9 top-level domains:

| domain | accesses |
|---|---|
| `cp.utility` | 91 |
| `cp.truth25yr` | 68 |
| `cp.financial` | 41 |
| `cp.panel` | 35 |
| `cp.policy` | 27 |
| `cp.production` | 21 |
| `cp._meta` | 15 |
| `cp.offset` | 9 |
| `cp.incentives` | 1 |

By file: `app/proposals/view/[id]/page.tsx` 100, `lib/proposal/renderProposalHTML.ts` 110, `app/proposals/page.tsx` 98.

`lib/proposalPDF.ts` shows 0 `cp.` accesses, which is correct rather than a gap — it rasterizes the already-rendered `#proposal-document` DOM (`:100`, `generateProposalPDF`), so it inherits canonical values rather than recomputing them. Both web surfaces and both PDF paths therefore trace back to one builder.

The module also defends itself: `assertTruth` (`:175-186`) and the system-size truth lock (`:363-375`) throw in development and log plus collect warnings in production.

**This holds, and it is the asset every repair below must preserve.** None of the defects found are miscalculations inside the canonical pipeline — they are all about *when* the pipeline's inputs are allowed to be rewritten, and *what* is drawn or displayed around its output.

---

## Ranked repair list, by real-world harm

1. **Guard the live signing path.** `components/SignatureModal.tsx:159` should call `POST /api/proposals/{id}/sign`, which already returns 409 on `signed_at || status === 'accepted'` (`app/api/proposals/[id]/sign/route.ts:144-149`); or replicate that check in the PATCH branch at `app/api/proposals/[id]/route.ts:224`. Today a share-link holder can overwrite an executed signature and re-date it. Either fix also makes `components/proposals/SignatureBlock.tsx` (currently dead) or the `/sign` route (currently unreachable) live again — pick one and delete the other rather than leaving two signing authorities.
2. **Freeze the snapshot on terminal status.** Add a `signed_at IS NULL AND status NOT IN ('accepted','signed')` gate to `refresh_snapshot` (`app/api/proposals/[id]/route.ts:365`) *and* to the share-route refresh (`app/api/proposals/[id]/share/route.ts:63-68`). The share route is the more frequently hit of the two and is the only one that rewrites `pricingSnapshot`. The existing `AND p.signed_at IS NULL` in `app/api/cron/proposal-expiry/route.ts:90` is the in-repo pattern to copy.
3. **Refresh the snapshot as one unit or not at all.** Whichever refresh paths survive #2 must rewrite `project` *and* `pricingSnapshot` together and stamp one vintage. `refresh_snapshot` currently updates only the project half; `share` updates both but on a different trigger.
4. **Resolve the `status` split-brain.** Pick the column or `data_json.status` as the authority and make every writer and reader agree. Until then the installer's list cannot show that a proposal was signed, and the view page shows a returning signer an unsigned document.
5. **Stop the unconditional `viewed` downgrade.** `app/proposals/view/[id]/page.tsx:146-152` should not PATCH `viewed` over a terminal status, and `app/api/proposals/[id]/route.ts:346-351` should refuse the transition server-side. Fixing only the client leaves the endpoint open.
6. **Guard bulk status.** `app/api/proposals/bulk/route.ts:89-101` needs the same terminal-state check.
7. **Add drift detection.** `snapshotAt` is already stored; comparing it (or a digest of the canonical inputs) against the live project would surface "this sent proposal no longer matches the design" — currently nothing does.
8. **Show the homeowner the array.** `app/proposals/view/[id]/page.tsx:837-858` — either overlay real panel geometry on the tile, or change the caption at `:854`, which currently asserts something the image does not show. Also move the API key at `:841` (and `app/proposals/page.tsx:1753`) out of client source.
9. **Resolve the two PDF renderers.** Either wire the route up — after fixing the `purchaseMode` divergence at `app/api/proposals/[id]/pdf/route.ts:168`, which would otherwise ship a differently-priced PDF — or delete the route and `renderProposalHTML.ts` and correct `lib/roadmapRE26.ts:931`, which currently asserts a wiring that does not exist.
10. **Multi-option proposals.** A genuine feature gap, not an integrity defect. Lowest harm of the list; it costs deals rather than corrupting records.
