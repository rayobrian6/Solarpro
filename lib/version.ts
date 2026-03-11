/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v40.7';
export const BUILD_DATE = '2025-03-10';
export const BUILD_DESCRIPTION = 'FIX: Global UserContext — single source of truth; refreshUser() after admin actions; role always shown first';
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
  // Admin Portal UI Audit v40.4
  'FIX: app/admin/page.tsx — Fix data mapping: d.stats, stats.files.total, stats.plans[].count, stats.projectTrend',
  'FIX: app/admin/users/page.tsx — Fix data mapping: d.users instead of d.data',
  'FIX: app/admin/projects/page.tsx — Fix data mapping: d.projects instead of d.data',
  'FIX: app/admin/companies/page.tsx — Fix data mapping: d.users instead of d.data',
  'FIX: app/admin/engineering/page.tsx — Fix data mapping: d.stats, f.total, f.totalBytes, d.count in charts',
  'FIX: app/admin/incentives/page.tsx — Fix data mapping: d.incentives instead of d.data',
  'FIX: app/admin/utilities/page.tsx — Fix data mapping: d.utilities instead of d.data',
  'FIX: app/admin/files/page.tsx — Fix data mapping: d.files, storage.totalFiles, storage.totalBytes',
  'FIX: app/admin/health/page.tsx — Full rewrite: match actual API shape (dbLatencyMs, rowCounts, tableSizes)',
  'NEW: app/dashboard/page.tsx — Admin Portal button (amber, Shield icon) visible only to admin/super_admin users',
  // v40.5 — DB as single source of truth for account state
  'FIX: components/ui/AppShell.tsx — isFreePass from DB boolean only (not subscriptionStatus string); admin/super_admin bypass trial redirect',
  'FIX: components/ui/AppShell.tsx — getAccountBadge(): Super Admin/Admin/Free Pass/Trial/Pro/Free labels based on role+status',
  'FIX: components/ui/AppShell.tsx — Admin Portal link in sidebar (Shield icon, System section) for admin/super_admin only',
  'FIX: components/ui/AppShell.tsx — Subscription CTA hidden for admin/super_admin; Free Pass badge shown for free_pass users; Admin badge for admins',
  'FIX: components/ui/AppShell.tsx — UserDropdown shows Admin Portal link for admins; hides Upgrade Plan for admins/free_pass',
  'FIX: hooks/useSubscription.ts — role field added; admin/super_admin bypass all subscription checks and feature gates',
  'FIX: hooks/useSubscription.ts — isFreePass from DB boolean only; isExpired/isPastDue never true for admins',
  'FIX: lib/permissions.ts — checkAccess() accepts optional role param; admin/super_admin always return allowed=true',
  'FIX: components/ui/SubscriptionBanner.tsx — hidden for admin/super_admin roles',
  'FIX: app/dashboard/page.tsx — uses useSubscription() for role instead of separate /api/auth/me fetch',
  // v40.6 — Vercel alias cache fix + role priority
  'FIX: components/ui/AppShell.tsx — getAccountBadge() handles free_pass status string as fallback (safety net)',
  'FIX: components/ui/AppShell.tsx — useVersionCheck() auto-reloads page when new deployment detected',
  'NEW: hooks/useVersionCheck.ts — polls /api/version every 60s; hard-reloads if server version differs from client build',
  'NEW: vercel.json — locks alias to solarpro-v31.vercel.app; disables autoAlias; aggressive no-cache headers on HTML/API',
  'FIX: next.config.js — injects NEXT_PUBLIC_BUILD_VERSION env var so client knows its build version',
  'FIX: app/api/version/route.ts — returns version + ts fields with no-cache headers',
  'FIX: app/account/billing/page.tsx — full rewrite: role+plan shown independently; admin bypass; no free_pass status inference',
  // v40.7 — Global UserContext + refreshUser()
  'NEW: contexts/UserContext.tsx — global AppUser state; UserProvider wraps entire app; refreshUser() re-fetches DB',
  'FIX: app/layout.tsx — UserProvider added wrapping entire app tree',
  'FIX: components/ui/AppShell.tsx — reads from UserContext; no independent /api/auth/me fetch',
  'FIX: hooks/useSubscription.ts — reads from UserContext; no independent /api/auth/me fetch',
  'FIX: app/dashboard/page.tsx — reads role from UserContext via useUser()',
  'FIX: app/account/billing/page.tsx — reads user from UserContext; no independent fetch',
  'FIX: app/api/admin/users/route.ts — PATCH returns updated user record after every action',
  'FIX: app/admin/users/page.tsx — calls refreshUser() after every action; fixes userId→id body key bug',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}