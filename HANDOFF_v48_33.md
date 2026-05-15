# HANDOFF_v48_33.md
## SolarPro — Session v48.33 Context

**Branch:** `dev`  
**Last Commit:** `56c2817` — v48.33: utility interconnection + PTO guidance + expanded sales categories  
**Rule:** NEVER push to master without explicit user permission.

---

## What Was Completed This Session

### User Requests
1. **Audit** — "Are we missing any categories that could help impact a sale for the positive?"
2. **Interconnection & PTO** — "Why have we not sought out automatic utility interconnection agreements and PTO guidance. Or like getting PTO for a homeowner"

---

## v48.33 Deliverables

### 1. `lib/utilityInterconnection.ts` (NEW — 1,604 lines)
The flagship new file. A nationwide utility interconnection & PTO knowledge base.

**22 utilities covered:**
| Utility | State | ICA Timeline | PTO Timeline |
|---------|-------|-------------|-------------|
| PG&E | CA | 10–30 days | 3–15 days |
| SCE | CA | 10–30 days | 5–20 days |
| SDG&E | CA | 10–25 days | 5–15 days |
| ComEd | IL | 15–30 days | 5–15 days |
| Ameren IL | IL | 15–30 days | 5–15 days |
| FPL | FL | 10–20 days | 3–10 days |
| Duke Energy FL | FL | 15–30 days | 5–15 days |
| BGE | MD | 10–25 days | 5–15 days |
| Pepco MD | MD | 15–30 days | 5–20 days |
| PSE&G | NJ | 10–20 days | 5–15 days |
| PECO | PA | 15–30 days | 5–15 days |
| Eversource MA | MA | 15–45 days | 5–20 days |
| Xcel Energy CO | CO | 10–20 days | 5–15 days |
| DTE Energy | MI | 15–30 days | 5–20 days |
| APS | AZ | 5–20 days | 3–10 days |
| SRP | AZ | 10–20 days | 3–10 days |
| Duke Energy NC | NC | 15–30 days | 5–20 days |
| Georgia Power | GA | 10–25 days | 5–15 days |
| Dominion Energy VA | VA | 15–30 days | 5–20 days |
| Entergy Louisiana | LA | 20–45 days | 10–30 days |
| CenterPoint Energy TX | TX | 10–20 days | 5–15 days |
| Oncor Electric TX | TX | 10–20 days | 5–15 days |
| NV Energy | NV | 10–25 days | 5–15 days |

**Per-utility data points:**
- Application form name + portal URL
- Portal type (online portal / email / mail / hybrid / third-party)
- Requirements array with: label, description, required_small_system, required_large_system, prepared_by
- ICA approval timeline (min/max business days)
- Timeline note explaining variability
- PTO trigger type (final_inspection / utility_witness / self_certification)
- PTO wait time (min/max business days)
- PTO process steps (numbered, utility-specific)
- Homeowner PTO checklist (checkbox items)
- PTO request URL
- Common rejections with how-to-avoid
- Solar Pro coaching note
- Last verified date

**Exported Functions:**
```typescript
getInterconnectionProfile(utilityId: string): InterconnectionProfile | null
getTypicalTotalTimeline(utilityId: string): string | null
getPtoRoadmap(utilityId: string): string | null
getInterconnectionNote(utilityId: string): string | null
getUtilitiesWithInterconnectionData(): string[]
```

---

### 2. `lib/permit/sections/interconnectionPage.ts` (NEW)
**APP-B: Utility Interconnection & PTO Roadmap** — now page 12 of 16 in every permit package.

**When utility IS in registry:**
- Blue section: ICA Application (form name, URL, requirements table, timeline)
- Green section: PTO Process Steps (numbered, color-coded)
- Orange section: Homeowner PTO Checklist (actual checkboxes)
- Red section: Common Rejection Reasons & How to Avoid
- Yellow box: Solar Pro Coaching Note (internal reference)

**When utility NOT in registry:**
- Generic 8-step universal roadmap showing the standard US residential solar ICA/PTO process

**Permit package page count:** 15 → **16 pages**

---

### 3. `lib/utilityPrograms.ts` — 3 New Program Types + 19 New Programs

#### New: `PaceFinancingProgram` interface + 4 programs
| Program | States | APR | Max |
|---------|--------|-----|-----|
| Ygrene Energy Fund | CA, FL, GA, MO | 5.49–8.99% | $200K |
| Mosaic PACE | CA, FL, NV, AZ, TX, CO | 5.99–9.49% | $150K |
| Benji Finance (FL) | FL | 5.25–8.75% | $125K |
| CalPACE / HERO | CA | 5.49–9.99% | $250K |

#### New: `EvChargerIncentive` interface + 7 programs
| Utility | Rebate | Delivery |
|---------|--------|---------|
| PG&E | Up to $500 | Check |
| SCE | Up to $500 | Check |
| DTE Energy | Up to $500 | Check |
| Xcel CO | Up to $500 | Check |
| FPL | Up to $200 | Bill credit |
| ComEd IL | Up to $500 | Check |
| Pepco/BGE | Up to $300 | Check |

