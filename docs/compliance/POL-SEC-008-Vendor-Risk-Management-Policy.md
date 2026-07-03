# POL-SEC-008 — Vendor Risk Management Policy

**Document ID:** POL-SEC-008  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Annual  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Purpose

This policy establishes the framework for identifying, assessing, monitoring, and mitigating risks associated with third-party vendors and sub-processors who process, store, or transmit SolarPro data. Effective vendor risk management is a core requirement for SOC 2 (Trust Services Criteria CC9.2) and ISO 27001 (Annex A A.15), and directly protects SolarPro's customers, data, and operations from supply-chain risk.

## 2. Scope

This policy applies to all external entities that:

- Process, store, or transmit SolarPro customer data
- Have access to SolarPro internal systems, code, or infrastructure
- Provide critical business services where failure would impact availability
- Supply software components integrated into SolarPro's production environment
- Host SolarPro application infrastructure

### 2.1 In-Scope Vendors (Current)

| Vendor | Service | Data Exposure | Criticality |
|--------|---------|---------------|-------------|
| Vercel | Application hosting, deployment, CDN | Production app, deployment configs, analytics | Critical |
| Neon (PostgreSQL) | Primary database hosting | All customer data, financial records | Critical |
| GitHub | Source code hosting, CI/CD | All source code, secrets (via Actions) | Critical |
| Stripe | Payment processing | Customer PII, payment card data | Critical |
| Sentry | Error monitoring, performance tracking | Error logs, user metadata | High |
| Resend | Transactional email delivery | Email addresses, email content | High |
| Anthropic | AI/ML API provider | Engineering data prompts (if not zero-retention) | High |
| OpenAI | AI/ML API provider | Engineering data prompts (if not zero-retention) | High |
| Google Cloud Platform | Cloud compute, storage, secrets | Varies by usage | High |

### 2.2 Exclusions

- Open-source software packages used as dependencies (managed separately under software supply-chain security)
- Vendors with no access to SolarPro data or systems (e.g., office supplies, cleaning services)
- Individual contractors operating under SolarPro's own access controls (covered by POL-SEC-003)

## 3. Vendor Risk Assessment Framework

### 3.1 Risk Categories

Each vendor is assessed across five risk categories:

| Category | Description | Weight |
|----------|-------------|--------|
| **Data Exposure** | Type and sensitivity of data accessible to the vendor | 30% |
| **Service Criticality** | Impact on SolarPro operations if vendor fails | 25% |
| **Security Posture** | Vendor's own security certifications and practices | 25% |
| **Compliance Alignment** | Vendor's compliance with relevant frameworks | 10% |
| **Geographic/Jurisdictional Risk** | Data residency, legal jurisdiction, regulatory environment | 10% |

### 3.2 Risk Scoring

Each category is scored on a 1–5 scale:

| Score | Rating | Criteria |
|-------|--------|----------|
| 1 | Minimal | No sensitive data; non-critical service; SOC 2 + ISO 27001 certified; domestic jurisdiction |
| 2 | Low | Internal data only; limited operational impact; security certifications present; domestic jurisdiction |
| 3 | Moderate | Confidential data accessible; moderate operational impact; partial certifications; domestic jurisdiction |
| 4 | High | Confidential/PII data accessible; significant operational impact; no certifications; foreign jurisdiction |
| 5 | Critical | Restricted data or large-scale PII; critical operational dependency; no certifications; foreign/high-risk jurisdiction |

**Composite Risk Score** = Σ (Category Score × Weight)

| Composite Score | Risk Level | Action Required |
|----------------|------------|-----------------|
| 1.0 – 1.5 | Low | Standard onboarding; annual review |
| 1.6 – 2.5 | Moderate | Enhanced due diligence; semi-annual review |
| 2.6 – 3.5 | High | Security Lead approval; quarterly review; compensating controls required |
| 3.6 – 5.0 | Critical | Leadership approval required; monthly monitoring; alternative vendor evaluation |

### 3.3 Current Vendor Risk Assessment

| Vendor | Data Exposure | Criticality | Security | Compliance | Geographic | Composite | Risk Level |
|--------|--------------|-------------|----------|------------|------------|-----------|------------|
| Vercel | 3 | 5 | 2 | 2 | 1 | 3.0 | High |
| Neon | 5 | 5 | 2 | 2 | 1 | 3.7 | Critical |
| GitHub | 3 | 5 | 1 | 1 | 1 | 2.6 | High |
| Stripe | 5 | 5 | 1 | 1 | 1 | 2.7 | High |
| Sentry | 3 | 3 | 2 | 2 | 1 | 2.3 | Moderate |
| Resend | 3 | 3 | 3 | 2 | 1 | 2.5 | Moderate |
| Anthropic | 3 | 2 | 2 | 2 | 1 | 2.1 | Moderate |
| OpenAI | 3 | 2 | 2 | 2 | 1 | 2.1 | Moderate |
| Google Cloud | 3 | 4 | 1 | 1 | 1 | 2.2 | Moderate |

## 4. Vendor Onboarding Process

### 4.1 Pre-Engagement Assessment

Before any vendor gains access to SolarPro data or systems:

1. **Security Questionnaire** — Vendor must complete SolarPro's security questionnaire covering: data handling practices, encryption standards, access controls, incident response, compliance certifications, sub-processor usage, and data residency.

2. **Certification Verification** — Verify any claimed certifications (SOC 2 Type II, ISO 27001, PCI DSS, FedRAMP) by requesting the most recent audit report or certification letter. Acceptable certifications must be within the last 12 months.

