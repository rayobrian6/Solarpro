# SolarPro v42.1 — Reverse State Loading ✅

## Completed ✅
- [x] Create /api/engineering/run-from-file/route.ts (GET ?fileId=)
- [x] Create /api/engineering/latest-run/route.ts (GET ?projectId=)
- [x] Update app/engineering/page.tsx — handle ?fileId= URL param + reverse hydration + banner
- [x] Update engineering files tab — add "Restore Config" button per file
- [x] TypeScript check (0 errors) + commit + push v42.1

## Pending — After Deployment
- [ ] Run migration 009_engineering_runs.sql via System Tools (Admin → System Tools → Run Migrations)