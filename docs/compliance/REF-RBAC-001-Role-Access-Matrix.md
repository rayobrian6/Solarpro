# SolarPro Role-Based Access Control (RBAC) Matrix

**Document ID:** REF-RBAC-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Policy Reference:** POL-SEC-003 (Access Control Policy)

---

## Role Definitions

SolarPro implements a 5-role hierarchy with strict least-privilege boundaries. Roles are stored in the `users.role` column and enforced server-side via `requireAdminApi()` and role checks in route handlers.

| Role | Level | Description | MFA Required |
|------|-------|-------------|:------------:|
| `super_admin` | 0 | Full system access including security settings, user management, and compliance functions | ✅ |
| `admin` | 1 | Business administration: projects, clients, proposals, team management | ✅ |
| `staff` | 2 | Day-to-day operations: project work, client communication, reporting | ✅ |
| `crew_member` | 3 | Field operations: site surveys, installations, photo uploads | ❌ (optional) |
| `homeowner` | 4 | Customer self-service: project status, proposals, portal access | ❌ (optional) |

---

## Application Feature Access Matrix

| Feature | super_admin | admin | staff | crew_member | homeowner |
|---------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| **Dashboard** | ✅ Full | ✅ Full | ✅ Limited | ❌ | ❌ |
| **Admin Panel** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **User Management** | ✅ CRUD | ✅ Read/Update | ❌ | ❌ | ❌ |
| **Role Assignment** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **MFA Enforcement** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Client Records** | ✅ All | ✅ Assigned + All view | ✅ Assigned only | ❌ | Own only |
| **Project CRUD** | ✅ All | ✅ All | ✅ Assigned | ✅ Assigned (field) | Own only |
| **Proposal Creation** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Proposal Signing** | ❌ | ❌ | ❌ | ❌ | ✅ Own |
| **Engineering Tools** | ✅ | ✅ | ✅ Limited | ❌ | ❌ |
| **Satellite/Aerial** | ✅ | ✅ | ✅ Limited | ❌ | ❌ |
| **OCR/Bill Upload** | ✅ | ✅ | ✅ | ✅ | ✅ Portal |
| **File Management** | ✅ All | ✅ All | ✅ Assigned | ✅ Upload only | Own only |
| **Billing/Stripe** | ✅ Manage | ✅ View | ❌ | ❌ | ✅ Own |
| **Audit Log Access** | ✅ | ✅ Read-only | ❌ | ❌ | ❌ |
| **Data Export (Privacy)** | ✅ Admin export | ✅ Admin export | ✅ Own data | ✅ Own data | ✅ Own data |
| **Data Deletion (Privacy)** | ❌ (legal hold) | ❌ | ❌ | ❌ | ✅ Own data |
| **Settings/Config** | ✅ All | ✅ Org-level | ✅ Profile only | ✅ Profile only | ✅ Profile only |
| **Homeowner Portal** | ❌ | ✅ Admin view | ❌ | ❌ | ✅ Full |
| **Crew Scheduling** | ✅ | ✅ | ✅ View | ✅ Own schedule | ❌ |
| **Compliance Docs** | ✅ | ✅ Read | ❌ | ❌ | ❌ |

---

## Database-Level Access

| Table | super_admin | admin | staff | crew_member | homeowner |
|-------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| `users` | Read/Update (no delete) | Read | Read own | Read own | Read own |
| `projects` | Full CRUD | Full CRUD | Read assigned + update assigned | Read/update assigned | Read own |
| `clients` | Full CRUD | Full CRUD | Read/update assigned | ❌ | Read own |
| `proposals` | Full CRUD | Full CRUD | Create/read/update assigned | ❌ | Read/sign own |
| `audit_log` | Read + verify chain | Read only | ❌ | ❌ | ❌ |
| `mfa_recovery_codes` | ❌ (hashed only) | ❌ | ❌ | ❌ | ❌ |
| `activity_log` | Read all | Read all | Read assigned | Read own | Read own |

**Note:** No user role has direct DELETE access on `audit_log` or `users` tables. These are protected per POL-SEC-007 (retention) and POL-SEC-003 (no account deletion — deactivation only).

---

## API Route Access Control

### Admin-Only Routes (`requireAdminApi`)

All routes under `/api/admin/*` require `admin` or `super_admin` role. The `requireAdminApi()` middleware:
- Validates JWT session cookie
- Queries database for user's current role (not from JWT — DB is source of truth)
- Checks for 60-second role cache staleness
- Returns 403 if role is not admin or super_admin

### Authenticated Routes

All routes under `/api/*` (except PUBLIC_PATHS) require valid JWT session. Middleware checks:
- JWT structure valid (3-part base64)
- JWT not expired (`exp` claim)
- JWT has `id` and `email` identity fields
- Session timeout not exceeded (8hr admin, 24hr homeowner)
- CSRF protection on state-changing methods

### Public Routes

Per `middleware.ts` PUBLIC_PATHS, these routes require no authentication:
- Marketing pages, login, register, password reset
- Auth API endpoints (login, register, logout, me)
- Webhook endpoints (validated via HMAC signatures internally)
- Mobile API endpoints (validated via Bearer JWT internally)
- Health check endpoints
- Homeowner portal login/verify

---

## Third-Party Service Access by Role

| Service | super_admin | admin | staff | crew_member | homeowner |
|---------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| Vercel Dashboard | ✅ Deploy + settings | ❌ | ❌ | ❌ | ❌ |
| Neon Console | ❌ (connection string only) | ❌ | ❌ | ❌ | ❌ |
| Sentry | ✅ Full | ✅ Read-only | ❌ | ❌ | ❌ |
| Stripe Dashboard | ❌ (API only) | ❌ | ❌ | ❌ | ❌ |
| Upstash Console | ❌ (env var only) | ❌ | ❌ | ❌ | ❌ |
| GitHub | ✅ Admin | ✅ Developer | ❌ | ❌ | ❌ |
| Resend Dashboard | ❌ (API only) | ❌ | ❌ | ❌ | ❌ |
| Anthropic/OpenAI | ❌ (server-side only) | ❌ | ❌ | ❌ | ❌ |
| Google Cloud | ❌ (service account) | ❌ | ❌ | ❌ | ❌ |

**Key principle:** Most third-party services are accessed server-side only via API keys stored in environment variables. Direct dashboard access is limited to super_admin and only for services that require it (Vercel, Sentry, GitHub).

---

## Session Parameters by Role

| Parameter | super_admin | admin | staff | crew_member | homeowner |
|-----------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| JWT Lifetime | 30 days | 30 days | 30 days | 30 days | 30 days |
| Session Timeout (middleware) | 8 hours | 8 hours | 8 hours | 24 hours | 24 hours |
| Password Min Length | 14 chars | 14 chars | 14 chars | 12 chars | 12 chars |
| MFA Required | ✅ TOTP | ✅ TOTP | ✅ TOTP | Optional | Optional |
| Rate Limit (standard) | 60/min | 60/min | 60/min | 60/min | 60/min |
| Rate Limit (admin) | 30/min | 30/min | N/A | N/A | N/A |
| Rate Limit (engineering) | 20/min | 20/min | 20/min | N/A | N/A |

---

*Last reviewed: July 2025 | Next review: October 2025 (quarterly per POL-SEC-003 §6.1)*
