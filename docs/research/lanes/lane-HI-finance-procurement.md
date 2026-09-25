# Lane H + I — Finance / TPO and Procurement / Distribution UX

Research worker output. **UX mining for SolarPro — not a market report.**
Written 2026-09-25. Evidence base: 5 videos actually downloaded, frame-cut and read
(`tools/watch/<id>/`), plus official product documentation and two regulator sources.
Every ledger row carries a real URL or YouTube id.

**Evidence honesty note.** Three documentation sites (`support.opensolar.com`,
`help.aurorasolar.com`) return HTTP 403 to WebFetch and browser navigation to
`support.opensolar.com` was denied in this environment. Where that happened the row is
labelled **`doc (search-index only)`** — the content came from the search engine's
indexed extract of the page, not from a page I loaded. Those rows are weaker evidence
than the video rows and are marked as such. Marketing pages are labelled `marketing`
and are never used as sole evidence for a behaviour claim.

---
---

# HALF H — FINANCE / TPO

## SUMMARY — transferable interaction principles

1. **One cost number, many presentations.** Aurora prints `Total system cost (includes
   incentives applied today)` beside `Net cost (includes incentives applied later)` —
   two labels, one underlying cost. That is the shape SolarPro wants.
2. **The opposite shape is the trap.** OpenSolar's pricing panel is headed
   `Price breakdown for [Sungage — 20 years 0.9%]`: the finance product *selects* the
   price. Same design, different total per payment option. This is proposal-only
   pricing with extra steps.
3. **Name who claims the incentive.** OpenSolar splits incentives into
   `Claimed By Installer` / `Claimed By Customer`. That single field is the §48E-vs-§25D
   distinction SolarPro currently carries only in code comments.
4. **A dealer fee is a finance-product artifact, never a project cost.** Aurora keeps it
   out of the tax basis by default and exposes one explicit toggle
   (`Incentives apply to dealer fee`, off by default).
5. **Internal-vs-customer visibility is a per-line property**, not a per-screen one.
   OpenSolar footnotes: `* Base price and dealer fee breakdown not visible to customer.`
6. **Default-on incentives are the liability.** Aurora's incentive row ships
   `Applied? = on`, `-30.00%`, `system cost` — in a demo published **28 Oct 2025**,
   after §25D was already repealed for 2026 installs.
7. **A free-form price override with no reason field is a hole.** OpenSolar shows
   `Price Override Adjustment $6,106` as a first-class line with no captured basis.
8. **Comparison is opt-in and explicit** (`Include comparison in the proposal` toggle) —
   a good pattern: the rep decides what the homeowner sees, in one switch.
9. **Re-amortisation must be modelled as a stated assumption, not a payment.** Aurora's
   incentive-paydown loan is a mortgage loan + a 0% bullet loan sized to the credit;
   if the homeowner never pays it down, the payment jumps.
10. **The user's own workaround is the design brief:** "Ask every installer for the cash
    price. Not the net cost after incentives." Make the cash price the loudest number.
11. **Show the amount financed at least as prominently as the net cost.** The CFPB found
    the inverse presentation is the industry's documented harm.
12. **Credit application belongs beside the proposal, not inside the project model** —
    apply/approve in-session, write nothing back to the engineered design.

