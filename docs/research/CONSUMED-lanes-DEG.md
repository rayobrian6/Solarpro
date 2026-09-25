# CONSUMED — lanes D (CRM/ops), E (marketplace/leads), G (homeowner portal)

Research consumption pass, 2026-09-25. Input: `docs/research/lanes/lane-D-crm-operations.md`,
`lane-E-marketplace-leads.md`, `lane-G-homeowner-portal.md`, read in full. Format follows
`ROUND-3-TRIAGE.md`.

**This is not a summary of the lanes.** Every load-bearing claim below was re-checked against the
code at HEAD `8ae1195e`, with file:line. Where a lane was wrong, the refutation is recorded and the
candidate that rested on it is re-scoped. Three lane claims did not survive contact with the code.

---

## 0. VERIFICATION LOG — what survived, what did not

### Lane D — all three load-bearing claims CONFIRMED

| Claim | Verdict | Evidence |
|---|---|---|
| `lib/deals/transitions.ts` + `app/api/projects/transition/route.ts` are a governed state machine with ZERO callers | **CONFIRMED** | `grep -rn "projects/transition" app components lib tests hooks store types` returns exactly 3 hits: the route's own docstring (`app/api/projects/transition/route.ts:2`), its own error handler (`:284`), and one comment in `lib/homeownerStageSync.ts:14`. No fetch, no import, no test. 27 transitions (`grep -c "newStage:" lib/deals/transitions.ts` → 27). |
| `update-status` accepts any stage → any stage | **CONFIRMED** | `app/api/projects/update-status/route.ts` read in full. Its only legality check is `isValidStage(status)` = `PROJECT_PIPELINE.includes(...)` (`lib/operations/pipeline.ts:203-205`). Pure set membership. No `from`-stage is ever read. It writes **no** `project_activity`, **no** `project_micro_stages`, and never calls `syncHomeownerStage`. Five callers: `app/dashboard/page.tsx:940`, `components/project/OperationsTab.tsx:121`, `components/commands/EngineeringReviewModal.tsx:29`, `components/commands/ScheduleInstallModal.tsx:75`, `components/deals/DealDecisionModal.tsx:160`. |
| `generateTasksForStage` DELETEs then re-inserts, wiping a checklist on a bounce-back | **CONFIRMED** | `lib/operations/generateTasksForStage.ts:30-45` — `DELETE FROM project_tasks WHERE project_id = … AND stage = …` then `INSERT … 'pending'` per title. A project driven back to `installation` after a failed inspection loses every completed installation task. `checkStageCompletion()` (`:54`) has **zero callers** — task completion gates nothing. `project_tasks` DDL (`app/api/migrate/route.ts:852-861`) has **no assignee and no due_date column**, as the lane stated. |

**Sharper than the lane reported —** `components/deals/DealDecisionModal.tsx:160-170` posts a
`milestones` array alongside the stage. `update-status` never reads `milestones`. The Deal Decision
Engine's milestone toggles are **silently discarded on every use**. The comment in the modal
("update-status ignores unknown fields") records the drop as if it were a design choice.

**Also confirmed:** `grep -rniE "change[_ -]?order|changeOrder"` across `app lib components types
store hooks migrations db` → **zero matches**. `INSERT INTO project_activity` exists in exactly two
places: `app/api/activity/route.ts:86` and the dead `app/api/projects/transition/route.ts:205`.

### Lane E — the metric claim was fixed and shipped; record what remains

The lane's `contractor_performance` finding was largely acted on in HEAD `8ae1195e`
("network: stop scoring contractors on data that does not exist"). Current state, verified:

