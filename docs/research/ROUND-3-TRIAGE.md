# Round 3 triage — what to build, in what order

Every candidate carries **user value**, **RE+ demo impact** and **implementation
risk**, per Ray's filter: until RE+, prioritise HIGH value + HIGH demo impact +
LOW/MED risk, and do not destabilise the platform to win a competitor checkbox.

Status vocabulary: **SHIPPED** (in `dev`, proven), **VERIFIED** (claim confirmed
against code by a second pass), **REPORTED** (one source, not yet verified —
do not act on these without checking).

---

## SHIPPED this round

| # | What | Value | Demo | Risk | Evidence |
|---|---|---|---|---|---|
| S1 | Tree drag no longer fights the camera; commits where the press landed | HIGH | HIGH | — | 12/12 browser acceptance incl. a live control; 6 mutations caught |
| S2 | Placed objects cast real shadows; shade re-runs when they change | HIGH | HIGH | — | 5/5 browser acceptance reading ShadowMode out of live Cesium |
| S3 | The size promise is visible during the drag (readout no longer clobbered) | MED | MED | — | covered by S1's acceptance |
| S4 | Chimney keep-out uses the clearance-aware authority on all three paths | HIGH | MED | — | 4 modules removed vs 0–1; zero survivors inside clearance; 5 mutations caught |

**S2 is not accepted.** Software WebGL cannot rasterise the scene, so no test
here has SEEN a shadow. That is Ray's gate.

---

## P0 / P1 — correctness and integrity, ranked by real-world harm

| # | What | Value | Demo | Risk | Status |
|---|---|---|---|---|---|
| 1 | **A deleted roof can come back.** The tombstone ledger rides inside `layouts.site_archives`, written by a separate statement in a `try` whose `catch` is a `console.warn`. The pre-check built to stop it being lost never reads `deletions`. Ledger write fails → 200 OK "Saved" → next load returns `untouched` instead of `cleared`, which is the one state that permits automatic re-acquisition, and Lane A re-injects the roof the installer threw away. | HIGH | HIGH | MED | VERIFIED |
| 2 | **Hand-placed obstructions never reach the permit.** `grep -i obstruct app/engineering/page.tsx` → 0 hits. The permit's `roofObstructions` come only from Nearmap AI + aerial vision. So the installer marks a chimney, panels are correctly kept clear of it, and the plan set does not show it. The design and the stamped drawing disagree about what is on the roof. | HIGH | HIGH | MED | VERIFIED |
| 3 | **Anonymous proposal read chains into signature forgery.** GET had no auth and no share-token check (the token check lived only in client code); `SELECT *` also returned `share_token`; the same file's PATCH lets an unauthenticated token-bearer set `status='accepted'` and write a signature. A repair is **parked in a git stash**, reviewed and called sound, needing a type fix and tests. | HIGH | LOW | MED | VERIFIED |
| 4 | **Exact homeowner coordinates leak pre-claim.** `app/api/network/opportunities/route.ts` selects `no.lat, no.lng` in the discovery feed. The sibling detail route deletes exactly those fields for non-entitled callers, the schema comments say "full address only accessible to assigned contractor post-claim", and `NUMERIC(10,7)` is ~1 cm. **Needs a product decision: how approximate should an unclaimed pin be?** | HIGH | LOW | LOW | VERIFIED |
| 5 | **A committed Google API key** sits as a literal fallback in `components/3d/Google3DViewer.tsx:19`. The file has no importers so it is not in a client bundle, but it is in the repo and its history. **Removing it does not un-leak it — the key must be rotated, which is Ray's to do.** | HIGH | LOW | LOW | VERIFIED |
| 6 | **Block height drag writes no canonical geometry.** It writes `polygon.extrudedHeight` and a local override ref only — no `recordGeometry`, no write-back to the face. So it is not undoable, not persisted, and the drawn prism disagrees with what the planset, BOM and pvwatts read. This is renderer-only geometry, which the architecture forbids outright. | HIGH | MED | MED | VERIFIED |
| 7 | **`refresh_snapshot` has no terminal-state guard** — it will rewrite the frozen snapshot of a signed proposal. Same class as the issued-package re-dating incident. | HIGH | LOW | LOW | REPORTED |
| 8 | **Placing a tree is never undoable.** The undo snapshot is taken only inside `if (removed > 0)`, and a tree correctly culls nothing. Undo then consumes an earlier step and silently reverts a roof edit — worse than doing nothing. | MED | MED | LOW | VERIFIED |
| 9 | **`middleware.ts` auth branch is dead** — `'/'` first in `PUBLIC_PATHS` matched with `startsWith`. Severe on its face but backstopped by data-layer tenant scoping and `SameSite=Lax`. **Do not let anyone one-line this** — it breaks the portal and every share link. | HIGH | LOW | HIGH | VERIFIED |
| 10 | Six voltage-drop implementations, two physical constants, three disagreeing resistance tables; `conductorAuthority` allegedly not read by the engineering page, so app and planset could print different numbers. | HIGH | MED | HIGH | REPORTED — verification in flight |

