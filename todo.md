# SolarPro v61 — Control Modes + Locked Selections

## A: Types & Core Data Model
- [x] A1: Add ControlMode type + SystemConfigLocks interface to types/index.ts
- [x] A2: Add controlMode + systemConfigLocks fields to Project interface

## B: DB Migration 026
- [x] B1: Add Migration 026 to migrate route — ADD COLUMN control_mode + system_config_locks to projects table

## C: DB Layer — db-neon.ts
- [x] C1: Update rowToProject() to map control_mode + system_config_locks
- [x] C2: Update createProject/updateProject to persist control_mode + system_config_locks

## D: Control Mode Engine — lib/solardog/controlMode.ts
- [x] D1: Create pure lib/solardog/controlMode.ts module
       - ControlMode type, SystemConfigLocks interface, DEFAULT_LOCKS
       - shouldAllowOverride(field, mode, locks) → boolean
       - lockField(locks, field) → SystemConfigLocks
       - applySafely(field, mode, locks, apply, warn) → { applied, warned }

## E: Engineering Page — Auto-Config Guard
- [x] E1: Read controlMode + systemConfigLocks from project (default 'guided')
- [x] E2: Wrap AUTO-APPLY effect with shouldAllowOverride check
- [x] E3: Wrap hard DC/AC auto-heal override with shouldAllowOverride check
- [x] E4: Wrap applySizingRecommendation panel swap with shouldAllowOverride check
- [x] E5: When user edits panel/inverter — auto-lock that field in guided/manual mode

## F: Suggestion UI — Guided Mode
- [x] F1: Create components/engineering/ControlModeBanner.tsx
- [x] F2: Create components/engineering/SuggestionCard.tsx
- [x] F3: Wire ControlModeBanner + SuggestionCard into engineering page

## G: SolarDog Knowledge Seed Update
- [ ] G1: Add control mode knowledge items to knowledgeSeed.ts (4 items)
- [ ] G2: Update SolarDog system prompt — explain control modes + lock behavior

## H: Tests — groups 45-48
- [ ] H1: Group 45 — controlMode shouldAllowOverride logic (unit tests)
- [ ] H2: Group 46 — lockField + DEFAULT_LOCKS
- [ ] H3: Group 47 — SolarDog knowledge seed (control modes)
- [ ] H4: Group 48 — migration 026 present in migrate route

## I: Commit & Push
- [ ] I1: All tests passing | 0 TS errors
- [ ] I2: git commit v61 + push to dev + merge to master