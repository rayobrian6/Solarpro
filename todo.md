# v58.20 — Survey Ownership Fix + SLD BUI Wiring

## Status
- [x] fix(perf): revert force-dynamic+revalidate conflict (095601d)
- [x] fix(sld): BUI wiring for all brands — hasBattery, batteryBrand, EcoFlow BACKUP_INTERFACES (ade32a3)
- [x] fix(survey): submit/route.ts forwards JWT claims + correct snake_case envelope fields
- [x] fix(survey): created app/api/admin/survey-reassign/route.ts (fix-one + fix-all-defaults)
- [x] fix(survey): "Fix Owner" button on individual survey cards in topography page

## Remaining Tasks
- [ ] Add "Fix All Defaults" bulk button to survey summary bar in topography page
- [ ] Commit and push all v58.20 changes to dev
- [ ] Verify misowned project 2a099fad can be fixed (check if solarpro_user_id 3460875a exists in users table)