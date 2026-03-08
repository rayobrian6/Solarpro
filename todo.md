# SolarPro v30.7 — Performance + Ground Array + AI Support Bot

## Task A: 3D Performance Optimizations
- [x] A.1 React.memo on SolarEngine3D with custom comparison
- [x] A.2 Dynamic shadow map resolution based on camera height
- [x] A.3 Tile loading tuning (maximumScreenSpaceError, preloadFlightDestinations)
- [x] A.4 In-place entity position update (avoid remove+re-add for position changes)
- [x] A.5 Dynamic debounce window based on panel count delta

## Task B: Ground Array Mode (Chained Rows with Auto-Spacing)
- [x] B.1 Add calcMinRowSpacing() formula (winter solstice, tilt + latitude)
- [x] B.2 Add 'ground_array' PlacementMode to SolarEngine3D
- [x] B.3 Implement handleGroundArrayClick() — chained row placement with auto-offset
- [x] B.4 Add ghost/preview rendering for next row position
- [x] B.5 Add Ground Array button to 3D toolbar with row count display
- [x] B.6 Add confirmation card (panel count, kW, rows × panels)

## Task C: Free AI Support Bot
- [x] C.1 Research and select best free AI chat option (rule-based, zero cost)
- [x] C.2 Create SolarAIBot component with solar knowledge base
- [ ] C.3 Integrate SolarAIBot into app layout (floating widget on all pages)

## Final Steps
- [ ] D.1 TypeScript compile check — zero errors
- [ ] D.2 Full build — clean
- [ ] D.3 Bump version to v30.7, package ZIP, push to git