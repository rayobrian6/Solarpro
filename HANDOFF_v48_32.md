# SolarPro — Session Handoff Document
## For Thread Continuity: v48.32 → Next Tasks

**Last updated:** 2025-06 | **Repo branch:** `dev` | **Last commit:** `afdd6b1`

---

## 🗺️ BIG PICTURE — What This App Is

**SolarPro** is a Next.js 14 App Router + TypeScript application for solar sales professionals. It generates PDF proposals, does engineering design, and calculates savings/ROI for solar+battery systems. Key user-facing flows:

1. **Engineering Page** (`app/engineering/page.tsx`) — Sales rep configures a system: picks state, utility, ZIP, system size, equipment.
2. **Proposal Engine** — `lib/proposalTruthEngine.ts` (64K lines) builds the full financial/technical profile. Output → `buildCanonicalProposal.ts` → `renderProposalHTML.ts` → PDF.
3. **Utility Programs Panel** — Shows TOU rate plans, battery incentives, solar rebates, and NEM policy for selected utility. Rep can tap 💡 on any program for sales guidance.

---

## ✅ WHAT WAS COMPLETED (This Session)

### v48.29 — Engineering Programs Panel: Full Rebuild with Pro Tips
**What changed:** Replaced the simple single-item IIFE panel with a full React component system:

**New components (inserted before `EngineeringPageInner` at ~line 570):**
- `ProgramStatusBadge` — color-coded Active/Pilot/Limited/Waitlist/Expired badges
- `ProgramRow` — individual program row with collapsible 💡 Pro Tip (shows `solar_pro_note` + `last_verified`)
- `ProgramSection` — collapsible section wrapper for TOU / Battery / Solar / NEM
- `UtilityProgramsPanel` — top-level panel showing ALL programs for selected utility

**Key UX changes:**
- Shows ALL TOU plans (not just first one), ALL battery programs, ALL rebates, ALL NEM entries
- Each program has a "💡 Pro Tip" button that expands to show the full `solar_pro_note` rep guidance
- Sections are individually collapsible with item count badges
- Color-coded by type: amber=hourly pricing, emerald=solar TOU, blue=battery TOU, green=battery incentive, yellow=solar rebate, cyan=NEM
- Enrollment links preserved on every program
- Total program count shown in panel header

**Commit:** `1b24941`

---

### v48.30 — CA Muni NEM Coverage: All 17 Previously-Uncovered Utilities
**What changed:** Added 6 new `NEM_SPECIAL_PROGRAMS` entries covering all 17 previously-uncovered utility IDs:

| Entry ID | Utility IDs Covered | Key Note |
|---|---|---|
| `ladwp_smud_nbt` | `ladwp_ca`, `smud_ca` | NBT-style, ~10¢/kWh export, favorable vs CPUC |
| `ca_independent_nem` | `imperial_irrigation_district_ca`, `modesto_irrigation_district_ca`, `turlock_irrigation_district_ca` | **NOT CPUC-regulated** — own tariffs, near-retail |
| `ca_socal_muni_nem` | `burbank_wp_ca`, `glendale_water_power_ca`, `pasadena_wp_ca`, `anaheim_public_utilities_ca` | Annual NEM ~12¢/kWh, NOT NEM 3.0 |
| `ca_norcal_muni_nem` | `roseville_electric_ca`, `redding_electric_utility_ca`, `silicon_valley_power_ca`, `lodi_electric_utility_ca`, `riverside_public_utilities_ca` | Independent munis, ~11¢ |
| `ca_rural_muni_nem` | `plumas_sierra_rec_ca`, `trinity_pud_ca`, `valley_electric_association_ca` | Rural CA, legacy NEM |
| `pepco_dc_nem` | `pepco_dc` | DC: full retail NEM + DC SREC ($350–450/SREC!) |

**⚠️ CRITICAL:** IID, Modesto ID, and Turlock ID are NOT subject to CPUC NEM 3.0. They have independent tariffs. Do NOT apply CA NEM 3.0 rules to them.

**Commit:** `9d09a42`

---

### v48.31 — Proposal PDF: Structured Programs Table
**What changed:** `lib/proposal/renderProposalHTML.ts` ~line 660.

**Before:** Plain text paragraph from `utilityProgramsNote` string.

**After:** Full structured HTML table with:
- Color-coded rows by type (TOU=purple, Battery=green, Solar=yellow, NEM=cyan)
- Columns: Program/Plan | Type | Value/Detail | Cap/Notes | Status | Link
- Sub-row under each program showing full `solar_pro_note` rep guidance + `last_verified` date
- Status badges (Active/Pilot/Limited/Waitlist/Expired) color-coded
- Falls back to text-only note if `utilityPrograms` bundle is null

**Commit:** `6f7331a`

---

### v48.32 — Nationwide Database Expansion (20+ States)
**What changed:** Major expansion of `lib/utilityPrograms.ts`:

**Before → After:**
| Array | Before | After | New Utility IDs |
|---|---|---|---|
| `TOU_RATE_PLANS` | 53 entries | 78 entries | 190 → 308 |
| `BATTERY_INCENTIVE_PROGRAMS` | 26 entries | 35 entries | 75 → 89 |
| `SOLAR_REBATE_PROGRAMS` | 18 entries | 25 entries | 136 → 154 |
| `NEM_SPECIAL_PROGRAMS` | 55 entries | 61 entries | 1020 stable |
| **Total utility IDs** | **997** | **1,129** | |
| **File size** | 3,520 lines | 4,324 lines | |

**New TOU plans added for:** Alabama Power, TVA territory (Nashville ES, Memphis LGW, Knoxville UB, Bristol TN), Duke/AEP Indiana, Hawaiian Electric, Eversource CT, PECO/FirstEnergy PA, CMP Maine, Eversource/National Grid MA, NV Energy, Idaho Power, DTE Michigan, Consumers Energy MI, Minnesota Power/Otter Tail, Delmarva DE, Atlantic City Electric/JCP&L NJ, Georgia EMCs, Rocky Mountain Power UT/WY, Empire District/Evergy MO/KS, Duke NC full TOU-H, Oregon PUDs, WA small IOUs, Vermont GMP, Mon Power WV, Duke Kentucky, NPPD/LES/OPPD Nebraska.

**New battery programs:** Rocky Mountain Power Wattsmart UT ($1,500), Hawaiian Electric Battery Bonus ($850–1,950/yr), GMP BYOD VT enhanced, Eversource ConnectedSolutions CT ($275/kW-yr), MN pilot, TVA EnergyRight expanded, Alabama Power Rate Saver, DTE Michigan Connected Home, Duke Kentucky.

**New solar rebates:** Hawaii 35% state credit (65% total with ITC!), Kentucky, Michigan, Vermont CEDF, Delaware Green Energy, Idaho Power, Alabama Power.

**Commit:** `afdd6b1`

---

## 🔑 CRITICAL CONCEPTS — Read Before Touching Anything

### The ID Format Problem (VERY IMPORTANT)
| Source | Format | Example |
|---|---|---|
| `lib/utilityDetector.ts` → `UtilityOption.id` | Slug: `{state}-{name}` | `"il-ameren-illinois"` |
| `lib/proposalTruthEngine.ts` → `PROPOSAL_UTILITY_PROFILES[n].utility_id` | Underscore | `"ameren_il"` |
| `lib/utilityPrograms.ts` → all `utility_ids[]` arrays | Underscore | `"ameren_il"` |

**The bridge (from v48.27 — ALWAYS USE THIS):**
```ts
const stateProfiles = PROPOSAL_UTILITY_PROFILES.filter(p => p.state === stateCode);
const matchedProfile = stateProfiles.find(p => {
  try { return new RegExp(p.utility_name_pattern, 'i').test(nameLower); } catch { return false; }
});
const programs = matchedProfile ? getUtilityPrograms(matchedProfile.utility_id) : null;
```

### Standing Rules
- **NEVER push `master` without explicit user permission**
- `dev` branch → `solarpro-dev.vercel.app`
- `master` branch → `solarpro.solutions` (production)
- Three-check suite before committing: `npx tsc --noEmit` + `npx eslint` + `npx vitest run`

### Large File Warnings
- `lib/proposalTruthEngine.ts` — **64,007 lines** — NEVER read whole file. Use `grep -n` then `sed -n 'X,Yp'`
- `app/engineering/page.tsx` — **~14,300 lines** after v48.29 additions — same approach
- `lib/utilityPrograms.ts` — **4,324 lines** — closing `];` lines now at **~2099, 2759, 3068, 4027** (TOU/Battery/Solar/NEM)
- **DO NOT re-run any `inject_programs.py` on current `lib/utilityPrograms.ts`** — already injected

---

## 📁 KEY FILES & THEIR ROLES

```
lib/utilityPrograms.ts          4,324 lines — Utility programs knowledge base
                                 TOU_RATE_PLANS: 78 entries
                                 BATTERY_INCENTIVE_PROGRAMS: 35 entries
                                 SOLAR_REBATE_PROGRAMS: 25 entries
                                 NEM_SPECIAL_PROGRAMS: 61 entries
                                 Closing ]; at ~lines 2099, 2759, 3068, 4027
                                 API: getUtilityPrograms(utility_id) → UtilityProgramBundle | null

app/engineering/page.tsx        ~14,300 lines — Engineering config page
                                 New components at ~lines 568–784:
                                   ProgramStatusBadge (~568)
                                   ProgramRow (~583)
                                   ProgramSection (~641)
                                   UtilityProgramsPanel (~660)
                                 Programs panel call at ~line 7730 (IIFE → UtilityProgramsPanel)

lib/proposal/renderProposalHTML.ts — PDF rendering
                                 Programs table at ~line 660 (replaces old text note)
                                 Full HTML table: TOU/Battery/Solar/NEM rows
                                 Each row has sub-row with solar_pro_note rep guidance

lib/proposalTruthEngine.ts      64,007 lines — THE ENGINE
                                 PROPOSAL_UTILITY_PROFILES[] — 996 entries
                                 utility_programs: UtilityProgramBundle | null (line ~63109)

scripts/panel_component.tsx     Source for v48.29 panel component (reference)
scripts/tou_v48_32.ts           Source for v48.32 TOU additions (reference)
scripts/battery_v48_32.ts       Source for v48.32 battery additions (reference)
scripts/solar_rebates_v48_32.ts Source for v48.32 solar rebate additions (reference)
```

