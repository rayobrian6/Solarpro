# Engineering Intelligence Project Picker v1 Report

## Scope
This report documents the deterministic real-project picker added to the Engineering Intelligence Workspace.

## Picker Location
The project picker is rendered on `/admin/engineering-intelligence` by `ProjectIntelligencePicker`. The root workspace now acts as the safe selection surface for project-scoped Engineering Intelligence instead of defaulting to a demo project route.

## Data Source
The picker uses the authenticated admin session and calls `getProjectsByUser(userId)` from the database layer. Only persisted project records returned for the current user are displayed. Each selectable project links to `/admin/engineering-intelligence/project/${project.id}`.

## Empty States
The picker renders deterministic empty states when it cannot emit real project links:
- `not_authenticated` when no valid admin session user is available.
- `project_list_load_error` when the project list cannot be loaded.
- `no_projects` when the authenticated user has no projects.

These states intentionally do not render placeholder UUIDs, demo IDs, fabricated counts, or fake engineering state.

## Navigation Additions
The admin sidebar now routes `Project Intelligence Picker` to `/admin/engineering-intelligence`. The Engineering Monitor launcher card also routes to `/admin/engineering-intelligence`. The admin projects list now includes a direct `Open Engineering Intelligence` action for each real project row using that row's persisted project id. Existing real project links remain in project detail, survey detail, permit viewer, and engineering output surfaces.

## Regression Coverage
`tests/engineering-intelligence-navigation.test.ts` now asserts that application routing files do not contain `/admin/engineering-intelligence/project/demo`, `project/demo`, or the old `no_project_data demo route` label. The test also asserts that the picker uses `getProjectsByUser`, that it renders no-project/select-real-project states, that invalid project route parameters are guarded by `isValidUUID(params.id)`, and that real project-bound links remain present.

## Deterministic Boundaries
The picker is navigation-only. It does not perform evidence extraction, CAD generation, OCR, CV, semantic inference, autonomous regeneration, or AI decisioning. It simply selects a persisted project id and lets the existing deterministic hydration stack load whatever real evidence and metadata are available.
