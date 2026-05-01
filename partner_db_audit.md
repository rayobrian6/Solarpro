# Partner Database Audit Report
**Source:** `site_survey_app` @ Render PostgreSQL  
**Connection:** `dpg-d746qe1aae7s73bbv9e0-a.oregon-postgres.render.com`  
**Pulled:** Latest git (commit d73e3ecc — mobile `_layout.tsx` + `HomeScreen.tsx` updated)  
**Date:** Live pull

---

## Summary

| Table | Count | Notes |
|---|---|---|
| `surveys` | **11** | All status=`submitted`, inspector=James (mostly) |
| `survey_photos` | **10** | Uploaded to Render `/uploads/` — accessible via API |
| `users` | **6** | James + Raymond + deploy check bots |
| `categories` | **9** | Roof Mount, Ground Mount, Electrical, etc. |
| `checklist_items` | **64** | Linked to surveys |
| `webhook_deliveries` | **4** | ALL `pending` — error: `Webhook config is missing` ⚠️ |
| `webhook_inbound_events` | **2** | Test events only |
| `fallback_surveys` | **3** | Offline-submitted surveys |
| `ar_detections` | **0** | Schema exists, no data yet |
| `photo_inference_logs` | **0** | Roboflow schema ready, no runs yet |
| `sync_queue` | **0** | Empty |
| `projects` | **0** | Not yet used (project_id=NULL on all surveys) |

---

## Users

| Email | Full Name | Created |
|---|---|---|
| `carpenterjames88@gmail.com` | James | 2026-03-30 |
| `carpj88@oulook.com` | James carpenter | 2026-04-21 |
| `raymond.obrian@yahoo.com` | **Raymond** | 2026-04-24 (new!) |
| `deploycheck_*@example.com` | Deploy Check (x3) | test bots |

---

## Survey Categories (9)

| Category | Color | Description |
|---|---|---|
| Roof Mount | `#7c3aed` | Rooftop solar panel mount installations |
| Ground Mount | `#16a34a` | Solar panel ground mount installations |
| Electrical | `#f59e0b` | Electrical systems and infrastructure |
| Solar Fencing | `#0891b2` | Solar fence / agrivoltaic installations |
| Structural | `#ef4444` | Structural integrity and civil works |
| General Inspection | `#1a56db` | General site survey and walkthrough |
| Environmental | `#10b981` | Environmental and compliance checks |
| Safety | `#f97316` | Health & safety site inspections |
| Network/Comms | `#8b5cf6` | Network, fibre and communications |

---

## All 11 Surveys

### 1. Ray — Roof Mount ⭐ (Latest, 2 photos)
- **ID:** `e3ac0230-9b62-427d-9b47-553966563e27`
- **Address:** Rays boots
- **GPS:** 38.8909375, -89.5710537 (±22.9m)
- **Inspector:** James | Device: `sm-s947u`
- **Surveyed:** 2026-04-24 02:57
- **Photos:** 2 (unlabeled)
- **Webhook:** PENDING — `Webhook config is missing`

### 2. Josh — Commercial 3-Phase Solar (2 photos)
- **ID:** `8172ffe1-261c-4e8d-beef-7c708faed69d`
- **Address:** 1027 darkroom
- **GPS:** None
- **Inspector:** James
- **Surveyed:** 2026-04-24 02:37
- **Photos:** 2 — one labeled "Got that sauce"
- **Webhook:** PENDING — `Webhook config is missing`

### 3. Testies — Roof Mount (1 photo + full metadata)
- **ID:** `b367e8bd-26ce-4433-a0fe-3659433fe70f`
- **Address:** Ray giant choclate balls
- **GPS:** 38.8909, -89.5710 (±19.9m)
- **Inspector:** James
- **Metadata:**
  - type: `roof_mount`
  - azimuth: `180°`
  - rafter_size: `2x6`
  - roof_material: `Asphalt Shingle`
  - rafter_spacing: `24in`
  - roof_age_years: `5`
- **Photo:** Site Access Photo
- **Webhook:** PENDING — `Webhook config is missing`

### 4. Testing — Roof Mount (1 photo + partial metadata)
- **ID:** `e7f8bfda-6af2-4925-b5c3-000a36ca7df3`
- **Address:** 1016 franklin
- **GPS:** 38.8909, -89.5710 (±29.9m)
- **Inspector:** James
- **Metadata:** type=`roof_mount`, roof_material=`Asphalt Shingle`, rest null
- **Photo:** Site Access Photo
- **Webhook:** PENDING — attempt 4, next retry 2026-04-24 11:45

