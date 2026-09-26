# Platform gauntlet — read-only audit, 2026-09-26

216 agents, 0 errors. Every finding was checked by **three independent verifiers**
with different lenses (does the code say this / is the consequence real / is it
already handled). A finding needed at least two to uphold it.

**53 confirmed. 16 killed by verification.** The kill rate is the point: a finding
that survives three adversarial reads is worth acting on, and the ones that did not
are recorded as REJECTED in `LEDGER.md` rather than silently dropped.

Nothing in this file was fixed by the audit itself — it is read-only. Items marked
✅ were fixed afterwards, by hand, with their own tests and mutation proofs.

| Lane | Files read | Confirmed | Killed |
|---|---|---|---|
| CRM / Operations | 43 | 7 | 1 |
| Proposal / Customer | 28 | 8 | 0 |
| Marketplace | 42 | 6 | 2 |
| Site Survey / Field | 36 | 3 | 5 |
| Homeowner Portal | 25 | 8 | 0 |
| Admin / Operational Health | 28 | 6 | 1 |
| Procurement / BOM | 21 | 7 | 1 |
| Finance / Pricing | 27 | 4 | 2 |
| Enterprise / Multi-tenant | 42 | 4 | 4 |


---

## CRM / Operations

> The CRM/ops lane has two parallel stage authorities and a dead central one. `projects.project_status` (the 13-stage `PROJECT_PIPELINE` in lib/operations/pipeline.ts) is the stage the installer sees on the Operations kanban and the project Operations tab; `projects.homeowner_stage` (7 stages) plus `project_micro_stages` (34 micro-stages) is what the homeowner portal renders. The route that was built to keep them in sync — `POST /api/projects/transition`, whose own docblock says "The ONLY authorised path for changing a project's pipeline stage. No UI component may call update-status" — has ZERO callers outside tests, so all five stage-change surfaces call `/api/projects/update-status`, which writes only the two status columns: no activity row, no homeowner-stage sync, no micro-stage. Consequently the 636-line `lib/deals/transitions.ts` state machine is unreachable, `syncHomeownerStage` never runs, and the sold/survey/permit/install/inspection/PTO transitions never propagate to the homeowner. Separately, the proposal→sold handoff is broken at the SQL level: the signature path writes a column that does not exist. Verdict: the sales half (lead→proposal) and the ops half (stage dropdown→tasks) each work in isolation; every seam between them leaks, and three user-facing buttons do nothing.

### Proposal signature writes projects.stage — a column that does not exist — so a signed contract never advances the ops pipeline

`app/api/proposals/[id]/sign/route.ts`:242 — shape: `lost-handoff`, confidence: high

**Consequence.** When a homeowner signs the proposal, the installer's Operations board never moves. project_status stays where it was (default 'lead', app/api/migrate/route.ts:828), contract_signed_at is never stamped, generateTasksForStage never runs, and the two auto-generated commands that gate on `stage === 'contract_signed'` (lib/commands/generateActions.ts:70 schedule_install, :82 engineering_review) never appear. The installer sees a signed contract in the proposal view and a Lead on the pipeline, with no error anywhere.

**Smallest repair.** Replace the write with `project_status`/`status` via the real stage machine (call the same code path as update-status, or POST /api/projects/transition with action `contract_signed`), and remove the bare catch so a column error surfaces instead of being swallowed.

### Creating a proposal advances only the legacy status column, so the project stays in the Lead column of the Operations kanban

`app/api/proposals/route.ts`:201 — shape: `fake-status`, confidence: high

**Consequence.** A project with a generated and shared proposal renders in the 'Lead' kanban column and in Pipeline Control's lead count, while the same project shows 'Proposal' in the legacy sales list — two numbers for the same deal on the same dashboard. It also suppresses the follow-up nag: lib/commands/generateActions.ts:58 fires only for `stage === 'proposal_sent'`, so no 'Follow up with <client>' command is ever generated for a real sent proposal.

**Smallest repair.** Have POST /api/proposals (and the share route) advance the stage through the one stage writer so `project_status` becomes `proposal_sent` and `status` stays derived from it, rather than writing the legacy column directly.

### ✅ **FIXED** (`ca3c05ce`) — syncHomeownerStage's only caller is a route with zero callers, so the homeowner portal never advances past whatever was set by hand

`lib/homeownerStageSync.ts`:65 — shape: `lost-handoff`, confidence: high

**Consequence.** The homeowner's portal roadmap is frozen at whatever the proposal share/sign path or a manual override last set. An installer who moves a project through Permit Submitted → Permit Approved → Install Scheduled → Installation → PTO → Complete on the Operations board changes nothing the homeowner sees: the portal still says 'Proposal'. The mapping table at lib/homeownerStageSync.ts:43-53 that exists precisely to translate those events is never executed.

**Smallest repair.** Either move the UI onto /api/projects/transition (its stated contract) or call syncHomeownerStage + writeMicroStage from update-status; do not leave two stage writers where only the unused one propagates.

### The dashboard's three headline CTAs open the stage-decision modal and navigate away in the same click, so the modal never renders

`app/dashboard/page.tsx`:176 — shape: `dead-action`, confidence: high

**Consequence.** Clicking 'Resolve Now' on the pulsing red Critical Actions card — the dashboard's most prominent call to action — just lands the user on /projects?status=proposal. The DealDecisionModal that the handler selected a specific stale project for is set into state and thrown away on the same tick. Same for 'Follow Up' and 'Advance'.

**Smallest repair.** Give CommandCard an `onCtaClick?: (e: React.MouseEvent) => void` and have the dashboard call `e.preventDefault()` when it opens the modal, falling through to the href only when there is no target project.

### Execute on an auto-generated inspection command marks it done and schedules nothing, and it regenerates forever

`app/dashboard/page.tsx`:896 — shape: `dead-action`, confidence: high

**Consequence.** The installer presses Execute on 'Schedule inspection for <client>', gets 'Action completed ✓', and no inspection exists anywhere — no project_schedule row, no stage change, no audit entry. The card reappears after the next command generation, so the same non-action can be 'completed' indefinitely and nobody notices the inspection was never booked.

**Smallest repair.** Either give 'inspection' a real modal that files a project_schedule row of type 'inspection' and moves the stage, or stop generating a command whose Execute path is a no-op.

### Two of the five stage-change surfaces write no audit row, so the project timeline is missing every change made from the decision modal or the Operations tab

`components/deals/DealDecisionModal.tsx`:160 — shape: `lost-handoff`, confidence: high

**Consequence.** DealDecisionModal is documented at components/deals/DealDecisionModal.tsx:3-7 and app/dashboard/page.tsx:875 as the 'single decision surface for all stage transitions', yet stage changes made through it leave no trace: the admin project timeline shows nothing, so 'who moved this to Permit Approved, and when' is unanswerable for the majority of transitions. The same is true of every change made from the project page's Pipeline Status dropdown. And where a row does exist for an engineering move, its from_stage may be a fabricated 'contract_signed'.

**Smallest repair.** Write the project_activity row inside update-status (it already knows prevStage from the ownership SELECT) instead of relying on each of five callers to remember, and derive from_stage from the row it read rather than a literal.

### days_in_stage and stall detection are computed from projects.updated_at, which 20+ unrelated writers bump

`app/dashboard/page.tsx`:396 — shape: `fabricated-absence`, confidence: high

**Consequence.** A project genuinely parked in permit_submitted for six weeks reports 0 days and never turns red, as long as anyone saved a layout, edited a note or uploaded a bill in the meantime — including writes the system makes to itself. The follow-up engine goes with it: rule 4 (lib/commands/generateActions.ts:94, permit_submitted + daysStale >= 5) never fires for an actively-edited project, so the AHJ chase-up command is never created. Where a card does appear, its text asserts a false date — 'Proposal sent 7d ago with no response' (:62) is really 'nothing has touched this row for 7d'.

**Smallest repair.** Add a `stage_changed_at` column stamped by the one stage writer and compute days-in-stage from it; keep updated_at for 'last touched' and label it that way where it is genuinely what is meant.


---

## Proposal / Customer

