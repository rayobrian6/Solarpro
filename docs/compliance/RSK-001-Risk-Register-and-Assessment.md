# SolarPro Risk Register & Assessment

**Document ID:** RSK-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Quarterly  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Risk Assessment Methodology

### 1.1 Framework

SolarPro uses a qualitative risk assessment methodology aligned with ISO 27005 and NIST SP 800-30. Each risk is evaluated on two dimensions: **Likelihood** (probability of occurrence) and **Impact** (severity of consequences). The composite risk level is determined by the risk matrix below.

### 1.2 Likelihood Scale

| Level | Rating | Description | Frequency Guidance |
|-------|--------|-------------|-------------------|
| 1 | Rare | Unlikely to occur; no history in industry | <1% annual probability |
| 2 | Unlikely | Could occur but not expected; rare industry examples | 1–5% annual probability |
| 3 | Possible | May occur; has occurred in similar organizations | 5–20% annual probability |
| 4 | Likely | Expected to occur; industry common | 20–60% annual probability |
| 5 | Almost Certain | Expected to occur multiple times; already happening | >60% annual probability |

### 1.3 Impact Scale

| Level | Rating | Financial Impact | Operational Impact | Reputational Impact |
|-------|--------|-----------------|-------------------|---------------------|
| 1 | Negligible | <$1K | Minor inconvenience; no service disruption | No external awareness |
| 2 | Minor | $1K–$10K | Brief degradation; resolved within hours | Limited customer inquiries |
| 3 | Moderate | $10K–$50K | Significant disruption; hours to days recovery | Customer complaints; social media mentions |
| 4 | Major | $50K–$250K | Extended outage; multi-day recovery | Media coverage; customer churn |
| 5 | Catastrophic | >$250K | Business continuity threatened; weeks recovery | National media; regulatory action; existential threat |

### 1.4 Risk Matrix

|  | **Impact 1** | **Impact 2** | **Impact 3** | **Impact 4** | **Impact 5** |
|--|-------------|-------------|-------------|-------------|-------------|
| **Likelihood 5** | Medium | High | Critical | Critical | Critical |
| **Likelihood 4** | Low | Medium | High | Critical | Critical |
| **Likelihood 3** | Low | Medium | High | High | Critical |
| **Likelihood 2** | Low | Low | Medium | High | High |
| **Likelihood 1** | Low | Low | Low | Medium | High |

### 1.5 Risk Treatment Options

| Treatment | Description | When to Apply |
|-----------|-------------|---------------|
| **Mitigate** | Implement controls to reduce likelihood or impact | Preferred for Medium and above risks |
| **Transfer** | Shift risk to third party (insurance, contractual) | When mitigation cost exceeds transfer cost |
| **Accept** | Acknowledge risk without additional controls | When risk is Low or treatment cost exceeds impact |
| **Avoid** | Eliminate the risk by not performing the activity | When risk exceeds business benefit |

## 2. Risk Register

### RSK-001: Unauthorized Data Access via Compromised Credentials

| Field | Value |
|-------|-------|
| **Category** | Authentication |
| **Description** | Attacker gains access to SolarPro systems by compromising user credentials (phishing, credential stuffing, brute force) |
| **Likelihood** | 4 (Likely) — Credential attacks are industry-common |
| **Impact** | 4 (Major) — Customer PII exposure; regulatory notification |
| **Risk Level** | **Critical** |
| **SOC 2 TSC** | CC6.1 (Logical Access), CC6.2 (Access Removal) |
| **ISO 27001** | A.9.2.2, A.9.4.2 |
| **Current Controls** | JWT HS256 auth, timing-safe comparison, rate limiting on some routes |
| **Gap** | No MFA enforcement for admin/staff; no breached password screening; incomplete rate limiting |
| **Treatment** | Mitigate: Enforce MFA for admin/staff; implement breached password check; standardize rate limiting |
| **Target Risk Level** | Medium (Likelihood 2 × Impact 4 = High → mitigated to Medium with MFA) |

### RSK-002: SQL Injection / Database Compromise

