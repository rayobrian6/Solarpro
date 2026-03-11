# SolarPro v43.0 — Permit-Grade Plan Set Architecture

## Phase 1: Plan Set PDF Engine
- [ ] Install html-pdf or puppeteer for PDF generation
- [ ] Create /api/engineering/plan-set/route.ts — unified plan set PDF assembler
- [ ] Create lib/plan-set/cover-sheet.ts — project cover sheet HTML
- [ ] Create lib/plan-set/electrical-sheet.ts — SLD + wire schedule sheet
- [ ] Create lib/plan-set/structural-sheet.ts — structural calcs sheet
- [ ] Create lib/plan-set/equipment-schedule.ts — equipment schedule sheet
- [ ] Create lib/plan-set/compliance-sheet.ts — NEC/code compliance checklist
- [ ] Create lib/plan-set/title-block.ts — reusable title block component

## Phase 2: National AHJ Database
- [ ] Create lib/jurisdictions/ahj-national.ts — comprehensive national AHJ database
- [ ] Cover all 50 states with major jurisdictions (counties + cities)
- [ ] Include: AHJ name, address, phone, email, plan check turnaround, fees, NEC version, special requirements
- [ ] Create /api/engineering/ahj-lookup/route.ts — search by address/zip/city/state

## Phase 3: Fire Setback Calculator
- [ ] Create lib/engineering/fire-setbacks.ts — IRC R324.4 + IFC calculations
- [ ] Ridge setback (18" or 36" depending on hip/gable)
- [ ] Valley setback (18")
- [ ] Eave setback (varies by AHJ)
- [ ] Pathway requirements (36" min)
- [ ] Integrate into engineering page

## Phase 4: Enhanced SLD with Title Block
- [ ] Update SLD generator to include proper title block
- [ ] Add NEC reference callouts
- [ ] Add conductor sizing labels
- [ ] Add rapid shutdown zone diagram

## Phase 5: Plan Set UI in Engineering Page
- [ ] Add "Generate Plan Set" button to engineering page
- [ ] Plan Set preview modal
- [ ] Download as PDF
- [ ] Save to project files

## Phase 6: TypeScript + Deploy
- [ ] TypeScript check (0 errors)
- [ ] Commit + push v43.0