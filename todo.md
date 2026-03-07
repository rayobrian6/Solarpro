# Hardware Configuration Refactor - Equipment Library System

## Phase 1: Analysis & Setup
- [x] Review current Hardware Config implementation
- [x] Review HardwareConfigPricing.tsx for removal (inline in page.tsx)
- [x] Check current database schema for equipment tables
- [x] Review screenshots for UI context

## Phase 2: Database Schema - User Equipment Tables
- [x] Create migration for user_equipment_panels
- [x] Create migration for user_equipment_inverters
- [x] Create migration for user_equipment_mounting
- [x] Create migration for user_equipment_batteries

## Phase 3: Remove Pricing Tab from Hardware Config
- [x] Delete HardwareConfigPricing.tsx component (was inline in page.tsx)
- [x] Remove Pricing tab from Hardware Config page
- [x] Remove pricePerWattGlobal, laborCost, profitMargin, utilityEscalation, systemLife references
- [x] Clean up any orphaned imports

## Phase 4: Create Equipment Library API
- [x] Create /api/equipment/save route
- [x] Update /api/hardware route for full CRUD
- [x] Add delete operations to db.ts
- [x] Add saveInverter, saveMounting, saveBattery to db.ts

## Phase 5: Equipment Library Service
- [x] Add autosave with debounce in HardwarePage component
- [x] Create equipment-library.ts service (optional - deferred, inline in component)

## Phase 6: UI Improvements - Hardware Cards
- [x] Add Edit button to hardware cards
- [x] Add Duplicate button to hardware cards
- [x] Add Disable/Toggle button to hardware cards
- [x] Add Datasheet link to hardware cards

## Phase 7: Testing & Verification
- [x] Test equipment save flow
- [x] Test equipment load/merge
- [x] Test autosave
- [x] Verify build passes