## LEDGER — Half H

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | verdict | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| video | Aurora Solar — Sales Mode | Aurora Sales Mode Demo | `aBy9AeiUPf0` (youtube.com/watch?v=aBy9AeiUPf0) | 2025-03-27 | official (AuroraSolarInc) | full 23:40 transcript + 36 scene frames + 2 targeted frame extractions | 18:42 pricing/gross PPW; 18:56 inline-edit adders; 19:10 discounts; **19:13 "Incentives will automatically, of course, pull the renewable energy tax credit"**; 19:37–20:05 lender integrations; 20:19–20:53 custom finance product build; 20:54 side-by-side ROI; **21:24 proposal System Summary** | address → design → pricing → adders/discounts/incentives → financing → compare → live proposal | Adders are itemised and inline-editable (`MSP Upgrade $3,500.00`); incentive carries an `Up to` qualifier; finance options are comparable side by side and inclusion in the proposal is an explicit choice | Federal credit is **auto-pulled** with no eligibility question; at 21:24 the summary shows `Residential Renewable Energy Tax Credit  -$15,090.00` on a $50,300 gross = exactly 30%, feeding `Net $35,210.00` and `Payback 7.12 years` | none shown in-product | `GLOBAL_INCENTIVES_CONFIG.allow_itc = false` (`lib/incentivesConfig.ts`); `guardItcValue()` logs `[INCENTIVE LEAK DETECTED]` and forces 0; `buildCanonicalProposal.ts:714-726` calls both | **ADAPT** (adders/itemisation) + **REJECT** (auto-pull) | HIGH | HIGH — "we never auto-apply a dead credit" is a demo line | LOW | evidence captured |
| video | Aurora Solar — Sales Mode (post-repeal) | Aurora Solar Residential Enterprise Plan Demo | `8cjFBN1GOBE` | **2025-10-28** | official (AuroraSolarInc) | full 15:41 transcript + 36 scene frames + 4 targeted frame extractions | 11:47 pricing modes (PPW / component-based / flat price entered elsewhere); **12:05 Incentives screen**; 12:07–12:12 "cash, loan, lease, or PPAs"; 12:23–12:34 lenders (GoodLeap, Mosaic, Dividend, Sungage) and **TPO (GoodLeap, LightReach, EnFin)**; 12:40–12:46 apply + approve in Sales Mode; **12:52 Compare financing options**; 13:01 automated contract + e-signature | pricing → adders/discounts/incentives → financing type → compare → contract/e-sign → PDF or web proposal | **The two-label pattern (the steal):** `Total system cost (Includes incentives applied today) $23,315.00` vs `Net cost (Includes incentives applied later) $16,320.50` — one cost, two stated timings. Incentives are a table with `Applied?` toggle, `Amount`, `Unit` (`system cost`), `Total`. `Include comparison in the proposal` is an explicit toggle. Guardrails claim at 13:58: "not selling something that can't be installed" | Single incentive row `Residential Renewable Energy Tax Credit`, `-30.00%`, **toggle ON by default**, in a demo published four months after P.L. 119-21 was signed. `Payback period 6.7 years` is computed off the credited number | none shown | SolarPro's canonical proposal has **one** cost: `gross_system_cost === systemCost === effectiveFinal` (`buildCanonicalProposal.ts:840-841`), sourced from `storedCashPrice` on the project record. `netCost` is derived, `itcRate`/`itcAmount` are gated | **STEAL** the two-label pattern; **REJECT** default-on residential credit | HIGH | HIGH | LOW (labels only) | evidence captured |
| video | OpenSolar 2.0 | OpenSolar Demo | `wsB6VRCWerY` | 2022-04-29 | official (OpenSolar) | full 25:34 transcript + 36 scene frames + 2 targeted frame extractions | **11:08 Pricing tab**; 11:15 "any dealer fee if you're working with a loan"; **11:30 Incentives tab**; 11:28 "any default incentives will be automatically added onto your project but you can always override"; 11:45 payment options default-added and removable; 23:00–23:16 financial integrations; 23:20 standard hardware favourites | design → pricing (per finance product) → incentives → payment options → duplicate system for option B → proposal | Pricing panel is fully itemised and each line names its basis: `Base Price $19,470` → `Inverter and Modules (3700 watts @ $3.55/w ex tax) $13,118`, `Battery (12.6 kWh @ $363.64/kWh ex tax) $4,582`, `Tax (@ 10%) $1,770`; `Dealer Fee $83 (@ 0.39% of system cost, fixed $0)`; `Margin $21,945 / 88.1%` shown to the rep; explicit footnote **`* Base price and dealer fee breakdown not visible to customer.`** Incentives split into **`Claimed By Installer`** and **`Claimed By Customer`** (`Federal Investment Tax Credit (ITC): $5,543.20`) under an `Override Default Incentives` switch | **The header reads `Price breakdown for [Sungage — 20 years 0.9…]` — the finance product selects the price breakdown.** `Price Override Adjustment $6,106` is a free-form line with no visible reason/basis field. Incentives default-applied | rep "duplicates the system" to show a second priced option — i.e. clones the project to vary price | SolarPro has **no dealer-fee concept at all**: the only occurrence of `dealer_fee` in the repo is `tests/marketplace-intelligence.test.ts:545` asserting it must **not** appear in output. `purchaseMode` is only `'finance' \| 'cash'` — no lease/PPA/TPO product exists | **STEAL** (line-level basis text + customer-visibility flag + claimed-by field); **REJECT** (price keyed to finance product; unexplained override) | HIGH | HIGH | MED (claimed-by is a new field on the incentive model) | evidence captured |
| video | (consumer / affiliate advocacy) | How Smart Homeowners Are Ditching Dealer Fees: The Solar Loan Escape | `DvwcDCblOuo` | 2026-05-19 | **operator/consumer — affiliate-monetised; treat its lender recommendations as advocacy, its workflow observations as usable** | full 17:17 transcript + 36 scene frames (audio-led; no product UI on screen) | 01:32 cash price $26,000; 02:54–03:23 §25D "gave homeowners 30% back… That credit is gone"; 03:34 "$0 in federal tax credits"; **03:51–04:14 re-amortisation trigger**; 04:34–04:58 CFPB Aug-2024 spotlight, "inflated loan balance in small light font, while the net cost after an assumed tax credit is displayed in large bright text"; 05:04–05:18 Minnesota AG suit vs GoodLeap / Sunlight / Mosaic / Dividend; **12:18–13:02 the three-step buyer script** | homeowner-side: get cash price → get financed price → difference is the dealer fee → shop own financing | Names the exact number a buyer must demand and why | n/a (not a product) | **"Ask every installer for the cash price. Not the finance price. Not the net cost after incentives. The cash price."** — and: if the installer can't produce it, walk away | SolarPro's cash price *is* the single stored number (`costEstimate.cashPrice` → `storedCashPrice` → `systemCost`). The homeowner-facing surface does not yet *label* it as "cash price" beside an amount-financed figure | **STEAL** — make cash price the headline and amount-financed equally prominent | HIGH | HIGH | LOW | evidence captured |
| doc (search-index only) | Aurora Solar Help Center | Loan Dealer Fee / Loan Modeling Overview / Loans: Mortgage-Style w/ Incentive Paydown | `help.aurorasolar.com/hc/en-us/articles/360024864233-Loan-Dealer-Fee`, `.../4412799401875-Loan-Modeling-Overview`, `.../224146648-Loans-Mortgage-Style-w-Incentive-Paydown` | undated help center | official docs — **WebFetch returned 403; content is the search engine's indexed extract, not a page I loaded** | n/a | n/a | configure a custom loan product: dealer fee % → incentive treatment → prepayment amount/month → re-amortise | Dealer fee is a **percentage added onto the loan principal**, stated as such. Below it sits one toggle: **`Incentives apply to dealer fee`, off by default** — on = the fee is added to system cost *before* incentives and the tax basis are computed. Prepayment has two sub-fields, `Amount` (% of financed) and `Month`, and the loan visibly re-amortises | The incentive-paydown product models a 0%-interest bullet loan sized to the ITC that the homeowner is *assumed* to pay down; if they don't, "the accrued amount is added to the principal and monthly payments increase" — a structure whose premise no longer exists for 2026 customer-owned systems | n/a | no dealer fee, no prepayment/re-amortisation model; `financeApr` defaults to 7.99% and `financeTermYears` to 25 as bare literals (`buildCanonicalProposal.ts:644-645`) | **ADAPT** — if SolarPro ever adds a dealer fee, copy the explicit tax-basis toggle and default it OFF | MED | MED | MED | backlog |
| doc (search-index only) | OpenSolar | Pricing & Payment Options / PPA / LEASE / Checkout Financing support articles | `support.opensolar.com/hc/en-us/articles/4408435379481`, `.../4407118437273` (PPA), `.../4407123995929` (LEASE), `.../11977710781583` (Checkout Financing) | undated | official docs — **403 to WebFetch, browser navigation denied; search-index extract only** | n/a | n/a | Control Zone → Pricing & Payment → `+ Add Payment Option` → type (Cash / Loan / Lease / Regular Payments / PPA) → account-wide or per-project | Payment options are configurable at **both** account level and project level, so a company default exists and a project can deviate deliberately. PPA fields are exactly the two that matter: price per kWh consumed on-site and annual escalation rate. Loan supports dealer fee as **% of loan amount or fixed $ per project**, plus required down payment | Per-project deviation with no recorded reason is the same hole as the `Price Override Adjustment` seen on video | n/a | SolarPro has no payment-option object at all; `purchaseMode` is a two-value enum | **BACKLOG** — a payment-option object with account default + per-project deviation *and a required reason* is the right eventual shape | MED | MED | MED | backlog |
| doc | Consumer Financial Protection Bureau | Issue Spotlight: Solar Financing / "CFPB Report Finds Lenders Cramming Markup Fees and Confusing Terms into Solar Energy Loans" | `consumerfinance.gov/data-research/research-reports/issue-spotlight-solar-financing/` | 2024-08-07 | **regulator** | n/a | n/a | n/a | Names four consumer-risk areas: hidden markups and fees; misleading claims about what consumers will pay; ballooning monthly payments; **exaggerated savings claims** | Documents that dealer fees routinely raise principal 30%+ over cash price and are **excluded from the stated APR** | n/a | SolarPro's `netDifferenceFinanced` is deliberately reported *separately* from `netDifference` and is documented as possibly negative for high-APR/long-term loans (`canonicalProposal.ts:400-406`) — this is already anti-"exaggerated savings" | **STEAL** as the compliance frame for the whole lane | HIGH | HIGH | LOW | evidence captured |
| doc | IntegrateSun (installer) | Solar Dealer Fees Explained: The Hidden Cost Inflating Your Loan (2026) | `integratesun.com/post/solar-dealer-fees-hidden-cost` | 2026-07-15 (updated 2026-08-18) | operator (installer blog — commercially interested) | n/a | n/a | n/a | States the arithmetic plainly: dealer fee = financed amount − cash price | Quotes the presentation tactic: real loan amount "in a small, light font", net system cost "in a large, bright font"; and: **"Any 'net cost' math built on a 30% credit is, for a 2026 loan buyer, simply fiction."** Also: many loans step the payment up unless the buyer prepays ~30% — the presumed credit | three transparency questions to put to the installer | SolarPro cannot produce that fiction today: `isItcEnabled()` returns false and `guardItcValue()` zeroes any leak | **STEAL** as marketing/positioning copy | MED | HIGH | LOW | evidence captured |
| doc | CRS (congress.gov) + IRS | "Expiration and Carryforward Rules for the Residential Clean Energy Credit" (IN12611); IRS FAQs for modification of §§25C, 25D… under P.L. 119-21 | `congress.gov/crs-product/IN12611`; `irs.gov/newsroom/faqs-for-modification-of-sections-25c-25d-25e-30c-30d-45l-45w-and-179d-under-public-law-119-21-139-stat-72-july-4-2025-commonly-known-as-the-one-big-beautiful-bill-obbb` | P.L. 119-21 signed 2025-07-04 | **official / regulator** | n/a | n/a | n/a | **The project note is VERIFIED.** §25D is repealed for expenditures made after 2025-12-31; an expenditure is "made" when the **original installation is completed**, so a 2026 completion cannot claim it. Pre-2026 expenditures retain their carryforward | n/a | n/a | `lib/incentivesConfig.ts` states this correctly and gates on it. **But see the SolarPro audit below — two stale 30% residential constants and one factually wrong comment survive in the repo** | **STEAL** (already done) + **fix the stale comment** | HIGH | HIGH | LOW | evidence captured; one repo defect logged below |

