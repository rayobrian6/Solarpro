# POL-SEC-011 — Business Continuity / Disaster Recovery Plan

**Document ID:** POL-SEC-011  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Annual  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Purpose

This policy defines SolarPro's business continuity and disaster recovery (BCDR) strategy to ensure the organization can maintain or rapidly restore critical operations during and after disruptive events. It establishes recovery objectives, identifies critical systems, defines response procedures, and sets testing requirements aligned with SOC 2 (CC7.3, CC9.1) and ISO 27001 (A.12.3, A.17.1, A.17.2) requirements.

## 2. Scope

This plan covers all SolarPro production systems, data, and business functions, including:

- SolarPro web application (hosted on Vercel)
- Primary database (Neon PostgreSQL)
- Source code and CI/CD (GitHub)
- Payment processing (Stripe)
- Monitoring (Sentry)
- Email delivery (Resend)
- AI services (Anthropic, OpenAI)
- Cloud infrastructure (Google Cloud)

## 3. Recovery Objectives

### 3.1 Definitions

- **RPO (Recovery Point Objective):** Maximum acceptable data loss measured in time
- **RTO (Recovery Time Objective):** Maximum acceptable downtime before operations must be restored

### 3.2 Objectives by System

| System | Classification | RPO | RTO | Priority |
|--------|---------------|-----|-----|----------|
| SolarPro web application | Critical | 1 hour | 4 hours | P1 |
| Neon PostgreSQL database | Critical | 1 hour | 2 hours | P1 |
| GitHub source code | Critical | 0 (replicated) | 1 hour | P1 |
| Stripe payment processing | Critical | 0 (Stripe-managed) | 4 hours | P1 |
| Sentry monitoring | High | 24 hours | 24 hours | P2 |
| Resend email delivery | High | 24 hours | 8 hours | P2 |
| AI services (Anthropic/OpenAI) | Medium | N/A | 8 hours | P3 |
| Google Cloud infrastructure | High | 4 hours | 4 hours | P2 |

### 3.3 Business Impact Tiers

| Tier | Impact | Revenue Loss | Customer Impact |
|------|--------|-------------|-----------------|
| P1 Critical | Total service outage | >$10K/day | All customers affected; data at risk |
| P2 High | Major degradation | $1K–$10K/day | Significant subset affected |
| P3 Medium | Minor degradation | <$1K/day | Limited customer impact |
| P4 Low | Cosmetic/UX only | Negligible | No functional impact |

## 4. Risk Scenarios and Response

### 4.1 Cloud Provider Outage (Vercel)

**Scenario:** Vercel platform experiences regional or global outage.

**Impact:** SolarPro application unreachable; no customer access.

**Response:**
1. Confirm outage via Vercel status page (vercel.com/status)
2. Switch Vercel deployment to alternative region if available
3. Communicate to customers via email (Resend, if operational) and status page
4. If Vercel outage exceeds 4 hours, evaluate deploying to alternative platform (Cloudflare Pages, AWS)
5. Post-incident: evaluate multi-region or multi-platform deployment strategy

**Prevention:**
- Vercel automatically deploys to global edge network; regional failover is native
- Maintain deployment configuration that can be re-deployed to alternative host

### 4.2 Database Failure (Neon PostgreSQL)

**Scenario:** Neon PostgreSQL becomes unavailable, data corruption, or accidental deletion.

**Impact:** All application functionality fails; potential data loss.

**Response:**
1. Confirm database connectivity and scope of failure
2. Check Neon status page and Neon console for active incidents
3. If data corruption: restore from Neon point-in-time recovery (PITR) — 7-day WAL retention
4. If full database loss: restore from most recent backup
5. Verify data integrity after restoration (row counts, recent records, schema integrity)
6. Application health check after database restoration
7. Post-incident: verify Neon backup settings; assess need for independent backup

**Prevention:**
- Neon provides automatic high availability with active-active replication
- Neon PITR with 7-day WAL retention
- Implement application-level backup: daily `pg_dump` to Google Cloud Storage (see Section 6)

### 4.3 Source Code Repository Loss (GitHub)