> The canonical money path is genuinely good and the §25D repeal is honoured where it counts. `lib/proposal/buildCanonicalProposal.ts` is the single calculator (panel -> production -> utility -> financial -> 25yr -> offset -> policy), it gates every ITC read through `isItcEnabled()`/`guardItcValue()` (lines 714-729), `lib/incentives/stateIncentives.ts:1305` sets `federalItcRate = isResidential ? 0 : 30`, `lib/db/pricing.ts:72` gates the residential rate on the authority rather than a literal, and `app/api/production/route.ts:91` no longer uses the legacy `taxCreditRate`. I found NO place where a residential federal credit percentage still multiplies into a customer-facing dollar figure. The damage has moved from the arithmetic to the surfaces around it: the installer-facing proposal toolbar still carries a live "ITC: On" badge and a "Remove Federal ITC?" dialog that asserts "The 30% Investment Tax Credit is a significant financial benefit for the homeowner" and that removing it "will increase the net cost by ~30%" — a control that cannot change a single number and a claim the product's own authority calls repealed; the customer-facing proposal renders an ungated "Tax credit (0%) / -$0 / federal ITC applied" tile; and the proposal email's "Total investment" comes from `costEstimate.netCost`, the one field that still subtracts an ungated commercial 30%. Separately, proposal STATE is split in two: every homeowner-side write (view, sign) lands on the `proposals.status` column while the only reader the installer's list uses is `data_json.status`, so an executed contract reads "Draft" forever and the 409 guard stops the installer from fixing it; and the customer view never restores its own signed state. Verdict: the calculator is healthy, the lane around it is not. One latent hazard worth noting but not filed as a finding: `lib/enrichment/solarEnricher.ts:112` still hardcodes `const ITC_RATE = 0.30` and writes `federal_itc_amount`/`estimated_system_cost_net`/`payback_period_years` to `network_opportunities` (lines 289-293) — a repo-wide rg for those three column names found no reader outside the enricher and the migrate DDL, so nobody sees it today, but it is a loaded gun on the exact theme.

### "ITC: On" badge and a "Remove Federal ITC?" dialog for a credit that cannot exist

`app/proposals/page.tsx`:1775 — shape: `dead-action`, confidence: high

**Consequence.** Every sales rep opening any proposal preview sees a green "✓ ITC: On" badge whose tooltip says "ITC shown", and if they touch it a dialog tells them the homeowner is getting a 30% federal tax credit worth ~30% of net cost. Both statements are false for every residential proposal in the product — the rendered proposal contains itcRate 0 / itcAmount $0 / netCost = gross. The rep can verbally promise a $9,000 credit on a $30,000 system on the strength of the UI, and flipping the toggle either way changes nothing in the document, so there is no way to discover the lie from the screen.

**Smallest repair.** Gate the whole control on `isItcEnabled()` — when it is false, render nothing (or a static "Federal residential ITC: repealed (P.L. 119-21)" note) instead of a two-state toggle, and delete the modal's 30% prose. Extend tests/repealedItcNeverReachesAQuote.test.ts to assert the string "30% Investment Tax Credit" and the label "ITC: On" do not appear in app/proposals/page.tsx.

### Proposal status has two homes: signing writes the column, the installer list reads data_json

`app/api/proposals/route.ts`:28 — shape: `fake-status`, confidence: high

**Consequence.** A homeowner signs the proposal. The column says 'accepted', signed_at is set, the installer gets the signed email — and the installer's Proposals list still shows the row as "Draft" (app/proposals/page.tsx:1063 `<StatusBadge status={proposal.status} />`, colour-coding at :1005-1016 tests `=== 'accepted'` and never matches). The status filter (:653) and the pill counts (:677-678) agree with the wrong value, so filtering by Signed/Accepted returns an empty list even though contracts have been executed. The installer then tries to set it manually and gets a 409 telling them the status is frozen — so the pipeline view permanently misreports every executed contract as an unsent draft. A homeowner merely opening the link has the same effect for 'viewed'.

**Smallest repair.** Pick the column as the authority and make `rowToProposal` read it: `status: (row.status as Proposal['status']) ?? (dj.status as Proposal['status']) ?? 'draft'` — then convert the installer-side writers (PATCH merge, bulk `jsonb_set('{status}')`) to write the column too, leaving data_json.status only as a legacy fallback for pre-column rows. Archive already correctly lives on `data_json.archivedAt` and should stay there.

### A homeowner who signed sees "Sign & Accept" again, and signing again is refused

`app/proposals/view/[id]/page.tsx`:83 — shape: `dead-action`, confidence: high

**Consequence.** A homeowner who signs, closes the tab and comes back to their own share link (or forwards it to a spouse) is shown no evidence they ever signed — no signed banner, no signer name, no date — and is invited to sign again. Retyping their name and agreeing to the terms produces a hard error, "Proposal has already been signed." The homeowner cannot tell whether their contract was recorded, and the installer gets a support call on the highest-stakes screen in the product.

**Smallest repair.** Seed the state from the loaded row: after `setProposal(proposal)`, `setAccepted(Boolean(raw.signed_at) || raw.status === 'accepted' || Boolean(dataJson.signature))` and `setSignerName(dataJson.signature?.signerName ?? raw.signer_name ?? '')`. Also move `status: raw.status || dataJson.status || 'sent'` AFTER the `...dataJson` spread so the column is not clobbered.

### Customer proposal prints "Tax credit (0%) −$0 … federal ITC applied" on every project

`components/proposal/CashFlowStoryCard.tsx`:105 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** Every homeowner who opens their proposal link sees a dedicated emerald tile reading "Tax credit (0%) / −$0 / federal ITC applied" sitting next to "Net cost … after incentives" that equals the gross price. It asserts a federal ITC was applied when none exists and none can, invites the obvious question "why is my tax credit zero?", and undercuts the proposal at the exact moment it is trying to close. (Latent companion, same value: lib/proposal/renderProposalHTML.ts:472, :632 and :738 format the same field as `fmtPct(f.itcRate * 100)` while :475 correctly treats `f.financeApr` as a decimal — `itcRate` is already a percent, so those rows would print "3000%" the day any ITC is enabled. Unreachable today because `itcEnabled` is false.)

**Smallest repair.** Wrap the tax-credit tile in `{financial.itcRate > 0 ? (...) : null}` (or gate on `isItcEnabled()`), and change the Net cost sub-caption to a neutral "total investment" when `itcAmount === 0`. Separately fix the three `f.itcRate * 100` sites in renderProposalHTML.ts to `fmtPct(f.itcRate)`.

### Installer proposal (and the PDF taken from it) prints two different SREC contract totals

`app/proposals/page.tsx`:2245 — shape: `fake-status`, confidence: high

**Consequence.** On one screen the homeowner is shown "Estimated total contract value: $20,400" in the SREC section and "Illinois Shines (Adjustable Block Program) ~$16,970" in the Additional State Benefits card — a ~$3,400 disagreement about the same REC contract, in the same document. Because the download button screenshots this DOM (app/proposals/page.tsx:355-358 `generateProposalPDF(proposal)` reading `#proposal-document`, declared at :1811), the contradiction ships in the PDF the rep emails. The canonical number is also the one inside the 25-yr savings headline and the break-even year, so the smaller card number makes the payback look unsupported.

**Smallest repair.** Port the view page's branch into app/proposals/page.tsx:2244 verbatim — for `inc.type === 'srec'` (and 'trec') print `cp.truth25yr.srec_income_25yr` when it is > 0 and never `inc.calculatedValue`. Better: have `calculateIncentives` stop emitting a dollar value for srec/trec at all and let the canonical projection be the only SREC number in existence.

### The proposal email's savings line can never render — it reads annualSavings off the wrong object

`app/api/proposals/[id]/send-email/route.ts`:114 — shape: `field-no-writer`, confidence: high

**Consequence.** Every "Send to client" email a rep sends omits the savings figure entirely — the homeowner gets the kW size and the "Total investment" dollar amount with no counterweight, so the first thing they read about their proposal is a large price and no benefit. The rep has no way to notice: the template silently drops the line rather than printing $0, so the email looks intentionally designed that way.

**Smallest repair.** Read it from the object that has it and prefer the canonical figure: `const annualSavings = Number(cost?.annualSavings) || 0;` as a minimum, or (better) build the CanonicalProposal the way app/api/proposals/[id]/pdf/route.ts:171-220 already does and send `cp.financial.annualEnergyValue`, so the email and the proposal quote the same number.

### Proposal email's "Total investment" is costEstimate.netCost, the one figure that still subtracts an ungated 30%

`app/api/proposals/[id]/send-email/route.ts`:115 — shape: `fake-status`, confidence: medium

**Consequence.** With the admin pricing config in commercial mode (`pricing_config.is_commercial = true`, a global flag read at lib/db/pricing.ts:45 and consumed as `pricingCfg?.isCommercial` at app/proposals/page.tsx:1368), the emailed "Total investment" is 70% of the price the proposal it links to shows — a $100,000 system is announced as $70,000 in the email and priced at $100,000 on the page, with a company-level credit passed off as the homeowner's discount. Independently of that, whenever the panel spec changed after the layout was drawn the email states a kW figure the pipeline has already flagged as the wrong basis, so the email and the proposal disagree about system size.

**Smallest repair.** Build the CanonicalProposal in the send-email route (the PDF route already does exactly this at app/api/proposals/[id]/pdf/route.ts:171-220) and send `cp.panel.systemSizeKw`, `cp.financial.annualEnergyValue` and `cp.financial.netCost`. Separately, route the commercial read through the authority: `itcRateCommercial: isSection48eEnabled() ? ((row.itc_rate_commercial as number) ?? 30) : 0`, and stop subtracting a company-level credit from a homeowner-facing `netCost` at app/api/production/route.ts:91.