## TOP CANDIDATES — Half H (max 4)

1. **The two-label cost pattern (STEAL, LOW risk).** From Aurora `8cjFBN1GOBE` @12:52.
   Ship `Total system cost` and `Net cost` as two *labelled* readings of the **same**
   `financial.systemCost`, each carrying its timing phrase. SolarPro already has the one
   number (`gross_system_cost === systemCost`); this is a labelling change in the
   proposal render layer, not a model change. It directly answers "how does finance fit
   in without hijacking the project model": it doesn't — it re-labels.

2. **`claimedBy` on every incentive (STEAL, MED risk).** From OpenSolar `wsB6VRCWerY`
   @11:30 (`Claimed By Installer` / `Claimed By Customer`). SolarPro's
   `incentivesConfig.ts` *describes* the §48E-is-a-company-credit / §25D-is-a-homeowner-
   credit distinction in a comment and enforces it only via `allow_section48e` plus a
   prose instruction ("Only show §48E messaging when financeType = 'lease' or 'ppa'").
   Making `claimedBy: 'installer' | 'customer'` a required field on the incentive record
   turns that comment into a type the compiler enforces — and is the prerequisite for
   ever adding lease/PPA.

3. **Cash price as the headline number (STEAL, LOW risk).** From `DvwcDCblOuo` @12:18 and
   the CFPB spotlight. Print the cash price largest, the amount financed at equal weight,
   and the net-of-incentives figure smallest with its timing caveat — the exact inverse
   of the presentation the CFPB called out. This is a differentiator SolarPro can claim
   truthfully today because it has no dealer fee to hide.

