# Real Project Hydration Routing v1 Report

## Scope
This report documents the Engineering Intelligence routing update that removes the demo-only project entry path and routes project-scoped Engineering Intelligence through real project UUIDs only.

## Routes Reviewed
- `/admin/engineering`
- `/admin/engineering-intelligence`
- `/admin/engineering-intelligence/project/[id]`
- `/admin/engineering-intelligence/snapshots`
- `/admin/engineering-intelligence/graph`
- `/admin/projects`
- `/admin/projects/[id]`
- `/projects/[id]`
- `/projects/[id]/survey/[surveyId]`
- `/engineering/permit`
- `components/engineering/EngineeringTab.tsx`

## Demo Route Removal
The hardcoded `/admin/engineering-intelligence/project/demo` entry path was removed from application routing surfaces. The dynamic project route is no longer rewritten to a demo identifier by `RouteNav`. The admin shell and engineering monitor launcher now point project-scoped users to the real project selection surface instead of a placeholder route.

## Real Project UUID Routing
The root Engineering Intelligence page now loads authenticated project records via `getProjectsByUser(userId)` and renders `ProjectIntelligencePicker`. The picker emits project links only in the form `/admin/engineering-intelligence/project/${project.id}`, where `project.id` is returned by the database-backed project list. If no user session exists, the database load fails, or no projects exist, the picker renders deterministic empty states rather than placeholder links.

## Invalid Project ID Guard
The project-scoped route now checks `isValidUUID(params.id)` before invoking DB-backed hydration. Invalid route parameters such as `demo` are handled by `invalidProjectHydration`, which renders registry/empty-state content and deterministic notes without calling UUID-backed project survey queries. This prevents the visible `invalid input syntax for type uuid: "demo"` failure path while preserving honest non-fabricated state.

## Empty-State Contract
The routing update preserves explicit empty states for unavailable data. No fabricated survey count, graph relationship, snapshot, invalidation event, regeneration plan, CAD-ready flag, or canonical evidence item is introduced. Project list states include `not_authenticated`, `project_list_load_error`, and `no_projects`; project hydration states remain `not_loaded` when real evidence is unavailable.

## Files Updated
- `app/admin/engineering-intelligence/page.tsx`
- `app/admin/engineering-intelligence/components.tsx`
- `app/admin/engineering-intelligence/project/[id]/page.tsx`
- `app/admin/AdminShell.tsx`
- `app/admin/engineering/page.tsx`
- `app/admin/projects/page.tsx`
- `tests/engineering-intelligence-navigation.test.ts`

## Prohibited Behavior Confirmation
This routing update does not introduce AI copilot behavior, CV, OCR, YOLO, image-byte analysis, semantic inference, autonomous CAD generation, hallucinated geometry, autonomous regeneration, or fake engineering state. It only changes deterministic route selection and project-id validation.