| Column | Lane said | Now |
|---|---|---|
| `first_contact_at` | zero writers | **FIXED.** Written by `app/api/network/opportunities/[id]/contact/route.ts:81` (`COALESCE(first_contact_at, NOW())`, scoped to the caller's own claim), fired from `app/network/page.tsx:908` on the tel:/mailto: click with `keepalive`. |
| `dispute_filed_at` | zero writers | **STILL zero writers.** Only SELECTed (`app/api/admin/network/intelligence/runner/route.ts:92,104`) and read by `lib/intelligence/producers.ts:230`. The fix made it *honest* — `disputeRateSupported` (`producers.ts:261`) now serialises null instead of a defamatory 0% — but nothing can file a dispute. |
| `close_status` / `lost_reason` | zero writers | **STILL zero writers.** Read at `producers.ts:227-228,350-351` and `app/api/network/my-claims/route.ts:96-97`. The outcome endpoint was deliberately not built. |
| `avg_rating` | hardcoded `NULL::numeric` | **REMOVED**, with its scoring branch and the unreachable `highly_rated` reason. |
| `avg_response_hours` / `avg_close_rate_pct` | never written | **STILL never written.** The rollup from `opportunity_assignments` into `contractor_profiles` was deliberately deferred, because running it moves every match score and flips both `minScore` and the `recommended >= 75` cut. So `first_contact_at` is now *captured* but not yet *consumed*: `lib/network/contractorMatcher.ts:228` still sees null. |

**Stale comment introduced by the fix:** `lib/intelligence/producers.ts:243-246` still asserts that
`first_contact_at` "has ZERO writers anywhere in app/ or lib/". That is now false. A future auditor
reading that block will re-derive a refuted conclusion.

**Other lane-E claims re-verified:** `claim_mode TEXT NOT NULL DEFAULT 'exclusive'` at
`lib/migrations/072_marketplace_inventory_claim_v1.sql:25` — **CONFIRMED**, and it is a genuine
structural advantage over every comparator. `offer_expires_at` / `claim_expires_at` appear **zero
times** in `app/network` or `components` — no countdown anywhere a contractor is deciding.
No dispute route exists (the entire network API is 10 route files; none is a dispute or outcome
endpoint). The `location_city` pre-payment leak is **CONFIRMED and wider than the lane found**:
`territory/[state]/route.ts:213` *and* `:303`, `opportunities/[id]/preview/route.ts:47`, and
`opportunities/route.ts:99` all return `no.location_city AS city` on gated, pre-payment JSON.

### Lane G — one claim CONFIRMED, one CONFIRMED-and-worse, one REFUTED

| Claim | Verdict | Evidence |
|---|---|---|
| `lib/microStage.ts` defines 34 micro-stages; the permit/PTO ones are never written | **CONFIRMED for the six named stages, but the lane undercounted the writers.** | `MICRO_STAGES` is 34 values (`lib/microStage.ts:27-71`). The lane said "only two writers exist". There are **seven**: `portal/bill-upload/route.ts:175,179`; `admin/projects/[id]/route.ts:227`; the dead `projects/transition/route.ts:255`; and — bypassing `writeMicroStage` entirely with raw SQL — `projects/[id]/homeowner-stage/route.ts:166`, `proposals/[id]/route.ts:330`, `proposals/[id]/share/route.ts:128`. Even so, **no live path writes `permit_submitted`, `permit_approved`, `install_scheduled`, `inspection_passed`, `pto_submitted` or `pto_approved`** — the only code that maps to them is in the route with zero callers. |
| There is no `permits` table | **CONFIRMED.** | `grep -rniE "CREATE TABLE (IF NOT EXISTS )?permits\b\|permit_status\|permit_number\|permit_application"` across `migrations lib/migrations app/api/migrate/route.ts lib app components` → **zero matches**. |
| `lib/utilityInterconnection.ts` is deliberately dead at a named line | **CONFIRMED exactly.** | `app/portal/dashboard/page.tsx:1004-1005`: `const icaTier1 = null as ReturnType<typeof getInterconnectionProfile>; void getInterconnectionProfile;` — the `void` keeps the import alive so lint passes. Only `getStateIcaFallback` renders, and only when `stage === 'installation'` (`:1007`). The file is 4,485 lines of real per-utility ICA/PTO data. |

**REFUTED — Lane G's highest-value candidate is not blocked the way it says.** The lane states
"SolarPro has no scheduler, no cron, and no time-based trigger" and that candidate 3 "is blocked on
there being no scheduler at all." **False.** `vercel.json:7-16` declares two production Vercel cron
jobs — `/api/cron/proposal-expiry` (daily 08:00) and `/api/cron/stale-job-cleanup` (daily 03:00) —
and both routes exist. `app/api/cron/proposal-expiry/route.ts` is a mature, directly reusable
template: `CRON_SECRET` bearer auth with `timingSafeEqual` (`:29-34,41-55`), a ±12h window, and an
idempotency column (`proposals.reminder_sent_at`, migration 090) with graceful degradation if the
migration has not run. A third cron is a copy of this file. It is *true* that there is no
`notifications` table — but the expiry cron proves one is not required for a time-based nudge.

**REFUTED in part — "re-enable what is already built" is optimistic.** `getInterconnectionProfile`
takes a `utilityId` (`lib/utilityInterconnection.ts:4424`) keyed `pge_ca`, `ameren_il`, etc.
`app/api/portal/dashboard/route.ts` selects **no utility field at all** (its projects SELECT is
`id, name, address, system_size_kw, homeowner_stage, monitoring_platform, monitoring_url, updated_at,
created_at` + owner fields). So it is not a one-line un-null. **But the correct fix exists and uses
the canonical authority:** `app/proposals/view/[id]/page.tsx:452-468` already derives the real
`utility_id` from `buildUtilityProfile` (`lib/proposalTruthEngine.ts:29902`) and does Tier1 → Tier2 →
null. `buildUtilityProfile` resolves from ZIP when no utility name is given, and the portal route
already has `clients.zip`, `clients.state` and `projects.address`. So the portal can call the *same*
function rather than inventing a second one.

**Confirmed verbatim:** the `installation` blob copy at `app/portal/dashboard/page.tsx:246-253`; the
"You're all set" completion copy at `:254-261`; the hardcoded `'— kW' / '—%' / '$—'` monitoring tiles
at `:797-801` and `:820-824`; the decorative `<Download size={13} />` at `:667` with no `href` and no
handler; the document filter `file_type IN ('utility_bill','portal_upload')` at
`app/api/portal/dashboard/route.ts:116`.

**Sharper than the lane reported —** the lane says SolarPro "sends `sendStageAdvanceEmail` only on
stage change". It is narrower than that: `grep -rn "sendStageAdvanceEmail"` finds exactly one caller,
`app/api/admin/projects/[id]/route.ts:269` — the **admin manual-override route**. Signing a proposal
does not email the homeowner; `syncHomeownerStage` does not email; the pipeline does not email.
**A homeowner receives zero automated lifecycle email unless an admin hand-overrides their stage.**

### NEW DEFECT found during verification — a second micro-stage authority writing an invalid value

`app/api/projects/[id]/homeowner-stage/route.ts:157-172` maps `completed → 'installation_complete'`
and raw-`INSERT`s it into `project_micro_stages`. **`installation_complete` is not a micro-stage.**
It is a `DealDecisionAction` from a different vocabulary (`lib/deals/transitions.ts:48,350,545`).
The valid micro-stage is `install_completed` (`lib/microStage.ts:60`). Three things let this ship:

1. the route bypasses `writeMicroStage(projectId, stage: MicroStage, …)` and its type signature;
2. its own map is typed `Partial<Record<HomeownerStage, string>>` — `string`, not `MicroStage`, so
   `tsc` cannot catch it;
3. `project_micro_stages.micro_stage` is plain `TEXT` with **no CHECK constraint**
   (`app/api/migrate/route.ts:1773-1780`) — migration 028 adds only `UNIQUE(project_id, micro_stage)`.

Result: every project that reaches `completed` through that route writes a junk row into the
append-only ledger the homeowner portal reads, and the `UNIQUE` constraint makes it permanent.
Same class as `regex-backslash-b-becomes-backspace`: a typed guard that cannot fire.

---

## 1. THE MATRIX

Ranked. Rows 1-2 are prerequisites for much of the rest.

| # | lane | best competitor behavior | worst competitor behavior | SolarPro current behavior | verified gap | SolarPro advantage | recommended action | verdict | user value | RE+ impact | implementation risk | estimated scope | canonical authority affected | implementation status | live acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | D+G (collapsed) | Enerflo `1FZra98qfPg` 30:05: every stage change is governed, audited and gated; JobNimbus `qsJR_uz-ju8` 22:54: status changes because an artifact exists | OpenSolar: 5 fixed stages, no permit stage, permitting leaves the platform entirely | Every real stage write goes to `update-status`, which validates set membership only and writes no activity, no micro-stage, no homeowner sync. The governed machine exists, is correct, and has zero callers | **CONFIRMED.** `transition/route.ts` writes `project_activity` (`:205`), `generateTasksForStage` (`:223`), `syncHomeownerStage` (`:231`) and `writeMicroStage` (`:255`) via a `PIPELINE_STAGE_TO_MICRO` map (`:239-251`) that **already covers `permit_submitted`, `permit_approved`, `install_scheduled`, `pto_submitted`** — the exact six stages lane G needs. Nothing calls it | The machine, the map, the audit table, the homeowner sync and the append-only ledger are all already written and reviewed. No competitor has a 27-action typed transition map | Repoint the 5 `update-status` callers at `/api/projects/transition`; 410 `update-status` as `survey-handoff` already is. **Fix the map's `inspection → 'inspection_passed'` first** — entering the inspection stage must not assert a pass | **STEAL** (wiring, not invention) | HIGH | HIGH | MED | 1 sitting for the repoint + 1 for the DealDecisionModal action mapping | `lib/deals/transitions.ts` is reinstated as the single stage authority; `update-status` is retired, not duplicated | PROPOSED | NOT STARTED |
| 2 | D | JobNimbus: a status change fires a task; the checklist is the record of work | Solargraf: steps are free text with no semantics and no failed-inspection concept | `generateTasksForStage` DELETEs the stage's tasks and re-inserts them all as `'pending'` | **CONFIRMED** `lib/operations/generateTasksForStage.ts:30-45`. A failed inspection today is a user picking "Installation" from a free dropdown, which **erases the completed installation checklist**. Silent, unlogged data loss | — (this is pure defect) | Change the DELETE+INSERT to an `INSERT … ON CONFLICT DO NOTHING` upsert keyed `(project_id, stage, title)`, so re-entering a stage preserves completion | **STEAL** | HIGH | MED | LOW | ~15 lines + one unique index | none — `TASK_MAP` stays the only task authority | PROPOSED | NOT STARTED |
| 3 | G | Buell (HBS 2019-03): customers preferred seeing the *actual airlines being searched* over a progress bar. Continuum `iag2ZE8915E` 1:45 shows the real Placer County permit `BLD24-00483` | Tesla: `Permit-Submitted` for five months with no date, no authority, no next action — a status label that looks like an answer | One static sentence — *"We're handling permits and lining up your installation crew"* (`portal/dashboard/page.tsx:246-253`) — for the entire permit→inspection→PTO window | **CONFIRMED.** No `permits` table, no `permit_status`, no application number, no submission date anywhere in the repo. `permit_rejected` exists as a deal action (`transitions.ts:45`) with **no** matching micro-stage, so a rejection can never reach the homeowner | SolarPro owns the AHJ registry **and** generates the permit package. No product in the whole corpus showed a homeowner a permit number. This is the wedge, rendered | Add a minimal `permits(project_id, authority_id, application_number, submitted_at, state, decision_at)` + a `permit_rejected` micro-stage. Render authority name, number and days elapsed. **Per `ahj-zero-governed-authorities`: show the authority and the number even when no timeline estimate exists; never fabricate a range** | **STEAL** | HIGH | HIGH | MED | 2 sittings (1 schema+writer, 1 card) — and it is worthless before row 1 | new table; must consume `ahj_registry` as-is and never become a second AHJ authority | PROPOSED | NOT STARTED |
| 4 | G | Bodhi's own ticket data: "when is my installation scheduled?" is **18.6%** of all customer contacts, the single most-asked question in solar | Tesla app does not exist for the homeowner until after commissioning — the whole signature→PTO window is off-app | The portal never renders an install date, crew or window | **CONFIRMED, and the data is real.** `projects.install_date` is written by `app/api/projects/[id]/operations/route.ts:145` and by `ScheduleInstallModal.tsx:62`; `project_schedule(date, crew_id, type)` is INSERTed by `app/api/schedule/route.ts:80`. `app/api/portal/dashboard/route.ts` selects **neither** | The date is already captured by a real, used installer path — this is surfacing, not inventing | Add `p.install_date` and the latest `project_schedule` row of `type='install'` to the portal dashboard SELECT and render them on the stage card. Render nothing when null — never a placeholder | **STEAL** | HIGH | MED | LOW | 1 sitting, read-only | none — `project_schedule` / `projects.install_date` stay the only schedule authority | PROPOSED | NOT STARTED |
| 5 | G | Continuum `iag2ZE8915E` 2:15-2:20: every step names *who holds it* — "30 to 60 days through your utility provider", "PG&E schedules and installs it themselves" | rationalgo's own note: homeowners blame the installer for the utility's queue when nobody says whose queue it is | `icaTier1` is hard-nulled at `portal/dashboard/page.tsx:1004-1005`; only the generic state fallback renders, and only during `installation` | **CONFIRMED, and partly REFUTED as "just re-enable".** The portal route selects no utility field, so the lookup has no input. **But** `proposals/view/[id]/page.tsx:452-468` already derives the real `utility_id` from the canonical `buildUtilityProfile` and does Tier1→Tier2→null; the portal has `clients.zip/state` + `projects.address`, which is what that function needs | 4,485 lines of per-utility ICA/PTO steps, timelines, portal URLs and homeowner checklists, already written and already trusted by the proposal | Call the **same** `buildUtilityProfile` the proposal calls, pass its `utility_id` to `getInterconnectionProfile`, delete the `null as …` and the `void`. Copy the Tier1→Tier2→null ladder verbatim | **STEAL** | HIGH | MED | LOW | 1 sitting | `buildUtilityProfile` (`lib/proposalTruthEngine.ts:29902`) — **reused, not forked.** A second utility-resolution path here would be a second authority and is the thing to avoid | PROPOSED | NOT STARTED |
| 6 | G | Bodhi 2.0: conditional **and** elapsed-time triggers — "after 7 days", "after 14 days" in an unchanged permit state prompt a customer notification automatically. Bodhi's checklist #4: have a "no update" update ready | Tesla: the homeowner's only contact over five months was "occasional apologies", and no answers to texts | `sendStageAdvanceEmail` has **exactly one caller** — the admin manual-override route | **CONFIRMED and worse than the lane stated.** `app/api/admin/projects/[id]/route.ts:269` is the sole caller. Signing does not email. `syncHomeownerStage` does not email. A homeowner can receive **zero** automated messages for the entire project. **Lane G's "no scheduler" blocker is REFUTED** — `vercel.json:7-16` runs two production crons today | `app/api/cron/proposal-expiry/route.ts` is a proven template: `CRON_SECRET` + `timingSafeEqual`, windowed query, `reminder_sent_at` idempotency column, graceful degradation | Third cron, same shape: projects unchanged in `homeowner_stage` for >7/14/21 days get one "still waiting, here is who holds it" message. Idempotency column, not a `notifications` table. **Do not build the trigger until row 1 lands** — before that, `homeowner_stage` barely moves, so elapsed time measures nothing real | **STEAL** | HIGH | MED | MED | 1 sitting for the cron, but sequenced after row 1 | reuses `lib/email.ts` templates; no new message authority | PROPOSED | NOT STARTED |
| 7 | D+G | Solargraf `vUsuJlQANyU` 5:31/16:42: one step list drives the internal to-do, the customer timeline **and** the notification, which names the completed step and the next one | Buildertrend's blob: a 49-day "DRYWALL & PAINT" bar "is going to set off alarms" because the slack inside is invisible | `installation` is one homeowner step covering eight micro-stages from `permit_submitted` to `pto_approved` | **CONFIRMED** — and it is the *same fix as row 1*, not a separate build. The `PIPELINE_STAGE_TO_MICRO` map already exists in the dead route. **Collapsed duplicate: lane D candidate 2 and lane G candidate 1 are one change.** Caveat: even wired, `pto_approved` and `monitoring_active` are written by nothing, so the PTO card has no trigger | `project_micro_stages` is already append-only with a DB `UNIQUE` — the correct shape for a timeline | Render the micro-stage rows the portal route *already fetches* (`app/api/portal/dashboard/route.ts:136-148`) as dated sub-rows inside the `installation` card. Zero new schema | **STEAL** | HIGH | HIGH | LOW | 1 sitting, **after** row 1 | none — reads the existing ledger | PROPOSED | NOT STARTED |
| 8 | G | — | — | `homeowner-stage` route raw-INSERTs `'installation_complete'`, which is not in the 34-value vocabulary | **NEW, verified this pass.** `app/api/projects/[id]/homeowner-stage/route.ts:160` writes a `DealDecisionAction` name into `project_micro_stages`. Bypasses `writeMicroStage`'s typed signature; its own map is typed `string`; the column is `TEXT` with no CHECK. The `UNIQUE` constraint makes the junk row permanent | — (pure defect) | Change `'installation_complete'` → `'install_completed'`; route all three raw INSERTs (`homeowner-stage:166`, `proposals/[id]/route.ts:330`, `proposals/share:128`) through `writeMicroStage` so the type is the guard; type the map `Partial<Record<HomeownerStage, MicroStage>>` | **STEAL** | MED | LOW | LOW | under 1 sitting | **removes a second micro-stage write authority** — directly serves the no-second-authority rule | PROPOSED | NOT STARTED |
| 9 | E | Networx publishes what does **not** qualify for credit; Thumbtack enumerates 7 qualifying cases, a 45-day window and a 4-state tracker; Bark auto-returns credits on a timer with no arbitration | Angi: 2,064 BBB complaints in 3 years, credits never cash, refunds denied for obvious fake numbers, no self-service cancel | No contractor-facing refund or dispute path exists at all. The network API is 10 routes; none is a dispute or outcome endpoint | **CONFIRMED.** `dispute_filed_at` (migrations 051:82, 067:85) still has zero writers after `8ae1195e`; it is only SELECTed and read at `producers.ts:230`. Dispute rate is now honestly `null` rather than falsely `0` — but it is still unknowable | The lost-race auto-refund (`lib/network/leadPurchase.ts`) already proves the platform can refund through Stripe with no human in the loop | `POST /api/network/opportunities/[id]/dispute` writing the existing columns, a 4-state tracker on the claimed-lead card, and a policy page with an explicit **negative** list. Bounded: 7 days, four qualifying cases, everything else denied by default | **STEAL** | HIGH | LOW | MED | 1 sitting for the route + tracker; the policy copy is separate | none — writes columns that already exist and were designed for this | PROPOSED | NOT STARTED |
| 10 | E | Thumbtack Quality Commitment states location and competition density facts *before* purchase | Modernize: homeowners report their information sold to contractors they must each opt out of individually | Gated, pre-payment JSON returns `location_city` | **CONFIRMED and wider than the lane found:** `territory/[state]/route.ts:213` **and** `:303`, `opportunities/[id]/preview/route.ts:47`, `opportunities/route.ts:99`. The UI drops it; the wire does not. **Collapses with ROUND-3 P0 #4** (`opportunities/route.ts` selecting `no.lat, no.lng`) — same route family, same fix window, and #4 is the more severe half | Pre-purchase privacy is otherwise genuinely real and commented as such in the feed | Drop `location_city` from all four gated selects in the same change as ROUND-3 #4. **This is a hard prerequisite** for the "what we will never do" panel, whose "county-level location before payment" bullet is currently false on the wire | **STEAL** | MED | LOW | LOW | under 1 sitting, folded into ROUND-3 #4 | none | PROPOSED | NOT STARTED |
| 11 | E | Angi's failures are structural: membership fee, contract, 35% early-termination fee, leads resold 3-6 ways | — | Every one of those is structurally absent in SolarPro, and none of it is stated anywhere in the UI | `claim_mode` **defaults to `'exclusive'`** — verified at `lib/migrations/072_marketplace_inventory_claim_v1.sql:25` — and is enforced atomically with an auto-refund on a lost race. One-time Stripe charge, no membership, no contract | The strongest genuine differentiator in lane E, and it is mentioned in one sentence | A short factual panel on `/network`, **with a test asserting each bullet against the code path it describes**, so it can never drift into an FTC-style unsubstantiated claim. Ship only after row 10 | **STEAL** | MED | LOW | LOW | under 1 sitting, gated on row 10 | none — copy derived from code, tested against code | PROPOSED | NOT STARTED |
| 12 | E | CraftJack's patent-pending Speed-To-Call: call within 30 minutes, 20% off the lead | CraftJack: 1.5/5, "sold the same lead up to 6 different contractors", credits withheld until the balance was paid | `first_contact_at` is now captured but not consumed | **PARTLY SHIPPED in `8ae1195e`.** The writer exists (`contact/route.ts:81`). What remains is the rollup into `contractor_profiles.avg_response_hours`, deliberately deferred because it moves every match score and flips `minScore` and `recommended >= 75` | The capture is correct-by-construction: `COALESCE` so a chase cannot improve the metric, claim-scoped `WHERE`, `keepalive` so a phone handing off to the dialler still records | Do the rollup **as a product decision with real data**, not as a tidy-up. The 20% rebate itself is deferred: a rebate engine would make the effective lead price decided in two places | **BACKLOG** (rollup) / **REJECT as specified** (rebate — second pricing authority) | MED | LOW | MED | multi-day, needs a scoring decision | `lib/network/leadPurchase.ts` must remain the only lead-price authority | PROPOSED | NOT STARTED |
| 13 | D | Enerflo: Project Submission lists each unmet requirement as a red card in plain English with a deep link; the rep **cannot** push until they clear | Scoop 22:02: a denied permit, a missing part or a change order goes to limbo when no owner is named | Any stage → any stage, no gate, no audit on four of five call sites | **CONFIRMED** (see row 1). The requirement data mostly exists already — surveys, files, snapshot completeness, and `lib/permit/snapshot/releaseGates.ts`, which is fail-closed and the right shape to copy | The release-gate engine is substantial, versioned and already governs the planset banner | Seed four gates only, sourced from data already in the DB. **Strictly after row 1** — a gate on a route nobody calls is theatre | **STEAL, sequenced** | HIGH | LOW | MED | multi-day | must consume `releaseGates.ts`, never fork a second gate evaluator | PROPOSED | NOT STARTED |
| 14 | D | JobNimbus 22:54: installer-named STATUS over product-fixed STAGE, because the dashboard uses the stages | Demo ERP: 10 project statuses + 23 customer statuses is itself a smell | Four stage vocabularies on one row — `status`(5), `project_status`(13), `homeowner_stage`(7), `micro_stage`(34) | **CONFIRMED.** Synchronised by hand-written maps: `STAGE_TO_LEGACY` inline in `update-status:83-98`, `PIPELINE_STAGE_TO_MICRO` in the dead transition route, `MICRO_TO_HOMEOWNER` in `microStage.ts`, `STAGE_MICRO_MAP` in `homeowner-stage:157` (the one that writes junk, row 8) | — | **Adding an org-named `project_statuses` table now would be a fifth vocabulary.** Collapse to two first: derive legacy `status` and `homeowner_stage` from `project_status` in one place, delete the hand maps, then reconsider | **REJECT as specified** — creates a second status authority before the existing four are reconciled | MED | LOW | HIGH | multi-day | four existing vocabularies; the point is to *reduce* authorities | PROPOSED | NOT STARTED |
| 15 | G | Tesla `AQbPgLPon-E` / `vhno896wwJo` 10:08: three independent videos teach the same manual permission-to-export ritual; one calls it "the #2 mistake that kills system performance" | The most consequential moment in the project — the system going live — is a checklist the homeowner performs from a YouTube video | `completed` copy asserts "Your solar system is live! 🎉 … You're all set." and verifies nothing | **CONFIRMED** (`portal/dashboard/page.tsx:254-261`). **But it has no trigger:** `pto_approved` and `monitoring_active` are written by **no** code path, live or dead — they are not even in the transition route's map (`pto → 'pto_submitted'`, `complete → 'system_live'`) | Equipment family is already known from the design | Real, but blocked twice over: needs row 1, *and* needs `pto_approved` to acquire a writer that does not exist in any branch. Do not build the card first | **BACKLOG** (blocked, not rejected) | MED | MED | LOW | 1 sitting once unblocked | none | PROPOSED | NOT STARTED |
| 16 | E | zolar: "Matching leads are bought the instant they land", weekly spend caps, instant kill switch | Angi/CraftJack: auto-charging with no self-service cancel is the single most-cited billing complaint in the corpus | No auto-buy, no budget cap, no saved search, no alert (grep across `app/api/network app/network lib/network` returns nothing) | Real gap — an installer must sit on the county map to catch a lead | `contractor_profiles` already carries every filter Autobuy would need | Automatic charging against a saved card is the mechanic behind the worst reviews in the entire lane, and it does not serve the permit wedge | **BACKLOG** | MED | LOW | HIGH | multi-day | would need to become a second purchase-initiation path alongside the Stripe Checkout flow — design it as one authority or not at all | PROPOSED | NOT STARTED |
| 17 | G | Bodhi Inbox: one thread across SMS + email + portal, so history is not trapped in one PM's phone | — | `tel:`/`mailto:` to the rep only | Real gap | — | Support-desk product; needs staffing to be anything but a black hole; does not serve the wedge. **Already REJECTed in ROUND-3 — recorded here only so it is not re-proposed** | **REJECT** | MED | LOW | HIGH | — | — | PROPOSED | NOT STARTED |

---

## 2. TOP BOUNDED CANDIDATES

### Lane D

**D-1 — Repoint the five stage writers at the governed route.** *(matrix row 1)*
Build: change the five `fetch('/api/projects/update-status')` call sites to post a
`DealDecisionAction` to `/api/projects/transition`. `EngineeringReviewModal` and
`ScheduleInstallModal` each map to one obvious action; `DealDecisionModal` already *has* the action
key in `options[].key` and throws it away. `app/dashboard/page.tsx:940` (Kanban drag) and
`OperationsTab.tsx:121` (free dropdown) need an action resolved from `(from, to)` — if no transition
exists for that pair, the move is refused, which is the entire point. Then make `update-status`
return 410, matching `survey-handoff`.
Files: `app/dashboard/page.tsx`, `components/project/OperationsTab.tsx`,
`components/commands/EngineeringReviewModal.tsx`, `components/commands/ScheduleInstallModal.tsx`,
`components/deals/DealDecisionModal.tsx`, `app/api/projects/update-status/route.ts`,
`app/api/projects/transition/route.ts` (fix `inspection → 'inspection_passed'`).
Proof: `grep` shows zero `update-status` callers; every stage change produces a `project_activity`
row **and** a `project_micro_stages` row; the portal's `installation` card gains dated sub-steps with
no portal change at all; an illegal pair is refused server-side, not merely hidden.
What could go wrong: the Kanban drag currently permits every pair, so the first honest transition map
will refuse moves operators are used to making. Seed the map's gaps deliberately and log every
refusal before enforcing. **And fix `inspection → 'inspection_passed'` first** — wiring it as-is
would make entering the inspection stage tell the homeowner the inspection passed.

**D-2 — Stop the checklist wipe.** *(matrix row 2)*
Build: replace the `DELETE` + `INSERT` in `lib/operations/generateTasksForStage.ts:30-45` with
`INSERT … ON CONFLICT (project_id, stage, title) DO NOTHING`, plus the matching unique index.
Files: `lib/operations/generateTasksForStage.ts`, one migration (five registrations per
`migration-four-gates` — the runner allowlist is the one everyone forgets).
Proof: drive a project to `installation`, complete two tasks, move to `inspection`, move back to
`installation` — both remain `completed`, and no duplicate titles appear.
What could go wrong: an existing project may already hold duplicate `(project_id, stage, title)` rows
from the current insert path, so the unique index needs a dedupe step before it can be added.

**D-3 — Fix the silently-discarded milestone toggles.**
Build: `DealDecisionModal.tsx:160-170` posts `milestones`; nothing reads it. Either persist it in the
transition's `project_activity` metadata (natural once D-1 lands — the route already writes a
metadata object at `:186-205`) or remove the control. Shipping a toggle that does nothing is the same
defect class as a placeholder field.
Files: `components/deals/DealDecisionModal.tsx`, `app/api/projects/transition/route.ts`.
Proof: toggling a milestone produces a visible, queryable record, or the toggle is gone.

