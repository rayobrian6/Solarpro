# v58.20 — Survey Ownership Fix + SLD BUI Wiring ✅

## All Tasks Complete
- [x] fix(perf): revert force-dynamic+revalidate conflict (095601d)
- [x] fix(sld): BUI wiring for all brands — hasBattery, batteryBrand, EcoFlow BACKUP_INTERFACES (ade32a3)
- [x] fix(survey): submit/route.ts forwards JWT claims + correct snake_case envelope fields (b99a356)
- [x] fix(survey): created app/api/admin/survey-reassign/route.ts (fix-one + fix-all-defaults) (b99a356)
- [x] fix(survey): "Fix Owner" button on individual survey cards in topography page (b99a356)
- [x] fix(survey): "Fix All Defaults" bulk button in summary bar in topography page (b99a356)
- [x] fix(survey): persist solarpro_user_id + owner_source into survey_meta on ingestPipeline.ts (ed6271d)
- [x] fix(survey): force-ingest UPDATE path now refreshes survey_meta ownership claims (ed6271d)

## Recovery Steps for Existing Misowned Project (2a099fad)
1. Go to admin topography page
2. Click "Force Ingest" — this will UPDATE the existing project's survey_meta
   to include solarpro_user_id and owner_source from the partner DB
3. Reload the page — the "Fix Owner" button should now appear on the survey card
4. Click "Fix Owner" to reassign the project to the correct user
   OR use "Fix All Defaults" button in the summary bar to fix all at once