# SolarPro Competitor Research Ledger

**Index only.** Every claim, every video id and every timestamp lives in the lane
file it belongs to. This page exists so that "CRM was researched" is a checkable
statement rather than an assertion.

Round 3 — 2026-09-25. Nine research lanes and four forensic audits ran in
parallel while the main thread repaired two live failures.

---

## 🚨 NO LANE IS SATURATED

Saturation requires all eight exit criteria. **Every lane fails at least one**,
and all nine fail the same one:

> **(8) implementation candidates either shipped or explicitly backlogged.**

The research workers were deliberately given read-only scope so they could not
destabilise the working tree while the main thread was mid-repair. That means
every candidate below is a *proposal* until the main thread triages it. Nothing
here may be described as done.

A previous round marked OpenSolar "RESEARCH SATURATED". **That was wrong** and is
withdrawn — it rested on agreement between sources, which is criterion (5) alone.

| Lane | Sources watched | Failed/blocked | Criteria met | Notably NOT met |
|---|---|---|---|---|
| **A** Design / 3D (deeper) | 5 long-form (93, 53, 41, 40, 32 min) | 1 video, 2 help centres 403 | 6/8 | (8); (3) operator source is vendor-hosted |
| **B** Engineering / electrical | 13 | Mike Holt 403, Reddit blocked | 7/8 | (8); installer-complaint hunt largely failed |
| **C** Proposals / sales | 10 | 1 private | 7/8 | (8); forum hunt returned SEO blogs, not operators |
| **D** CRM / operations | 9 | Reddit unreachable | 5/8 | (8); (3) only true operator is *roofing*, not solar; (4) no product observed handling a denied permit or failed inspection |
| **E** Marketplace / leads | 3 video + 3 help articles, 8 products | — | 7/8 | (8); (4) partial. **No contractor buying a lead on camera exists** — all platforms sit behind a paid pro login |
| **F** Site survey / field | 9 | 2 videos unavailable | 6/8 | (8); (5) skip-behaviour and offline behaviour each rest on ONE source |
| **G** Homeowner portal | 8 video + 11 docs | 1 permanently gone, Reddit blocked | 7/8 | (8); (4) never watched a *solar* portal rendering a mid-project wait |
| **H** Finance / TPO | 4 | — | 6/8 | (8); (3) no unaffiliated installer account |
| **I** Procurement / distribution | 1 + docs | CED has no public walkthrough at all | 4/8 | (8), (3), (4), (5). **No product UI showing a substitution being approved was found anywhere** |
| **J** Enterprise / multi-tenant | 4 | Okta 403 | 6/8 | (8); (4) never observed a tenant switcher in motion |
| **K** Admin centre | (shares J) | Aurora/OpenAI help 403 | 6/8 | (8); (4) catalog, pricing, integration, flagging, data-quality admin all uncovered |

Recurring environmental limits, recorded rather than worked around: **reddit.com
is blocked to the fetchers**, and Aurora's, OpenSolar's and Buildertrend's help
centres return 403. So the "what do users hate" hunt is the weakest part of this
round across every lane, and it is the part most likely to contain the leapfrog.

---

## Lane files

| File | Covers |
|---|---|
| [lane-A-design-3d-deeper.md](lanes/lane-A-design-3d-deeper.md) | Roof modelling, and the 90/10 correction scorecard |
| [lane-B-engineering-electrical.md](lanes/lane-B-engineering-electrical.md) | Stringing, voltage drop, SLD, violations UX |
| [lane-C-proposals-sales.md](lanes/lane-C-proposals-sales.md) | Proposal generation, options, drift, e-sign |
| [lane-D-crm-operations.md](lanes/lane-D-crm-operations.md) | Pipeline, handoffs, change orders, failed inspections |
| [lane-E-marketplace-leads.md](lanes/lane-E-marketplace-leads.md) | Lead quality, refunds, exclusivity, trust signals |
| [lane-F-site-survey.md](lanes/lane-F-site-survey.md) | Capture checklists, offline, before-you-leave validation |
| [lane-G-homeowner-portal.md](lanes/lane-G-homeowner-portal.md) | Status, waiting, permit visibility, PTO |
| [lane-HI-finance-procurement.md](lanes/lane-HI-finance-procurement.md) | TPO/loan presentation; BOM, stock, substitution |
| [lane-JK-enterprise-admin.md](lanes/lane-JK-enterprise-admin.md) | Org hierarchy, inheritance/override, admin UX |

