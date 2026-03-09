# Auto Fill Fire Setbacks + Clean Row Alignment Fix

## Issues to Fix
- [ ] 1. Pass `fireSetbacks` prop from DesignStudio to SolarEngine3D
- [ ] 2. Add `fireSetbacks` to SolarEngine3D Props interface
- [ ] 3. PRIMARY PATH: Filter Google panels outside setback polygon (edge + ridge setbacks)
- [ ] 4. FALLBACK PATH: Use actual fireSetbacks values instead of hardcoded 0.5m
- [ ] 5. PRIMARY PATH: Re-sort Google panels into clean aligned rows (by row/col grid)
- [ ] 6. Bump version to v34.1
- [ ] 7. Build, commit, push to Vercel
- [ ] 8. Test on live site