# SolarPro Platform — Comprehensive Audit Report
**Date:** June 2025 | **Branch:** `dev` | **Build:** v47.48+

---

## Executive Summary

SolarPro is an impressively deep platform with a strong engineering core — NEC-compliant SLD generation, a 3D design studio, BOM engine, proposal truth validation, ICA/PTO utility interconnection data, and a homeowner portal. However, there are meaningful gaps in security, UX polish, mobile experience, email automation, and competitive feature coverage that must close before this platform competes with top-tier solar CRMs (Aurora Solar, OpenSolar, Solargraf).

The shortcomings are organized below in priority order (P0 = critical, P3 = nice-to-have).

---

## P0 — Critical / Security

### 1. Homeowner Portal: Email-Only Login (No OTP / Magic Link)
**File:** `app/portal/login/page.tsx`, `app/api/portal/login/route.ts`, `lib/portalAuth.ts`

The portal login accepts **any email address and immediately issues a JWT session cookie** — no password, no one-time code, no magic link. If a homeowner's email is known (which it often is — it's in the proposal, in emails, on their business card), anyone can log into their portal and see their project status, documents, and financial info.

**Fix Required:**
- Add an OTP (6-digit code) emailed via Resend at login
- Verify code server-side before issuing the JWT session
- 10-minute expiry on the OTP
- The cookie flow can stay exactly as-is; just gate it behind OTP verification

**Competitive Gap:** Every comparable homeowner portal (Aurora Solar, Solargraf, SunPower customer portal) gates login with a verification code or magic link.

---

### 2. No Email Verification at Registration
**File:** `app/api/auth/register/route.ts`

Users can register with a fake email address and immediately access the platform. There is no email verification step before account activation. This enables spam account creation, bypasses billing controls, and means your installer email list is dirty.

**Fix:** Send a verification email at registration with a confirmation token. Block platform access until verified (or at minimum, show a persistent banner).

---

### 3. Admin Portal Login — No MFA / 2FA
**File:** `app/api/auth/login/route.ts`

Admin accounts have full access to all user data, all projects, the database migration tool, and the impersonation system. There is no multi-factor authentication. A compromised admin password = full platform compromise.

**Fix:** Implement TOTP (Google Authenticator / Authy style) for admin accounts. The `otplib` npm package makes this trivial to add.

---

## P1 — High Impact Business/UX

### 4. Homeowner Portal: No Stage-Advance Email Notifications to Homeowners
**File:** `lib/email.ts`, `app/api/admin/projects/[id]/route.ts`

When an admin advances a project's `homeowner_stage` (e.g., from `under_review` to `site_survey`, or `installation` to `completed`), **no email is sent to the homeowner**. They have to actively check the portal. In practice, homeowners don't log into portals regularly — they need to be pulled in via email.

**Fix:** Add a `sendStageAdvanceEmail()` function to `lib/email.ts`. Trigger it in the PATCH handler in `app/api/admin/projects/[id]/route.ts` whenever `homeowner_stage` changes. Include:
- The new stage name
- What it means for them (pull from `STAGE_CONTENT` map already in `portal/dashboard/page.tsx`)
- A direct link to their portal

**Impact:** This is the #1 homeowner experience improvement available.

---

### 5. Proposal Viewer: No "Send to Client" Email Workflow from the App
**File:** `app/proposals/page.tsx`, `app/api/proposals/[id]/route.ts`

Proposals have a `share_token` and a public URL (`/proposals/view/[id]?token=...`), but there is **no built-in way to email that link to the client from within the app**. The installer must manually copy the URL and paste it into their email client. This breaks the workflow and means there's no tracking of whether the email was delivered.

**Fix:** Add a "Send to Client" button on the proposals list and proposal detail views. Call a new API endpoint that:
1. Sends a branded email via Resend with the proposal link
2. Records `share_sent_at` and `share_sent_to` in the proposal's `data_json`
3. Emits a toast: "Proposal sent to client@email.com"

This is a **table-stakes feature** for any solar proposal platform.

---

### 6. Client Profile Page is Missing
**File:** `app/clients/page.tsx`

The clients page is a flat list with search and sort. There is **no `/clients/[id]` detail page**. Clicking a client name has no destination. There is no place to see all projects for a client, their full contact info, their document history, their signed proposals, or add notes.

