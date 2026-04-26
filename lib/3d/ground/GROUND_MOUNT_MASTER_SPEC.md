# GROUND MOUNT REALITY ENGINE — MASTER SPEC (READ FIRST)

This document defines the **real-world structure and behavior** of ground-mounted solar systems.

This is NOT optional guidance.
This is the **source of truth** for all ground mount logic.

---

# 🚨 CORE PRINCIPLE

This system must behave like a **real installed solar ground mount**, not abstract geometry.

If it would not be built this way in real life → it is WRONG.

---

# 🧱 SYSTEM HIERARCHY (REAL INSTALL ORDER)

Each array is built as:

Pylon (I-beam driven into ground)
→ Mounting Bracket (connects strongback to pylon)
→ Strongback (structural beam mounted to EACH pylon)
→ Rail Mount Hardware
→ Rails (continuous across array)
→ Panels (mounted to rails)

---

# 🔴 CRITICAL RULES

## 1. Strongbacks are NOT spanning beams

Strongbacks:

* are mounted to EACH pylon individually
* do NOT connect pylons together
* are NOT continuous across the array

Each pylon has its own strongback.

---

## 2. Rails span — NOT strongbacks

Rails:

* run continuously across the array (E-W)
* attach to every strongback
* define panel support

Strongbacks:

* support rails
* DO NOT define span

---

## 3. Panels define the system (GRID AUTHORITY)

Panels:

* must form a perfect grid
* must snap edge-to-edge
* must NEVER drift

Structure must follow panels — NOT the other way around.

---

## 4. NO FLOATING GEOMETRY

Every component must be physically attached:

* rails sit ON strongbacks
* strongbacks mount TO pylons
* panels mount TO rails

If any object is "near" another object but not attached → WRONG

---

# 🧩 COMPONENT DEFINITIONS

## 🔩 PYLON (I-BEAM)

* Vertical steel beam driven into ground
* Defines foundation
* Has:

  * top point
  * mount point (where strongback attaches)

---

## 🔧 STRONGBACK

Real-world meaning:

* A steel/aluminum beam mounted to a pylon
* Runs NORTH-SOUTH (tilt direction)

Properties:

* One per pylon
* Tilted at panel angle (~20–30°)
* Fixed length (matches panel height / table depth)
* Mounted using bracket

Strongbacks DO NOT connect pylons together.

---

## 🧷 STRONGBACK MOUNTING

Strongback attaches to:

* pylon mount bracket
* not pylon center
* not arbitrary position

Must visually appear bolted / mounted.

---

## 🪜 RAILS

* Run EAST-WEST across array
* Continuous across all pylons
* Attach to EACH strongback

Rails MUST:

* sit on strongback top surface
* intersect every strongback
* maintain consistent height

---

## 🔳 PANELS

* Snap to rails
* Perfect grid
* No skew
* No rotation drift

---

# 🧠 MECHANICAL MODEL (MANDATORY)

System must follow:

Pylon → Strongback → Rail → Panel

NOT:

Pylon → Rail → Panel
NOT:

Panel → Structure

---

# ⚠️ COMMON MISTAKES (DO NOT ALLOW)

❌ Strongbacks connecting pylons
❌ One long beam across array
❌ Rails floating above structure
❌ Panels placed independently of grid
❌ Using Z offsets instead of surfaces
❌ Vertical-only calculations on tilted systems

---

# 🔧 MOUNTING SURFACE RULE

All attachments must use surfaces:

* Strongback has TOP surface
* Rails mount to that surface
* Panels mount to rails

NO:

* centerline-only positioning
* guessed offsets

---

# 🎯 VISUAL EXPECTATION

Final system must look like:

* evenly spaced pylons
* one strongback per pylon
* rails sitting cleanly across them
* panels perfectly aligned
* no floating or clipping

It should look like something a contractor would actually install.

---

# 🚀 GOAL

Build a system that is:

* mechanically correct
* visually believable
* based on real components
* stable across all layouts

---

# 🔒 FINAL RULE

If unsure:

→ default to **real-world installation logic**, not geometry math

This system must reflect reality, not approximation.