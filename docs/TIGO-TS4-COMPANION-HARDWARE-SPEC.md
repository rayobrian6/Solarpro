<!-- Generated from the verified-research workflow run wf_1ad5086f-9fa (22 agents,
     2.1M subagent tokens, 661 tool calls) on 2026-08-24. Three independent research
     lanes reconciled against Tigo primary PDFs by three adversarial audit agents.
     Prices confirmed live on 2026-08-24. RE-VERIFY before relying on a price. -->

# TS4 COMPANION-HARDWARE BOM ENGINE — BUILD SPECIFICATION
Rev 1.0 · basis date 2026-08-24 · all rules below are post-audit (three research lanes reconciled against Tigo primary PDFs)

---

## 0. REQUIRED ENGINE INPUTS

Without these the engine cannot resolve companions. Missing input = hard stop, not a default.

| Input | Type | Used for |
|---|---|---|
| `moduleCount`, `moduleWattStc`, `moduleIsc` | int/num | MLPE qty, TS4 power/current class gate |
| `strings[]` → `{inverterId, mpptId, moduleCount, homeRunRoundTripM}` | array | transmitter core sizing, MPPT/CCA binding |
| `inverters[]` → `{model, acServiceVoltage: "120/240"\|"277/480", integratedTigoTx: yes\|no\|UNKNOWN}` | array | transmitter qty + integrated-transmitter exemption |
| `mountType`: `roof` \| `ground` \| `carport` | enum | whether NEC 690.12 applies at all |
| `functions[]`: `rsd`, `monitoring`, `optimization` | set | variant selection + the -O exemption |
| `roofPlanes[]` → `{orientation, surface: flat\|metal_tile\|ground_elevated, heightOffsetM, obstructions[], gapsM[]}` | array | **TAP count — this is the real driver** |
| `transmitterLocation`, `ccaLocation`: `indoor` \| `outdoor` | enum | enclosure / kit-SKU substitution |
| `internetAtSite`: bool | bool | -O/-S/-M RSD enablement + warranty |
| `generation`: `TS4-A_700W` \| `TS4-A_725W` \| `TS4-X_800W` | enum | **MFRS behavior — model name alone is NOT sufficient** |

⚠ `generation` is mandatory and cannot be inferred from the model name. The 725 W parts ship under the **same names** (TS4-A-F/-O/-S) as the 700 W parts but behave differently (§6).

---

## 1. DECISION TABLE (primary output)

### 1.1 Family switch — evaluate first, it is a hard switch, never additive

| MLPE selected | Signalling | Companion family | Forbidden companion |
|---|---|---|---|
| TS4-A-F, TS4-A-2F, TS4-X-F | PLC keep-alive on DC conductors | RSS Transmitter + 12 V PSU + enclosure + PVRSS label + initiator | TAP = 0, CCA = 0 |
| TS4-A-O, TS4-A-S, TS4-A-M, TS4-X-O, TS4-X-S | 2.4 GHz mesh from TAP, commanded by CCA | TAP + CCA + CCA PSU + RS-485 cable + internet + initiator | RSS Transmitter = 0 *(TS4-A gen only — see §6)* |

Tigo, verbatim: the two families are **"not inter-mixable within single systems or arrays."** Engine must **reject** a design mixing F/2F with O/S/M on one array — do not BOM both signal paths.

### 1.2 Fire-safety line — TS4-A-F / TS4-A-2F / TS4-X-F

