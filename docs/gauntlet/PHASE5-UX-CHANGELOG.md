# Phase 5 — screen-by-screen UX changelog

What the 61 shipped findings change **for a user**. Nothing here is inferred from a
backend fix: where a repair has no user-visible surface it is labelled `BACKEND ONLY`
and says what it protects instead. Where a fix shipped but the page wiring did not, it
says **NOT VISIBLE YET** rather than claiming the screen changed.

Classes: `VISUAL` · `WORKFLOW` · `BEHAVIOR` · `STATUS/COPY` · `BACKEND ONLY`

> **Read this first:** `dev` currently has a **pre-existing peer break** —
> `buildHybridPermitMetering` is imported by `build.ts` but not exported by
> `sldAdapter` at the committed state. Every **hybrid** (multi-subsystem) permit
> generation throws until the peer commits their file. Single-system permits are fine.
> Nothing in Phase 5 caused it and nothing in Phase 5 fixes it.

---

## 1. Dashboard

### 1.1 The three headline CTAs open the modal instead of navigating away — `WORKFLOW`
**BEFORE** Clicking **Resolve Now** on the pulsing red Critical Actions card set a
project into modal state and navigated to `/projects?status=proposal` on the same tick,
so the modal never rendered. Same for **Follow Up** and **Advance**.
**AFTER** The modal opens and stays. The link is still the fallback when there is no
target project.
**WHERE** `/dashboard` → **Full View** toggle (these cards are not in the default
Focus/priority view) → Critical Actions / Follow Up / Advance cards. Also the
**Conversion Rate** tile, a fourth instance that was not in the finding.
**LIVE TEST** Switch to Full View, click **Resolve Now**. A stage-decision modal should
appear and the URL should not change.

### 1.2 The decision modal's stage buttons are no longer both disabled — `WORKFLOW`
**BEFORE** Even with the modal open, *Move to next stage* **and** *Move back one stage*
were both greyed out, because the handler passed the legacy 5-value `status` to a modal
that indexes the 13-stage pipeline (`stageIndex('proposal')` = −1). *Keep in current
stage* would POST a value the API rejects with 400.
**AFTER** The primary action is enabled and Confirm posts a real pipeline stage.
**WHERE** `/dashboard` → any stage CTA → DealDecisionModal.
**LIVE TEST** Open the modal on a project whose sales status is "proposal". *Move to
next stage* should be clickable, and confirming should move the project on the
Operations board.

### 1.3 "Schedule inspection" actually books an inspection — `WORKFLOW`
**BEFORE** Pressing **Execute** showed "Action completed ✓" and created nothing — no
schedule row, no stage change, no audit entry — and the card regenerated, so the same
non-action could be "completed" indefinitely.
**AFTER** A date modal appears. The schedule row is written **first** and its failure
aborts; the stage move follows; the command completes last.
**WHERE** `/dashboard` → Commands/Actions list → an auto-generated "Schedule inspection
for …" card → **Execute**.
**LIVE TEST** Execute an inspection command, pick a date, confirm. The inspection should
then appear in the project's schedule. Cancel instead, and the command should still be
pending — not "completed".

### 1.4 Stall wording and urgency no longer overclaim — `STATUS/COPY`
**BEFORE** "Proposal sent 7d ago with no response" and "9d stalled" in red, both
computed from `projects.updated_at`, which 20+ unrelated writers bump — so a project
parked for six weeks read 0 days as long as anyone saved a layout in the meantime.
**AFTER** When only last-activity is known the card says "no activity on this project
for 7d" / "9d no activity", at **yellow** urgency, not red. When a real stage clock
exists the event phrasing returns.
**WHERE** `/dashboard` → Commands/Actions cards and the stall banner.
**LIVE TEST** Open a project that has sat in one stage a while, edit a note (which bumps
`updated_at`), reload the dashboard. The card should still be there — before, editing
the note made it disappear.
*Historical rows read "no activity" until their next stage change — the real column is a
migration (R12).*

### 1.5 "Engineering Runs: 0 in last 30 days" → a real number, honestly named — `STATUS/COPY`
**BEFORE** The card claimed **0 in last 30 days** permanently, beside a non-zero
all-time total and three neighbouring cards whose 30-day figures were real — which made
the zero look measured.
**AFTER** Renamed **Saved Layouts** with a real 30-day count. Renamed deliberately: the
table holds one row per (project, user), so it counts layouts first created in the
window, not engineering runs. A real number under a false name is still a lie.
**WHERE** `/admin` → System Overview → the Engineering Runs / Saved Layouts card.
**LIVE TEST** Generate a layout on a new project, reload `/admin`. The 30-day figure
should increment.

---

## 2. CRM / Projects

