# SolarPro Sub-Processor Register

**Document ID:** VND-001  
**Version:** 1.0  
**Last Updated:** July 2025  
**Review Cadence:** Quarterly  
**Owner:** Security Lead  

---

## Purpose

This register discloses all sub-processors and third-party vendors that process, store, or transmit SolarPro customer data. This disclosure is required by GDPR Article 28, SOC 2 CC9.2, and ISO 27001 A.15.1, and supports customer due diligence.

## Infrastructure & Hosting

| Vendor | Service | Data Processed | Location | Certifications | DPA Status |
|--------|---------|---------------|----------|----------------|------------|
| Vercel Inc. | Application hosting, CDN, deployment | Application code, deployment configs, visitor IPs, analytics | United States (global edge) | SOC 2 Type II | Standard Vercel DPA |
| Neon Database | PostgreSQL hosting | All customer data (projects, users, financial records) | United States | SOC 2 Type II (in progress) | Standard Neon DPA |
| Google Cloud Platform | Cloud compute, storage, secrets management | Varies by usage; backup storage | United States (multi-region) | SOC 2 Type II, ISO 27001, FedRAMP | Standard Google DPA |
| GitHub (Microsoft) | Source code hosting, CI/CD | Source code, CI secrets | United States | SOC 2 Type II, ISO 27001 | Standard GitHub DPA |

## Payment Processing

| Vendor | Service | Data Processed | Location | Certifications | DPA Status |
|--------|---------|---------------|----------|----------------|------------|
| Stripe Inc. | Payment processing, billing | Customer PII (name, email), payment card data | United States | PCI DSS Level 1, SOC 2 Type II, ISO 27001 | Standard Stripe DPA |

## Communication

| Vendor | Service | Data Processed | Location | Certifications | DPA Status |
|--------|---------|---------------|----------|----------------|------------|
| Resend Inc. | Transactional email delivery | Email addresses, email content | United States | SOC 2 Type II (in progress) | Standard Resend DPA |

## Monitoring & Observability

| Vendor | Service | Data Processed | Location | Certifications | DPA Status |
|--------|---------|---------------|----------|----------------|------------|
| Sentry Inc. | Error monitoring, performance tracking | Error logs, browser metadata, user IP (configurable) | United States (EU available) | SOC 2 Type II | Standard Sentry DPA |

## AI / Machine Learning

| Vendor | Service | Data Processed | Location | Certifications | DPA Status |
|--------|---------|---------------|----------|----------------|------------|
| Anthropic Inc. | AI/ML API (Claude) | Engineering prompts (zero-data-retention enabled) | United States | SOC 2 Type II | Anthropic API DPA |
| OpenAI Inc. | AI/ML API (GPT) | Engineering prompts (zero-data-retention enabled) | United States | SOC 2 Type II | OpenAI API DPA |

## Data Classification Exposure

| Classification Tier | Vendors with Access |
|---------------------|-------------------|
| Tier 1 — Restricted (secrets, API keys) | Vercel (env vars), GitHub (CI secrets), GCP (Secret Manager) |
| Tier 2 — Confidential (customer PII, engineering data) | Neon, Stripe, Resend, Sentry, Anthropic*, OpenAI* |
| Tier 3 — Internal (docs, code, logs) | Vercel, GitHub, Sentry, GCP |
| Tier 4 — Public (marketing, published policies) | None (public by definition) |

*Anthropic and OpenAI have zero-data-retention enabled, meaning they do not persist prompts after API response generation.

## Sub-Processor Changes

SolarPro will notify customers of new sub-processors or changes to existing sub-processors via:
- Email notification to organization administrators (14 days before change)
- Update to this register (with change date noted)
- Customers may object to sub-processor changes within 14 days of notification

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| July 2025 | Initial register created | Compliance documentation |

---

*This register is maintained by the Security Lead and reviewed quarterly. Any changes to sub-processors must be approved through the Vendor Risk Management process (POL-SEC-008) before the vendor gains access to SolarPro data.*