### Server PDF route loses the cash/finance choice and the resolved system type

`app/api/proposals/[id]/pdf/route.ts`:168 — shape: `lost-handoff`, confidence: medium

**Consequence.** Anyone fetching /api/proposals/[id]/pdf (the route is public with a share token — middleware.ts:37 exempts it) gets a document that contradicts the on-screen proposal: a cash buyer's PDF shows a 25-year 7.99% loan payment and a monthly total built on it, and a fence/ground/carport project whose `projects.system_type` is null is labelled "Roof Mount", priced at the roof $/W when no cash price is stored, and degraded at the roof rate for all 25 years — and for a fence project with no selectedPanel the default panel is never injected, so the PDF's system size differs from the page's. Confidence is medium on reach, not on mechanism: no in-app button currently points here (both download paths use the client-side lib/proposalPDF.ts DOM capture), so today this bites direct/API callers and anyone who wires the route up.

**Smallest repair.** Persist the rep's choice (write `purchaseMode` into `data_json` on the proposal, or accept it as a query/body param on the PDF route) and branch the renderer on `cp._meta.purchaseMode` so the finance rows are omitted in cash mode. Replace :166 with `resolveProposalSystemType({ panels: layout?.panels, layoutSystemType: layout?.systemType, projSystemType: (proj as any).systemType, projectName: (proj as any).name })` and drive :799 off that resolved value, not `project?.systemType`.


---

## Marketplace

> The lane is built in two eras that never reconciled. `network_opportunities` has two disjoint column vocabularies: the canonical one (`location_city/location_state`, `homeowner_name`, `marketplace_status/claim_mode/claim_count`, `asking_price`) supplied only by the governed chain in `lib/migrations/` (047+054+062+072+088 — and `lib/migrations/manifest.ts:18` states the legacy `migrations/` dir is NOT scanned), and a legacy one (`state`, `city`, `listing_price`, `consent_given`, `is_duplicate_flagged`, `square_feet_living`, `monthly_bill`, `homeowner_first_name`) that exists ONLY in the secret-gated `app/api/migrate/route.ts` inline DDL and in NO migration file. I built the governed chain in PGlite in-process (same fixture recipe as tests/contractorPerformanceIsUnmeasured.test.ts) and executed the shipped query text: 175 SQL blocks across the lane, and the legacy-vocabulary ones fail with 42703. The live table must be the canonical shape, because the contractor-facing marketplace (feed, eligibility, checkout, claim, refund) depends on 072's `marketplace_status/claim_mode/claim_count`, and every other writer (marketplaceInventory.ts:291, admin opportunities create :179, simulator :200) writes canonical names — only the paid-acquisition intake, the screening pipeline, the admin screening route and the admin analytics geography block speak legacy. The consequence is that the lane is severed at both ends: nothing can legitimately enter the marketplace (the sole gate `screening_status='approved' | osq.auto_decision='pass' | override_decision='pass'` has exactly two writers, one of which throws before it writes and one of which can never emit 'pass'), and once a contractor does pay, a lost race refunds him while his browser says the lead is unlocked. What IS genuinely healthy: the claim/capacity mutation is properly atomic (conditional `UPDATE ... WHERE claim_count = 0` plus the partial unique index from 072), the refund-on-race is real and full, pre-claim projections correctly withhold contact and exact address (the `lat/lng` precision question is Ray's open decision, noted not reported), and the previously-repaired contractor-performance placeholder is honestly labelled. Verdict: the plumbing for selling a lead is sound; the plumbing for creating, releasing and reporting on one is not.

### Admin "Approve" and "Release to Marketplace" 500 before writing anything — the only live writer of the marketplace visibility gate

`app/api/admin/network/screening/route.ts`:211 — shape: `dead-action`, confidence: high

**Consequence.** An admin clicks Approve (or Release to Marketplace) on a screened lead and gets "Internal server error". Nothing is persisted — no override_decision, no screening_status, no status='live', no score, no grade, no asking_price, no opportunity_intelligence row. Because this is the only production writer of the feed's visibility gate, NO lead can be released to the contractor marketplace by any path: the bulk publish action (app/api/admin/network/opportunities/route.ts:266-279) refuses unless `releaseGate.approvedScreening` is already true, and the only thing that can be approved is the simulator's output, which the feed then excludes by its own `is_simulated = false` filter. Contractors see an empty Discover tab forever.

**Smallest repair.** Drop `listing_price` from the UPDATE at :211 (keep `asking_price`, the column every reader actually uses — preview :54, territory :218, leadPurchase :64). Then either wrap `scoreAndPersistOpportunity` so a scoring failure cannot veto the release write, or move it after the screening_status/status writes.

### The 10-step screening pipeline reads a column vocabulary the table does not have, so every lead auto-fails "invalid_address, outside_service_area"

`lib/network/screeningPipeline.ts`:201 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** Every lead the operator screens comes back `auto_decision='fail'`, reason "Failed: invalid_address, outside_service_area", grade F — including a lead with a perfect Illinois address, because the pipeline is reading `state` while intake wrote `location_state`. Since `auto_decision='pass'` is one of the two ways to open the marketplace gate and the other one 500s (finding 1), automated release is unreachable. The screening record simultaneously asserts "in service area: true, 0 active contractors nearby" for every lead, which is a claim, not a measurement.

**Smallest repair.** Map the SELECT to the canonical names (`no.location_state AS state`, `no.location_city AS city`, `no.monthly_bill_amount AS monthly_bill`, `no.utility_provider AS utility_name`, `no.homeowner_name`) instead of `SELECT *`, fix `:146` to `location_state` and `:235` to `network_active`, and make step 4 persist NULL + a `supported:false` flag rather than `?? true` / `?? 0`.

### Every paid-acquisition webhook lead fails to insert — five non-existent columns plus a status the CHECK constraint forbids

`lib/intake/intakePipeline.ts`:223 — shape: `dead-action`, confidence: high

**Consequence.** Every Google Ads, Meta and partner-webhook lead delivery is accepted, logged as an intake event, and then produces no opportunity row at all — the provider gets a response while `webhook_ingestion_log` never reaches 'processed' and marketplace inventory stays empty. Paid acquisition spend generates zero sellable leads, and the only visible trace is a console warning that misattributes the cause to a pending migration 089.

**Smallest repair.** Rewrite both INSERTs against the canonical columns (`location_city/location_state/location_zip`, `duplicate_flag`, drop `square_feet_living`→`square_feet`, move `consent_given`/`notes` into `intake_metadata` jsonb) and use `status='intake'`. Narrow the `catch (colErr)` at :261 to the idempotency-key error only, so a schema mismatch surfaces instead of masquerading as a pending migration.

### A contractor who loses the claim race is refunded and told "Payment received — lead unlocked"

`lib/network/leadPurchase.ts`:145 — shape: `fake-status`, confidence: high

**Consequence.** Two contractors check out for the same exclusive lead seconds apart. The loser is charged, silently refunded, redirected to /network, and shown a green toast saying the lead is unlocked and the address is in My Claims — where there is nothing. He has no record of the refund and no reason to believe one happened, so the support ticket is "I paid and you didn't give me the lead". If the Stripe refund itself fails, the row still asserts `payment_status='refunded'` with an amount and a timestamp, so the money is kept while the database says it was returned, and only a server log knows.

**Smallest repair.** Make the outcome addressable: `success_url` → `/network?session=<checkout_session_id>`, and have the page poll a small endpoint that reads the assignment for that payment_intent and renders unlocked / refunded-because-taken. Reverse the refund order (call Stripe first, write `refunded` only on success, otherwise write `refund_pending` and alert).

### Admin "Campaign Intel" tab is permanently stuck on "Loading analytics…" — one phantom column 500s all six sections

`app/api/admin/network/analytics/route.ts`:103 — shape: `dead-action`, confidence: high

**Consequence.** Every admin who opens Network → Campaign Intel sees an eternal "Loading analytics…" with no error: no conversion funnel, no screen/claim/win rates, no source performance, no campaign CPL, no grade distribution, no volume trend. Five perfectly good SQL blocks are invisible because the sixth names a column that has never existed.

**Smallest repair.** `no.state` → `no.location_state` in all three places (:103, :111, :112). Consider per-section try/catch so one dead block can no longer black out the tab.

### Admin screening queue 500s and the UI renders it as an EMPTY queue with zero stats

`app/api/admin/network/screening/route.ts`:50 — shape: `fabricated-absence`, confidence: high

**Consequence.** The operator opens the Screening tab and is shown a queue with no rows and counters at zero — i.e. the affirmative statement "there is nothing waiting to be screened" — while leads sit in opportunity_screening_queue. An outage is rendered as an all-clear, which is strictly worse than an error banner: nobody investigates.

**Smallest repair.** Select `no.homeowner_name` (or split it), `no.location_city`, `no.location_state`. Separately, have loadQueue check `res.ok`/`data.success` and surface a failure state instead of coercing it to an empty queue.