### Lane E

**E-1 — The dispute route, writing columns that already exist.** *(matrix row 9)*
Build: `POST /api/network/opportunities/[id]/dispute` writing `dispute_filed_at` and `refund_status`
on the caller's own claim (mirror the `WHERE` scoping in `contact/route.ts:75-88`), a 4-state tracker
on the claimed-lead card, and a policy panel with an explicit negative list.
Files: new `app/api/network/opportunities/[id]/dispute/route.ts`, `app/network/page.tsx` (card +
tracker), `app/api/network/my-claims/route.ts` (return the state).
Proof: file a dispute on a test lead in Stripe test mode; `dispute_filed_at` moves; the tracker
renders; `lib/intelligence/producers.ts:261` flips `disputeRateSupported` to true and the producer
emits a real dispute rate instead of `null`. That last assertion is the one that proves the metric
stopped being structurally unanswerable.
What could go wrong: an auto-refund tier that fires on an unverified claim is a money-loss path. Ship
the *record* and the human decision first; automate only the cases that are machine-checkable.

**E-2 — Close the pre-payment `location_city` leak.** *(matrix row 10)*
Build: drop `no.location_city AS city` from `territory/[state]/route.ts:213` and `:303`,
`opportunities/[id]/preview/route.ts:47`, `opportunities/route.ts:99`. **Fold into ROUND-3 P0 #4**
(the `lat`/`lng` leak in the same file) — one change, one review, one test.
Files: the four routes above; one test asserting no gated response contains a city, lat or lng.
Proof: an authenticated contractor reading the raw gated JSON gets county granularity and no more.
What could go wrong: the lane notes the UI already drops the field, so this should be inert — but
`my-claims/route.ts:66` and `claim/route.ts:228` legitimately return the city **post-claim**. Do not
sweep those; entitlement is the distinction, not the column name.

