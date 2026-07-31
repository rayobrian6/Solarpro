# Acceptable Use Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-002 — Acceptable Use Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro employees, contractors, and any party granted access to Solarpro systems, data, or networks |

---

## 1. Purpose

This policy tells you what you can and cannot do with Solarpro's systems, data, and devices. It exists so the auditor (and you, six months from now) has a written, signed answer to the question "what were the rules?"

If something in this policy prevents you from doing your job, ask first. Don't work around it.

## 2. Scope

Applies to everyone with access to anything Solarpro owns or pays for:

- **Work accounts**: Google Workspace, GitHub, Vercel, Render, Neon, Stripe dashboard, Resend, Cloudflare, Sentry, any vendor portal.
- **Work devices**: laptops, phones, and any device used to access work systems.
- **Work data**: source code, customer data, internal documents, credentials, API keys, anything stored in Solarpro-controlled systems.
- **Personal devices** if used to access work systems or work data (BYOD — see §6).

## 3. General principles

Three rules cover most of what you need to know:

1. **Use work systems for work.** Personal use is fine if it's incidental and doesn't consume meaningful resources, store personal data on work systems, or violate anything in §5. A few personal emails a day is fine. Running a side business on the company GitHub is not.
2. **Don't exfiltrate.** Customer data, source code, and credentials stay inside Solarpro systems. They do not go to personal email, personal cloud drives, personal repos, or chat tools outside the work stack.
3. **When in doubt, ask Raymond.** The cost of a 60-second question is much lower than the cost of a security incident.

## 4. Account and credential hygiene

- **Passwords** must meet the requirements in the Access Control Policy (12+ characters, unique per system, stored in 1Password). No exceptions for shared or "service" accounts.
- **MFA** is required on every work account that supports it. No "I'll add it later." SMS-based MFA is allowed only when TOTP or hardware keys are not supported.
- **Don't share credentials.** Ever. Not with coworkers, not with vendors, not with AI assistants. Use delegated access (e.g. GitHub org membership, Google Workspace delegation) instead.
- **Don't reuse work passwords** on personal accounts. If a personal account you used the same password on gets breached, change the work password immediately and tell Raymond.
- **Session management**: lock your screen when you walk away. The OS lock is enough.

## 5. Prohibited activities

The following are prohibited on or with Solarpro systems, regardless of intent:

- Sharing credentials, API keys, MFA seeds, or session cookies with anyone, including other Solarpro team members, in any channel (chat, email, ticket, video call, screenshot).
- Installing unauthorized software on work devices. If you need something, ask Cody (technical lead) — it will get approved if it has a business reason.
- Bypassing security controls. Disabling antivirus, modifying `lib/auth.ts` to skip rate limiting, using a personal VPN to circumvent IP rules, etc. The fix for an annoying control is to ask for an exception, not to bypass it.
- Disabling MFA on any account, including your own, "for testing." Testing is fine. Leaving it disabled is not.
- Storing customer PII locally on laptops or personal cloud storage. PII lives in Neon.
- Sending customer data to AI tools (Claude, ChatGPT, Gemini, Copilot, etc.) for any purpose without a documented exception. The default is **no**. If you have a workflow need, see the Data Classification & Handling Policy §6.
- Using personal email, personal cloud drives, or personal messaging apps for work data.
- Connecting USB drives, phones, or other removable media to work devices for data transfer.
- Disabling structured logging or audit log emission to "clean up" output. Errors stay logged.
- Committing secrets (API keys, passwords, tokens) to source code. Use environment variables and GitHub Actions secrets. If you commit one by accident, rotate it immediately and tell Raymond.
- Using Solarpro systems to harass, threaten, or discriminate. (See the Code of Conduct, Sprint 2.)

## 6. Personal devices (BYOD)

Solarpro does not currently issue company phones. If you use a personal device for any of: checking work email, accessing the Solarpro admin panel, or joining work video calls from a non-work device:

- The device must have a screen lock (PIN, biometric, or password).
- The device must support remote wipe (Find My iPhone / Android Find My Device enabled).
- You must not store customer PII locally. Use the web app, not a downloaded copy.
- Solarpro does not currently install an MDM agent on personal devices. If a security incident requires reviewing personal-device activity, Raymond will request the minimum data needed and document the request.

## 7. Remote work

Remote work is the default at Solarpro. From a security standpoint:

- Use a **password-protected Wi-Fi network**. Public Wi-Fi (coffee shops, hotels) is fine for browsing but **not** for accessing production systems. Use a personal hotspot or wait until you're on a trusted network.
- Working from a coworking space is fine. Shoulder-surfing risk is real — use a privacy screen if you're around strangers.
- Do not print customer data. If you must work with a paper copy (rare), shred it when done.

## 8. Software installation and procurement

- **Approved software** (the current default stack: VS Code or your editor of choice, Slack, Notion if used, 1Password, Google Workspace apps, GitHub Desktop if desired) installs without asking.
- **New software** that touches customer data, source code, or production systems needs Raymond's approval and a vendor review entry in `compliance/vendors.csv` if it's a new vendor. This includes AI tools.
- **Open-source dependencies** go through the dependency review in CI (`npm audit` runs on every PR; high-severity advisories fail the build).

## 9. Reporting violations and concerns

If you see something that might be a security issue, say something. Channels, in order of speed:

1. **Raymond directly** (Slack DM, email, or phone) for anything time-sensitive.
2. **James** if Raymond is unreachable for more than an hour on a Sev1-class issue.
3. **`security@solarpro.app`** for non-urgent or anonymous reports.

There is no penalty for reporting a suspected issue that turns out to be a false alarm. There **is** a problem with not reporting one you noticed.

## 10. Enforcement

This policy is enforced by the Access Control Policy's revocation procedures (for credential and access violations) and by HR review (for harassment, discrimination, or repeated non-compliance). See the Information Security Policy §9 for the full escalation.

## 11. Related documents

- `compliance/policies/01-information-security.md` — foundation policy.
- `compliance/policies/03-access-control.md` — provisioning, MFA, session, offboarding.
- `compliance/policies/04-data-classification-handling.md` — what's PII, where it can go.
- `compliance/policies/05-incident-response.md` — what to do if something goes wrong.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. |