**Fix:** Create `app/clients/[id]/page.tsx` with:
- Client bio (name, email, phone, address, utility)
- All projects for this client with stage badges
- All proposals (draft, sent, signed)
- Documents received
- Notes field (free text, logged with timestamp)
- Quick action: "Create New Project for This Client"

---

### 7. Dashboard: No Kanban / Pipeline Board View
**File:** `app/dashboard/page.tsx`

The dashboard (1587 lines) is feature-rich but has no **visual pipeline board** (kanban-style columns for Lead → Design → Proposal → Approved → Installed). Sales teams work in kanban. Every competing CRM (HubSpot, Salesforce, OpenSolar) has drag-and-drop pipeline views. The current list view forces scrolling through all projects.

**Fix:** Add a "Board" toggle to the dashboard alongside the existing "List" view. Render projects as cards grouped into stage columns with drag-to-advance functionality using a lightweight DnD library (`@hello-pangea/dnd`).

---

### 8. No Bulk Actions on Proposals or Projects
**File:** `app/proposals/page.tsx` (2872 lines), `app/admin/projects/page.tsx`

Both the proposals list and the admin projects list have no bulk selection capability. An installer with 50 proposals cannot bulk-archive, bulk-delete, or bulk-send proposals. An admin cannot bulk-update stages.

**Fix:** Add checkbox selection to table rows with a sticky "X selected → [Action]" toolbar that appears when items are selected.

---

### 9. Analytics Page: Revenue Based on `costEstimate.netCost` — Often Empty
**File:** `app/analytics/page.tsx`

The revenue KPIs (`totalRevenue`, `avgDealSize`) pull from `p.costEstimate?.netCost`. This field is often `0` or `null` for projects that haven't gone through the full proposal pipeline, making the revenue chart useless for most users with mixed project states. The close rate calculation suffers from the same issue.

**Fix:** Fall back gracefully — use `proposal.pricingSnapshot.netCost` from signed proposals if `costEstimate.netCost` is missing. Add a notice on the analytics page when data is incomplete: "Revenue figures only include projects with completed proposals."

---

### 10. Proposal PDF: `wkhtmltopdf` Fallback Serves HTML
**File:** `app/api/proposals/[id]/pdf/route.ts`

The PDF generation falls back to raw HTML if `wkhtmltopdf` is unavailable. On Vercel/serverless environments, `wkhtmltopdf` is not available. This means production PDF downloads silently serve a broken HTML file instead of a PDF. The fallback behavior is invisible to the user.

**Fix:** Use a JavaScript-native PDF renderer like `@react-pdf/renderer` or `puppeteer-core` with `@sparticuz/chromium` for serverless compatibility. Alternatively, move PDF generation to a dedicated server action. At minimum, return a proper error response instead of HTML when the renderer is unavailable.

---

### 11. Proposal Viewer: ICA/PTO Section Requires Address State — Snapshot May Not Have It
**File:** `app/proposals/view/[id]/page.tsx` (lines 335–435)

The ICA/PTO section depends on `projectStateCode` extracted from:
```ts
(proj as any)?.stateCode || client?.state || extractStateFromAddress(address)
```
The proposal is a **snapshot** taken at creation time. If the client's address in the snapshot is missing the state (just a city, or just a ZIP), `extractStateFromAddress` returns `null`, and the entire ICA/PTO roadmap disappears from the proposal.

**Fix:** At proposal creation time (POST `/api/proposals`), extract the state code and store it explicitly in `data_json.stateCode`. The `buildCanonicalProposal()` pipeline already has this data — add `stateCode` to the snapshot at write time.

---

## P2 — Medium Impact / Feature Gaps

### 12. No In-App Notification Center
There is no notification center in the app shell. When a proposal is signed, the installer gets an email but there is no red badge or notification feed in the UI. Installers who live in the app all day never see the email.

**Fix:** Add a bell icon to `AppShell.tsx` with a dropdown notification feed. Use the existing `activity` table (GET `/api/activity`) as the data source. Show recent events: "Client X signed proposal", "Stage advanced to Installation", "New lead from survey form".

---

### 13. No Lead-to-Project Auto-Convert Confirmation Flow
**File:** `app/admin/leads/[id]/page.tsx`