---

## Site Survey / Field

> The field app is a 6-step JWT-token web form at `app/survey/[token]/page.tsx` (site overview → roof → electrical → obstructions → photos → review). Photos upload one-at-a-time to `POST /api/survey/upload-photo` (blob only, no DB row), the draft autosaves to localStorage, and `POST /api/survey/submit` HMAC-signs the payload into the internal webhook `/api/webhooks/survey-complete`, which runs the ingest pipeline: `projects`, `project_physical_data` (21 columns via `transformLayer.extractPhysicalData`), `site_surveys` (full raw payload as `survey_data`), `site_survey_files` (label + capture GPS), `project_files`. Two parts of this lane are genuinely strong and I want to say so explicitly: (a) readiness is PESSIMISTIC, not optimistic — `lib/survey/v2/fieldReadiness.ts` reuses the one Engineering Requirement Registry, renders any requirement it cannot determine as `unknown`, and `countOutstanding` treats `unknown` as outstanding, so a silent all-clear is structurally prevented; and (b) provenance is real — inspector name, survey created-at, per-photo capture timestamp and per-photo device GPS all survive to the office page and to `EvidenceMetadataCompleteness`, and photo GPS genuinely reaches the PV-1 equipment markers (`app/api/engineering/permit/route.ts:1605-1621`). The failure is on the CONSUMPTION side, and it is the headline shape the brief predicted: the survey reaches the database reliably and then dies there. Three separate survey→engineering integration layers compute a result and discard it (`applyToSystemDefinition`'s `definition`, `permitIntegration`'s entire `sheetData`, both compliance `surveyNotes` arrays), the Step-4 obstruction list is 100% dropped by the normalizer because the field schema has no coordinates, and the operator dashboard that is supposed to reveal exactly this is hardcoded to a type-level `false`. One caveat on required evidence: the app has a single fixed 5-photo required set (`REQUIRED_PHOTO_CATEGORIES`) and no job-specific requirement resolution — a battery or ground-mount job has no capture slot at all — but the readiness engine reports those honestly as `unknown`/uncapturable rather than faking them. Verdict: capture and persistence healthy; provenance healthy; readiness honest; downstream consumption substantially broken.

### "Saved HH:MM" indicator is never sourced from an actual save

`lib/survey/v2/defaults.ts`:188 — shape: `fake-status`, confidence: high

**Consequence.** A surveyor works for 40 minutes across five steps. The header says 'Saved 09:14' the entire time — the moment they opened the link — so they cannot tell whether their last ten minutes of answers were persisted. On a device where localStorage throws (Safari private browsing, storage full, site data blocked) the header still reads 'Saved 09:14' while nothing has ever been written; the crew backgrounds the app or the tab reloads, loadDraft returns null, and the whole survey restarts from blank with the UI having reported success the entire time.

**Smallest repair.** Have saveDraft return a boolean (or the persisted timestamp) and have the page commit it into state on success, so the header renders a real last-write time; on a caught storage error set an explicit 'Not saved on this device — do not close this page' state instead of showing 'Saved'.

### One photo slot per category, while the slot's own instruction demands one photo per obstruction

`components/survey/ui/PhotoSlot.tsx`:77 — shape: `dead-action`, confidence: high

**Consequence.** The app tells the crew on screen to photograph each obstruction individually, then physically prevents it: after the first obstruction photo the slot is inert and tapping it does nothing (no error, no explanation). A roof with a chimney, an HVAC unit and two vents ships one obstruction photo, and the engineer reviewing the survey sees a single image that the evidence mapper has labelled with the first list entry's type — so the photo can be attributed to the wrong obstruction outright. Photos in this lane bind to a project and a category only, never to a system object.

**Smallest repair.** Make 'obstruction' and 'additional' repeatable slots (render N filled slots plus one empty 'add another'), add an optional `obstructionId` (and later `roofPlaneId`) to SurveyPhoto so Step 4 items and Step 5 photos link, and drop the `obstructions[0]` shortcut in surveyEvidence.ts in favour of that link.

### Admin survey-integration dashboard is hardcoded to a type-level `false` and cannot ever go green

`lib/topography/getTopographyState.ts`:433 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** Every project, forever, shows three permanently red 'NOT wired' nodes on the /admin/topography Site Survey Integration map. An engineer or ops user reading it concludes the field survey does not affect the permit — while the surveyed roof type, roof pitch, rafter size/spacing, main panel amps, panel brand, meter type, interconnection method and bus rating are in fact overriding the design values on the plan set at permit/route.ts:1236-1247. The one dashboard built to answer 'did the survey reach engineering?' gives the wrong answer unconditionally, which both hides the real gaps (findings 1-3) and invites someone to distrust correct survey-driven permit values.

**Smallest repair.** Widen the three fields to `boolean` and compute them from observable state (e.g. presence of the survey-sourced values on the generated permit input / the '[permit/survey] project.X = ... (survey)' merge result and context.overriddenFields), rather than hardcoding a literal with a comment asserting a call-site count that has since changed.


---

## Homeowner Portal

> The homeowner portal is one page (app/portal/dashboard/page.tsx, 1418 lines) fed by one read route (app/api/portal/dashboard/route.ts) behind an email-OTP session. It correctly reads `projects.homeowner_stage` rather than the internal `project_status`, and it deliberately excludes internal ops files, so the two classic leaks for this lane (internal jargon, internal documents) are genuinely closed — and the install-date and monitoring-tile work shows a previous pass already removed placeholder furniture. The rot is one layer down, in what WRITES the portal's authority. `homeowner_stage` has five writers; the only one with a governing test (`/api/projects/transition`) has zero callers, and the two that real UI calls both record a phase's MILESTONE as having happened merely because someone selected that phase — which the portal then renders to the customer as a dated fact ("Your utility bill was received", "Installation crew arrived at your home", "You signed — you're locked in!"). The same admin click also emails the homeowner copy that contradicts the portal page it links to. Separately, the homeowner's uploaded utility bill is parsed and then thrown away, with a JSON summary filed under its name; the document vault's download control is not a control and no endpoint exists to serve one; and the referral link the portal tells customers to share is read by nothing. Verdict: the read path is healthy and thoughtfully built; the write path and the outbound surfaces around it are not, and the portal's most confident statements are the least true.

### Portal bill upload discards the homeowner's actual bill and files a JSON summary under its name

`app/api/portal/bill-upload/route.ts`:145 — shape: `lost-handoff`, confidence: high

**Consequence.** A homeowner uploads their electric bill PDF through the portal. The portal answers "Utility bill received ✓" and lists "Utility Bill" in Your Documents. The PDF is gone — only five parsed fields survive. When the parse is wrong (the route itself returns a `confidence` field), nobody can check the original: the installer opens the row his own engineering page labels "Original Utility Bill" and gets a 200-byte JSON blob. The homeowner cannot re-upload either — app/api/portal/bill-upload/route.ts:78-90 returns `alreadyExists: true` for any second attempt, and the portal hides the upload control once the row exists. The system is then sized from an unverifiable number.

**Smallest repair.** In app/api/portal/bill-upload/route.ts, store the uploaded bytes before/alongside the summary — reuse lib/intake/utilityBillAttachment.ts `storeUtilityBillAttachment` (blob) or insert a second project_files row carrying `file_data` with the original mime type and filename, and name the summary row `Bill_Data_…json` so app/engineering/page.tsx:17676 classifies it as "Bill Data" rather than "Original Utility Bill".

### Admin "Save Stage" fabricates homeowner milestones: entering a phase is recorded as the phase's outcome

`app/api/admin/projects/[id]/route.ts`:216 — shape: `fake-status`, confidence: high

**Consequence.** One admin click writes a customer-visible lie. Moving a project to "Under Review" tells the homeowner "Your utility bill was received" — on the same screen that is still asking them to upload it, because billUploaded comes from project_files (app/portal/dashboard/page.tsx:947-952), not micro-stages. Moving to "Home Visit" tells them "Site visit report submitted" while the stage card says a technician *will* visit and "We'll reach out to confirm your appointment time" (:230-237). Moving to "Installation" tells them "Installation crew arrived at your home" while the card says "We're handling permits and lining up your installation crew" (:254-261). The homeowner reads two contradictory accounts of their own project in one page, and the feed's version is the one with a date on it.

**Smallest repair.** Delete HOMEOWNER_TO_MICRO_OVERRIDE and let the manual stage change be recorded only where it belongs — project_homeowner_stage_history, already written at :205-210 and already surfaced as "Milestone reached: …" by app/portal/dashboard/page.tsx:475-478. If an audit row is wanted, add a non-outcome vocabulary value (e.g. `stage_set_manually`) that MICRO_STAGE_ACTIVITY does not translate. Then widen tests/stageEntryIsNotAnOutcome.test.ts to scan every file that calls writeMicroStage, not just the zero-caller route.

