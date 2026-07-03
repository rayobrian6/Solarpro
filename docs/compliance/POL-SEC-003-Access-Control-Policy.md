# SolarPro Access Control Policy

**Document ID:** POL-SEC-003  
**Version:** 1.0  
**Effective Date:** July 2025  
**Owner:** Security Lead  
**Review Cycle:** Annual (next review: July 2026)  
**Classification:** Internal  

---

## 1. Purpose

This policy defines how access to SolarPro systems, data, and functions is granted, managed, reviewed, and revoked. It implements the principle of least privilege and ensures that access is continuously appropriate for each user's role and responsibilities.

## 2. Scope

This policy applies to all SolarPro systems including:
- SolarPro web application (admin, portal, API routes)
- Database (Neon PostgreSQL)
- Hosting platform (Vercel)
- Code repository (GitHub)
- Third-party services (Stripe, Sentry, Resend, Anthropic, OpenAI, Google Cloud, Mapbox, Render)
- Any future systems added to the SolarPro environment

## 3. Role-Based Access Control (RBAC)

SolarPro implements role-based access control with the following defined roles:

### 3.1 Application Roles

| Role | Level | Capabilities |
|------|-------|-------------|
| **super_admin** | 0 | Full system access, user management, impersonation, billing, all projects |
| **admin** | 1 | Project management, crew management, engineering tools, reports |
| **staff** | 2 | Assigned projects only, limited admin functions, no user management |
| **crew_member** | 3 | Field-facing data entry, photo uploads, schedule view — project-scoped |
| **homeowner** | 4 | Portal access only — view own project, upload bills, view proposals |

### 3.2 Infrastructure Roles

| Platform | Roles | Assignment |
|----------|-------|-----------|
| **Vercel** | Owner, Member, Viewer | Leadership assigns; minimum Members for deployment access |
| **Neon** | Owner, Member, Read-only | Security Lead assigns; no shared database credentials |
| **GitHub** | Admin, Write, Read | Security Lead assigns; branch protection on `dev` and `master` |
| **Stripe** | Admin, Developer, Analyst | Leadership assigns; Admin role limited to 2 individuals |
| **Sentry** | Admin, Member | Security Lead assigns |
| **Google Cloud** | Owner, Editor, Viewer | Security Lead assigns; API keys scoped to minimum services |
| **Anthropic / OpenAI** | Admin, Member | Security Lead assigns; API keys rotated quarterly |

## 4. Access Grant (Onboarding)

### 4.1 New Personnel Access Procedure

Access shall be granted through the following process:

1. **Access request** — Hiring manager submits access request specifying:
   - New personnel name and email
   - Role required (application + infrastructure)
   - Business justification
   - Requested duration (if contractor)
2. **Approval** — Security Lead approves the request; Leadership approval required for super_admin or admin roles
3. **Provisioning** — Security Lead or designated administrator creates accounts with:
   - Application account with appropriate RBAC role
   - Infrastructure accounts on required platforms
   - MFA enrollment required before first login
   - Temporary password generated via `crypto.randomBytes()` (12+ character, cryptographically random)
4. **Verification** — New personnel confirms access works and MFA is enrolled
5. **Documentation** — Access grant recorded in the Access Register with date, approver, and scope

### 4.2 Elevated Access (Break-Glass)

Temporary elevated access for incident response or critical fixes:

1. Request via Slack or direct communication to Security Lead
2. Approval from Security Lead or Leadership
3. Time-limited to maximum 4 hours
4. All actions logged and reviewed post-incident
5. Access automatically revoked at expiration

## 5. Access Review

### 5.1 Quarterly Access Review

Every quarter, the Security Lead shall:

1. Export current access roster for all platforms
2. Review each user's access against their current role and responsibilities
3. Identify:
   - **Orphaned accounts** — Users who have left but access not revoked
   - **Privilege creep** — Users with more access than their role requires
   - **Stale accounts** — Accounts with no login activity in 90+ days