The lead detail page has a "Convert to Project" button, but there's no guided flow that pre-fills the client record from the lead data (name, email, phone, address). The convert action appears to create a blank project without pulling forward the lead's captured data.

**Fix:** The convert modal should pre-populate a project creation form with all available lead fields. The resulting client record should be linked back to the lead for audit trail.

---

### 14. Settings Page: No Notification Preferences
**File:** `app/settings/page.tsx`

There are no notification preference settings. Installers cannot choose which email notifications they receive (proposal viewed, proposal signed, stage changes). Power users who install multiple projects per day don't want email alerts for every view.

**Fix:** Add a "Notifications" tab to the settings page with toggles for each email type. Store preferences in the `users` table or a `notification_preferences` JSONB column.

---

### 15. No Project-Level Notes / Activity Feed Visible in UI
**File:** `app/api/activity/route.ts`

The activity API exists and collects project events, but there is **no visible activity feed in the project detail UI** (neither `app/admin/projects/[id]/page.tsx` nor the main `app/dashboard/page.tsx` project cards). Notes written when advancing a homeowner stage are stored but there's no timeline view showing: "Stage advanced by John → Installation" with a timestamp.

**Fix:** Render the activity feed in the project detail view. Show micro-stage events as a timeline with timestamps and author names.

---

### 16. Client Limit Enforcement: Inconsistent Between Portal and API
**File:** `app/clients/page.tsx`, relevant API

The UI shows `maxClients = 5` for Starter plan, but the actual API enforcement at POST `/api/clients` should be verified separately. If the API doesn't enforce the limit, users on Starter can exceed it by using the API directly (via SolarDog, mobile, Postman, etc.).

**Fix:** Add server-side enforcement to the client creation API endpoint. Return a 403 with a plan-upgrade message if the client limit is exceeded at the DB level.

---

### 17. Admin Dashboard: Duplicate Stats Cards
**File:** `app/admin/page.tsx`

The admin dashboard stat grid shows "Engineering Runs" and "Layouts Total" as two separate cards pulling from the same `l.total` value — they always show identical numbers. Similarly "Storage Used" and "Files Stored" show the same data with different labels.

**Fix:** Deduplicate. Replace with more meaningful distinctions: "Layouts This Month" vs "All Time" using separate API data, or remove one.

---

### 18. `AppShell` Has No Mobile Hamburger Menu
**File:** `components/ui/AppShell.tsx`

On mobile viewports, the sidebar navigation likely either overflows or is hidden with no hamburger/drawer alternative. This is a critical mobile UX gap since field installers and sales reps increasingly work from phones.

**Fix:** Add a hamburger menu icon (`Menu` from lucide) that opens the nav as a slide-out drawer on mobile. The desktop sidebar remains unchanged. Use CSS `translate-x` + backdrop overlay for the mobile drawer.

---

### 19. No `viewport` Meta Tag in Root Layout
**File:** `app/layout.tsx`

The root `layout.tsx` sets `metadata` with title/description but is **missing the `viewport` meta tag**. Without it, mobile browsers use a default 980px viewport, making the app appear zoomed out on phones. Modern Next.js requires `viewport` to be exported separately from `metadata`.

**Fix:**
```ts
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};
```
Add this export to `app/layout.tsx`. Also add it to `app/portal/layout.tsx` and `app/proposals/view/[id]/page.tsx`.

---

### 20. No PWA / Offline Support
**File:** `public/` (no `manifest.json`, no service worker)

There is no Web App Manifest and no service worker. The site cannot be "Add to Home Screen" on mobile. Offline access (even cached view of recent projects) is impossible. Competitors that target field teams (OpenSolar, SolarEdge Design Studio) support PWA installation.

**Fix (MVP):** Add `public/manifest.json` with app name, icons, theme color. Reference it in `app/layout.tsx`. This alone enables "Add to Home Screen" on iOS/Android without any service worker work.

---

### 21. No `robots.txt` / `sitemap.xml` for SEO
**File:** `public/` (missing)

The landing page (`app/page.tsx`) is 1569 lines of marketing content with feature descriptions, testimonials, and CTAs. But there is no `robots.txt` to guide crawlers and no `sitemap.xml`. The landing page `<head>` only has a generic title/description meta — no Open Graph tags, no Twitter Card tags, no structured data.

