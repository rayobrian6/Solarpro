# SolarPro - House Picker Feature

## Goal
Allow user to navigate to any area (e.g. Edwardsville IL), then click on a 
specific house in the 3D Cesium view to SELECT it as the target property.
Clicking a house: reverse-geocodes the lat/lng → updates address → reloads
Solar API data for that exact building → re-runs Auto Fill on the new roof.

## Phase 1: Understand current flow
- [x] SolarEngine3D receives lat/lng/projectAddress as props
- [x] DesignStudio manages mapCenter state, fetchSolarData, geocodeAddress
- [x] SolarEngine3D has no "pick house" callback to parent
- [x] Need: onLocationPick(lat, lng, address) callback prop

## Phase 2: Add onLocationPick to SolarEngine3D
- [ ] Add onLocationPick?: (lat: number, lng: number, address: string) => void to Props
- [ ] Add "Pick House" mode to PlacementMode type (or use a separate state)
- [ ] In handleCanvasClick: when mode === 'pick_house', use scene.pickPosition
      to get lat/lng, reverse-geocode, call onLocationPick
- [ ] Add "Pick House" toolbar button with house icon
- [ ] Show crosshair cursor + status message when pick_house mode active

## Phase 3: Handle pick in DesignStudio
- [ ] Add onLocationPick handler: updates mapCenter, calls fetchSolarData,
      reverse-geocodes to get address string, updates addressSearch display
- [ ] Clear existing panels when new house is picked
- [ ] Show toast: "House selected - loading solar data..."

## Phase 4: Reverse geocoding
- [ ] Use existing /api/geocode endpoint with mode=reverse (lat/lng → address)
- [ ] Check if reverse geocode mode exists, add if needed

## Phase 5: Build & Package
- [ ] Build (zero errors)
- [ ] Commit + push v33.1
- [ ] Create ZIP