**E-3 — Correct the stale comment the last fix left behind.**
Build: `lib/intelligence/producers.ts:243-246` still states `first_contact_at` has zero writers.
It now has one (`contact/route.ts:81`). One comment edit, no behaviour change.
Proof: the block names the writer and the still-unwritten columns separately, so the next auditor
does not re-derive a refuted conclusion from a trusted comment.

### Lane G

**G-1 — Render the install date the installer already recorded.** *(matrix row 4, my highest-confidence candidate)*
Build: add `p.install_date` plus the latest `project_schedule` row of `type='install'` to the portal
dashboard query, and render date + window on the stage card. Render **nothing** when null.
Files: `app/api/portal/dashboard/route.ts` (the projects SELECT at `:54-68`, plus one join),
`app/portal/dashboard/page.tsx` (the `installation` stage card at `:246-253`).
Proof: schedule an install through `ScheduleInstallModal` and the date appears in the portal with no
admin step; a project with no schedule shows no date and no placeholder.
What could go wrong: `projects.install_date` and `project_schedule.date` can disagree —
`ScheduleInstallModal` writes both, `app/api/projects/[id]/operations/route.ts:145` writes only the
former. **Pick one as the portal's source and say which in the code**; do not render whichever is
non-null, which is how a second authority starts.