---

## P2 — materially better workflow (the main class)

| # | What | Value | Demo | Risk | Source |
|---|---|---|---|---|---|
| 11 | **The homeowner never sees the array.** The proposal's only imagery is a Google Static Maps tile with no panels drawn, captioned "system designed for this site". Every competitor leads with the design. | HIGH | HIGH | MED | Lane C |
| 12 | **Drift: nothing says a sent proposal no longer matches the design.** OpenSolar's guard is the cheapest thing in the whole ledger — Send disabled, labelled "Save changes to enable send to customer". Aurora/Enerflo use one-click refresh on a stable link; SolarPro already has the mechanism (`refresh_snapshot`) buried in a kebab menu on a list page. | HIGH | HIGH | LOW | Lane C |
| 13 | **Survey readiness is computed and delivered too late.** A 9-zone, movement-ordered capture plan with per-item engineering justification exists in `lib/survey/evidence/` and is imported only by an admin page. The verdict lives on a 3,829-line office page — after the truck has left. Expose it at step 6. | HIGH | MED | LOW | Lane F |
| 14 | **Conductor choice as a decision, not data entry.** HelioScope annotates every option in the dropdown with the voltage drop it would cause (`10 AWG (Copper), 0.2%`). Best single interaction in the engineering lane. | HIGH | MED | MED | Lane B |
| 15 | **Violations as navigable objects.** Aurora's electrical tree gives every violation a return arrow to the exact object in the layout, and states quantity, value, comparison, device and limit. SolarPro's are a list. | HIGH | MED | MED | Lane B |
| 16 | **Handoff gates.** Enerflo lets the installer declare what must exist before a rep may hand a job over; unmet requirements are red cards in plain English with deep links. SolarPro has a governed state machine documented as "the ONLY authorised path" with **zero callers**, while the route that runs accepts any stage → any stage with no audit. | HIGH | LOW | MED | Lane D |
| 17 | **Answer the three questions that are 41% of support contacts** — when is install, how do I use monitoring, any update. Plus a permit card naming the authority, the number and an elapsed clock: no competitor shows a homeowner a permit number, and it is SolarPro's structural wedge. | HIGH | MED | MED | Lane G |
| 18 | **Multi-option on one link.** An independent operator named it his #1 feature; Solargraf's compare is a design × finance matrix. SolarPro has no multi-option concept at all. | HIGH | HIGH | HIGH | Lane C |
| 19 | **Revert-to-inherited exists nowhere.** Google makes inheritance a column (`Inherited`/`Overridden`) with a named Inherit button. SolarPro's feature-flag route has GET and PUT and no clear, so an override is permanent — and the panel lists only overridden flags, hiding the inheritable surface. Cheapest thing to fix before multi-tenancy freezes it. | MED | LOW | MED | Lane J |

---

## REJECTED / BACKLOG with reasons

- **Mount `VertexHandles` to get vertex editing.** REJECTED as specified. The
  component renders nothing, delegates mutation to a prop nobody ever wrote,
  installs its own event handler, takes no pointer ownership, and its pick maths
  intersects a sphere of the equatorial radius rather than the ellipsoid —
  ~146 m of horizontal error at 1° off nadir at this latitude. Its tests assert
  that arithmetic against a mock of the same sphere at lat 0, where the two
  coincide. A commit claimed the integration existed; it never did in any commit.
  **The real gap is genuine** — SolarPro cannot move a vertex, drag an edge,
  split or merge, while Aurora and Solargraf do all four — but the smallest
  honest version is a week: move one vertex of one selected plane, specs from
  `roofPlanes`, gesture inside the engine's handlers, `claimPointer('vertex-move')`,
  one `RoofPlaneReshapeUpdate` on release, explicit panel policy.
- **Chat/inbox in the homeowner portal.** REJECTED — support-desk product, does
  not serve the permit wedge.
- **Distributor integrations.** BACKLOG — no API, no partner. UX mined only.
- **Imagery-provider substitution guard.** BACKLOG but named: Esri is added
  unconditionally at boot with no env gate, `mapPickerState.source` has zero
  consumers, and Google's on-screen credit is suppressed — so when Google tiles
  fail the user sees Esri under a control reading "Google". The valuable guard
  is to derive one `activeImagerySource` from `tileStatus`/`renderMode` and
  render that. Geometry provenance is already honest; only viewer imagery is not.

---

## The thing worth protecting

Two lanes independently arrived at the same rule, and it is already SolarPro's
architecture:

> A finance product must not select the price. A supplier must not select the
> parts. **One authority, two derived presentations.**

Concretely: SolarPro's BOM sits inside the permit snapshot, so a part swap moves
the digest and retires the PE approval. OpenSolar states in its own docs that
Hardware-tab changes "do not impact your Design page or the proposal". SolarPro
is the only product in this research where a substitution **cannot** quietly
invalidate a stamped design. That is a moat. The gap is a screen, not a
mechanism.
