/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v39.9';
export const BUILD_DATE = '2025-03-10';
export const BUILD_DESCRIPTION = 'FIX: Normalize invalid role values before adding users_role_check constraint';
export const BUILD_FEATURES = [
  // Admin Portal v39.6
  'NEW: /admin route — Full SolarPro Admin Portal (role-gated: admin + super_admin only)',
  'NEW: lib/adminAuth.ts — requireAdmin() server-side JWT auth with role check + redirect',
  'NEW: app/admin/layout.tsx — Admin shell layout with requireAdmin() gate',
  'NEW: app/admin/AdminShell.tsx — Dark sidebar nav (10 sections), role badge, back-to-app link',
  'NEW: app/admin/page.tsx — Dashboard: stat cards, 30-day trends, plan breakdown, quick links',
  'NEW: app/admin/users/page.tsx — User management: search, pagination, grant free pass, suspend, reset trial, set role, edit, delete',
  'NEW: app/admin/companies/page.tsx — Company overview: grouped by company field, user count, plans, free pass status',
  'NEW: app/admin/projects/page.tsx — Project management: search, pagination, soft-delete/restore, open-in-engineering',
  'NEW: app/admin/engineering/page.tsx — Engineering monitor: file type breakdown, 30-day trend chart',
  'NEW: app/admin/incentives/page.tsx — Incentives CRUD: full add/edit/delete for incentive_overrides table, seed defaults',
  'NEW: app/admin/utilities/page.tsx — Utility policies CRUD: net metering, interconnection limits, buyback rates',
  'NEW: app/admin/database/page.tsx — DB maintenance: health stats, row counts, table sizes, run migration button',
  'NEW: app/admin/files/page.tsx — File storage manager: storage stats, file type filter, paginated table, delete files',
  'NEW: app/admin/health/page.tsx — System health monitor: service status grid, DB/API latency, row counts, table sizes',
  'NEW: app/api/admin/stats/route.ts — Aggregated stats: users, projects, proposals, layouts, files + 30-day trends',
  'NEW: app/api/admin/users/route.ts — User CRUD API with actions: grant_free_pass, suspend, unsuspend, reset_trial, set_role, set_plan, update, delete',
  'NEW: app/api/admin/projects/route.ts — Project management API with JOINs to users and clients',
  'NEW: app/api/admin/files/route.ts — File storage API: paginated list with fileType filter, storage stats, delete',
  'NEW: app/api/admin/health/route.ts — DB health: latency check, table sizes, DB size, row counts',
  'NEW: app/api/admin/incentives/route.ts — Full CRUD for incentive_overrides table',
  'NEW: app/api/admin/utilities/route.ts — Full CRUD for utility_policies table',
  'UPGRADE: app/api/migrate/route.ts — Add role column, incentive_overrides table, utility_policies table; set raymond=super_admin, james+cody=admin',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}