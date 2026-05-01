# RE+ 2026 Booth Prep — Demo Script & Fallback Flows
**SolarPro · Las Vegas Convention Center · September 2026**

> **Status:** Approved for booth use. Last updated: 2026-05-28.  
> **Owner:** Founders / GTM lead. Carry a printed copy as a backup.

---

## Table of Contents

1. [Booth Setup Checklist](#1-booth-setup-checklist)
2. [Demo Account Reset (Before Every Shift)](#2-demo-account-reset)
3. [5-Minute Demo Script](#3-5-minute-demo-script)
4. [15-Minute Demo Script](#4-15-minute-demo-script)
5. [Objection Handling Cheatsheet](#5-objection-handling)
6. [Screenshot-Ready Page Reference](#6-screenshot-ready-pages)
7. [Offline Fallback Procedure](#7-offline-fallback)
8. [Wi-Fi Contingency — LVCC Known Issues](#8-wifi-contingency)
9. [Personas & Talking Points by Visitor Type](#9-personas)
10. [End-of-Day Reset Checklist](#10-end-of-day-reset)

---

## 1. Booth Setup Checklist

Complete this **every morning before doors open**.

- [ ] Laptop(s) charged to 100%, power bricks plugged in at booth
- [ ] Mobile hotspot (personal data plan, NOT LVCC Wi-Fi) tested and connected
- [ ] Chrome open, signed into `demo@yourcompany.com` — **no other tabs**
- [ ] Run Demo Account Reset (Section 2) on all demo devices
- [ ] Offline snapshot loaded and verified (Section 7)
- [ ] Clicker/presenter tested (page-advance works)
- [ ] Second screen mirroring confirmed if using external display
- [ ] Business card stack replenished
- [ ] QR code poster live-tested (scan → proposal view loads)
- [ ] Printed fallback one-pagers in folder (15 copies)

---

## 2. Demo Account Reset

**Run before every shift and after every hands-on demo.**

### Fast Reset (< 30 seconds)

1. Open: `https://yourapp.com/admin/system-tools` (super-admin login)
2. Scroll to **Demo Account Seeder** card (violet, bottom of page)
3. Enter `demo@yourcompany.com` in the email field
4. Click **Seed Demo** → confirm in the modal
5. Wait for the green toast: *"Demo account seeded — 3 projects created"*
6. Switch to `demo@yourcompany.com` account (use impersonation or direct login)
7. Verify dashboard shows 3 projects: Mitchell Residence / Greenfield Lot 14 / RML Warehouse

### What Gets Reset

| Project | Type | Size | City | Status |
|---|---|---|---|---|
| Mitchell Residence – Roof Retrofit | Residential Roof | 10.4 kW | Phoenix, AZ | Proposal |
| Greenfield Lot 14 – New Construction | New Construction Roof | 8.0 kW | Austin, TX | Design |
| RML Warehouse – Ground Mount | Commercial Ground | 49.6 kW | Denver, CO | Lead |

> ⚠️ Any previously seeded `[demo]` projects are soft-deleted automatically. Production data is never touched.

---

## 3. Five-Minute Demo Script

**Goal:** Hook an installer walking past the booth. Leave them wanting more.  
**Device:** Laptop or tablet. Stand next to them, don't sit.

---

### [0:00–0:30] The Hook

> *"Quick question — how long does it take you to build a solar proposal right now?"*

*(Let them answer. Common: "a few hours", "half a day", "we use [competitor]")*

> *"We cut that to about 90 seconds. Want to see it?"*

---

### [0:30–1:30] Dashboard → Pick a Project

Navigate to: **Dashboard** (`/dashboard`)

> *"This is a real contractor's dashboard. You can see their full pipeline — leads, designs, proposals, installs — all in one place. No spreadsheets."*

Point at pipeline stages. Point at the 3 demo projects.

> *"Let's take the Mitchell family in Phoenix. They're at the proposal stage."*

Click **Mitchell Residence → Roof Retrofit**.

---

### [1:30–2:30] Design Canvas

Navigate to: **Design** (`/design?project=<id>`) or click "View Design" from the project page.

> *"The design tool pulls up satellite imagery automatically — their actual roof. The rep already placed 26 panels, got 10.4 kilowatts, south-facing."*

Hover over a panel to show tooltip. Point at the roof plane shading.

> *"The system knows the roof pitch, azimuth, even accounts for shading from the parapet. This is real production modeling, not a guesstimate."*

---

### [2:30–3:30] One-Click Proposal

Click **Generate Proposal** (or navigate to the Proposals tab).

> *"One click. The proposal is built from the design — system size, savings estimate, financing options, all automatically formatted."*

Open the proposal viewer (`/proposals/view/<id>`).

> *"This is what the homeowner sees on their phone. It's a mobile-first shareable link — no PDF attachment, no email attachment, just a URL."*

Scroll to the CTA button.

> *"They tap Accept right here, and the contractor gets notified instantly."*

---

### [3:30–4:30] The Numbers

> *"The Mitchell family has a $182/month APS bill. The system shows them $1,840/year in savings — that's a 9.2-year payback at current rates."*

> *"For the contractor, this whole flow — satellite pull, panel layout, proposal — took under two minutes. No AutoCAD. No Excel. No back-and-forth with a design team."*

---

### [4:30–5:00] Close

> *"We're cloud-based, no install, pricing starts at [X]/month per seat. If you want, I can seed this into your account right now and you can play with it today."*

Hand them a card. Offer a QR scan for a trial signup.

---

## 4. Fifteen-Minute Demo Script

**Goal:** Deep-dive for a serious buyer. Cover all three project types.  
**Device:** Laptop on a stand. Visitor seated beside you.

---

### [0:00–1:00] Context Setting

> *"Before I show you anything, tell me about your current workflow. What tools are you using today?"*

*(Listen. Note their pain points. Mirror them back throughout the demo.)*

> *"Perfect. I'm going to show you a platform built specifically for that pain."*

---

### [1:00–3:00] Dashboard Tour

Navigate to: **Dashboard**

Walk through:
- **Pipeline overview** — Lead → Design → Proposal → Approved → Installed
- **Action items** — "The system tells the rep what to do next on every project. No guessing."
- **Quick stats** — total kW installed, open proposals, this month's revenue

> *"Most contractors run this on a Monday morning. Five minutes and they know exactly what needs attention."*

---

### [3:00–6:00] Residential Retrofit (Mitchell)

Click **Mitchell Residence → Roof Retrofit** (status: Proposal)

**Client card:**
> *"Client was imported from a bill upload. The system read the APS bill — $182/month, 14,520 kWh/year — and pre-filled all the utility data. No manual entry."*

**Design canvas:**
> *"26 panels, south-facing, 22° tilt. The roof plane tool lets the rep click the outline of each plane, enter pitch, and the layout snaps to it."*

Show panel drag/resize if live. Show kW counter updating.

**Proposal:**
> *"The proposal auto-populates from the design. Company logo, color palette, the homeowner's name, their actual bill numbers, projected savings. All from one record."*

Open proposal viewer. Scroll through:
- Hero section (system size, big kW number)
- Savings breakdown
- Accepted banner animation

> *"When the homeowner taps Accept, the contractor gets an instant notification and the project status flips to Approved automatically."*

---

### [6:00–9:00] New Construction (Greenfield)

Click **Greenfield Lot 14 – New Construction** (status: Design)

> *"Different use case — a builder doing pre-wire on new homes. No utility bill yet, so the rep modeled usage based on the square footage and local climate data."*

Show dual-roof-plane layout (south + east).

> *"Two roof planes, different azimuths, the system handles mixed-orientation arrays. The builder submits this to the HOA and the utility in the same PDF they'd submit to a homeowner."*

Navigate to Engineering tab (if available) or show notes.

> *"New construction projects also feed into permit packages — we can generate a one-line diagram from this layout."*

---

### [9:00–12:00] Commercial Ground Mount (RML)

Click **RML Warehouse – Ground Mount** (status: Lead)

> *"Completely different product line — 49.6 kilowatts, commercial facility in Denver. Ground mount, single-axis tracker spacing."*

Open Design canvas. Show ground-mount layout (4 rows × 31 panels).

> *"The ground mount tool handles tilt, azimuth, row spacing, ground clearance — everything that matters for a real commercial submittal."*

Show system size: 49.6 kW.

> *"For a deal this size, the sales rep would typically spend 3–4 hours building a proposal. We're at maybe 15 minutes including the site visit data entry."*

Highlight monthly bill: $1,124 → projected savings: ~$13,000/year.

> *"The ROI story is automatic. The rep just needs to show up and close."*

---

### [12:00–14:00] Admin & Multi-User

Navigate to: **Admin** (if visitor is a business owner / ops person)

> *"If you're running a team, here's the admin view. You can see every rep's pipeline, impersonate any account to troubleshoot, manage subscriptions, run platform health checks."*

Show system-tools page briefly (Demo Account Seeder card).

> *"We even built a one-click demo reset for trade shows — exactly what I just did to set this up for you."*

---

### [14:00–15:00] Pricing & Next Step

> *"Pricing is [X]/month per seat, volume discounts at 5+ seats. Free 14-day trial, no credit card. You can be live and closing proposals this week."*

> *"Want me to create a trial account for you right now? I can seed these three demo projects into it so your team has something to explore from day one."*

Open trial signup or hand off to onboarding flow.

---

## 5. Objection Handling

| Objection | Response |
|---|---|
| *"We already use [Aurora/OpenSolar/Scoop]"* | *"Those are great for design-heavy workflows. SolarPro is built for the sales-to-close motion — faster proposal generation, mobile-first client experience, and a real pipeline view. Most teams run both for the first 30 days, then decide."* |
| *"Is this accurate for permit submittal?"* | *"The design canvas outputs to our engineering module which generates permit-ready one-line diagrams. For AHJ-specific packages, you'd still use your PE stamp process, but the underlying data is all there."* |
| *"We're a large company, do you have enterprise?"* | *"Yes — white-label branding, SSO, multi-location dashboards, dedicated onboarding. Send me your seat count and I'll get you a custom quote by tomorrow."* |
| *"What happens if the internet goes down?"* | *"Read-only offline mode shows your last-synced projects and proposals. For the booth, we also have a static demo snapshot loaded locally — Section 7 of this runbook."* |
| *"How does the satellite imagery work?"* | *"We pull from Google Maps Platform — same imagery used in Aurora and Nearmap integrations. For commercial/large ground mounts, you can also import your own site survey coordinates."* |
| *"What's your uptime?"* | *"We're on Vercel + Neon PostgreSQL — 99.9% uptime SLA. The admin platform-health tool shows live DB latency — I can show you right now."* |
| *"Can we import our existing customers?"* | *"CSV import is on the roadmap. Right now, bill upload auto-fills client data, and we have a JSON API if your CRM supports it."* |

---

## 6. Screenshot-Ready Pages

These pages are optimized for screenshots and screen-share. Have them pre-loaded in separate browser tabs.

| Tab | URL | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | Pipeline overview shot |
| Mitchell Design | `/design` (with Mitchell project selected) | Roof layout shot |
| Mitchell Proposal | `/proposals/view/<mitchell-id>` | Homeowner-facing shot |
| RML Design | `/design` (with RML project selected) | Commercial ground-mount shot |
| System Tools | `/admin/system-tools` | "We built tooling for this" shot |

### Screenshot Tips
- Use **Chrome DevTools → Device Emulation → iPhone 14 Pro** for mobile shots
- Zoom to **110%** for presentation screenshots (text legibility)
- Dark mode is on by default — looks great on slides
- For the proposal viewer, scroll to the CTA section — the glowing button is the money shot
- For the design canvas, place the cursor over a panel to show the tooltip before screenshotting

---

## 7. Offline Fallback Procedure

**Use when:** LVCC Wi-Fi is down AND personal hotspot has no signal.

### Option A — Cached Browser (Preferred)

1. Before leaving for the venue, visit all 5 screenshot-ready pages (Section 6)
2. Chrome caches static assets aggressively — most UI will load from cache
3. Dynamic data (project list, proposal details) will **not** load without connectivity
4. Use cached screenshots on the laptop's desktop as a fallback

### Option B — Static HTML Snapshot (`public/offline-demo/`)

A static HTML demo snapshot is stored at `/public/offline-demo/index.html` in the repo.  
Serve it locally:

```bash
# From the repo root on your laptop
npx serve public/offline-demo -p 3333
# Open: http://localhost:3333
```

The snapshot shows:
- Dashboard mockup with 3 demo projects
- Proposal viewer for Mitchell Residence (static, no live data)
- Design canvas screenshot with panel layout annotations

### Option C — Printed One-Pager

Folder labeled **"RE+ 2026 Fallback"** in the booth storage. Contains:
- 15× printed proposal one-pager (Mitchell Residence)  
- 5× commercial summary sheet (RML Warehouse)
- 5× pricing + feature comparison cards

---

## 8. Wi-Fi Contingency — LVCC Known Issues

| Issue | Mitigation |
|---|---|
| LVCC public Wi-Fi bandwidth throttled | Use personal hotspot on a different carrier than your colleague |
| Hotspot data cap hit | Pre-download offline snapshot (Option B above). Buy a data add-on before the show. |
| SSL cert error on LVCC network | Open `chrome://flags/#allow-insecure-localhost` if testing locally. For production, the cert is valid — the issue is usually a LVCC proxy intercepting HTTPS. |
| App loads but API calls hang | The app has a 30-second API timeout. If it hangs, refresh. If persistent, switch to offline mode. |
| Login session expired | Keep the session alive with a background tab that auto-refreshes every 10 minutes. (Bookmark: `/api/ping`) |

### Personal Hotspot Setup

Recommended: two people at the booth, two different carriers (e.g., one AT&T, one Verizon).  
Connect the demo laptop to both carriers in priority order:

1. Verizon hotspot (primary)
2. AT&T hotspot (secondary)
3. LVCC Wi-Fi (last resort — slow but usable for basic browsing)

---

## 9. Personas & Talking Points by Visitor Type

### Solo Installer / Small Shop (1–5 installs/month)
**Pain:** Doing everything in Excel + Gmail. No proposal tool.  
**Hook:** *"One click from a utility bill to a shareable proposal."*  
**Feature focus:** Bill upload → auto-fill → proposal viewer → client acceptance  
**Close:** Free trial, they're up in 10 minutes.

### Mid-Sized Installer (10–50 installs/month)
**Pain:** Design bottleneck, back-office chaos, reps closing too slowly.  
**Hook:** *"Your best rep's workflow, available to every rep."*  
**Feature focus:** Pipeline dashboard, design canvas speed, proposal analytics  
**Close:** Team trial, offer to seed their existing client list.

### EPC / Commercial Contractor
**Pain:** Commercial projects have different tools, no unified platform.  
**Hook:** *"Ground mounts, carports, fence mounts — all the same platform."*  
**Feature focus:** Ground mount design, commercial project notes, system size modeling  
**Close:** Enterprise plan conversation, request a call with their ops lead.

### Investor / PE / Strategic
**Pain:** Looking for platform risk, scalability, moat.  
**Hook:** *"We're the Salesforce for solar installers."*  
**Feature focus:** Admin dashboard, multi-user pipeline, roadmap  
**Close:** Do not hard-sell. Share the deck. Get a follow-up calendar invite before they leave.

### Solar Software Competitor Scouting
**Tell:** They ask very specific technical questions. They won't give a card.  
**Response:** Be friendly, give a real demo. The product speaks for itself. Don't reveal roadmap details beyond what's public.

---

## 10. End-of-Day Reset Checklist

- [ ] Run Demo Account Reset one more time (cleans up anything a visitor touched)
- [ ] Close all browser tabs except the 5 screenshot-ready tabs
- [ ] Sign out of demo account, stay signed into admin account
- [ ] Back up any new lead contact info captured during the day (to CRM or sheet)
- [ ] Charge all devices overnight
- [ ] Restock printed materials if running low (reorder info in booth folder)
- [ ] Note any product questions you couldn't answer → log as potential roadmap items
- [ ] Quick team debrief: what landed, what got objections, any feature gaps heard repeatedly

---

*Built with SolarPro · RE+ 2026 · Las Vegas, NV*