**Scenario:** GitHub repository becomes inaccessible or data is lost.

**Impact:** Cannot deploy changes; cannot review code; CI/CD fails.

**Response:**
1. Check GitHub status page
2. All developers have local clones with full git history; no data loss
3. If GitHub outage exceeds 1 hour, create temporary repository on alternative platform
4. If repository is deleted or corrupted, restore from any developer's local clone
5. Emergency deployments can be made via Vercel CLI directly from local branches

**Prevention:**
- Git distributed nature provides inherent backup (every clone is a full backup)
- Ensure at least 2 team members have current local clones at all times

### 4.4 Security Breach / Data Exfiltration

**Scenario:** Unauthorized access to production data or systems.

**Impact:** Customer data compromised; regulatory notification obligations.

**Response:**
1. Activate Incident Response Plan (POL-SEC-005) immediately
2. Contain the breach: revoke compromised credentials, isolate affected systems
3. Assess scope of data exposure per POL-SEC-004 classification
4. Notify affected customers within 72 hours per POL-SEC-005 communication plan
5. Notify regulatory authorities if required by applicable law
6. Engage forensic investigation if scale warrants
7. Remediate root cause; implement additional controls
8. Post-incident review and policy update

### 4.5 Ransomware / Destructive Attack

**Scenario:** Systems or data encrypted or destroyed by malicious actor.

**Impact:** Potential total data loss if no clean backup exists.

**Response:**
1. Isolate all affected systems immediately (disconnect from network)
2. Do NOT pay ransom (company policy; paying does not guarantee recovery)
3. Assess which systems and data are affected
4. Restore from verified clean backups
5. Revoke and rotate all credentials
6. Investigate entry vector; patch vulnerability
7. Restore operations in priority order (P1 systems first)
8. Post-incident forensic review

**Prevention:**
- Immutable backups (Neon PITR, GCS backup with object lock)
- Least privilege access reduces blast radius
- MFA on all accounts prevents credential-based attacks

### 4.6 Key Personnel Loss

**Scenario:** Critical team member departs unexpectedly.

**Impact:** Knowledge gaps; delayed incident response; potential access issues.

**Response:**
1. Immediately revoke departing person's access per POL-SEC-003 offboarding
2. Rotate all credentials accessible to departing person
3. Transfer responsibilities to designated backup personnel
4. Ensure backup personnel have necessary access and documentation
5. Conduct knowledge transfer session within 1 week

**Prevention:**
- Maintain documented procedures for all critical roles
- No single point of failure: every critical function has at least 2 knowledgeable people
- Access review ensures multiple people have necessary platform access

### 4.7 Third-Party Service Failure

**Scenario:** Critical vendor (Stripe, Anthropic, etc.) experiences outage.

**Impact:** Dependent functionality becomes unavailable.

**Response:**
1. Assess which SolarPro features are affected
2. Implement graceful degradation (e.g., hide AI features if Anthropic is down; show payment issue banner if Stripe is down)
3. Communicate status to customers
4. Monitor vendor status page for recovery
5. Post-incident: evaluate vendor redundancy or fallback

## 5. Communication Plan

### 5.1 Internal Communication

| Severity | Channel | Response Time | Audience |
|----------|---------|--------------|----------|
| P1 Critical | Slack #incidents + phone | Immediate | All engineering + Leadership |
| P2 High | Slack #incidents | Within 15 minutes | Engineering + Security Lead |
| P3 Medium | Slack #incidents | Within 1 hour | Relevant engineering |
| P4 Low | Slack #engineering | Next business day | Engineering |

### 5.2 External Communication

| Event | Channel | Timeline | Content |
|-------|---------|----------|---------|
| P1 outage | Status page + email | Within 1 hour | Acknowledgment, estimated impact |
| P1 update | Status page + email | Every 2 hours | Progress, estimated recovery |
| P1 resolution | Status page + email | Upon resolution | Root cause summary, remediation |
| Security breach | Email to affected users | Within 72 hours | Per POL-SEC-005 notification requirements |
| Scheduled maintenance | Status page + email | 72 hours advance | Window, expected impact |