### 2.1 🚨 Signing a proposal now moves the installer's board — `BEHAVIOR`
**BEFORE** A homeowner signs. The proposal view shows a signed contract; the Operations
board still shows **Lead**. `contract_signed_at` was never stamped, no tasks were
generated, and the two commands gated on `contract_signed` (**Schedule install**,
**Engineering review**) never appeared. The statement wrote `projects.stage` — a column
that does not exist — and a bare `catch {}` swallowed the error.
**AFTER** The project advances to **Contract Signed**, `contract_signed_at` is stamped,
stage tasks generate, and the two commands appear.
**WHERE** Homeowner share link → sign → then `/projects` Operations board and
`/dashboard` Commands.
**LIVE TEST** Send yourself a proposal, sign it on the share link, then open the
Operations board. The project should have left the Lead column. Check the dashboard for
a **Schedule install** command.

### 2.2 Creating a proposal advances the pipeline — `BEHAVIOR`
**BEFORE** A project with a generated, shared proposal sat in the **Lead** kanban column
and in Pipeline Control's lead count, while the legacy sales list said **Proposal** —
two numbers for one deal on one dashboard. No "Follow up with …" command was ever
generated for a real sent proposal.
**AFTER** Both columns move to **Proposal Sent**, and the follow-up nag can fire.
**WHERE** Create a proposal → `/projects` board and Pipeline Control counts.
**LIVE TEST** Create a proposal on a Lead project. It should leave the Lead column
immediately, and the two counts should agree.

### 2.3 Every stage change now leaves an audit row — `BEHAVIOR`
**BEFORE** Stage changes made through the decision modal or the project page's Pipeline
Status dropdown wrote **no** activity row, so "who moved this to Permit Approved, and
when" was unanswerable for the majority of transitions. Where a row existed for an
engineering move, its `from_stage` was a fabricated `'contract_signed'` literal.
**AFTER** One writer records every change with the stage it actually read.
**WHERE** Project page → Pipeline Status dropdown, or the decision modal → then the
project timeline in admin.
**LIVE TEST** Move a project two stages via the dropdown, then open its timeline. Two
rows, each with the correct previous stage.

### 2.4 The decision modal's milestone toggles are persisted — `BEHAVIOR`
**BEFORE** The contextual checkboxes were POSTed and silently discarded.
**AFTER** They land in the activity row's metadata.
**WHERE** DealDecisionModal → the milestone checkboxes.
**LIVE TEST** Tick a milestone, confirm, and check the activity row's metadata in admin.
*They are recorded as activity metadata, not as first-class milestone state — R4 is only
partly addressed.*

---

## 3. Proposal

### 3.1 The "ITC: On" badge and the 30% dialog are gone — `VISUAL` + `WORKFLOW`
**BEFORE** Every rep saw a green **✓ ITC: On** badge; touching it opened a dialog saying
the homeowner gets "a 30% Investment Tax Credit" and that removing it "will increase the
net cost by ~30%". Both false for every residential proposal — the document contains
itcRate 0 / $0 / netCost = gross. The toggle changed nothing, so there was no way to
discover the lie from the screen.
**AFTER** A static note: **"Federal residential ITC: repealed (P.L. 119-21)"**. No
toggle, no dialog, no 30% prose.
**WHERE** `/proposals` → open any proposal → the preview toolbar.
**LIVE TEST** Open a proposal. Look for "ITC: On" — it should be gone, replaced by the
repeal note, with nothing to click.

### 3.2 The customer's "Tax credit (0%) −$0 … federal ITC applied" tile is gone — `VISUAL`
**BEFORE** Every homeowner saw an emerald tile claiming a federal ITC was applied, next
to a "Net cost … after incentives" equal to the gross price.
**AFTER** No tile when there is no credit. The net tile reads **"Total investment … no
incentives deducted"**.
**WHERE** Homeowner share link → the cash-flow/savings card.
**LIVE TEST** Open a homeowner share link. There should be no tax-credit tile and no
"after incentives" caption.

### 3.3 The expired "Act Before July 4, 2026" banner is gone — `VISUAL` + `STATUS/COPY`
**BEFORE** Every homeowner — cash or loan, any state — was urged to act before a
deadline 2.5 months past, and promised "a 30% federal tax credit" via a lease or PPA
this product cannot quote. This was the **last path by which a 30% federal credit
reached a residential homeowner's proposal**, as prose rather than a number, which is
why the numeric guards never caught it.
**AFTER** Renders only for a genuine lease/PPA **and** before the real deadline. No
lease/PPA product exists, so it does not render at all today.
**WHERE** Homeowner share link, and the installer preview in `/proposals`.
**LIVE TEST** Open a share link and search the page for "July 4" — nothing.

