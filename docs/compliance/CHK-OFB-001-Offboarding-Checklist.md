# SolarPro Offboarding Checklist

**Document ID:** CHK-OFB-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Policy Reference:** POL-SEC-003 (Access Control Policy), POL-SEC-007 (Data Retention & Disposal Policy), POL-SEC-009 (Password & Authentication Policy)

---

## Purpose

This checklist ensures timely and complete revocation of access when a team member leaves SolarPro. Incomplete offboarding is a top compliance risk — SOC 2 CC6.3 (User Provisioning and Deprovisioning) and ISO 27001 A.8.1.3 (Removal of Access Rights) require access to be revoked within defined timeframes. Per POL-SEC-003 §5.2, all access must be revoked within 4 hours of employment termination.

---

## Immediate Actions (Within 4 Hours of Termination)

### SolarPro Application Access

- [ ] **User account disabled in SolarPro database**
  - Set account status to inactive/suspended
  - Do NOT delete the user record (audit trail must be preserved per POL-SEC-007)
  - Revoke any active sessions (invalidate JWT by updating `password_changed_at` to NOW())

- [ ] **MFA credentials invalidated**
  - Clear `mfa_secret_encrypted` field
  - Set `mfa_enabled = false`
  - Delete all recovery codes from `mfa_recovery_codes` table
  - Audit log entry: `mfa_disabled` with reason `offboarding`

- [ ] **All active sessions terminated**
  - JWT-based sessions cannot be server-side invalidated directly
  - Update `password_changed_at` to force re-authentication on any existing JWT
  - Verify session timeout enforcement catches remaining sessions within 8 hours (admin) or 24 hours (homeowner)

- [ ] **API keys and service tokens revoked**
  - Any personal API keys issued to the user must be rotated
  - Check `MFA_ENCRYPTION_KEY` and `JWT_SECRET` if user had knowledge of them — rotate if compromised
  - Review any shared secrets the user had access to

### Third-Party Service Access

- [ ] **Vercel access removed**
  - Remove from Vercel team
  - Revoke any personal access tokens

- [ ] **Neon database access removed**
  - Remove any direct database credentials (should be rare — application-mediated only)
  - Rotate connection string if user had direct access

- [ ] **Sentry access removed**
  - Remove from Sentry organization
  - Revoke personal API tokens

- [ ] **GitHub access removed** (if applicable)
  - Remove from GitHub organization
  - Revoke SSH keys
  - Remove from repository collaborator lists

- [ ] **Stripe access reviewed** (should be application-mediated only)
  - Confirm no direct Stripe dashboard access exists
  - If access existed, remove and rotate API keys

- [ ] **Upstash Redis access removed**
  - Remove any direct Redis credentials
  - Rotate Redis URL if user had direct access

- [ ] **Resend email service access removed**
  - Remove from Resend team
  - Revoke API keys if user had access

- [ ] **Anthropic/OpenAI API keys reviewed**
  - Confirm API keys are server-side only and user had no direct access
  - Rotate keys if compromised

- [ ] **Google Cloud Storage access removed** (if applicable)
  - Remove IAM bindings
  - Revoke service account keys if user had access

- [ ] **Slack/Teams access removed**
  - Deactivate account or remove from workspace
  - Remove from all channels

---

## 24-Hour Actions

### Data and Knowledge Transfer

- [ ] **Client data ownership transferred**
  - Reassign all clients owned by departing user to their manager or designated successor
  - Update `clients` table: set new owner for all records where departing user was owner
  - Verify no client data is orphaned (assigned to inactive user)

- [ ] **Project ownership transferred**
  - Reassign all projects owned by departing user
  - Update `projects` table: set new owner
  - Verify no active projects are blocked by departing user's access

- [ ] **Pending proposals reassigned**
  - Reassign any proposals in draft/review status
  - Verify no unsigned proposals reference the departing user as sole approver

- [ ] **Knowledge transfer completed**
  - Document any unique knowledge the departing user possessed
  - Transfer documentation, runbooks, and procedures
  - Review any custom scripts or automation the user maintained

### Security Verification