| Field | Value |
|-------|-------|
| **Category** | Application Security |
| **Description** | Attacker exploits SQL injection vulnerability to read, modify, or delete database contents |
| **Likelihood** | 2 (Unlikely) — Parameterized queries used; 76-phase audit fixed injection vulns |
| **Impact** | 5 (Catastrophic) — Full database compromise; all customer data exposed |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.1 (Logical Access), CC7.1 (System Boundaries) |
| **ISO 27001** | A.14.2.5, A.14.2.8 |
| **Current Controls** | Parameterized queries via pg/neon driver; input validation; security audit completed |
| **Gap** | Need ongoing vulnerability scanning; WAF not in place |
| **Treatment** | Mitigate: Automated SQL injection testing in CI; Vercel WAF evaluation |
| **Target Risk Level** | Medium |

### RSK-003: Cloud Provider (Vercel) Outage

| Field | Value |
|-------|-------|
| **Category** | Availability |
| **Description** | Vercel platform outage renders SolarPro application unavailable |
| **Likelihood** | 3 (Possible) — Vercel has had regional outages |
| **Impact** | 4 (Major) — Complete service unavailability for duration of outage |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC7.3 (Recovery), A1.2 (Availability) |
| **ISO 27001** | A.12.3, A.17.1 |
| **Current Controls** | Vercel global edge network; automatic regional failover |
| **Gap** | No alternative deployment platform ready; no status page |
| **Treatment** | Mitigate: Document Vercel CLI deployment fallback; maintain status page; evaluate Cloudflare Pages as backup |
| **Target Risk Level** | Medium |

### RSK-004: Database (Neon) Data Loss or Corruption

| Field | Value |
|-------|-------|
| **Category** | Availability / Integrity |
| **Description** | Neon PostgreSQL data loss due to corruption, accidental deletion, or Neon platform failure |
| **Likelihood** | 2 (Unlikely) — Neon provides HA and replication |
| **Impact** | 5 (Catastrophic) — Total data loss if backups fail |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC7.3 (Recovery), A1.2 (Availability) |
| **ISO 27001** | A.12.3, A.17.1 |
| **Current Controls** | Neon PITR (7-day WAL); Neon automatic HA |
| **Gap** | No independent backup outside Neon; PITR limited to 7 days |
| **Treatment** | Mitigate: Implement daily pg_dump to GCS; extend PITR retention; quarterly restore testing |
| **Target Risk Level** | Medium |

### RSK-005: Third-Party API Key Exposure

| Field | Value |
|-------|-------|
| **Category** | Secret Management |
| **Description** | API keys (Stripe, Anthropic, OpenAI, etc.) exposed via code commit, logs, or misconfiguration |
| **Likelihood** | 3 (Possible) — Common developer error |
| **Impact** | 4 (Major) — Financial loss via Stripe; data exfiltration via AI APIs; service abuse |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.1 (Logical Access), CC6.7 (Data Protection) |
| **ISO 27001** | A.10.1.1, A.14.1.3 |
| **Current Controls** | .env.example pattern; git-ignored .env files; GitHub secret scanning enabled |
| **Gap** | No pre-commit hook for secret detection; no automated scan of git history |
| **Treatment** | Mitigate: Add git-secrets pre-commit hook; automated TruffleHog scan in CI; key rotation schedule |
| **Target Risk Level** | Low |

### RSK-006: Insider Threat — Malicious or Negligent Employee

| Field | Value |
|-------|-------|
| **Category** | Access Control |
| **Description** | Employee or contractor with authorized access intentionally or negligently causes data breach, data theft, or system damage |
| **Likelihood** | 2 (Unlikely) — Small team; trusted personnel |
| **Impact** | 4 (Major) — Data exfiltration; system sabotage; IP theft |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.1, CC6.2, CC6.3 (Access Removal) |
| **ISO 27001** | A.9.2.1, A.9.2.5, A.9.2.6 |
| **Current Controls** | RBAC with 5 roles; PR review required; offboarding procedure documented |
| **Gap** | No break-glass audit; no DLP; incomplete audit logging |
| **Treatment** | Mitigate: Tamper-evident audit logging; quarterly access reviews; DLP evaluation; break-glass access with audit |
| **Target Risk Level** | Medium |

### RSK-007: DDoS / Application Layer Flood

