# POL-SEC-010 — Encryption Policy

**Document ID:** POL-SEC-010  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Annual  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Purpose

This policy defines the encryption standards, algorithms, key management practices, and enforcement requirements for all SolarPro data in transit and at rest. Encryption is a fundamental control for SOC 2 (CC6.1, CC6.7) and ISO 27001 (A.10.1) and directly supports the Data Classification Policy (POL-SEC-004) by ensuring that sensitive data is protected against unauthorized disclosure.

## 2. Scope

This policy applies to:

- All data stored in SolarPro systems (Neon PostgreSQL, Vercel, backups, logs)
- All data transmitted between SolarPro components, users, and third parties
- All encryption keys used by SolarPro
- All environments: production, staging, development
- All personnel responsible for configuring, maintaining, or managing encryption

## 3. Encryption Standards

### 3.1 Approved Algorithms

| Purpose | Approved Algorithm | Minimum Key Length | Status |
|---------|-------------------|-------------------|--------|
| Symmetric encryption (data at rest) | AES | 256 bits (AES-256-GCM preferred) | Current |
| Symmetric encryption (legacy) | AES | 128 bits | Deprecated (migrate by 2026) |
| Asymmetric encryption (key exchange) | RSA | 2048 bits | Current |
| Asymmetric encryption (signing) | RSA / ECDSA | RSA 2048 / ECDSA P-256 | Current |
| Hashing (integrity) | SHA-256, SHA-384, SHA-512 | — | Current |
| Hashing (passwords) | bcrypt (cost ≥ 12) or argon2id | — | Current |
| Key derivation | HKDF-SHA256 | 256 bits output | Current |
| HMAC (message authentication) | HMAC-SHA256 | 256 bits key | Current |

### 3.2 Prohibited Algorithms

| Algorithm | Reason |
|-----------|--------|
| DES, 3DES | Insufficient key length; broken |
| RC4 | Vulnerable to multiple attacks |
| MD5 | Collision attacks; broken for integrity |
| SHA-1 | Collision attacks; deprecated |
| Blowfish | Not FIPS-approved; variable key issues |
| ECB mode | No semantic security; pattern leakage |

## 4. Encryption in Transit

### 4.1 External Communications

All data transmitted between SolarPro and external parties (users, browsers, APIs, third-party services) must be encrypted using TLS 1.2 or higher.

