# SolarPro — Session Handoff Document
## For Thread Continuity: v48.28 → Next Tasks
**Last updated:** 2025-06 | **Repo branch:** `dev` | **Last commit:** `7100400`

---

## 🗺️ BIG PICTURE — What This App Is

**SolarPro** is a Next.js 14 App Router + TypeScript application for solar sales professionals. It generates PDF proposals, does engineering design, and calculates savings/ROI for solar+battery systems. Key user-facing flows:

1. **Engineering Page** (`app/engineering/page.tsx`) — Sales rep configures a system: picks state, utility, ZIP, system size, equipment. This drives the proposal engine.
2. **Proposal Engine** — `lib/proposalTruthEngine.ts` (64K lines) builds the full financial/technical profile from config inputs. Output goes to `lib/proposal/buildCanonicalProposal.ts` → `lib/proposal/renderProposalHTML.ts` → PDF.
3. **Utility Programs Panel** — A panel on the Engineering page (v48.27+) that auto-shows TOU rate plans, battery incentives, solar rebates, and NEM policy for the selected utility.

---

## ✅ WHAT WAS COMPLETED (This Session)

### v48.27 — Fix: Programs Panel Was Invisible
**Problem:** The programs panel was not appearing when a utility was selected (e.g., Ameren Illinois).

**Root Cause:** ID format mismatch.
- `config.utilityId` comes from `lib/utilityDetector.ts` → slug format: `"il-ameren-illinois"`
- `getUtilityPrograms()` in `lib/utilityPrograms.ts` expects underscore format: `"ameren_il"`
- The lookup always returned `null`, so the panel was always hidden.

**Fix (in `app/engineering/page.tsx` ~line 7497):**
```tsx
// ❌ OLD (broken):
const programs = getUtilityPrograms(config.utilityId); // always null

// ✅ NEW (fixed):
const nameLower = selectedUtil.name.toLowerCase();
const stateCode = (config.state || '').toUpperCase();
const stateProfiles = PROPOSAL_UTILITY_PROFILES.filter(p => p.state === stateCode);
const matchedProfile = stateProfiles.find(p => {
  try { return new RegExp(p.utility_name_pattern, 'i').test(nameLower); } catch { return false; }
});
const programs = matchedProfile ? getUtilityPrograms(matchedProfile.utility_id) : null;
```

**Added import at top of `app/engineering/page.tsx`:**
```ts
import { PROPOSAL_UTILITY_PROFILES } from '@/lib/proposalTruthEngine';
```

**Commit:** `6cae4ba`

---

### v48.28 — Expand Utility Programs to All 995+ Utilities
**Problem:** `lib/utilityPrograms.ts` only had data for 18 utilities. The other ~977 utilities in the SolarPro database showed a blank programs panel.

**What was built:**
- `scripts/tou_additions.ts` — 740 lines of TOU rate plan entries for 40+ major IOUs
- `scripts/battery_solar_additions.ts` — 525 lines of battery incentive + solar rebate entries
- `scripts/nem_additions.ts` — 725 lines of NEM program entries for all 49 states
- `scripts/inject_programs.py` — Python script that inserted all three files into the correct arrays in `lib/utilityPrograms.ts`

**Result:**
| Array | Before | After |
|---|---|---|
| `TOU_RATE_PLANS` | 18 utilities | 53 plan entries |
| `BATTERY_INCENTIVE_PROGRAMS` | 5 entries | 26 entries |
| `SOLAR_REBATE_PROGRAMS` | 3 entries | 18 entries |
| `NEM_SPECIAL_PROGRAMS` | 12 entries | 55 entries |
| **Unique utility IDs covered** | **18** | **997** |
| **File size** | **1,420 lines** | **3,411 lines** |

**Commit:** `7100400` | **TypeScript:** ✅ 0 errors

---

## 🔑 CRITICAL CONCEPTS — Read Before Touching Anything

### The ID Format Problem (VERY IMPORTANT)
There are **two different utility ID formats** in this codebase. Mixing them up breaks things silently.

| Source | Format | Example |
|---|---|---|
| `lib/utilityDetector.ts` → `UtilityOption.id` | Slug: `{state}-{name}` | `"il-ameren-illinois"` |
| `lib/proposalTruthEngine.ts` → `PROPOSAL_UTILITY_PROFILES[n].utility_id` | Underscore | `"ameren_il"` |
| `lib/utilityPrograms.ts` → all `utility_ids[]` arrays | Underscore | `"ameren_il"` |