**Fix:**
- Add `public/robots.txt` allowing crawl of public pages, blocking `/api/`, `/admin/`, `/portal/`
- Add `app/sitemap.ts` (Next.js App Router sitemap generation)
- Add `openGraph` and `twitter` to the root `metadata` export
- Add JSON-LD `SoftwareApplication` structured data to the landing page

---

### 22. Proposal Expiry: No Automated Reminder Email
**File:** `lib/email.ts`, `app/api/proposals/[id]/route.ts`

Proposals have a `validUntil` date (default 30 days from creation). There is no automated email reminder sent to the client at 7 days before expiry, and no email alerting the installer that a proposal expired without being signed.

**Fix:** Add a cron job (Vercel Cron or similar) that runs daily, queries proposals where `validUntil` is within 7 days and unsigned, and sends reminder emails via Resend to both the client and the installer.

---

### 23. Portal Dashboard: Proposal CTA Only Shows Unsigned Proposals
**File:** `app/portal/dashboard/page.tsx`

The portal proposal section filters for `!p.signed_at`. Once a homeowner signs a proposal, it disappears from their portal. They can no longer reference it. For a homeowner who wants to share their proposal with a spouse or contractor, this is a dead end.

**Fix:** Show signed proposals with a "✓ Signed" green badge. Keep them permanently visible in the portal (never remove signed proposals from the homeowner view).

---

### 24. No Duplicate Project Detection
**File:** `app/api/projects/route.ts`

When creating a new project, there is no check for duplicate addresses or duplicate client+address combinations. A sales rep can accidentally create 3 projects for the same house. This pollutes analytics, inflates project counts for plan limits, and causes billing confusion.

**Fix:** On POST to `/api/projects`, check for existing projects with matching `address` (fuzzy) + same `owner_id`. Return a warning (not a hard error) with: "A project already exists at this address — do you want to continue or open the existing project?"

---

## P3 — Nice-to-Have / Competitive Enhancements

### 25. No Document E-Signing (Beyond Proposals)
The proposal e-signing via `SignatureModal` is excellent. But **contracts, installation agreements, interconnection applications, and HOA letters** cannot be signed through the platform. Competitors (Aurora Solar) support multi-document signing workflows.

### 26. No Automated Scheduling Integration
The "Schedule Install" modal (`components/commands/ScheduleInstallModal.tsx`) exists but there's no calendar integration (Google Calendar, Calendly). Install dates are stored as strings but don't sync to anyone's calendar.

### 27. No SMS Notifications
Homeowners increasingly prefer SMS over email for project updates. The portal login and stage advance notifications are all email-only. Adding Twilio/Vonage for SMS would put the platform ahead of most competitors.

### 28. Leads Page: No Lead Source Tracking
**File:** `app/admin/leads/page.tsx`

Leads have no `source` field (e.g., "Website Form", "Referral", "Solar Survey", "Manual Entry"). This makes it impossible to calculate CAC per channel or optimize marketing spend.

### 29. No Customer Satisfaction / NPS Survey Trigger
When a project reaches `completed` stage, there's no automated satisfaction survey. This is a missed opportunity for testimonials, referrals, and product feedback.

### 30. Hardware Page: Stub
**File:** `app/hardware/page.tsx` (5 lines)

The hardware page exists but is essentially empty. A hardware catalog view (filterable by manufacturer, inverter/panel/battery/racking type, price) would save installers from leaving the app to look up equipment specs.

### 31. No Address Autocomplete on Lead Creation
**File:** `app/admin/leads/page.tsx`

The "Add Lead" modal has a plain text address field. The project creation form has `AddressAutocomplete.tsx` (Google Places). The leads form should use the same component for consistency and data quality.

### 32. Onboarding: No Video Walkthrough
The 4-step onboarding wizard collects company info and branding, but doesn't explain the core workflow (Create Project → Design → Engineering → Proposal → Send). A 2-minute embedded video or interactive product tour would dramatically reduce time-to-value for new users.

### 33. `SolarDog` AI Chat: No Suggested Prompts
**File:** `components/support/SolarDog.tsx` (1852 lines)

SolarDog is a powerful AI chat assistant, but it shows an empty prompt input with no suggested questions. New users don't know what to ask. Adding 3-4 contextual suggestions based on the current page would increase engagement significantly.