- [ ] **Audit log review for departing user's last 30 days of activity**
  - Query audit log for all actions by departing user ID
  - Look for unusual data access patterns (bulk downloads, access outside normal hours)
  - Verify no data exfiltration indicators

- [ ] **Data export review**
  - Check if departing user used the data export API (`/api/privacy/export-data`) recently
  - Investigate any large data exports in the last 30 days

- [ ] **Shared credential rotation**
  - Rotate any team-shared credentials the user had access to
  - Update any webhook secrets the user configured
  - Review and update any CI/CD secrets the user could access

---

## 7-Day Actions

### Compliance Documentation

- [ ] **Offboarding record completed**
  - Document termination date and reason (voluntary/involuntary)
  - List all systems access was revoked from, with timestamps
  - Manager sign-off on completed offboarding

- [ ] **Access revocation audit trail verified**
  - Confirm audit log entries exist for: `account_disabled`, `mfa_disabled`, `session_terminated`
  - Verify timestamps are within the 4-hour SLA per POL-SEC-003 §5.2
  - Archive offboarding record for SOC 2 evidence

- [ ] **Data retention compliance checked**
  - User data retained per POL-SEC-007 schedule
  - Application data: Retained (belongs to company, not user)
  - Personal data: Retained for legal hold period if applicable
  - Audit logs: Retained for 3 years minimum

- [ ] **Final access review**
  - Confirm no lingering access to any system
  - Verify user does not appear in any access control lists
  - Check for any shared accounts or service accounts the user could still access

### Risk Assessment

- [ ] **Risk level assessment completed**
  - **Low risk**: Voluntary departure, no sensitive data access, all revocation confirmed
  - **Medium risk**: Involuntary departure or user had admin access
  - **High risk**: Involuntary departure + user had super_admin access or access to encryption keys
  - For medium/high risk: Extend audit log review to 90 days and consider key rotation

- [ ] **Incident assessment (if applicable)**
  - If departure is related to a security incident, link to incident record (POL-SEC-005)
  - Preserve all relevant evidence per incident response procedures

---

## Emergency Offboarding (Immediate Termination)

For involuntary terminations or security incidents, execute the following within **1 hour**:

1. **Disable account immediately** — Set user status to inactive in database
2. **Invalidate all sessions** — Update `password_changed_at` to NOW()
3. **Remove from all third-party services** — Vercel, Sentry, GitHub, Slack, etc.
4. **Revoke MFA** — Clear MFA secrets and recovery codes
5. **Rotate shared secrets** — If user had access to JWT_SECRET, MFA_ENCRYPTION_KEY, or webhook secrets
6. **Audit log alert** — Flag all recent activity by this user for review
7. **Notify security team** — Alert incident response team per POL-SEC-005

---

## Offboarding Evidence Requirements

For SOC 2 and ISO 27001 audits, retain the following evidence:

1. **Access revocation record** — systems, timestamps, confirmation
2. **Audit log entries** — `account_disabled`, `mfa_disabled`, `session_terminated`
3. **Manager sign-off** — confirmation that all access was revoked
4. **Data transfer confirmation** — client/project ownership reassigned
5. **Risk assessment** — risk level and any additional actions taken
6. **Credential rotation records** — which secrets were rotated and when
7. **Third-party removal confirmations** — screenshots or records from each service

---

## Offboarding by Role

| Action | super_admin | admin | staff | crew_member | homeowner |
|--------|:-----------:|:-----:|:-----:|:-----------:|:---------:|
| Time to revoke all access | 1 hour | 1 hour | 4 hours | 4 hours | 24 hours |
| Rotate JWT_SECRET | ✅ If accessed | ❌ | ❌ | ❌ | ❌ |
| Rotate MFA_ENCRYPTION_KEY | ✅ If accessed | ❌ | ❌ | ❌ | ❌ |
| Rotate shared API keys | ✅ | ✅ If accessed | ❌ | ❌ | ❌ |
| Audit log review period | 90 days | 90 days | 30 days | 30 days | 7 days |
| Client data reassignment | All | Assigned | Assigned | Own | Own |
| Emergency key rotation | ✅ | ❌ | ❌ | ❌ | ❌ |

---

*Last reviewed: July 2025 | Next review: October 2025 (quarterly per POL-SEC-003 §6.1)*