**G-2 — Un-disable the Tier-1 interconnection profile, using the canonical resolver.** *(matrix row 5)*
Build: delete `const icaTier1 = null as …` and `void getInterconnectionProfile` at
`portal/dashboard/page.tsx:1004-1005`. Call `buildUtilityProfile({ stateCode, address, zip })` —
the same function `app/proposals/view/[id]/page.tsx:455-463` calls — take its `profile.utility_id`,
and pass that to `getInterconnectionProfile`. Keep the existing Tier-2 fallback as the second rung.
Add `zip` to the portal route's client select if it is not already reaching the page.
Files: `app/portal/dashboard/page.tsx`, possibly `app/api/portal/dashboard/route.ts`.
Proof: an Ameren Illinois project shows the real per-utility ICA and PTO day ranges and the named
holder of each step; an unmatched co-op still shows the state fallback; neither ever shows a
fabricated range.
What could go wrong: forking a second utility-resolution path here — a naive
`utilityName.toLowerCase().replace(/\s+/g,'_')` slug would "work" and would be a second authority.
Call `buildUtilityProfile` or do not ship it.

**G-3 — Fix the invalid micro-stage and close the bypass.** *(matrix row 8)*
Build: `'installation_complete'` → `'install_completed'` at
`app/api/projects/[id]/homeowner-stage/route.ts:160`; type that map
`Partial<Record<HomeownerStage, MicroStage>>`; route all three raw `INSERT INTO
project_micro_stages` sites through `writeMicroStage` so the compiler is the guard.
Files: `app/api/projects/[id]/homeowner-stage/route.ts`, `app/api/proposals/[id]/route.ts:330`,
`app/api/proposals/[id]/share/route.ts:128`.
Proof: `tsc` rejects an out-of-vocabulary literal at each site; a project driven to `completed`
writes `install_completed`; a query for `micro_stage NOT IN (MICRO_STAGES)` returns nothing new.
What could go wrong: rows already written as `installation_complete` are permanent under
`UNIQUE(project_id, micro_stage)`. A backfill must decide whether to rewrite or tombstone them —
per `deletion-authority-and-topology-rulings`, archive rather than clear.

