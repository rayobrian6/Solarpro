# Engineering Intelligence Route Integration Report

## Scope

This report documents the Engineering Intelligence Workspace route integration pass on the `dev` branch. The prior Engineering Intelligence Workspace UI routes already existed under `app/admin/engineering-intelligence/*`; this pass made those routes discoverable and reachable from the live admin and project engineering experience without changing deterministic backend behavior.

## Route registration audit

The following route files are present and remain the canonical Engineering Intelligence admin surfaces:

- `app/admin/engineering-intelligence/page.tsx` — system-level Engineering Intelligence workspace.
- `app/admin/engineering-intelligence/project/[id]/page.tsx` — project-scoped Engineering Intelligence workspace.
- `app/admin/engineering-intelligence/snapshots/page.tsx` — snapshot timeline workspace.
- `app/admin/engineering-intelligence/graph/page.tsx` — dependency graph workspace.

The routes remain under `app/admin`, so they inherit the existing admin layout and `AdminShell`. The existing `middleware.ts` does not shadow or special-case these routes; authenticated page access continues through middleware, and admin/super_admin role enforcement remains in `app/admin/layout.tsx` through the existing database-backed admin role check.

## Admin navigation integration

`app/admin/AdminShell.tsx` now exposes the Engineering area as discoverable entries while preserving the legacy monitor route:

- `/admin/engineering` — Engineering Monitor.
- `/admin/engineering-intelligence` — Engineering Intelligence.
- `/admin/engineering-intelligence/project/demo` — Project Intelligence demo/empty-state route.
- `/admin/engineering-intelligence/snapshots` — Snapshot Timeline.
- `/admin/engineering-intelligence/graph` — Dependency Graph.

The active-route logic was changed from a raw prefix check to path-safe matching: a route is active only when the current path exactly equals the href or starts with `href + '/'`. This prevents `/admin/engineering` from appearing active when a user is on `/admin/engineering-intelligence`. Breadcrumb lookup now sorts by longest href first so the most specific matching route label wins.

## Legacy Engineering Monitor upgrade

`app/admin/engineering/page.tsx` remains the legacy monitor route and still fetches `/api/admin/stats` for the existing generation metrics, file breakdown, project trend, and engineering log access note. It now also includes an Engineering Intelligence launcher with deterministic workspace route cards and registry/empty-state summary metrics for stale outputs, invalidation events, snapshots, regeneration candidates, audit guard warnings, requirement health, evidence completeness, and graph health. These values are read from the existing deterministic `buildEngineeringIntelligenceWorkspace()` view-model and do not trigger generation or infer missing project state.

## Project-level entry points

Project-bound links were added in existing UI surfaces where a project id is already present:

- `app/admin/projects/[id]/page.tsx` adds an admin project detail button to `/admin/engineering-intelligence/project/${project.id}`.
- `components/engineering/EngineeringTab.tsx` adds a persistent project Engineering Intelligence link above loading, error, and report states.
- `app/projects/[id]/page.tsx` adds a project header shortcut to `/admin/engineering-intelligence/project/${id}`.
- `app/projects/[id]/survey/[surveyId]/page.tsx` adds a survey detail shortcut to `/admin/engineering-intelligence/project/${projectId}`.
- `app/engineering/permit/page.tsx` adds a permit viewer topbar button to `/admin/engineering-intelligence/project/${projectId}`.

All links point to the existing admin route. They do not expose autonomous engineering behavior or alter backend data flow.

## Empty-state and workspace polish

`app/admin/engineering-intelligence/components.tsx` now makes empty states more explicit by labeling key states such as `registry_visible_only`, `not_loaded`, `no_snapshot`, and `no_graph`. The route nav marks the dynamic project card as a `no_project_data demo route` when using the demo placeholder. The dependency graph viewer now surfaces an explicit no-graph empty-state note when no persistent graph is loaded and displays node status in the deterministic SVG preview, improving stale-state visibility and graph readability.

## Guard coverage

A lightweight route/navigation guard was added at `tests/engineering-intelligence-navigation.test.ts`. It verifies that major Engineering Intelligence route files exist, the admin sidebar links the required route targets, active matching remains path-safe, and project-bound entry points remain present.

## Deterministic behavior guardrails

This integration pass is UI/navigation only. It does not introduce OCR, computer vision, YOLO, OpenCV, image-byte inspection, perceptual hashing, semantic inference, autonomous regeneration, autonomous CAD generation, or AI-generated engineering decisions. The Engineering Intelligence workspace continues to visualize deterministic registry, snapshot, provenance, stale-state, graph, regeneration-planning, and audit metadata only.