| Field | Value |
|-------|-------|
| **Category** | Availability |
| **Description** | Distributed denial-of-service attack overwhelms SolarPro application or API endpoints |
| **Likelihood** | 3 (Possible) — DDoS is common for SaaS applications |
| **Impact** | 3 (Moderate) — Temporary unavailability; Vercel provides DDoS protection |
| **Risk Level** | **High** |
| **SOC 2 TSC** | A1.2 (Availability) |
| **ISO 27001** | A.12.3, A.17.1 |
| **Current Controls** | Vercel edge network absorbs volumetric attacks; rate limiting on some routes |
| **Gap** | Inconsistent rate limiting across all API routes; no rate limit monitoring |
| **Treatment** | Mitigate: Standardize rate limiting on all routes; implement rate limit alerting; evaluate Cloudflare DDoS for API |
| **Target Risk Level** | Low |

### RSK-008: Insecure Direct Object Reference (IDOR)

| Field | Value |
|-------|-------|
| **Category** | Application Security |
| **Description** | User accesses data belonging to another user or organization by manipulating object references in API requests |
| **Likelihood** | 3 (Possible) — Common OWASP vulnerability |
| **Impact** | 4 (Major) — Cross-tenant data exposure; customer trust breach |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.1, CC6.3 |
| **ISO 27001** | A.9.4.1, A.14.1.2 |
| **Current Controls** | Organization-scoped queries; auth middleware on routes |
| **Gap** | Need systematic IDOR testing; need tenant isolation verification |
| **Treatment** | Mitigate: Add automated IDOR testing; enforce organization context on every query; add tenant isolation middleware |
| **Target Risk Level** | Medium |

### RSK-009: Vendor Security Breach (Supply Chain)

| Field | Value |
|-------|-------|
| **Category** | Vendor Risk |
| **Description** | Security breach at a critical vendor (Neon, Vercel, Stripe) exposes SolarPro data stored on or processed by the vendor |
| **Likelihood** | 2 (Unlikely) — Major cloud vendors have strong security |
| **Impact** | 5 (Catastrophic) — Full customer data exposure via vendor |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC9.2 (Vendor Risk) |
| **ISO 27001** | A.15.1.1, A.15.1.2 |
| **Current Controls** | Vercel (SOC 2 certified); Stripe (PCI DSS Level 1); Neon (SOC 2 working toward) |
| **Gap** | No vendor security questionnaire on file; no breach notification SLA in contracts |
| **Treatment** | Mitigate: Complete vendor risk assessments per POL-SEC-008; execute DPAs with 72-hour breach notification; verify certifications annually |
| **Target Risk Level** | Medium |

### RSK-010: Inadequate Audit Logging

| Field | Value |
|-------|-------|
| **Category** | Monitoring |
| **Description** | Insufficient audit logs prevent investigation of security incidents, compliance verification, and forensic analysis |
| **Likelihood** | 4 (Likely) — Current logging is basic and not tamper-evident |
| **Impact** | 3 (Moderate) — Cannot prove compliance; cannot investigate incidents effectively |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC7.2 (Monitoring), CC7.3 (Incident Response) |
| **ISO 27001** | A.12.4.1, A.12.4.2, A.12.4.3 |
| **Current Controls** | Sentry error logging; basic console logging |
| **Gap** | No centralized audit log; no tamper-evidence; no access event logging; no retention policy enforcement |
| **Treatment** | Mitigate: Implement centralized tamper-evident audit logging (hash-chained); log all auth events, data access, admin actions, config changes |
| **Target Risk Level** | Low |

### RSK-011: Data Privacy Violation (GDPR/CCPA)

| Field | Value |
|-------|-------|
| **Category** | Compliance |
| **Description** | SolarPro fails to comply with data privacy regulations (GDPR, CCPA) resulting in regulatory fines and customer lawsuits |
| **Likelihood** | 3 (Possible) — Privacy compliance requires active effort |
| **Impact** | 4 (Major) — Regulatory fines up to 4% of revenue; lawsuits; reputational damage |
| **Risk Level** | **High** |
| **SOC 2 TSC** | P1.1 (Privacy), CC6.7 (Data Protection) |
| **ISO 27001** | A.18.1.1, A.18.1.4 |
| **Current Controls** | Privacy policy page; terms of service page |
| **Gap** | No data export API; no right-to-delete process; no cookie consent; no data processing agreements with all vendors |
| **Treatment** | Mitigate: Implement data export API; implement right-to-delete endpoint; add cookie consent; execute DPAs; document data flows |
| **Target Risk Level** | Medium |

### RSK-012: Insecure AI Data Processing

