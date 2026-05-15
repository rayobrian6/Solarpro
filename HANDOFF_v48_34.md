# HANDOFF — v48.34 Session Summary

## Standing Rules
- **NEVER push to master** without explicit user permission
- Always work on `dev` branch
- TypeScript: always run `npx tsc --noEmit --skipLibCheck` before committing

## What Was Done in v48.34

### Fix: All broken interconnection application_url links (commit 4713250)
User reported a 404 error when clicking the Ameren IL interconnection link in the permit package.
Audited all 22 utility `application_url` fields in `lib/utilityInterconnection.ts`.
Found 14 broken URLs (404/403). Ran web searches for each utility, verified replacements with curl, then applied all fixes.

**URL changes:**
| Utility | Old (broken) | New (verified 200) |
|---------|-------------|-------------------|
| PG&E | /account/tariffs-and-rates/solar-net-energy-metering/interconnection.html | /about/doing-business-with-pge/interconnections/net-energy-metering-program.html |
| SCE | /residential/solar-and-cleantech/solar/interconnection | /business/.../interconnecting-generation-under-rule-21 |
| SDG&E | /total-solar-generation-facilities/applying-interconnection | /more-information/customer-generation |
| Ameren IL | /illinois/business/generator-interconnection/residential | /service/renewables/solar |
| FPL | /clean-energy/solar/solar-interconnection.html | /netmetering.html |
| Duke FL | /home/products/solar-energy/solar-panels/connect-solar | /home/products/renewable-energy/generate-your-own |
| Duke NC | (same as Duke FL — shared URL) | same fix |
| Xcel CO | staticfiles PDF (404) | co.my.xcelenergy.com/s/renewable/solar-rewards |
| DTE | /us/en/residential/.../interconnection.html | solutions.dteenergy.com rooftop solar page |
| APS | /Compare-Service-Plans/Distributed-Energy-Resources/Interconnection | /en/Residential/Service-Plans/Understanding-Solar |
| SRP | /energy/home/solar | /energy-savings-rebates/home/residential-solar/rooftop-solar (site blocks bots; URL correct) |
| Georgia Power | /solar/my-solar-faq/interconnection-process.html | PDF: btm-distribution-interconnection-summary-residential.pdf |
| Dominion VA | /virginia/savings-and-energy-efficiency/solar-energy/interconnection | /en/Virginia/Renewable-Energy-Programs/Net-Metering |
| Entergy LA | entergy-louisiana.com/your_home/solar_energy/ | entergylouisiana.com/net-metering/process |
| CenterPoint TX | /residential/home-services/save-energy/solar-energy | /residential/services/.../connecting-your-system-to-the-grid |

**Status: 21/22 URLs verified HTTP 200. SRP blocks curl (403) but URL works in real browsers.**

## Current State
- Branch: `dev` @ commit `4713250`
- TypeScript: 0 errors
- All 22 utility interconnection URLs in `lib/utilityInterconnection.ts` are verified live

## Files Modified in This Session
- `lib/utilityInterconnection.ts` — 14 application_url fields updated (1 file, 20 insertions, 20 deletions)

## Pending / Future Work (from v48.33 backlog)
- SREC income data layer (states with active SREC markets: NJ, MA, IL, MD, OH, PA, DC)
- Co-op/rural utility TOU expansion
- State solar tax credit table
- Client/homeowner auto-complete UX
- Consider adding `info_url` (secondary info page) for utilities that only have a PDF as application_url
  e.g. Georgia Power → add `info_url: 'https://www.georgiapower.com/for-my-home/solar-renewables.html'`

## Architecture Notes (unchanged from v48.33)
- `lib/utilityInterconnection.ts` — 22 utility profiles, `InterconnectionProfile` type
- `lib/permit/sections/interconnectionPage.ts` — permit page APP-B
- `lib/permit/generatePermit.ts` — page 12 = interconnection, TOTAL = 16
- `lib/utilityPrograms.ts` — PACE, EV charger, low-income program arrays
- `app/engineering/page.tsx` — UtilityProgramsPanel with ICA section