---

## 3. THE 41% QUESTION — an honest schema assessment

Lane G's strongest single number: Bodhi's own ticket distribution says **18.6% "when is my
installation scheduled?", 14.6% "how do I use my monitoring app?", 7.5% "any update?"** — 40.7% of
all homeowner contacts. The instruction was to say honestly whether the data to answer them exists,
because a portal that displays fields nothing populates is the defect this project has just spent a
day removing elsewhere. Answered per question, from code:

**Q1 — "When is my installation scheduled?" (18.6%) — THE DATA EXISTS AND IS WRITTEN. Ship it.**
`projects.install_date` has two live writers (`operations/route.ts:145`,
`ScheduleInstallModal.tsx:62`) and `project_schedule` has a real INSERT
(`app/api/schedule/route.ts:80`) carrying `date`, `crew_id` and `notes`. The portal simply does not
select them. This is the one question where surfacing is genuinely all that is required — hence G-1
is my highest-confidence candidate. The only trap is choosing which of the two columns is the
portal's source, and writing that choice down.

**Q2 — "How do I use my monitoring app?" (14.6%) — PARTIAL. Ship the link; do NOT ship the tiles.**
`projects.monitoring_platform` and `monitoring_url` are already selected by the portal route
(`:60-61`), so a link can be rendered honestly today. But there is **no** Enphase or SolarEdge client
anywhere in the repo (`app/api/engineering/enphase/route.ts` is a BOM part resolver), and the three
production tiles are hardcoded `'— kW' / '—%' / '$—'` at `portal/dashboard/page.tsx:797-801` and
`:820-824`. Those tiles are exactly the defect class in question: a surface promising data that no
writer produces. **Delete them or gate them behind a real integration** — do not dress them up. And
`monitoring_url` is only ever pasted by an installer, so absence is the normal case; render nothing
when it is null rather than an empty card.

