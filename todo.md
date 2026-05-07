# DECOUPLE PRODUCTION CALCULATION FROM PROJECT DEPENDENCY

## Completed
- [x] Add `SystemDefinition` and `LocationInput` types to `types/index.ts`
- [x] Add `calculateProductionFromDefinition()` to `lib/pvwatts.ts`
- [x] Rewrite `app/api/production/route.ts` with two-shape API (ephemeral + project-backed)

## In Progress
- [ ] Modify `components/design/DesignStudio.tsx`
  - [ ] Update `calculateProduction()` to send ephemeral shape when no project
  - [ ] Add "Unsaved Design" badge when `!project?.id`
  - [ ] Make Calculate button always enabled (remove project dependency)
- [ ] Modify `components/design/DesignSidebar.tsx`
  - [ ] Make project prop optional
  - [ ] Always enable Calculate button
  - [ ] Show "Unsaved Design" badge

## Final
- [ ] TypeScript check
- [ ] Commit + push