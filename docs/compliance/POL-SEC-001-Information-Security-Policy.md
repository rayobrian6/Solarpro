# SolarPro Information Security Policy

**Document ID:** POL-SEC-001  
**Version:** 1.0  
**Effective Date:** July 2025  
**Owner:** Under The Sun Solar — Leadership  
**Review Cycle:** Annual (next review: July 2026)  
**Classification:** Internal  

---

## 1. Purpose

This policy establishes the information security objectives, principles, and governance framework for SolarPro, the solar permit planset generation and project management platform operated by Under The Sun Solar. It demonstrates organizational commitment to protecting customer data, engineering data, and operational systems from unauthorized access, disclosure, modification, or destruction.

## 2. Scope

This policy applies to:

- **SolarPro application** — Next.js web application, API routes, serverless functions, and database
- **Supporting infrastructure** — Vercel (hosting), Neon PostgreSQL (database), Stripe (billing), and all third-party integrations listed in the Sub-Processor Register
- **Personnel** — All employees, contractors, and temporary workers with access to SolarPro systems
- **Data** — All data created, processed, stored, or transmitted by SolarPro, including customer project data, homeowner information, structural/electrical engineering data, and financial records

## 3. Information Security Objectives

SolarPro's information security program shall:

1. **Protect confidentiality** — Customer data, engineering calculations, and proprietary business logic shall be accessible only to authorized individuals and systems
2. **Ensure integrity** — Engineering data (structural loads, electrical calculations, permit content) shall be accurate and protected from unauthorized modification
3. **Maintain availability** — SolarPro systems shall be available to authorized users with a target uptime of 99.9% (excluding scheduled maintenance)
4. **Comply with obligations** — Meet all applicable legal, regulatory, and contractual security requirements
5. **Continuously improve** — Regularly assess and improve security posture through audits, vulnerability management, and incident learning

## 4. Governance Structure

### 4.1 Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| **Leadership** | Approve security policy, allocate resources, review security performance quarterly |
| **Security Lead** | Day-to-day security operations, risk assessments, incident response coordination, policy maintenance |
| **Engineering** | Implement security controls in code, conduct code reviews, remediate vulnerabilities |
| **All Personnel** | Follow security policies, report incidents, complete security awareness requirements |

### 4.2 Security Governance Cadence

| Activity | Frequency | Participants |
|----------|-----------|-------------|
| Security policy review | Annual | Leadership, Security Lead |
| Risk assessment | Annual | Security Lead, Engineering |
| Access review | Quarterly | Security Lead, Engineering |
| Incident review | Per incident + quarterly aggregate | Security Lead, Leadership |
| Vulnerability scan | Quarterly (automated: continuous) | Engineering |
| Penetration test | Annual (when budget permits) | External firm |

## 5. Core Security Principles

### 5.1 Least Privilege
Access to systems, data, and functions shall be granted on a need-to-know, need-to-use basis. Personnel shall have the minimum permissions required for their role.

### 5.2 Defense in Depth
Multiple layers of security controls shall protect critical assets. No single control failure shall result in a complete security breach.

### 5.3 Zero Trust
No user, device, or system shall be inherently trusted. All access requests shall be authenticated, authorized, and encrypted regardless of network location.

### 5.4 Accountability
All security-relevant actions shall be logged and attributable to an individual or system identity. Audit logs shall be tamper-evident and retained per the Data Retention Policy.

### 5.5 Continuous Monitoring
Security controls shall be monitored continuously. Deviations from expected behavior shall generate alerts and be investigated per the Incident Response Plan.

## 6. Policy Framework

This policy is the top-level document. The following supporting policies provide detailed requirements:

| Policy | Document ID | Purpose |
|--------|------------|---------|
| Acceptable Use Policy | POL-SEC-002 | Defines acceptable use of SolarPro systems and data |
| Access Control Policy | POL-SEC-003 | Defines access management, RBAC, and review processes |
| Data Classification Policy | POL-SEC-004 | Defines data sensitivity tiers and handling requirements |
| Incident Response Plan | POL-SEC-005 | Defines security incident detection, response, and recovery |
| Change Management Policy | POL-SEC-006 | Defines change approval, testing, and deployment processes |
| Data Retention & Disposal Policy | POL-SEC-007 | Defines data lifecycle, retention periods, and disposal methods |
| Vendor Risk Management Policy | POL-SEC-008 | Defines third-party risk assessment and monitoring |
| Password & Authentication Policy | POL-SEC-009 | Defines authentication requirements including MFA |
| Encryption Policy | POL-SEC-010 | Defines encryption standards for data at rest and in transit |
| Business Continuity / DR Plan | POL-SEC-011 | Defines recovery objectives and procedures |

## 7. Compliance and Enforcement

### 7.1 Compliance Measurement
Adherence to this policy and its supporting documents shall be measured through:
- Quarterly access reviews
- Quarterly vulnerability scans
- Annual risk assessments
- Annual policy compliance review
- Incident post-mortems

### 7.2 Violations
Violations of this policy may result in:
- Access revocation
- Disciplinary action up to termination
- Legal action where applicable

### 7.3 Exceptions
Exceptions to this policy require written approval from the Security Lead and must be:
- Documented with business justification
- Time-limited (maximum 90 days)
- Assessed for risk impact
- Reviewed at expiration

## 8. Policy Maintenance

| Action | Process |
|--------|---------|
| Minor updates (typographical, clarification) | Security Lead approves, no re-issuance required |
| Material changes (scope, requirements, objectives) | Leadership approval required, version increment |
| Annual review | Security Lead initiates, Leadership approves |

## 9. Definitions

- **Security Lead** — The individual responsible for SolarPro's information security program. Currently designated by Leadership.
- **Personnel** — All employees, contractors, and temporary workers with access to SolarPro systems.
- **Security incident** — Any event that violates or threatens to violate the confidentiality, integrity, or availability of SolarPro data or systems.
- **Sub-processor** — Any third-party service that processes, stores, or transmits SolarPro customer data on behalf of SolarPro.

---

*This policy shall be communicated to all personnel upon hire and at each annual review. Acknowledgment of this policy is mandatory for access to SolarPro systems.*

**Approved by:** Under The Sun Solar Leadership  
**Date:** July 2025
