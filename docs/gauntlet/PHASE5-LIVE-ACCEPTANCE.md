# Phase 5 — live acceptance list

22 checks, highest value first. `ACTION → EXPECTED RESULT`. Nothing here needs code
knowledge to run. Only Ray can mark these LIVE ACCEPTED.

**Before you start:** `dev` has a pre-existing peer break — **hybrid** (multi-subsystem)
permit generation throws until the peer commits `buildHybridPermitMetering`. Use
single-system projects for the permit checks below. Nothing in Phase 5 caused it.

---

## Tier 1 — the ones I would test first

**1. Signing a proposal moves the installer's board**
Send yourself a proposal → open the homeowner share link → sign it → open `/projects`
Operations board.
**→ The project has LEFT the Lead column and sits at Contract Signed. `/dashboard` shows
a new "Schedule install" command.**
*(Before: signed contract in the proposal view, Lead on the board, forever, silently.)*

**2. A non-admin cannot rewrite the shared equipment catalog**
Signed in as a **non-admin**, browser console:
```
fetch('/api/hardware',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({type:'panel',id:'panel-std440',data:{width:9}})}).then(r=>r.status)
```
**→ 403.** Then open Design Studio's panel picker.
**→ The panel is unchanged.**
*(Before: 200, and every organisation's panel changed.)*

**3. Margins are not readable by the internet**
Private/incognito window, signed out → `/api/pricing`.
**→ You see `pricePerWatt` and the per-system-type sell prices. You do NOT see
`profitMargin`, `laborCostPerWatt`, `equipmentCostPerWatt` or `overheadPercent`.**
Then signed in, same URL → **all of them present.**

**4. The homeowner portal does not claim things that did not happen**
Admin → a project with no bill uploaded → **Save Stage** → "Under Review" → open the
homeowner portal.
**→ The activity feed does NOT say "Your utility bill was received". It says
"Milestone reached: …" and the page still asks for the bill.**

**5. Setting "Installation" does not claim the customer signed**
Take a project with **no proposal ever sent** → set its homeowner stage to Installation →
open the portal.
**→ No "You signed — you're locked in!" and no contract-signed entry with today's date.**

**6. The uploaded bill survives**
Portal → upload a real utility-bill PDF → then installer side → project → Client Files →
open the "Utility Bill" document.
**→ You get your PDF back. A separate "Bill Data" JSON holds the parsed summary.**
*(Before: the PDF was gone and the JSON was filed under its name.)*

**7. The expired 30% credit banner is gone from the customer's proposal**
Open any homeowner share link → Ctrl-F for "July 4".
**→ No match. No "Act Before July 4, 2026", no "30% federal tax credit" prose.**

**8. The customer's proposal has no phantom tax-credit tile**
Same share link → look at the cash-flow / savings card.
**→ No "Tax credit (0%) −$0 federal ITC applied" tile. The net line reads "Total
investment … no incentives deducted".**

---

## Tier 2 — high value, quick

**9. The distributor pricing page opens at all**
`/admin/distributor-prices`.
**→ The page renders a priced catalog. No blank screen, no NaN in the cost cells.**
*(Before: a render-time TypeError the moment the fetch resolved.)*

**10. A contract price can be stored**
Same page → add an override for a Powerwall 3 at, say, $7,100 → Save → reload → then
delete it.
**→ Save succeeds, the row persists across reload, delete removes it.**
*(Before: "part_number is required" on save, "HTTP 400" on delete, and a 500 behind both.)*

**11. A company override actually beats the platform price**
With that $7,100 override in place, run engineering + BOM on a Powerwall 3 design.
**→ Est. Hardware Cost and the $/W tile use $7,100, not $8,280.**

**12. The archived BOM is orderable**
Run engineering → project → Client Files → download `BOM_<project>.csv`.
**→ It has Part Number, Unit Cost and Total Cost columns with real values. An unpriced
line has an EMPTY cost cell, not $0.00.**

**13. The BOM stops naming a breaker that does not exist**
Set a project's service to a 320 A bus with a 200 A main, load-side interconnection →
run BOM.
**→ The backfeed breaker line reads 175 A (a real NEC size). NOT "184A Backfeed Breaker
/ QO184".**

**14. Campaign Intel loads**
`/admin/network` → **Campaign Intel** tab.
**→ Funnel, source performance, CPL, geography, grade distribution and volume trend all
render.**
*(Before: "Loading analytics…" forever, for every admin, on every load.)*

**15. A lead can actually reach the marketplace**
`/admin/network` → Screening → pick a screened lead → **Approve** / **Release to
Marketplace**.
**→ It succeeds and the lead then appears in the contractor Discover feed.**
*(Before: "Internal server error", and nothing could ever be released by any path.)*

**16. The screening queue shows what is in it**
With leads pending, open the Screening tab.
**→ Rows are listed, and the Pending and Running counters are non-zero.**
*(Before: "Queue is empty" with all five counters at 0 — an outage rendered as a clean
desk.)*

**17. A good address no longer auto-fails**
Screen a lead with a valid Illinois address.
**→ It does NOT come back `fail` / "invalid_address, outside_service_area" / grade F.**

**18. "All Systems Operational" can fail**
`/admin/health`.
**→ Banner reads "Monitored Systems Operational", the count reads 2/2, and four
subsystems are dashed grey "Not monitored" tiles with NO status and NO latency number.**
*(Before: 6/6 healthy and four invented latencies — 12/25/45/18 ms.)*

---

## Tier 3 — engineering refusal states, worth proving

**19. The interconnection method admits when it does not know**
Run engineering on a project with **no survey electrical data**.
**→ Interconnection reads "UNRESOLVED — survey required", and the compliance notes carry
an ACTION REQUIRED line naming the busbar AND main breaker as the missing inputs.**
*(Before: it silently picked load-side or supply-side from an invented 200 A busbar —
and supply-side is a different scope of work.)*

**20. An unresolved battery blocks the permit instead of passing it**
Add a battery by free-text brand/model that is NOT in the catalogue → generate a permit
(single-system).
**→ PV-4A's 120% row reads PENDING, not PASS, and the package is BLOCKED with a
BATTERY-BACKFEED-UNRESOLVED blocker.**
*(Before: a stamped "120% RULE PASS" computed from a sum missing the battery.)*

**21. The string ceiling reads the site**
Run the same design twice — once with the project in **FL**, once in **MN**.
**→ Panels-per-string DIFFERS between them.**
*(Before: identical everywhere, because a blanket ×1.25 ignored the site.)*

**22. The DC conduit responds to string count**
Run a 2-string design, note the DC conduit size. Run a 6-string design of the same
module.
**→ The DC conduit size is LARGER on the 6-string design.**
*(Before: identical, because the size came off an ampacity bracket and Isc per string does
not change with parallel strings.)*

---

## Worth a look, but expect a partial

**23. The dashboard CTAs** — `/dashboard` → switch to **Full View** → **Resolve Now**.
**→ A stage-decision modal opens and the URL does not change, and its primary stage
button is clickable.** *(Two separate defects; both fixed. The cards are not in the
default Focus view.)*

**24. Stall cards survive an unrelated edit** — find a project sitting in one stage, edit
a note, reload `/dashboard`.
**→ The follow-up card is STILL there.** *(Before, bumping `updated_at` made it vanish.)*
Wording on historical rows will read "no activity for Nd" in yellow rather than
"stalled" in red — that is correct until the `stage_changed_at` migration lands (R12).

**25. The survey "Saved" indicator no longer lies on open** — open a fresh
`/survey/[token]`.
**→ No save time shown before you have typed anything.** *(A real last-save time still is
not rendered — the page wiring is a recorded handoff.)*

---

## Known NOT ready to test

| Item | Why |
|---|---|
| Repeatable obstruction photos | The component supports it; the Step-5 page still renders one slot per category. Handoff. |
| Billing "100+ (partial)" | The route pages and flags it; the page does not read the flag yet. Handoff. |
| Referral attribution as `referral_code` | Rides in `utm_content` and reaches the lead; first-class persistence needs the funnel page + intake route. BLOCKED. |
| Any **hybrid** permit | The peer break. Single-system only until they commit. |
| Per-organisation pricing / durable equipment catalog | R16 — needs a schema scope column. |
