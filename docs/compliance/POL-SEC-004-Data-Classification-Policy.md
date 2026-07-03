# SolarPro Data Classification Policy

**Document ID:** POL-SEC-004  
**Version:** 1.0  
**Effective Date:** July 2025  
**Owner:** Security Lead  
**Review Cycle:** Annual (next review: July 2026)  
**Classification:** Internal  

---

## 1. Purpose

This policy defines how SolarPro classifies data based on sensitivity and specifies handling requirements for each classification tier. Proper classification ensures that data receives appropriate protection based on its sensitivity, legal obligations, and business impact if compromised.

## 2. Data Classification Tiers

### Tier 1: Restricted — Maximum Sensitivity

**Definition:** Data whose unauthorized disclosure would cause severe financial, legal, or reputational harm. Requires the highest level of protection.

| Data Type | Examples | Storage | Access |
|-----------|----------|---------|--------|
| Authentication secrets | JWT_SECRET, MIGRATE_SECRET, CRON_SECRET, webhook HMAC keys | Environment variables only (never in code, DB, or logs) | Security Lead + Leadership only |
| API keys (third-party) | ANTHROPIC_API_KEY, OPENAI_API_KEY, STRIPE_SECRET_KEY, GOOGLE_MAPS_API_KEY, ATTOM_API_KEY | Environment variables only | Security Lead + Engineering (deploy-time only) |
| Database credentials | Neon connection strings with write access | Environment variables only | Security Lead + Engineering |
| Encryption keys | HMAC keys, signing keys | Environment variables only | Security Lead only |

**Handling requirements:**
- Never stored in code, database, logs, or version control
- Rotated quarterly (API keys) or upon any suspected compromise (immediately)
- Access logged and auditable
- No screenshot or copy-paste of values outside secure channels

### Tier 2: Confidential — Sensitive Business and Customer Data

**Definition:** Data whose unauthorized disclosure would cause significant harm to SolarPro, its customers, or its business partners.

| Data Type | Examples | Storage | Access |
|-----------|----------|---------|--------|
| Homeowner PII | Name, email, phone, address | Neon PostgreSQL | Role-scoped (admin, assigned staff) |
| Utility account data | Account number, usage history, rate schedule | Neon PostgreSQL | Role-scoped |
| Financial data (metadata) | Subscription status, billing records (card data handled by Stripe only) | Neon PostgreSQL + Stripe | Admin, Leadership |
| Engineering calculations | Structural loads, electrical compliance, permit content | Neon PostgreSQL | Role-scoped |
| Survey data | Aerial photos, site measurements, roof geometry | Neon PostgreSQL + Vercel Blob | Role-scoped |
| Internal business data | Pricing, margins, customer lists, acquisition funnel data | Neon PostgreSQL | Admin, Leadership |
| Personnel data | Employee records, compensation, performance | Neon PostgreSQL | Leadership only |

**Handling requirements:**
- Encrypted in transit (TLS 1.2+) and at rest (Neon TDE + application-level where feasible)
- Access on need-to-know basis per RBAC roles
- No sharing outside SolarPro without customer consent or legal requirement
- Retained per Data Retention Policy (POL-SEC-007)
- Audit-logged for read access by admin/staff roles

### Tier 3: Internal — General Business Data

**Definition:** Data intended for internal use that would cause minor harm if disclosed but is not sensitive enough for Tier 1 or 2.

| Data Type | Examples | Storage | Access |
|-----------|----------|---------|--------|
| Internal documentation | Policies, procedures, architecture docs | GitHub repository (private) | All personnel |
| Code and configuration | Application source code, CI/CD configs | GitHub repository (private) | Engineering |
| Operational logs | Application logs, Sentry events, Vercel function logs | Sentry, Vercel | Security Lead, Engineering |
| Internal communications | Slack messages, meeting notes | Slack | All personnel |
| Equipment catalog | Module specs, inverter datasheets, pricing | Neon PostgreSQL | All personnel |

**Handling requirements:**
- Not shared publicly without review
- No special encryption beyond standard TLS in transit
- Standard access controls apply

### Tier 4: Public — Intentionally Shared Data

**Definition:** Data explicitly approved for public consumption.

| Data Type | Examples | Storage | Access |
|-----------|----------|---------|--------|
| Marketing content | Website, landing pages, blog posts | Vercel (public) | Unrestricted |
| Public API responses | Free solar estimate tool output (non-PII) | Vercel (public) | Unrestricted |
| Published policies | Privacy policy, terms of service | Vercel (public) | Unrestricted |
| Open-source code | Any code explicitly published under open license | GitHub (public) | Unrestricted |

**Handling requirements:**
- No Tier 1, 2, or 3 data included in public content without explicit approval
- Reviewed before publication for accidental data leakage
- No special access controls

## 3. Classification Responsibilities

| Role | Responsibility |
|------|---------------|
| **Data Creator** | Classifies new data at creation time; when uncertain, classify at the higher tier |
| **Data Owner** | The business function responsible for the data; approves access and reclassification |
| **Security Lead** | Audits classification accuracy; resolves classification disputes |
| **All Personnel** | Handle data according to its classification; report misclassification |

## 4. Classification in Practice

### 4.1 Database Schema Marking

Sensitive fields in the Neon database should be identifiable by their classification tier. Recommended approach:

```sql
-- Add classification metadata to sensitive tables
COMMENT ON COLUMN projects.address IS 'TIER2:CONFIDENTIAL - Homeowner PII';
COMMENT ON COLUMN projects.homeowner_email IS 'TIER2:CONFIDENTIAL - Homeowner PII';
COMMENT ON COLUMN projects.homeowner_phone IS 'TIER2:CONFIDENTIAL - Homeowner PII';
```

### 4.2 API Response Filtering

API responses shall filter data based on the requesting user's role:

- **homeowner** role: Can only see their own Tier 2 data
- **staff** role: Can see Tier 2 data for assigned projects only
- **admin** role: Can see Tier 2 data for all projects
- **super_admin** role: Can see all data including some Tier 1 metadata (never secrets themselves)
- **Public APIs**: Return only Tier 4 data

### 4.3 Logging and Monitoring

- Tier 1 data shall **never** appear in logs, error messages, or debug output
- Tier 2 data access shall be audit-logged (who accessed what, when)
- Tier 3 data may appear in operational logs with standard access controls
- Tier 4 data has no logging requirements beyond standard application monitoring

## 5. Data Reclassification

Data may be reclassified up or down based on:

- **Upclassification triggers**: New regulation, changed business context, discovered sensitivity
- **Downclassification triggers**: Data aged out of sensitivity window, legal requirement removed, data anonymized

Reclassification requires Security Lead approval and documentation.

## 6. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-003 — Access Control Policy (who can access each tier)
- POL-SEC-007 — Data Retention & Disposal Policy (how long each tier is kept)
- POL-SEC-010 — Encryption Policy (encryption requirements per tier)

---

**Approved by:** Under The Sun Solar Leadership  
**Date:** July 2025