| Field | Value |
|-------|-------|
| **Category** | Data Protection |
| **Description** | Confidential customer data is sent to AI APIs (Anthropic, OpenAI) without zero-data-retention, resulting in data exposure to third-party AI providers |
| **Likelihood** | 3 (Possible) — AI integration exists; depends on API configuration |
| **Impact** | 3 (Moderate) — Customer data processed by third party without contractual protection |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.7, CC9.2 |
| **ISO 27001** | A.10.1.1, A.15.1.1 |
| **Current Controls** | API calls to Anthropic/OpenAI; .env configuration |
| **Gap** | Need to verify zero-data-retention flags are enabled; need DPA with AI providers; need to audit what data is sent to AI |
| **Treatment** | Mitigate: Enable zero-data-retention on AI APIs; audit prompts for PII; execute DPAs; implement PII scrubbing before AI calls |
| **Target Risk Level** | Low |

### RSK-013: Cross-Site Scripting (XSS)

| Field | Value |
|-------|-------|
| **Category** | Application Security |
| **Description** | Attacker injects malicious scripts into SolarPro pages viewed by other users, enabling session theft or data exfiltration |
| **Likelihood** | 2 (Unlikely) — React/Next.js provides built-in XSS protection |
| **Impact** | 3 (Moderate) — Session hijack; data theft; defacement |
| **Risk Level** | **Medium** |
| **SOC 2 TSC** | CC6.1, CC7.1 |
| **ISO 27001** | A.14.2.5 |
| **Current Controls** | React auto-escaping; Next.js CSP headers; security audit fixes |
| **Gap** | Need CSP header hardening; need XSS testing in CI |
| **Treatment** | Mitigate: Implement strict CSP headers; add XSS testing to CI pipeline |
| **Target Risk Level** | Low |

### RSK-014: Insufficient Change Management

| Field | Value |
|-------|-------|
| **Category** | Operational |
| **Description** | Unauthorized or poorly reviewed changes to production cause outages, data corruption, or security vulnerabilities |
| **Likelihood** | 3 (Possible) — Without enforcement, process can be bypassed |
| **Impact** | 3 (Moderate) — Service degradation; potential data issues |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC8.1 (Change Management) |
| **ISO 27001** | A.12.1.2, A.14.2.2 |
| **Current Controls** | GitHub PR workflow; branch protection documented; Vercel preview deployments |
| **Gap** | Branch protection rules may not be enforced; no change classification; no emergency change retrospective |
| **Treatment** | Mitigate: Verify GitHub branch protection is enforced; implement change classification per POL-SEC-006; add emergency change retrospective |
| **Target Risk Level** | Low |

### RSK-015: Lost or Stolen Device

| Field | Value |
|-------|-------|
| **Category** | Physical / Endpoint |
| **Description** | Employee laptop or mobile device containing SolarPro credentials or data is lost or stolen |
| **Likelihood** | 3 (Possible) — Common occurrence for remote teams |
| **Impact** | 2 (Minor) — Credential revocation limits exposure; no data stored locally (cloud-based) |
| **Risk Level** | **Medium** |
| **SOC 2 TSC** | CC6.2 (Access Removal) |
| **ISO 27001** | A.8.2.3, A.11.2.4 |
| **Current Controls** | Cloud-based systems (no local data); session tokens expire; MFA on accounts |
| **Gap** | No remote wipe policy; no device inventory |
| **Treatment** | Accept (current controls adequate); Mitigate: document device inventory; enable remote wipe for managed devices |
| **Target Risk Level** | Low |

### RSK-016: Incomplete Offboarding

| Field | Value |
|-------|-------|
| **Category** | Access Control |
| **Description** | Departing personnel retain access to SolarPro systems after departure, enabling unauthorized access or data theft |
| **Likelihood** | 3 (Possible) — Manual offboarding prone to missed systems |
| **Impact** | 3 (Moderate) — Former employee access; potential data theft |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC6.2 (Access Removal) |
| **ISO 27001** | A.9.2.6 |
| **Current Controls** | Offboarding procedure documented in POL-SEC-003 |
| **Gap** | No offboarding checklist implementation; no automated revocation |
| **Treatment** | Mitigate: Create offboarding checklist; automate access revocation where possible; quarterly access review catches stale accounts |
| **Target Risk Level** | Low |

### RSK-017: Regulatory / Legal Non-Compliance

