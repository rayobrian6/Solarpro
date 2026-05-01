# Multi-User Smoke Test Battery — Receipt

**Run at:** 2026-04-29T19:39:39Z
**Target:** https://solarpro-dev.vercel.app
**Admin:** raymond.obrian@yahoo.com (011526da-28fc-4c01-85a0-d52c0f578fdf)
**Commit:** 966ca1d65af513d77115617282842c267dd591c9

## Goal

Prove that when ANY user completes a site survey, the resulting project
lands in THAT USER'S account — not the admin's, not a shared default.

## Results

| User | Scenario | Status | Project ID | Owner as seen by admin |
|------|----------|--------|------------|------------------------|
| testagent.solarpro.2025@gmail.com | CASE-2 CREATE | ✅ | b0638c9f-039f-4d07-a5bd-bd14137820de | testagent.solarpro.2025@gmail.com |
| austinhancock47@gmail.com | CASE-2 CREATE | ✅ | ad9874bc-50ec-4bea-af18-cf8568065757 | austinhancock47@gmail.com |
| jeff@solfence.solar | CASE-2 CREATE | ✅ | 768b5c7e-c1db-4821-adee-096291dfbb96 | jeff@solfence.solar |
| testagent.solarpro.2025@gmail.com | CASE-1 ATTACH | ✅ | b0638c9f-039f-4d07-a5bd-bd14137820de | attached (created=false) |

## Isolation Check

- Admin's project count BEFORE test: 12
- Admin's project count AFTER test:  12
- Delta: 0
- Expected delta: 0 (no survey should land in admin's account)

## Verdict

✅ **ALL CHECKS PASSED** — multi-tenant survey pipeline is working correctly.

Any user who completes a site survey will have it saved to their own
account, not yours. The critical routing bug is fixed.