### 3.4 One SREC number instead of two — `VISUAL`
**BEFORE** The same document showed "Estimated total contract value: $20,400" in the
SREC section and "~$16,970" in Additional State Benefits — a ~$3,400 disagreement,
which also shipped in the emailed PDF because the download screenshots that DOM.
**AFTER** Both read the canonical 25-year SREC figure.
**WHERE** `/proposals` → an Illinois project → SREC section and Additional State
Benefits card.
**LIVE TEST** Open an Illinois proposal and compare the two numbers. They should match.

### 3.5 The invented 7.99% / 25-year loan terms are suppressed — `VISUAL` + `WORKFLOW`
**BEFORE** Every financed proposal stated "25-yr loan at 7.99% APR" and a monthly
payment derived from it. No lender supplied that rate and no installer could change it —
there is no field, column or API parameter. On defaults that is $226/mo on a $29,280
system; a real product at 5.99% is $189 and at 9.99% is $266.
**AFTER** The APR line, the monthly payment and the three-column Loan Term Comparison
are **omitted**, with an amber "no lender terms on file" note instead of silence.
**WHERE** Homeowner share link and `/proposals` preview → the financing section.
**LIVE TEST** Open a proposal. There should be no APR and no monthly payment, and an
explicit note saying why — rather than a confident number.
*Real terms need columns that do not exist (R13).*

### 3.6 A signed homeowner sees their signature — `WORKFLOW`
**BEFORE** Someone who signed, closed the tab and returned to their own link saw no
evidence they had signed — no banner, no name, no date — and was invited to sign again.
Retyping their name produced a hard error, "Proposal has already been signed."
**AFTER** The page loads in its signed state with the signer's name and date.
**WHERE** Homeowner share link, revisited after signing.
**LIVE TEST** Sign a proposal, close the tab, reopen the same link. It should show the
signed state, not a sign form.

### 3.7 The installer's list shows executed contracts as accepted — `BEHAVIOR`
**BEFORE** A signed proposal still read **Draft** in the installer's list; the status
filter and pill counts agreed with the wrong value, so filtering by Signed returned an
empty list while contracts had been executed. Trying to fix it by hand gave a 409.
**AFTER** The column is the authority. Signed reads as accepted, and the filter finds it.
**WHERE** `/proposals` → status badges, the status filter, the pill counts.
**LIVE TEST** Sign a proposal, then filter the list by Signed/Accepted. It should appear.

### 3.8 The warranty claim matches the panel — `STATUS/COPY`
**BEFORE** "25-yr product warranty" with a green check beside the correct model name, on
the document the homeowner is **signing** — including for modules whose real warranty is
12 years, and when no panel was selected at all.
**AFTER** The record's own warranty, or a non-claim ("Manufacturer warranty").
**WHERE** Homeowner share link → equipment cards.
**LIVE TEST** Pick a module with a 12-year product warranty and open the proposal. It
should not say 25 years.

### 3.9 The "Send to client" email — `STATUS/COPY` (email, not a screen)
**BEFORE** The savings line **never rendered** (read off the wrong object, and the
template dropped the line rather than printing $0, so it looked deliberate) — the
homeowner's first impression was a large price with no counterweight. And "Total
investment" was the one figure that still subtracted an ungated commercial 30%: a
$100,000 system was announced as **$70,000** in the email and priced at $100,000 on the
page it linked to.
**AFTER** Both come from the canonical proposal, so the email and the document agree.
**WHERE** `/proposals` → **Send to client**.
**LIVE TEST** Send yourself a proposal email. It should show an annual savings figure,
and its total should match the page.

### 3.10 The server PDF route — `BEHAVIOR`
**BEFORE** A cash buyer's PDF showed a 25-year 7.99% loan payment, and a
fence/ground/carport project with a null `system_type` was labelled "Roof Mount",
priced at the roof $/W and degraded at the roof rate for 25 years (measured: $27,280 vs
$37,400 — **$10,120** understated).
**AFTER** System type is resolved from the layout; finance rows are omitted in cash mode.
**WHERE** `GET /api/proposals/[id]/pdf?token=…` — **no in-app button points here**, so
this affects direct/API callers.
**LIVE TEST** Hit the PDF URL for a fence project with a share token and check the
labelled mount type and price.

---

## 4. Marketplace

### 4.1 🚨 A lead can reach the marketplace at all — `WORKFLOW`
**BEFORE** Clicking **Approve** or **Release to Marketplace** returned "Internal server
error" and persisted nothing. This was the **only** production writer of the feed's
visibility gate, so no lead could be released by any path and contractors saw an empty
Discover tab forever. Two phantom columns, not one — dropping the first just moved the
error down a line.
**AFTER** The release writes. A scoring failure can no longer veto the decision, and a
scoring error is reported rather than silently absent.
**WHERE** `/admin/network` → Screening → **Approve** / **Release to Marketplace**.
**LIVE TEST** Approve a screened lead. It should succeed and then appear in the
contractor feed.

