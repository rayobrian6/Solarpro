# HANDOFF — Compliance Policies v1 (Sprint 1 foundation)

**Status:** Drafted, **NOT PUSHED**, awaiting review and signature.
**Author:** Mavis / compliance-lead via legal-writer
**Date:** 2026-08-15
**Per:** F-13 handoff convention (see prior `HANDOFF_*.md` files at repo root).

---

## What was done

Drafted the **5 foundational compliance policies** for Solarpro's SOC 2 Type 1 / ISO 27001 / 27701 / 27017 program, in `compliance/policies/`:

| # | File | Title | Size | Status |
|---|---|---|---|---|
| 01 | `compliance/policies/01-information-security.md` | Information Security Policy | 7.8 KB | Drafted, awaiting signature |
| 02 | `compliance/policies/02-acceptable-use.md` | Acceptable Use Policy | 7.7 KB | Drafted, awaiting signature |
| 03 | `compliance/policies/03-access-control.md` | Access Control Policy | 10 KB | Drafted, awaiting signature |
| 04 | `compliance/policies/04-data-classification-handling.md` | Data Classification & Handling Policy | 12 KB | Drafted, awaiting signature |
| 05 | `compliance/policies/05-incident-response.md` | Incident Response Plan | 16 KB | Drafted, awaiting signature |
| — | `compliance/policies/README.md` | Policy library index | 3.7 KB | Drafted |
| — | `compliance/policies/REVIEW_PROCESS.md` | How policies get reviewed | 6.1 KB | Drafted |
| — | `compliance/incidents/` | Empty directory (ready for the first PIR) | — | Created |

**Total**: 8 files, ~63 KB of policy content, written in plain English per James's preference for non-preachy direct language.

### Design choices

1. **Header table format** (not YAML frontmatter). The user spec called for a "Policy / Version / Effective date / Owner / Approver / Last reviewed / Next review / Scope" header, which is the most readable format for a 3-person team and matches James's preference for direct, scannable docs. If a future compliance platform import needs YAML, conversion is a 5-minute script.

2. **Concrete, not template.** Every policy names Raymond O'Brien as CISO, James Carpenter as management sign-off, and Cody as technical lead. No `[INSERT NAME HERE]` placeholders. The team-of-three is the actual operating reality, and the policies say so.

3. **Actual operating practice, not aspirational.** Where the control matrix documents a gap (e.g. 178/293 routes still need rate limits), the policies call that out honestly rather than pretending it doesn't exist. The Access Control Policy §7 explicitly references the 2026-08-12 rate-limiter fail-open incident. The Incident Response Plan §5 has worked examples for the five scenarios most likely to occur on this stack.

4. **Plain English, not legalese.** The AUP and Info Sec policy avoid "shall" / "must" / "will be" boilerplate. Direct verbs, short sentences, no scolding tone. James's preference.

5. **Specific controls, not generic statements.** Every policy footer cross-references the specific control IDs it satisfies (e.g. SOC 2 CC6.1, CC6.2, CC6.3 for Access Control). The full mapping lives in `compliance/CONTROL_MATRIX.md`.

6. **The 24-hour deprovisioning SLA** that James committed to in the access-control section is codified in the Access Control Policy §3.3, with a hard quarterly-quarter-hour example ("5pm Friday → 5pm Saturday").

7. **The 5-business-day PIR SLA** for post-incident review is codified in the Incident Response Plan §4.5.

8. **NIST 800-63B-style password requirements** (12+ chars, no composition rules, no forced rotation) are in the Access Control Policy §4.1.

9. **72-hour breach notification** to supervisory authority (GDPR Art. 33) and "without undue delay" to data subjects (Art. 34) are in the Incident Response Plan §5.5.

## What needs to happen next

### Who reviews

- **Raymond O'Brien (CISO)** reviews the technical accuracy of all 5 policies. This is a 30-45 minute read. Comments go in a PR.
- **James Carpenter (CEO)** reviews for management sign-off and merges. This is a 15-20 minute skim if Raymond's review is clean.

### What James needs to do

