# SolarPro Incident Response Plan

**Document ID:** POL-SEC-005  
**Version:** 1.0  
**Effective Date:** July 2025  
**Owner:** Security Lead  
**Review Cycle:** Annual (next review: July 2026)  
**Classification:** Internal  

---

## 1. Purpose

This plan defines SolarPro's process for detecting, containing, eradicating, and recovering from security incidents. It ensures that incidents are handled consistently, communicated appropriately, and that lessons learned improve future security posture.

## 2. Scope

This plan applies to all security incidents affecting:
- SolarPro application (web app, API routes, database)
- SolarPro infrastructure (Vercel, Neon, GitHub, Stripe integrations)
- Customer data (project data, homeowner PII, engineering calculations)
- Personnel accounts and credentials

## 3. Incident Severity Classification

| Severity | Definition | Examples | Response Time |
|----------|-----------|----------|--------------|
| **Critical (P1)** | Active breach, data exfiltration, or system compromise in progress | Database breach, ransomware, active exploitation of zero-day, mass data leak | 15 minutes |
| **High (P2)** | Confirmed vulnerability with significant impact potential, no active exploitation confirmed | Admin credential compromise, significant vulnerability discovered, unauthorized access to customer data | 1 hour |
| **Medium (P3)** | Vulnerability or anomaly with limited impact, requires investigation | Suspicious login patterns, anomalous API usage, failed intrusion attempt, minor data exposure | 4 hours |
| **Low (P4)** | Minor security event, no immediate risk | Single failed login, policy violation, phishing email received (not clicked) | 24 hours |

## 4. Incident Response Team

| Role | Responsibility | Current Designee |
|------|---------------|-----------------|
| **Incident Commander** | Overall incident coordination, external communication decisions | Leadership |
| **Security Lead** | Technical investigation, containment decisions, evidence preservation | Security Lead |
| **Engineering Lead** | Technical remediation, code fixes, deployment | Engineering Lead |
| **Communications** | Customer notification, public statements (if required) | Leadership |

For a small team, roles may be held by the same individual. The Incident Commander role always has final authority on communication and containment decisions.

## 5. Incident Response Process

### 5.1 Phase 1: Detection and Reporting

**Sources of detection:**
- Sentry alerts (unhandled errors, anomalous patterns)
- Vercel monitoring (unusual traffic, function failures)
- Neon monitoring (query anomalies, connection spikes)
- Manual reports (personnel, customers, external researchers)
- Automated vulnerability scanning
- Quarterly access review findings
- GitHub security advisories (Dependabot)