4. **Fix the three stale residential-ITC artifacts (BACKLOG → do it, LOW risk).** See the
   audit section: `lib/db.ts:608` carries `taxCreditRate: 30` with the comment
   *"P.L. 119-21 has NOT been enacted; do not treat as current law"* — which is factually
   wrong (it was enacted 2025-07-04). The value is currently harmless (dead path) but the
   comment is an active trap for the next reader.

## EXIT CRITERIA STATUS — Half H

| # | criterion | status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — Aurora Sales Mode and OpenSolar, both with UI captured on video |
| 2 | ≥1 official/training source | **MET** — three official vendor demos watched end to end (`aBy9AeiUPf0`, `8cjFBN1GOBE`, `wsB6VRCWerY`) |
| 3 | ≥1 real user/operator source | **PARTIALLY MET** — `DvwcDCblOuo` is a homeowner-advocacy video (affiliate-monetised) and IntegrateSun is an installer blog with a commercial interest. **I did not obtain an unaffiliated installer's account of using a finance integration.** Reddit is not reachable from this agent's search tool |
| 4 | core workflow end-to-end | **MET** — design → pricing → adders/discounts/incentives → financing → compare → proposal → credit application → e-signature, observed on video in both products |
| 5 | findings repeating | **MET** — default-applied federal credit, dealer-fee-as-principal, and net-cost-vs-amount-financed all appeared independently in Aurora, OpenSolar, CFPB and two operator sources |
| 6 | opportunities triaged | **MET** — every ledger row carries a verdict |
| 7 | SolarPro equivalent audited | **MET** — see the audit section; read from code, with two live defects found |
| 8 | candidates shipped or backlogged | **PARTIALLY MET** — all four top candidates are written up and triaged, **none is shipped**; this worker writes only to this file |

**NOT MET / partial: (3) and (8). Saturation is NOT declared for Half H.**

---
---

# HALF I — PROCUREMENT / DISTRIBUTION

## SUMMARY — transferable interaction principles

1. **Stock belongs at design time, not only at checkout.** OpenSolar filters the
   component picker by distributor so the designer sees what is actually available
   before the design hardens.
2. **Availability is a per-line column, beside quantity and price** — `Stock Status`
   reading `Out of stock` / `12082 in stock`, not a modal.
3. **Source is a per-line choice.** `Select Source` is a dropdown *per row*, so a BOM can
   be split across distributors, or a row excluded entirely.
4. **`Exclude from Order` must be a recorded decision, not a dropdown value.** OpenSolar
   makes dropping a line as cheap as changing a supplier, and nothing propagates back.
5. **The decoupling anti-pattern is the whole lesson of this lane.** OpenSolar documents
   that the Hardware-tab BOM "becomes independent from your Design tab and won't
   auto-update", and that Hardware-tab edits "do not impact your Design page or the
   proposal provided to the customer."
6. **A manual `Sync from Design` button is the right affordance with the wrong default.**
   Keep the button; make divergence *visible and blocking*, not silent and opt-in.
7. **Warehouse-level availability net of allocations beats a global number.** BayWa r.e.:
   "already accounting for sold and allocated units."
8. **Quotes with a stated price-lock window are the unit of commitment** — "lock in
   pricing for 30 days", convertible to an order in a couple of clicks.
9. **Saved lists / templates are how a BOM becomes reusable** without re-deriving it.
10. **A substitution is a state machine, not an edit:** proposed → under review →
    accepted for a named purpose → rejected. "Price and availability are procurement
    inputs. They are not technical equivalence."
11. **An accepted substitution must reopen every dependent artifact** — layout,
    electrical package, model, proposal, field documents — not patch the BOM alone.
12. **A PE stamp certifies the exact equipment, not a category.** Module, inverter and
    racking swaps almost always require a revision; some AHJs accept an equivalency
    letter only when specs, dimensions and certifications are identical.