1. **Open a PR** titled `policy: initial 5-policy foundation` (or similar) that includes all 8 new files. Suggested base branch: `master`. Suggested reviewer: `raymond` (GitHub handle).
2. **Tag Raymond** for review. He has 2 business days.
3. **After Raymond's LGTM**, James merges. The merge commit is the audit artifact.
4. **Collect wet signatures** (or DocuSign equivalent) for the v1.0 signature blocks. SOC 2 and ISO 27001 accept git-based approval, but a wet signature is cleaner for the first issuance and a small amount of friction. Estimated time: 5 minutes per policy × 5 policies = 25 minutes.
5. **Update the policy headers** post-merge: change "Last reviewed" from 2026-08-15 to the merge date, leave "Next review" as 2027-08-15.
6. **Announce in Slack** (#announcements or team channel): "5 policy foundation is live. Read 01 (Information Security) and your role-specific one (Raymond: all 5; Cody: AUP + Access Control + IRP)."

### What Raymond needs to do

1. **Review each policy** for technical accuracy. The big things to check:
   - **01 Information Security**: roles in §4 match the actual org chart. The CISO/management sign-off split is correct. The risk management cadence is what he wants to operate against.
   - **02 Acceptable Use**: nothing in §5 contradicts how the team actually works (e.g. the AI-tool restriction in §5 is the one most likely to need a runtime exception for legitimate workflows).
   - **03 Access Control**: the 24h deprovisioning SLA, the 90-day admin expiry, and the quarterly UAR cadence are all operationally realistic. The rate-limiter section in §7 references the 2026-08-12 incident correctly.
   - **04 Data Classification**: the four classes match his mental model. The "production data in non-production" rule in §5 is the strictest part — confirm it's enforceable.
   - **05 Incident Response**: the role assignments (IC = Raymond, James = management sign-off + communications, Cody = technical) are operationally realistic. The five worked scenarios in §5 match the most likely real incidents.
2. **Leave a comment in the PR** with any changes. If no changes, "LGTM."

### What Cody needs to do

Nothing required. Cody is the technical lead and the policies apply to him, but the foundation set is not blocking on his review. When Sprint 2 lands the technical policies (Change Management, Logging & Monitoring, etc.), Cody will be in the review loop for those.

## The explicit gap

**25 more policies to draft in Sprint 2.** The full 30-policy target is in `compliance/PROGRAM.md` §5. The remaining 25, grouped by area:

**Information Security (1 remaining)**
- Password & Authentication Policy (the Access Control Policy references it but it should stand alone; Sprint 1 time pressure deferred it)
- Encryption & Key Management Policy

**Operations (6)**
- Change Management Policy
- Business Continuity & Disaster Recovery Plan (with RTO/RPO targets)
- Backup & Recovery Policy
- Logging & Monitoring Policy
- Vulnerability Management Policy
- Patch Management Policy

**Personnel (4)**
- Code of Conduct
- Employee Onboarding/Offboarding Policy (the 24h rule is in Access Control; this expands to the full lifecycle)
- Security Awareness & Training Policy
- Background Check Policy

**Vendor & Third Party (3)**
- Vendor Risk Management Policy
- Third-Party Service Provider Policy
- Software Bill of Materials (SBOM) Policy

**Privacy / ISO 27701 (4)**
- Privacy Policy (external-facing, for `/privacy` route)
- Data Subject Rights Policy
- Data Retention & Disposal Policy
- Privacy Impact Assessment Policy

**Cloud / ISO 27017 (3)**
- Cloud Services Security Policy
- Shared Responsibility Matrix (names Vercel/Neon/Render/Cloudflare responsibilities)
- Virtual Environment Security Policy

**Compliance & Audit (3)**
- Risk Assessment Policy
- Statement of Applicability (SoA) — for ISO 27001
- Audit & Monitoring Policy

**Sprint 2 timeline:** 2026-09-03 → 2026-10-15 (per `compliance/PROGRAM.md` §2). Estimated effort: 65 person-hours (per `compliance/SELF_BUILT_SETUP.md` §4). Owner: legal-writer agent, with Raymond as the technical reviewer.

## Risks and open questions

1. **The AUP §5 prohibition on AI tools** for customer data is strict. If Cody or James has a workflow that legitimately needs to send a redacted survey extract to Claude for analysis, an exception per §5 is the path. No current workflow needs this, but flagging for visibility.

2. **The Data Classification Policy §5** "no production data in non-production" rule is the strictest part of the policy. The current state of the test fixtures and demo data is not yet audited against this rule. Recommend a follow-up audit (Sprint 1 or 2) to identify any fixtures using real customer data.

3. **The Access Control Policy §4.2** requires MFA on production database access. Currently `compliance_ro` is the only Neon read-only role and it does not enforce MFA. The MFA enforcement is at the application level, not the DB level. This is a known gap; the policy documents the intent; the implementation may need to follow.

4. **The Incident Response Plan §3** has no designated backup IC. If Raymond is unreachable AND James is unreachable AND there's a Sev1, the plan stalls. For a 3-person team, this is an accepted risk; documenting for visibility. A contracted incident-response firm (TBD, Sprint 2) is the planned external backstop.

5. **The 90-day admin expiry** in the Access Control Policy §5.2 is a new operational discipline. The first expiration wave will hit ~2026-11-15. Recommend adding a calendar reminder 7 days before each wave.

6. **The "Last reviewed 2026-08-15"** date in the policy headers reflects the drafting date. The actual review (and last-reviewed date) is the PR merge date. Recommend updating the headers as a post-merge commit.

## Files written

```
C:\Users\carpe\Solarpro\
├── compliance\
│   ├── incidents\          (empty dir, ready for first PIR)
│   └── policies\
│       ├── 01-information-security.md
│       ├── 02-acceptable-use.md
│       ├── 03-access-control.md
│       ├── 04-data-classification-handling.md
│       ├── 05-incident-response.md
│       ├── README.md
│       └── REVIEW_PROCESS.md
└── HANDOFF_COMPLIANCE_POLICIES_V1.md   (this file)
```

## Cross-references

- `compliance/PROGRAM.md` §5 — full 30-policy scope, 5 done in Sprint 1.
- `compliance/CONTROL_MATRIX.md` — 78 controls, current state, evidence sources.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture.
- `compliance/STATUS_SPRINT0_GAP_SYNTH.md` — Sprint 0 status.

---

**End of handoff. Authored 2026-08-15. Awaiting Raymond's review and James's merge.**
