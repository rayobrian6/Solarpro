# Lane D — CRM / Operations UX

Research worker output. 9 product walkthroughs genuinely watched (frames + transcripts merged into a
timeline before concluding), plus a code-read audit of SolarPro's own CRM surfaces.
Marketing pages were not used as product evidence; where a vendor blog is cited it is flagged as
secondary and sits outside the ledger.

---

## SUMMARY — transferable interaction principles

1. **A handoff is an ACCEPT, not a send** — a verbal "yeah I've got time" is how projects stall (Scoop 24:39).
2. **The RECEIVING team defines the intake list**; the sender cannot push until it is satisfied (Enerflo 30:11).
3. **A blocked gate names the missing artifact in plain English and deep-links to where to fix it** (Enerflo).
4. **Deferrable at the step, non-deferrable at the handoff** — "Skip for now" is safe only because a gate exists.
5. **Two layers: installer-named STATUS over product-fixed STAGE** — reporting needs fixed semantics (JobNimbus 22:54).
6. **One board per department, not one board per company**; role decides which board, or which slice (JobNimbus 18:07).
7. **The work queue is a saved query, not a column** — OpenSolar's "Custom Report" (Action Incomplete AND Stage).
8. **Filter on the design object, not just the CRM record** (Has Sold System, With System Larger Than) — SolarPro's edge.
9. **Status changes when an artifact exists**, not when someone remembers to drag a card (JobNimbus 09:29).
10. **Exceptions are the product**: denied permit, missing part, change order — flag them, then review only the flagged.
11. **A change order is a priced decision with an owner, taken before payout** — charge or knowingly absorb (Powur 30:01).
12. **One timeline, two audiences** — the same step list drives the internal to-do and the customer's SMS (Solargraf).
13. **Milestone visibility is support deflection** — "I haven't heard anything" is answered by the list (Powur 21:10).
14. **Sub-states inside a stage beat a finer pipeline** — waiting / in progress / ready for review, so a role can batch.
15. **Referential integrity is UX** — no deleting a pipeline or type while records still sit in it (ARKA, JobNimbus).

---