| Companion | Qty rule | NOT needed when | Status |
|---|---|---|---|
| **TS4-A-F** | `= moduleCount`, every module | never zero on a structure-mounted array; partial deployment allowed **only** where RSD not required (ground mount) **and** the string has its own MPPT | required |
| **TS4-A-2F** | `= ceil(moduleCount / 2)`. Odd count is legal — Tigo: *"You may connect a TS4-A-2F to a single module… by connecting the unused second set of input cables."* `floor(N/2)×2F + 1×F` is an equally valid option, not a requirement | as above | required |
| **RSS Transmitter** (490-/492-/493-) | **`Σ over inverters of ceil(strings_i / coresCapacity)`** where single-core = 10 strings, dual-core = 20 strings. **Per inverter — never global.** *(Contested: lane 1 said global `ceil(strings/10)`, lane 3 said `= inverterCount`. Audit settled per-inverter, string-driven: Tigo forbids conductors from separate inverters sharing a core or a conduit, ≥8 in separation)* | **ONLY** when the inverter satisfies **all five** integrated-transmitter conditions (§1.5). Otherwise never zero — a TS4-A-F with no keep-alive outputs **0.6 V** and the array is dead, not merely unmonitored. Ground-mount does **not** remove it | conditional |
| Core count per transmitter | Single core if `strings_i ≤ 10` **AND** `homeRunRoundTrip ≤ 300 m`. Dual core if `strings_i` 11–20 **OR** round trip 300–500 m. **OR, not AND** — two cores in series for reach consumes both cores, so you cannot get 20 strings *and* 500 m from one unit *(contested: lane 3 said AND; audit settled OR)* | — | rule |
| Transmitter grouping (PST) | ≤10 transmitters per group (1 Leader + 9 Followers), all on **one shared 20 A breaker**, ≤30 m (100 ft) signal wiring to the last transmitter, ≥8 in separation between groups' conductors. >10 transmitters ⇒ **flag for Tigo design review**, do not auto-BOM | — | rule |
| **12 V ±2% / 1 A PSU** | 1 per transmitter on a 120/240 V feed | included in 492-xx kit; zero if integrated transmitter | required |
| **12 V ±2% / 10 A (120 W) PSU** | 1 per group of ≤10 transmitters on a 277/480 V feed | included in 493-00000-52 | conditional |
| Weather enclosure + 35 mm DIN rail | 1 per outdoor transmitter location. Bare 490-xx is NEMA 1 indoor-only. **493-00000-52 ships with NO enclosure** — add a separate line | indoor location, or 492-xx kit purchased | conditional |
| Dedicated AC branch circuit shared with the inverter | 1 | never omitted on a structure-mounted array | required |
| NEC 690.12(C) initiator — one common system-wide device killing **all** inverters and **all** transmitters together | 1 per site | ground mount (Tigo: ground-mounts not subject to RSD — verify against AHJ code cycle) | required |
| PVRSS placard, within 914 mm (3 ft) of the initiator; NEC 690.56(C) labeling | 1 per initiation point | ground mount | required |
| RSS Signal Detector 400-00900-00 | **per crew/truck — never scaled by module count** | — | optional |
| TAP / CCA | **0** | — | never |

Hard gates the engine must enforce and refuse to design past: **≤10 string conductors per core, ≤160 A per core, ≤1500 VDC string, ≤30 modules per string, ≤300 m single-core / ≤500 m dual-core round trip, negatives only through the core (black side to array).** Beyond 20 conductors ⇒ add transmitters into a PST group. Beyond 1640 ft round trip ⇒ **relocate the inverter, there is no part** — flag, do not invent hardware.

### 1.3 Monitoring line — TS4-A-O / TS4-A-S (and TS4-X-O/-S)

