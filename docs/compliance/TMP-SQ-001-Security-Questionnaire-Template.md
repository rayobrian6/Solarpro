# SolarPro Security Questionnaire Response Template

**Document ID:** TMP-SQ-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Purpose:** Standardized responses for enterprise customer security questionnaires

---

## Company Overview

| Field | Response |
|-------|----------|
| Company Name | SolarPro |
| Product/Service | Solar project management and design platform |
| Hosting Provider | Vercel (serverless functions, CDN) |
| Database Provider | Neon (serverless PostgreSQL) |
| Data Center Regions | US (primary), EU (available) |
| Security Contact | security@solarpro.com |

---

## Access Control

**Q: How is user access controlled?**

SolarPro implements role-based access control (RBAC) with five defined roles: super_admin, admin, staff, crew_member, and homeowner. Access is granted on a least-privilege basis — users receive only the permissions required for their role. Role assignments are managed in the database and enforced server-side in every API route. Administrative access requires multi-factor authentication (TOTP-based MFA).

**Q: How are user accounts provisioned and deprovisioned?**

Accounts are provisioned via a formal request process requiring manager approval (documented in CHK-ONB-001). Offboarding follows a checklist (CHK-OFB-001) that ensures all access is revoked within 4 hours of employment termination for admin roles and 24 hours for other roles. Dormant accounts (90+ days of inactivity) are disabled during quarterly access reviews.

**Q: Is multi-factor authentication (MFA) supported?**

Yes. SolarPro enforces TOTP-based MFA for all admin and staff accounts per our Password & Authentication Policy (POL-SEC-009). MFA uses RFC 6238-compliant TOTP with AES-256-GCM encrypted secret storage. Recovery codes are one-way hashed (SHA-256) and single-use. MFA is optional but available for crew_member and homeowner roles.

**Q: How are privileged accounts managed?**

Privileged accounts (super_admin, admin) require MFA, have 8-hour session timeouts, are limited to approved personnel, and are reviewed quarterly. Privileged access requires documented business justification. Break-glass access is available for emergencies with post-incident review requirements.

---

## Data Protection

**Q: How is data encrypted at rest?**

Application-level encryption uses AES-256-GCM for Tier 1 (Restricted) and Tier 2 (Confidential) data, including MFA secrets and sensitive configuration. Platform-managed encryption is provided by Neon (PostgreSQL, AES-256), Vercel (environment variables, encrypted at rest), and Google Cloud Storage (AES-256). See POL-SEC-010 for full details.

**Q: How is data encrypted in transit?**

All communications use TLS 1.2 or higher. HTTP Strict Transport Security (HSTS) is enforced. Database connections use SSL. API communications with third-party services use HTTPS. See POL-SEC-010 §3 for approved cipher suites.

**Q: What is your data classification scheme?**

SolarPro uses a four-tier classification: Restricted (Tier 1 — encryption keys, MFA secrets, financial data), Confidential (Tier 2 — PII, project data, proposals), Internal (Tier 3 — internal communications, documentation), and Public (Tier 4 — marketing, public docs). Each tier has specific handling, storage, and disposal requirements per POL-SEC-004.

**Q: Do you support data export and deletion requests?**

Yes. SolarPro provides GDPR/CCPA-compliant data export (right-to-access) and data deletion (right-to-delete) APIs. Data export returns all user data in JSON format. Data deletion includes a 30-day grace period and respects 7-year financial record retention obligations. See `/api/privacy/export-data` for implementation.

---

## Infrastructure Security

**Q: Where is customer data stored?**

Customer data is stored in Neon PostgreSQL (US region, SOC 2 Type II certified). File attachments are stored in Google Cloud Storage (US region, ISO 27001 certified). Application code runs on Vercel's serverless infrastructure (US, SOC 2 Type II and ISO 27001 certified). No customer data is stored on employee devices or on-premises servers.

**Q: What is your vulnerability management process?**

SolarPro conducts automated dependency vulnerability scanning. A 76-phase security audit was completed, identifying and fixing 40+ vulnerabilities. Critical vulnerabilities are patched within 24 hours, high within 7 days, and medium within 30 days. See POL-SEC-006 for change management controls.

