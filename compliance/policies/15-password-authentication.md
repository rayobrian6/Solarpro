# Password & Authentication Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-015 — Password & Authentication Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro systems, accounts, and credentials — internal app, infra providers (Vercel, Neon, Render, GitHub, Google Workspace, Cloudflare, Stripe, Resend, Sentry), and the secrets Solarpro issues (JWT, MFA, webhook HMAC, DB passwords) |

---

## 1. Purpose

This policy is the technical rule for "what is a strong credential, how do we authenticate, and what happens when an authentication goes wrong." It's the **SOC 2 CC6.1 + ISO 27001 A.5.17** evidence and the operational detail that the Access Control Policy §4 references.

The rules are written down here so that:

- The 12-character minimum for user passwords is **policy**, not "what we happen to enforce today."
- The 32-character minimum for high-entropy secrets (JWT signing keys, MFA encryption keys, webhook HMAC secrets) is **policy**, not "what the security quickwins PR enforced."
- The MFA requirement for admin / production / source code / cloud consoles is **policy**, not "what Raymond happens to have turned on."
- The lockout, session, and re-authentication rules are **policy**, not "what the middleware happens to do."

When the policy says "must," an exception is a documented compliance-exception, not a Slack message. When the policy says "should," it's the recommendation that the auditor will check we followed unless we have a reason not to.

## 2. Principles

Five principles, in priority order.

1. **Length beats complexity.** A 16-character passphrase is stronger than an 8-character "P@ssw0rd!" and easier to remember. The policy enforces length, not character-class composition.
2. **No periodic forced rotation.** Forced rotation pushes people to predictable patterns (`Spring2024!`, `Spring2025!`). NIST 800-63B §5.1.1.2 retired the 90-day rotation requirement in 2017. We follow NIST. We rotate when there is evidence of compromise, not on a calendar.
3. **MFA is the default for anything that matters.** Anything that holds customer data, deploys code, holds admin keys, or touches production gets MFA. TOTP and WebAuthn are first-class. SMS is the fallback, deprecated, used only when the system does not support anything else.
4. **Failures are loud, not silent.** Failed login attempts, lockouts, MFA challenges, and password resets are auditable events. The Login lockout counter is enforced server-side. The rate limiter is fail-closed in production (the 2026-08-12 incident is the trigger for the fail-closed rule; see the Change Management Policy §6 for the rate-limiter details).
5. **Secrets are not passwords.** User-facing passwords and machine-to-machine secrets are different things. User passwords are user-chosen and meet the §3 rules. Machine secrets are 32+ characters of high-entropy randomness, generated and stored by 1Password or GitHub Actions encrypted secrets, and rotated on a documented cadence.

## 3. User password requirements

### 3.1 Minimums

- **Minimum 12 characters.** No maximum (long passphrases are encouraged). The check is on the length of the string, not on the character classes.
- **No composition rules.** No "must contain uppercase, lowercase, number, and symbol." The check is `password.length >= 12`. The Zod schema in `app/api/auth/register/route.ts` enforces this.
- **No forced periodic rotation.** Passwords are rotated only when (a) the user wants to, (b) there is evidence of compromise, or (c) the user changes roles and the role change requires it.

### 3.2 The breach-dictionary check

At registration and at password change, the password is checked against a breach dictionary. The current implementation:

