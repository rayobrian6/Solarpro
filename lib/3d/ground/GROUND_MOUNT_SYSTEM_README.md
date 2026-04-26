# GROUND MOUNT SYSTEM README — AUTHORITATIVE DOCUMENT

> **READ THIS FIRST. TREAT AS BINDING.**
> This document is the single source of truth for all ground-mount work.
> If code conflicts with this README, the README wins.

---

# CORE PRINCIPLE

This system must behave like a **real installed solar ground mount**, not abstract geometry.
If it would not be built this way in real life → it is WRONG.

---

# SYSTEM HIERARCHY (REAL INSTALL ORDER)

Each array is built as:

```
Pylon (I-beam driven into ground)
→ Mounting Bracket (connects strongback to pylon)
→ Strongback (structural beam mounted to EACH pylon)
→ Rail Mount Hardware
→ Rails (continuous across array)
→ Panels (mounted to rails)
```

---

# CRITICAL RULES

## 1. Strongbacks are NOT spanning beams

Strongbacks:
* are mounted to EACH pylon individually
* do NOT connect pylons together
* are NOT continuous across the array

Each pylon has its own strongback.

## 2. Rails span — NOT strongbacks

Rails:
* run continuously across the array (E-W)
* attach to every strongback
* define panel support

Strongbacks:
* support rails
* DO NOT define span

## 3. Panels define the system (GRID AUTHORITY)

Panels:
* must form a perfect grid
* must snap edge-to-edge
* must NEVER drift

Structure must follow panels — NOT the other way around.

## 4. NO FLOATING GEOMETRY

Every component must be physically attached:
* rails sit ON strongbacks
* strongbacks mount TO pylons
* panels mount TO rails

If any object is "near" another object but not attached → WRONG

---

# COMPONENT DEFINITIONS

## PYLON (I-BEAM)

* Vertical steel beam driven into ground
* Defines foundation
* Has:
  * top point
  * mount point (where strongback attaches)

## STRONGBACK

Real-world meaning:
* A steel/aluminum beam mounted to a pylon
* Runs NORTH-SOUTH (tilt direction)

Properties:
* One per pylon
* Tilted at panel angle (~20–30°)
* Fixed length (matches panel height / table depth)
* Mounted using bracket

Strongbacks DO NOT connect pylons together.

## STRONGBACK MOUNTING

Strongback attaches to:
* pylon mount bracket
* not pylon center
* not arbitrary position

Must visually appear bolted / mounted.

## RAILS

* Run EAST-WEST across array
* Continuous across all pylons
* Attach to EACH strongback

Rails MUST:
* sit on strongback top surface
* intersect every strongback
* maintain consistent height

## PANELS

* Snap to rails
* Perfect grid
* No skew
* No rotation drift

---

# MECHANICAL MODEL (MANDATORY)

System must follow:

```
Pylon → Strongback → Rail → Panel
```

NOT: `Pylon → Rail → Panel`
NOT: `Panel → Structure`

---

# COMMON MISTAKES (DO NOT ALLOW)

❌ Strongbacks connecting pylons
❌ One long beam across array
❌ Rails floating above structure
❌ Panels placed independently of grid
❌ Using Z offsets instead of surfaces
❌ Vertical-only calculations on tilted systems

---

# MOUNTING SURFACE RULE

All attachments must use surfaces:
* Strongback has TOP surface
* Rails mount to that surface
* Panels mount to rails

NO:
* centerline-only positioning
* guessed offsets

---

# VISUAL EXPECTATION

Final system must look like:
* evenly spaced pylons
* one strongback per pylon
* rails sitting cleanly across them
* panels perfectly aligned
* no floating or clipping

It should look like something a contractor would actually install.

---

# MECHANICAL HIERARCHY THAT MUST BE PRESERVED

```
Pylon
→ mounting interface / bracket
→ strongback
→ rail attachment
→ rails
→ panels
```

Key rule:
* strongbacks are real components
* strongbacks are not abstract spans unless explicitly defined that way
* rails must mount to strongbacks the way this document describes
* panels must mount to rails the way this document describes

No floating geometry. No fake visual approximations. No "close enough."

---

# DEBUG METHOD (MANDATORY)

After reading this README, work in this order:

1. Determine the intended real-world behavior from this README
2. Compare that to current engine output
3. Compare that to current renderer output
4. Identify the FIRST place the system diverges from this README
5. Fix only that layer first

Possible divergence layers:
* panel grid
* rail placement
* strongback placement
* pylon placement
* shared origin / coordinate frame
* renderer consumption

Do not jump ahead. Do not fix downstream symptoms before upstream truth is verified.

---

# REQUIRED RESPONSE FORMAT

Every time you work on a ground-mount task, respond in this structure:

1. **README Rules Applied** — quote the relevant mechanical truths
2. **Expected Real-World Behavior** — describe what the system should do physically
3. **Current Code Reality** — describe what the code is currently doing
4. **First Divergence** — identify the first place current behavior violates the README
5. **Surgical Fix** — smallest possible change, one subsystem only
6. **Regression Guard** — one validation or debug check to prevent this specific failure again

---

# FINAL RULE

If unsure: default to **real-world installation logic**, not geometry math.
This system must reflect reality, not approximation.