**Reporting procedure:**
1. Any personnel who suspects a security incident shall immediately notify the Security Lead via Slack (#security) or direct communication
2. Security Lead acknowledges receipt within the response time for the suspected severity
3. Security Lead performs initial triage to classify severity per Section 3
4. If P1 or P2, Security Lead notifies Incident Commander immediately

**What to report:**
- What happened (or what you suspect happened)
- When it was first observed
- What systems or data may be affected
- Any actions already taken
- Screenshots or logs if available

### 5.2 Phase 2: Containment

**Immediate containment actions (severity-dependent):**

**P1 — Critical:**
- Disable compromised accounts immediately
- Revoke potentially compromised API keys/tokens
- Enable Vercel deployment freeze if application compromise suspected
- Isolate affected database connections (Neon allows connection pooling reset)
- Block malicious IPs at Vercel edge (if applicable)
- Preserve forensic evidence before any remediation

**P2 — High:**
- Disable compromised accounts
- Force password reset for affected users
- Revoke and rotate affected API keys
- Assess blast radius before broader containment

**P3/P4 — Medium/Low:**
- Document and monitor
- No immediate containment needed unless investigation escalates

**Evidence preservation:**
- Capture Vercel function logs for the incident timeframe
- Export Sentry event data
- Screenshot any compromised UI states
- Record Neon query logs for anomalous queries
- Do NOT modify or delete potentially affected data until investigation is complete

### 5.3 Phase 3: Eradication

1. Identify root cause of the incident
2. Remove the threat:
   - Patch the vulnerability (code fix → deploy)
   - Rotate all potentially compromised credentials
   - Remove unauthorized access paths
   - Update security rules or configurations
3. Verify eradication:
   - Confirm the vulnerability is no longer exploitable
   - Confirm no backdoors remain
   - Confirm compromised data access is revoked

### 5.4 Phase 4: Recovery

1. Restore any affected systems to normal operation
2. Verify data integrity (database consistency checks, engineering calculation validation)
3. Monitor for recurrence for 72 hours after recovery
4. Gradually restore normal access controls (if any were relaxed during incident)
5. Confirm all monitoring and alerting is active and functioning

### 5.5 Phase 5: Post-Incident Review

**Within 5 business days of incident closure:**

1. Conduct blameless post-mortem with all involved personnel
2. Document:
   - Incident timeline (detection → containment → eradication → recovery)
   - Root cause analysis
   - What worked well in the response
   - What could be improved
   - Action items with owners and deadlines
3. Update this plan, other policies, or code based on findings
4. Share sanitized lessons learned with all personnel

## 6. Communication Plan

### 6.1 Internal Communication

| Severity | Notification | Channel |
|----------|-------------|---------|
| P1 | All incident response team members + Leadership | Slack #security + phone/video call |
| P2 | Security Lead + Incident Commander | Slack #security |
| P3 | Security Lead | Slack #security |
| P4 | Logged, no real-time notification | Slack #security (async) |

### 6.2 External Communication

| Scenario | Action | Timeline |
|----------|--------|----------|
| Customer data breach confirmed | Notify affected customers with: what happened, what data was affected, what we did, what they should do | Within 72 hours of confirmation |
| No customer data involved | No external notification required | N/A |
| Regulatory notification required | Consult legal counsel for jurisdiction-specific requirements | Per applicable law |
| Public disclosure needed | Leadership approves all public statements | Within 72 hours |

**Communication principles:**
- Be factual — state what is known, what is not yet known, and what we are doing
- Be timely — do not wait for complete information to issue initial notification
- Be transparent — do not minimize or obscure the impact
- Protect investigation details until root cause is confirmed

## 7. Incident Documentation

Every incident shall be documented in the Incident Register containing:

| Field | Description |
|-------|-------------|
| Incident ID | Auto-incrementing (INC-001, INC-002, etc.) |
| Date detected | ISO 8601 timestamp |
| Date resolved | ISO 8601 timestamp |
| Severity | P1/P2/P3/P4 |
| Detection source | How the incident was discovered |
| Root cause | Technical and procedural root cause |
| Affected systems | List of systems and data impacted |
| Containment actions | What was done to stop the incident |
| Eradication actions | What was done to remove the threat |
| Recovery actions | What was done to restore normal operation |
| Customer impact | Whether customer data was affected and how |
| Post-mortem summary | Key findings and action items |
| Status | Open / Contained / Eradicated / Recovered / Closed |

## 8. Testing and Training

### 8.1 Tabletop Exercises
- Conduct a tabletop incident response exercise at least annually
- Scenarios should rotate between: data breach, ransomware, insider threat, supply chain compromise
- Document exercise results and action items

### 8.2 Training
- All personnel shall receive incident response awareness training upon onboarding
- Annual refresher training covering: how to report, what to report, communication procedures
- Security Lead and Engineering Lead receive additional technical IR training

## 9. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-004 — Data Classification Policy (determines what data was affected)
- POL-SEC-009 — Password & Authentication Policy (credential compromise procedures)
- POL-SEC-011 — Business Continuity / Disaster Recovery Plan (extended outages)

---

*All personnel shall be familiar with Section 5.1 (Detection and Reporting) as a minimum requirement.*

**Approved by:** Under The Sun Solar Leadership  
**Date:** July 2025
