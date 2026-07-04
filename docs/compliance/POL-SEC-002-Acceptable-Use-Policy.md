# POL-SEC-002 — Acceptable Use Policy

**Document ID:** POL-SEC-002  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Annual  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Purpose

This policy defines the acceptable use of SolarPro information systems, networks, devices, and data. It establishes boundaries for all personnel — employees, contractors, temporary workers, and any entity granted access to SolarPro resources — to ensure that company assets are used responsibly, securely, and in compliance with applicable laws and contractual obligations.

## 2. Scope

This policy applies to:

- All SolarPro-owned or leased hardware, software, networks, and cloud infrastructure
- All personal devices used to access SolarPro systems (BYOD)
- All accounts, credentials, and access tokens issued by or for SolarPro
- All data processed, stored, or transmitted using SolarPro resources
- All personnel with access to any SolarPro system, including employees, contractors, vendors, and temporary workers

## 3. General Use Principles

### 3.1 Business Use Only

SolarPro resources are provided primarily for business purposes. Limited personal use is permitted provided it does not:

- Interfere with work responsibilities or system performance
- Consume excessive network bandwidth or storage resources
- Violate any policy, law, or contractual obligation
- Create security vulnerabilities or exposure of company data

### 3.2 No Expectation of Privacy

All activity on SolarPro-owned systems, networks, and accounts is subject to monitoring. Personnel should have no expectation of privacy when using company resources. SolarPro reserves the right to inspect, log, review, and monitor all activity on its systems without prior notice, to the extent permitted by law.

### 3.3 Accountability

Every action performed on SolarPro systems must be traceable to an individual. Shared accounts are prohibited. All personnel are responsible for actions taken under their credentials and must not share, loan, or transfer their accounts to others.

## 4. Acceptable Use by Category

### 4.1 Computing Devices

| Action | Permitted | Conditions |
|--------|-----------|------------|
| Installing approved business software | Yes | Must be from approved sources only |
| Installing personal software | Limited | Must not compromise security or performance |
| Connecting personal USB devices | No | USB storage devices are prohibited |
| Disabling security software (antivirus, EDR) | No | Never permitted |
| Modifying system security settings | No | Must be performed by authorized IT |
| Leaving devices unattended while unlocked | No | Screen lock must engage within 5 minutes |

### 4.2 Network and Internet

| Action | Permitted | Conditions |
|--------|-----------|------------|
| Browsing business-related websites | Yes | — |
| Accessing personal email/webmail | Limited | Not from company-issued accounts |
| Using VPN for remote access | Required | All remote access must use VPN |
| Downloading files from untrusted sources | No | Must be scanned and verified |
| Peer-to-peer file sharing (BitTorrent, etc.) | No | Prohibited under all circumstances |
| Circumventing network security controls | No | Including proxy avoidance tools |
| Connecting to public Wi-Fi without VPN | No | All Wi-Fi access must go through VPN |

### 4.3 Email and Communications

| Action | Permitted | Conditions |
|--------|-----------|------------|
| Business email communication | Yes | — |
| Personal email on personal devices | Yes | Must not involve company data |
| Opening attachments from unknown senders | No | Report to Security Lead if suspicious |
| Auto-forwarding company email to external | No | Prohibited without written approval |
| Sending Restricted or Confidential data unencrypted | No | Must use approved encryption |
| Using company email for personal commercial activity | No | — |

### 4.4 Cloud Services and SaaS

Personnel must only use company-approved cloud services for storing, processing, or sharing SolarPro data. The use of unapproved cloud services (also known as "shadow IT") for company data is prohibited.

**Approved Services:**
- **Hosting/Deployment:** Vercel (SolarPro tenant)
- **Database:** Neon PostgreSQL (SolarPro tenant)
- **Source Code:** GitHub (SolarPro organization)
- **Payments:** Stripe (SolarPro account)
- **Monitoring:** Sentry (SolarPro project)
- **Email Delivery:** Resend (SolarPro account)
- **AI/ML Services:** Anthropic API, OpenAI API (SolarPro accounts)
- **Cloud Storage/Compute:** Google Cloud Platform (SolarPro project)
- **Communication:** Company-approved Slack workspace

Any new cloud service must be approved through the Vendor Risk Management process (POL-SEC-008) before any company data is processed on it.

### 4.5 Source Code and Development

| Action | Permitted | Conditions |
|--------|-----------|------------|
| Committing code to SolarPro repositories | Yes | Must follow Change Management (POL-SEC-006) |
| Forking or copying code to personal repositories | No | Company code stays in company repos |
| Hardcoding secrets, API keys, or credentials | No | Use environment variables exclusively |
| Pushing to production without review | No | Requires approved PR per POL-SEC-006 |
| Running penetration tests without authorization | No | Must be approved by Security Lead |
| Using AI code assistants on company code | Limited | Must not expose Confidential data to third-party AI |