### 4.2 The screening queue shows what is in it — `BEHAVIOR`
**BEFORE** The queue said **"Queue is empty"** with all five counters at 0 whenever the
endpoint failed — which, on the canonical schema, was every time. An operational backlog
looked identical to a clean desk. Two of the counters also read response keys the
endpoint never emitted, so **Pending** and **Running** were pinned at 0 even once the
query worked.
**AFTER** Rows and real counters, all five sharing one vocabulary with `/network/health`.
**WHERE** `/admin/network` → Screening tab.
**LIVE TEST** With leads pending, open the Screening tab. Rows should be listed and
Pending should be non-zero.

### 4.3 Screened leads are no longer all graded F — `BEHAVIOR`
**BEFORE** Every lead came back `fail` / "invalid_address, outside_service_area" / grade
**F**, including a lead with a perfect Illinois address, because the pipeline read
`state` while intake wrote `location_state`. It also asserted "in service area: true, 0
active contractors nearby" for every lead — a claim, not a measurement.
**AFTER** Real addresses screen correctly, and genuinely unmeasured values read NULL
with a `supported` flag rather than a fabricated true.
**WHERE** `/admin/network` → Screening → run screening on a lead.
**LIVE TEST** Screen a lead with a valid in-state address. It should not auto-fail.

### 4.4 Campaign Intel loads — `BEHAVIOR`
**BEFORE** Permanently **"Loading analytics…"**, for every admin, on every load. No
error, no empty state. Five working SQL blocks were invisible because the sixth named a
column that has never existed, and one try/catch turned that into a 500 for the whole tab.
**AFTER** The tab loads. Each section is isolated, and a section that does fail is
reported so the page can say "unavailable" rather than spin forever or show an empty
chart that reads as "no data".
**WHERE** `/admin/network` → **Campaign Intel** tab.
**LIVE TEST** Open Campaign Intel. The funnel, sources, CPL, geography, grades and
volume trend should render instead of a spinner.

### 4.5 Paid-acquisition leads insert — `BACKEND ONLY` (visible as inventory)
**BEFORE** Every Google Ads, Meta and partner-webhook delivery was accepted, logged, and
produced **no opportunity row** — paid acquisition generated zero sellable leads. The
only trace was a console warning blaming a migration that had already shipped.
**AFTER** Both INSERTs use the canonical columns, and a schema mismatch surfaces instead
of masquerading as a pending migration.
**WHERE** Webhook intake → marketplace inventory.
**LIVE TEST** Post a test webhook lead and confirm a row appears in inventory.

*Still open in this lane: a contractor who loses the claim race is refunded but told
"Payment received — lead unlocked". Not fixed.*

---

## 5. Site Survey

### 5.1 A fresh survey no longer claims it saved — `STATUS/COPY` (partial)
**BEFORE** The header read "Saved 09:14" from the moment the link opened, for the whole
session — so a crew could work 40 minutes and not know whether anything persisted. On a
device where localStorage throws it still read "Saved" while nothing had **ever** been
written; the tab reloads and the survey restarts from blank, having reported success the
entire time.
**AFTER** A fresh draft claims nothing. A resumed draft shows a true last-write time.
Every storage access is inside its try, because a blocked browser throws on the property
access, not just the call.
**WHERE** `/survey/[token]` → the header "Saved" indicator.
**LIVE TEST** Open a fresh survey link. The header should NOT show a save time before
you have entered anything.
**NOT VISIBLE YET** Committing each successful save into the header, and the explicit
"Not saved on this device — do not close this page" state, need the survey page wired
(handoff recorded). So a *real* last-save time still is not rendered.

### 5.2 Obstruction photos are no longer mis-attributed — `BACKEND ONLY`
**BEFORE** One photo per category, and the evidence mapper labelled it with the **first**
obstruction in the list — so a chimney photo could be filed as an HVAC unit.
**AFTER** A resolved link wins; a single obstruction is unambiguous so it is used;
otherwise **nothing** is emitted. A dangling link claims nothing.
**WHERE** Engineer-facing evidence/provenance on the survey review page.
**LIVE TEST** Enter two obstructions, attach one photo, and check the engineer's
evidence view — the photo should not be attributed to either by guess.
**NOT VISIBLE YET** The repeatable capture slots exist in the component but the Step-5
page still renders one slot per category, so a crew still cannot take a second
obstruction photo. Wiring is a recorded handoff, and needs a browser pass once wired.