| Field | Value |
|-------|-------|
| **Category** | Compliance |
| **Description** | SolarPro fails to meet regulatory requirements for data protection, consumer protection, or industry-specific regulations in jurisdictions where it operates |
| **Likelihood** | 3 (Possible) — Regulation landscape is evolving |
| **Impact** | 4 (Major) — Fines; legal action; operational restrictions |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC4.1, P1.1 |
| **ISO 27001** | A.18.1.1 |
| **Current Controls** | Privacy policy; terms of service; security audit completed |
| **Gap** | No formal compliance program; no regulatory tracking; no legal review cadence |
| **Treatment** | Mitigate: This compliance program; quarterly regulatory review; engage legal counsel for jurisdiction-specific requirements |
| **Target Risk Level** | Medium |

### RSK-018: Session Hijacking / Token Theft

| Field | Value |
|-------|-------|
| **Category** | Authentication |
| **Description** | Attacker steals session token (JWT) via XSS, network interception, or token leakage, gaining unauthorized access |
| **Likelihood** | 2 (Unlikely) — HTTPS enforced; HTTP-only cookies; React XSS protection |
| **Impact** | 3 (Moderate) — Unauthorized access until token expires; limited by role |
| **Risk Level** | **Medium** |
| **SOC 2 TSC** | CC6.1 |
| **ISO 27001** | A.9.4.2 |
| **Current Controls** | HTTP-only Secure cookies; SameSite=Strict; TLS enforced; JWT expiration |
| **Gap** | Session timeout not enforced for admin (8-hour absolute timeout); no concurrent session limit |
| **Treatment** | Mitigate: Implement session timeout enforcement per POL-SEC-009; add concurrent session limits; token rotation every 60 minutes |
| **Target Risk Level** | Low |

### RSK-019: Dependency Vulnerability (Software Supply Chain)

| Field | Value |
|-------|-------|
| **Category** | Application Security |
| **Description** | Vulnerability in a third-party npm package or library used by SolarPro is exploited by attackers |
| **Likelihood** | 4 (Likely) — npm ecosystem has frequent vulnerability disclosures |
| **Impact** | 3 (Moderate) — Depends on vulnerability; could range from minor to critical |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC7.1, CC7.2 |
| **ISO 27001** | A.14.2.1, A.14.2.5 |
| **Current Controls** | npm audit available; Dependabot likely enabled on GitHub |
| **Gap** | No automated vulnerability scanning in CI; no SBOM (Software Bill of Materials); no dependency review process |
| **Treatment** | Mitigate: Enable Dependabot on all repos; add npm audit to CI pipeline; generate SBOM; dependency review for new packages |
| **Target Risk Level** | Medium |

### RSK-020: Business Continuity Failure

| Field | Value |
|-------|-------|
| **Category** | Operational |
| **Description** | SolarPro cannot recover from a disaster (outage, data loss, attack) within defined RTO/RPO objectives due to untested or incomplete recovery procedures |
| **Likelihood** | 3 (Possible) — BCDR plan exists but untested |
| **Impact** | 4 (Major) — Extended outage; data loss beyond RPO; customer exodus |
| **Risk Level** | **High** |
| **SOC 2 TSC** | CC7.3, A1.2 |
| **ISO 27001** | A.17.1, A.17.2 |
| **Current Controls** | BCDR plan documented (POL-SEC-011); Vercel auto-deploy; Neon HA |
| **Gap** | No backup testing; no disaster recovery drill; no independent backup |
| **Treatment** | Mitigate: Implement daily pg_dump backup; quarterly restore test; annual BCDR tabletop exercise |
| **Target Risk Level** | Medium |

## 3. Risk Summary by Category

| Category | Count | Critical | High | Medium | Low |
|----------|-------|----------|------|--------|-----|
| Authentication | 2 | 1 | 0 | 1 | 0 |
| Application Security | 3 | 0 | 1 | 2 | 0 |
| Availability | 2 | 0 | 2 | 0 | 0 |
| Access Control | 2 | 0 | 2 | 0 | 0 |
| Data Protection | 1 | 0 | 1 | 0 | 0 |
| Compliance | 2 | 0 | 2 | 0 | 0 |
| Monitoring | 1 | 0 | 1 | 0 | 0 |
| Operational | 2 | 0 | 2 | 0 | 0 |
| Secret Management | 1 | 0 | 1 | 0 | 0 |
| Vendor Risk | 1 | 0 | 1 | 0 | 0 |
| Physical/Endpoint | 1 | 0 | 0 | 1 | 0 |
| **Total** | **20** | **1** | **13** | **4** | **0** |

