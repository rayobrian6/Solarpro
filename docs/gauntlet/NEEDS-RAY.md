# NEEDS RAY — decisions and actions only Ray can take

**A check-in is not a stop.** Everything here is recorded so the gauntlet can
keep moving. Each entry states what is blocked and — more importantly — what is
**not**, so no item here is ever a reason to pause an unrelated lane.

Last updated: 2026-09-25.

---

## R1 — Committed Google API key needs rotation

| | |
|---|---|
| **Severity** | HIGH — credential exposure |
| **Where** | `components/3d/Google3DViewer.tsx:19` — a literal key as the fallback for `NEXT_PUBLIC_GOOGLE_MAPS_KEY` |
| **Decision required** | Rotate the key in Google Cloud. Only Ray has the account. |
| **Why code cannot fix it** | Deleting the literal does **not** un-leak it — it remains in git history. Rotation is the only remedy. |
| **Mitigation already true** | The file has **no importers**, so it is not in any client bundle. Exposure is repo/history-scoped, not public-web-scoped. |
| **Blocked** | Nothing in code. |
| **NOT blocked** | Everything. Provider-protection work, 3D, permit, research all continue. |
| **Safe default taken** | None applied — removing the literal without rotating would create a false sense of closure. Left visible on purpose. |

Secondary, same file: it reads `NEXT_PUBLIC_GOOGLE_MAPS_KEY` while the engine
reads `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — two names for one credential, so
setting one does not configure the other. That half **is** safe to fix in code
and is queued separately.

---

## R2 — Marketplace pre-claim coordinate precision

| | |
|---|---|
| **Severity** | HIGH — homeowner privacy |
| **Where** | `app/api/network/opportunities/route.ts` selects `no.lat, no.lng` in the **pre-claim** discovery feed |
| **Evidence** | The sibling detail route deletes `address`/`lat`/`lng` for non-entitled callers; migration 047 comments "Full address only accessible to assigned contractor post-claim"; the column is `NUMERIC(10,7)` ≈ 1 cm |
| **Decision required** | How approximate should an **unclaimed** lead's pin be? County centroid, ZIP centroid, ~1 km jitter, or no pin at all. |
| **Why it is Ray's** | It trades homeowner privacy against marketplace utility — a contractor judges drive distance from that pin. Not a technical call. |
| **Blocked** | The marketplace map/pin UX only. |
| **NOT blocked** | CRM, proposal, engineering, delete/lifecycle, permit, survey, research — all continue. |
| **Safe default available** | Round to 2 dp (~1.1 km) server-side for non-entitled rows, keeping the map usable while removing house-level precision. **Not applied** pending Ray, because it changes a live marketplace behaviour. |

---

## R3 — Digest rulings for two engineering repairs

| | |
|---|---|
| **Severity** | MEDIUM — process, not defect |
| **Context** | Changing permit-snapshot-visible content moves the snapshot digest and **retires live PE approvals**. |
| **Decision required** | Whether to proceed on two candidates that would move it: one resistance basis for the permit path, and org-level electrical standards. |
| **Blocked** | Those two candidates only. |
| **NOT blocked** | The thermal-design-basis unification — verification found it has **zero** digest impact, so it proceeds without a ruling. |
| **Safe default** | Neither digest-moving candidate is being implemented. |

---

## Resolved — no longer blocking

| Item | Outcome |
|---|---|
| **Tree drag-to-size** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Regression coverage preserved: `e2e/drag-to-size-tree.spec.ts` (12 cases incl. the camera control), `tests/pointerGestureAuthority.test.ts`. |
| **Tree visible shadow** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Coverage preserved: `e2e/tree-casts-shadow.spec.ts`, `tests/treeCastsShadow.test.ts`. |
