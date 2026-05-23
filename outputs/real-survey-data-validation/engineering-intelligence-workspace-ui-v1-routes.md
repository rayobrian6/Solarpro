# Engineering Intelligence Workspace UI v1 Routes

## Added Admin Routes

### `/admin/engineering-intelligence`

Primary Engineering Intelligence Workspace route. It renders the full deterministic workspace with health, canonical evidence, requirements, decisions, stale-state/invalidation, snapshot timeline, dependency graph, regeneration planning, and audit guard panels.

### `/admin/engineering-intelligence/project/[id]`

Project-scoped Engineering Intelligence route. It accepts a project id and builds a project-aware workspace model. Until persisted project snapshots or graph data are supplied by backend state, it explicitly renders registry/empty-state data and does not fabricate project status.

### `/admin/engineering-intelligence/snapshots`

Snapshot-focused route. It renders the engineering health summary, persistent snapshot timeline panel, stale-state/invalidation panel, and audit guard panel.

### `/admin/engineering-intelligence/graph`

Dependency-graph-focused route. It renders the deterministic graph viewer plus supporting requirement, decision, and regeneration planning panels.

## Shared UI Module

All routes share modular panels from:

- `app/admin/engineering-intelligence/components.tsx`

The shared route model is built from:

- `lib/engineeringIntelligence/workspace.ts`

## Route Navigation

The workspace shell exposes route navigation cards for:

- Engineering Intelligence overview
- Project Intelligence
- Snapshot Timeline
- Dependency Graph

The project route navigation uses `/admin/engineering-intelligence/project/demo` as a deterministic placeholder link in the overview navigation because the actual project id is route-bound and must come from admin selection or a future backend project index.

## Runtime Behavior

The routes are server-rendered admin pages. They do not add OCR, CV, CAD generation, image-byte inspection, AI-generated decisions, or autonomous regeneration behavior. They visualize deterministic state surfaces only.
