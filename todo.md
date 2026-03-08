# SolarPro v29.0 — National Platform Upgrade

## Phase 1-9: Core Libraries (COMPLETE)
- [x] lib/locationEngine.ts — geocoding, state/county/city/zip/lat/lng resolution
- [x] app/api/geocode/route.ts — geocode endpoint
- [x] lib/utilityDetector.ts — URDB lookup by lat/lng, state fallback rates
- [x] app/api/utility-detect/route.ts — detect utility from address
- [x] lib/jurisdictions/necVersions.ts — NEC version by state/county (all 50 states)
- [x] lib/jurisdictions/ahj.ts — AHJ lookup by address
- [x] app/api/bill-upload/route.ts — PDF/JPG/PNG upload + OCR extraction
- [x] lib/billOcr.ts — OCR parser for utility bills
- [x] lib/autoSizing.ts — consumption → system size calculator using PVWatts
- [x] app/api/auto-size/route.ts — sizing endpoint
- [x] lib/autoDesign.ts — roof plane detection + panel placement algorithm
- [x] app/api/auto-design/route.ts — generate initial layout from system size
- [x] lib/incentives/stateIncentives.ts — all 50 states tax credits, rebates, SRECs
- [x] lib/incentives/incentiveEngine.ts — apply incentives to financial model
- [x] app/api/incentives/route.ts — incentives by state/utility

## Phase 10: UI — National Workflow
- [x] components/onboarding/BillUploadFlow.tsx — full upload → proposal workflow
- [x] Update project creation form with location auto-detect (patch_projects_new.py)
- [ ] Update engineering page with auto-populated jurisdiction data (AHJ banner)
- [ ] Update proposals page with state incentives section (dynamic by state)

## Phase 11: Version + Build + Push
- [ ] Update lib/version.ts to v29.0
- [ ] npm run build — zero errors
- [ ] git commit + push