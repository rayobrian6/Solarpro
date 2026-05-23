# Engineering Intelligence Navigation Audit

## Initial finding

The Engineering Intelligence Workspace UI existed in the repository, but the live admin experience still surfaced only the legacy `Engineering Engine Monitor` page. The admin sidebar contained one Engineering link pointing to `/admin/engineering`, and there were no visible links into `/admin/engineering-intelligence`, `/admin/engineering-intelligence/project/[id]`, `/admin/engineering-intelligence/snapshots`, or `/admin/engineering-intelligence/graph`.

A second navigation issue was identified in `app/admin/AdminShell.tsx`: active-route detection used raw `path.startsWith(href)`. Because `/admin/engineering-intelligence` starts with `/admin/engineering`, adding the new route links without fixing this logic would cause the legacy Engineering Monitor item to shadow or appear active on Engineering Intelligence routes.

## Admin shell audit result

`app/admin/AdminShell.tsx` now exposes the Engineering navigation surfaces directly in the Configuration section:

```text
Engineering Monitor
Engineering Intelligence
Project Intelligence
Snapshot Timeline
Dependency Graph
```

The legacy monitor remains at `/admin/engineering`. Engineering Intelligence overview, snapshots, and graph use their concrete admin routes. Project Intelligence uses `/admin/engineering-intelligence/project/demo` as a discoverable demo/empty-state route because the real project route is dynamic and should use a project id when opened from project-specific surfaces.

The active-state logic now uses exact-or-nested matching instead of broad prefix matching:

```ts
href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`)
```

The breadcrumb/current-page lookup sorts navigation items by descending href length before matching, so more specific Engineering Intelligence routes are selected before broader routes.

## Admin landing audit result

`/admin/engineering` remains the legacy Engineering Monitor and still shows the existing layout/file/project/proposal statistics. The page now also functions as a launcher/summary dashboard for Engineering Intelligence, including route cards for the overview, project intelligence, snapshot timeline, and dependency graph. Summary cards expose deterministic empty-state metrics for stale outputs, invalidation events, snapshots, regeneration candidates, audit guard warnings, requirement health, evidence completeness, and graph health. No backend mutation or generation action was added.

## Project-level navigation audit result

Project-bound entry points now exist in the following surfaces:

- Admin project detail: prominent `Engineering Intelligence` button next to Portal Preview.
- Project page: header shortcut to the project Engineering Intelligence workspace.
- Survey detail page: survey header shortcut to project Engineering Intelligence.
- Permit viewer: topbar `Intelligence` button using the current `projectId` query parameter.
- EngineeringTab: persistent link above loading/error/report states, making Engineering Intelligence reachable from engineering outputs.

These links all resolve to `/admin/engineering-intelligence/project/<projectId>` when a real project id is known.

## Empty-state navigation audit result

The workspace continues to avoid fabricated state. The route nav marks the demo project route as a `no_project_data demo route`. Empty panels now explicitly label unloaded conditions:

- `registry_visible_only` for evidence groups where only registry context is present.
- `not_loaded` for transition history and audit guard result sets that have not been supplied.
- `no_snapshot` when no persistent snapshot set is loaded.
- `no_graph` when no persistent graph is loaded and only registry nodes are displayed.

These labels make it clear to admins whether they are viewing loaded project intelligence or deterministic registry/empty-state surfaces.

## Auth and route handling audit result

The Engineering Intelligence routes remain below `app/admin`, which means they are wrapped by the existing admin layout and role guard. Middleware only performs authenticated page gating and does not block or shadow `/admin/engineering-intelligence/*`. Admin/super_admin authorization remains database-backed in `app/admin/layout.tsx`.

## Guard test

`tests/engineering-intelligence-navigation.test.ts` was added to guard route discoverability. It checks route files, sidebar route targets, path-safe active matching, and project-bound entry point strings. This is intentionally lightweight and static so it does not require a running browser or database.

## Expected live behavior after this integration

Admins should now see Engineering Intelligence navigation in the admin sidebar, be able to open the new workspace directly from `/admin/engineering`, and be able to jump into project-scoped Engineering Intelligence from project detail, project page, survey detail, permit viewer, and engineering output views. The legacy Engineering Monitor remains available and unchanged in purpose, but now acts as the visible bridge into deterministic Engineering Intelligence.