---

## 🗺️ NEXT LOGICAL TASKS (v48.33+)

### Priority 1 — Client/Homeowner Auto-Complete UX on Proposal Form
The data layer is complete (1,129 utility IDs with TOU/battery/solar/NEM data). The UX layer still needs:
- When a homeowner's ZIP/utility is detected on the **proposal form**, show relevant programs
- Pre-populate "available incentives" section with the actual programs from the database
- Allow sales rep to check/uncheck which programs to include in PDF proposal
- Link battery incentive values to savings calculator (reduce displayed battery cost by incentive amount)

### Priority 2 — Co-op / Rural Utility TOU Coverage (Remaining Gap)
There are ~600 rural electric cooperatives and small munis with no TOU plan entries yet. Most follow state-level NEM rules (already covered) but lack specific TOU data. Consider adding generic state-level TOU entries for:
- **TX:** ONCOR / AEP Texas / Entergy TX TDSP territories (deregulated — provider sets TOU)
- **MS:** Mississippi Power + co-ops (Southern Company territory)
- **SC:** South Carolina Electric & Gas / Dominion SC + co-ops
- **WY:** Black Hills Energy WY + co-ops
- **SD:** Black Hills Energy SD + co-ops
- **ND:** Montana Dakota Utilities + Basin Electric co-ops

### Priority 3 — Real-Time Rate Data Integration
Currently all rates are hardcoded with `last_verified` dates. Consider:
- Adding a rate-verification script that checks known utility API endpoints
- Flagging stale entries (>12 months since last_verified)
- Building a rate update workflow so entries can be refreshed without full rewrite

### Priority 4 — Proposal Form "Programs" Checkbox Panel
User's original ask: *"How do we auto-complete these programs for clients and homeowners?"*
- Build a `UtilityProgramsSelector` component for the proposal creation flow
- Uses same bridge pattern as Engineering page to look up programs by utility
- Shows each relevant program with checkbox
- Selected programs flow into `cp.policy.utilityPrograms` for PDF inclusion
- Battery incentive values auto-reduce displayed battery cost in savings calculator

### Priority 5 — Audit: Programs Panel Accuracy Across Random Utilities
Pick 20 random utilities from different states and verify:
1. Programs panel renders correctly (not null)
2. Program data is accurate (check 3–5 enrollurl links)
3. `solar_pro_note` displays and is relevant to the utility
4. Status badges are correct (no expired programs showing as Active)

---

## 📊 KEY NUMBERS

| Metric | Value |
|---|---|
| `lib/proposalTruthEngine.ts` size | 64,007 lines |
| `app/engineering/page.tsx` size | ~14,300 lines |
| `lib/utilityPrograms.ts` size | 4,324 lines |
| PROPOSAL_UTILITY_PROFILES count | 996 profiles |
| Utility IDs covered by programs | **1,129** |
| TOU_RATE_PLANS entries | **78** |
| BATTERY_INCENTIVE_PROGRAMS entries | **35** |
| SOLAR_REBATE_PROGRAMS entries | **25** |
| NEM_SPECIAL_PROGRAMS entries | **61** |
| Total program entries | **199** |
| States with NEM coverage | 50 |
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

- `lib/proposalTruthEngine.ts` is **64,007 lines**. **Never try to read the whole file.** Use `grep -n` to find sections, then `sed -n 'X,Yp'` to read only what you need.
- `app/engineering/page.tsx` is **~14,300 lines**. Same — grep first, read surgically.
- `lib/utilityPrograms.ts` is **4,324 lines**. Injection points (closing `];`) now at lines **~2099, 2759, 3068, 4027**.
- When editing large files, **use `str_replace` with unique surrounding context** rather than rewriting. Rewriting a 64K-line file is token-expensive and error-prone.
- TypeScript compilation (`npx tsc --noEmit`) takes ~30–60 seconds. Always run it.
- **The Python injection pattern** (read file, find marker, insert content, write back) is the safest way to add entries to `lib/utilityPrograms.ts`. Use it consistently.

---

*Document generated by SuperNinja AI — session ending on v48.32 completion.*