### 5.3 The survey-integration map can go green — `VISUAL`
**BEFORE** Three permanently red "NOT wired" nodes on every project, forever, because
the fields were a type-level `false`. An engineer reading it concluded the survey does
not affect the permit — while surveyed roof type, pitch, rafter size/spacing, main panel
amps, panel brand, meter type, interconnection method and bus rating **were** overriding
design values on the plan set.
**AFTER** The permit node is computed and goes green when the survey really did reach
the permit.
**WHERE** `/admin/topography` → Site Survey Integration.
**LIVE TEST** Open a project that has a completed survey and a generated permit. The
permit node should be green.
*Three of the four nodes are honestly still red — verified: those consumers genuinely
compute and discard. They were telling the truth.*

---

## 6. Homeowner Portal

### 6.1 🚨 The uploaded bill is kept — `BEHAVIOR`
**BEFORE** A homeowner uploads their electric bill PDF. The portal says "Utility bill
received ✓" and the PDF is **gone** — only a ~200-byte JSON summary survived, filed
under the name the installer's engineering page labels "Original Utility Bill". The route
returns a `confidence` field and nobody could check the original. Re-upload was
impossible.
**AFTER** The original bytes are stored first — a failure fails the request, so nothing
latches and the homeowner can retry — with the summary filed separately as Bill Data.
**WHERE** Portal → Upload utility bill → then the installer's engineering page → Client
Files.
**LIVE TEST** Upload a bill PDF through the portal, then open it from the installer side.
You should get your PDF, not a JSON blob.

### 6.2 No fabricated milestones — `STATUS/COPY`
**BEFORE** One admin click wrote a customer-visible lie. "Under Review" told the
homeowner **"Your utility bill was received"** on the same screen still asking them to
upload it. "Home Visit" told them **"Site visit report submitted"** while the card said a
technician *will* visit. "Installation" told them **"Installation crew arrived at your
home"** while the card said permits were still being handled.
**AFTER** A manual stage change is recorded only as "Milestone reached: …". No outcome is
asserted from a phase selection.
**WHERE** Admin → project → **Save Stage** → then the portal activity feed.
**LIVE TEST** Set a project to "Under Review" and open the portal. It must not say the
bill was received.

### 6.3 Setting "Installation" no longer claims the customer signed — `STATUS/COPY`
**BEFORE** Advancing a customer to Installation made their own portal state, **with
today's date**, that they signed the agreement — on projects where no proposal was ever
sent. A customer disputing a contract had a screenshot of the vendor's system claiming
they signed.
**AFTER** `contract_signed` is written only by the signature path.
**WHERE** Admin → homeowner stage → Installation → then the portal activity feed.
**LIVE TEST** Set a never-proposed project to Installation. The portal must not claim a
signature.

### 6.4 The stage email matches the page it links to — `STATUS/COPY`
**BEFORE** The email said the crew was on site today; the page it linked to said
installation was still being planned. One admin action, two minutes apart.
**AFTER** Both read one shared stage-content module.
**WHERE** Admin → Save Stage → the homeowner's email → the button in it.
**LIVE TEST** Advance a stage, read the email, click through. The two should agree.

### 6.5 The admin preview shows the real content — `VISUAL` + `STATUS/COPY`
**BEFORE** A third hardcoded copy, captioned **"This is exactly what your customer
sees"**, showed different words, a different step name, and none of the things the
customer could act on.
**AFTER** Renders the shared content. The "exactly what they see" claim is **dropped** and
replaced by a notice stating what the preview does and does not reproduce.
**WHERE** Admin → project → Portal Preview.
**LIVE TEST** Open the preview beside the real portal in another tab. The stage label and
copy should match.

### 6.6 One production number, not two — `VISUAL`
**BEFORE** Two cards on the same screen gave different answers to "how much will my
system make?" and "how much CO2 do I offset?" — 300 kWh/yr and 0.1 tons apart, with no
indication which was right, and the savings figure derived from the wrong one.
**AFTER** Both derive from one module.
**WHERE** Portal → Projected Benefits and the production card.
**LIVE TEST** Open a completed-stage portal and compare the two figures.