#### New: `LowIncomeSolarProgram` interface + 8 programs
| Program | State | Value |
|---------|-------|-------|
| CA SASH (GRID Alternatives) | CA | $3.00/W (max $15K) |
| CA MASH | CA | $1–3/W |
| Illinois Solar for All | IL | Free system + 50% bill savings |
| NY Affordable Solar (NYSERDA) | NY | +$0.80/W enhanced rebate |
| MA SMART Low-Income Adder | MA | +$0.05–0.10/kWh |
| NJ Community Solar LMI | NJ | 10%+ bill discount |
| IRA Sec 48E Bonus Credit | ALL | +10–20% ITC |
| FL LIHEAP / Weatherization | FL | Up to $5K + subsidized solar |

#### Updated `UtilityProgramBundle`:
```typescript
interface UtilityProgramBundle {
  // ... existing fields ...
  pace_financing: PaceFinancingProgram[];          // NEW
  ev_charger_incentives: EvChargerIncentive[];     // NEW
  low_income_programs: LowIncomeSolarProgram[];    // NEW
}
```

#### New helper functions:
```typescript
getPacePrograms(stateCode: string): PaceFinancingProgram[]
getLowIncomeProgramsByState(stateCode: string): LowIncomeSolarProgram[]
```

---

### 4. `app/engineering/page.tsx` — Expanded UtilityProgramsPanel

**New sections in the panel (in order):**
1. 🕐 TOU Rate Plans (unchanged)
2. 🔋 Battery Incentives (unchanged)
3. 🌞 Solar Rebates & Incentives (unchanged)
4. 📋 Net Metering Policy (unchanged)
5. 🚗 **EV Charger Incentives** (NEW)
6. 🏠 **PACE Financing** (NEW — state-level)
7. 🤝 **Low-Income / DAC Programs** (NEW — utility + state level)
8. 🔌 **Interconnection & PTO Roadmap** (NEW — collapsible)
   - ICA application info (form name, URL, phone, timeline)
   - PTO process steps (numbered)
   - Homeowner checklist
   - Total timeline estimate
   - Solar Pro coaching note
   - Common rejection reasons

**Panel header** now shows:
- `ICA data ✓` badge when utility has interconnection profile

---

## Audit Findings Summary

The following sale-impacting categories were identified as **missing** and are now covered:

| Category | Sales Impact | Now Available |
|----------|-------------|---------------|
| PACE Financing | Removes $0-down objection; transfers at sale | ✅ 4 programs |
| EV Charger Incentives | Upsell: solar+EV bundle; "free driving" pitch | ✅ 7 programs |
| Low-Income/DAC Solar | Expands addressable market; referral engine | ✅ 8 programs |
| IRA Sec 48E Bonus Credit | +10–20% ITC for qualifying sites | ✅ |
| Utility Interconnection Data | Sets expectations; prevents PTO confusion | ✅ 22 utilities |
| PTO Homeowner Roadmap | Reduces post-install cancellations | ✅ In permit package |

---

## Remaining Opportunities (Next Sessions)

### High Priority
1. **Co-op/Rural Utility TOU Coverage** — ~600+ utilities still have no TOU data
2. **SREC Income Data Layer** — SRECs (IL, MD, NJ, PA, MA, NY, OH) are powerful ROI multipliers. Add a `SrecProgram` type with current SREC prices, market names, and registration portals.
3. **Green Tariff / Voluntary Green Pricing** — Many IOUs offer green energy subscriptions (Xcel Windsource, Duke Green Source Advantage, etc.) that affect solar economics.

### Medium Priority
4. **Client/Homeowner Auto-Complete UX** — from v48.32 next tasks (auto-fill from address, smart ZIP lookup)
5. **Interconnection Registry Expansion** — Add remaining major utilities: Puget Sound Energy, Pacific Power (PacifiCorp), Appalachian Power (AEP), Consumers Energy (MI), OG&E (OK), WPS/ATC (WI)
6. **State-Level Solar Incentive Layer** — Dedicated table for state income tax credits (NC 35%, MA 15%, NY 25%, etc.) separate from utility programs

### Low Priority
7. **Community Solar Enrollment Links** — For states with active community solar (MA, NY, IL, MN, CO, MD, NJ, WA)
8. **Green Tariff enrollment** — SCE Clean Energy Options, PG&E CleanChoice Energy, etc.

---

## File Sizes (v48.33)
| File | Lines |
|------|-------|
| lib/utilityInterconnection.ts | 1,604 |
| lib/utilityPrograms.ts | ~4,900 |
| lib/permit/sections/interconnectionPage.ts | ~300 |
| app/engineering/page.tsx | ~14,500 |

---

## TypeScript Check
`npx tsc --noEmit --skipLibCheck` → **0 errors** ✅

---

*Generated by SuperNinja — SolarPro session v48.33*