**The bridge:** Always use `PROPOSAL_UTILITY_PROFILES` + regex pattern matching on `selectedUtil.name` to convert slug → underscore. See the fix in `app/engineering/page.tsx` ~line 7497 above.

**NEVER do:**
```ts
getUtilityPrograms(config.utilityId) // config.utilityId is slug format — will always return null
```

**ALWAYS do:**
```ts
const stateProfiles = PROPOSAL_UTILITY_PROFILES.filter(p => p.state === stateCode);
const matchedProfile = stateProfiles.find(p => {
  try { return new RegExp(p.utility_name_pattern, 'i').test(nameLower); } catch { return false; }
});
const programs = matchedProfile ? getUtilityPrograms(matchedProfile.utility_id) : null;
```

---

## 📁 KEY FILES — What They Are & What They Do

### Core Library Files
```
lib/utilityPrograms.ts          3,411 lines — Utility programs knowledge base
                                 - TOU_RATE_PLANS[]
                                 - BATTERY_INCENTIVE_PROGRAMS[]
                                 - SOLAR_REBATE_PROGRAMS[]
                                 - NEM_SPECIAL_PROGRAMS[]
                                 - buildProgramsMap() — lazily built at runtime
                                 - getUtilityPrograms(utility_id) → UtilityProgramBundle | null
                                 - getUtilityProgramNote(utility_id) → string | null
                                 - hasBatteryIncentives(), hasSolarRebates(), hasTouPlans()

lib/proposalTruthEngine.ts      64,007 lines — THE ENGINE
                                 - PROPOSAL_UTILITY_PROFILES[] — 996 entries, each has:
                                     utility_id (underscore format)
                                     utility_name_pattern (regex to match utility name)
                                     state (2-letter code)
                                     rates, incentives, NEM policy etc.
                                 - buildUtilityProfile(zip, name, state) → full profile
                                 - Imports getUtilityPrograms + getUtilityProgramNote

lib/utilityDetector.ts          301 lines — Generates UtilityOption[] for dropdown
                                 - getUtilitiesByStateNational(state) → UtilityOption[]
                                 - UtilityOption.id = slug format ("il-ameren-illinois")
                                 - UtilityOption.name = display name ("Ameren Illinois")

lib/proposal/buildCanonicalProposal.ts — Maps truth engine output to CanonicalProposal
                                 - cp.policy.utilityPrograms = utility programs bundle
                                 - cp.policy.utilityProgramsNote = text summary

lib/proposal/renderProposalHTML.ts — Renders proposal to HTML for PDF
                                 - Renders utilityProgramsNote in "Utility Rate Plans & Incentive Programs" section
                                 - Located around line 660
```

### App Pages
```
app/engineering/page.tsx        14,109 lines — Engineering config page
                                 - Programs panel: ~line 7491–7565
                                 - Uses PROPOSAL_UTILITY_PROFILES bridge (v48.27 fix)
                                 - Shows TOU, battery, rebate, NEM for selected utility
```

### Scripts (generation artifacts — keep for reference)
```
scripts/tou_additions.ts        739 lines — TOU entries injected into TOU_RATE_PLANS
scripts/battery_solar_additions.ts  525 lines — Battery + solar entries
scripts/nem_additions.ts        724 lines — NEM entries for 49 states
scripts/inject_programs.py      Python script that did the injection (rerunnable)
```

---

## 🚨 WHAT TO DO / NOT DO

### ✅ DO
- **Always run `npx tsc --noEmit`** after any changes to lib/ files before committing. The codebase is strict TypeScript.
- **Always commit to `dev` branch first.** Master is production. Merge dev → master only when tested.
- **Use `PROPOSAL_UTILITY_PROFILES` pattern matching** whenever you need to go from a utility name/slug to a `utility_id` for programs lookup.
- **Check `lib/proposalTruthEngine.ts` for existing utility IDs** before adding new ones — it has 996 profiles with patterns.
- **Use underscore format** (`ameren_il`) for all `utility_ids[]` arrays in `lib/utilityPrograms.ts`.

