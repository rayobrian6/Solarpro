# Equipment selection authority — audit, manufacturer truth, migration map

**Date:** 2026-09-21 · **Status:** AUDIT. **No selection code written.**

> **Compatibility answers "can I use this?" · Recommendation answers "what does
> SolarPro suggest?" · Selection answers "what am I installing?" The installer
> owns the third. SolarPro may recommend. SolarPro validates. SolarPro must not
> silently substitute.**

---

## 0. Corrections to what I previously reported

**(a) "`config.combinerId` does not survive a reload." — WRONG. It does.**
`/api/engineering/save-config` persists the whole config object with no field
whitelist, `finalizeConfigEnvelope` spreads rather than rebuilds, and hydration
restores by spread. So `combinerId` round-trips through
`projects.engineering_config`.

The real defect is sharper: **it persists in the wrong store.**
`engineering_config` is the engineering page's private workspace. The canonical
store every other consumer reads — `projects.selected_equipment` — never
receives it, because `reconcileFromEngineeringConfig` extracts only panel and
battery. One caveat: an autosave early-return skips the save entirely when the
fleet looks like a placeholder, so a combiner picked in that window is lost.

**(b) "The 5C/6C difference drives the NEC 690.13 statement." — Overstated as
manufacturer authority.** Enphase never cites 690.13 for either combiner. Their
framing is **690.12** (rapid shutdown) and **706.15** (ESS disconnect), plus the
phrase "PV disconnecting means" for the 6C's aggregate breaker. The repo's
690.13 statement is engineering judgement and must not be presented as a
manufacturer citation. The *capability* difference is real (§2); the citation
was mine.

---

## 1. A canonical authority already exists — extend it, do not build another

| layer | what |
|---|---|
| **Store** | `projects.selected_equipment` JSONB (migration 101), shape `SelectedEquipment` in `lib/system/selectedEquipment.ts` |
| **Per-subsystem** | `SubSystemEquipment` in `lib/system/subSystemEquipment.ts` — a frozen v1.0 contract with a written spec |
| **Precedence** | `lib/permit/snapshot/resolution/equipmentSelection.ts` — a provenance lattice `explicit-user:60 > project:50 > design:40 > fleet:30 > company-default:20 > subsystem:10 > legacy-generated:0`, which refuses to auto-pick when two active explicit selections disagree |

**The ceiling:** `EQUIPMENT_IDENTITY_FIELDS = ['module','inverter','mounting','battery']`.
Combiner, disconnect, gateway, meter collar, RSD, trunk cable, ATS, generator,
EV charger are **not in the canonical store at all**. That is *why* `combinerId`
became session state — there was no slot, so one was bolted on.

**Two things already exist and are unwired:**

* `SubSystemEquipment.bosDeviceIds?: string[]` — declared, **zero readers, zero
  writers repo-wide**. The slot for the combiner is already in the contract.
* **D12 Rail Selection** (`lib/railSelection/`) is the template. It solved this
  exact problem **without a migration**, by claiming a key inside
  `selected_equipment` (`RAIL_SELECTION_KEY = 'railSelection'`). Its record
  carries `railSystemId`, **what it was pinned FOR** (`mountingSystemId`, so
  "changing the mount does not silently carry it over"), `selectedBy`,
  `selectedByKind: 'user'|'service'`, `selectedAtIso`, a **required** `basis`,
  typed refusals, and **supersession into `superseded[]` rather than
  overwrite**. That is the shape a combiner selection needs.

## 2. Manufacturer truth — 5/5C vs 6C

Sources: 5/5C datasheet **IQC-5-5C-DSH-00007-8.0 (2025-12-29)**, 5/5C QIG
**v12.0 (2026-04-21)**, 6C datasheet **DSH-00585-4.0 (2025-08-25)**,
**TEB-00282-5.0 (June 2026)**, **TEB-00052-3.0 (Feb 2026)**, compatibility
matrix **G3CM-DSH-00105-7.0** + the live compatibility page.