| Requirement | Standard |
|-------------|----------|
| Minimum TLS version | TLS 1.2 |
| Preferred TLS version | TLS 1.3 |
| TLS 1.0 / 1.1 | Prohibited; must be disabled |
| Cipher suites (TLS 1.3) | TLS_AES_256_GCM_SHA384, TLS_AES_128_GCM_SHA256 |
| Cipher suites (TLS 1.2) | ECDHE+AESGCM, ECDHE+CHACHA20 (forward secrecy required) |
| Certificate key size | RSA ≥ 2048 or ECDSA P-256 |
| Certificate authority | Industry-recognized CA (Let's Encrypt, DigiCert, etc.) |
| HSTS | Enabled; max-age ≥ 31536000; includeSubDomains; preload |
| Certificate monitoring | Automated expiry alerting (7-day warning minimum) |

### 4.2 Internal Communications

All data transmitted between SolarPro internal components must be encrypted:

- Application ↔ Neon PostgreSQL: TLS required (Neon provides SSL by default)
- Application ↔ Vercel: TLS required (Vercel enforces HTTPS)
- Application ↔ Stripe: TLS 1.2+ required (Stripe mandate)
- Application ↔ Anthropic/OpenAI: TLS 1.2+ required (API endpoints enforce HTTPS)
- Application ↔ Sentry: TLS required (Sentry enforces HTTPS)
- Application ↔ Resend: TLS required (Resend enforces HTTPS)

### 4.3 API Security

- All SolarPro API endpoints must require HTTPS; HTTP must redirect to HTTPS or be rejected
- API keys and tokens must only be transmitted over encrypted channels
- Webhook payloads must be verified using HMAC signatures (already implemented for Stripe)
- No sensitive data in URL parameters (use request body or headers)

## 5. Encryption at Rest

### 5.1 Data Storage Encryption

| Data Store | Encryption | Key Management | Status |
|------------|-----------|----------------|--------|
| Neon PostgreSQL | AES-256 (Neon-managed encryption) | Neon-managed | Enabled by default |
| Vercel Blob Storage | AES-256 (Vercel-managed) | Vercel-managed | Enabled by default |
| Backups | AES-256 (backup platform encryption) | Platform-managed | Must be verified |
| Local development | Not required for non-sensitive data | — | No Restricted data on local |
| Sentry | Platform-managed encryption | Sentry-managed | Enabled by default |

### 5.2 Application-Level Encryption

For data classified as Confidential (Tier 2) or Restricted (Tier 1) that requires defense in depth beyond platform-level encryption:

| Data Type | Application-Level Encryption | Implementation |
|-----------|------------------------------|----------------|
| API secrets / private keys | Encrypt with dedicated key before storage | AES-256-GCM with key from env variable |
| PII fields (SSN, financial) | Column-level encryption if stored | AES-256-GCM per-field |
| Backup archives | Encrypt before storage | AES-256-GCM with dedicated key |

### 5.3 Encryption Key Hierarchy

```
Master Key (environment variable, never in database)
  ├── Database Encryption Key (derived via HKDF)
  │     ├── Column encryption key (per-field if needed)
  │     └── Audit log integrity key
  ├── JWT Signing Key (HS256)
  ├── Webhook HMAC Key (per-integration)
  └── API Key Generation Seed
```

## 6. Key Management

### 6.1 Key Lifecycle

| Phase | Requirement |
|-------|-------------|
| Generation | Cryptographically random; minimum key length per algorithm; generated using approved CSPRNG |
| Distribution | Never transmitted in plaintext; use environment variables or secure secret management |
| Storage | Environment variables (not in source code); password manager for human-accessed keys; Google Cloud Secret Manager for production secrets |
| Rotation | Quarterly for signing keys; annually for encryption keys; immediately upon suspected compromise |
| Revocation | Immediately upon compromise detection; deactivate compromised key; generate replacement |
| Destruction | Secure overwrite; verify deletion; document destruction in key register |

### 6.2 Key Separation

Each cryptographic purpose must use a distinct key:

- JWT signing key must not be used for encryption
- Webhook HMAC keys must be unique per integration
- Database encryption keys must not be used for API authentication
- Development and production keys must be entirely separate

### 6.3 Environment Variable Management

All secrets and keys are managed through environment variables:

- Production secrets: Set via Vercel environment variables (encrypted at rest by Vercel)
- Development secrets: Set via `.env.local` (git-ignored, never committed)
- CI/CD secrets: Set via GitHub Actions secrets (encrypted at rest by GitHub)
- `.env.example` contains only placeholder values; no real secrets

## 7. Compliance Verification

### 7.1 Encryption Audit Checklist

| Check | Frequency | Responsible |
|-------|-----------|-------------|
| TLS configuration review (SSL Labs test) | Quarterly | Engineering |
| Certificate expiry monitoring | Continuous (automated) | Engineering |
| Key rotation compliance | Quarterly | Security Lead |
| At-rest encryption verification | Annual | Security Lead |
| Prohibited algorithm scan in codebase | Annual | Engineering |
| Environment variable security review | Quarterly | Security Lead |
| Secret scanning in git history | Monthly (automated) | GitHub Actions |

### 7.2 Compliance Evidence

For SOC 2 and ISO 27001 audits, maintain:

- TLS configuration scan results (SSL Labs A+ rating target)
- Certificate inventory with expiry dates
- Key rotation log with dates and responsible parties
- Encryption at rest confirmation from platform providers (Neon, Vercel)
- Secret scanning results from GitHub

## 8. Incident Response for Encryption Failures

If a cryptographic failure is detected:

1. **Key compromise suspected:** Immediately rotate the affected key; assess data exposure scope; activate Incident Response Plan (POL-SEC-005)
2. **Algorithm vulnerability discovered:** Evaluate severity; patch or migrate to stronger algorithm; document timeline and rationale
3. **TLS downgrade detected:** Investigate source; enforce TLS 1.2+ minimum; check for MITT attack indicators
4. **Encryption misconfiguration:** Immediately remediate; assess data exposure; document and report per POL-SEC-005

## 9. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-004 — Data Classification Policy
- POL-SEC-009 — Password & Authentication Policy
- POL-SEC-011 — Business Continuity / Disaster Recovery Plan

---

*This policy is subject to annual review. The Security Lead must ensure that encryption requirements are technically enforced and not merely documented. Any deviation from approved algorithms or key management practices requires a documented exception with Leadership approval.*