### ❌ DO NOT
- **Do NOT use `config.utilityId` directly with `getUtilityPrograms()`** — it's slug format, not underscore.
- **Do NOT add duplicate utility IDs** to `utility_ids[]` arrays in `utilityPrograms.ts` — the map builder deduplicates but duplicates in source arrays waste memory.
- **Do NOT edit `lib/proposalTruthEngine.ts` carelessly** — it's 64K lines. Grep first, edit surgically. A bad edit here breaks every proposal.
- **Do NOT regenerate/rerun `inject_programs.py`** on the current `lib/utilityPrograms.ts` — it's already been injected. Running it again will double-inject everything. Only use it on a fresh base file.
- **Do NOT assume a utility has no programs** just because the panel doesn't show — check the `matchedProfile` step first (the name pattern might not be matching).
- **Do NOT add hardcoded state fallback rates** in `proposalTruthEngine.ts` — the system has per-utility EIA rates for all 1,055 utilities (v48.25). State fallback is the old broken pattern.

---

## 🔍 COVERAGE GAP — 17 California Munis + 1 Failsafe

The following 17 utility IDs exist in `PROPOSAL_UTILITY_PROFILES` but have **no entries yet** in `lib/utilityPrograms.ts`. They're all CA municipal utilities and one failsafe placeholder:

```
anaheim_public_utilities_ca
burbank_wp_ca
glendale_water_power_ca
imperial_irrigation_district_ca
lodi_electric_utility_ca
modesto_irrigation_district_ca
pasadena_wp_ca
pepco_dc            ← DC utility (was in original 18 but may have been replaced)
plumas_sierra_rec_ca
redding_electric_utility_ca
riverside_public_utilities_ca
roseville_electric_ca
silicon_valley_power_ca
trinity_pud_ca
turlock_irrigation_district_ca
unknown_failsafe    ← intentionally blank
valley_electric_association_ca
```

**Note:** All CA utilities fall under California's NEM 3.0 / Net Billing Tariff (NBT) law — CPUC mandates it. So at minimum, each of these should get a NEM_SPECIAL_PROGRAMS entry pointing to `ca_nem3_nbt`. The CA IOU NEM 3.0 entry already exists — it just needs these municipal IDs added to its `utility_ids[]` array.

---

## 🗺️ NEXT LOGICAL TASKS (v48.29+)

### Priority 1 — Audit: Does the Panel Render Correctly for All Utilities?
The panel logic in `app/engineering/page.tsx` (~line 7491) only renders if `programs !== null`. With 997 utility IDs now covered, the panel should show for virtually every utility. **Audit task:**
1. Pick 10 random utilities across different states in the engineering page
2. Verify the panel appears with correct TOU, battery, rebate, NEM data
3. Verify the live enrollment URLs actually work
4. Check that the `solar_pro_note` text is displaying in the panel (currently it may not be — the panel only shows: `plan_name`, `plan_description[:120]`, `value_description`, `program_description[:150]`)

### Priority 2 — Expose `solar_pro_note` in the Panel UI
Currently the `solar_pro_note` field on every program entry is NOT shown in the Engineering page panel. This is the most valuable field for a sales rep — it explains the program in plain English and says what to recommend to clients. Consider adding it as an expandable "Pro tip" or tooltip in the panel.

**File to edit:** `app/engineering/page.tsx` ~line 7525–7560
**Example note from Duke PowerPair:**
> "PowerPair is excellent deal — $6,000–$9,000 rebate effectively reduces battery cost dramatically. Dispatch events are rare and short. Recommend PowerPair enrollment for all Duke territory solar+battery installs."

### Priority 3 — Wire Programs into Proposal PDF Auto-Complete
The `utilityProgramsNote` is already flowing into the PDF proposal via `renderProposalHTML.ts` ~line 660. But the **proposal PDF currently only shows the text note** — not a structured list of clickable programs with values. Consider upgrading to show a formatted table:

```
| Program Name               | Type          | Value           | Status |
|---------------------------|---------------|-----------------|--------|
| Duke Energy PowerPair      | Battery Rebate| Up to $9,000    | Active |
| Duke NC TOU-D             | TOU Rate Plan | Save est. 15%/yr| Active |
| NC Net Metering            | NEM           | Full retail rate | Active |
```

### Priority 4 — Add Missing CA Munis to NEM 3.0 Coverage
The 16 uncovered CA muni utilities should at minimum get NEM policy coverage. Quick fix — find the CA NEM 3.0 entry in `NEM_SPECIAL_PROGRAMS` and add their IDs:

```ts
// In lib/utilityPrograms.ts, find the CA NEM 3.0 entry and add to utility_ids[]:
utility_ids: [
  'pge_ca', 'sce_ca', 'sdge_ca',
  // add these:
  'anaheim_public_utilities_ca', 'burbank_wp_ca', 'glendale_water_power_ca',
  'imperial_irrigation_district_ca', 'lodi_electric_utility_ca',
  'modesto_irrigation_district_ca', 'pasadena_wp_ca', 'plumas_sierra_rec_ca',
  'redding_electric_utility_ca', 'riverside_public_utilities_ca',
  'roseville_electric_ca', 'silicon_valley_power_ca', 'trinity_pud_ca',
  'turlock_irrigation_district_ca', 'valley_electric_association_ca',
],
```

Note: CA munis are NOT subject to CPUC NEM 3.0 in all cases — some have their own NEM rules. IID (Imperial), LADWP, SMUD, Modesto ID, and Turlock ID have their own tariffs. Research each before applying a blanket CA NEM 3.0 label.

### Priority 5 — Client/Homeowner Auto-Complete on Proposal Form
The user's original request was: *"How do we auto complete these programs for clients and homeowners?"* The data layer is now done (v48.28). The UX layer still needs to be built:
- When a homeowner's ZIP/utility is detected, show relevant programs on the **proposal form / client portal**
- Pre-populate "available incentives" section of the proposal with the actual programs
- Allow sales rep to check/uncheck which programs to include in the PDF proposal
- Link programs to the savings calculator so battery incentives reduce the battery cost shown to client

---

## 🏗️ SYSTEM ARCHITECTURE OVERVIEW

```
ZIP Code entered by rep
        ↓
lib/utilityDetector.ts
  getUtilitiesByStateNational(state)
  → UtilityOption[] { id: "il-ameren-illinois", name: "Ameren Illinois" }
        ↓
Engineering Page config.utilityId = "il-ameren-illinois"  ← SLUG FORMAT
        ↓
PROPOSAL_UTILITY_PROFILES bridge (pattern match on name)
  → matchedProfile.utility_id = "ameren_il"               ← UNDERSCORE FORMAT
        ↓
getUtilityPrograms("ameren_il")
  → UtilityProgramBundle {
      tou_plans: [Illinois Shines TOU, ComEd PSP...],
      battery_incentives: [...],
      solar_rebates: [Illinois Shines, PSP...],
      nem_programs: [IL Net Metering...]
    }
        ↓
Rendered in Engineering page panel (live) + Proposal PDF (via renderProposalHTML.ts)
```

---

## 🔢 KEY NUMBERS

| Metric | Value |
|---|---|
| `lib/proposalTruthEngine.ts` size | 64,007 lines |
| `app/engineering/page.tsx` size | 14,109 lines |
| `lib/utilityPrograms.ts` size | 3,411 lines |
| PROPOSAL_UTILITY_PROFILES count | 996 profiles |
| Utility IDs covered by programs | 997 |
| TOU_RATE_PLANS entries | 53 |
| BATTERY_INCENTIVE_PROGRAMS entries | 26 |
| SOLAR_REBATE_PROGRAMS entries | 18 |
| NEM_SPECIAL_PROGRAMS entries | 55 |
| Total program entries | 152 |
| States with NEM coverage | 49 |
| Git branch to work on | `dev` |
| Production branch | `master` |

---

## 🚀 HOW TO START A WORK SESSION

```bash
cd /workspace/solarpro-git
git checkout dev
git pull origin dev
npx tsc --noEmit  # verify baseline is clean (should be 0 errors)
```

---

## ⚠️ TOKENS / CONTEXT NOTES FOR AI ASSISTANT

- `lib/proposalTruthEngine.ts` is **64,007 lines**. **Never try to read the whole file.** Use `grep -n` to find specific sections, then `sed -n 'X,Yp'` to read only what you need.
- `app/engineering/page.tsx` is **14,109 lines**. Same — grep first, read surgically.
- `lib/utilityPrograms.ts` is now **3,411 lines**. The injection points (closing `];`) are now at lines **1596, 2077, 2386, 3235**. If you need to add more entries, insert before those lines.
- When editing any of these large files, **use `str_replace` with unique surrounding context** rather than rewriting the whole file. Rewriting a 64K-line file is token-expensive and error-prone.
- TypeScript compilation (`npx tsc --noEmit`) takes ~30–60 seconds. Always run it. Zero errors = safe to commit.
- The two scripts `gen_programs_expansion.py` and `gen_battery_nem.py` in `/workspace/` (not `/workspace/solarpro-git/`) are the original generators. The actual generated output is in `scripts/*.ts`.

---

*Document generated by SuperNinja AI — session ending on v48.28 completion.*