| Companion | Qty rule | NOT needed when | Status |
|---|---|---|---|
| **TS4-A-O / -S** | `= moduleCount` where RSD is required. Selective deployment (-O on shaded, -S on the rest) is supported only where the string has its own MPPT | — | required |
| **TAP** 158-00000-02 | `qty = max(geometryCount, ceil(TS4count / 300))`. **Geometry almost always dominates — do not size on the 300 ceiling.** `geometryCount` = 1, +1 per additional roof orientation (a ridge/hip blocks the radio), +1 per array section >1 m below the main roof, +1 per parapet / large HVAC / chimney / dormer, +1 per module gap >10 m, +1 per additional building. Coverage radius: **flat 18 m, metal/tile 13 m, ground/carport/elevated 35 m.** Constraints: ≥10 m between TAPs, ≥5 TS4 inside a TAP's radius, ≤10 m between adjacent TS4, **never in an attic**. Typical residential = 1 CCA + 1–3 TAPs. **Subtract the TAP bundled in a 344-/348-xx kit** | TS4-A-O used for **optimization only**, with no Tigo monitoring and 690.12 satisfied entirely by other means. **No such exemption for -S or -M** | required / conditional (see below) |
| **CCA** 346-00000-00 | `= ceil(max(TAP/7, TS4/900))`, **plus the hard override: no single MPPT may be split across two CCAs** — Tigo calls this *"a safety non-compliance condition."* One CCA may serve several inverters provided no MPPT is split; recommended default 1 CCA per inverter | same -O optimization-only exemption | required / conditional |
| **CCA PSU** | 1 per CCA. `TAPs ≤ 2` ⇒ 12–24 VDC ±2% 1 A. **`TAPs ≥ 3` ⇒ 24 VDC 1 A required.** *(Contested: a Tigo help article puts the step at ">3 TAPs"; the CCA datasheet Rev 1.5 and CCA/TAP manual Rev 2.2 both say "3 or more". Audit tie-break: product documents win — require 24 V at 3)* | included in every 344-/348-xx kit | required |
| **RS-485 comms cable** | CCA GATEWAY → TAP1, then TAP-to-TAP. 4 conductors, ≥1 twisted pair, 18–22 AWG, **OD ≤9 mm** to fit the TAP gland. Belden 3107A named compliant. **Not included with either product and not a Tigo SKU** — the single most-forgotten line | never | required |
| 120 Ω terminating resistor handling + ferrules | Resistor is factory-fitted in every TAP: **remove on all intermediate TAPs, retain in the last** | single-TAP chain | conditional |
| CCA enclosure | min NEMA 1 indoors, **min NEMA 4 outdoors** | 348-00000-52 kit purchased | conditional |
| Internet at the CCA (Ethernet or Wi-Fi) | 1 site line item. **Safety-critical:** RSD on -O/-S/-M is enabled by cloud Discovery; blind deployment *"does not enable RSD and may not be compliant."* Also a warranty condition | never, on a 690.12 job | required |
| AC branch circuit + initiator that removes power from the CCA | 1 | ground mount | required |
| RSS Transmitter | **0** on TS4-A generation | — | never (see §6 for TS4-X/725 W) |

**The -O exemption, settled.** Both quotes are real. CCA/TAP manual Rev 2.2: *"TS4-A-O MLPE used to optimize performance only do not require a TAP or CCA."* Help article: *"Full Deployment and System Discovery is required for all TS4-A-O systems."* Resolution: the exemption covers the **optimization function only**. Engine rule:

```
if variant == TS4-A-O and functions == {optimization} and rsdSatisfiedElsewhere == true:
    TAP = 0; CCA = 0; warn("optimization-only: warranty reduced, no monitoring, no MLRS")
else:
    TAP, CCA = REQUIRED
```
Lane 1's unqualified "conditional" would drop code-required hardware. Contested; audit settled against it.

### 1.4 TS4-A-M — refuse to satisfy 690.12

`TS4-A-M qty = 1/module`; TAP + CCA required for it to function at all, same math as -O/-S. **RSS Transmitter = 0 and would not help.**

Engine must throw: `ERROR: TS4-A-M provides no rapid shutdown; NEC 690.12 unsatisfied.` Evidence: no rapid-shutdown spec block on its datasheet where -S has one (30 s limit, ≤240 VA / ≤8 A / ≤30 VDC); standards line reads "NEC 690.12 UL 1741" vs -S's "…PVRSE/PVRSS"; **0 of 355 rows** on Tigo's UL PVRSS list; dropped from TAP datasheet Rev 1.3 compatibility list; Tigo's own downloads page titles it "Legacy". Its datasheet headline "Module-level monitoring and rapid shutdown" is a copy-paste artifact from the -S sheet — do not parse it.