**Q3 — "Any update on my project?" (7.5%) — THE DATA DOES NOT EXIST YET. Something must be written first.**
This is the honest "no" of the three, and it is worth being precise about what is missing rather than
calling it blocked:
- The micro-stage **vocabulary** exists (34 values) and the **mapping** from pipeline stage to
  micro-stage exists (`transition/route.ts:239-251`, covering `permit_submitted`, `permit_approved`,
  `install_scheduled`, `pto_submitted`). What is missing is that **the route holding that map has
  zero callers**, so nothing ever writes them. That is matrix row 1 — a wiring change, not a build.
- `pto_approved`, `monitoring_active` and `install_completed` are written by **no** path, live or
  dead. They are not in the map at all.
- There is **no `permits` table**, so even a fully-wired pipeline can say "permit submitted" and
  cannot say *to whom*, *under what number*, or *for how long*. That is the schema that must be
  written first, and it is matrix row 3.
- `permit_rejected` exists as a deal action with no micro-stage, so the single most important
  negative event in the window is structurally unable to reach the homeowner.

**Therefore the build order is forced, and it is not the order the lane proposed.** Lane G ranks the
time-in-stage trigger as "the highest-value item in the lane". It is — but a nudge fired on elapsed
time in `homeowner_stage` today would measure a column that barely moves, because the pipeline does
not write it. **Row 1 (wire the governed route) → row 3 (the `permits` table and its writer) → row 6
(the elapsed-time nudge).** Rows 4 and 5 are independent of all of that and can ship immediately,
which is why they are the two candidates I would start with.