## LEDGER — Half I

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | verdict | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| video | OpenSolar Shop × Sunrgy Solar Distribution | Using the OpenSolar Shop With Sunrgy | `EbfFt_h-Fn8` | 2025-10-02 | official (OpenSolar) | full 7:46 transcript + 36 scene frames + 2 targeted frame extractions | 01:45 Ada auto-design; 03:12 racking partners → "instant BOM generation"; **03:29–03:45 "search by Sunrgy to see what's available and what's in stock… account level pricing as well as inventory from your local branches"**; 03:55–04:10 "live bill of materials… with the products and availability from our distribution partners right in your design tool"; 04:14 "adders and commissions… your costs, your pricing, and your margin"; **05:24–05:40 hardware tab checkout + out-of-stock**; 05:41–06:11 checkout, cash/credit, delivery date, ship to multiple job sites or warehouse; 06:45 order management; 07:05 account handshake for credit line and pricing | design (stock-filtered picker) → live BOM → payments/proposal → sell → Hardware tab → select sources → checkout → orders | **Stock visibility at design time** (the strongest single idea in this lane). Hardware tab table columns are exactly `Product Name \| Category \| Qty \| Select Source \| Stock Status \| Price (Unit Price)` — per-line source and per-line stock. Order Summary shows `Subtotal (210 items)`, `Shipping & Handling TBC`, `Total Before Tax`, "Tax will be calculated in the next step". Ship-to can be job site(s) **or** warehouse from one checkout | **At 05:32: "if certain products are out of stock, you can easily look for alternatives or you can select pricing or availability from stock on hand."** An alternate is a one-click swap in a tab that is documented as independent of the design. In the captured frame the **panel row** (`ELNSM54M-HC-415`, Qty 20) has **no source, `Stock Status: N/A`, `$0.00 undefined /unit`** and the out-of-stock Enphase IQ8PLUS row keeps its qty and price — yet `Proceed to Checkout` is live. A row can be set to `Exclude from Order` with no recorded reason | pick an alternate from the same table and move on | SolarPro has **no stock, no availability, no lead time, no alternates and no purchase order** anywhere: `grep -i "purchaseOrder\|purchase_order\|poNumber"` over `lib/ app/ components/` returns **zero**. `lib/network/marketplaceInventory.ts` is *lead*-marketplace inventory (opportunities), not materials | **STEAL** design-time stock filter + per-line `Stock Status`/`Select Source`; **REJECT** one-click alternate with no design-side consequence | HIGH | HIGH | HIGH (needs a supplier data source SolarPro does not have — mine the UX only, per brief) | evidence captured |
| doc (search-index only) | OpenSolar | Project Hardware — Bill of Materials (Review Quote stage) | `support.opensolar.com/hc/en-us/articles/13692152514703-Project-Hardware-Bill-of-Materials-Review-Quote-stage` | undated | official docs — **403 to WebFetch, browser navigation denied; search-index extract only** | n/a | n/a | Hardware tab pulls system data from Design, then diverges | Divergence is at least *documented*, and a manual **`Sync from Design`** button exists (top right of the table — visible in the `EbfFt_h-Fn8` frame). A price source can be assigned per component. `Save BOM` is separate from `Proceed to Checkout` | **THE finding of this lane, stated by the vendor's own docs:** *"Any selections or adjustments made within the Hardware tab do not impact your Design page or the proposal provided to the customer."* and *"Once saved, the BOM becomes independent from your Design tab and won't auto-update with changes made to the system design."* A purchaser can substitute the inverter and the customer-facing proposal, the SLD and the design all keep naming the original | remember to press `Sync from Design`; keep a spreadsheet | SolarPro's BOM is **not** decoupled — it is generated from the design (`app/api/engineering/bom/route.ts` → `generateBOMV4` + structural merge) and lands **inside the permit snapshot** (`lib/permit/snapshot/build.ts:3155 bom: structAuth.bom`; `electricalProjection.ts:21` imports `bomLineIdFor`). Because `partNumber` is in the content identity key (`lib/bom/bomLineId.ts`), a substitution **changes the `bomLineId` and therefore moves the snapshot digest** — and per this project's own ruling, a digest move retires a live PE approval | **REJECT** the decoupling; **STEAL** the `Sync from Design` affordance with the default inverted | HIGH | HIGH | LOW (SolarPro already has the mechanism; what's missing is the *screen*) | evidence captured |
| marketing | OpenSolar | OpenSolar Shop — "Buy Solar Hardware from Your Project Designs" | `opensolar.com/hardware-ordering` and `opensolar.com/shop/` | undated | official **marketing — claims only, not behaviour evidence** | n/a | n/a | n/a | Claimed: *"View pricing and availability from leading suppliers"*; *"Ada will automatically calculate your Bill of Materials for every project"*; **`Supplier Assist` — "work with your supplier account manager on your Bill of Materials, all online in one place"**; *"One seamless checkout across one or more suppliers"*; *"Ada will even offer additional recommended components"* | n/a | n/a | US distributors named: Krannich Solar, Sunrgy, The Commonstead (plus 6 AU and 8 UK) | SolarPro has a static distributor price catalog (`lib/bom/distributorPricing.ts`, sources `CED \| Soligent \| KWh \| Internal` + named sellers) with DB overrides (`lib/migrations/015_distributor_prices.sql`) and an admin editor (`app/admin/distributor-prices/page.tsx`). **Prices only — no availability, no ordering** | **ADAPT** — `Supplier Assist` (a named human in the loop on the BOM) is the realistic pattern for SolarPro, which has no API partner | MED | MED | LOW | evidence captured |
| doc | OpenSolar | From Layout to Checkout: Creating Purchasable BoMs with Auto Design Templates | `opensolar.com/post/from-layout-to-checkout-creating-purchasable-boms-with-auto-design-templates/` | 2025-10-03 | official blog | n/a | n/a | auto design → apply template → BOM assembled → select distributor → one-click order | **Auto Design Templates** hold the standardised balance-of-system — *"clamps, isolators, conduit, labels"* and preferred mounting providers — so BOS is a reusable, company-level decision rather than a per-project one | The article says nothing about SKU mapping, out-of-stock handling, alternates, or approval — the gap is in the vendor's own story, not just my reading of it | n/a | SolarPro's equivalent is `lib/bom-system-profiles.ts` (structural profiles per system type) + `lib/system/sizingEngine.ts` brand-driven sizing — company-level standardisation exists but is code-resident, not user-editable | **ADAPT** — a user-editable BOS template is a real gap | MED | MED | MED | backlog |
| doc | BayWa r.e. Solar Systems (distributor) | Procurement Simplified: How to Get the Most Out of Our Solar Webstore | `solar-distribution-us.baywa-re.com/solar-r-e-view-magazine/webstore/procurement-simplified-how-to-get-the-most-out-of-our-solar-webstore/` | 2021-05-05 (Anson Dipnarinesingh) | official (distributor) | n/a | n/a | search → compare → quote (30-day price lock) → order → track → re-order | **`"The number you see is what we see in our backend systems, already accounting for sold and allocated units"`** — available-to-promise, not gross stock, per warehouse. **PV Stocking Strategy Tool** forecasts three months out with colour-coded SKU transitions for phasing-out / becoming-available models — *a distributor-side supersession signal*. **`"Create a quote and lock in pricing for 30 days"`**, converting to an order in a couple of clicks; the account manager is notified on quote creation and can advise on shipping/availability. Custom lists/templates hold a BOM and add "the entire list itself to the cart with a simple click". Purchase history shows every order including those placed by the account manager, with ship date, PO number and fulfilment warehouse. Re-order from 180 days of history. Archived docs for end-of-life products | Substitution, backorder handling and approval workflow are **not** described. Source is five years old — availability of these exact features today is unverified | n/a | SolarPro has no quote, no price-lock, no stock, no PO, no order history. It *does* have the supersession idea already in `lib/mounting-hardware-db.ts` (`supersededById`, `supersessionBasis`, `mountingSystemSupersession()` — "the substitution is never silent") | **STEAL** the two ideas: (a) availability *net of allocation*, (b) a quote as a time-boxed price lock | MED | MED | HIGH (requires supplier data) | backlog |
| doc | CED Greentech / Greentech Renewables | Customer Portal | `greentechrenewables.com/customer-portal`; branch portals at `greentech<city>.portalced.com` | undated | official **marketing**; the portal itself is login-gated | n/a | n/a | n/a | Feature list, verbatim: `Product Catalog`, `Invoice & Customer Statements`, `Quotes`, `Order & Statement Payment`, **`Job Management & Collaboration`**, `Order Tracking`, `Order Entry`. `Job Management & Collaboration` is the interesting one — the portal organises purchasing *by job*, which is the same spine as a project BOM | **No public walkthrough exists.** I searched YouTube (Greentech Renewables channel, CED Greentech Webinars playlist) and found installation trainings, product demos and webinars but **no portal walkthrough**. `greentechsandiego.portalced.com/Home` returned **HTTP 404**. The page itself does not mention stock, availability, backorder, lead time, substitution or approvals — a real absence, not just an unloaded page | n/a | n/a | **BACKLOG** — note the job-scoped purchasing spine; nothing else is verifiable without an account | LOW | LOW | n/a | **no walkthrough available — stated explicitly, per brief** |
| doc | SurgePV (vendor, operator-facing) | 10 BOM Checks That Prevent Procurement Surprises | `surgepv.com/blog/10-bom-checks-that-prevent-solar-procurement-surprises` | 2026-08-29 | operator-oriented vendor content (commercially interested — labelled) | n/a | n/a | ten sequential checks ending in "Close exceptions and authorize release" | **The substitution model SolarPro should adopt, almost verbatim.** Check 6 is **`"Control every proposed substitution"`** with four explicit states — *proposed, under review, accepted for a named purpose, or rejected*. Check 1 is `"Confirm project identity and the governing revision"`; check 7 is `"Bind supplier evidence to the exact line"`; check 10 is `"Close exceptions and authorize release"`. The governing sentence: **`"Price and availability are procurement inputs. They are not technical equivalence."`** And on consequences: when a substitution changes governed artifacts you must *"reopen that artifact and any dependent checks. Do not patch the BOM alone and assume the layout, electrical package, model, proposal, and field documents remain valid."* | Vendor content; no product UI shown | n/a | SolarPro has the **mechanism** but not the **workflow**: `lib/permit/snapshot/procurementSufficiency.ts` is a fail-closed procurement gate that clears only on a canonical `CableExtensionSolution` with an exact listed SKU, verified manufacturer document resolved through `lib/documents`, representation in drawings/schedules/BOM and recalculated VD — i.e. SolarPro *already implements check 6's "accepted" state* for exactly one commodity (Q-Cable). There is no general substitution object | **STEAL** — the four-state substitution machine is the single most transferable idea in Half I | HIGH | HIGH | MED | evidence captured |
| doc | Energyscape Renewables (permit/PE service provider) | PE Stamp Revision After an Equipment Swap: What to Know | `energyscaperenewables.com/post/pe-stamp-revision-after-equipment-swap/` | 2026-07-01 | operator (service provider — commercially interested) | n/a | n/a | distributor calls with a delay → installer swaps a part → does the stamp survive? | States the rule SolarPro is built around: **"Your PE stamp certifies the exact equipment on the plan set, not a general category."** Always-revise list: module swaps changing **weight, dimensions, or wind/snow load values**; inverter changes, especially string↔micro or different output ratings; **racking/mounting substitutions from a different manufacturer**; post-permit battery additions; FEOC-related substitutions. Some AHJs accept *"a simple equivalency letter instead of a full re-stamp, but only when the new equipment shares identical specs, dimensions, and certifications."* Amendment is cheaper than a fresh set — "only the affected sheets need updated calculations", same-day to a few business days | Opens with the exact scenario: **"your distributor called with bad news: your specified module won't arrive for six weeks. So you swap in a comparable panel."** Current industry practice for tracking that swap is not described — the article's own answer is "buy our tracker", which is itself evidence that no standard exists | none documented — the gap is real | SolarPro's snapshot digest already enforces this automatically: a part-number change moves `bomLineId` → moves the digest → retires the PE approval. **What is missing is the human-facing screen that says *why*, and an amendment path that names the affected sheets** | **STEAL** — the always-revise list is a ready-made severity classifier for a substitution gate; the equivalency-letter carve-out is the "accepted for a named purpose" state | HIGH | HIGH | MED | evidence captured |

