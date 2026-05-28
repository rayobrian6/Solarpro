# Migration Documentation Repair — Option C

## Phase 1: Create SQL Migration Files
- [x] Create 079_unified_geometry_foundation.sql (079a + 079b)
- [x] Create 080_backfill_unified_geometry_artifacts.sql
- [x] Create 081_obstruction_metadata_column.sql
- [x] Create 082_obstruction_metadata_backfill.sql

## Phase 2: Verify
- [x] Run `npx tsc --noEmit`
- [x] Grep/check that migration list no longer stops at 078
- [x] Run any migration-related tests
- [x] Verify SQL matches inline DDL (document any intentional differences)
- [x] Commit to dev branch (b4977a9, pushed to origin)
