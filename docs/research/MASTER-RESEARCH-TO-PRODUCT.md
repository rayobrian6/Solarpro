# Master research-to-product matrix

**Research is input. A better SolarPro is the output.** This page exists so that
a lane with 50 KB of findings and zero product decisions is visible as a
failure rather than as progress.

Two separate states, and both are needed:

- **RESEARCH SATURATED** — more sources are no longer teaching us much.
- **RESEARCH CONSUMED** — we actually used what we learned: findings verified
  against the code, compared to SolarPro, ranked, and the top bounded
  candidates either shipped or explicitly backlogged/rejected.

---

## Lane status

| Lane | Consumed | Saturated | Where the matrix lives |
|---|---|---|---|
| A — design / 3D | ✅ | ❌ | [lane-A](lanes/lane-A-design-3d-deeper.md) + [VERTEX-MOVE-ARCHITECTURE](VERTEX-MOVE-ARCHITECTURE.md) |
| B — engineering / electrical | ✅ | ❌ | [CONSUMED-lanes-BC](CONSUMED-lanes-BC.md) |
| C — proposals / sales | ✅ | ❌ | [CONSUMED-lanes-BC](CONSUMED-lanes-BC.md) |
| D — CRM / operations | ✅ | ❌ | [CONSUMED-lanes-DEG](CONSUMED-lanes-DEG.md) |
| E — marketplace / leads | ✅ | ❌ | [CONSUMED-lanes-DEG](CONSUMED-lanes-DEG.md) |
| F — site survey | ✅ | ❌ | [CONSUMED-lanes-FHIJK](CONSUMED-lanes-FHIJK.md) |
| G — homeowner portal | ✅ | ❌ | [CONSUMED-lanes-DEG](CONSUMED-lanes-DEG.md) |
| H — finance / TPO | ✅ | ❌ | [CONSUMED-lanes-FHIJK](CONSUMED-lanes-FHIJK.md) |
| I — procurement | ✅ (design-only) | ❌ | [CONSUMED-lanes-FHIJK](CONSUMED-lanes-FHIJK.md) |
| J — enterprise | ✅ | ❌ | [CONSUMED-lanes-FHIJK](CONSUMED-lanes-FHIJK.md) |
| K — admin | ✅ | ❌ | [CONSUMED-lanes-FHIJK](CONSUMED-lanes-FHIJK.md) |

**No lane is saturated.** Reddit is blocked to the fetchers and three vendor
help centres return 403, so the what-do-users-hate hunt remains the thinnest
part of the corpus — and the likeliest place a leapfrog is still hiding.

---

## Round accounting

**NEW RESEARCH** — 11 lanes, ~60 sources genuinely watched, every ledger row
carrying a real video id. Plus 8 forensic audits of SolarPro's own code.

**RESEARCH VERIFIED** — every sharp claim in every lane has now been checked
against the code by a second pass. Verification changed the ranking repeatedly;
these did **not** survive:

| Claim | Verdict |
|---|---|
| Six voltage-drop implementations, two physical constants, three disagreeing tables | **Largely fabricated.** No `1.732` and no `21.2` exist anywhere. App and planset run the same function with the same constant, 0.0069 pp apart. |
| `window.prompt` for `MIGRATE_SECRET` is a vulnerability | **Refuted.** The endpoint gates on a timing-safe comparison, body-only, rate-limited, fail-closed. A weak client in front of a strong server is not a hole. |
| Marketplace leaks `location_city` pre-payment | **Misdirected** — wrong paths, and both real routes are authenticated. The real leak was `lat`/`lng` at ~1 cm precision in a different route. |
| `string-generator.ts` has no UI | **Refuted.** |
| Lane B: "ESS/PCS has zero hits" | **False.** `electrical-calc.ts` emits `I-PCS-705-13`. |
| Lane B: "backup not modelled" | **False.** Battery records carry `wholeHomeBackup`/`requiresGateway`; the proposal simply never shows it. |
| Lane G: "no scheduler exists, so time-based triggers are impossible" | **False.** Two production crons run; `cron/proposal-expiry` is a reusable template. |
| Lane J: admin pricing fallback disagrees with the schema's documented fallback | **Refuted** — it matches migration 004's seed. The real divergence is page-vs-engine, and it is worse. |
| "Just mount `VertexHandles`" | **Refuted.** Renders nothing, mutates through a prop nobody wrote, and its pick maths intersects a sphere of the equatorial radius — ~146 m of error at 1° off nadir here. |

**RESEARCH CONSUMED** — all 11 lanes. Every one now has verified findings, a
SolarPro comparison read from code, a ranking, and candidates either shipped or
explicitly backlogged with a reason.

**FEATURES SHIPPED FROM RESEARCH** (this campaign, all on `dev`, all
mutation-proved and regression-green):

| From | Shipped |
|---|---|
| Aurora — ESC exits a tool | ESC exits armed tools |
| Aurora — armed-state legibility | Active-mode banner + single-key shortcuts |
| Aurora — live dimensions | Selected-face edge dimensions |
| Aurora/OpenSolar — fewer persistent surfaces | Overlay visibility authority; LiDAR panel made contextual |
| Aurora — "drag until the circle matches the tree" | Drag-to-size, honest ghost preview, duplicate object |
| — (own audit) | Pointer-gesture authority; the tree stopped fighting the camera |
| — (own audit) | Placed objects cast real shadows; shade re-runs when they change |
| — (own audit) | Chimney keep-out uses the clearance-aware authority on all three paths |
| Thumbtack/Angi failure corpus | Contractor-performance metrics stopped claiming a confident 0%; `first_contact_at` got its first writer |
| — (own audit) | **Hand-placed obstructions reach the plan set** |

