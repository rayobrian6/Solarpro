# SolarPro Tax Information Audit Report
## Based on P.L. 119-21 (One Big Beautiful Bill Act, signed July 4, 2025)

---

## CRITICAL FINDINGS

### Law Change Summary
- **P.L. 119-21** repealed IRC §25D (Residential Clean Energy Credit) for ALL expenditures after 12/31/2025
- **IRC §25D(h)** phase-down schedule (30%→26%→22%) is now MOOT — credit eliminated before phase-down
- **IRS FAQ FS-2025-05** (Aug 21, 2025): Installation must be COMPLETE by 12/31/2025 — no grandfathering by contract/payment date
- **Commercial §48E** still exists but with aggressive new deadlines (BOC before 7/4/2026)
- Source: CRS Report R48611, K&L Gates alert 7/23/2025, IRS.gov FS-2025-05

---

## FILES REQUIRING CHANGES

### 1. app/proposals/page.tsx — CRITICAL (customer-facing proposal)
- Line 556: "Federal Tax Credit (30%)" — INCORRECT for 2026+ installs
- Line 612: "30% Federal Tax Credit" heading — INCORRECT
- Line 614: "extended...through 2032" — INCORRECT (repealed 12/31/2025)
- Line 618: "30%" large display — INCORRECT
- Line 624: "30% through 2032 → 26% in 2033 → 22% in 2034" — INCORRECT (moot)
- Line 625: "Commercial (Sec. 48)" — needs §48E update
- Line 637: "Your estimated ITC (30%...)" — INCORRECT
- Line 710: "30% Federal ITC" stat — INCORRECT

### 2. app/page.tsx — HIGH (landing page, marketing)
- Line 28-29: "30% ITC + SREC Calculator" feature — needs update
- Line 138: "30% Federal ITC + SREC Income Estimates" banner — INCORRECT
- Line 168: "30% Federal ITC" stat — INCORRECT
- Line 201-202: "30% Investment Tax Credit...Extended through 2032" — INCORRECT

### 3. components/design/DesignSidebar.tsx — HIGH (live design tool)
- Line 286: "Federal Tax Credit (30%)" in cost breakdown — INCORRECT

### 4. components/design/DesignStudio.tsx — HIGH (live design tool)
- Line 1729: "Federal Tax Credit (30%)" — INCORRECT

### 5. lib/db.ts — MEDIUM (default config)
- Line 550: taxCreditRate: 30 — should be 0 for residential, note for commercial

### 6. lib/pvwatts.ts — MEDIUM (calculation engine)
- Lines 292-326: taxCreditRate calculation — needs disclaimer logic

### 7. app/admin/pricing/page.tsx — MEDIUM (admin config)
- Line 102: desc 'ITC rate (currently 30%)' — INCORRECT

### 8. lib/proposalPDF.ts — HIGH (PDF output)
- Line 170: "Federal Tax Credit (30%)" in PDF — INCORRECT

### 9. app/auth/register/page.tsx — LOW (registration page)
- Line 10: "30% ITC calculator" feature bullet — needs update

### 10. app/auth/subscribe/page.tsx — LOW (pricing page)
- Lines 25,49,73,251: "ITC & SREC calculator" / "30% federal credit" — needs update

---

## CORRECTION STRATEGY

### For Residential Proposals (primary use case):
- Remove "30% Federal ITC" as a financial benefit for 2026+ installs
- Add accurate notice: "Federal residential ITC (§25D) was repealed by P.L. 119-21 for installations after 12/31/2025"
- Redirect focus to: state incentives, net metering, SREC income, utility savings
- Keep ITC calculator but make it conditional on install year

### For Commercial Proposals:
- §48E still available — begin construction before 7/4/2026
- Note prevailing wage requirements for full 30%
- Add disclaimer about foreign entity restrictions

### For Marketing/Landing Page:
- Update feature descriptions to "State & Local Incentive Calculator"
- Keep SREC income as a selling point (still valid)
- Add note about consulting tax professional

---