### Setting the portal stage to "Installation" tells the homeowner they signed a contract

`app/api/projects/[id]/homeowner-stage/route.ts`:192 — shape: `fake-status`, confidence: high

**Consequence.** An installer advancing a customer to the Installation phase makes the customer's own portal state, with today's date, that the customer signed the agreement — even on a project where no proposal was ever sent, let alone executed. The adjacent "Proposal Signed ✓" block is driven by `proposals.signed_at` (app/portal/dashboard/page.tsx:1257-1272) and stays absent, so the portal simultaneously asserts a signature in the activity feed and shows none in the proposal card. A customer who disputes a contract has been handed a screenshot of the vendor's own system claiming they signed.

**Smallest repair.** Remove the `installation: 'contract_signed'` entry (an installer selecting a phase is not a customer signature) and, if a milestone is wanted there, use `permit_submitted`/`install_scheduled` only when the underlying fact exists. `contract_signed` should be written only by the signature path (app/api/proposals/[id]/sign) that sets `proposals.signed_at`.

### The stage-advance email contradicts the portal page it links to

`app/api/admin/projects/[id]/route.ts`:260 — shape: `fake-status`, confidence: high

**Consequence.** The homeowner gets an email saying the crew is on-site today, clicks the button in that email, and lands on a page saying the installation is still being planned and a date will follow — from one admin action, two minutes apart. After the install physically completes, the portal keeps telling them to "Watch for our call or email with scheduling details" through inspection and PTO, because no homeowner stage exists between installation and completed. This is precisely the "what is happening / what happens next" question the portal exists to answer.

**Smallest repair.** Make the email reuse the portal's STAGE_CONTENT instead of a second hardcoded table — lift STAGE_CONTENT into lib/ (e.g. lib/portal/stageContent.ts) and have both the page and app/api/admin/projects/[id]/route.ts read it. Separately, either add post-install homeowner stages (inspection / awaiting PTO) or derive the installation card's copy from the latest micro-stage rather than from the stage alone.

### "This is exactly what your customer sees" — a second hardcoded copy of the portal that differs in every stage

`app/admin/projects/[id]/portal-preview/page.tsx`:301 — shape: `fake-status`, confidence: high

**Consequence.** A rep on the phone with a customer opens the preview to see what the customer is looking at and is shown different words, a different step name, and none of the things the customer can actually act on. The customer has a "View & Sign Proposal" button and possibly a confirmed installation date on screen; the rep's "exactly what they see" view shows neither, so the rep tells the customer to watch for a call about a date the portal already gave them, or cannot tell whether the sign CTA is live.

**Smallest repair.** Delete the duplicated STAGE_CONTENT and render the preview from the same shared module and the same payload shape as the real portal (share the stage content in lib/ and have the preview call /api/portal/dashboard-equivalent data for that project). Until it renders the real components, drop the "exactly what they see" sentence.

### Document vault download icon is not a control, and no endpoint exists to serve the file

`app/portal/dashboard/page.tsx`:675 — shape: `dead-action`, confidence: high

**Consequence.** The homeowner sees their document listed under "Your Documents" with a download affordance next to it and clicks it repeatedly with nothing happening — no error, no spinner, no file. The portal's document section is therefore a list of names only: a customer who wants the copy of the bill they submitted, or wants to forward it, has to phone the installer, which is the exact call the portal is meant to prevent.

**Smallest repair.** Either remove the Download icon (a read-only list is honest), or add `id` to the dashboard payload and a `GET /api/portal/files/[id]` that checks getPortalSession, verifies the file's project belongs to session.clientId and its file_type is in ('utility_bill','portal_upload'), and streams file_data/file_url; then wrap the row in an anchor to it.

### The referral link the portal asks customers to share records nothing and lands on a login wall

`app/portal/dashboard/page.tsx`:703 — shape: `dead-action`, confidence: high

**Consequence.** A happy customer copies their referral link and sends it to a neighbour. The neighbour arrives at a homeowner-portal sign-in page asking for an email address that has no account, with no quote form and no path forward, and abandons. Nothing about the referral is recorded anywhere, so the installer never learns it happened and the referring customer is never credited — a revenue channel the UI promises and the system cannot deliver. Because of the stage-gate bug the card also never appears at install-scheduled, only after completion.

**Smallest repair.** Point the link at the public intake funnel that already handles attribution (`/free-solar-estimate?ref=…`, consumed by app/api/intake/homeowner → lib/network/attributionTracker.ts `referral_code`), pass the referring client's id rather than a first name, and persist it on the created lead. Fix the gate by testing micro-stages for install_scheduled (`projectMicros.some(m => m.micro_stage === 'install_scheduled')`) instead of comparing it to a HomeownerStage.

### Two different annual-production and CO2 numbers for the same system, on the same screen

`app/portal/dashboard/page.tsx`:329 — shape: `fake-status`, confidence: high

**Consequence.** Every completed-stage homeowner scrolls past two cards giving different answers to "how much will my system make?" and "how much CO2 do I offset?" — differing by 300 kWh/yr and 0.1 tons, with no indication which is right. The savings figure ($/yr at :331, derived from the 1400 number) is the one the customer quotes back when the true production, on the monitoring dashboard the same page links to, matches neither.

**Smallest repair.** Delete calcBenefits from app/portal/dashboard/page.tsx and have ProjectedBenefits call estimateAnnualKwh / estimateCo2Tons from lib/portal/production.ts, moving the savings rate into that module as a named export so one file holds every number the portal asserts.


---

## Admin / Operational Health

> The admin lane is two very different codebases. The security spine is genuinely healthy and I found nothing to report there: lib/adminAuth.ts never reads role from the JWT, fails closed on every error path, and enforces session invalidation on cache hits; /api/admin/users PATCH gates set_role AND the update-with-role escape hatch on super_admin (route.ts:135, :155) and audit-logs all 11 actions; system-tools, migrations and reconciliation are super_admin-gated, rate-limited and logged via lib/adminActivityLog.ts. Audit coverage of mutating admin routes is broad (companies, distributor-prices, document-registry, personnel, engineering-review, system-tools, users, reconciliation all call logAdminAction). The metrics/dashboard layer is the opposite: it is where every defect lives. Four of the six tiles on the System Health Monitor are literal constants; the Engineering Monitor renders six health numbers from a model built with zero inputs and drops the disclaimer that says so; two network routes select a column (`no.state`) that the canonical schema does not have, which silently 500s the Campaign Intel and Screening panels into a permanent "Loading…"/"Queue is empty"; and three separate tiles read response keys their own endpoint never emits, so they are pinned to 0. Verdict: permissions/audit healthy, operational-health reporting not trustworthy — an operator cannot currently distinguish "nothing wrong" from "nothing measured" on /admin/health, /admin/engineering, or the Network control center.

### System Health Monitor hardcodes 4 of 6 service statuses to 'ok' with invented latencies, so "All Systems Operational" cannot fail

`app/admin/health/page.tsx`:98 — shape: `fake-status`, confidence: high

**Consequence.** An admin opening /admin/health while file storage is unreachable, JWT verification is misconfigured, or the engineering/incentive engines are throwing sees a green banner reading "All Systems Operational", "6/6 services healthy", and four Operational badges with green latency gauges at 12/25/45/18 ms. The only faults the page can ever surface are a slow Neon batch or a slow HTTP round-trip; every other outage renders as healthy. Worse, the four fake values keep the banner green (line 160) during a partial outage, so the page actively suppresses the signal it exists to give.

**Smallest repair.** Either delete those four cards, or give each a real probe and render 'unknown' when no probe ran. Minimum honest fix: drop them from the `services` array so `overallStatus` and the "n/6 services healthy" count are computed only over the two subsystems actually measured (DB batch, API round-trip), and label the rest "not monitored".

### Campaign Intel tab is permanently stuck on "Loading analytics…" — the analytics query selects network_opportunities.state, a column the canonical schema does not have

`app/api/admin/network/analytics/route.ts`:103 — shape: `dead-action`, confidence: high

**Consequence.** The "Campaign Intel" tab of the Admin Network control center shows the spinner text "Loading analytics…" indefinitely, on every load, for every admin — no error, no empty state. The conversion funnel, source performance, CPL, geography, lead-quality grades and volume trend are unreachable. An operator concludes the page is slow or the marketplace has no data, when in fact the request 500s on every call. (If a legacy DB created by the inline DDL at app/api/migrate/route.ts:2382 — which does declare `state` — also received migration 062, the query resolves instead but `state` has no writer, so geography silently returns zero rows: absence indistinguishable from "no leads".)

**Smallest repair.** Change lines 103/111/112 to `no.location_state` (aliased `AS state` to keep the response key stable), matching the six sibling routes. Separately, split the handler's single try/catch per section so one bad section cannot take down five working ones.

### Screening Queue reports "Queue is empty" on a 500 — same missing `no.state` column, and the fetch never checks res.ok

