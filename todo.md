# Topography Map Visibility Correction

## Diagnose
- [x] Inspect uploaded screenshot and identify what surface is unchanged.
- [x] Inspect current dev Topography source to confirm whether canonical topology was only in Pipeline tab while Map still used the stale iframe.

## Fix
- [x] Update the visible Topography map experience so canonical architecture appears without relying on the stale external iframe.
- [x] Preserve existing tabs and legacy/external map reference explicitly.
- [x] Validate TypeScript, lint, build, and source markers.

## Git
- [x] Commit correction directly on dev.
- [x] Push dev.
- [x] Report exact correction and validation evidence.