### 5. Testing 2 — Ground Mount ⭐ (RICHEST — 3 photos + full metadata)
- **ID:** `75ce25c6-1456-4b81-89d1-ed39a9e0ea64`
- **Address:** 1010 franklin st pocahontas
- **GPS:** 38.8909418, -89.5710482 (±15.9m)
- **Inspector:** James
- **Notes:** *"This app is the shit"*
- **Metadata:**
  - type: `ground_mount`
  - soil_type: `Clay`
  - slope_degrees: `0`
  - trenching_path: *"The trench is going to be a bitch better call raymond"*
  - vegetation_clearing: `false`
- **Photos:**
  - `/uploads/1776926369545-g2okj8p7fn.jpg` (unlabeled)
  - `/uploads/1776926369550-w9ridr6nym.jpg` (**Overhead Line Photo**)
  - `/uploads/1776926369554-2h1zvol2u7.jpg` (**Meter Photo**)

### 6. Teating first upload 1 — Electrical (1 photo)
- **ID:** `8e1c1e0e-e377-4f1b-b732-3b90a6f4c0bd`
- **Address:** 1016 franklin st pocahontas il
- **GPS:** 38.8909, -89.5710 (±28.5m)
- **Photo:** 1 unlabeled

### 7–9. Hdhdhfff / Bdbdhfjf / Bbhh — Roof Mount (no photos, no GPS)
- Early test surveys, no address, no photos, no metadata

### 10. Site B — Batch Project (synced via E2E test)
- **ID:** `c52d689c-6f85-47dd-b023-37ead64652f5`
- **Device:** `dev-e2e`
- **Synced At:** 2026-04-23 05:53

### 11. Site A — E2E Project
- **ID:** `ca19eb33-0182-4f99-9224-c0926607f464`
- **Address:** 123 Test
- **GPS:** 40.1, -75.2
- **Notes:** test
- **Checklist:** 1 item — "Item 1" = PASS

---

## 10 Survey Photos (All on Render CDN)

| Label | URL | Survey |
|---|---|---|
| unlabeled | `https://site-survey-api-bpyz.onrender.com/uploads/1776999431599-9odngge2pzb.jpg` | Ray |
| unlabeled | `https://site-survey-api-bpyz.onrender.com/uploads/1776999431589-9q0ziqy7uf4.jpg` | Ray |
| Got that sauce | `https://site-survey-api-bpyz.onrender.com/uploads/1776998279240-dkq2ffqwdtg.jpg` | Josh |
| unlabeled | `https://site-survey-api-bpyz.onrender.com/uploads/1776998279236-twq9115dud.jpg` | Josh |
| Site Access Photo | `https://site-survey-api-bpyz.onrender.com/uploads/1776997006569-toy05beg0pl.jpg` | Testies |
| Site Access Photo | `https://site-survey-api-bpyz.onrender.com/uploads/1776978479702-llyml5myoic.jpg` | Testing |
| Meter Photo | `https://site-survey-api-bpyz.onrender.com/uploads/1776926369554-2h1zvol2u7.jpg` | Testing 2 |
| Overhead Line Photo | `https://site-survey-api-bpyz.onrender.com/uploads/1776926369550-w9ridr6nym.jpg` | Testing 2 |
| unlabeled | `https://site-survey-api-bpyz.onrender.com/uploads/1776926369545-g2okj8p7fn.jpg` | Testing 2 |
| unlabeled | `https://site-survey-api-bpyz.onrender.com/uploads/1776925935206-d6ilez762np.jpg` | Teating first upload 1 |

---

## ⚠️ CRITICAL ISSUE: Webhook Deliveries ALL FAILING

All 4 outbound webhook deliveries are stuck with:
```
error: "Webhook config is missing"
status: "pending"
```

| Survey | Attempts | Next Retry |
|---|---|---|
| Ray | 2 | 2026-04-24 03:32 |
| Josh | 3 | 2026-04-24 05:13 |
| Testies | 3 | 2026-04-24 04:51 |
| Testing | **4** | 2026-04-24 11:45 |

**Root cause:** The partner's webhook worker cannot find `SOLARPRO_WEBHOOK_URL` or `SURVEY_WEBHOOK_SECRET` in its runtime environment on Render. The surveys ARE being created and photos uploaded successfully — but the `survey.completed` events are NOT reaching SolarPro.

**Fix needed:** Set env vars on the partner's Render service:
- `SOLARPRO_WEBHOOK_URL` = `https://solar-pro.app` (or current SolarPro URL)
- `SURVEY_WEBHOOK_SECRET` = shared HMAC secret

---

## Checklist Items (64 total)

Linked to surveys — includes labels like:
- Site Access, Overhead Line, Meter, Network Connectivity (survey `4466e241`)
- Pass/pending/fail status per item

---

## Git Changes (Latest Pull)

**2 files changed** (commit `d73e3ecc`):
- `mobile/app/_layout.tsx` — +72/-18 lines (significant layout update)
- `mobile/src/screens/HomeScreen.tsx` — +4/-1 lines (minor home screen change)