`app/api/admin/network/screening/route.ts`:55 — shape: `fake-status`, confidence: high

**Consequence.** The marketplace Screening tab tells the operator "Queue is empty" and shows 0 in all five counters whenever this endpoint fails — which, on the canonical schema, is every time. Leads sitting in `pipeline_status='pending'` or `auto_decision='needs_review'` are invisible, so nobody screens them and nothing is ever released to the contractor marketplace. An operational backlog renders identically to a clean desk.

**Smallest repair.** Use `no.location_state AS state` at line 55. Independently, make loadQueue check `res.ok`/`data.success` and surface a failure state instead of substituting `[]` and `{}` — an empty queue and a broken query must not look the same.

### Two Screening Queue counters read response keys that endpoint never emits, so "Pending" and "Running" are permanently 0

`app/admin/network/page.tsx`:759 — shape: `field-no-writer`, confidence: high

**Consequence.** Even after the `no.state` bug above is fixed, the Screening panel's "Pending" and "Running" tiles display a bold 0 forever while "Auto Passed"/"Auto Failed"/"Needs Review" show real numbers. An operator reads "0 pending, 0 running" as a drained queue and stops checking, while rows with pipeline_status='pending' accumulate — the exact failure the tile exists to prevent.

**Smallest repair.** Read `stats.pending` and `stats.running`, or rename the SQL aliases in screening/route.ts:84-85 to `pending_screening`/`running_screening` so the two endpoints share one vocabulary. Prefer one shared shape, since /network/health already publishes the `*_screening` names.

### Admin dashboard's "Engineering Runs" always reads "0 in last 30 days" — /api/admin/stats never computes last30 for layouts

`app/admin/page.tsx`:128 — shape: `field-no-writer`, confidence: high

**Consequence.** Every admin loading /admin ("System Overview — Real-time platform health and activity") sees the Engineering Runs card claim "0 in last 30 days" beside a non-zero all-time total, no matter how many layouts were generated this month. Engineering-run velocity — the one number that says whether the core engine is being used — reads as flatlined at zero permanently, sitting next to three neighbouring cards whose 30-day figures are real, which makes the zero look measured.

**Smallest repair.** Add the same `SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS last30` to the layouts query at route.ts:30 and emit it at line 60 (confirm `layouts.created_at` exists first). If layouts has no usable timestamp, remove the sub-line rather than printing a zero.

### Billing MRR, Active subs and "Total subs" are computed over only the first Stripe page, so the totals silently cap at 100

`app/api/admin/billing/route.ts`:31 — shape: `fake-status`, confidence: medium

**Consequence.** Once the account passes 100 Stripe subscription objects (including cancelled ones — `status:"all"` means churned subs consume page slots long before 100 paying customers exist), the MRR tile silently understates revenue, "Extra seats sold" undercounts, and "Total subs" freezes at exactly 100 and never moves again. There is no banner, no partial-data flag and no error: the dashboard keeps rendering a confident dollar figure that is arithmetic over an arbitrary subset. Because cancelled subscriptions count toward the cap, the undercount arrives earlier than the number 100 suggests.

**Smallest repair.** Page through with `stripe.subscriptions.list(...).autoPagingEach()` (or loop on `has_more` + `starting_after`), or narrow to `status:'active'`/`'trialing'` so the cap is not burned on churn. Until it pages, return `has_more` and render "100+ (partial)" instead of a bare total.


---

## Procurement / BOM

> The PERMIT half of this lane is genuinely strong and I found nothing new to report there: lib/permit/utils/bomForPermit.ts + lib/bom-types-v4.ts implement one per-row ProcurementAuthorityState, one content-derived bomLineId (lib/bom/bomLineId.ts), a fail-closed classifier, and buildProcurementApproval/orderableProcurementExport as the single export gate — and the state, its reason and its producer facts are carried across every type boundary. The remaining substring-match equipment resolution in resolveRegistryEntry (bomForPermit.ts:195-208) is an explicitly declared, named follow-up, so I have not counted it. The ESTIMATING half is where the lane breaks. There is no order/supplier stage (deliberate, not reported), but the internal authority that would feed one is not ready: the whole DB price-override authority is unreachable and, where reachable, inverted; the engineering BOM has no staleness invalidation even though the SLD beside it does, and the stale copy is auto-persisted to Client Files; the persisted procurement CSV drops every part number and every price; a second racking BOM with conflicting IronRidge SKUs is computed and discarded; and the customer-signed proposal asserts a 25-year panel warranty from a hardcoded string while the real per-module warranty sits on the record. Verdict: permit-side procurement authority healthy, estimating/quoting side unhealthy.

### Admin Distributor Pricing page crashes on load — response key is `categoryFallbacks`, page reads `data.fallbacks`

`app/admin/distributor-prices/page.tsx`:264 — shape: `dead-action`, confidence: high

**Consequence.** Any admin who clicks "Distributor Prices" in the admin sidebar (app/admin/AdminShell.tsx:51) gets a render-time TypeError ("Cannot read properties of undefined (reading 'length')") the moment the fetch resolves — the entire screen is unusable. That screen is the only UI for the distributor_prices table, which is the top-priority price authority for every BOM dollar figure, the $/W KPI and the BOM Cost tile on the engineering page. So nobody can view, add, edit or remove a single price override.

**Smallest repair.** Read `data.categoryFallbacks` and convert the Record to entries (`Object.entries(...).map(([category, v]) => ({ category, unitCost: v.unitCost }))`) before using `.length`/`.map`, and have the route's catalog mapping emit a resolved `unitCost` (via `resolveUnitCost`) alongside listPrice/netPrice so the catalog table and the avg stat stop rendering NaN.

### Price-override save and delete can never succeed — page sends camelCase, API requires snake_case; delete sends a query param, API reads a JSON body

`app/admin/distributor-prices/page.tsx`:200 — shape: `dead-action`, confidence: high

**Consequence.** Even after the page crash above is fixed, the Add/Edit modal always fails with the toast "part_number is required" and the trash button always fails with "HTTP 400". distributor_prices can therefore only ever contain the 22 rows migration 015 seeds (lib/migrations/015_distributor_prices.sql:87-115). An installer with a real CED contract price for a Powerwall 3 or an IQ8+ can never enter it, so every BOM total, every $/W figure and every exported BOM CSV is priced off the Q1-2025 static catalog.

**Smallest repair.** Pick one wire format and honour it on both sides: have the page send `part_number`/`unit_cost` (or have the route accept `body.part_number ?? body.partNumber`), and make DELETE read `new URL(req.url).searchParams.get('id')` with the JSON body as an optional fallback.

### Per-company distributor price override is silently overwritten by the platform seed — SQL orders company-first, the Map is last-wins

`lib/bom/distributorPricing.ts`:829 — shape: `computed-not-consumed`, confidence: high

**Consequence.** Migration 015 seeds global (user_id NULL) rows for exactly the 22 highest-dollar SKUs — panels, string/hybrid inverters, micros, optimizers, batteries (015_distributor_prices.sql:88-115). For any of those part numbers a company-specific override is fetched, ordered first, then thrown away, so the estimator sees the platform seed. A company whose real Powerwall 3 net is $7,100 still gets $8,280 per battery in Est. Hardware Cost and in the $/W tile, with no indication its override was ignored. Overrides for any other part number do work, which makes the failure look random rather than systematic.

**Smallest repair.** Either reverse the route's ORDER BY so the highest-priority row is applied last, or (better) make the map build explicitly precedence-aware: skip a key already present (`if (!overrideMap.has(key)) overrideMap.set(key, cost)`) and document that `overrides` arrives highest-priority-first.

### Price-override upsert references a unique constraint that does not exist, and its "fallback INSERT" is unreachable

`app/api/admin/distributor-prices/route.ts`:212 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** Once the camelCase/snake_case mismatch above is repaired, the very next attempt to save a price override returns a 500 from handleRouteDbError instead of saving, and the comment-documented fallback written specifically for "if ON CONFLICT failed (no unique index yet)" does nothing. Two independent gates must be fixed before an admin can store a single contract price.

**Smallest repair.** Add `CREATE UNIQUE INDEX IF NOT EXISTS uq_distributor_prices_owner_part ON distributor_prices (COALESCE(user_id::text,'00000000-0000-0000-0000-000000000000'), UPPER(part_number))` in a new migration, and replace the unreachable `row ?? …` idiom with a real try/catch around the ON CONFLICT statement if the fallback is still wanted.

### The engineering BOM is never invalidated when equipment changes — and the stale copy is auto-written to the client's project files

`app/engineering/page.tsx`:2754 — shape: `lost-handoff`, confidence: high

**Consequence.** Swap the inverter (or battery, panel, interconnection, panel count), then click Run Calculations. The SLD is dropped and re-rendered for the new hardware, but the BOM tab keeps showing the pre-swap line items, part numbers, quantities, Est. Hardware Cost and $/W with no staleness marker; "Export CSV" downloads that stale list; and the auto-save overwrites BOM_<project>.csv in Client Files with the pre-swap BOM stamped as current. The client's file drawer then holds an SLD for the new inverter and a BOM for the old one.

