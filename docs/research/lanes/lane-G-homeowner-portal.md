# Lane G — Homeowner Portal UX

Research date: 2026-09-25. Corpus: 8 videos watched end-to-end (frames + transcripts under
`C:\Users\Ray\Solarpro Claude\tools\watch\<videoId>\`), 1 failed fetch, 11 documentation /
operator-report sources. SolarPro's own portal audited from code.

---

## SUMMARY — transferable interaction principles

1. **The homeowner wants three things: when is it happening, what is blocking it, is it
   producing what you promised.** Bodhi's own support-ticket data says 18.6% of all customer
   questions are "when is my installation scheduled?", 14.6% "how do I use my monitoring app?",
   7.5% "any update on my project?" — 41% of contacts are those three.
2. **A status label is not a status.** The failure mode is not an empty portal, it is a portal
   that says `Permit-Submitted` for five months. Tesla shipped exactly that and it produced a
   viral complaint. A stage name with no date, no authority named and no next action is worse
   than silence because it looks like an answer.
3. **Waiting is a design problem, and time-in-stage is the trigger.** Bodhi fires customer
   updates on *elapsed days in an unchanged stage* ("after 7 days", "after 14 days"), not only
   on state change. That is the single most steal-able mechanism in the whole corpus.
4. **Separate what you control from what you don't, and say who holds it.** Continuum's homeowner
   explainer gives hard SLAs for its own steps ("within 24 hours of your notice to proceed") and
   honest ranges for other people's ("30 to 60 days through your utility provider"). Attribution
   prevents the homeowner blaming the installer for the utility's queue.
5. **Operational transparency beats a progress bar** (Buell, HBS): showing the actual work being
   done raises satisfaction more than an abstract indicator. Continuum's explainer shows the real
   Placer County permit with its real number `BLD24-00483`, not a pill that says "Permit".
6. **Never show a phase as one long blob.** The Buildertrend operator's central lesson: a 49-day
   "DRYWALL & PAINT" bar sets off alarms because the homeowner cannot see the slack inside it.
   Show the items, not just the phase.
7. **Default documents to visible.** "There's almost no situation where a photo that I take on the
   project I don't want the owner to see — after all it is their project."
8. **Provision the portal at contract, automatically.** Gallery Group generates credentials the
   moment the contract goes unconditional. A portal behind a manual invite button is a portal
   half the customers never see.
9. **One thread across SMS + email + portal, and let the spouse in.** Solar is a household
   purchase; a portal keyed to one email loses half the household.
10. **PTO is a cliff, not a finish line.** Three independent videos teach homeowners to manually
    flip "permission to export" after PTO. Nobody instruments the handover.

---

## LEDGER

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | STEAL/ADAPT/REJECT/BACKLOG | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Solar homeowner app | Tesla app (energy) | How to use the Tesla App - For Homeowners | `fHiHAm90yTE` | 2025-10-14 | Operator (Earth Right, certified installer; presenter in Tesla Energy Training cap) | 11:47 full — 345 caption cues + 15 frames | 0:58 homepage appears only "once your system's been installed and commissioned"; 1:10 power-flow card; 1:47 bottom nav Energy/Impact/Settings/Go Off-Grid/Support; 2:58 Impact + backup history; 6:26 permission-to-export; 11:14 messages tab | Post-PTO monitoring only | Power flow answers "is it producing" at a glance (2.2 kW solar, 14.2 kW home, 12 kW grid, 30% battery). Month view surfaced as a first-run recommendation. "Manage access" shares the system with another household member by email. Utility rate plan entry turns kWh into dollars | **Zero project tracking.** The app does not exist for the homeowner until after commissioning — the entire signature-to-PTO window is off-app. Savings are unknowable until the homeowner manually configures a rate plan | Watch an installer's YouTube tutorial to learn the app exists | SolarPro portal is the inverse: strong pre-install stage UI, `MonitoringFoundation` tiles hardcoded `'— kW'`, `'—%'`, `'$—'` (`app/portal/dashboard/page.tsx:799-801,821-823`) | REJECT the post-PTO-only model; ADAPT the power-flow "one glance" card and the share-access pattern | MED | HIGH | LOW | Watched |
| Solar homeowner app | Tesla app (energy) | Ultimate Guide to the Tesla App (2026) \| Solar & Powerwall Tutorial | `vhno896wwJo` | 2025-03-14 | Real user / independent creator (Zach Solar) | 16:44 full — 506 cues + 36 frames | 10:02 "two major mistakes made by homeowners on the app that kill system performance"; 10:08-10:46 permission-to-export; 16:22 support tab | Post-PTO monitoring | Independent confirmation of the app's shape from a non-installer | **Independent confirmation there is no project tracking.** Grep of the full transcript for permit/status/project/install-date returns nothing but utility-rate mentions. The #2 system-killing mistake is a toggle the homeowner must flip themselves at PTO: "if you leave it in the no position your system will only produce as much solar energy as the home or the battery can handle… I can't stress this enough, do not forget this step" | Third-party YouTube tutorials substitute for the product telling you | No PTO event exists in SolarPro to hang an activation step on — `pto_approved` is a micro-stage string with no writer | STEAL the PTO activation checklist idea | HIGH | HIGH | LOW | Watched |
| Solar homeowner app | Tesla Solar Roof + Powerwall 3 | Tesla Solar PTO Explained: What Happens After Install? | `AQbPgLPon-E` | 2026-04-03 | Operator (American Home Contractors, installer) | 3:17 full — 77 cues + 30 frames | 0:19 "let's start by activating the system"; 0:23 permission to interconnect + AHJ clearance; 0:42-0:54 app toggle; 1:09 gateway breakers; 1:31 rapid shutdown; 1:51 Powerwall side switches, leader then followers | The PTO cliff | Honest, sequenced activation ritual; names the AHJ explicitly as the gate ("all permits have to be inspected and cleared for you to turn on your system") | **Third independent source teaching the same manual ritual.** The single most consequential moment in the whole project — the system going live — is an un-instrumented checklist the homeowner performs from a YouTube video | Watch a third video | Nothing. `completed` stage copy is "Your solar system is live! 🎉 … You're all set." (`page.tsx:254-261`) — asserted, never verified, with no activation steps | **STEAL** — PTO activation checklist | HIGH | HIGH | LOW | Watched |
| Construction client portal | Buildertrend | Complete Buildertrend Tutorial: Homeowner View | `dtAd6WvyTTc` | 2024-11-15 | Operator (Nick, Oakvale Homes & Development; published on Income Digs) | 18:10 full — transcript + 36 frames | 1:56 one-click "preview as homeowner"; 2:24 schedule is "the most used feature… they look at it almost every single day"; 3:00 `homeowner can view` permission; 3:27 offline schedule ⇒ homeowner sees "No project schedule"; 4:24-6:20 the phase-blob problem; 15:29 photos default-visible | Mature non-solar tracking | Split-screen builder view vs homeowner view; persistent amber banner **"You're currently previewing the homeowner view"** with "Exit homeowner preview". White-labelled to the builder (OAKVALE logo, "Contact Us"). Per-object `homeowner can view` permission. Photos default to visible: *"there's almost no situation where a photo that I take on the project I don't want the owner to see — after all it is their project"* | The blob: showing only phases, a 49-day "DRYWALL & PAINT" bar "is going to set off some alarms… what they're not seeing is that there's this big gap in between". Homeowner cannot see the rolled-up and detail views together. Taking the schedule offline to edit silently blanks the homeowner's view | Operator manually flips schedule online and grants full-schedule access; checks the preview "consistently" | SolarPro has `app/admin/projects/[id]/portal-preview/page.tsx` (equivalent, good) — but ships the exact blob: `installation` is one homeowner step covering 8 micro-stages from `permit_submitted` to `pto_approved` | **STEAL** the anti-blob ruling; ADAPT default-visible documents | HIGH | HIGH | MED | Watched |
| Construction client portal | Gallery Group Client Construction Portal | Client Construction Portal \| Give your clients real-time access | `xU-8goSTIzg` | 2020-02-04 | Official (vendor/builder) | 2:35 full — transcript + frames | 0:20 "automated milestone updates"; 0:44 credentials auto-generated "upon the contract going unconditional"; 1:08 My Jobs; 1:33 Documents tab; 1:46 Photos; 2:01 Activities | Non-solar progress tracking | **Portal is provisioned automatically at contract** — username/password generated and sent to builder and client with no human step. Clean IA: My Jobs → Job Details → Documents / Photos / Activities. Activities is a *live feed of named work items* ("from soil tests to slab down through to electricals wired"), not a phase bar. Supervisors upload site photos from their phones in real time | Password-based auth in 2020; portal per-builder rather than per-project-management-system | None needed | SolarPro requires an admin to click `send-portal-invite` (`app/api/admin/projects/[id]/send-portal-invite/route.ts`). Auth is OTP (better). No photo feed, no activity feed beyond micro-stages that nothing writes | **ADAPT** — auto-provision at signature | HIGH | HIGH | LOW | Watched |
| Solar journey explainer | Continuum (installer) | The Solar Journey | `iag2ZE8915E` | 2026-05-20 | Operator (installer, homeowner-facing) | 4:47 full — 113 cues + 30 frames | 0:34 survey "within 72 hours of signing"; 0:56 true-up "within 24 hours"; 1:12 design "72 hours after true up"; 1:33 NTP "within 72 hours"; 1:38-1:51 permit submitted "within 24 hours of NTP", "permit timing varies by city"; 1:45 **real Placer County permit `BLD24-00483` on screen**; 2:15 MPU "30 to 60 days through your utility provider"; 2:20 interconnection "within 24 hours of your permit… utility responses usually come in a few weeks"; 2:54 install "within a week of permit approval"; 3:32 inspection "most within 30 days"; 3:49 PTO "within 7 days after final permit upload"; 4:23 check-in "within 48 hours of PTO" | Full signature→PTO journey | **Every step carries an SLA expressed relative to the previous step.** Steps the installer controls get hours; steps others control get honest ranges with the holder named ("through your utility provider", "PG&E schedules and installs it themselves"). Conditional branches (main panel upgrade, PG&E meter collar) are shown as parallel, not blocking. Shows the **actual permit document with its real number and the real AHJ name** rather than a status pill | It is a video, not a live portal — the SLAs are marketing promises with nothing rendering the customer's actual elapsed time against them | Homeowner has to remember a 4-minute video | SolarPro's `installation` copy is static and date-free: "We're handling permits and lining up your installation crew. Everything is in motion — you'll receive a confirmed date soon." (`page.tsx:246-253`) | **STEAL** — the per-step SLA + ownership model | HIGH | HIGH | MED | Watched |
| Solar CX platform | Bodhi | Stop Solar Project Miscommunication \| Meet Bodhi Group Chat | `MEY7v8F_DY0` | 2025-09-03 | Official (vendor) | 1:00 full — transcript + frames | 0:00 "Can you keep my spouse updated too?"; 0:23 add secondary users (name, phone, email); 0:32 "syncs seamlessly across text, email, and the customer portal" | Household messaging | One thread spanning SMS + email + portal. Secondary contacts (spouse, GC) added to the *project* conversation, and every party sees every message and reply. Whole conversation logged against the project | Vendor demo, ~60s, no failure paths shown | PM texts the spouse from a personal phone | SolarPro's portal is keyed to one `clients` row and one OTP email. Only contact affordance is `tel:`/`mailto:` to the rep (`ProjectTeam`). No messaging at all | **ADAPT** — secondary contact on the project | MED | HIGH | MED | Watched |
| Solar CX platform | Bodhi | Introducing Bodhi Inbox: Streamline Solar Communications | `6WXUsp7k6dg` | 2023-03-01 | Official (vendor) | 0:56 full — transcript + frames | 0:09 unified inbox across text/email/app; 0:24 "no more text message exchanges just living in one project manager's phone"; 0:38 send across all channels at once | Unified comms | Names the real operational failure precisely: customer history trapped in one PM's phone. Whole team sees the homeowner's full history and can act | Vendor ad; no data | — | None — no `notifications` table exists in SolarPro at all; the AppShell bell and `inapp_*` settings keys have no backing store | BACKLOG | LOW | MED | HIGH | Watched |
| Solar CX platform | Sunvoy | Sunvoy & eGauge white-label Customer Portal and Fleet Management Integration | `MUMiW37NFmY` | 2022-11-01 | Official (vendor) | 3:18 full — 78 cues + 20 frames | 0:34 "we use Sunvoy as a customer portal for our solar customers"; 1:08 white-label branding; 1:33 fleet view; 1:49 RMA'd commercial site "since then we've been producing less… you can clearly see it in the data"; 2:13 estimated vs actual production | Fleet monitoring | White-label is the stated core value. Estimated production entered alongside actual so underperformance is visible as a gap, not an absolute number | **The video titled "Customer Portal" never shows the customer portal.** 3:18 of installer fleet dashboards. Cautionary: vendors sell "customer portal" and demo the installer side | — | `lib/portal/production.ts` is estimate-only (1370 kWh/kW/yr, 0.4 kg CO₂/kWh). No actual-vs-estimate comparison because there is no actual | ADAPT the estimate-vs-actual gap; REJECT as evidence of portal UX | MED | MED | HIGH | Watched — negative finding |
| Solar permit portal | PTOEDGE CRM | PTOEDGE CRM Portal \| Complete Platform Walkthrough & Demo | `5h1OIq-un4M` | unknown | Official (vendor) | **0:00 — FAILED** | — | — | — | — | — | — | — | — | — | — | **FAILED: `ERROR: [youtube] 5h1OIq-un4M: This video is not available`.** Not a transient 403 (see `claude-can-watch-video` memo); genuinely unavailable. Not retried. No conclusions drawn from it |
| Operator data | Bodhi | The top 10 questions solar customers ask | https://www.bodhi.solar/blog/top-10-questions-solar-customers-ask | n/d | Official vendor, but reporting **their own ticket distribution** | Documentation — read, not watched | — | Support-contact analysis | **This is the direct answer to "what does a homeowner want to know today?"** — 1. "When is my installation scheduled?" **18.6%** · 2. "How do I access/use my monitoring app?" **14.6%** · 3. "Any update on the status of my project?" **7.5%** · 4. "When will my system inspection be scheduled?" 4.7% · 5. "When will I receive my tax-credit/rebate paperwork?" 4.4% · 6. billing/financing 3.9% · 7. maintenance 1.6% · 8. "Why is my production lower than expected?" 1.2% · 9. "When will my system be turned on (PTO)?" 1.2% · 10. referrals 0.6% | Vendor-sourced; percentages are unaudited and the denominator is unstated | — | SolarPro answers **none** of the top 5 with real data. No install date is ever rendered. No monitoring link unless an installer pasted `monitoring_url`. No tax-credit document (the vault excludes everything the installer produced) | **STEAL** — build to this ranking, not to a feature list | HIGH | HIGH | LOW | Documentation |
| Operator data | Bodhi | A fool-proof checklist for successful communications with solar customers | https://www.bodhi.solar/blog/checklist-for-successful-communications-with-solar-customers | n/d | Official vendor | Documentation | — | Comms operating model | 12 checklist items. #4 is the key one: **"Have a 'no update' update message ready to use"**, used *proactively*, not only on request. Rationale given: *"studies show that if you proactively check-in with a waiting customer, their internal 'waiting clock' resets to zero. If they've been stuck in permit limbo for 4 weeks, they're more likely to say they haven't been waiting that long."* Also #1 "Here's what to expect" resource, #8 "Offer your customers a project tracker" | Cites "studies" without naming them. No cadence number given — I looked and it is genuinely absent | — | SolarPro sends `sendStageAdvanceEmail` **only on stage change**. During `installation` — the longest stage, covering permit through PTO — a homeowner can receive zero communications indefinitely | **STEAL** — the no-update update | HIGH | HIGH | LOW | Documentation |
| Operator data | Bodhi 2.0 | Announcing Bodhi 2.0, your end-to-end customer experience platform | https://www.bodhi.solar/blog/bodhi-2-0-end-to-end-customer-experience-platform-solar-sales | n/d | Official vendor | Documentation | — | Journey automation | Four named journeys: **Sales / Re-engagement / Installation / Post-install**. Triggering is conditional *and* time-based: "did the permit get approved? Great, Bodhi will send an update!" plus escalation on elapsed time — **"after 7 days", "after 14 days"** in an unchanged permit state automatically prompt a customer notification. Called a "solar pizza tracker" internally | Marketing copy; no screenshots of the trigger builder | — | SolarPro has no scheduler, no cron, no time-based trigger, and no `notifications` table. Every homeowner-facing message is synchronous to a human action | **STEAL** — time-in-stage triggers | HIGH | HIGH | MED | Documentation |
| Operator data | Bodhi | Your comprehensive guide to the perfect solar customer portal for 2025 | https://www.bodhi.solar/blog/your-comprehensive-guide-to-solar-customer-portals-in-2025 | 2025 | Official vendor | Documentation | — | Portal feature model | Seven stated requirements: system details (size, inverter, panel make) auto-synced from CRM; project progress tracker "modeled after delivery tracking systems"; document repository with e-sign; unified chat inbox; FAQ/knowledge base; referral form; companion installer-side portal. Frames the stake well: the homeowner wants to know "exactly what's happening with their $30,000 investment" | Vendor content marketing for its own product. Cites **no** statistics on support-call reduction despite claiming it — I checked | — | SolarPro has 5 of 7 in some form (details, tracker, referral link, installer-side admin portal, partial doc vault). Missing: chat, FAQ. Referral link is cosmetic — `page.tsx:695` builds `/portal?ref=<firstName>` and `/portal` just redirects to login; nothing reads `ref` | ADAPT (FAQ); BACKLOG (chat) | MED | MED | MED | Documentation |
| Process model | rationalgo | Solar Installation Permit-to-Power Phase Tracker | https://rationalgo.ai/resources/app-builder/solar-installation-permit-to-power-phase-tracker | n/d | Vendor documentation (app-builder template) | Documentation | — | 8-phase model | Eight phases with durations: **Site assessment & design (1 wk) → Permit application and approval (2-4 wks) → Equipment procurement (1-2 wks) → Installation day (1-2 days) → Building inspection → Utility interconnection (1 wk to 3 months) → Utility inspection & meter swap → Permission to Operate (1-2 wks)**. Notification spec is the best sentence in the corpus: *"automated phase-transition notifications explaining what just completed, what's happening next, and who's responsible"*. Explicitly handles blame: interconnection is flagged "outside the installer's control" to stop homeowners attributing utility delay to the installer. Inspections carry "pass/fail tracking with remediation timelines" | Template marketing, not a shipped product; durations are generic not per-AHJ | — | SolarPro's `PROJECT_PIPELINE` (`lib/operations/pipeline.ts:9-23`) is a near-identical 13-stage model — `permit_submitted`, `permit_approved`, `install_scheduled`, `installation`, `inspection`, `pto` — but it is **installer-only and never shown to the homeowner** | **STEAL** — the 3-part transition message and the responsibility flag | HIGH | HIGH | LOW | Documentation |
| Failure evidence | Tesla | Virginia homeowner says Tesla solar project sat at 'Permit-Submitted' for 5 months | https://www.thecooldown.com/green-home/virginia-homeowner-tesla-solar-permit-delay/ · thread https://www.reddit.com/r/TeslaSolar/comments/1whdcib/5_month_wait_and_still_no_building_permit/ | 2026-09 | Real user (r/TeslaSolar), reported secondhand | Documentation — **article read; the Reddit thread itself was NOT read, reddit.com is blocked to this agent's fetcher** | — | The exact failure this lane exists for | — | 8.8 kW project accepted in April sat at status **`Permit-Submitted`** for five months. The homeowner's words as reported: the only communication was occasional apologies from a project advisor, "otherwise nothing and no answers to texts or app messages". **The app had a status tracker and it still failed** — because the status never changed and carried no date, no AHJ, no expected decision | Commenters told the homeowner to **go around the portal**: search the county's own building-permit database, call the building department directly. One commenter discovered "nothing had been submitted". Another traced their delay to a typo — address entered "Ct." instead of "Court" | SolarPro would be *worse*: during this whole window it shows one static sentence with no permit number, no AHJ and no date | **STEAL** — this is the wedge. SolarPro owns the AHJ registry and generates the permit package; it is the only player positioned to show the permit number, the named authority and the elapsed-vs-expected clock | HIGH | HIGH | MED | Documentation (secondhand) |
| Research | Harvard Business School (Ryan W. Buell) | Operational Transparency / "Make Customers Happier with Operational Transparency" | https://hbr.org/2019/03/operational-transparency | 2019-03 | Academic / official | Documentation | — | Why waiting design works | Travel-site experiment: customers **preferred seeing the actual airlines being searched over a progress bar**, and valued the service more. Annenberg dining experiment: two-way visibility raised customer satisfaction 14% and cook satisfaction 22%. This is the mechanism behind the Domino's Pizza Tracker, which Bodhi's own docs invoke by name | Not solar; lab and field studies in other service settings | — | SolarPro shows an abstract weighted-% arc and a 7-step roadmap — the *progress bar* arm of Buell's experiment, i.e. the condition that performed worse | **STEAL** — replace abstraction with the real artifact | HIGH | HIGH | LOW | Documentation |
| Process model | Continuum / Buildertrend | AI Client Updates (Buildertrend), daily logs → homeowner-readable report | https://buildertrend.com/blog/client-portal-updates/ (page returned HTTP 403 to the fetcher; feature confirmed via search result text only) | n/d | Official vendor — **weak sourcing, flagged** | Not read directly | — | Automated progress narrative | Daily Logs capture site activity, weather and photos and flag delays; "AI Client Updates turns your daily logs straight into a homeowner-ready progress report" | **I could not fetch the source page (403).** Treated as unconfirmed | — | No daily-log equivalent. Field survey app (`app/survey/[token]`) captures photos but they are installer-only | BACKLOG | LOW | MED | HIGH | Documentation — unconfirmed |
| Domain data | GreenLancer / industry | Understanding Solar PTO; interconnection timelines | https://www.greenlancer.com/post/solar-pto · https://enphase.com/blog/homeowners/homeowners-guide-solar-permit-process | n/d | Official (manufacturer/vendor documentation) | Documentation | — | What the wait actually is | Concrete numbers to render against: permitting "between three weeks and three months" (Enphase). PTO typically 2-12 weeks; Duke ~14 days vs some CA utilities 30+ days. Reported industry figure: **over 90% of interconnection applications contain errors requiring revision**, each adding days or weeks. Best practice named: file permit and interconnection **in parallel**, not serially | Ranges are national averages; vendor-published; the 90% figure is widely repeated without a primary citation and I could not verify it | Homeowners are told to "work with a local professional" — i.e. no self-serve visibility | `lib/utilityInterconnection.ts` (4485 lines) already holds per-utility/state ICA+PTO timelines — and the portal **hard-disables the utility-specific lookup**: `page.tsx:1004-1005` reads `const icaTier1 = null as ReturnType<typeof getInterconnectionProfile>; void getInterconnectionProfile;` so only the generic state fallback ever renders, and only during `installation` | **STEAL** — re-enable what is already built | HIGH | HIGH | LOW | Documentation |

---

## SOLARPRO'S EQUIVALENT — audited from code

Repo: `C:\Users\Ray\Solarpro Claude\repo`. **A real homeowner portal exists** and is better than
expected — this is not a greenfield problem, it is a completion problem.

**What exists.** `app/portal/dashboard/page.tsx` (1372 lines) behind email→6-digit-OTP auth
(`app/portal/login/page.tsx`, `lib/portalAuth.ts`, separate `solarpro_portal_session` cookie from
the installer session). Fed solely by `app/api/portal/dashboard/route.ts`. Renders a 7-step
timeline, weighted-% arc, current-stage card, completed-milestone chips, activity feed, bill
upload, proposal view-and-sign CTA, projected benefits, a utility/PTO explainer, document vault,
referral link, monitoring link and a project-team contact card. Installer side:
`app/admin/portal-dashboard/page.tsx` and `app/admin/projects/[id]/portal-preview/page.tsx`
(the Buildertrend preview-as-homeowner pattern, already built).

**The stage model.** `HOMEOWNER_STAGES` (`lib/homeownerStageSync.ts:30-38`, DB-constrained in
`migrations/019_homeowner_stage.sql`) is seven values:
`lead_submitted, under_review, site_survey, design, proposal, installation, completed`.
Beneath it, `lib/microStage.ts:27-71` defines **34 micro-stages** including `permit_submitted`,
`permit_approved`, `install_scheduled`, `inspection_passed`, `pto_submitted`, `pto_approved`.

**The gap, precisely.** After signature, `app/api/proposals/[id]/sign/route.ts` flips
`homeowner_stage` to `installation`, and the portal then shows one static card —
*"Your installation is being planned… We're handling permits and lining up your installation crew.
Everything is in motion — you'll receive a confirmed date soon."* — for the entire permit →
inspection → interconnection → PTO window. **`installation` is the Buildertrend 49-day blob**, and
it collapses eight micro-stages into one step. Worse: **nothing writes those micro-stages.** Only
two writers exist in production code — `app/api/portal/bill-upload/route.ts` (bill events) and the
seven admin overrides in `app/api/admin/projects/[id]/route.ts:217-224`. No code path ever writes
`permit_submitted`, `permit_approved`, `install_scheduled`, `inspection_passed`, `pto_submitted` or
`pto_approved`.

**What does not exist at all:**
- **No permit status tracking.** No `permits` table, no `permit_status` column. No SUBMITTED /
  UNDER REVIEW / APPROVED / REJECTED state, no submission date, no AHJ name shown, no expected
  decision date. `permit_rejected` exists as an installer *decision action*
  (`lib/deals/transitions.ts:45`) but there is **no `permit_rejected` micro-stage**, so a rejection
  can never reach the homeowner. `ahj_registry` is an adopted-code registry, not application tracking.
- **No PTO/interconnection tracking**, and the utility-specific lookup is deliberately disabled
  (`page.tsx:1004-1005`).
- **No notifications system.** No `notifications` table anywhere. No scheduler, so no time-based
  trigger is possible. All homeowner contact is transactional email via Resend
  (`sendPortalOtpEmail`, `sendStageAdvanceEmail`, `sendProposalToClientEmail` — the other three
  proposal emails go to the installer, not the customer).
- **No installer documents shared.** `app/api/portal/dashboard/route.ts:116` filters to
  `file_type IN ('utility_bill','portal_upload')` with the comment *"Internal ops files (permit
  packets, BOM, SLD, engineering reports, site survey photos…) are intentionally excluded."*
  Nothing in the codebase ever writes `portal_upload`, and the vault's Download icon
  (`page.tsx:667`) has **no handler and no href** — it is decorative.
- **No production monitoring.** No Enphase/SolarEdge client exists.
  (`app/api/engineering/enphase/route.ts` is a BOM part resolver.) Tiles are hardcoded placeholders.
- **No install date, crew or arrival window** is ever rendered, though `project_schedule` and
  `crews` tables exist installer-side.
- **No messaging.** Only `tel:`/`mailto:` to the rep.
- **Portal invite is manual** (`send-portal-invite`), not auto-provisioned at signature.

**Two correctness issues found in passing** (out of lane, flagged as a background task):
`app/api/proposals/[id]/route.ts` GET runs `SELECT * FROM proposals WHERE id = ${id}` with no auth
and no share-token check — the token comparison lives only in the client at
`app/proposals/view/[id]/page.tsx:101` — so anyone with a proposal UUID can read pricing, client
name and address. And `middleware.ts` lists `'/'` first in `PUBLIC_PATHS` and matches with
`startsWith`, so every path matches and the middleware auth branch is dead code.

---

## TOP CANDIDATES FOR SOLARPRO

### 1. Break the `installation` blob into real, dated sub-steps
**Build.** Surface the six unwritten micro-stages (`permit_submitted`, `permit_approved`,
`install_scheduled`, `inspection_passed`, `pto_submitted`, `pto_approved`) as named sub-steps inside
the `installation` card, each with a date and a state, plus a `permit_rejected` micro-stage that
does not currently exist. Write them from the existing pipeline transitions in
`lib/deals/transitions.ts` rather than inventing a new authority.
**Beats what we have** because today eight distinct real-world events collapse into one static
sentence — precisely the 49-day-blob failure the Buildertrend operator warns about, and precisely
the `Permit-Submitted`-for-five-months failure that produced the Tesla complaint.
**Bounded:** the micro-stage vocabulary and the mapping table already exist; this adds writers and a
renderer, no new schema beyond one enum value.
**Proof:** drive a project through the installer pipeline and assert the portal shows six dated rows,
and that a permit rejection renders.

### 2. The permit card — name the authority, the number and the clock
**Build.** During permit review show: AHJ name, permit/application number, submission date, days
elapsed, and the expected-decision window from the AHJ registry. This is Buell's operational
transparency and it is SolarPro's structural advantage — **no competitor in this corpus showed a
permit number or an authority name in a homeowner portal**; Continuum only did it in a marketing video.
**Beats what we have:** "Everything is in motion" versus "Filed with Madison County Building &
Zoning on 12 Apr, application BLD26-00483, day 11 of a typical 15-20 business day review."
**Bounded:** needs a minimal `permits` table (authority id, application number, submitted date,
state, decision date) — the AHJ registry and the permit package generator already exist.
**Proof:** a homeowner can read their permit number off the portal and verify it against the AHJ's
own public search — the exact workaround the Reddit commenters had to invent.
**Caveat:** the `ahj-zero-governed-authorities` memo says 0 authorities are fully governed. Show the
authority and the number even when no timeline estimate is available; never fabricate a range.

### 3. Time-in-stage triggers and the "no update" update
**Build.** A scheduled job that, when a project sits in one state past a threshold (Bodhi uses 7 and
14 days), sends a proactive "still waiting, here is where it sits, here is who holds it" message and
stamps the portal with a last-checked date.
**Beats what we have:** SolarPro sends mail *only* on stage change, so the longest stage in the
project is also the quietest. This is the single mechanism the corpus most agrees on, and the
"waiting clock resets to zero" rationale is the reason it works.
**Bounded:** one `notifications` table, one cron, reuse `sendStageAdvanceEmail`'s template path.
**Proof:** a project parked in `installation` for 21 days emits messages on day 7, 14 and 21, and the
portal shows a non-stale "last checked" date. This is the **highest-value item in the lane** and
it is blocked on there being no scheduler at all.

### 4. The PTO activation checklist
**Build.** On `pto_approved`, replace the current "You're all set" copy with an ordered activation
checklist — what the homeowner must do (inverter/battery app export permission, any switches) and
what the installer must confirm — with completion state.
**Beats what we have:** three independent videos in this corpus exist *because* the product does not
do this, and one names it "the #2 mistake that kills system performance". SolarPro asserts the
system is live and verifies nothing.
**Bounded:** static per-equipment-family content keyed off the equipment already in the design, plus
one checklist state blob. No integrations required.
**Proof:** a homeowner at `completed` sees equipment-correct steps and can tick them off.

### 5. Answer the top three questions with real data
**Build.** Render (a) the confirmed install date, crew and arrival window from `project_schedule`;
(b) the monitoring app link and credentials as a first-class card, not an optional pasted URL;
(c) a truthful "last updated" stamp on the stage card.
**Beats what we have:** these are 40.7% of all homeowner contacts by Bodhi's own ticket data, and
SolarPro renders none of them. The install date is the single most-asked question in solar and the
data already exists installer-side.
**Bounded:** read-only surfacing of existing tables.
**Proof:** scheduling a project installer-side makes the date appear in the portal with no admin step.

### 6. Auto-provision the portal at signature, and let the co-owner in
**Build.** Fire the portal invite automatically from the sign route (Gallery Group's "upon the
contract going unconditional"), and allow one secondary contact — spouse or co-owner — with their
own OTP against the same project.
**Beats what we have:** the portal is currently gated behind an admin remembering to click
`send-portal-invite`, and a household purchase is keyed to one email.
**Bounded:** one call added to the existing sign route; one `portal_contacts` row type. The OTP
machinery already exists and needs no change.
**Proof:** signing a proposal delivers a portal invite with no human action, and a second contact can
log in and see the same project.

**Deliberately not proposed:** a full chat/inbox (Bodhi Inbox class). It is a support-desk product,
it needs staffing to be anything but a black hole, and it does not serve the wedge. BACKLOG.

---

## EXIT CRITERIA STATUS

| # | Criterion | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | ≥2 materially relevant products | **MET** | Tesla app (3 videos), Buildertrend (watched), Gallery Group (watched), Bodhi (2 videos + 4 docs), Sunvoy (watched), Continuum (watched). |
| 2 | ≥1 official/training source | **MET** | Bodhi `MEY7v8F_DY0`, `6WXUsp7k6dg`; Sunvoy `MUMiW37NFmY`; Gallery Group `xU-8goSTIzg`; plus Bodhi's own documentation. |
| 3 | ≥1 real user/operator source | **MET** | Operators: Earth Right `fHiHAm90yTE`, American Home Contractors `AQbPgLPon-E`, Oakvale/Income Digs `dtAd6WvyTTc`, Continuum `iag2ZE8915E`. Independent user: Zach Solar `vhno896wwJo`. Homeowner complaint: r/TeslaSolar, **secondhand only**. |
| 4 | Core workflow end-to-end | **MET, with a named hole** | Signature→PTO covered end-to-end by `iag2ZE8915E` (all 12 steps with SLAs) and the rationalgo 8-phase model; post-PTO covered by the Tesla videos. **Hole: I never observed a live solar homeowner portal rendering a mid-project waiting state.** Every solar portal source is either a vendor video that does not show the portal (Sunvoy), a ≤60s ad (Bodhi), or documentation. The only *watched* end-to-end portal walkthroughs are non-solar (Buildertrend, Gallery Group). |
| 5 | Findings repeating | **MET** | PTO manual-activation failure appears in 3 independent videos. "Show items not phases" appears in Buildertrend, Gallery Group's Activities feed and the rationalgo model. Proactive time-based updates appear in Bodhi docs ×3 and rationalgo. |
| 6 | Opportunities triaged | **MET** | Every ledger row carries STEAL/ADAPT/REJECT/BACKLOG, impact, value and risk. |
| 7 | SolarPro equivalent audited | **MET** | Audited from code; enum values, line numbers and the disabled `icaTier1` and document-filter lines verified firsthand. |
| 8 | Candidates shipped or backlogged | **NOT MET** | Six candidates are written up but **none is shipped or entered in a backlog** — this lane is read-only by mandate. They are proposals until someone accepts them. |

**Additional gaps, stated plainly:**
- **reddit.com is blocked to this agent's fetcher.** The homeowner-complaint hunt is therefore
  secondhand via a news article quoting the thread. Direct r/solar mining was requested and **was not
  achieved**. Someone with browser access should redo it.
- **PTOEDGE `5h1OIq-un4M` failed permanently** ("This video is not available"). No permit-portal
  vendor walkthrough is in the corpus.
- **Buildertrend's own client-portal page returned HTTP 403**; its AI-Client-Updates feature is
  recorded as unconfirmed.
- **No Bodhi portal walkthrough was found or watched** — only two ≤60s feature ads. Bodhi is the
  category leader and the strongest findings about it come from its own blog, which is marketing.
  This is the weakest sourcing in the lane.

**SATURATION NOT DECLARED.** Criterion 8 fails outright, criterion 4 has a named hole, and the
single most important competitor (Bodhi) has no watched product walkthrough.