### 🚨 Microinverter family does NOT discriminate

**Both combiners document identical support: IQ6, IQ7 and IQ8 Series.** So
`IQ8 → a specific combiner` is an authority Enphase does not assert. The
catalogue's `compatibleWith: ['enphase-iq-combiner-5']` on the IQ8 rows is
**incomplete, not wrong** — the 6C is equally compatible.

### What actually discriminates

| dimension | effect |
|---|---|
| **Battery model** (dominant) | IQ Battery 10C/10CS → **6C only**. IQ Battery 5P → **5/5C only** (6C = No). Legacy 3/10/3T/10T → 5/5C with COMMS-KIT-01 |
| **MID architecture** | IQ System Controller 3/3G → 5/5C. IQ Meter Collar → 6C. **No System Controller variant works with the 6C** |
| **Capacity** | 5/5C: 4 branches, 80 A PV, 125 A busbar, 64 A max continuous. 6C: 4–5 branches, 100 A PV busbar + **separate 200 A DER busbar**, 160 A DER. >4 branches, EVSE or load control → **forces the 6C** |
| **Service voltage** | 5/5C: 120/240 **or 120/208**. 6C: **240 split-phase only** → a 208 V service has documented 5/5C support and no documented 6C support |
| **Features** | Generator or fully off-grid → **excludes the 6C**. The 6C is **not service-entrance rated** |

### Both are valid for a battery-less IQ8 system

The compatibility matrix has a **SOLAR ONLY** column and both read **Yes**.
**So for a battery-less job, "which combiner" is an installer decision** —
constrained by capacity and service voltage, but not derivable from the inverter.

### The 5/5C is CURRENT, not superseded

Datasheet revised 2025-12-29; QIG revised 2026-04-21; not marked EOL on the live
page **which does mark the 4/4C EOL**. It is the **mandatory** combiner for any
IQ Battery 5P or IQ System Controller system. **The two products are parallel,
not sequential.** The installer's report of still fitting 5C is fully consistent
with Enphase's current documentation.

### Disconnect capability — real, but not a 690.13 citation

* **5/5C: main-lug only.** No aggregate breaker. Disconnecting function is
  *per-branch*, distributed across up to four breakers. Per TEB-00052, the PV
  branch breaker may serve as the 690.12 RSD and the storage DER breaker as the
  706.15 ESS disconnect **when the combiner is readily accessible**.
* **6C: yes** — a factory-installed **60 A aggregate PV breaker** (upsizable to
  80/100 A) usable as the PV disconnecting means, and as the RSD initiator when
  installed outdoors and readily accessible. Trap: an external RSD-initiating
  disconnect must be **3-pole**, with the third pole on the 6C's AC-sense header.
* **Permit note:** Enphase instructs that the **model number** `X-IQ-AM1-240-6C`
  is used for interconnection and permitting, never the `-3BRK` ordering SKU.

## 3. Consumer migration map

| consumer | receives the installer's pick today? |
|---|---|
| SLD route | **yes** (`combinerId` → `overrideDeviceIds`) |
| Permit route + all planset sheets | **yes** |
| Permit's own BOM | **yes** |
| **`/api/engineering/bom`** | **NO** — `BOMGenerationInputV4` has no such field |
| **`lib/bom-engine-v4.ts` ×2** | **NO** — passes `compatibleCombinerIds`, never `overrideDeviceIds` |

**`IntegratedEquipmentPlan.source` (`'override' | 'auto'`) is logged once and
otherwise discarded.** The permit snapshot stores `combinerLabel` — a display
string — and no provenance. **The package cannot state whether a human chose the
combiner or a resolver guessed it.**

## 4. Identity is carried as a display string

`ResolvedEquipment` — consumed by ~15 permit sheet generators — **carries no ids
at all**. The repo says so itself: *"inverters still have no stable identity"*.
Modules have `panelId` and a proper `resolveModuleIdentity` with three states and
"no fourth state and no best guess"; inverters get a `Set` of model strings.