### 5.3 Status Page

SolarPro must maintain a public status page (e.g., Better Stack, Instatus, or custom page) that displays:
- Current system status (operational / degraded / outage)
- Active incidents with timeline updates
- Planned maintenance windows
- Historical uptime metrics

## 6. Backup Strategy

### 6.1 Backup Architecture

| Backup Type | Target | Frequency | Retention | Verification |
|-------------|--------|-----------|-----------|-------------|
| Neon PITR | Neon-managed | Continuous (WAL streaming) | 7 days | Neon provides verification |
| Database dump | Google Cloud Storage | Daily (pg_dump) | 30 days | Monthly restore test |
| Full database export | Google Cloud Storage | Weekly (pg_dump with blobs) | 90 days | Quarterly restore test |
| Source code | GitHub + local clones | Continuous (git push) | Indefinite (git history) | Developer clone verification |
| Environment configuration | Vercel + GitHub Actions secrets | On change | Current version only | Quarterly review |
| Vercel deployment | Vercel-managed | Per deployment | 30 days | Vercel rollback capability |

### 6.2 Backup Security

- All backups must be encrypted at rest (GCS default encryption; AES-256)
- Backup access restricted to Security Lead and designated backup personnel
- Backup integrity verification via checksum comparison
- Backup access audit-logged
- Backup restoration tested on schedule (see Section 7)

### 6.3 Backup Automation

Implement automated backup script scheduled via Vercel Cron Jobs:

```
Daily:  pg_dump → GCS (with date-stamped filename)
Weekly: pg_dump --full → GCS (with date-stamped filename)
```

Script must:
- Use Neon connection string from environment variable
- Upload to GCS with project-specific bucket
- Generate SHA-256 checksum for each backup file
- Log backup completion (success/failure) to Sentry
- Alert on failure via Slack #incidents

## 7. Testing and Validation

### 7.1 Testing Schedule

| Test Type | Frequency | Scope | Responsible |
|-----------|-----------|-------|-------------|
| Database restore from PITR | Monthly | 1 test table restore | Engineering |
| Database restore from pg_dump | Quarterly | Full restore to test environment | Engineering |
| Application failover (Vercel region) | Semi-annual | Deploy to alternate region | Engineering |
| BCDR tabletop exercise | Annual | Full scenario walkthrough | All personnel |
| Communication plan test | Semi-annual | Status page + notification drill | Security Lead |
| Backup verification | Monthly | Checksum validation of recent backups | Engineering |

### 7.2 Test Documentation

Each test must produce a record containing:

- Test date and participants
- Scenario tested
- Steps performed
- RPO and RTO achieved (actual vs. target)
- Issues encountered
- Corrective actions required
- Next test date

Test records are retained for 3 years and serve as SOC 2 evidence.

## 8. Plan Maintenance

### 8.1 Review Triggers

This BCDR plan must be reviewed and updated when:

- Major infrastructure changes occur (new services, migrations)
- Recovery objectives change
- Test results reveal gaps or failures
- After any actual disaster recovery activation
- Organizational changes (new personnel, role changes)
- Annual review cycle (mandatory)

### 8.2 Version Control

All changes to this plan must follow the Change Management Policy (POL-SEC-006). The plan version, change date, and change summary must be recorded.

## 9. Roles and Responsibilities

| Role | BCDR Responsibility |
|------|---------------------|
| Leadership | Approve recovery objectives; authorize BCDR investment; make P1 business decisions |
| Security Lead | Own BCDR plan; coordinate testing; activate recovery; manage communication |
| Engineering | Execute recovery procedures; maintain backup systems; participate in testing |
| All Personnel | Know evacuation and communication procedures; participate in tabletop exercises |

## 10. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-003 — Access Control Policy
- POL-SEC-005 — Incident Response Plan
- POL-SEC-008 — Vendor Risk Management Policy
- POL-SEC-010 — Encryption Policy

---

*This plan is subject to annual review and must be updated after any BCDR test or actual recovery event. Recovery objectives and procedures must reflect the current infrastructure architecture.*