3. **Data Processing Agreement (DPA)** — Execute a DPA that includes: data processing scope, security obligations, breach notification within 72 hours, audit rights, data return/destruction upon termination, and sub-processor disclosure requirements.

4. **Risk Score Calculation** — Complete the risk assessment per Section 3 and obtain appropriate approval:
   - Low/Moderate: Security Lead approval
   - High: Security Lead + Leadership approval
   - Critical: Leadership approval with documented compensating controls

5. **Contract Review** — Ensure contracts include: security requirements, SLA commitments, right to audit, data return/deletion clauses, and breach notification terms.

### 4.2 Fast-Track Process

For vendors scoring Low risk with recognized certifications (SOC 2 Type II or ISO 27001), the onboarding process may be fast-tracked:
- Security questionnaire may be replaced by certification review
- DPA may use the vendor's standard DPA if it meets SolarPro's minimum requirements
- Security Lead may approve without Leadership review

## 5. Ongoing Vendor Monitoring

### 5.1 Continuous Monitoring Activities

| Activity | Frequency | Responsibility |
|----------|-----------|----------------|
| Vendor risk score reassessment | Per review cadence (see 3.2) | Security Lead |
| Certification validity check | Annual | Security Lead |
| Service availability review | Monthly (automated where possible) | Engineering |
| Sub-processor change review | Upon vendor notification | Security Lead |
| Data exposure scope review | Quarterly | Security Lead |
| Vendor financial stability check | Annual | Leadership |
| Contract and SLA compliance review | Annual | Security Lead |

### 5.2 Vendor Security Events

When a vendor experiences a security incident:
1. SolarPro Security Lead assesses impact on SolarPro data and operations
2. If SolarPro data may be affected, activate Incident Response Plan (POL-SEC-005)
3. Document the event in the Vendor Risk Register
4. Evaluate whether continued use of the vendor is acceptable
5. If vendor incident reveals material control weakness, require vendor remediation plan within 30 days or begin alternative vendor evaluation

### 5.3 Sub-Processor Monitoring

Vendors must notify SolarPro before engaging new sub-processors that will process SolarPro data. SolarPro reserves the right to object to sub-processor changes within 14 days of notification. If objection is not resolved, SolarPro may terminate the vendor agreement.

All vendor sub-processors must be recorded in SolarPro's Sub-Processor Register and disclosed on the SolarPro trust center page (per Phase 5 deliverable).

## 6. Vendor Offboarding

When a vendor relationship is terminated:

1. **Data Return or Destruction** — Vendor must return or certify destruction of all SolarPro data within 30 days of termination
2. **Access Revocation** — Revoke all vendor access to SolarPro systems within 24 hours of termination
3. **Credential Rotation** — Rotate all API keys, shared secrets, and integration credentials that were accessible to the vendor
4. **Contractual Obligations** — Verify survival clauses (confidentiality, data protection) remain in effect
5. **Post-Termination Audit** — For Critical and High risk vendors, request confirmation of data destruction within 90 days
6. **Register Update** — Update the Vendor Risk Register to reflect terminated status

## 7. Vendor Risk Register

The Security Lead maintains a Vendor Risk Register containing:

| Field | Description |
|-------|-------------|
| Vendor Name | Legal entity name |
| Service Provided | Description of services |
| Data Classification Exposure | Highest tier of data accessible (per POL-SEC-004) |
| Risk Score | Current composite risk score |
| Risk Level | Low / Moderate / High / Critical |
| Certifications Held | SOC 2, ISO 27001, PCI DSS, etc. with dates |
| DPA Status | Executed / Pending / Not Required |
| Last Assessment Date | Date of most recent risk assessment |
| Next Review Date | Scheduled next assessment |
| Sub-Processors | List of vendor's sub-processors touching SolarPro data |
| Contract Expiry | Date of contract expiration |
| Status | Active / Under Review / Terminated |

## 8. Compensating Controls for High/Critical Vendors

When a vendor presents elevated risk and no lower-risk alternative exists, implement compensating controls:

| Risk | Compensating Control |
|------|---------------------|
| No SOC 2 certification | Require independent security assessment; implement additional data isolation |
| Foreign data residency | Ensure data encrypted at rest with SolarPro-managed keys; verify GDPR adequacy decision |
| Shared infrastructure risk | Logical isolation verification; encryption of all data in transit and at rest |
| Vendor single point of failure | Document recovery plan; evaluate secondary vendor; maintain data export capability |
| Sub-processor opacity | Contractual sub-processor disclosure requirement; quarterly attestation |
| Limited breach notification | Contractual 72-hour breach notification with SLA penalty |

## 9. Minimum Vendor Security Requirements

All vendors processing SolarPro data must, at minimum:

1. Encrypt data in transit using TLS 1.2 or higher
2. Encrypt data at rest using AES-256 or equivalent
3. Implement role-based access controls
4. Maintain audit logs of access to SolarPro data
5. Provide breach notification within 72 hours
6. Undergo annual security assessment (self-assessment minimum; third-party for High/Critical)
7. Comply with applicable data protection regulations (GDPR, CCPA)
8. Not transfer SolarPro data to third parties without prior written consent
9. Maintain business continuity and disaster recovery plans
10. Provide data return or certified destruction upon contract termination

## 10. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-003 — Access Control Policy
- POL-SEC-004 — Data Classification Policy
- POL-SEC-005 — Incident Response Plan
- POL-SEC-007 — Data Retention & Disposal Policy
- POL-SEC-010 — Encryption Policy

---

*This policy is subject to annual review. The Security Lead must update the Vendor Risk Register whenever a new vendor is onboarded, a vendor's risk profile changes materially, or a vendor relationship is terminated.*