**BACKLOGGED** — multi-option proposals on one link; homeowner permit card;
handoff gates; survey readiness on-device; offline capture queue; conductor
dropdown annotated with resulting voltage drop; navigable violations;
revert-to-inherited; org hierarchy. Each carries files, proof and risk in its
lane's matrix.

**REJECTED, with reasons recorded rather than dropped** — per-option prices in
`data_json` without re-running the canonical builder (second pricing authority);
a Hardware-tab BOM decoupled from the design (second equipment authority);
Solargraf-style copy-down of settings (second pricing/AHJ authority); a
dealer-fee model where finance selects cost; org-named `project_statuses` (a
fifth status vocabulary before the existing four are collapsed); portal chat;
hardcoded placeholder monitoring tiles; re-adding Voc×N for optimizers.

**LANES STILL UNCONSUMED** — none.

---

## The cross-lane implementation queue

Ranked by real-world harm, then by value-over-risk. Verified only.

| # | What | Harm | Scope | Authority touched | Status |
|---|---|---|---|---|---|
| 1 | **A repealed 30% residential ITC reaches stored cost estimates and a customer-visible payback.** `?? 30` defaults make the existing guard unreachable; the inline DDL defaults the column to 30, so 30% is the default state of every database. | Customers quoted savings that do not exist | MED | pricing | ✅ **SHIPPED** `b6006387` |
| 2 | Hand-placed obstructions never reached the permit drawing | Stamped sheet contradicts the design | MED | permit snapshot | ✅ **SHIPPED** `31289978` |
| 3 | A deleted roof can come back — the tombstone ledger write can fail while the API reports success | Silent data loss | MED | deletion authority | ✅ **SHIPPED** `6acb46dd` |
| 4 | **Two ASHRAE cold-temperature datasets.** 50 of 51 states disagree; 11.5% of module×state combinations flip the max series string length; in IL three modules flip 13→12. Zero digest impact. | Wrong string length on a stamped design | SMALL | thermal basis | ✅ **SHIPPED** `c3df7c77` |
| 5 | **A second string-sizing authority** — the engineering page's readout recomputed inline and applied Voc×N to OPTIMIZER systems, where the bus is regulated and the brand cap governs. Its Auto button *applied* that layout — the 10/10/10/6 the engine was fixed to stop producing. | A designer clicks Auto and gets a layout that blows the MPPT current budget | SMALL | string sizing | ✅ **SHIPPED** |
| 6 | **`plane.area` is stale after every reshape** — nothing recomputed it, and survey enrichment picks the primary plane *by area* | Wrong primary plane downstream | SMALL | roof geometry | ✅ **SHIPPED** `ffb9de9a` |
| 7 | Proposal integrity: no terminal-state guard on snapshot refresh, share, status PATCH or bulk; the guarded signing route is orphaned and the unguarded one is live | A signed document changes after signing | MED | proposal snapshot | IN FLIGHT |
| 8 | **Survey readiness is computed and delivered too late** — a 9-zone capture plan exists and is imported only by an admin page | A second site visit | MED | survey evidence | IN FLIGHT |
| 9 | **The portal never showed the install date** — 18.6% of support contacts, written all along, never selected | The homeowner phones to ask | SMALL | — | ✅ **SHIPPED** |
| 10 | Move vertex — the 90/10 correction gap | Redraw-the-whole-roof | LARGE | roof geometry | IN FLIGHT |
| 11 | **Nobody in the category shows an installer their margin on the design screen.** Aurora's own user calls it a "half product" on camera; a UK installer keeps a pricing spreadsheet outside the product. SolarPro computed `grossProfit`/`marginPercent` under a heading reading "Internal" and rendered none of it. | The tool loses the person using it | SMALL | — (presentation only) | ✅ **SHIPPED** `5419cf69` |
| 12 | **Wire gauge was data entry, not a decision** — a bare list of five, so choosing meant guessing, saving, reading the schedule and coming back. HelioScope annotates each option with the drop it causes. | Avoidable rework on every string | SMALL | voltage drop | ✅ **SHIPPED** `81f24c71` |
| 13 | **Raw stack traces reached toasts**, and **email reported success when nothing was sent** — both found by hunting competitors' failures and finding our own | A person who sees a stack trace stops believing the screen; an installer waits on a proposal never delivered | SMALL | — | ✅ **SHIPPED** |
| 14 | **The admin pricing page showed a rate the engine would not charge** — $2.35/W for ground where jobs priced at $3.10/W, because page and engine fell back differently | The operator sets one price, the customer is quoted another | SMALL | pricing | ✅ **SHIPPED** `296c78e1` |
| 15 | **Entering "inspection" would have announced that it passed** — dormant in the governed stage route, armed the moment anyone wired it | A homeowner told their inspection passed when it has not happened | SMALL | micro-stage | ✅ **SHIPPED** `691b33ac` |

---

## The law this campaign keeps re-proving

> If the user draws physical reality in SolarPro, every downstream consumer must
> either consume it or say explicitly why it does not. There is no "3D reality"
> and separate "permit reality".

And its twin, arrived at independently by two lanes:

> A finance product must not select the price. A supplier must not select the
> parts. **One authority, two derived presentations.**

The moat this protects, verified this round: `partNumber` is inside the BOM
identity key, the BOM is inside the permit snapshot, and the digest is a hash
over the whole snapshot — so a part swap moves the digest and retires the PE
approval. SolarPro is the only product in this research where a substitution
**cannot** quietly invalidate a stamped design. OpenSolar's own documentation
states the opposite of its own Hardware tab.