---

## Summary Table

| # | Issue | Priority | Effort | Files |
|---|-------|----------|--------|-------|
| 1 | Portal login — email-only, no OTP | P0 | M | `portal/login`, `api/portal/login`, `email.ts` |
| 2 | No email verification at registration | P0 | S | `api/auth/register` |
| 3 | Admin — no MFA/2FA | P0 | L | `api/auth/login`, `settings` |
| 4 | No stage-advance email to homeowner | P1 | S | `email.ts`, `api/admin/projects/[id]` |
| 5 | No "Send to Client" email workflow | P1 | M | `proposals/page`, `api/proposals/[id]` |
| 6 | No client detail/profile page | P1 | M | `app/clients/[id]` (new) |
| 7 | No pipeline kanban board view | P1 | L | `dashboard/page` |
| 8 | No bulk actions on tables | P1 | M | `proposals/page`, `admin/projects/page` |
| 9 | Analytics revenue often zero/null | P1 | S | `analytics/page` |
| 10 | PDF falls back to HTML in production | P1 | L | `api/proposals/[id]/pdf` |
| 11 | ICA/PTO missing state in proposal snapshot | P1 | S | `api/proposals` POST handler |
| 12 | No in-app notification center | P2 | M | `AppShell`, `api/activity` |
| 13 | Lead convert doesn't pre-fill project | P2 | S | `admin/leads/[id]` |
| 14 | No notification preferences in settings | P2 | S | `settings/page`, `api/settings` |
| 15 | No activity feed in project detail UI | P2 | S | `admin/projects/[id]`, `api/activity` |
| 16 | Client limit not enforced at API level | P2 | S | `api/clients` POST |
| 17 | Duplicate stat cards in admin dashboard | P2 | XS | `admin/page` |
| 18 | No mobile hamburger menu in AppShell | P2 | S | `AppShell.tsx` |
| 19 | Missing viewport meta tag | P2 | XS | `app/layout.tsx`, `portal/layout.tsx` |
| 20 | No PWA / manifest.json | P2 | S | `public/manifest.json` |
| 21 | No SEO: robots.txt, sitemap, OG tags | P2 | S | `public/`, `app/layout.tsx`, `app/page.tsx` |
| 22 | No proposal expiry reminder email | P2 | M | `lib/email.ts`, cron |
| 23 | Signed proposals disappear from portal | P2 | XS | `portal/dashboard` |
| 24 | No duplicate project detection | P2 | S | `api/projects` POST |
| 25 | No multi-doc e-signing | P3 | XL | new |
| 26 | No calendar integration | P3 | L | new |
| 27 | No SMS notifications | P3 | M | Twilio/Vonage |
| 28 | Leads missing source tracking | P3 | S | DB schema + `admin/leads` |
| 29 | No NPS/satisfaction survey trigger | P3 | M | new |
| 30 | Hardware page is a stub | P3 | L | `app/hardware/page` |
| 31 | No address autocomplete in lead form | P3 | XS | `admin/leads/page` |
| 32 | No video walkthrough in onboarding | P3 | S | `app/onboarding/page` |
| 33 | SolarDog: no suggested prompts | P3 | XS | `SolarDog.tsx` |

---

## Recommended Sprint Order

**Sprint 1 (Security baseline — do now):**
- #19 Viewport meta tag (30 min)
- #1 Portal OTP login (4 hrs)
- #4 Stage-advance email to homeowner (2 hrs)
- #23 Keep signed proposals visible in portal (30 min)
- #11 Store stateCode in proposal snapshot (1 hr)

**Sprint 2 (Core workflow gaps):**
- #5 Send to Client email workflow (4 hrs)
- #6 Client detail page (6 hrs)
- #9 Analytics null handling (2 hrs)
- #21 SEO basics — robots.txt, OG tags, viewport (2 hrs)
- #20 PWA manifest (1 hr)

**Sprint 3 (CRM/pipeline polish):**
- #7 Kanban board view (8 hrs)
- #8 Bulk actions (4 hrs)
- #12 Notification center (6 hrs)
- #15 Activity feed in project detail (3 hrs)
- #22 Proposal expiry reminder cron (3 hrs)

---

*Generated by full codebase audit — June 2025*