### 4.6 Data Handling

- Data must be handled according to its classification level per POL-SEC-004 (Data Classification Policy)
- Restricted data (Tier 1) must never be stored on local devices, personal accounts, or unapproved services
- Confidential data (Tier 2) must be encrypted in transit and at rest
- Customer data must only be accessed on a need-to-know basis consistent with the user's role
- Data must not be copied to unauthorized locations or devices

## 5. Prohibited Activities

The following activities are strictly prohibited and may result in immediate termination of access and further disciplinary or legal action:

1. **Unauthorized access** — Attempting to access systems, data, or accounts without authorization, including attempting to circumvent access controls
2. **Data theft or exfiltration** — Copying, transmitting, or removing company data without authorization
3. **Malware introduction** — Deliberately or recklessly introducing malicious software into SolarPro systems
4. **Denial of service** — Actions intended to disrupt the availability of SolarPro systems or any external system
5. **Social engineering** — Using deception to obtain unauthorized access to information or systems
6. **Credential sharing** — Sharing passwords, API keys, access tokens, or other authentication materials with any other person
7. **Eavesdropping or interception** — Intercepting network traffic, communications, or data not intended for the individual
8. **Unauthorized monitoring** — Running packet sniffers, keyloggers, or network monitoring tools without written Security Lead approval
9. **Intellectual property violation** — Using or distributing software, media, or content in violation of copyright, license, or intellectual property rights
10. **Harassment or illegal content** — Using SolarPro systems to create, store, or distribute harassing, discriminatory, or illegal content
11. **Cryptomining** — Running cryptocurrency mining software on SolarPro systems
12. **Circumventing audit controls** — Disabling, modifying, or interfering with logging, monitoring, or audit systems

## 6. Personal Devices (BYOD)

Personnel who use personal devices to access SolarPro systems must:

- Maintain current operating system and application patches
- Enable device-level authentication (PIN, biometric, or password)
- Install and maintain approved endpoint security software if required
- Enable remote wipe capability for company data
- Not store Restricted (Tier 1) data on personal devices
- Not allow family members or others to use devices while SolarPro sessions are active
- Report loss or theft of the device within 1 hour to the Security Lead

SolarPro reserves the right to revoke BYOD access privileges and, in the event of a security incident, to remotely wipe company data (but not personal data) from the device.

## 7. Remote Work

Personnel working remotely must:

- Use VPN for all access to SolarPro internal systems
- Ensure their home network uses WPA2 or WPA3 encryption with a strong password
- Not use public Wi-Fi without VPN active
- Position screens to prevent shoulder surfing in shared spaces
- Lock devices when stepping away, even in home offices
- Not allow household members to observe or access SolarPro systems
- Follow all the same policies as on-premises workers

## 8. Social Media and Public Communication

- Personnel must not disclose Confidential or Internal information on social media
- Speaking on behalf of SolarPro requires Leadership approval
- Vulnerabilities, incidents, or security details must never be discussed publicly without Communications Lead authorization per POL-SEC-005
- Screenshots of internal systems must not be posted publicly

## 9. Enforcement and Violations

### 9.1 Reporting Violations

All personnel must report suspected violations of this policy to the Security Lead. Reports can be made via:

- Direct communication with the Security Lead
- Slack #security channel
- Incident reporting process per POL-SEC-005

Reports of violations will be treated confidentially to the extent possible. Retaliation against individuals who report violations in good faith is strictly prohibited.

### 9.2 Investigation and Consequences

Violations will be investigated by the Security Lead in coordination with Leadership. Depending on the severity and nature of the violation, consequences may include:

- Verbal or written warning
- Mandatory security awareness retraining
- Temporary suspension of access privileges
- Permanent revocation of access privileges
- Termination of employment or contract
- Civil or criminal legal action

All violations and their resolution will be documented in the Incident Register per POL-SEC-005.

## 10. Policy Maintenance

| Activity | Frequency | Responsible |
|----------|-----------|-------------|
| Full policy review | Annual | Security Lead |
| Approved services list update | Quarterly | Security Lead |
| Violation trend analysis | Quarterly | Security Lead |
| Personnel acknowledgment | At onboarding + annually | HR / Security Lead |

## 11. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-003 — Access Control Policy
- POL-SEC-004 — Data Classification Policy
- POL-SEC-009 — Password & Authentication Policy
- POL-SEC-010 — Encryption Policy

---

*All personnel must acknowledge receipt and understanding of this policy. Acknowledgment records are maintained by the Security Lead and reviewed during access audits.*