4. Remediate findings within 5 business days
5. Document review results in the Access Review Log

### 5.2 Review Schedule

| Quarter | Review Period | Completion Deadline |
|---------|--------------|-------------------|
| Q1 | Jan-Mar access | April 15 |
| Q2 | Apr-Jun access | July 15 |
| Q3 | Jul-Sep access | October 15 |
| Q4 | Oct-Dec access | January 15 |

## 6. Access Revocation (Offboarding)

### 6.1 Personnel Departure Procedure

Access shall be revoked **before or within 4 hours of** the personnel's last working day:

1. **Notification** — Hiring manager or Leadership notifies Security Lead of departure
2. **Immediate revocation** — All access disabled:
   - Application account disabled or role set to "inactive"
   - All infrastructure accounts deactivated
   - API keys or tokens issued to the individual rotated
   - SSH keys or deploy keys removed
   - Shared credentials changed if the departing individual had access
3. **Verification** — Security Lead confirms all access removed within 4 hours
4. **Documentation** — Revocation recorded in Access Register with date and scope

### 6.2 Role Change Procedure

When a user's role changes (promotion, lateral move, project reassignment):

1. Old access revoked within 24 hours of role change
2. New access granted per Section 4.1
3. Access Register updated to reflect change
4. No access accumulation — new access replaces, not adds to, old access unless explicitly justified

## 7. Authentication Requirements

### 7.1 Multi-Factor Authentication (MFA)

MFA is **mandatory** for all personnel with access to:

- SolarPro application (admin, admin, staff roles)
- Vercel dashboard
- Neon database console
- GitHub repository
- Stripe dashboard
- Any platform with access to customer data or production systems

**Approved MFA methods:**
- TOTP (Google Authenticator, Authy, 1Password)
- Hardware security keys (YubiKey, via WebAuthn)
- Platform-native MFA (Vercel, GitHub, Google)

**Not approved:**
- SMS-based OTP (susceptible to SIM swapping)

### 7.2 Session Management

| Parameter | Admin/Staff | Homeowner |
|-----------|-------------|-----------|
| Session timeout | 8 hours | 30 days |
| Idle timeout | 30 minutes | N/A |
| Concurrent sessions | 1 per user | 1 per user |
| Re-authentication for sensitive actions | Required | Required |

### 7.3 Password Requirements

| Parameter | Requirement |
|-----------|-------------|
| Minimum length | 12 characters |
| Complexity | Mixed case, number, special character |
| History | Last 12 passwords cannot be reused |
| Maximum age | 90 days (admin/staff), N/A (homeowner) |
| Storage | Bcrypt or Argon2 hash — never plaintext |
| Temporary passwords | `crypto.randomBytes()` — 12+ characters, expires in 24 hours |

## 8. Service Account Management

### 8.1 API Keys and Service Accounts

- All API keys shall be stored in environment variables (never in code or repository)
- API keys shall be rotated quarterly
- Each service account shall have a designated owner
- Service accounts shall have the minimum permissions required
- Unused service accounts shall be disabled after 30 days of inactivity

### 8.2 Webhook Secrets

- All webhook verification secrets (survey partner, Stripe, Meta, Google) shall be stored in environment variables
- Secrets shall be rotated annually or immediately upon any suspected compromise
- Webhook signatures shall be verified on every incoming request (currently implemented via HMAC-SHA256)

## 9. Audit Logging

All access events shall be logged and retained per the Data Retention Policy:

- Login successes and failures
- Role or permission changes
- Access grants and revocations
- Elevated access (break-glass) usage
- Failed MFA attempts
- Password changes and resets
- API key creation and rotation

## 10. Exceptions

Any exception to this policy requires:
- Written justification from the requesting party
- Risk assessment by Security Lead
- Written approval from Leadership
- Time limitation (maximum 90 days)
- Compensating controls documented

---

*All personnel acknowledge this policy upon onboarding and at each annual review.*

**Approved by:** Under The Sun Solar Leadership  
**Date:** July 2025
