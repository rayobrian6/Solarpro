# SolarPro Change Management Policy

**Document ID:** POL-SEC-006  
**Version:** 1.0  
**Effective Date:** July 2025  
**Owner:** Security Lead  
**Review Cycle:** Annual (next review: July 2026)  
**Classification:** Internal  

---

## 1. Purpose

This policy defines the process for planning, approving, testing, and deploying changes to SolarPro systems. It ensures that changes are made in a controlled manner that minimizes risk to system availability, data integrity, and security.

## 2. Scope

This policy applies to all changes affecting:
- Application code (any merge to `dev` or `master` branch)
- Infrastructure configuration (Vercel, Neon, environment variables)
- Database schema (migrations, schema changes)
- Third-party integrations (new services, API version changes, credential rotations)
- Security rules (WAF rules, rate limits, access control changes)

## 3. Change Classification

| Category | Definition | Examples | Approval Required |
|----------|-----------|----------|------------------|
| **Standard** | Low-risk, pre-approved patterns | Bug fixes, copy changes, CSS updates, dependency patch updates | Committer self-approves |
| **Normal** | Moderate risk, follows established patterns | New API routes, feature additions, database column additions, minor refactors | One peer review + merge |
| **Major** | High risk, significant impact | Database schema changes, authentication changes, new third-party integrations, architecture changes | Two peer reviews + Security Lead notification |
| **Emergency** | Urgent fix for active incident | Hotfix for P1/P2 incident, security vulnerability patch | Incident Commander approves; post-merge review within 24 hours |

## 4. Change Process

### 4.1 Standard Changes

1. Developer creates feature branch from `dev`
2. Implements change
3. Self-reviews code for correctness and security
4. Commits with descriptive message
5. Pushes to remote and creates PR against `dev`
6. Merges after self-approval (for standard changes only)

### 4.2 Normal Changes

1. Developer creates feature branch from `dev`
2. Implements change
3. Opens PR against `dev` with:
   - Description of what changes and why
   - Security impact assessment (even if "none")
   - Testing performed
4. At least one peer reviews and approves
5. Reviewer verifies:
   - No security vulnerabilities introduced
   - No sensitive data in logs or responses
   - Input validation present on new API endpoints
   - Rate limiting applied to new public endpoints
6. After approval, merge to `dev`

### 4.3 Major Changes

1. Developer creates feature branch from `dev`
2. Implements change
3. Opens PR against `dev` with:
   - Detailed description including architectural impact
   - Security impact assessment (mandatory, non-trivial)
   - Migration plan if database schema changes
   - Rollback plan
   - Testing performed including edge cases
4. Two peer reviews required
5. Security Lead notified (may review or waive review)
6. Security Lead reviews if:
   - Authentication or authorization changes
   - New third-party integration
   - Data classification implications
   - Encryption or key management changes
7. After approvals, merge to `dev`

### 4.4 Emergency Changes

1. Incident Commander authorizes emergency change
2. Developer implements fix directly on `dev` or a hotfix branch
3. Deploys immediately
4. Opens retrospective PR within 24 hours with:
   - What was changed and why
   - Security review of the emergency change
   - Any follow-up work needed
5. Peer review of retrospective PR within 48 hours
6. Document in incident post-mortem

## 5. Branch Protection

| Branch | Protection Rules |
|--------|-----------------|
| `master` | No direct pushes; requires PR from `dev`; requires 2 approvals; requires passing CI |
| `dev` | No direct pushes for major/normal changes; requires PR; requires 1+ approval |

## 6. Deployment Process

### 6.1 Deployment to Preview

- Every PR merge to `dev` automatically deploys to Vercel preview
- Preview deployment used for testing and verification
- No customer-facing impact

### 6.2 Deployment to Production

- Merges from `dev` to `master` trigger production deployment via Vercel
- Production deployments should occur during business hours when possible
- Major changes should be deployed with monitoring for 1 hour post-deploy
- Rollback plan should be identifiable before production deployment

### 6.3 Database Migrations

- All schema changes must be backward-compatible (additive only when possible)
- Destructive migrations (column drops, table renames) require:
  - Major change classification
  - Two-phase migration: add new → migrate data → remove old
  - Verified rollback procedure
- Migration secret required for execution (`MIGRATE_SECRET` env var)
- Migration logged with timestamp, actor, and changes made

## 7. Change Documentation

All changes shall be documented in:

- **Git commit messages** — Descriptive, following conventional commit format
- **Pull request descriptions** — What, why, security impact, testing
- **CHANGELOG.md** — User-facing changes documented for release notes
- **Incident Register** — Emergency changes linked to incident post-mortem

## 8. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-005 — Incident Response Plan (emergency change authorization)
- POL-SEC-009 — Password & Authentication Policy (credential rotation during changes)

---

**Approved by:** Under The Sun Solar Leadership  
**Date:** July 2025
