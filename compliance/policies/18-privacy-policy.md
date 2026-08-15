# Privacy Policy

| Field | Value |
|---|---|
| **Policy** | POL-PRV-001 — Privacy Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-07-30 |
| **Next review** | 2027-07-30 (annual) or on material change (new sub-processor, new data type, new regulator guidance) |
| **Scope** | Every person whose personal information Solarpro processes, including Solarpro account holders (solar installers and their staff), the homeowners whose properties appear in surveys and aerial photos, and any other individual whose information appears in a Solarpro dataset. This policy is the customer-facing notice; the internal handling rules are in the Data Classification & Handling Policy (POL-IS-003) and the Data Subject Rights Policy (POL-PRV-002). |

**Public URL when published:** `https://solarpro.app/privacy`
**Last updated:** 2026-07-30
**Contact:** `privacy@solarpro.app`

---

> **Note on tone.** This policy is published at `/privacy` and linked from the Trust Center. It is the version the customer reads. The legal-style header (above) is for the auditor; the body (below) is for the customer. Both are the same document. The two voices are split so the customer-facing content is plain and short, and the auditor-facing metadata is in the header.

---

## 1. Who we are

**Solarpro** is a software-as-a-service product operated by **Solarpro** (the legal entity is Solarpro LLC, a single-member LLC owned by James Carpenter, with a registered address in Illinois, USA). The product helps solar installers turn rooftop photos and utility data into permit-grade plan-sets and bills of materials. The full company information is available on request to `privacy@solarpro.app`.

When this policy says "we," "us," or "Solarpro," it means Solarpro LLC.

## 2. What this policy covers

This policy describes:

- What personal information we collect.
- How we use it.
- Who we share it with.
- How long we keep it.
- Your rights over it.
- How to contact us.

This policy applies to every Solarpro user — the solar installer who creates an account, the installer's staff who log in, the homeowner whose roof appears in a survey, and anyone else whose personal information ends up in a Solarpro dataset.

If you are a **homeowner** whose property appears in a survey conducted by a Solarpro customer (a solar installer), this policy describes how we handle your information. Most of your interactions with Solarpro are through the installer who created the survey, not directly with us. If you want to exercise your rights (access, correction, deletion), the process is in §7 below.

## 3. What personal information we collect

We collect three categories of personal information. The categories correspond to the three ways data ends up in Solarpro.

### 3.1 Account information

When you create a Solarpro account, you provide:

- **Name** (first and last)
- **Email address** (used as your login and for transactional email)
- **Company name** (the solar installation company you work for)
- **Phone number** (optional; used for account-recovery and urgent security notifications)
- **Password** (stored as a bcrypt hash; we do not store the plaintext password)

If you are a member of a Solarpro customer organization, your account is created by the organization owner. The same fields apply.

### 3.2 Roof and site data

When you (or a customer of yours) use Solarpro to create a survey, we collect:

