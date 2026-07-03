# SolarPro External Platform MFA Enforcement Requirements

**Document ID:** REF-MFA-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Policy Reference:** POL-SEC-009 (Password & Authentication Policy) §4.2

---

## Purpose

Per POL-SEC-009 §4.2, MFA must be enabled on ALL external platforms where SolarPro team members have access. This document lists each platform, its MFA capabilities, and the enforcement status.

---

## Platform MFA Status

| Platform | MFA Available | MFA Enforced | Approved Methods | Owner | Notes |
|----------|:-------------:|:------------:|------------------|-------|-------|
| **Vercel** | ✅ | ❌ Pending | TOTP, hardware key | super_admin | Must enable in Vercel Dashboard → Settings → Authentication |
| **Neon** | ✅ | ❌ Pending | TOTP | super_admin | Neon console access is limited; enable via Neon Dashboard |
| **Sentry** | ✅ | ❌ Pending | TOTP, SMS (not approved) | admin+ | Enable in Sentry → Settings → Two-Factor |
| **GitHub** | ✅ | ❌ Pending | TOTP, hardware key, passkey | admin+ | Enable in GitHub → Settings → Security → 2FA |
| **Stripe** | ✅ | ✅ (built-in) | SMS + TOTP | super_admin | Stripe requires 2FA for dashboard access |
| **Upstash** | ✅ | ❌ Pending | TOTP | super_admin | Enable in Upstash Console → Settings |
| **Google Cloud** | ✅ | ❌ Pending | TOTP, hardware key, phone prompt | super_admin | Enforce via Org Policy: constraints/iam.disableServiceAccountKeyCreation |
| **Resend** | ✅ | ❌ Pending | TOTP | super_admin | Enable in Resend Dashboard → Settings |
| **Anthropic Console** | ✅ | ❌ Pending | TOTP | super_admin | Enable in Anthropic Console → Settings |

---

## Enforcement Actions Required

### Immediate (Q3 2025)

1. **Vercel** — Enable "Require 2FA" in team settings for all members
2. **GitHub** — Enable organization-level 2FA requirement for all members
3. **Sentry** — Enable 2FA requirement in organization auth settings

### Short-term (Q4 2025)

4. **Neon** — Enable 2FA on all Neon console accounts
5. **Upstash** — Enable 2FA on all Upstash console accounts
6. **Google Cloud** — Enforce org policy requiring 2FA for all IAM users
7. **Resend** — Enable 2FA on Resend dashboard accounts
8. **Anthropic** — Enable 2FA on Anthropic console accounts

---

## Verification Process

After enabling MFA on each platform, verify enforcement:

1. **Attempt login without MFA** — should be blocked or prompted for 2FA
2. **Screenshot enforcement settings** — retain as SOC 2 evidence
3. **Document enforcement date** — add to this table's "MFA Enforced" column
4. **Quarterly review** — verify MFA is still enforced during quarterly access reviews (TMP-ACC-001)

---

## Shared/Service Accounts

The following services are accessed via server-side API keys only (no human dashboard access required):

- **Stripe** — Server-side API only (`STRIPE_SECRET_KEY`). Dashboard access limited to super_admin with MFA.
- **Upstash Redis** — Server-side only (`UPSTASH_REDIS_REST_URL`). Console access limited to super_admin.
- **Anthropic/OpenAI** — Server-side only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). No console access needed.
- **Resend** — Server-side only (`RESEND_API_KEY`). Dashboard access limited to super_admin.
- **Google Cloud Storage** — Server-side via service account (`GCS_SERVICE_ACCOUNT_KEY`). No human access needed.

**Policy:** No API keys should be shared with individual team members. All API access is server-side via environment variables.

---

*Last reviewed: July 2025 | Next review: October 2025 (quarterly per POL-SEC-003 §6.1)*