### 6.7 The document download works — `WORKFLOW`
**BEFORE** A download icon that was not a control, with no endpoint behind it. Clicking
did nothing — no error, no spinner, no file.
**AFTER** A real link to a scoped endpoint that verifies the session owns the project and
allows only homeowner file types. The glyph renders as a link **only** when the row has
an id.
**WHERE** Portal → Your Documents → the download icon.
**LIVE TEST** Upload a bill, then download it from Your Documents. You should get the
file. (Security: another client's file id must 404.)

### 6.8 The referral link goes somewhere — `WORKFLOW` (partial)
**BEFORE** It landed the neighbour on a homeowner sign-in page for an account that does
not exist — no quote form, no path forward — and recorded nothing, so the referrer was
never credited. It also never appeared at install-scheduled because the gate compared a
micro-stage name against a stage.
**AFTER** Points at the public intake funnel carrying the **client id**, and the gate
works.
**WHERE** Portal → Refer a friend.
**LIVE TEST** Copy the referral link and open it in a private window. It should land on
the estimate funnel, not a login wall.
**PARTIAL** Attribution rides in `utm_content` and survives to the lead, but persisting
it as a first-class `referral_code` needs the funnel page and intake route — **BLOCKED**,
not done.

---

## 7. Admin

### 7.1 🚨 "All Systems Operational" can now fail — `VISUAL` + `STATUS/COPY`
**BEFORE** Four of six service tiles were hardcoded `'ok'` with invented latencies of
12/25/45/18 ms. An admin opening the page while file storage was unreachable or JWT
verification misconfigured saw a green banner, "6/6 services healthy", and four green
gauges. The fake values also kept the banner green during a partial outage — the page
actively suppressed the signal it exists to give.
**AFTER** Banner reads **"Monitored Systems Operational"** with "4 subsystems not
monitored — this banner says nothing about them". Count reads **2/2**. The four unmeasured
subsystems are dashed grey "Not monitored" tiles with **no status and no latency**, each
carrying its reason.
**WHERE** `/admin/health`.
**LIVE TEST** Open `/admin/health`. You should see 2/2 and four explicitly
not-monitored tiles, with no invented millisecond figures.

### 7.2 Billing totals no longer cap at 100 — `BEHAVIOR`
**BEFORE** MRR, Active subs and Total subs were computed over only the first Stripe page,
so past 100 subscription objects the MRR tile silently understated revenue and Total subs
froze at exactly 100 forever. Because cancelled subs consume page slots, the undercount
arrived well before 100 paying customers existed.
**AFTER** Pages through, with a `partial` flag when a hard bound is hit.
**WHERE** `/admin/billing`.
**LIVE TEST** Compare Total subs against the Stripe dashboard.
**NOT VISIBLE YET** The page still needs to read the `partial` flag and print "10,000+
(partial)" rather than a bare total — recorded handoff.

---

## 8. Procurement / BOM

### 8.1 🚨 The distributor pricing page opens — `WORKFLOW`
**BEFORE** Clicking **Distributor Prices** threw a render-time TypeError the moment the
fetch resolved ("Cannot read properties of undefined"). The whole screen was unusable —
and it is the **only** UI for the table that is the top-priority price authority for
every BOM dollar figure, the $/W KPI and the BOM Cost tile.
**AFTER** The page renders. Catalog cells and the average stat show real dollars instead
of NaN, and Export CSV no longer emits blank columns.
**WHERE** `/admin/distributor-prices`.
**LIVE TEST** Open the page. It should render a priced catalog, with no NaN.

### 8.2 A contract price can be saved — `WORKFLOW`
**BEFORE** Save always failed with "part_number is required"; delete always failed with
"HTTP 400". And once those were fixed, the next attempt 500'd on an `ON CONFLICT` against
a unique index that **does not exist**. So the table could only ever hold migration 015's
seed rows, and every BOM total was priced off a static Q1-2025 catalog.
**AFTER** Add, edit and delete all work, through an UPDATE-then-INSERT that needs no index.
**LIVE TEST** Add a price override for a Powerwall 3, save, reload, then delete it.

### 8.3 A company override actually wins — `BEHAVIOR`
**BEFORE** For the 21 SKUs migration 015 seeds globally, a company-specific override was
fetched, ordered first and then **thrown away** — so a company whose real Powerwall 3 net
is $7,100 still got $8,280 per battery. Overrides for any other part number worked, which
made the failure look random rather than systematic.
**AFTER** First-wins precedence, in both places the bug lived.
**WHERE** Engineering → BOM → Est. Hardware Cost and the $/W tile.
**LIVE TEST** Set a company override for a Powerwall 3 well below the seed, then run a
BOM on a battery design. The hardware cost should drop.

### 8.4 The archived BOM CSV is orderable — `BEHAVIOR`
**BEFORE** BOM_<project>.csv in Client Files — the document the purchaser opens — had no
Part Number, no cost columns, and an always-empty `Tag` column. Every SKU the engine had
already resolved had to be looked up by hand.
**AFTER** Part Number, Unit Cost and Total Cost. An **unpriced** line prints an empty cell,
never `$0.00` — a row the engine could not price must not read as free.
**WHERE** Project → Client Files → BOM_<project>.csv.
**LIVE TEST** Run engineering, then download the archived BOM CSV and look for SKUs and
prices.

### 8.5 The BOM stops buying parts that do not exist — `BEHAVIOR`
**BEFORE** A 320 A service with a 200 A main produced the line **"184A Backfeed Breaker,
QO184"** — Square D does not make it. Hybrid projects shipped a phantom ground rod,
acorn clamp and 50 ft of bare copper and printed "NEC 250.52(A)(5): … required", while the
plan set printed that no new electrode is added. The GEC billed 50 ft of #2 where
250.66(A) caps a rod-only GEC at #6, and the EGC went flat at #6 above 100 A — a 300 A
feeder shipped #6 where the code requires #4.
**AFTER** Every emitted breaker is a real NEC 240.6(A) rating; grounding conductors come
from the published tables; no phantom electrode on a hybrid.
**WHERE** Engineering → BOM line items and compliance notes.
**LIVE TEST** Run a BOM on a 320 A service with a 200 A main. The backfeed breaker should
be a real size (175 A), not 184 A.

*Still open: the BOM is not invalidated when you swap equipment — the stale copy is still
auto-written to Client Files. Blocked on a peer-owned file.*

---

## 9. Finance / Pricing

### 9.1 🚨 Margins are no longer readable by the internet — `BACKEND ONLY`
**BEFORE** `GET /api/pricing` was in PUBLIC_PATHS under "Safe public endpoints" and
returned the whole config — labor cost, equipment cost, profit margin, overhead percent —
to any unauthenticated request.
**AFTER** An allowlist: unauthenticated callers get the customer-facing sell prices only.
Applied on the success path **and** the DB-error fallback, which carried the same margin
defaults. The path stays public because the homeowner share view fetches it with no
session and swallows errors — a 401 would have silently re-quoted the customer from
hardcoded defaults.
**LIVE TEST** In a private window (signed out), open `/api/pricing`. You should see
`pricePerWatt` but **no** `profitMargin`, `laborCostPerWatt` or `overheadPercent`.

### 9.2 The installer's margin card matches the quoted price — `BEHAVIOR`
**BEFORE** "Your margin — Internal only" was computed from a price the customer never
sees. On defaults, 20 × 440 W: the customer pays $29,280, the card showed Revenue
**$27,280** and Margin **42.3%** against a true 46.3%. At 500 W it **inverts**: Revenue
$31,000, Margin 43.2% against an actual 39.9% — overstated, the direction that makes an
installer grant a discount they cannot afford, which is the exact failure the card's own
comment said it was built to prevent.
**AFTER** Revenue is the quoted cash price; margin follows. Equipment cost resolves per
system type, so a Sol Fence job's internal cost goes 15,728 → 19,952.
**WHERE** Design Studio → the "Your margin — Internal only" panel.
**LIVE TEST** Note the customer's quoted price, then open the margin card. Revenue should
equal the quote.
*No customer-facing number moved — asserted, not assumed.*

---

## 10. Engineering

### 10.1 The interconnection method says "unresolved" instead of guessing — `STATUS/COPY`
**BEFORE** Load-side vs supply-side was decided by `busbar × 0.2` — not a rule the NEC
states — with **one** field standing in for both the busbar and the main breaker, and a
fabricated 200 A busbar when the survey was silent. "Supply-side" is not a label: it
deletes the backfed breaker from the BOM and adds three multi-tap connectors plus a fused
disconnect that must **be** the OCPD. A derated-main service was quoted and drawn for a
utility-coordinated line-side tap it does not need.
**AFTER** The real 120% rule when both ratings are known; otherwise **"UNRESOLVED —
survey required"** with the reason in the compliance notes and an ACTION REQUIRED line.
**WHERE** Engineering report → Interconnection, and the compliance notes.
**LIVE TEST** Run engineering on a project with no survey panel data. It should say
unresolved, not pick a method.

### 10.2 An unresolved battery prints PENDING, and blocks release — `STATUS/COPY` + `WORKFLOW`
**BEFORE** A design whose battery could not be resolved got a stamped **"120% RULE
PASS"** on PV-4A, computed from a sum missing the battery term — while the engineering
page, running a different engine on the same design, refused outright. The permit, the
artifact that goes to the AHJ, was the permissive one.
**AFTER** PV-4A prints **PENDING** (the rule was not evaluated; it did not fail), and a
new blocking release gate stops the package shipping with a verdict nobody reached.
**WHERE** Permit → PV-4A 120% row; the release-gate blocker list.
**LIVE TEST** Add a battery by free-text brand/model that is not in the catalogue and
generate a permit. The 120% row should read PENDING and the package should be blocked.

### 10.3 Conduit sizes and DC fuses come from the code, not a bracket — `BEHAVIOR`
**BEFORE** The conduit trade size on the equipment schedule and the SLD came from an
**ampacity bracket** with no area, no fill percentage and no conductor count — a ≥5-string
design got 3/4" EMT at 43.5% fill against the 40% limit. And the DC string fuse was
Isc × 1.56 with **no cap** against the module's own maximum: a 25 A fuse on a Trina Vertex
S+ 435W listed at 20 A max, **purchased**, on a package that printed the 20 A limit two
sheets earlier.
**AFTER** Conduit from real Chapter 9 areas and fill limits, or **PENDING** rather than a
fabricated size. The fuse is capped at the module's listed maximum, and an unresolved
module reports no limit rather than inventing 20 A.
**WHERE** Engineering → equipment schedule, SLD wire labels, permit SCHED sheet.
**LIVE TEST** Run a 6-string design and check the DC conduit size changes with string
count — before, it did not.

### 10.4 The string-length ceiling reads the site — `BEHAVIOR`
**BEFORE** A blanket Voc × 1.25 with a hard 20-panel clamp, ignoring the module
coefficient and the site entirely, so a Florida job was capped as if at −38 °C — more
strings, more MPPT channels, sometimes another inverter than the design needs. And the
"DC Voltage" printed was the STC sum, not the NEC 690.7(A) maximum, so a reader checking
headroom against a 600 V inverter read 496 V for a string whose real maximum is 563 V.
**AFTER** The published cold-Voc law on the site's design minimum, the ceiling from the
inverter record, and both voltages carried.
**WHERE** Engineering report → string layout and DC Voltage.
**LIVE TEST** Run the same design with the project in FL and then in MN. The panels-per-
string should differ — before, it was identical everywhere.

### 10.5 A module/inverter pairing that exceeds the input voltage is caught — `BEHAVIOR`
**BEFORE** The compatibility gate was **temperature-blind**: the engine held the design
temperature and never passed it, so on every site colder than −10 °C (40 states) the gate
used the warmest row of Table 690.7(A), landed on "marginal" instead of "incompatible",
and the non-compliant module stayed selected into the layout, the BOM and the permit. The
permit engine then rejected the same module on the real basis — a red banner on a design
the designer was told was fine.
**AFTER** The gate reads the site temperature and the module's own coefficient.
**WHERE** Design Studio → module/brand selection warnings.
**LIVE TEST** In a cold state, pick a high-Voc module against a micro brand. You should
get a firm incompatibility or auto-swap, not a soft "marginal".

### 10.6 NEC table single-sourcing — `BACKEND ONLY`
Six copies of Table 250.122, three of Table 250.66, two OCPD ladders differing only by a
capital letter, a ladder that invented ratings above 1200 A, and a resistance table that
skipped #3 AWG and stopped at #2/0 — which made `calcVoltageDrop` return **0** for three
selectable gauges, and `0 <= anyLimit` passes. These are now one authority each. No screen
changes; the numbers on the planset, the schedule and the BOM do.
**LIVE TEST** Indirect: 8.5, 10.3 and the route-length note on PV-4B for a #3/0 or #4/0
feeder, which previously could not be produced at all.

---

## 11. Enterprise / Organization

### 11.1 🚨 A non-admin cannot rewrite the shared equipment catalog — `BEHAVIOR`
**BEFORE** The catalog behind `/api/hardware` is a **single process-global object with no
tenant key**, and POST/PUT/DELETE were gated on a session only. Company B's engineer could
change the width or pricing of a panel Company A designs with, or delete it out of every
organisation's picker. GET served the merged result, including whatever anyone injected,
with no authentication.
**AFTER** All three verbs require admin. Safe because the only mutating UI is the admin
hardware page — Design Studio, DesignSidebar and DesignTab only read.
**WHERE** `/admin/hardware` (still works), versus a non-admin session.
**LIVE TEST** Signed in as a non-admin, from the browser console:
`fetch('/api/hardware',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({type:'panel',id:'panel-std440',data:{width:9}})}).then(r=>r.status)`
→ expect **403**. Then confirm the panel picker is unchanged.
*Still open: the catalog is admin-only but **not per-organisation**, and the mutators do
not persist, so an admin's change reverts at the next cold start. Durable per-owner
storage is R16.*

### 11.2 Member management authorization — `BACKEND ONLY` *(Phase 4, listed for completeness)*
Four member mutations ran with **no authorization at all** when one flag was off — a
viewer could promote themselves to owner — and removing a member from one org cleared
their pointer to a **different** org. Both fixed in Phase 4 (`6115a285`, `db3180e5`).
**LIVE TEST** As a viewer, attempt a role change via the API → expect a refusal.

---

## Not in this changelog, on purpose

- **13 engineering findings remain**, 6 of them blocked on the peer's uncommitted files.
  None has a user-visible fix yet.
- **The migration campaign did not advance.** R8 is unchanged.
- **R11 (Exposure B Kz)** is untouched — the value is unchanged pending an engineering
  ruling.
- **No browser/live proof was run** in Phase 5. Everything above is covered by
  behavioural tests against real PostgreSQL or jsdom renders; the interactive 3D
  surfaces were LIVE ACCEPTED in Phase 4 and were not touched.