- **Property address** (the address of the home or building being surveyed)
- **Aerial photos** (satellite and aerial imagery from Google, Nearmap, and Eagleview)
- **Roof photos** (photos taken at the site — these may incidentally contain people, vehicles, and license plates)
- **Roof measurements** (derived from the photos, not directly entered)
- **Utility data** (the property's utility account number, usage history, and tariff information, retrieved from the utility via the AHJ / utility data vendors)
- **Inspector notes** (text fields where the inspector records site conditions, roof material, electrical service, and obstructions)
- **Site GPS coordinates** (captured at survey time; stripped from photos on upload)

If a homeowner visits the survey page and interacts with it (for example, to confirm the address), we also collect the homeowner's name, email, and any text they enter.

### 3.3 Payment information

When you pay for a Solarpro subscription, the payment is processed by **Stripe**. We do not see or store your card number, expiration date, or CVV. Stripe shares with us:

- Your name
- Your billing address
- The last 4 digits of the card used
- The card brand (Visa, Mastercard, etc.)
- The Stripe customer ID (so we can manage your subscription)

Stripe's handling of your payment information is governed by the [Stripe Privacy Policy](https://stripe.com/privacy), not this one.

### 3.4 What we do NOT collect

We do not knowingly collect:

- **Personal information from children under 13.** Solarpro is a business-to-business product. We do not direct it to children, and we do not knowingly collect personal information from anyone under 13. If you believe we have collected information from a child under 13, contact `privacy@solarpro.app` and we will delete it within 5 business days.
- **Special categories of personal information** (race, religion, health, sexual orientation, biometric data for identification). Roof photos may incidentally contain license plates or faces; these are not the purpose of the collection, but if you see one in a survey and would like it redacted, contact us.
- **Government identifiers** (SSN, passport, driver's license) for any reason other than identity verification as part of a background check, which is a separate process described in our Background Check Policy (POL-HR-014) and applies only to Solarpro employees and contractors.

## 4. How we use your personal information

We use the information we collect for the following purposes. The "legal basis" column refers to the GDPR Article 6 legal basis; the equivalent US-law basis (CCPA, etc.) is "the consumer's reasonable expectation at the point of collection."

| Purpose | Categories used | Legal basis (GDPR) |
|---|---|---|
| **Provide the Solarpro service** — create your account, run surveys, generate plan-sets and bills of materials, store your projects | Account, Roof/site, Payment | Contract performance (Art. 6(1)(b)) |
| **Process your payment** and manage your subscription | Payment | Contract performance (Art. 6(1)(b)) |
| **Send transactional email** — account verification, password reset, security alerts, important service announcements | Account | Contract performance (Art. 6(1)(b)) + Legitimate interest (Art. 6(1)(f)) for security alerts |
| **Send product update email** — release notes, new feature announcements, tips for using Solarpro. You can opt out of every email except transactional. | Account | Consent (Art. 6(1)(a)) — opt-in at signup, opt-out anytime |
| **Customer support** — respond to your questions, troubleshoot, fix bugs you report | Account, Roof/site (only the survey you reference) | Contract performance (Art. 6(1)(b)) |
| **Improve the product** — analyze aggregate usage patterns to find features that are not used and features that are over-used, identify slow pipelines, prioritize engineering work. **The analysis is aggregate; we do not analyze your individual surveys for this purpose.** | Roof/site (aggregate only) | Legitimate interest (Art. 6(1)(f)) |
| **Train the vision model** — we **do not** train any AI model on your aerial photos, roof photos, or site data. Your data is your data. Vision API calls to OpenAI and Anthropic (see §5) are inference-only and are governed by those vendors' "no training" terms. | n/a | n/a |
| **Comply with legal obligations** — respond to lawful requests from law enforcement, courts, and regulators; maintain the records we are required to keep | Account, Payment | Legal obligation (Art. 6(1)(c)) |
| **Establish, exercise, or defend legal claims** | All | Legitimate interest (Art. 6(1)(f)) |
| **Audit and security** — detect abuse, prevent fraud, investigate incidents, comply with our own security policies | All | Legitimate interest (Art. 6(1)(f)) |

We do **not**:

- Sell your personal information to anyone, for any purpose, at any price. (CCPA "Do Not Sell" is the default; the GDPR equivalent is "no marketing sale.")
- Use your aerial photos, roof photos, or site data to train any AI model. (Inference is via OpenAI / Anthropic; their terms prohibit training on API inputs.)
- Serve you advertising based on your Solarpro activity. (We do not run ad networks; the only third-party scripts on Solarpro are listed in §6.)
- Share your personal information with social media platforms, data brokers, or marketing companies.

## 5. Who we share your personal information with

We share your personal information with a small set of subprocessors — companies that process data on our behalf. Every subprocessor is bound by a Data Processing Agreement that requires them to protect your information to at least the standard we apply ourselves. The full list is at `https://solarpro.app/trust/sub-processors` (and the internal register is at `compliance/vendors.csv`).

The subprocessor list as of the last updated date:

| Subprocessor | Purpose | Data shared |
|---|---|---|
| **Vercel Inc.** | Application hosting | All customer data in transit and at rest in the application |
| **Neon Inc.** | Database hosting (Postgres) | All production data, including account and roof/site data |
| **Render** | Python service hosting (SAM2) | Aerial photos, model inputs and outputs |
| **OpenAI** | Vision API (GPT-4o) | Aerial photos, prompt context (inference only; no training) |
| **Anthropic** | Vision API (Opus 4.8, Sonnet 4.5) | Aerial photos, prompt context (inference only; no training) |
| **Google LLC** | Solar API (aerial imagery), Maps geocoding | Aerial photos, address |
| **Stripe, Inc.** | Payment processing | Name, billing address, card token (PCI DSS scope is Stripe's) |
| **Resend** | Transactional email | Email address, name |

We also share personal information when required by law (subpoenas, court orders, lawful national-security requests) or when necessary to protect our rights, your rights, or the safety of others. In any such case, we will:

- Notify you before disclosing, unless the law specifically prohibits us from doing so (e.g. a sealed court order).
- Limit the disclosure to the minimum necessary to comply.
- Document the request and the response in our incident log.

We do **not** share your personal information with:

- Social media platforms or advertising networks.
- Data brokers or marketing companies.
- Any third party for their own purposes (we share only with subprocessors acting on our behalf).

If a subprocessor changes — if we add a new one, replace an existing one, or change what data they receive — we will update the list above and notify active customers at least 30 days in advance (per the Privacy Policy §8 "Changes" and the Third-Party Service Provider Policy §7.1 step 8).

## 6. Cookies and tracking

Solarpro uses a minimal set of cookies and similar technologies. The list below is the entire set; if we add a new one, this section is updated and a banner is shown to existing users on their next visit.

| Cookie | Purpose | Type | Duration |
|---|---|---|---|
| **`solarpro-session`** | Authenticates your session | Strictly necessary | Session |
| **`solarpro-csrf`** | CSRF token (defense against cross-site request forgery) | Strictly necessary | Session |
| **`solarpro-mfa`** | Remembers MFA enrollment status | Strictly necessary | 30 days |
| **`solarpro-pref`** | Remembers your UI preferences (theme, sidebar state) | Functional | 1 year |
| **Cloudflare `__cf_bm`** | Bot management for the application | Strictly necessary | 30 minutes |
| **Stripe `__stripe_mid`, `__stripe_sid`** | Fraud prevention for payments | Strictly necessary | 1 year / 30 minutes |

We do **not** use Google Analytics, Meta Pixel, Hotjar, Segment, Mixpanel, or any third-party analytics or advertising tool. The cookies listed above are the only ones set by Solarpro.

**How to manage cookies.** Most browsers let you block or delete cookies. The "strictly necessary" cookies above cannot be disabled without breaking the service. The "functional" cookie (`solarpro-pref`) can be cleared from your browser's cookie settings; doing so resets your UI preferences but does not affect your account. For EU users, the cookie banner (when shown) gives you the same options: accept all, accept only strictly necessary, or manage individually.

**Do Not Track.** We honor the "Do Not Track" browser signal: when DNT is enabled, we do not set the `solarpro-pref` cookie.

## 7. Your rights

You have the following rights over your personal information. The rights are the GDPR Articles 15-22 rights (for EU data subjects) and the CCPA 1798.100-1798.130 rights (for California consumers). The Canadian PIPEDA equivalent is "the right to access and challenge accuracy" (PIPEDA s. 8(3)). We extend the same rights to every Solarpro user regardless of jurisdiction, because the operational cost of running one process is lower than running three.

| Right | What it means | How to exercise it |
|---|---|---|
| **Access** | Get a copy of the personal information we hold about you. | Email `privacy@solarpro.app`. We will respond within 30 days (GDPR standard) or 45 days (CCPA standard). |
| **Rectification** | Correct inaccurate personal information. | Edit it in your account settings, or email `privacy@solarpro.app` if you cannot edit it yourself. |
| **Erasure** ("right to be forgotten") | Have your personal information deleted. | Email `privacy@solarpro.app`. We will delete within 30 days, except where we are legally required to retain the data (e.g. tax records, permit records, ongoing legal hold). |
| **Restriction of processing** | Pause the processing of your personal information while a dispute is resolved. | Email `privacy@solarpro.app`. We will restrict within 5 business days and confirm. |
| **Data portability** | Get your personal information in a machine-readable format (JSON) so you can move it to another service. | Email `privacy@solarpro.app`. The export includes your account data, your projects, your surveys, and any documents you created. |
| **Objection** | Object to processing based on legitimate interest. | Email `privacy@solarpro.app` with the specific processing you object to. We will respond within 30 days. |
| **Withdraw consent** | Withdraw any consent you have previously given (e.g. for product-update email). | Click "unsubscribe" in any product-update email, or email `privacy@solarpro.app`. |
| **Opt out of sale** (CCPA) | Stop the "sale" of your personal information. We do not sell your information, so this is a no-op, but you can still exercise the right. | Email `privacy@solarpro.app`. |
| **Non-discrimination** (CCPA) | We will not deny service, charge a different price, or provide a different level of service because you exercised any of these rights. | n/a; this is a commitment. |
| **Lodge a complaint** with a supervisory authority | If you are in the EU, you can complain to your local data protection authority. If you are in California, you can complain to the California Attorney General. | We would prefer to hear from you first (see §10), but the right to complain to a regulator is preserved. |

The full process for exercising these rights — the intake, the verification, the fulfillment, the audit log — is in the **Data Subject Rights Policy (POL-PRV-002)**. The short version: email `privacy@solarpro.app`, tell us what you want, verify your identity, and we do the rest.

**Homeowners.** If you are a homeowner whose property appears in a survey conducted by a Solarpro customer, the same rights apply. The solar installer (the Solarpro customer) is the primary contact, but you can also contact us directly at `privacy@solarpro.app`. We will work with the installer to fulfill your request.

## 8. Data retention and deletion

We keep your personal information for as long as you have an account, plus a grace period to handle account closure, and a longer period for the records we are legally required to retain. The full retention schedule is in the **Data Retention & Disposal Policy (POL-PRV-003)**. The short version:

| Data category | Retention | Reason |
|---|---|---|
| **Account information** (while active) | For the life of the account | Service operation |
| **Account information** (after closure) | 30 days, then deleted | Grace period for reactivation |
| **Roof and site data** (projects, surveys, plan-sets, bills of materials) | For the life of the account + 7 years after last activity | Permit records, warranty, audit |
| **Payment records** (invoices, Stripe customer IDs) | 7 years after the transaction | Tax and accounting law |
| **Audit logs** (security events, access logs) | 1 year hot + 7 years cold | SOC 2 audit, incident investigation |
| **Backups** (Neon PITR, 7-day window) | 7 days rolling, then deleted | Disaster recovery |
| **Customer-requested deletion** | 30 days from request, with confirmation | GDPR Art. 17, CCPA 1798.105 |

**When we delete data, we delete it from production, from backups (after the 7-day PITR window expires), and from any subprocessor that holds a copy (per the contractual deletion commitment in our DPAs).** Cryptographic erasure (destroying the encryption key) is the method for encrypted backups where the data is not individually addressable.

## 9. How we protect your personal information

The short version: we use industry-standard controls, audited by external parties, and we publish a SOC 2-aligned posture page at `https://solarpro.app/trust`.

The long version is in our security and privacy policies at `compliance/policies/`, including:

- Information Security Policy (POL-IS-001)
- Access Control Policy (POL-IS-004)
- Data Classification & Handling Policy (POL-IS-003)
- Encryption & Key Management Policy (forthcoming)
- Incident Response Plan (POL-OP-002)
- Vendor Risk Management Policy (POL-VEN-001)
- Business Continuity & Disaster Recovery Plan (forthcoming)

The summary of the technical controls:

- **Encryption in transit**: TLS 1.2+ for every connection to Solarpro, every connection between Solarpro services, and every connection to a subprocessor.
- **Encryption at rest**: AES-256 for the production database (Neon default), AES-256 for the evidence store, AES-256 for backups.
- **Access control**: every Solarpro employee and contractor with access to customer data undergoes identity verification, MFA enrollment, and quarterly access reviews. Access is logged.
- **Incident response**: the Incident Response Plan (POL-OP-002) is tested annually. A PII breach is notified to the supervisory authority within 72 hours (GDPR Art. 33) and to affected data subjects "without undue delay" (GDPR Art. 34).
- **Vendor management**: every subprocessor is reviewed annually, has a current SOC 2 Type 2 report (where applicable), and is bound by a Data Processing Agreement.
- **Software supply chain**: an SBOM is produced for every production build (POL-IS-016); every build is scanned against the GitHub Security Advisories, NVD, and CISA KEV catalog.
- **Background checks**: every Solarpro employee and Tier A contractor undergoes a background check (POL-HR-014). The operational execution is currently the compensating-control variant (reference checks + firm attestation); the formal check resumes when the screening-vendor line item is funded.

## 10. International data transfers

Solarpro is based in the United States. If you are in the European Economic Area, the United Kingdom, or another jurisdiction with cross-border-transfer rules, your personal information is transferred to and processed in the United States. The transfer mechanisms we rely on:

- **For EU/EEA data subjects**: the European Commission's Standard Contractual Clauses (SCCs) are in our subprocessor agreements, and we conduct a Transfer Impact Assessment (TIA) on each subprocessor that processes EU data.
- **For UK data subjects**: the UK International Data Transfer Addendum to the EU SCCs, in our subprocessor agreements.
- **For Swiss data subjects**: the Swiss Federal Data Protection and Information Commissioner's standard contract clauses.

The current subprocessor list (§5) shows the jurisdictions where each subprocessor processes data. Most are US-based; a small number (Google, for the Solar API) may process data in the EU region depending on configuration.

If you have questions about a specific transfer, email `privacy@solarpro.app`.

## 11. Children

Solarpro is a business-to-business product. We do not direct it to children under 13, and we do not knowingly collect personal information from anyone under 13. If we learn that we have collected personal information from a child under 13, we will delete it within 5 business days. If you believe a child under 13 has provided personal information to Solarpro, email `privacy@solarpro.app`.

The US Children's Online Privacy Protection Act (COPPA) does not apply because we do not direct the service to children. The EU GDPR Article 8 sets the digital-consent age at 16 by default (with member states allowed to lower it to 13); the same position applies.

## 12. Changes to this policy

We will update this policy when our practices change, when we add or change a subprocessor, when a regulator issues new guidance, or annually — whichever comes first. The "Last updated" date at the top of this policy is the date of the most recent change. The full change history is in the **revision history** at the bottom of this document.

For material changes (a new data category, a new subprocessor in the customer-data path, a new purpose, a change in retention), we will notify active customers at least 30 days in advance by email and by an in-app banner. The 30-day notice is the same window we use for subprocessor changes (§5) and is the longest of any notice period required by any jurisdiction we operate in.

For non-material changes (a clarification, a typo, a new contact email), we update the policy and the change is reflected in the revision history; no advance notice is given.

## 13. How to contact us

**Privacy questions, data subject requests, complaints, comments:**

- **Email:** `privacy@solarpro.app`
- **Mail:** Solarpro LLC, Attn: Privacy, [registered address — provided on request to prevent web scraping]

**Security issues** (vulnerability reports, incidents):

- **Email:** `security@solarpro.app`
- **Disclosure policy:** see `https://solarpro.app/security` (forthcoming) or our coordinated-disclosure commitment in the Incident Response Plan (POL-OP-002).

**Data Protection Officer (DPO):** Solarpro does not have a formally designated DPO under GDPR Article 37 because the processing does not meet the threshold (we are not a public authority, the processing is not large-scale, and the data is not special-category). The privacy contact above is the operational equivalent.

**EU representative:** Not appointed (the GDPR Article 27 representative is not required for a US-based processor that does not target EU data subjects with a paid product or service; we are a B2B SaaS that may incidentally serve EU-based installers, which is below the threshold). For EU data-subject requests, the standard `privacy@solarpro.app` process applies.

**UK representative:** Not appointed (same reasoning as the EU representative).

## 14. Compliance framework

This policy is designed to satisfy:

- **EU GDPR** (Regulation 2016/679) — all data-subject rights, Article 6 legal basis, Article 28 processor terms, Article 32 security, Article 33 breach notification.
- **UK GDPR + DPA 2018** — the UK GDPR is the EU GDPR as retained in UK law, with the same obligations.
- **California CCPA / CPRA** (Cal. Civ. Code § 1798.100 et seq.) — right to know, right to delete, right to opt out of sale, right to non-discrimination, right to limit use of sensitive personal information.
- **Canada PIPEDA** — the federal private-sector privacy law; the equivalent rights are access (s. 8(3)) and challenge accuracy (s. 4.9).
- **Switzerland FADP** (revised 2023) — the federal data protection act; the rights are similar to the GDPR with the SCC equivalent being the Swiss SCCs.
- **SOC 2 Trust Services Criteria** — P-series (Privacy) for the privacy controls.
- **ISO 27001:2022** Annex A.5.34 (Privacy and protection of PII).
- **ISO 27701:2019** — the full PII controller cluster (clauses 6.x for the controller obligations, 7.x for the PIMS-specific guidance).

This is **not** a certification. We have not yet completed a SOC 2 Type 1 audit (target: Q4 2026) or an ISO 27001 / 27701 audit (target: 2027). The compliance framework above is the **target state**; the controls are in place but the external audit is pending. The Trust Center at `https://solarpro.app/trust` shows the current posture.

## 15. Related documents

- `compliance/policies/01-information-security.md` — the foundation; everything else references this.
- `compliance/policies/03-access-control.md` (POL-IS-004) — who can see what.
- `compliance/policies/04-data-classification-handling.md` (POL-IS-003) — how data is classified and handled internally.
- `compliance/policies/05-incident-response.md` (POL-OP-002) — what happens when something goes wrong, including the 72-hour breach notification.
- `compliance/policies/10-vendor-risk-management.md` (POL-VEN-001) — the SaaS / infrastructure side of the subprocessor list.
- `compliance/policies/16-third-party-service-provider.md` (POL-VEN-002) — the people side of the third-party list.
- `compliance/policies/19-data-subject-rights.md` (POL-PRV-002) — the operational process for access / erasure / portability requests.
- `compliance/policies/20-data-retention-disposal.md` (POL-PRV-003) — the full retention schedule.
- `compliance/vendors.csv` — the internal subprocessor register.
- `compliance/trust.json` — the public Trust Center data.
- `compliance/CONTROL_MATRIX.md` — the SOC 2 / ISO 27001 / ISO 27701 control mapping.

---

## Approval signatures (internal — for the auditor)

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-30 | compliance-lead (via legal-writer) | Initial issuance. Customer-facing privacy notice for Solarpro, designed to be published at `https://solarpro.app/privacy` and linked from the Trust Center. Covers account information, roof and site data, and payment information; explains the purposes and the GDPR Article 6 legal basis for each; lists the eight current subprocessors (Vercel, Neon, Render, OpenAI, Anthropic, Google, Stripe, Resend) with the data each receives; documents the minimal cookie set (no third-party analytics or advertising); sets out the GDPR Articles 15-22 / CCPA 1798.100-130 data-subject rights with a single 30-day response SLA; sets the retention schedule cross-referenced to POL-PRV-003; commits to no AI training on customer data, no sale of personal information, and no advertising. Compliance framework section clarifies that the framework is the **target state**; SOC 2 Type 1 audit is targeted for Q4 2026; ISO 27001/27701 for 2027. The policy is in force today; the external certification is the open work tracked in `PROGRAM.md`. |
