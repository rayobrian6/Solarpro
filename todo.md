# DECOUPLE PRODUCTION CALCULATION FROM PROJECT DEPENDENCY

## Completed
- [x] Add `SystemDefinition` and `LocationInput` types to `types/index.ts`
- [x] Add `calculateProductionFromDefinition()` to `lib/pvwatts.ts`
- [x] Rewrite `app/api/production/route.ts` with two-shape API (ephemeral + project-backed)
- [x] Modify `components/design/DesignStudio.tsx`
  - [x] Add `buildSystemDefinition()` — builds SystemDefinition from current UI state
  - [x] Add `buildLocationInput()` — builds LocationInput from mapCenter + project context
  - [x] Update `calculateProduction()` to send ephemeral shape (`systemDefinition + location`)
  - [x] Refactor `buildLayout()` to reuse `buildSystemDefinition()` (no duplication)
  - [x] Add "Unsaved Design" amber badge in toolbar
- [x] Modify `components/design/DesignSidebar.tsx`
  - [x] Make `project` prop optional
  - [x] Remove `panels.length === 0` from Calculate button disabled condition
  - [x] Conditionally render Generate Proposal link only when `project?.id` exists
- [x] TypeScript check — 0 errors
- [x] Commit + push to master