## 4. SOC 2 Trust Services Criteria Mapping

| TSC | Risks Covered | Status |
|-----|--------------|--------|
| **CC6.1** — Logical and Physical Access Controls | RSK-001, RSK-002, RSK-006, RSK-008, RSK-013, RSK-018 | Gaps in MFA, rate limiting, audit logging |
| **CC6.2** — Access Removal | RSK-006, RSK-015, RSK-016 | Offboarding checklist needed |
| **CC6.3** — Access Authorization | RSK-008, RSK-016 | IDOR testing; access review cadence |
| **CC6.7** — Data Classification & Protection | RSK-005, RSK-011, RSK-012 | Data export API; AI data audit |
| **CC7.1** — System Boundaries | RSK-002, RSK-013, RSK-019 | WAF evaluation; dependency scanning |
| **CC7.2** — Monitoring & Detection | RSK-010, RSK-019 | Centralized audit logging needed |
| **CC7.3** — Incident Response & Recovery | RSK-003, RSK-004, RSK-020 | Backup testing; BCDR drills |
| **CC8.1** — Change Management | RSK-014 | Branch protection enforcement |
| **CC9.2** — Vendor Risk | RSK-009, RSK-012 | Vendor assessments; DPAs |
| **A1.2** — Availability | RSK-003, RSK-004, RSK-007, RSK-020 | Rate limiting; status page; backups |
| **P1.1** — Privacy | RSK-011, RSK-017 | Data export; cookie consent; DPAs |

## 5. Risk Treatment Priority

Risks are prioritized for treatment based on current risk level and treatment feasibility:

### Immediate (Q3 2025)

| Priority | Risk | Treatment | Effort |
|----------|------|-----------|--------|
| 1 | RSK-001 — Compromised Credentials | Enforce MFA for admin/staff | Code change |
| 2 | RSK-010 — Inadequate Audit Logging | Implement tamper-evident audit log | Code change |
| 3 | RSK-005 — API Key Exposure | Add pre-commit hooks; CI secret scanning | DevOps |
| 4 | RSK-016 — Incomplete Offboarding | Create offboarding checklist | Process |
| 5 | RSK-014 — Insufficient Change Management | Verify branch protection enforcement | Process |

### Short-Term (Q4 2025)

| Priority | Risk | Treatment | Effort |
|----------|------|-----------|--------|
| 6 | RSK-004 — Database Data Loss | Implement pg_dump backups to GCS | DevOps |
| 7 | RSK-011 — Privacy Violation | Data export API; cookie consent | Code change |
| 8 | RSK-019 — Dependency Vulnerability | Enable Dependabot; npm audit in CI | DevOps |
| 9 | RSK-008 — IDOR | Systematic IDOR testing; tenant isolation | Code change |
| 10 | RSK-007 — DDoS | Standardize rate limiting all routes | Code change |

### Medium-Term (Q1-Q2 2026)

| Priority | Risk | Treatment | Effort |
|----------|------|-----------|--------|
| 11 | RSK-009 — Vendor Breach | Complete vendor assessments; DPAs | Process |
| 12 | RSK-012 — AI Data Processing | Verify zero-retention; PII scrubbing | Code change |
| 13 | RSK-003 — Vercel Outage | Document fallback deployment; status page | Process |
| 14 | RSK-020 — BCDR Failure | Backup testing; tabletop exercise | Process |
| 15 | RSK-017 — Regulatory Non-Compliance | Quarterly regulatory review; legal counsel | Process |

### Ongoing Monitoring (Accept/Watch)

| Priority | Risk | Treatment | Effort |
|----------|------|-----------|--------|
| 16 | RSK-002 — SQL Injection | Parameterized queries in place; CI testing | Ongoing |
| 17 | RSK-013 — XSS | React protection; CSP headers | Ongoing |
| 18 | RSK-018 — Session Hijacking | Session timeout enforcement | Code change |
| 19 | RSK-015 — Lost Device | Device inventory; remote wipe | Process |
| 20 | RSK-006 — Insider Threat | Audit logging; access review; DLP evaluation | Ongoing |

---

*This risk register is a living document. The Security Lead must update it quarterly, after any security incident, and after any significant infrastructure or business change. All updates must follow the Change Management Policy (POL-SEC-006).*
