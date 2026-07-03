# SolarPro Onboarding Checklist

**Document ID:** CHK-ONB-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Policy Reference:** POL-SEC-003 (Access Control Policy), POL-SEC-009 (Password & Authentication Policy)

---

## Purpose

This checklist ensures every new SolarPro team member receives the correct access level, security training, and equipment configuration during onboarding. It supports SOC 2 CC6.1–CC6.3 (Logical and Physical Access Controls) and ISO 27001 A.7.2 (During Employment) requirements.

---

## Pre-Onboarding (Before Day 1)

- [ ] **Access request submitted and approved** by direct manager and system owner
  - Specify role: `super_admin` | `admin` | `staff` | `crew_member` | `homeowner`
  - Document business justification for each system access
  - Manager approval stored in access request log

- [ ] **Account provisioned in SolarPro application**
  - User record created in `users` table with correct `role`
  - Email verified before access granted
  - Initial password set via secure invitation link (never shared via email/chat)

- [ ] **MFA enrollment planned**
  - Admin/staff roles: MFA enrollment is MANDATORY before first login (POL-SEC-009 §4.1)
  - TOTP authenticator app approved: Google Authenticator, Authy, 1Password, Bitwarden
  - Recovery codes generated and stored securely by user (shown only once during enrollment)

- [ ] **Equipment prepared** (if company-managed device)
  - Device enrolled in endpoint management (if applicable)
  - Full-disk encryption enabled
  - Auto-lock configured (5-minute idle timeout)
  - Antivirus/EDR software installed (if applicable)

- [ ] **Third-party service accounts provisioned**
  - Review POL-SEC-008 (Vendor Risk Management) for approved cloud services
  - Vercel: Read-only access (admin roles only)
  - Neon database: No direct access (application-mediated only)
  - Sentry: Access provisioned based on role
  - Stripe: No direct access (application-mediated only)
  - Upstash Redis: No direct access (application-mediated only)

---

## Day 1 Onboarding

### Security Orientation

- [ ] **Information Security Policy (POL-SEC-001) reviewed and acknowledged**
  - Employee signs acknowledgment (stored in personnel file)
  - Key principles explained: least privilege, defense in depth, zero trust

- [ ] **Acceptable Use Policy (POL-SEC-002) reviewed and acknowledged**
  - Prohibited activities clearly explained
  - BYOD requirements reviewed if using personal device
  - Social media guidelines reviewed

- [ ] **Data Classification (POL-SEC-004) training completed**
  - Four tiers explained: Restricted, Confidential, Internal, Public
  - Examples of each tier in SolarPro context
  - Handling requirements for each tier

- [ ] **Incident Response awareness (POL-SEC-005) overview completed**
  - How to report a suspected security incident
  - Incident response team contact information provided
  - Escalation procedures explained

### Account Activation

- [ ] **First login completed with password reset**
  - User logs in with temporary credentials
  - Forced password change on first login (bcrypt cost ≥ 12)
  - Password meets minimum requirements per role tier (POL-SEC-009 §3.1)

- [ ] **MFA enabled before accessing sensitive functions** (admin/staff roles)
  - TOTP authenticator app installed on user's device
  - MFA enrollment completed via `/api/auth/mfa/setup`
  - First TOTP code verified via PUT `/api/auth/mfa/setup`
  - Recovery codes saved by user in secure location

- [ ] **Session timeout explained**
  - Admin/staff: 8-hour session maximum
  - Homeowner/crew: 24-hour session maximum
  - Re-authentication required after timeout

- [ ] **Role-appropriate access verified**
  - Confirm user can access only the features and data required for their role
  - Verify no excessive permissions were granted
  - Test access to sensitive functions (admin panel, client data, etc.)

### Communication and Documentation

- [ ] **Employee added to relevant communication channels**
  - Slack/Teams channels (appropriate to role)
  - Email distribution lists
  - Incident notification channels

- [ ] **Onboarding record created in HR/system**
  - Start date documented
  - Role and access level documented
  - Manager documented
  - MFA enrollment status documented
  - Policy acknowledgment receipts stored

---

## Week 1 Verification

- [ ] **Manager verifies access is appropriate and minimal**
  - Review all system access granted
  - Confirm no standing privileges beyond what's needed
  - Remove any temporary elevated access used during onboarding

- [ ] **First access review completed**
  - Confirm user activity matches expected patterns
  - Verify MFA is actively being used (check audit log for `mfa_challenge_success` entries)
  - No suspicious access patterns

- [ ] **Incomplete onboarding items resolved**
  - Any deferred items from Day 1 must be completed by end of Week 1
  - If MFA enrollment was deferred (it should NOT be), escalate to compliance

---

## Compliance Evidence Requirements

For SOC 2 and ISO 27001 audits, the following evidence must be retained:

1. **Access request form** — business justification, manager approval, date
2. **Policy acknowledgment receipts** — signed by employee, dated
3. **MFA enrollment confirmation** — audit log entry of `mfa_enabled` action
4. **Role assignment record** — role assigned, date, approver
5. **First login audit record** — `login_success` entry in audit_log table
6. **Manager verification** — documented confirmation of appropriate access
7. **Training completion records** — security orientation completion date

---

## Onboarding by Role

| Step | super_admin | admin | staff | crew_member | homeowner |
|------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| MFA Required | ✅ | ✅ | ✅ | ❌ | ❌ |
| MFA Enrollment | Day 1 mandatory | Day 1 mandatory | Day 1 mandatory | Optional | Optional |
| Admin Panel Access | Full | Full | Limited | None | None |
| Client Data Access | Full | Full | Assigned only | Own projects | Own projects |
| Password Min Length | 14 chars | 14 chars | 14 chars | 12 chars | 12 chars |
| Session Timeout | 8 hours | 8 hours | 8 hours | 24 hours | 24 hours |
| Security Training | Full | Full | Full | Basic | Basic |
| Incident Response | Response team | Notify channel | Notify channel | Notify channel | N/A |

---

*Last reviewed: July 2025 | Next review: October 2025 (quarterly per POL-SEC-003 §6.1)*