### 1.5 Integrated-transmitter exemption — the five joint conditions

External transmitter, its PSU and its enclosure all drop to zero **only if all five hold**:

1. The inverter carries a factory-integrated Tigo RSS transmitter (Tigo PCBA 490-00100-51/-52), **and**
2. that specific inverter **model's** row on tigoenergy.com/ul-pvrss lists **TS4-A-F** (and -2F if used) among its certified models, **and**
3. the built-in core covers the design — same gates apply (≤10 conductors, 160 A, 1500 VDC, 30 modules/string), **and**
4. the 690.12(C) initiator de-energizes **the inverter itself**, since the keep-alive now originates inside it, **and**
5. any built-in inverter PLC transmitter **not** used by the Tigo RSS system is disabled (manual checklist, verbatim).

**Three traps the engine must not fall into:**
- **"UL PVRSS certified" ≠ "transmitter built in."** 355 certified rows, only **43** are Tigo Enhanced. Keying off the certification list under-BOMs ~88 % of certified inverters.
- **"Tigo Enhanced" is necessary but not sufficient.** Tigo's own /enhanced page defines the program as an integrated RSS Transmitter **or** an integrated CCA. The words "have the RSS Transmitter built-in" appear only in image alt text. Confirm against the inverter maker's manual before deleting the line.
- **Do not treat Tigo's own TSI/EI inverters as integrated on a TS4-A-F job.** None of the 9 TSI rows are flagged Enhanced, their method field reads "CCA", and only 2 of 9 (TSI-7.6K-US, TSI-11.4K-US) are certified with TS4-A-F at all.
- **Never key off the page's hidden `method` column.** It records the method the system was *certified with*, not integration — 137 rows read "RSS Transmitter" including SMA, Solis, GoodWe, none of which embed one.

Verified Tigo Enhanced set (scraped 2026-08-24, reproduced model-for-model across two independent audits; **re-scrape periodically**): Canadian Solar ×18, Growatt ×15 (MIN 3000–11400 TL-XH US, SPH 3000–6000 TL BL-US), CPS ×4, Yaskawa Solectria ×4, Sungrow ×2 (SG36CX-US, SG60CX-US).

**Named gotcha:** Sol-Ark is UL PVRSS certified but **not** Enhanced ⇒ needs an external transmitter, **and** its TX-15K-A aux terminal (12 V @ 100 mA / 1.2 W) is explicitly incompatible with both the transmitter (12 V/1 A) and the CCA (12–24 V/1 A). Engine should emit an explicit warning whenever a Sol-Ark inverter and any Tigo comms device coexist.

---

## 2. PART NUMBERS

**Transmitter family — RSS datasheet 002-00146-00 Rev 1.4 (2025-04-11) ordering table; this is the complete and exclusive current list:**