**Smallest repair.** Mirror the SLD pattern: build a `_bomInputSig` from the same fields fetchBOM posts (inverterId/panelId/rackingId/batteryId+count/moduleCount/interconnectionMethod/systemType/conduitType/subSystemCounts) and in an effect clear bom/bomStages/bomPricing when it changes; and have saveEngineeringOutputs omit bomItems when the signature no longer matches rather than persisting a BOM it knows is stale.

### The persisted BOM CSV in Client Files has no Part Number and no cost columns, and its `Tag` column is always empty

`app/api/engineering/save-outputs/route.ts`:457 — shape: `lost-handoff`, confidence: high

**Consequence.** The archived procurement document the purchaser actually opens — BOM_<project>.csv, attached to the project in Client Files — lists "IronRidge / XR100 Rail System / 8 / ea" with an empty first column, no SKU and no price. Every part number the engine already resolved must be looked up again by hand before anything can be ordered, and the priced total the estimator quoted from cannot be reconciled against the archived file. This is exactly the manual re-entry of data the system already holds.

**Smallest repair.** Change the header to 'Stage,Category,Manufacturer,Model,Part Number,Qty,Unit,Unit Cost,Total Cost,NEC Ref,Notes' and emit item.partNumber, item.unitCost, item.totalCost (drop the non-existent tag); or import and reuse bomToCSV from lib/bom-engine-v4.ts and add the two cost columns there.

### The customer-signed proposal asserts "25-yr product warranty" for the panel unconditionally, while the real per-module warranty sits on the record

`app/proposals/view/[id]/page.tsx`:1914 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** A homeowner signing a proposal for a 12-year-product-warranty module (any of the six catalogue entries above) reads "25-yr product warranty" with a green check beside the correct model name, on the document they are accepting. The claim also prints when no panel is selected at all, beneath the placeholder "High-efficiency solar panels" (:1906). Same for racking whenever the mounting record carries no warranty.

**Smallest repair.** Render selectedPanel?.warranty when present and fall back to a non-claim ("Manufacturer warranty") when absent, exactly as the inverter card already does, and apply the same treatment to the racking card's `|| '25-yr structural warranty'`.


---

## Finance / Pricing

> The finance lane is one real pipeline plus several orphaned halves of one. System price is produced by `calculateItemizedPrice()` in `lib/pricingEngine.ts` (default mode `per_panel`: panels x $/panel + fixedCost), persisted as `costEstimate.cashPrice/grossCost` by `POST /api/production`, snapshotted into `proposals.data_json.pricingSnapshot` at creation, and read back as `storedCashPrice` by `buildCanonicalProposal()`, which is genuinely the single authority for every downstream financial number (monthly payment, 25-yr flow, payoff, offset). The ITC position is correct and well defended: `lib/incentivesConfig.ts` carries `allow_itc: false`, `lib/db/pricing.ts:72` gates the DB read on `isItcEnabled()` so an admin cannot re-enable a repealed credit, `calculateIncentives()` returns 0% federal for residential, and `guardItcValue()` is wired. No residential §25D *dollar amount* can reach a quote — I could not break that, and I tried. What is not healthy is everything the builder computes and nobody reads. Three finance inputs (`loanApr`, `loanTermYears`, `purchaseMode`) are threaded from the pricing config into the canonical builder, the two proposal pages and the PDF route, and *nothing in the repo ever writes them* — no column, no migration, no admin field — so a fabricated 7.99% APR / 25-yr term is the only lender term the product can state. The finance-basis 25-year figure (`netDifferenceFinanced`), the state-incentive list (`state_incentives`), and the at-risk-policy suppressor (`incentivesAllowed`) are each computed, typed, returned, and read by zero consumers, while the surfaces that should use them print the cash-basis or federal-only figure instead. And the §48E lease/PPA banner is gated on two frozen `true` literals, so it ships a 30% federal credit claim and a deadline that expired 2026-07-04 onto every homeowner proposal rendered today. Verdict: the price-and-ITC spine is sound; the finance-product and incentive-presentation layer is half-wired and is the part the homeowner actually reads.

### §48E lease/PPA banner is gated on two frozen `true` literals — it ships a 30% federal credit claim and an expired deadline to every homeowner

`app/proposals/view/[id]/page.tsx`:1234 — shape: `guard-cannot-fire`, confidence: high

**Consequence.** Today is 2026-09-26. Every homeowner who opens a share link — cash or loan, residential or commercial, any state — is shown an amber call-to-action urging them to "Act Before July 4, 2026" and "lock in your savings now" for a deadline that passed 2.5 months ago, promising "a 30% federal tax credit" passed through via a lease or PPA that this product cannot model or quote. This is the one remaining path by which a 30% federal credit reaches a residential homeowner's proposal, and it reaches it as an unqualified marketing claim rather than a number, which is why the numeric ITC guards never catch it.

**Smallest repair.** Gate the block on a real product signal and on the calendar: render only when the project is a lease/PPA (which requires `purchaseMode` to gain those values first) AND `new Date() <= new Date(getSection48eSafeHarborDeadline()!)`, and replace both hardcoded "July 4, 2026" strings with the accessor that is already imported. Until a lease/PPA product exists, the honest state is to not render it.

### `loanApr`, `loanTermYears` and `purchaseMode` are read from the pricing config but nothing in the repo ever writes them — 7.99% / 25 yr is a fabricated lender term printed as fact

`lib/proposal/buildCanonicalProposal.ts`:644 — shape: `fabricated-absence`, confidence: high

**Consequence.** Every financed proposal in the product states a specific APR — "25-yr loan at 7.99% APR" — and a monthly payment derived from it, next to the hedge "Subject to lender approval". No lender supplied that rate, no installer can change it (there is no field, column, or API parameter), and the term is likewise fixed at 25 years. On the shipped defaults that produces $226/mo on a $29,280 system; a real dealer product at 5.99% is $189 and at 9.99% is $266, so the payment the homeowner reads can be off by ±20% with no way to correct it. Every derived figure inherits the error: `total_energy_cost_monthly`, `ownershipDeltaMonthly`, the "fixed at $X/mo" reassurance copy, and the three-column Loan Term Comparison table. `purchaseMode` has the same no-writer problem, so `app/api/proposals/[id]/pdf/route.ts:168` (`pricingCfg.purchaseMode === 'cash' ? 'cash' : 'finance'`) always resolves to 'finance' and the server document renders a monthly payment and an APR row for a cash buyer.

**Smallest repair.** Either add `loan_apr`, `loan_term_years` and `purchase_mode` as nullable columns with an admin field and plumb them through `rowToPricingConfig`/`upsertPricingConfig`, or — preferable while lender data is genuinely unknown — remove the `?? 7.99` / `?? 25` fallbacks and suppress the APR line, the monthly payment and the term-comparison table entirely when no lender term is on file, the way the ITC path already suppresses an absent credit.

### `cp.incentives.state_incentives` has no writer and `areStateIncentivesEnabled` is imported but never called — the canonical incentive block reports federal only

`lib/proposal/buildCanonicalProposal.ts`:736 — shape: `field-no-writer`, confidence: high

