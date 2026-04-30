# v58.20 — Survey Ownership Fix + SLD BUI Wiring ✅

## All Tasks Complete
- [x] fix(perf): revert force-dynamic+revalidate conflict (095601d)
- [x] fix(sld): BUI wiring for all brands — hasBattery, batteryBrand, EcoFlow BACKUP_INTERFACES (ade32a3)
- [x] fix(survey): submit/route.ts forwards JWT claims + correct snake_case envelope fields (b99a356)
- [x] fix(survey): created app/api/admin/survey-reassign/route.ts (fix-one + fix-all-defaults) (b99a356)
- [x] fix(survey): "Fix Owner" + "Fix All Defaults" buttons in topography page (b99a356)
- [x] fix(survey): persist solarpro_user_id + owner_source into survey_meta on every ingest path (ed6271d)
- [x] fix(survey): force-ingest UPDATE path now refreshes survey_meta ownership claims (ed6271d)
- [x] fix(survey): ECONNREFUSED guard for missing PARTNER_SURVEY_DB_URL (77f563d)
- [x] fix(survey): fix-from-webhook-log backfill action for pre-fix misowned surveys (77f563d)
- [x] fix(survey): "Fix from Webhook Log" button in topography summary bar (77f563d)

## How to Fix Existing Misowned Surveys (no partner DB needed)

1. Go to Admin → Topography → Live Survey Data
2. Click **"⟳ Fix from Webhook Log"** (violet button in summary bar)
   - Scans webhook_deliveries.raw_body for solarpro_user_id claims
   - Reassigns any projects where the claim maps to a valid SolarPro user
3. If that finds nothing (surveys were submitted pre-fix), click **"⟳ Fix All Defaults"**
   - Reassigns all fallback-owned surveys that have a valid solarpro_user_id in survey_meta
4. For individual surveys, use the **"→ Fix Owner"** button on the expanded card