| P/N | Description |
|---|---|
| 490-00000-51 | Single core, RSS transmitter, DIN rail — **bare** |
| 490-00000-52 | Dual core, RSS transmitter, DIN rail — **bare** |
| 490-00100-51 / -52 | Single / dual core RSS transmitter **PCBA** (OEM inverter-integrated; publicly listed, contrary to lane 1's "not separately purchasable") |
| 492-00000-51 | Single core + DIN rail + 120/240 VAC PSU + **outdoor enclosure** |
| 492-00000-52 | Dual core + DIN rail + 120/240 VAC PSU + **outdoor enclosure** |
| 493-00000-52 | Dual core + DIN rail + 480/277 VAC PSU — **NO ENCLOSURE** |

**493-00000-51 DOES NOT EXIST.** One lane fabricated it by false symmetry with the 492 pair. Tigo makes no single-core 277/480 V transmitter; on a 277/480 V service the only option is the dual-core 493-00000-52 plus a separately-sourced NEMA 4 enclosure if outdoors.

**Comms family — current:** `158-00000-02` TAP · `346-00000-00` CCA standalone · `344-00000-52` CCA kit (TAP + DIN PSU) · `348-00000-52` CCA kit (TAP + DIN PSU + outdoor enclosure).
**Comms family — legacy, real P/Ns but absent from CCA datasheet Rev 1.5 and current distributor catalogs; flag, do not auto-quote:** `344-00000-62` · `348-00000-62` · `348-00000-10` (**no TAP included** — the classic under-BOM trap).

**MLPE — current:** `481-00252-32` TS4-A-F 15 A 700 W · `481-00252-62` same, long cable (72-cell landscape) · `484-00252-22` TS4-A-2F 15 A / 1000 W (500 W per input) · `484-00252-24` same, long cable *(missing from all three research lanes)* · `466-00252-32` TS4-A-S · `461-00252-32` TS4-A-O. Datasheet Rev 3.3 also lists `481-00252-20`, `481-00261-32/-62` and the `486-xxxxx` / `488-xxxxx` families, which **no lane captured** — pull the current sheet before locking the SKU table.

**TS4-A-M:** `455-00252-20 / -32 / -62`, `455-00261-32 / -62` — published, not unknown as all three lanes claimed. Legacy; see §5.

**Tool:** `400-00900-00` RSS Signal Detector (per crew).

**Not Tigo part numbers — never enter in a Tigo SKU field:** Meanwell HDR-15-12, DR-15-24, WDR-120-24. Tigo does not sell power supplies separately from kits at all, so a bare `490-xx` or `346-00000-00` line **forces** a third-party PSU line.

⚠ **Do not order a WDR-120-24 for a transmitter.** A Tigo help article lists it as the commercial supply (180–550 VAC in, 12–15 VDC @ 5 A), but that entry is internally incoherent: a Meanwell "-24" is a 24 V part, 12–15 V violates the transmitter's binding 12 V ±2 % input, and 5 A cannot feed ten 1 A transmitters. **Spec 12 V, 10 A, 120 W.** Tigo: *"Using power supplies outside the following requirements may damage the device and void the warranty."*

---

## 3. VERIFIED PRICES (all USD, all confirmed live 2026-08-24)

| P/N | Config | Seller | Price | Stock |
|---|---|---|---|---|
| 348-00000-52 | **KIT** — CCA + PSU + outdoor enclosure + **1 TAP** | Soligent (SKU 570-1245) | **$423.49** | In stock, 5 warehouses |
| 158-00000-02 (listed as 158-20000-00) | bare TAP | Soligent (SKU 570-1246) | **$78.20** | In stock, all 7 warehouses |
| 490-00000-51 | bare single core | NAZ Solar Electric | **$49.41** | In stock |
| 490-00000-51 | bare single core | US Solar Supplier | **$55.40** | Available, ships Aug 31–Sep 7 |
| 490-00000-51 | bare single core | Signature Solar | **$52.71** | **Out of stock** |
| 490-00000-51 | bare single core | Stellavolta | **$45.50** (tax-incl.) | **Out of stock** |
| 490-00000-52 | bare dual core | Signature Solar | **$60.75** | In stock |
| 490-00000-52 | bare dual core | Stellavolta | **$63.85** | Ambiguous / likely OOS |
| 490-00000-52 | bare dual core | Soligent (SKU 570-0025) | **$78.75** | **Pre-order**, extended lead time + freight |
| 492-00000-51 | **KIT** — transmitter + 120/240 V PSU + outdoor enclosure | PowerStore | **$163.32** | "Should be in Stock – Contact Us" |
| 484-00252-22 | bare TS4-A-2F | Soligent (SKU 580-0000) | **$67.71** | Limited — Millstone NJ call |
| *no P/N listed* | "Tigo RSS Transmitter" | altE Store | $55.55 | In stock — **unusable for BOM, no P/N** |

**Pricing gaps — plainly stated.** No public price was obtainable for: `346-00000-00` bare CCA, `344-00000-52`, `492-00000-52`, `493-00000-52`, `481-00252-32` / `-62` TS4-A-F, `466-00252-32`, `461-00252-32`, `400-00900-00`, or **any** TS4-X SKU. CED Greentech / Greentech Renewables list these products but gate price behind a **dealer login** — those must be quoted, not scraped. Engine should model price as `{value, seller, asOf, stockState}` with an explicit `DEALER_QUOTE_REQUIRED` state rather than a null.

Two scraping hazards worth encoding: (a) Soligent's product URLs carry unrelated slugs (`/Storz-Power-10255` is the Tigo CCA kit) — **re-verify by part number, never by URL**; (b) Signature Solar suppresses the visible price on out-of-stock items, so the only dollar figures in the DOM belong to *related-product tiles* (the $60.75 dual-core sits on the single-core page) — read `product:price:amount` / BCData, not rendered text.

---

## 4. STILL UNCERTAIN — needs a distributor or Tigo call

1. **Transmitter outdoor enclosure rating — Tigo contradicts Tigo.** Install manual Rev 4.1 requires **NEMA 4** and describes the kit enclosure as IP67/NEMA 4X, 203 × 115 × 278.4 mm. RSS datasheet Rev 1.4 and the PST FAQ rate the same enclosure **IP67 / NEMA 3R**, 270 × 170 × 110 mm. **NEMA 3R does not satisfy a NEMA 4 requirement.** No lane detected this. Settle before speccing a 492-xx kit onto a NEMA 4 line.
2. **484-00252-22 vs 485-00252-22.** One audit read Tigo's 2F ordering table Rev 2.4 as listing **both as distinct current classes** (484 = 15 A / 1000 W / 500 W per input; 485 = 25 A / 1400 W / 700 W per input, plus 484-01xxx EMEA and 487-xxxxx IEC). The other audit found 485 only as corrupted page metadata and confirmed 484 at every US distributor. Most likely reading: **485 is a real 25 A spec class that US distributors don't stock.** Corroborating oddity — Soligent's 484 listing carries 25 A / 1400 W body text under a "15 A" title. Confirm the 25 A part's orderability before letting the engine select on power class.
3. **TAP MPN divergence.** Soligent sells the TAP as `158-20000-00`; everyone else (ShopSolar, Greentech, PowerStore, SanTan) uses `158-00000-02`. Same product to all appearances. Confirm whether these are packaging variants or a stale MPN field.
4. **Are 344-00000-62 / 348-00000-62 / 348-00000-10 still orderable?** Real P/Ns, but found only in a ~2019 Tigo datasheet citing NEC 2014/2017, absent from Rev 1.5 and current catalogs.
5. **Whether integrated (PCBA) transmitters are non-PST.** One lane asserts they cannot sync into a Pure Signal group; Tigo's own PCBA datasheet presents module and PCBA forms as one Pure Signal family in single and dual core. **Unverified — treat as an open question, not a design rule.**
6. **Blind-deployment warranty number.** Tigo says "Reduced Warranty Coverage" / "excludes the system from complete Warranty eligibility." The widely-repeated "25 years drops to 5" is **not sourced** — direction confirmed, magnitude not. Do not quote the number.
7. **Ground-mount RSD exemption** — Tigo states ground mounts are not subject to RSD; verify against the AHJ's adopted code cycle before zeroing the stack.
8. **TS4-X and 725 W TS4-A part numbers** — no distributor P/Ns verified for any of them.
9. **Canonical SKU source.** Tigo publishes a "TS4 Flex MLPE Part Numbers" datasheet behind its Downloads page. Pull it and make it the SKU table's source of truth before these go into live quoting. (Consistent with the standing field-verify rule on migrated equipment specs.)

---

## 5. EOL / SUPERSEDED

**Must never be emitted as orderable:**
- `490-00000-10`, `490-00000-20` — legacy non-PST transmitters; `490-00000-51` is the stated replacement.
- `492-00000-10`, `492-00000-20` — legacy non-PST kits, same generation. One lane listed these as acceptable for single-inverter residential jobs; that is wrong.
- `458-00252-32`, `458-00257-12`, `458-00261-32` — the 500 W / 15 A TS4-A-F generation from the 2020 datasheet, superseded by the 700 W `481-00252-32`. One lane still carried these.
- `493-00000-51` — never existed.

**Legacy / flag-don't-quote:** `344-00000-62`, `348-00000-62`, `348-00000-10`; **TS4-A-M** entirely (datasheet titled "Legacy", dropped from TAP Rev 1.3 compatibility, 0 UL PVRSS rows).

**Generation shift in progress:** the TS4-A 700 W line is being succeeded by **TS4-X (800 W)**, with distributors reporting TS4-A-F increasingly out of stock. Put an **availability check on every TS4-A quote**. The `002-00141-00` CCA datasheet in hand is Rev 1.5 (2024-06-25) against Tigo's listed Rev 1.4 (2026-08-14) — the doc set is a step behind; re-pull before locking.

---

## 6. MFRS — the rule that breaks the family switch on current product

TS4-X and **TS4-A 725 W** implement multifactor rapid shutdown: they accept a keep-alive from **either** an RSS transmitter **or** CCA/TAP, and **both must be lost** to enter RSD. Consequences the engine must encode:

- On TS4-X-O/-S: CCA + TAP **required**; RSS transmitter becomes **optional**, not forbidden. Lane 1's "hard switch, never additive" is false for this generation.
- MFRS is **not** "redundant safety signalling" (lane 2's framing) — it *increases* what must be removed to de-energize. Correct framing: **the initiator must remove every keep-alive source.**
- Tigo field notice, verbatim: *"If a third-party RSS Transmitter remains active, the TS4-X and TS4-A (725W) devices will continue receiving a valid keep-alive signal, and the PV array will remain energized regardless of CCA status."* — **"CCA OFF ≠ Array OFF."**
- All TS4-X and TS4-A 725 W **ship in the ON position**: full module voltage the moment they are plugged in.
- Engine rule: if `generation ∈ {TS4-A_725W, TS4-X}` **and** a CCA is emitted **and** the inverter has an integrated transmitter ⇒ emit a **blocking design warning** and require the plan set to show the initiator killing both the CCA circuit and the inverter. Do not silently bundle both.

**Plan-set physics line:** each TS4 drops to 0.6 V on shutdown, so string voltage falls below 80 V within 30 s (NEC 690.12 inside-array-boundary limit). Wait 30 s after initiation before touching DC.

---

## 7. HARD ERRORS THE ENGINE MUST THROW (not warn)

1. F/2F mixed with O/S/M on the same array (TS4-A generation).
2. TS4-A-M selected on a structure-mounted array with `rsd` in `functions`.
3. Any MPPT whose strings map to more than one CCA.
4. `strings_i > 10` routed through a single core, or conductors from two inverters through one core.
5. Home-run round trip > 500 m (1640 ft) — no sanctioned part exists; relocate the inverter.
6. >10 transmitters (multiple PST groups) — stop and route to Tigo design review.
7. TS4-A-F/2F emitted with zero keep-alive sources for any reason, including ground mount.
8. Bare `490-xx` or `346-00000-00` emitted without a PSU line, or an outdoor location emitted without an enclosure line, or a CCA emitted without an RS-485 cable line.
9. `integratedTigoTx == UNKNOWN` on a fire-safety design — the inverter→built-in-transmitter mapping must be looked up per model at tigoenergy.com/ul-pvrss, never guessed and never hardcoded.