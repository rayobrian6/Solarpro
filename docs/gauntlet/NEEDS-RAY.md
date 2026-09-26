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

## R4 — Milestone checkboxes that record nothing

| | |
|---|---|
| **Severity** | MEDIUM — the product tells an operator it recorded something it did not |
| **Where** | `components/deals/DealDecisionModal.tsx` — four toggles (`proposal_accepted`, `contract_signed_confirmed`, `engineering_approved`, `install_scheduled_confirmed`) are POSTed to `/api/projects/update-status`, which never reads them. The code comment says so out loud: *"non-breaking — update-status ignores unknown fields"*. |
| **The harm** | An operator ticks "Engineering drawings approved" and believes it is on the record. It is not, anywhere. |
| **Decision required** | Do these four milestones mean the same as existing micro-stages, or are they distinct facts? None of the four ids exists in the 34-value vocabulary. The nearest matches are `proposal_approved`, `contract_signed`, `engineering_completed`, `install_scheduled` — but whether "accepted" is "approved", and whether "confirmed" adds anything over the base stage, is a semantic question about your process. |
| **Why not just map them** | Guessing would create a **fifth** status vocabulary on a row that already carries four, which a research pass explicitly rejected for that reason. |
| **Blocked** | Persisting these four milestones. |
| **NOT blocked** | Everything else — the stage machine, micro-stages, the portal, permits, design. |
| **Safe default NOT applied, deliberately** | Removing the toggles would delete a feature you may want; silently mapping them would invent meaning. The interim state is a known lie and is recorded here rather than quietly changed. Say which way and it is a small change. |

---

## R5 — Two new things to try in Dev (live acceptance, not a decision)

Not a blocker and nothing waits on it — but **live acceptance overrides tests**,
so neither of these is finished until you have used it.

**1. Move a roof corner.** Press `V`, or pick Move Corner in the tool palette,
then drag one corner of a traced roof face. One vertex, one *standalone* face,
in-plane only; a face owned by a building section refuses with a reason on
screen, which is deliberate.

What to watch for, because these are the parts no harness can reach — handles
cannot be picked under software WebGL, so first real use is the first
end-to-end exercise:

- does the handle land under the cursor, or beside it;
- does the corner follow the pointer smoothly, or jump on the first move;
- press Undo afterwards. **Do the modules come back where you put them?** A
  culled panel returning even 30 cm off is the failure mode being investigated
  right now — `applyRestoredGeometry` uses a rigid-centroid map on undo that the
  forward path deliberately refuses;
- check the plan set afterwards: the three corners you did *not* drag must be
  byte-identical in the permit record. That is guarded, but the guard is a unit
  test and you are the roof.

**2. Design history.** There is now a **History** button beside Save. A snapshot
has been written on every save for a long time and nothing in the product could
reach one — so a bad save had no way back. The list shows each version's module
count and system size, not just a date, and restoring asks first.

Worth trying specifically: open the design in **two tabs**, save in one, then
save in the other. The second should now refuse with a message saying nothing was
written and to reload — rather than silently overwriting the first, which is what
it used to do. Then use History to get the earlier state back.

| | |
|---|---|
| **Blocked** | Nothing. |
| **NOT blocked** | Everything continues. |

---

## Resolved — no longer blocking

| Item | Outcome |
|---|---|
| **Tree drag-to-size** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Regression coverage preserved: `e2e/drag-to-size-tree.spec.ts` (12 cases incl. the camera control), `tests/pointerGestureAuthority.test.ts`. |
| **Tree visible shadow** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Coverage preserved: `e2e/tree-casts-shadow.spec.ts`, `tests/treeCastsShadow.test.ts`. |