## TOP CANDIDATES — Half I (max 4)

1. **A four-state substitution object (STEAL, MED risk).** From SurgePV check 6 and the
   Energyscape always-revise list. `proposed → under review → accepted for a named
   purpose → rejected`, with the *reason* and the *authority* recorded. SolarPro already
   has the fail-closed clearing pattern in
   `lib/permit/snapshot/procurementSufficiency.ts` for Q-Cable — generalise that shape.
   Critically: **acceptance must state which dependent artifacts were reopened**, which
   SolarPro can compute exactly, because the digest tells it.

2. **Make the digest move the user-facing consequence of a substitution (STEAL, LOW
   risk).** SolarPro's unique asset: `partNumber` is in the `bomLineId` content identity
   key, the BOM is inside the permit snapshot, and a digest move retires a live PE
   approval. No competitor observed in this lane can do this — OpenSolar's docs say the
   opposite out loud. The work is a *screen*: "Changing this part will move the design
   digest and retire PE approval #NNN. Affected sheets: …" That is the leapfrog, and it
   costs almost nothing because the mechanism already exists.

3. **Per-line `Stock Status` + `Select Source` columns on the BOM (ADAPT, HIGH risk).**
   From `EbfFt_h-Fn8`. The *columns* are cheap and useful even with no live feed:
   SolarPro already has a per-line `source` (`CED | Soligent | KWh | Internal` + named
   sellers) in `distributorPricing.ts` and surfaces it as a coloured `SourceBadge` in
   `app/admin/distributor-prices/page.tsx`. Promote that badge to the project BOM view and
   add an availability column that honestly reads `not tracked` until a feed exists.
   **No integration is proposed — per the brief, this is UX only.**