**Consequence.** The server-rendered document and the web proposal for the same project disagree about the customer's incentives. In Arizona the web page shows "Arizona Solar Tax Credit $1,000" and a cash total; the document says "State & Local Incentives — Ask Us" and omits the $1,000 from "Total Potential Value". The document also tells a residential homeowner "Federal incentives may apply" while the codebase's own accurate disclosure — naming the §25D repeal — sits behind an import that is never called. Reachability, stated honestly: `renderProposalHTML` has one caller, `app/api/proposals/[id]/pdf/route.ts:231`, and I found no UI fetch of that route (`Grep 'proposals/[^`\'\"]*/pdf'` over the repo returns only the route file, the audit inventories and docs), so no button produces it today — but `middleware.ts:37` lists `/pdf` among the proposal routes reached by share token, so a homeowner with the link can request the document directly, and `lib/roadmapRE26.ts:931` asserts the download button is wired.

**Smallest repair.** In `buildCanonicalProposal`, actually call `areStateIncentivesEnabled()` and, when true, populate `state_incentives` and `total_incentives` from `calculateIncentives(stateCode, effectiveFinal, …)` — the same call the two React pages already make — so one authority feeds both surfaces; and call the already-imported `getIncentivesComplianceMessage()` onto the canonical object so the document carries the §25D disclosure instead of "Federal incentives may apply".

### DesignStudio's "Your margin" card is computed from a different price than the customer is quoted, and its own comment asserts they are the same number

`app/api/production/route.ts`:136 — shape: `fake-status`, confidence: high

**Consequence.** The installer's "Your margin — Internal only" panel reports a Revenue, Gross profit and Margin computed from a price the customer is never quoted. On the shipped defaults (roof $1,364/panel, $3.10/W, $2,000 fixed, 440 W), 20 panels: customer pays $29,280, the card shows Revenue $27,280 and Margin 42.3% when the true margin on the quoted price is 46.3% — profit understated by exactly the $2,000 fixed cost. Change the panel to 500 W and it inverts: Revenue $31,000, Margin shown 43.2% against an actual 39.9% — overstated, which is the direction that makes an installer grant a discount they cannot afford, the exact failure the card's own comment says it was built to prevent. On a Sol Fence job the equipment side compounds it: costing 0.95 $/W equipment at 0.55 overstates gross profit by $0.40/W, about $3,520 on 8.8 kW.

**Smallest repair.** Derive the margin card from the price actually quoted: compute `internalRevenue` as `itemized.totalCashPrice` (and `internalProfit`/`internalMargin` from it via `calculateProfitMargin`) instead of from `pricingAlt.revenue`, keep `pricingAlt` for the cost side only, make `equipmentCostPerWatt` resolve per `SystemTypeKey`, and either pass `salesOverride` into `calculateItemizedPrice` or drop it from the route contract.


---

## Enterprise / Multi-tenant

> SolarPro has no org-level data isolation: every business table (projects, layouts, clients, proposals, productions, crews, project_files) is keyed on user_id only — migration 105's own header says "Project ownership backfill (deferred)", and the only business table that ever gained an org column is field_route_measurements (migration 118). "Organization" is therefore a seat-billing and membership construct layered on top of per-user ownership, and the per-user scoping discipline in the routes I read is genuinely good (crews, commands/generate, engineering/permit, projects all filter by user_id; I found no unscoped tenant query outside app/api/admin/*, where cross-tenant reads are the point). The real damage is elsewhere. Two complete membership systems exist side by side — legacy users.org_id + org_invites, which every live UI writes, and organization_members + active_organization_context, which the authorization engine and the field-measurement capability layer read — and no code path writes both, so they drift apart on every invite and removal. A whole tenancy layer (active-org context, support elevation, per-org audit chain, per-org settings) is built, exported, tested, and consumed by nothing. And the one catalog users can actually mutate — the equipment library — is a process-global in-memory Map with no tenant key and no admin gate. Verdict: the per-project scoping is healthy; the organization layer is largely a facade over it, and two defects (F1, F3) are live cross-tenant integrity problems today.

### Equipment library is a process-global mutable catalog: any authenticated user can edit or delete panels every organization designs with

`app/api/hardware/route.ts`:96 — shape: `fake-status`, confidence: high

**Consequence.** Company B's engineer calls PUT /api/hardware with {type:'panel', id:'panel-std440', data:{width:9}} -- no admin role is required, only a session -- and Company A's Design Studio panel picker, panel dimensions and per-watt pricing change on that server instance, silently altering Company A's layouts and cost estimates. Deleting the same id removes the panel from every org's picker. Because nothing is persisted, the edit also vanishes at the next cold start, so the admin who made a deliberate catalog change sees it revert with no error. GET /api/hardware serves the merged catalog, including whatever pricing anyone injected, with no authentication.

**Smallest repair.** Gate POST/PUT/DELETE on requireAdminApi (the pattern app/api/pricing/route.ts:71-75 already uses) and move the library into the existing user_equipment_* tables keyed by owner, reading back with an org/user filter, so an edit is both scoped and durable.

### ✅ **FIXED** (`6115a285`) — Role change, member removal and suspend perform the mutation but skip the authorization check when a different flag is off

`app/api/organizations/[id]/members/[userId]/route.ts`:104 — shape: `guard-cannot-fire`, confidence: medium

**Consequence.** With ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED=true and ENTERPRISE_ORG_AUTHORITY_ENABLED unset -- the natural order for an operator turning on member management, since that is the flag the 501 message names -- three of the four member-mutation entry points run with no authorization at all. Any authenticated SolarPro user who knows an org UUID can DELETE any member of that org, or PATCH {role:'owner'} onto any existing member; a user holding a 'viewer' membership in an org can promote themselves to owner of it. The route file's own header asserts the opposite: "deny decisions are always enforced (fail-closed). There is no advisory mode".

**Smallest repair.** Call enforceMemberAction unconditionally, exactly as the sibling POST calls enforceAuthz, and delete the isOrgAuthorityEnabled() wrapper. If a legacy path must be preserved when the master switch is off, give it an explicit legacy caller check like the one at app/api/organizations/[id]/members/route.ts:74-83 rather than no check.

### pricing_config is one global row shared by every organization, and it is readable unauthenticated

`lib/db/pricing.ts`:84 — shape: `fake-status`, confidence: high

**Consequence.** There is no per-organization pricing anywhere in the product. Every company's proposals and cost estimates are computed from the same single row, so the last save sets the price-per-watt, labor cost, overhead and margin used in every other company's customer-facing proposal and payback calculation. The route's own comment at line 69-70 states the problem -- "Pricing config is global and shared across all users" -- and the fix applied was an admin gate on the write, not a tenant key. Separately, anyone on the internet can GET /api/pricing and read the installer's labor cost, overhead percent and profit margin.

**Smallest repair.** Add an owning scope column (org_id, falling back to user_id for solo accounts) with a uniqueness constraint per scope, make getPricingConfig/upsertPricingConfig take that scope from the session, and require authentication on GET /api/pricing (removing it from PUBLIC_PATHS) so margins are not public.

### ✅ **FIXED** (`db3180e5`) — Unscoped org_id clear after member removal detaches the user from a different organization and under-bills that org

`app/api/organizations/[id]/members/[userId]/route.ts`:260 — shape: `lost-handoff`, confidence: high

**Consequence.** A user is an owner of Org B and a member of Org A. Org A's admin removes them from Org A. Their users.org_id, which removeMember had just re-pointed to Org B, is set to NULL. Org B's Organization panel loses them, because app/api/organizations/route.ts:25-28 builds the member list and count from "SELECT COUNT(*) FROM users m WHERE m.org_id = o.id"; and Org B's Stripe seat count drops by one, because lib/stripe.ts:427 meters seats with "SELECT COUNT(*)::int AS n FROM users WHERE org_id = ${orgId}" -- so Org B is silently under-billed and a member vanishes from its roster as a side effect of an unrelated tenant's action.

**Smallest repair.** Delete lines 257-263 of the route. removeMember already performs the scoped clear and the correct re-sync; the route's copy is a strictly wrong duplicate of work already done.


---

## Killed by verification — do NOT re-propose

- **Six of the eight installation-phase milestone chips in the homeowner portal have no writer and can never be ticked** (`app/portal/dashboard/page.tsx`)
- **advanceFunnelStage has no callers anywhere, so campaign attribution reports 0 claimed and 0 won for campaigns with real paid claims** (`lib/network/attributionTracker.ts`)
- **Once a lead becomes an opportunity, the admin review row hardcodes "ready for review: true", "nothing missing" and "consent: false"** (`app/api/admin/network/intake/route.ts`)
- **Survey override layer is computed then thrown away — only console.logged** (`app/api/engineering/generate/route.ts`)
- **Every PV-1..PV-4 sheet string built from the survey has zero consumers** (`lib/siteSurvey/permitIntegration.ts`)
- **Field-captured obstructions are 100% discarded: schema has no position, normalizer requires one** (`lib/siteSurvey/normalizeSurvey.ts`)
- **Uploaded photos get no DB row until submit; the only link is the phone's localStorage** (`app/api/survey/upload-photo/route.ts`)
- **The survey→CAD overlay lives only in two composers nothing calls** (`lib/drafting/composers/index.ts`)
- **Engineering Monitor renders six health metrics from a workspace built with no inputs, and discards the computed note that says the data is absent** (`app/admin/engineering/page.tsx`)
- **The IronRidge structural route computes a full racking BOM with its own SKUs; its only caller discards it, and those SKUs contradict the V4 registry's for the same parts** (`app/api/engineering/ironridge/route.ts`)
- **Finance-basis 25-yr figure is computed and never read; the financed proposal's "Est. 25-Yr Advantage" is the cash-basis number** (`lib/proposal/buildCanonicalProposal.ts`)
- **`cp.policy.incentivesAllowed` — the at-risk-policy suppressor — is computed, typed, returned and read by nobody** (`lib/proposal/buildCanonicalProposal.ts`)
- **Two membership tables: every live UI writes only the legacy pointer, the authorization engine reads only the new table** (`app/api/organizations/member/route.ts`)
- **No audit record exists for any organization authority mutation, and the fail-closed function written for them has zero callers** (`lib/auditLog.ts`)
- **Active-organization context is settable and switchable but no data path reads it** (`lib/organizations/context.ts`)
- **organizations.settings has no writer, so the per-tenant self-verification policy can never be enabled by anyone** (`lib/fieldMeasurement/capabilities.ts`)