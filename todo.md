# Phase B1 — Racking DB Consolidation

## Step 1: Create adapter
- [x] Read mounting-hardware-db.ts schema
- [x] Read structural-engine-v3.ts field access inventory
- [ ] Write lib/mounting/adapter.ts

## Step 2: Switch V3 engine
- [ ] Update structural-engine-v3.ts imports

## Step 3: Delete racking-database.ts
- [ ] Confirm zero remaining imports
- [ ] Delete lib/racking-database.ts

## Step 4: Verification
- [ ] npx tsc --noEmit (zero new errors)

## Step 5: Guard logs
- [x] console.warn('[HW MAP FALLBACK]') guards included in adapter