**Q: How are API endpoints protected?**

All API endpoints require authentication (JWT session cookie). Rate limiting is enforced on 37+ endpoint categories using Upstash Redis. CSRF protection is applied to all state-changing endpoints. Admin routes require additional role verification (database-confirmed). MFA is enforced for privileged operations. See the rate limiter module for specific limits.

**Q: Do you have a web application firewall (WAF)?**

Vercel provides DDoS protection and bot mitigation at the edge layer. Application-level protections include rate limiting, input validation (Zod schemas), SQL injection prevention (parameterized queries via Neon), XSS prevention (React's built-in escaping), and CSRF protection.

---

## Incident Response

**Q: Do you have an incident response plan?**

Yes. SolarPro maintains a 4-tier incident response plan (POL-SEC-005) with defined severity levels (Critical, High, Medium, Low), response team roles, 5-phase process (Detect, Contain, Eradicate, Recover, Post-Mortem), communication procedures, and an incident register. Critical incidents target 1-hour response time.

**Q: How are security incidents communicated?**

Affected customers are notified within 72 hours for incidents involving their data (per GDPR Article 33). Internal notifications follow a defined escalation path. A status page is maintained for service availability. Incident post-mortems are completed within 5 business days.

**Q: Do you conduct post-incident reviews?**

Yes. Every Medium or higher incident requires a formal post-mortem within 5 business days. Post-mortems document root cause, timeline, impact, and corrective actions. Corrective actions are tracked to completion. See POL-SEC-005 §7 for the post-mortem template.

---

## Business Continuity

**Q: What is your business continuity plan?**

SolarPro maintains a Business Continuity and Disaster Recovery plan (POL-SEC-011) with defined Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO) for each system tier. Critical systems have RTO of 4 hours and RPO of 1 hour. Backups are automated and tested monthly. See POL-SEC-011 for full details.

**Q: What is your backup strategy?**

Neon PostgreSQL provides point-in-time recovery (PITR) with continuous WAL archiving. Google Cloud Storage provides 11 nines of durability with multi-region redundancy. Application configuration is version-controlled in Git. Backup restoration is tested monthly. See POL-SEC-011 §6.

---

## Compliance & Audit

**Q: What compliance certifications do you hold?**

SolarPro is currently preparing for SOC 2 Type I audit with all Trust Services Criteria controls implemented. ISO 27001 preparation is in progress with the ISMS framework established. HIPAA is not applicable (no Protected Health Information is processed).

**Q: Do you conduct security audits?**

Yes. SolarPro completed a comprehensive 76-phase security audit in 2025, identifying and remediating 40+ vulnerabilities. Ongoing security reviews are conducted as part of the change management process (POL-SEC-006). Quarterly access reviews are performed per POL-SEC-003 §6.1.

**Q: Can you provide a SOC 2 report?**

SolarPro is in the pre-audit preparation phase. We expect to engage a CPA firm for SOC 2 Type I assessment in late 2025, with Type II (6-month evidence period) to follow. All controls are currently implemented and generating audit evidence.

---

## Sub-Processors

**Q: What sub-processors do you use?**

SolarPro uses the following sub-processors, all with SOC 2 or ISO 27001 certifications: Vercel (hosting), Neon (database), Stripe (payments), Upstash (rate limiting), Sentry (monitoring), Anthropic (AI), OpenAI (AI), Resend (email), and Google Cloud (storage). A detailed sub-processor register (VND-001) is maintained and available upon request.

**Q: Do you have DPAs with your sub-processors?**

SolarPro maintains Data Processing Agreements with all sub-processors that handle customer data. DPA status is tracked in the sub-processor register (VND-001).

---

## Employee Security

**Q: Do employees receive security training?**

Yes. All employees complete security orientation during onboarding covering: Information Security Policy, Acceptable Use Policy, Data Classification, and Incident Response procedures. Training is documented and acknowledged. See CHK-ONB-001 for the full onboarding checklist.

**Q: Are background checks performed?**

Background check policies are determined based on role requirements and local regulations. Admin and privileged access roles require additional verification.

---

*Template version: 1.0 | Last updated: July 2025*
