# 🔥 SolarPro — Site Survey Master Prompt (Permanent Directive)

Before writing code, read this fully.

---

## 🧠 CORE OBJECTIVE

SolarPro is not a form builder.
SolarPro is an **engineering platform**.

The purpose of the site survey system is:

> To capture real-world property data and turn it into the **single source of truth** that drives CAD, electrical design, BOM, and permit plan sets.

---

## 🚨 CRITICAL UNDERSTANDING

We are NOT building a "survey feature."

We ARE building:

> A **field-to-engineering data pipeline**

---

## 🔁 SYSTEM FLOW (NON-NEGOTIABLE)

1. Project is created in SolarPro (office / website intake)
2. Known data is already stored: customer info, address, GPS, bill data, initial system assumptions
3. User clicks **Start Survey**
4. System generates `/survey/[token]` (JWT)
5. Survey pre-fills ALL known data
6. Field tech captures missing physical + electrical data
7. Survey submits
8. Data is transformed and written into structured storage
9. Engineering reads that data and runs: CAD layout, electrical design, BOM, permit plan set

---

## 🧱 REQUIRED DATA ARCHITECTURE

### ❗ TABLE NAME: `project_physical_data`

NOT `survey_data`. NOT `site_conditions` (that table is jurisdiction/environmental only).

---

## 🎯 PURPOSE OF THIS TABLE

This table represents:

> The **actual physical + electrical reality** of the property

It is NOT survey-owned.

* Survey WRITES to it
* Engineering READS from it
* Future systems (manual override, API, office entry) may also update it

---

## 📦 REQUIRED FIELDS

### 🏠 Structure / Roof
- roof_material
- roof_pitch
- rafter_spacing
- roof_condition
- roof_age_years
- attic_access

### ⚡ Electrical
- panel_brand
- panel_rating_amps
- available_breaker_slots
- meter_socket_type
- interconnection_point
- service_entrance_type
- has_sub_panel
- sub_panel_rating

### 🧱 Constraints
- obstructions (JSONB)
- usable_roof_pct

### 🧾 Survey Metadata
- inspector_name
- surveyed_at
- access_notes
- mounting_notes
- electrical_notes

### 🔗 Core
- project_id (FK → projects.id)
- source (survey | manual | api | override)
- updated_at

---

## 🔄 TRANSFORM LAYER RULES

File: `transformLayer.ts`

### ❌ DO NOT:
- Pass values directly from payload without normalization

### ✅ DO:
- Validate inputs
- Normalize values
- Map enums explicitly

Example:
```ts
roof_material: mapRoofMaterial(payload.roofConditions.roofMaterial)
```

---

## ⚙️ ENGINEERING INTEGRATION

When engineering runs:
1. Check `project_physical_data` for this project_id
2. Use values if present
3. Only fall back to defaults if field is NULL/missing

---

## 🧠 PRODUCT PRINCIPLE

- Website intake = assumptions
- Site survey = reality
- Engineering = output from reality

---

## 🚫 HARD RULES

- DO NOT store critical survey data in JSON blobs
- DO NOT duplicate schema across tables
- DO NOT tie system strictly to survey input only
- DO NOT allow engineering to run off assumptions if real data exists
- DO NOT re-ask users for data SolarPro already knows

---

## 🎯 END GOAL

The system must produce:

> The most accurate CAD + electrical + permit plan set possible

based on real-world field data.

---

## 📌 FINAL DIRECTIVE

Every line of code must support this:

> Field data → structured truth → engineering output

If something does not directly support engineering accuracy, it does not belong in this system.