4. **Never allow a silent `Exclude from Order` (REJECT the competitor behaviour, LOW
   risk).** From the `EbfFt_h-Fn8` frame: a BOM line — including an unsourced, $0.00
   panel line — can be dropped from the order via a dropdown value with no record.
   SolarPro's equivalent must be a recorded exception with a reason, closed at release —
   which is exactly SurgePV's check 9 (`"Make exclusions and customer-supplied items
   explicit"`) and check 10 (`"Close exceptions and authorize release"`).

## EXIT CRITERIA STATUS — Half I

| # | criterion | status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — OpenSolar Shop (video UI captured) and BayWa r.e. webstore (official documentation); CED/Greentech is a third but marketing-only |
| 2 | ≥1 official/training source | **MET** — `EbfFt_h-Fn8` watched end to end with frames |
| 3 | ≥1 real user/operator source | **PARTIALLY MET** — SurgePV and Energyscape are operator-*facing* but commercially interested vendor content. **I did not obtain a first-hand purchaser's account of handling an out-of-stock line.** Reddit is unreachable from this agent's search tool and no relevant forum thread surfaced |
| 4 | core workflow end-to-end | **PARTIALLY MET** — design → BOM → source selection → stock check → checkout → delivery → order tracking is observed end to end in OpenSolar. **The substitution-approval half of the chain was NOT observed in any product UI** — it exists only as prescription in SurgePV/Energyscape prose. I found no product that shows a substitution being approved on screen |
| 5 | findings repeating | **PARTIALLY MET** — design-time stock and per-line source appear in OpenSolar and BayWa; the substitution-governance finding rests on **two prose sources and zero observed UIs**, so it has not repeated across products |
| 6 | opportunities triaged | **MET** — every row carries a verdict |
| 7 | SolarPro equivalent audited | **MET** — see below; the absence of PO/stock/substitution is confirmed by grep, and the digest linkage is confirmed in code |
| 8 | candidates shipped or backlogged | **PARTIALLY MET** — triaged and written up, **none shipped** |

**NOT MET / partial: (3), (4), (5) and (8). Saturation is NOT declared for Half I — and
Half I is materially less saturated than Half H.** The specific hole: **no walkthrough of
a purchaser approving a substitution was found anywhere.** If that matters, the next step
is a distributor-portal account or an installer interview, not more searching.

---
---

# SOLARPRO AUDIT — read from code, 2026-09-25

## Finance (Lane H)

**There is no proposal-only pricing today, and the code says so structurally.**

- `lib/pricing.config.ts` is **SaaS subscription pricing** (`starter $79` / `professional
  $149` / `contractor $250` / `enterprise custom`), not project pricing. It is correctly
  described as the single source of truth for *plan* pricing, mirrored by Stripe. It has
  nothing to do with the finance lane — worth stating because the brief pointed at it.
- The project-pricing authority chain is:
  `Admin → Pricing` (`app/admin/pricing/page.tsx`) → `pricing_config` row
  (`lib/db/pricing.ts`) → `lib/pricingEngine.ts` → project `costEstimate.cashPrice`
  → `storedCashPrice` → `buildCanonicalProposal` → `financial.systemCost`.
- `lib/pricingEngine.ts` carries an explicit banner: *"This file is an UPSTREAM ESTIMATING
  TOOL only… DO NOT use pricingEngine outputs in proposal view or canonical pipeline."*
- `lib/proposal/buildCanonicalProposal.ts:840-841` sets
  `gross_system_cost` and `systemCost` to the **same** `effectiveFinal`. One number.
- Finance is a **derived view**, never a second cost: `financeApr`, `financeTermYears`,
  `solarPaymentMonthly` are computed from `systemCost`, and the finance-basis result is
  reported separately as `netDifferenceFinanced`, documented as *"May be negative for
  high-APR/long-term loans. Shown separately from netDifference."*
  (`canonicalProposal.ts:400-406`). **This is already the correct architecture.**
- `salesOverride` (`pricingEngine.ts:352, 375`) lets a rep replace `finalPrice`, and it is
  reachable over `POST /api/production` via `body.salesOverride`
  (`app/api/production/route.ts:284, 346, 439, 547`). This is **not** proposal-only
  pricing — the override writes the project's stored cost estimate, which is the one
  authority the proposal then reads. But it is a price change with **no recorded reason**,
  which is the same hole OpenSolar's `Price Override Adjustment $6,106` has. Worth a
  reason field.
- **No dealer fee anywhere.** The only hit for `dealer_fee` in the whole repo is
  `tests/marketplace-intelligence.test.ts:545`:
  `expect(JSON.stringify(projection)).not.toContain("dealer_fee");`
- **No lease / PPA / TPO.** `purchaseMode` is `'finance' | 'cash'` only.
  `lib/network/financingIntelligence.ts` is a *lead-grading* readiness signal for the
  marketplace, explicitly disclaimed: *"not a credit approval or loan quote."*

### The ITC position — correct, with three stale artifacts

`lib/incentivesConfig.ts` is the authority and it is right:
`incentives_enabled: true`, **`allow_itc: false`** (§25D repealed), `allow_state_incentives:
true`, `allow_section48e: true` at 30% with a `2026-07-04` safe-harbour date. It provides
`isItcEnabled()`, `guardItcValue()` (which logs `[INCENTIVE LEAK DETECTED]` and forces 0)
and a compliance message naming P.L. 119-21. `buildCanonicalProposal.ts:714-726` calls
both guards. `app/admin/pricing/page.tsx:579` tells the admin *"Residential ITC was
eliminated. Commercial ITC (30%) still applies for qualifying projects."*
`pricingEngine`'s own defaults are `itcRateCommercial: 30, itcRateResidential: 0`.

**SolarPro is already ahead of Aurora here.** But three artifacts survive:

1. 🚨 **`lib/db.ts:608`** —
   `taxCreditRate: 30, // §25D residential ITC — 30% through 2032 (IRA, P.L. 117-169). P.L. 119-21 has NOT been enacted; do not treat as current law.`
   **The comment is factually wrong.** P.L. 119-21 was enacted 2025-07-04 (verified:
   CRS IN12611; IRS FAQ). The *value* is currently inert — `defaultPricing` is consumed
   only by the legacy in-memory `Database` class in the same file, and `lib/db` is
   imported by exactly two equipment routes that never read pricing — but the comment is a
   live trap for the next reader. **Fix the comment; the value should go to 0.**
2. `lib/pvwatts.ts:342` — `const taxCredit = grossCost * (pricing.taxCreditRate / 100);`
   inside `calculateCost()`, which is **ungated** by `isItcEnabled()`.
   `calculateCost` has **no callers** (dead code), so it is not producing a false number
   today. It is a loaded gun.
3. `lib/companyPricing.ts:34` — `taxCreditRate: 30, // Federal ITC % (commercial §48E)`.
   No consumers found. The label says commercial, which is defensible, but the constant
   sits next to residential price-per-watt rates in the same object.

None of the three is currently producing a false savings number. All three are the kind
of thing this project's own memory says to kill on sight.

## Procurement (Lane I)

**SolarPro has a canonical BOM and a stamped-design guard, and nothing downstream of it.**

What exists:
- `app/api/engineering/bom/route.ts` → `generateBOMV4` (electrical) merged with
  `deriveStructuralBOMForSubsystems` (structural) and `sizingResultToBomItems`
  (brand-driven BOS); `V4_OWNED_CATEGORIES` resolves overlaps so grounding has exactly one
  authority. Export via `bomToCSV` / `bomToMarkdown`.
- `lib/bom/bomLineId.ts` — a **content-addressed, position-independent** line identity:
  `BOM-${CATEGORY_TOKEN}-${FNV1a-8hex}` over
  `stageId | category | partNumber-or-description | unit | subSystem`. Quantity is
  deliberately excluded so a re-routed conduit run keeps its id. Collisions are
  disambiguated and audited, never silent.
- `lib/bom/distributorPricing.ts` (948 lines) — static catalog keyed to CED Greentech /
  Soligent / KWh Analytics price sheets, DB overrides via
  `lib/migrations/015_distributor_prices.sql` (exact SKU > category wildcard > static
  catalog > category fallback; `user_id NULL` = platform default), admin editor at
  `app/admin/distributor-prices/page.tsx` with a per-source coloured badge.
- `lib/permit/snapshot/procurementSufficiency.ts` — a **fail-closed** gate that is, in
  effect, SurgePV's check 6 implemented for one commodity. It clears only on an exact
  listed SKU with a manufacturer document resolved through `lib/documents`, representation
  in drawings/schedules/BOM, and recalculated voltage drop. It states honestly that no
  service-loop allowance authority is archived, so the allowance is 0 with provenance
  `'no-allowance-authority-recorded'` — *"We never invent a number."*
- `lib/permit/snapshot/routeProcurementPolicy.ts` — separates `calculationLengthFt` from
  `procurementLengthFt` with itemised, reasoned allowances, and names the legacy global
  `SLACK_FACTOR = 1.15` in `lib/bom/deriveRunLengths.ts` as a defect rather than repeating
  it.
- `lib/mounting-hardware-db.ts` — **supersession that prints itself**: `supersededById`,
  `supersessionBasis`, `getMountingSystemById()` (cycle-safe chain walk),
  `effectiveMountingSystemId()` and `mountingSystemSupersession()` returning
  `{from, to, basis}` for consumers that must render the change. *"The substitution is
  never silent."* This is the closest thing SolarPro has to an approved-substitution
  record, and it is manufacturer-driven, not purchaser-driven.
- The **linkage that matters**: the BOM is inside the permit snapshot
  (`lib/permit/snapshot/build.ts:3155` `bom: structAuth.bom`;
  `lib/permit/snapshot/electricalProjection.ts:21` imports `bomLineIdFor`). Because
  `partNumber` is in the identity key, changing a part changes the line id, which changes
  the digest, which — per this project's standing ruling — retires a live PE approval.

What does **not** exist (confirmed by grep over `lib/ app/ components/`):
- **No purchase order.** `purchaseOrder` / `purchase_order` / `poNumber`: **zero hits.**
- **No stock, availability, lead time or backorder** concept anywhere.
- **No supplier quote, no price lock, no order status, no delivery.**
- **No general substitution object, no approval state, no approver.** The only
  substitution *governance* in the product is the printed planset note at
  `lib/permit_gen.mjs:608`: *"All equipment shall be UL-listed or ETL-certified.
  Substitutions require engineer approval and AHJ re-submittal."* — a sentence on a
  drawing, not a workflow.
- `lib/network/marketplaceInventory.ts` is **leads** inventory (`release` / `pause` /
  `unrelease` / `archive` on opportunities), not materials. Don't confuse the two.

### The one-line answer to the lane's architectural question

*A substituted part must not quietly invalidate a stamped design.* SolarPro is the only
product observed in this research where it **cannot** — the digest moves. OpenSolar's own
documentation states the opposite behaviour explicitly. The gap is not the mechanism; the
gap is that nothing tells the purchaser what they just did.

---

## Cross-lane note

Both lanes reduce to the same rule from two directions:

- **Lane H:** a *finance product* must not be allowed to select the price.
  (OpenSolar: `Price breakdown for [Sungage — 20 years 0.9%]`.)
- **Lane I:** a *supplier* must not be allowed to select the parts.
  (OpenSolar: *"the BOM becomes independent from your Design tab"*.)

One authority, two derived presentations. SolarPro's existing architecture already holds
this line in code. What is missing in both halves is the **screen that makes the line
visible to the user** — and in Half H, three stale 30% constants that should not outlive
this week.