## Forensic audits (not competitor research — SolarPro's own code)

| File | Question it answers |
|---|---|
| [GESTURE-OWNERSHIP-MAP.md](GESTURE-OWNERSHIP-MAP.md) | Who owns each pointer gesture in every mode, and where the camera is left frozen |
| [SHADE-VISUAL-TRACE.md](SHADE-VISUAL-TRACE.md) | Why a tree shaded the numbers and not the picture |
| [CHIMNEY-LANE-AUDIT.md](CHIMNEY-LANE-AUDIT.md) | Eight-link verdict on the roof-object chain |
| [SECURITY-CLAIM-VERIFICATION.md](SECURITY-CLAIM-VERIFICATION.md) | Which reported security findings survive contact with the code |

---

## The single most valuable finding in each lane

Not the longest list — the one thing per lane that would change a decision.

- **A.** SolarPro cannot move a vertex, split a face, merge two faces or drag an
  edge. Aurora and Solargraf can do all four. But `VertexHandles.tsx` is already
  written, unit-tested and *imported* — and never mounted anywhere. Meanwhile
  SolarPro wins outright on rebuild-one-section-keep-the-rest, which neither
  rival can do at all.
- **B.** HelioScope annotates every conductor in the dropdown with the voltage
  drop it would cause (`10 AWG (Copper), 0.2%`). Picking wire becomes a decision
  instead of data entry.
- **C.** SolarPro is the only product of four that *photocopies* the project into
  a frozen proposal instead of rendering the homeowner view live from it. Nobody
  auto-updates a sent proposal — but everyone else has one-click refresh on a
  stable link, and OpenSolar simply disables Send until changes are saved.
- **D.** SolarPro has the labels of the full lifecycle and almost none of the
  mechanism: a complete governed state machine documented as "the ONLY
  authorised path" with **zero callers**, while the route that really runs
  accepts any stage → any stage with no audit.
- **E.** Thumbtack publishes the competition count on the lead card *before
  purchase*, plus an enumerated refund policy. SolarPro's exclusive-claim model
  is genuinely better — but three of its contractor-performance metrics are
  computed from columns nothing ever writes.
- **F.** A 9-zone, movement-ordered capture plan with per-item engineering
  justification exists in the codebase and is imported only by an admin page.
  The capture plan was written and never shown to the person on the roof.
- **G.** 41% of a solar installer's support contacts are three questions
  (when is install, how do I use monitoring, any update?) — SolarPro's portal
  answers none of them, and shows one static sentence for the entire
  permit→inspection→PTO window.
- **H.** Aurora's Oct-2025 demo still applies a 30% residential ITC by default.
  §25D is repealed for expenditures after 2025-12-31. SolarPro's architecture is
  already correct here; three stale artifacts and one factually wrong comment
  remain.
- **I.** OpenSolar states in its own docs that Hardware-tab changes "do not
  impact your Design page or the proposal". SolarPro's BOM sits inside the permit
  snapshot, so a part swap moves the digest and retires the PE approval — it is
  the only product found where a substitution *cannot* quietly invalidate a
  stamped design. The gap is a screen, not a mechanism.
- **J/K.** SolarPro is single-tenant in practice with two generations of inert
  org scaffolding. The expensive-to-undo item is not the schema: it is that
  **no revert-to-inherited exists anywhere**, and `pricing_config` is one global
  row whose admin page hardcodes a fallback that disagrees with the schema's.

---

## Cross-lane rule that came out of this round

Stated by two independent lanes, worth keeping:

> A finance product must not select the price. A supplier must not select the
> parts. **One authority, two derived presentations.**

This is the same rule SolarPro already enforces for pitch and for equipment. It
is the correct lens for every "steal" in this ledger: take the presentation,
never the second source of truth.
