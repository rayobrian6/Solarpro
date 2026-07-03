# SolarPro Quarterly Access Review Template

**Document ID:** TMP-ACC-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Policy Reference:** POL-SEC-003 §6.1 (Quarterly Access Reviews)

---

## Purpose

SOC 2 CC6.3 and ISO 27001 A.9.2.5 require periodic review of user access rights to ensure they remain appropriate. This template guides the quarterly review process per POL-SEC-003 §6.1.

---

## Review Information

| Field | Value |
|-------|-------|
| Review Period | Q_ 20__ (Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec) |
| Review Date | __________ |
| Reviewer | __________ |
| Approver | __________ |

---

## Step 1: Generate User Access Report

Run the following query to generate the current user access inventory:

```sql
SELECT
  u.id,
  u.email,
  u.role,
  u.mfa_enabled,
  u.mfa_method,
  u.mfa_enrolled_at,
  u.mfa_verified_at,
  u.consent_privacy_at,
  u.created_at,
  COUNT(DISTINCT a.id) AS recent_login_count
FROM users u
LEFT JOIN audit_log a ON a.actor_id = u.id
  AND a.action = 'login_success'
  AND a.timestamp > NOW() - INTERVAL '90 days'
GROUP BY u.id, u.email, u.role, u.mfa_enabled, u.mfa_method,
         u.mfa_enrolled_at, u.mfa_verified_at, u.consent_privacy_at, u.created_at
ORDER BY u.role, u.email;
```

---

## Step 2: Review Each User Account

For each user, verify:

| Check | Pass | Fail | N/A | Notes |
|-------|:----:|:----:|:---:|-------|
| User still employed/active | | | | |
| Role is appropriate for current responsibilities | | | | |
| MFA enabled if role requires it (admin/staff) | | | | |
| MFA last verified within 90 days | | | | |
| No excessive permissions beyond job requirements | | | | |
| Recent login activity matches expected pattern | | | | |
| No dormant accounts (0 logins in 90 days) | | | | |
| Client/project access still appropriate | | | | |

---

## Step 3: MFA Compliance Check

| Role | Total Users | MFA Enabled | MFA Missing | Action Required |
|------|-------------|-------------|-------------|-----------------|
| super_admin | | | | |
| admin | | | | |
| staff | | | | |
| crew_member | | | | |
| homeowner | | | | |

**Action for MFA non-compliance:** Per POL-SEC-009 §4.1, admin/staff accounts without MFA must be blocked from login (`MFA_ENROLLMENT_REQUIRED`). Verify this enforcement is active.

---

## Step 4: Dormant Account Review

Accounts with zero login activity in the past 90 days:

| Email | Role | Last Login | Action |
|-------|------|------------|--------|
| | | | Disable / Keep / Investigate |

**Policy:** Per POL-SEC-003 §5.3, dormant accounts should be disabled after 90 days of inactivity unless documented justification exists.

---

## Step 5: Privileged Access Review

Review all accounts with admin or super_admin access:

| Email | Admin Since | Business Justification | Still Required | Action |
|-------|-------------|----------------------|----------------|--------|
| | | | Yes / No | Keep / Downgrade |

**Policy:** Per POL-SEC-003 §4.3, privileged access must be justified and documented. Remove if no longer needed.

---

## Step 6: Third-Party Service Access

| Service | Users with Access | Appropriate | Action |
|---------|-------------------|-------------|--------|
| Vercel | | | |
| Neon (direct) | | | |
| Sentry | | | |
| GitHub | | | |
| Stripe Dashboard | | | |
| Upstash Redis | | | |
| Google Cloud | | | |
| Resend | | | |

---

## Step 7: Findings and Remediation

| Finding ID | Description | Severity | Remediation | Due Date | Owner |
|------------|-------------|----------|-------------|----------|-------|
| Q_-001 | | Critical/High/Medium/Low | | | |

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Reviewer | | | |
| Manager Approval | | | |
| Compliance Owner | | | |

---

*Template version: 1.0 | Review frequency: Quarterly per POL-SEC-003 §6.1*
