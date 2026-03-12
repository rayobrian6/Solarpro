# v47.12 — Proposal Pipeline Fixes

## Issues to Fix

- [ ] Issue 1: Client name — bill OCR customerName must update clients.name; proposal reads client?.name
- [ ] Issue 2: System type — proposal must read systemType from layout.systemType > project.systemType (never hardcode 'roof')
- [ ] Issue 3: Fence BOM — systemEquipmentResolver already has SOL_FENCE; remove hardcoded "Roof Attachment Hardware" section that always shows
- [ ] Issue 4: Utility rate — proposals/page.tsx uses client.utilityRate; fix to use project.utilityRatePerKwh as higher priority
- [ ] Issue 5: Production model — fix CLIMATE_MULTIPLIERS continental zone to peak in June (Maine ~lat 44); add latitude-based curve selection
- [ ] Issue 6: SREC gate — add SREC_STATES whitelist; hide SREC section if state not in list
- [ ] Issue 7: Incentive filter — confirm stateIncentives ME has no SREC (already correct); ensure calculateIncentives respects system type
- [ ] handleBillComplete: update clients.name when customerName extracted from bill
- [ ] Update version to v47.12
- [ ] TypeScript build check
- [ ] Commit and push