## LEDGER

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | STEAL/ADAPT/REJECT/BACKLOG | RE+ impact (HIGH/MED/LOW) | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Solar CRM | OpenSolar 3.0 | How to make the most of the CRM in OpenSolar | `GeOUDGopWD8` | 2020-03-16 | official / training | 7:13 (full transcript + 36 frames) | 0:50 stage bar + Actions; 1:02 lock-pricing on Sell; 2:05 filter by stage/action; 2:50 Create Activity; 3:20 assign + email notify; 4:06 Project History; 4:26 calendar; 5:30 files; 6:13 assign team member; 6:27 project access control | Project page = address, contacts, stage bar (Design→Sell→Install→Maintain→Other), Actions checklist, Planned Activity, Project History, Sales & Service (assigned member, priority, lead source), Site Details (assigned site inspector, meter id, roof type, storeys), Files | Actions are a per-org customisable checklist scoped to a stage and each tick is **timestamped with who did it**; moving to Sell **locks pricing** (a stage change with a real side effect); every change incl. proposal-email-sent lands in Project History; filters compose into a named **Custom Report**; activity assignment emails the assignee; non-admins can be restricted to only their projects, globally or per project | Only **5 stages and they are NOT customisable** — Control zone exposes only Project Tags and Project Actions. **There is no permit stage at all**; permitting is an outbound partner hand-off (Natron). Site Details is a flat field list, not a survey record | Installers bolt a real CRM alongside it — the OpenSolar CEO says so himself on camera (see next row) | 13 stages incl. permit/inspection/PTO but **no per-stage checklist that is timestamped or attributable**; `project_tasks` has no assignee and no due date; ticking a task gates nothing (`checkStageCompletion` is never called) | **STEAL** (timestamped attributable stage checklist + saved filter views) | HIGH | HIGH — this is the single highest-frequency ops surface | MED — needs an assignee column + an activity writer | proposed |
| Solar CRM | OpenSolar 3.0 | OpenSolar: A Free (and super slick) Solar PV Design, Proposal and CRM Software | `P8JACuy96V8` | 2020-04-29 | vendor CEO (A. Birch) on independent trade channel (Solar Builder) | 20:29 (transcript + 36 frames) | 4:00 branded lead capture → own CRM; 4:16 stages/prioritisation/allocate reps; 4:26 configurable timestamped actions; 8:27 see when the customer VIEWED the proposal; 12:44 workflow tied to contract signature + payment status; **13:17 "but you can run a separate CRM if you want"**; 17:08 planset delivered by partner | Lead capture form on the installer's own site → branded CRM → project zone → design → proposal → e-sign + card payment → planset ordered from a partner | Proposal **view telemetry** (how long, how often, when) feeds follow-up; contract signature and payment status flow back into the workflow rather than living in the e-sign tool | The vendor's own CEO concedes the CRM is optional — it is a design tool with CRM attached, and permitting leaves the system entirely | Run a separate CRM (his words) | SolarPro has the same shape — design-first with CRM attached — but **worse**, because the CRM half is partly dead code | **REJECT** the "CRM is optional" posture; it is the trap SolarPro is currently in | MED | — | — | evidence only |
| Solar CRM | ARKA 360 | Solar CRM: Pipeline Management | `IuG4HWPVI5I` | 2023-09-07 | official | 2:01 (full transcript + 14 frames) | 0:15 stage types open vs closed; 0:29 closed stages cannot be reordered; 0:50 duplicate pipeline as template; 1:06 delete pipeline forces lead reassignment; 1:21 kanban | Multiple named pipelines (Solar Sales Proposal 6 stages, PG Proposal 5 stages), each with an Open Stages group and a Closed Stages group (Closed/Won, Closed/Lost) | **A stage has a TYPE.** Terminal outcomes are structurally pinned to the end and cannot be dragged into the middle. Pipelines are duplicable as templates. Deleting a pipeline **forces reassignment** — no orphaned leads | Both shipped pipelines are *sales* pipelines. There is no fulfilment pipeline, so the design stops at "Won" | — | SolarPro's 13 stages are a flat `as const` array with no type, no terminal marker, and `isValidStage()` permits **any stage → any stage** | **STEAL** (stage type: open / terminal) — cheap and prevents a class of nonsense | MED | MED | LOW | proposed |
| Solar platform | Enerflo (+ Scanifly) | Enerflo + Scanifly Live Demo! A Better Solar Sales & Design Workflow | `1FZra98qfPg` | 2025-11-06 | official live demo (real product, live) | 44:08 (transcript 1301 cues + 60 scene frames + 9 targeted frames) | 9:52 Deal Template = the stages a rep must pass; 10:23 stages carry **questions** ("are they in an HOA?"); 11:08 title check kills a name-mismatch CO; **19:16 adders auto-applied from design attributes**; 29:43 required forms signed at time of sale; **30:05–30:49 PROJECT SUBMISSION**; 32:27 simple mode restricts the rep's design edits; 33:49 drone at survey ⇒ "zero revisions and zero as-builts" | New Deal = address + installer + **Deal Template + Version**. Left rail is the stage list with completion rings; stages expand into sub-steps (Prequalification → Prequal Questions / Rapid Quote / HOA / Site Details / Schedule Appointment / Notes). Terminal stage is Project Submission | **The best handoff mechanic found in this lane.** Project Submission lists each unmet requirement as a red card in plain English — "At least one utility bill has been uploaded", "The contract has been signed by the customer", "The homeowner has signed their financing docs", "Add Photo: Roof (Front)" — each with a **deep link to the stage that satisfies it**, and some fixable inline. The rep **cannot** push to ops until they clear. Sub-steps offer "Skip for now" so the flow never blocks, because the gate catches it at the boundary. Conditional fields (HOA=Yes reveals 3 required HOA fields). **Deal templates are VERSIONED** so changing the process does not retroactively break in-flight deals. Adders auto-fire from design facts (>10 kW, high pitch, travel market) so pricing is right first time | The gate is one-directional — it governs sales→ops only. Nothing shown governs design→permit or permit→install. Change orders are *prevented* (title check, auto-adders, drone accuracy) but no change-order **object** was demonstrated | Contractors "true up" between a cheap front-end design tool and the real one, which is exactly what generates the change orders (09:05) | **Nothing comparable.** SolarPro's stage write is `POST /api/projects/update-status` validating only set membership. `app/api/projects/transition/route.ts` — which does exist, with a 27-action `DEAL_TRANSITIONS` map and a docblock declaring itself "The ONLY authorised path" — **has zero callers** | **STEAL** — the submission gate is the single most valuable thing in this lane | **HIGH** | **HIGH** | MED — needs a requirement registry + a gate evaluator; the release-gate engine in `lib/permit/snapshot/releaseGates.ts` is the right shape to copy | proposed |
| Solar ops | Scoop (Scoop Robotix) | How to Streamline Solar Installation: 6 Process Improvements | `TI1tOgt2UQI` | 2025-08-01 | vendor webinar, carrying operator anecdotes (slides, not a product tour) | 33:51 (full transcript 776 cues + 28 frames — confirmed slide deck, so the transcript is the evidence) | 13:29 see at a glance where each project is stuck, what is needed, who owns it; 13:09 **alternate workflows for exceptions**; 17:41 flag a missing site doc **before the crew leaves and before the phase advances**; 18:26 log exceptions and find the root cause; 20:20 comms milestones = permits approved / materials ordered / install scheduled; **22:02 "a denied permit, a missing part, or a change order"** → limbo when no owner; 22:48 green/yellow/red at-risk flags; 23:10 weekly review of ONLY flagged projects; **24:39 the messy-handoff anecdote**; 26:04 sub-lists (waiting to start / in progress / ready for review) | Standardise the workflow, define the owner per stage, document exceptions as alternate workflows, flag at-risk, review flagged only | Names the three exception classes explicitly. Quality control **at the site, in real time**, not at a later review — "before they leave the site and before the project moves to the next phase". Sub-lists inside a stage so a role can batch. Exceptions logged over time so patterns become process fixes | It is a slide webinar; no product surface is demonstrated, and the "best-of-breed beats all-in-one" thesis is self-serving for an integration hub | Spreadsheets, and a founder personally unblocking jobs until they can't be everywhere | No at-risk flag, no stall detection wired to anything actionable, no exception log. `project_activity` exists but four of the five stage-write call sites never write to it | **STEAL** (at-risk flag + flagged-only review queue); **ADAPT** (exception log) | HIGH | HIGH | LOW–MED | proposed |
| Solar ERP | Narayana Digital "Demo ERP" | Solar ERP Software Complete Demo — 200+ Features, CRM, Finance, Installation & Service | `4vdMDdQpQ9s` | 2026-07-23 | official | 26:52 (**no captions available — 36 frames read, frames only**) | 4:30 Leads: Card/Table/**Kanban** toggle, lead stage + source + assigned-to filters, qualifiers, follow-ups, credit check; 7:00 EPC Customers list with kW / value / Pending·On Hold·Completed; 19:11 inventory with **Reserved** stock movements; 23:00 Roles & Permissions | Leads (CRM) and EPC Customers / Projects (fulfilment) are **separate objects** with a conversion boundary; Site Surveys is a first-class module alongside Projects, Proposals, Tasks | Config objects are first-class and separately countable: Stages (9), **Stage Categories (2)**, Project Statuses (10), Customer Statuses (23), Custom Fields (15). Permissions are granular per module and — critically — **"Complete Project Stage Checklists" is a DIFFERENT permission from "Manage Project Stages"**: the right to tick is not the right to redefine. Inventory can **Reserve** stock against a project, which is Scoop's "material readiness" stall cause modelled | Generic ERP aesthetics; nothing solar-specific in the lifecycle; no permit or inspection object observed; the sheer count of status vocabularies (10 project + 23 customer) is itself a smell | — | SolarPro has role guards at org level only (`users.role`, admin/super_admin). There is no project-level permission, and no distinction between ticking a task and changing the pipeline | **ADAPT** (split the tick permission from the define permission; stage categories) | MED | MED | LOW | backlog |
| Solar proposal+ | Solargraf (Enphase) | Product Showcase: Solargraf | `vUsuJlQANyU` | 2020-04-30 | vendor AE on independent podcast (SunCast) | 27:18 (transcript 609 cues + 36 frames) | 5:01 company activity live feed; 5:13 team comments as notes; 5:31 **TO DO = dated milestones across all projects**; 5:34 customer-facing project timeline **inside the proposal**; 6:03 payment terms attached to steps; **16:42 marking a step complete texts + emails the client with the next step**; 17:09 slipped date is edited and re-pushed to the client; 17:47 Manage Project page — notes + files with **per-file share-with-client**; 18:17 virtual site assessment the homeowner performs | Proposal carries a customisable step list (contract signature → site assessment → permits and applications → installation → connection) with dates and payment percentages; the same list is the internal to-do and the customer's status page | **One timeline object, three views**: internal dated to-do, customer-visible timeline, and notification trigger. The notification names the completed step AND the next one. A date change is a first-class, customer-visible event rather than a phone call. Per-file share toggle means one document store serves both audiences | Steps are free text with no semantics — nothing can gate on them. No assignee. No failed-inspection concept | — | SolarPro **has** the two-audience split already: `project_micro_stages` (34 values, append-only, `UNIQUE(project_id, micro_stage)`) drives `app/portal/dashboard`, and `homeowner_stage` (7 values) is forward-only with a history row and an email. But the internal 13-stage pipeline **does not write to either** except via the dead transition route — so the customer timeline and the ops board can silently disagree | **STEAL** (wire the existing pipeline into the existing micro-stage timeline — this is a connection, not a build) | HIGH | HIGH | **LOW — both halves already exist** | proposed |
| Solar platform | Powur Enterprise | Powur Enterprise — Solar Management Software | `VU6OxclN0GI` | 2024-09-05 | platform exec (C. Thompson) — partner webinar | 55:08 (transcript 1332 cues + 40 frames + 4 targeted) | 19:04 site survey in **three modes** — virtual / homeowner-performed / on-demand; 19:20 milestone payment within 48h of a completed survey; 20:37 dedicated PM per project; 21:02 PM notes reportable in the back office; 21:05 ticketing between partner and PM; **21:10 "I haven't heard anything" → they look at milestones and everything's there**; 22:13 select and assign your own certified labour partner; **30:01 change order OR knowingly eat the difference, decided in advance** | Sell → site survey (one of 3 modes) → in-house design/engineering → permitting → install by an assignable labour partner → milestones → payout | Milestone list is the **first-line support answer**, deliberately. PM notes are a reportable surface, not private scratch. The change-order moment is framed as an explicit priced choice with a named owner, taken *before* the final milestone payment rather than discovered as a deduction. Survey has modes because the constraint is who is available, not what the form is | Heavily a revenue-share pitch; the milestone list shown is read-only status, not a work surface. Install execution is outsourced, so nothing models a failed inspection | Operators coming from elsewhere describe "horror stories of finding out at the last minute about additional costs" (29:51) | `projects.crew_assigned` is **free TEXT, not an FK** to `crews`, and diverges from `project_schedule.crew_id` — two unreconciled assignment mechanisms. No change order exists anywhere in the repo | **ADAPT** (change order as an explicit priced decision tied to a milestone) | MED | HIGH | MED | backlog |
| Trade CRM (adjacent) | JobNimbus (roofing) | JobNimbus for Roofing: The Setup I Wish I Had When I Started (Part 1) | `qsJR_uz-ju8` | 2025-07-10 | **real operator** — roofing contractor Andy Keys, own company's live account | 51:13 (transcript 2516 cues + 40 frames) | 8:06 statuses shape the workflow, map it on paper first; **9:29 status is "lead" only if you hang up WITHOUT a booked meeting**; 12:46 automation fires a task on status change; **18:07 five boards — sales, permits, production, accounts, completion**; 18:14 role decides which board, sometimes only part of one; 20:37 one workflow per job type; 21:33 "we don't want new construction mixing with roof replacement — the processes are different"; **22:54 each status maps to a fixed, non-customisable STAGE because the dashboard uses them**; 22:45 he mis-configured stages for a long time before understanding them | Contact workflows and Work Order workflows configured separately, each type carrying its own status chain, a Visible flag and an **Access scope** (Assignee / Everyone) | The two-layer model: installer-named **statuses** on top of product-fixed **stages**. Departmental boards rather than one company board. Status changes on an artifact existing, not on someone remembering. Type deletion blocked while records reference it | Stage semantics are undiscoverable — he ran mis-configured for months. Roofing, not solar: no permit/inspection/PTO lifecycle | His live browser tabs (17:49 frame) show Gmail, QuickBooks, SumoQuote ×2, Roof & Solar Report, ABC Supply, banking, weather — **even a power user runs ~6 other tools** | SolarPro carries **four uncoordinated stage vocabularies on one row**: `status` (5), `project_status` (13), `homeowner_stage` (7), `micro_stage` (34), synchronised by hand-written maps in ≥5 files, only on the code path nobody calls | **STEAL** (status→stage two-layer model; per-department board views) | **HIGH** | **HIGH** | MED — the four vocabularies must be collapsed to two first | proposed |

### Secondary (failure hunt only — vendor blog, NOT product evidence)
- scoop.solar/blog/fix-handoffs-between-sales-and-install — the handoff packet operators say must transfer:
  customer details, site information, financing status, site photos, utility information, signed documents.
  Named failure: "the process allows a project to advance without the data needed".
- scoop.solar/blog/why-solar-projects-stall-after-permitting — "an approved project can wait in an inbox while
  operations assumes scheduling has started"; interconnection adds ~20 days; **10–20% of permitted residential
  projects never reach installation**; physical install is 1–3 days inside a 4–12 week permit-to-PTO window.
- sunbasedata / crmleaf blogs — "three to five points of manual re-entry" between first contact and install
  handoff; generic CRMs have no model of AHJ workflow, interconnection paperwork or inspection scheduling.
- Reddit could not be fetched from this environment (`www.reddit.com` blocked); the operator voice in this
  lane therefore comes from the JobNimbus source and the Scoop/Powur anecdotes, not from forums. Stated
  plainly rather than papered over.

---

## SolarPro today — what the code actually does

Read from `C:\Users\Ray\Solarpro Claude\repo`. Verified directly, not taken on trust.

**Pipeline.** `lib/operations/pipeline.ts:9` — 13 stages: `lead, site_assessment, design_complete,
proposal_sent, contract_signed, engineering, permit_submitted, permit_approved, install_scheduled,
installation, inspection, pto, complete`, grouped into 4 `STAGE_PHASES` (Sales / Pre-Install /
Installation / Done). Rendered as a 13-column Kanban in `app/dashboard/page.tsx` (1803 lines).
`app/operations/page.tsx` is a 45-line redirect to it.

**The governed state machine is dead code.** `lib/deals/transitions.ts` defines 27 actions, `STAGE_DECISIONS`
and `DEAL_TRANSITIONS` with `stalls`/`terminal` flags; its header rule 1 reads *"No UI component may mutate
project stage directly."* `app/api/projects/transition/route.ts` implements it correctly — ownership check,
`project_activity` row, `generateTasksForStage`, `syncHomeownerStage`, `writeMicroStage`, command regen — and
calls itself *"The ONLY authorised path for changing a project's pipeline stage."* Grep across
`app/ components/ lib/ tests/` returns **only its own docstring and one comment in
`lib/homeownerStageSync.ts:14`. Zero callers.**

Every real stage write goes to `app/api/projects/update-status/route.ts`, whose entire legality check is:

```ts
export function isValidStage(stage: string): stage is PipelineStage {
  return PROJECT_PIPELINE.includes(stage as PipelineStage);   // lib/operations/pipeline.ts:205
}
```

Pure set membership — **any stage → any stage.** Its five callers: `app/dashboard/page.tsx:940`,
`components/project/OperationsTab.tsx:121` (a free dropdown of all 13),
`components/commands/EngineeringReviewModal.tsx:29`, `components/commands/ScheduleInstallModal.tsx:75`, and —
the sharpest one — `components/deals/DealDecisionModal.tsx:160`: **the Deal Decision Engine modal bypasses
`DEAL_TRANSITIONS`.** Four of the five write no `project_activity`, no micro-stage, and do not advance
`homeowner_stage`.

**Task regeneration destroys completion state.** `lib/operations/generateTasksForStage.ts` runs
`DELETE FROM project_tasks WHERE project_id = … AND stage = …` and re-inserts every title as `'pending'`.
So a project sent back to `installation` after a failed inspection has its installation checklist wiped —
the exact happy-path assumption the mission asked about. `checkStageCompletion()` exists in the same file
and is never called, so task completion gates nothing.

**What does not exist at all.**
- **Change orders.** Case-insensitive grep for `change[_ -]?order|changeOrder` across `app/ lib/ components/
  types/ store/ hooks/ migrations/ db/` returns **zero matches**. No table, no type, no field, no route.
- **Failed inspections.** The only representation anywhere is `lib/deals/transitions.ts:559`
  `inspection_failed: { newStage: 'installation', activityTitle: 'Inspection failed — corrections needed',
  stalls: true, nextAction: 'Fix issues and reschedule' }` — reachable only through the route nobody calls.
  There is no inspection record, inspector, date, result or correction list. In the shipped product a failed
  inspection is a user picking "Installation" from a dropdown, which then wipes the installation checklist.
- **PTO / interconnection record.** A stage label and three task strings (`'Submit interconnection',
  'Coordinate with utility', 'Confirm PTO approval'`). No utility, no confirmation number, no date.
- **Task assignee and due date.** `project_tasks` has neither column.
- **Project notes.** One `projects.notes` TEXT column. Threaded notes exist only on `clients`
  (`client_notes`, ≤2000 chars, author + timestamp).
- **Appointments** in the homeowner CRM (the marketplace has them).
- **In-app notifications.** `/api/settings/notifications` stores 12 preference booleans including `inapp_*`
  bell flags; there is no notification table and no bell.

**Four stage vocabularies on one project row**, synchronised by hand-written maps in ≥5 files, only on the
dead path: `status` (5, legacy) · `project_status` (13) · `homeowner_stage` (7, portal) · `micro_stage`
(34, append-only). The only genuinely governed ones are the two customer-facing ones — `homeowner_stage` is
forward-only with a `force=true` override, a history row and an email
(`app/api/admin/projects/[id]/route.ts:167-189`); `project_micro_stages` is append-only with a DB
`UNIQUE(project_id, micro_stage)`.

**The permit release gate governs a PDF, not the project.** `lib/permit/snapshot/releaseGates.ts` is
substantial and fail-closed (`RELEASE_GATE_MODEL_VERSION`, 9 finding types, 7 gate categories, an
`UNMAPPED_REQUIREMENT` catch-all) and `releasePhase.ts` runs `DESIGN_INCOMPLETE →
AWAITING_PROFESSIONAL_REVIEW → AWAITING_SEAL_AND_ISSUE → ISSUED_FOR_PERMIT`. Its only consumers are
`lib/permit/sections/*` and `lib/permit/utils/releaseStatusBlock.ts` — it decides the **banner on the
planset**. Grep for `releaseGates|resolveReleasePhase` across `app/**` and `components/**`: no files. Grep
for `project_status|micro_stage|PROJECT_PIPELINE` across `lib/permit/`: no matches. A project can be moved
to `permit_approved` with an open release gate and nothing objects.

**Also**: `app/enterprise` is a contact form, `app/compliance` is static prose, `app/analytics` computes its
funnel over the 5-value legacy status rather than the 13 stages, and there are three coexisting migration
systems (`migrations/`, `lib/migrations/`, and 4269 lines of inline DDL in `app/api/migrate/route.ts`).

### Could someone run a solar company on this without a second CRM?

| Product | Answer, with evidence |
|---|---|
| **OpenSolar** | **No** — and the vendor's CEO says so on camera: *"but you can run a separate CRM if you want"* (`P8JACuy96V8` 13:17). 5 fixed stages, no permit stage, permitting leaves the platform. |
| **Enerflo** | **Close to yes for sales→ops.** The deal template, submission gate and installer-defined intake genuinely carry a project from lead to handoff. But the demo never shows permit tracking, inspection or PTO — Enerflo positions itself as the connective layer between other tools, so fulfilment depth is unproven from this source. |
| **Powur** | **Yes, but not as your software** — it is an operating *company* with milestones, PMs and labour partners attached. You are running on their rails, not yours. |
| **Solargraf** | **No.** Proposal + permit-set ordering with a customer timeline. No ownership, no assignment, no gating. |
| **ARKA 360** | **No.** Sales pipelines only; nothing past Closed/Won. |
| **Scoop** | **By design, no** — it explicitly argues you should run best-of-breed tools around a central hub. |
| **JobNimbus** | **Yes for a roofer**, and the operator still runs ~6 other tabs — but the boards, statuses and role scoping are the real thing. |
| **SolarPro** | **No — and it is currently the weakest of the set on this axis**, despite owning the deepest design/permit engine. It has the *labels* of the full lifecycle (permit, inspection, PTO) and almost none of the *mechanism*: stage changes are unvalidated and unaudited, no change order, no inspection record, no assignee. The asset is real; the wiring is missing. |

---

## TOP CANDIDATES FOR SOLARPRO

### 1. Handoff gates — "this project cannot leave Sales until Ops' list is satisfied"
*Source: Enerflo `1FZra98qfPg` 30:05–30:49; Scoop `TI1tOgt2UQI` 17:41, 24:39.*
**Build:** a `stage_gate_requirements` table keyed `(from_stage, to_stage, requirement_key)`, and a gate
evaluator that returns, per unmet requirement, a plain-English sentence plus a deep link to the tab that
satisfies it. Block the transition in `update-status` when the gate is open; render the blockers in the
same card shape Enerflo uses. Seed four gates only: `proposal_sent→contract_signed`,
`contract_signed→engineering`, `engineering→permit_submitted`, `permit_approved→install_scheduled`.
**Why it beats what we have:** SolarPro currently lets any stage go to any stage with zero checks. The
requirement data mostly already exists — surveys, files, snapshot completeness, release gates.
**Bounded by:** four gates, requirements sourced only from data already in the DB, no new capture UI.
**Proof:** a project with no signed contract cannot reach `engineering`; the block names the missing
artifact and links to it; a test asserts the transition is refused server-side, not just hidden in the UI.

### 2. Make `/api/projects/transition` the only stage writer, and delete the bypass
*Source: the audit itself, plus every ledger row's governed-transition behaviour.*
**Build:** repoint all five callers of `update-status` at `/api/projects/transition`; have it validate
against `DEAL_TRANSITIONS`; make `update-status` a 410 like `survey-handoff` already is. Fix
`generateTasksForStage` to **upsert** rather than delete-and-reinsert, so re-entering a stage after a
failure does not erase completion.
**Why it beats what we have:** the machine is already written, reviewed and unused. This is wiring, not
invention — and it delivers the audit trail, micro-stage write and homeowner-stage sync for free on every
stage change.
**Bounded by:** no new schema; five call-site edits plus one SQL change.
**Proof:** grep shows zero `update-status` callers; every stage change produces a `project_activity` row and
a `project_micro_stages` row; a project bounced back to `installation` keeps its completed tasks.

### 3. Failed inspection and change order as first-class records
*Source: Scoop `TI1tOgt2UQI` 22:02 (denied permit / missing part / change order); Powur `VU6OxclN0GI` 30:01.*
**Build:** two small tables. `project_inspections(project_id, type, scheduled_for, inspector, result
CHECK(passed|failed|cancelled), correction_notes, created_by)` — a `failed` row drives the project to a
**blocked** flag rather than silently reversing the stage. `project_change_orders(project_id, raised_by,
reason, delta_cost, decision CHECK(charge_customer|absorb), decided_by, decided_at, approved_at)` — Powur's
explicit priced choice, surfaced before any completion payment.
**Why it beats what we have:** both are literally zero matches in the repo today, and they are the two
moments the mission names as where a happy-path model falls apart.
**Bounded by:** two tables, two panels on the Operations tab, no pricing-engine integration in v1.
**Proof:** record a failed inspection → the project shows blocked with the correction list and keeps its
installation checklist; raise a change order → it appears on the project and blocks `complete` until decided.

### 4. Collapse four stage vocabularies into two layers: installer STATUS over fixed STAGE
*Source: JobNimbus `qsJR_uz-ju8` 22:54 — "each status is associated with a specific stage… stages are not
customisable because the dashboard actively uses them".*
**Build:** keep the 13 `PROJECT_PIPELINE` stages as the immutable product vocabulary that everything
reports and gates on. Add an org-owned `project_statuses(org_id, label, stage, sort_order, is_terminal)`
that installers name themselves. Derive `homeowner_stage` and the legacy 5-value `status` from `stage`
rather than maintaining parallel hand-written maps.
**Why it beats what we have:** four vocabularies on one row synchronised by hand in ≥5 files, on a path
nobody calls, is a live correctness hazard — and it is also why installers cannot use their own language.
**Bounded by:** one new table plus deriving two of the four existing columns; `micro_stage` stays as-is
(it is already append-only and correct).
**Proof:** two orgs with different status names both roll up into the same stage report; removing the
hand-written sync maps changes no output.

### 5. Saved work-queue views, filtered on the design object
*Source: OpenSolar `GeOUDGopWD8` 2:05–2:20 + 4:26 (Custom Report), 1:33 filter menu; Scoop 23:10
flagged-only review; JobNimbus 18:07 per-department boards.*
**Build:** composable, savable, shareable filters over projects — stage, assignee, at-risk flag, open gate,
**and design facts SolarPro alone owns** (system size, AHJ, roof planes, release-gate status, snapshot
digest staleness). Ship three seeded views: *Blocked at a gate*, *Awaiting permit >14 days*, *Mine, this week*.
**Why it beats what we have:** the 13-column Kanban is the shape a real operator says stops working — he
runs five role-scoped boards instead. A saved query is cheaper than five boards and gets to the same place.
**Bounded by:** read-only views over existing data; no board builder, no drag-and-drop config.
**Proof:** an ops lead opens one saved view and sees exactly the jobs needing them today; the *Blocked at a
gate* view is non-empty as soon as candidate 1 ships.

### 6. Wire the internal pipeline into the customer timeline that already exists
*Source: Solargraf `vUsuJlQANyU` 5:31 + 16:42; Powur `VU6OxclN0GI` 21:10.*
**Build:** on every governed transition (candidate 2), write the matching `project_micro_stages` row and
advance `homeowner_stage`, then send the milestone email for the three moments operators actually name —
permit approved, materials ordered, install scheduled — each stating the completed step **and the next one**.
Make a slipped install date a customer-visible event rather than a phone call.
**Why it beats what we have:** both halves already exist and work (`app/portal/dashboard`, `homeowner_stage`
history + `sendStageAdvanceEmail`). They are simply not connected to the ops board, so the two can disagree.
**Bounded by:** no new tables, no new email infrastructure; three milestones only.
**Proof:** advancing a project on the dashboard updates the homeowner portal within the same request, and
the homeowner receives one email naming both the completed and the next step.

---

## EXIT CRITERIA STATUS

| # | Criterion | Status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — 8 distinct products watched (OpenSolar, ARKA 360, Enerflo+Scanifly, Scoop, Demo ERP, Solargraf, Powur, JobNimbus) |
| 2 | ≥1 official / training source | **MET** — OpenSolar CRM training `GeOUDGopWD8`, ARKA `IuG4HWPVI5I`, Enerflo live demo `1FZra98qfPg`, Demo ERP `4vdMDdQpQ9s` |
| 3 | ≥1 real user / operator source | **MET, but thinly** — one genuine operator on his own live account (Andy Keys, JobNimbus, `qsJR_uz-ju8`), and that is **roofing, not solar**. Scoop and Powur relay operator anecdotes but are vendors. Reddit was unreachable from this environment (`www.reddit.com` blocked). **A solar operator on camera in their own solar CRM was not found in this pass.** |
| 4 | Core workflow end-to-end | **PARTIAL** — lead intake, qualification, stage pipeline, assignment, notes, documents, the sales→ops handoff, scheduling, customer comms and PTO-as-milestone are all covered with evidence. **Permit→install and inspection→PTO are covered only by narrative** (Scoop, Powur); no product was observed *executing* a permit submission, an inspection result, or a PTO confirmation on screen. |
| 5 | Findings repeating | **MET** — the gate/checklist-at-the-boundary pattern appeared independently in Enerflo, Scoop, OpenSolar and the Demo ERP's permission split; the customisable-status-over-fixed-stage pattern in JobNimbus and the Demo ERP; the ownership-gap failure in Scoop, Powur and both secondary blogs |
| 6 | Opportunities triaged | **MET** — every ledger row carries a verdict, RE+ impact, user value and implementation risk |
| 7 | SolarPro equivalent audited | **MET** — audited from code; the two load-bearing claims (transition route has zero callers; zero change-order matches repo-wide) were re-verified by direct grep, and `isValidStage` / `generateTasksForStage` read in full |
| 8 | Candidates shipped or backlogged | **NOT MET** — all 6 candidates are **proposed only**. Nothing has been built, no issue has been filed, and this worker wrote no product code by instruction |

**NOT MET: (8). PARTIAL: (3) and (4). Saturation is NOT declared.**

To close the gaps, the next pass needs: (a) a **solar** operator walkthrough — a project coordinator or ops
manager working a real permit queue, not a vendor demo; (b) a product observed handling a **denied permit or
a failed inspection** on screen, which no source in this pass did; (c) Reddit/forum access from an
environment that can reach it, since the operator-complaint evidence here leans on vendor blogs.

---

*Artifacts: transcripts and extracted frames for every ledger row are under
`C:\Users\Ray\Solarpro Claude\tools\watch\<videoId>\` (`transcript.txt`, `frames/t<seconds>.jpg`, and
`targeted/s<seconds>.jpg` where specific moments were cut).*