**What this buys that no competitor has.** Once rows 1 and 3 land, the sentence on the portal changes
from *"Everything is in motion"* to *"Filed with Madison County Building & Zoning on 12 Apr,
application BLD26-00483, day 11."* No product in this corpus — Tesla, Bodhi, Solargraf, Buildertrend,
Gallery Group, Sunvoy — showed a homeowner a permit number. Continuum showed one only in a marketing
video. SolarPro owns the AHJ registry and generates the package. Per
`ahj-zero-governed-authorities`, show the authority and the number **even when no timeline estimate
is available, and never fabricate a range** — the number and the named authority alone are the thing
the Reddit commenters had to reverse-engineer from a county database.

---

## 4. REJECTED, with the reason stated

- **Org-named `project_statuses` table (lane D candidate 4).** REJECT as specified. SolarPro already
  carries four stage vocabularies on one row, reconciled by four hand-written maps in four files —
  one of which (`homeowner-stage:157`) writes an invalid value. Adding an installer-named fifth
  before collapsing the four is a second status authority. Revisit after legacy `status` and
  `homeowner_stage` are **derived** from `project_status` in one place.
- **Speed-to-claim rebate (lane E candidate 2, the rebate half).** REJECT as specified. A rebate
  engine would make the effective lead price a function of two things —
  `lib/network/leadPurchase.ts:35-49` grade defaults *and* a behavioural discount — computed in
  different places. Price must have one owner. The capture half already shipped in `8ae1195e` and is
  the valuable half.
- **Per-contractor lead price slider (lane E, Thumbtack).** REJECT. Same reason, more directly: it
  makes each contractor's price a second pricing authority and turns the marketplace into the soft
  auction whose failure modes fill this lane's complaint corpus.
- **Chat / unified inbox in the homeowner portal (lane G).** REJECT. Support-desk product, needs
  staffing to be anything but a black hole, does not serve the permit wedge. Already REJECTed in
  ROUND-3; recorded here so it is not re-proposed.
- **Autobuy with a saved card (lane E candidate 4).** BACKLOG, not reject — but note that automatic
  charging with no self-service cancel is the single most-cited failure across Angi, CraftJack and
  Bark, and it does not serve the wedge.
- **Production-monitoring tiles as currently shipped.** REJECT the tiles, not the feature. Three
  hardcoded em-dashes are a promise with no writer behind it.

---

## 5. Cross-lane duplicates collapsed

| Duplicate | Collapsed into |
|---|---|
| Lane D candidate 2 (make `transition` the only stage writer) + lane G candidate 1 (break the `installation` blob) | **Matrix row 1.** The `PIPELINE_STAGE_TO_MICRO` map that lane G needs is *inside* the route lane D wants wired. One change, both outcomes. |
| Lane D candidate 6 (wire pipeline into the customer timeline) | **Matrix row 1.** `syncHomeownerStage` and `writeMicroStage` are already called by that route. |
| Lane E candidate 6's blocker (`location_city` on the wire) + ROUND-3 P0 #4 (`lat`/`lng` on the wire) | **Matrix row 10.** Same route family, same review. |
| Lane G candidate 3's stated blocker ("no scheduler") | **Dissolved, not collapsed.** `vercel.json:7-16` already runs two production crons. |
| Lane E `contractor_performance` vacuity | **Already shipped** in `8ae1195e`; row 12 records only the deferred rollup. |

---

*Verification performed against HEAD `8ae1195e` on 2026-09-25. No product source was edited, no test
suite was run, and no commit was made in producing this document.*
