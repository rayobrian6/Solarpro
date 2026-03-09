# SolarPro - House Picker Feature - COMPLETE

## Phase 1: Understand current flow
- [x] SolarEngine3D receives lat/lng/projectAddress as props
- [x] DesignStudio manages mapCenter state, fetchSolarData, geocodeAddress
- [x] SolarEngine3D had no "pick house" callback to parent
- [x] Need: onLocationPick(lat, lng, address) callback prop

## Phase 2: Add onLocationPick to SolarEngine3D
- [x] Added pick_house to PlacementMode type
- [x] Added onLocationPick prop to Props interface
- [x] Click handler: when mode === 'pick_house', uses scene.pickPosition
      to get lat/lng, reverse-geocodes, calls onLocationPick
- [x] Added 'Pick House' toolbar button with house emoji
- [x] Status message shown when pick_house mode active
- [x] Tool indicator updated to show 'Pick House'

## Phase 3: Handle pick in DesignStudio
- [x] Added handleLocationPick callback
- [x] Clears existing panels when new house is picked
- [x] Updates mapCenter, addressSearch, locationStatus
- [x] Calls fetchSolarData for new location
- [x] Shows toast notification
- [x] Saves new coords to project

## Phase 4: Reverse geocoding
- [x] /api/geocode/route.ts fully rewritten with 3 modes:
      ?lat=...&lng=... -> reverse geocode (Nominatim)
      ?q=...&mode=autocomplete -> suggestions
      ?q=...&mode=search -> forward geocode

## Phase 5: Build & Package
- [x] Build (zero TypeScript errors)
- [x] Committed as v33.1 (auto-bumped from v33.0)
- [x] Pushed to GitHub (rayobrian6/Solarpro)
- [x] ZIP created: solarpro_v33.1_pick_house.zip (993KB)