**The live 6C, explained:** `app/engineering/page.tsx:6422` sends
`` `${invData.manufacturer} ${invData.model}` `` → `"Enphase IQ8M"` →
exact-match miss → pairing `undefined` → `?? getBosDevice('enphase-iq-combiner-6c')`
→ **6C**. Reproduced:

```
model="IQ8M"           pairing=FOUND      -> IQ Combiner 5C   acDisconnect=false
model="Enphase IQ8M"   pairing=undefined  -> IQ Combiner 6C   acDisconnect=true
```

`invData` came from `getInvById(firstInv.inverterId, …)` — **the id was in scope
and was not sent.** `page.tsx:15318` already sends `mountingSystemId`; that is
the pattern to copy. `combinerCompatibilityFor`'s third parameter already accepts
an id and documents why it is preferred.

## 5. Provenance is laundered before the lattice sees it

`reconcileFromEngineeringConfig` hard-codes `source: 'engineering'` and runs on
**every** autosave. So a panel written by automatic compatibility auto-heal
arrives stamped `'engineering'`, scores as an explicit channel, and lands at
**tier 60 — `explicit-user`**. A machine choice is recorded in the permit as the
installer's decision. In the other direction `reconcile.ts` writes
`source: 'reconciliation'`, which is in neither list, **demoting** a genuine user
choice. And `upsertSelectedEquipment` is last-write-wins and never reads `source`
at all.

**Fix this before extending the store to more equipment kinds**, or the error
propagates to all of them.

## 6. A field lock locks nothing

`SystemConfigLocks` has five fields and no mounting, combiner, BOS or optimizer.
`shouldAllowOverride` has **one** production call site, for `'inverter'` only. No
UI control is disabled by a lock. A grep for lock/controlMode across `app/api`,
`lib/permit`, `lib/bom`, the SLD renderer and `lib/equipment` returns **two hits,
both printing `controlMode` into an LLM prompt**. A lock is a client-side
advisory consulted by two `useEffect`s; it reaches no server route, no resolver,
no engine.

## 7. Legacy defaults adopt today's newest product

`MICROINVERTERS[0]` / `STRING_INVERTERS[0]` are **catalogue array positions**.
Insert a product at the top of `equipment-db.ts` and every legacy project that
hydrates a fresh inverter silently adopts it. The combiner has the same shape via
the `?? getBosDevice('enphase-iq-combiner-6c')` last resort — **a historical IQ7
job regenerated today gets the 6C.**

Migration 109 is the precedent for doing this safely: backfill only where
unambiguous, stamp `source='migration'` so it scores rank 0, and refuse rather
than guess between candidates.

## 8. Implementation order, when it begins

1. **Fix provenance laundering** — until `source` is trustworthy the lattice
   ranks machine writes as user decisions.
2. **Send the inverter id** in the SLD payload instead of a concatenated display
   string. Fixes the live 6C without pre-empting the selection design.
3. **Wire `bosDeviceIds`** into the canonical store on the D12 rail pattern —
   pinned-to, who/when/why, typed refusals, supersession, no migration needed.
4. **Add `overrideDeviceIds` to `BOMGenerationInputV4`** — a one-field gap.
5. **Stop `?? getBosDevice('6c')` from being a silent selection.** Unknown stays
   unknown; it must not become the newest product, and must not become the 5C
   either.
6. **Record `IntegratedEquipmentPlan.source` + the device id** in the snapshot.
7. **Revisit the golden** — it should prove the explicit project choice
   propagates, not that a compatibility resolver returns this model today.

## 9. Open — needs a decision

The catalogue lists only the 5 for IQ8, but Enphase documents **both**. Widening
`compatibleWith` is manufacturer data and changes which products are *offered*;
it must not be done to make a test pass.