- **`isGibberish` check** (`app/api/auth/register/route.ts`): rejects passwords that are clearly not user-chosen (all-the-same-character, sequential keyboard patterns, common keyboard patterns).
- **`isDisposableEmail` check**: rejects email addresses from known disposable email providers. This is an email check, not a password check, but it sits in the same registration flow.
- **HaveIBeenPwned (HIBP) k-anonymity check** (planned, the security quickwins PR's follow-up): the first 5 characters of the SHA-1 hash of the password are sent to the HIBP API; the response is checked for the suffix. The plaintext password never leaves the server. Passwords matching the HIBP list are rejected with a message: "This password has appeared in a data breach. Please choose a different one."

The HIBP check is the **de facto** industry standard. It's not in the codebase as of 2026-08-15; the policy codifies the requirement so the implementation can be tracked.

### 3.3 Storage and transmission

- **In transit**: TLS 1.2 or higher. The login endpoint is HTTPS-only; HTTP login attempts are redirected to HTTPS at the load balancer.
- **At rest**: bcrypt with cost factor 12. The hash is stored in the `users.password_hash` column. The plaintext is never stored, never logged, never returned by any API.
- **In the password manager**: 1Password (team vault). No other password manager is approved for work accounts. Browser-saved passwords for work accounts are discouraged but not prohibited; the 1Password extension is the recommended path.

### 3.4 Reset and recovery

- **Password reset** uses a single-use token sent by email. The token is valid for 1 hour. After 1 hour, the user requests a new token. After 5 failed attempts on the same token, the account is locked for 15 minutes (per §6).
- **Account recovery** (lost email access) is handled manually by Raymond. The recovery requires a video call or in-person identity verification and is logged in `auditLog.ts`. Recovery is the last resort; password reset is the default.
- **No security questions.** Security questions are weak (the answers are often on social media). The recovery path is email + manual verification.

## 4. Multi-factor authentication (MFA)

### 4.1 What requires MFA

The following access types require MFA without exception. The user cannot use the account productively until MFA is enrolled.

| Access type | Why | MFA required |
|---|---|---|
| **App `super_admin` role** | Highest privilege in the Solarpro app | Yes |
| **App `admin` role** | Org administration, customer data, billing | Yes |
| **Google Workspace admin** | Email, Drive, all productivity data | Yes |
| **GitHub org owner** | Source code, CI/CD, secrets | Yes |
| **Vercel team admin** | Deploy keys, env vars, DNS | Yes |
| **Render team admin** | SAM2 service config, env vars | Yes |
| **Neon admin / production DB** | Production database access | Yes |
| **Cloudflare account** | DNS, WAF rules | Yes |
| **Stripe dashboard** | Payment data, customer billing | Yes |
| **Resend** | Transactional email | Yes |
| **Sentry** | Production error data, may include PII | Yes |
| **1Password team admin** | All team credentials | Yes |
| **App standard user account** | Customer data, PII | Yes (recommended; required for any account that handles PII per role) |
| **App read-only account** | Demo, support | Recommended, not required |

A standard user account (not admin) is **encouraged** to enroll MFA, and is **required** to do so for any account that handles customer PII per the role. The 3-person team has MFA on every account today.

### 4.2 Supported MFA methods

In priority order. The first option is preferred; the last option is the fallback.

1. **WebAuthn / FIDO2** (preferred). Hardware security keys (YubiKey 5, Titan Key) or platform authenticators (Touch ID, Windows Hello, Android fingerprint). Phishing-resistant. Works with the Solarpro app, GitHub, Google Workspace, and most modern providers.
2. **TOTP** (preferred for software-only). RFC 6238. Apps: Google Authenticator, 1Password (built-in TOTP), Authy, Bitwarden. TOTP seeds are stored encrypted at rest using `MFA_ENCRYPTION_KEY` (AES-256-GCM, 32-byte key); see the Encryption & Key Management Policy (forthcoming) for the rotation cadence.
3. **Push notification** (acceptable). Duo, Google Prompt, GitHub Mobile. Works when the user is on a trusted device.
4. **SMS** (deprecated, last-resort fallback). Used only when the system does not support TOTP or WebAuthn, and only with James's documented approval per the exception process. The SS7 / SIM-swap risk of SMS is well-documented; we do not consider SMS MFA to be strong authentication on its own.

The MFA method is set per account, not per system. A user with a YubiKey registers it on every system that supports WebAuthn and uses it as the primary. TOTP is the fallback for systems that do not support WebAuthn. SMS is the last-resort fallback for systems that support neither.

### 4.3 MFA enrollment

- **First-time enrollment** is required before any account is productive. The enrollment happens in the first login session.
- **Adding a second factor** (a YubiKey as a backup, for example) is encouraged and is a one-time setup in 1Password. The backup factor is the recovery path if the primary factor is lost.
- **Lost factor recovery** uses one of:
  - A backup factor (the YubiKey #2 if YubiKey #1 is lost).
  - The 1Password TOTP backup codes (generated at MFA enrollment, stored in 1Password).
  - Manual identity verification with Raymond (last resort, video call or in-person).

A user who loses all factors is locked out and must complete the manual recovery with Raymond. The recovery is logged in `auditLog.ts` and is reviewed in the next monthly compliance digest.

### 4.4 MFA on production data paths

The Solarpro app's MFA requirements for production data paths:

- **`/api/admin/*`** (any route under `requireAdminApi()`): MFA required. The MFA challenge is enforced at the session-establishment step; the session is MFA-asserted for 8 hours, after which a re-MFA is required for any admin route.
- **`/api/surveys/*`** (any route that reads or writes customer surveys): MFA required for any user account that has the `admin` or `super_admin` platform role. Standard users do not need MFA on the survey path because they are authenticated by their session.
- **Neon DB access**: MFA is enforced at the Neon admin console (the database role is granted at the application layer, not at the Neon console, so direct DB access requires both the Neon credential and the Solarpro app credential).

The detailed MFA enforcement is in `lib/auth.ts` and `lib/adminAuth.ts`. The policy is the rule; the code is the enforcement; the UAR (Access Control Policy §3.4) is the verification.

## 5. Secrets and machine credentials

User passwords are one thing. Machine credentials — the secrets that authenticate Solarpro's services to each other and to vendors — are a different category with different rules.

### 5.1 The 32-character minimum

All machine credentials of high entropy must be at least **32 characters** of random data, generated by a cryptographically secure source (`crypto.randomBytes(32).toString('hex')` in Node, or the 1Password generator). The minimum applies to:

- `JWT_SECRET` (HS256 signing key)
- `MFA_ENCRYPTION_KEY` (AES-256-GCM key for TOTP seed encryption)
- `ADMIN_SECRET` (break-glass route secret)
- `SOLARPRO_HANDOFF_SECRET`
- `SURVEY_WEBHOOK_SECRET` and any other HMAC webhook secret
- `MIGRATE_SECRET`
- Any future high-entropy secret

The minimum is **enforced at runtime** in `getJwtSecret()` and the equivalents — the function throws on boot if the secret is shorter than 32 characters. The recent security quickwins PR added the runtime check; this policy codifies the rule so the check cannot be regressed. The check is verified by the weekly env-fingerprint run at `compliance/monitoring/env-fingerprint.json` (the `meets_32_char_min` field per secret).

### 5.2 Storage

- **GitHub Actions encrypted secrets** for CI/CD. The secret is injected at job time; it is not visible in the workflow logs.
- **Vercel / Render / Neon encrypted env vars** for production. The secret is set via the provider's dashboard; the value is not visible after entry (only "rotate" is exposed).
- **1Password team vault** for sharing with the team. The secret is in a 1Password item with restricted access.
- **Never** in source code, `.env` files committed to git, Slack, email, or screenshots.

### 5.3 Rotation

The rotation cadence:

| Secret | Cadence | Trigger |
|---|---|---|
| `JWT_SECRET` | Annually | On any suspected compromise; on departure of anyone with access |
| `MFA_ENCRYPTION_KEY` | Annually | On any suspected compromise |
| `ADMIN_SECRET` | Annually | On any use of the break-glass route; on departure of anyone with access |
| Webhook HMAC secrets | Annually | On any suspected compromise |
| `MIGRATE_SECRET` | Annually | On any suspected compromise |
| `STRIPE_SECRET_KEY` | Per Stripe's recommendation (rolling) | On any suspected compromise |
| DB passwords | Quarterly | On any departure with DB access |

The cadence is the floor. The actual rotation can be more frequent if there is a reason. The rotation is logged in `compliance/secrets-rotation/<secret>-<date>.md` with the actor, the date, and the reason.

The detailed rotation procedure is in the **Encryption & Key Management Policy** (forthcoming, Sprint 2). The policy documents the cadence; the procedure is the operational rule.

## 6. Account lockout

Failed authentication attempts are limited to prevent brute force. The lockout is **fail-closed in production** — the lockout is enforced even if the rate limiter is down (the 2026-08-12 incident is the trigger for the fail-closed rule; see the Change Management Policy §6).

### 6.1 The lockout rules

| Counter | Threshold | Action |
|---|---|---|
| Failed login attempts (consecutive) | 5 | 15-minute lockout on the account. Email notification to the user. Audit log entry. |
| Failed login attempts (cumulative in 1 hour) | 20 | 1-hour lockout on the account + alert to Raymond. |
| Failed login attempts (cumulative in 24 hours) | 50 | 24-hour lockout on the account + Sev2 incident review. |
| Failed MFA attempts (consecutive) | 5 | 15-minute lockout on MFA enrollment for the account. Audit log entry. |
| Failed password reset attempts | 5 within the reset window | 1-hour lockout on the password reset path for the account. |
| Failed admin API token validation (consecutive) | 10 | 15-minute lockout on the source IP + alert to Raymond. |

The lockout is per-account for user actions; the lockout is per-IP for token-validation failures. The lockout is cleared on successful authentication.

### 6.2 Lockout override

A lockout can be cleared by Raymond or Cody (technical lead) for legitimate reasons (the user is on a trip and has forgotten the password, the lockout is from a known-bad IP). The override is logged in `auditLog.ts` with the actor, the reason, and the duration. The override is reviewed in the next UAR.

A pattern of repeated lockouts on the same account is a signal that the account is under attack or that the user is misconfigured. The pattern is reported to Raymond in the weekly monitoring digest.

## 7. Session management

### 7.1 Session tokens

- **JWT (HS256)**: signed with `JWT_SECRET`. The payload includes the user ID, the role, the `iat` (issued-at), and the `exp` (expiration).
- **Standard user session**: **24 hours**. The user re-authenticates after 24 hours.
- **Admin user session**: **8 hours**. The admin re-authenticates after 8 hours. The 8-hour cap is enforced at `middleware.ts` and is one of the SOC 2 evidence items.
- **MFA-asserted session**: 8 hours for any route under `requireAdminApi()`. The session is established with both password and MFA; the MFA-asserted flag is checked on every admin route call.
- **Refresh tokens**: 30 days. The refresh token is rotated on each use; the old token is invalidated. The refresh token is bound to the device fingerprint (user-agent + IP subnet) and is invalidated on a fingerprint change.

### 7.2 Idle timeout

- **Admin sessions**: 30 minutes of inactivity. The session is invalidated; the admin re-authenticates to resume.
- **Standard user sessions**: 8 hours of inactivity. The session is invalidated; the user re-authenticates to resume.
- **API tokens (machine credentials)**: no idle timeout (the token is short-lived by design — 1 hour for Vercel deploy tokens, 24 hours for GitHub Actions tokens).

### 7.3 Re-authentication for sensitive operations

The following operations require a fresh authentication (password or MFA re-entry) within the prior 5 minutes, regardless of session validity:

- Changing the user's own password.
- Changing the user's own MFA factor.
- Granting a new role to another user.
- Accessing customer PII for an organization the user is not a member of.
- Initiating a production database migration.
- Using a break-glass route (`/api/admin/debug/auth-status`, `/api/admin/repair-account`).
- Rotating a machine credential.
- Deleting a customer account.
- Exporting a customer PII dataset.

The re-authentication window is enforced at the route handler. The route returns HTTP 401 with a `reauth_required: true` flag if the re-auth is missing; the client triggers the re-auth flow and retries the operation.

### 7.4 Session invalidation on password change

When a user changes their own password (or when a password is changed by an admin), all existing tokens issued before the change are rejected. The mechanism is the `password_changed_at` column on the `users` table (migration 094). A token with `iat < password_changed_at - 5s` is rejected by `lib/adminAuth.ts:152`. The 5-second skew accommodates clock drift.

When a user is terminated (per the Employee Onboarding & Offboarding Policy §6), `password_changed_at` is set to a future time, so all existing tokens are immediately rejected. The user record is marked `terminated_at`, not deleted, for audit.

## 8. Monitoring and alerting

The following events are alerted on in the weekly monitoring digest and the real-time Sentry feed:

- A lockout on an admin account.
- A lockout pattern (>20 failed attempts in 1 hour) on any account.
- An MFA-asserted session from a new device or new geography.
- A break-glass route use (`/api/admin/debug/auth-status` or `/api/admin/repair-account`).
- A password rotation or machine-credential rotation.
- A failed re-authentication for a sensitive operation.
- A session token reuse attempt (a token presented twice; should be impossible with rotation).

The events are stored in `auditLog.ts` and are reviewed by Raymond in the monthly compliance digest.

## 9. Enforcement

A violation of this policy is handled per the Information Security Policy §9 and the Code of Conduct §11:

- **A shared credential** (one user telling another their password, even for a "quick test"): formal warning + immediate password reset + 1Password audit.
- **MFA disabled on a privileged account** (even briefly, even "for testing"): access suspension until MFA is re-enabled + formal review.
- **A secret committed to source code**: secret rotated immediately, the commit is reverted, and a postmortem is filed.
- **A user who bypasses lockout without Raymond's approval**: formal warning.
- **A break-glass route use without a follow-up review within 24 hours**: access suspension + formal review.

## 10. The 3-person team reality

Today (2026-08-15) the team is James, Raymond, and Cody. The policy applies to all three:

- All three have **WebAuthn** (YubiKey 5 or platform authenticator) as the primary MFA on Google Workspace, GitHub, Vercel, Render, Neon, Cloudflare, Stripe, Resend, Sentry, 1Password, and the Solarpro app.
- All three have **TOTP** (1Password) as a backup factor on every system.
- All three have unique 16+ character passphrases for every system, generated by 1Password, never reused.
- All three have completed the security primer and the annual refresher (Security Awareness & Training Policy §4, §5).

The team scales linearly. At 5 people, the same rule applies. At 10, the LMS tracks the training; the technical rule is the same. The 32-character machine-credential rule is enforced at runtime and is independent of team size.

## 11. Related documents

- `compliance/policies/01-information-security.md` — foundation policy.
- `compliance/policies/02-acceptable-use.md` — credential hygiene.
- `compliance/policies/03-access-control.md` — provisioning, the 24h deprovisioning rule, the 90-day admin expiry.
- `compliance/policies/05-incident-response.md` — what to do when an authentication is compromised.
- `compliance/policies/12-employee-onboarding-offboarding.md` — the day-1 enrollment, the offboarding revocation.
- `compliance/policies/13-security-awareness-training.md` — the training that reinforces this policy.
- `compliance/CONTROL_MATRIX.md` — CC6.1, A.5.17, A.8.5, A.8.24 evidence rows.
- `lib/auth.ts`, `lib/adminAuth.ts` — the runtime enforcement of §3, §4, §6, §7.
- `app/api/auth/register/route.ts` — the registration-time Zod schema and breach checks.
- `compliance/SECURITY_ADVISORY_DEPS.md` — the dependency advisory that drives secret-rotation triggers.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 32-char secret minimum (recent security quickwins PR), the 12+ char password rule (longstanding in `app/api/auth/register/route.ts`), the MFA matrix (longstanding for admin), and the session / lockout / re-auth rules. Pulls the rules that were previously embedded in code into a single audit-ready document. |
