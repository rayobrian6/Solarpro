with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

# 1. Add pick_house to PlacementMode type
old_type = "export type PlacementMode = 'select' | 'roof' | 'ground' | 'fence' | 'auto_roof' | 'plane' | 'row' | 'measure' | 'ground_array';"
new_type = "export type PlacementMode = 'select' | 'roof' | 'ground' | 'fence' | 'auto_roof' | 'plane' | 'row' | 'measure' | 'ground_array' | 'pick_house';"
content = content.replace(old_type, new_type)
assert new_type in content, "PlacementMode type not updated"

# 2. Add onLocationPick to Props interface
old_props = """  onTwinLoaded?: (twin: DigitalTwinData) => void;
  onError?: (msg: string) => void;
}"""
new_props = """  onTwinLoaded?: (twin: DigitalTwinData) => void;
  onError?: (msg: string) => void;
  onLocationPick?: (lat: number, lng: number, address: string) => void;
}"""
content = content.replace(old_props, new_props)
assert 'onLocationPick?' in content, "onLocationPick prop not added"

# 3. Add onLocationPick to function destructuring
old_destruct = """function SolarEngine3D({
  lat, lng, projectAddress,
  panels, onPanelsChange,
  placementMode, onPlacementModeChange,
  systemType, tilt, azimuth, fenceHeight,
  showShade, selectedPanel,
  onTwinLoaded, onError,
}: Props) {"""
new_destruct = """function SolarEngine3D({
  lat, lng, projectAddress,
  panels, onPanelsChange,
  placementMode, onPlacementModeChange,
  systemType, tilt, azimuth, fenceHeight,
  showShade, selectedPanel,
  onTwinLoaded, onError, onLocationPick,
}: Props) {"""
content = content.replace(old_destruct, new_destruct)
assert 'onLocationPick,' in content, "onLocationPick not added to destructuring"

print("Step 1-3 done")

# 4. Find the handleCanvasClick section where auto_roof is commented out
# and add pick_house handling
old_click_comment = """        // auto_roof: fires once via placementMode useEffect — NOT on canvas click
      } catch (err: any) {"""
new_click_comment = """        // auto_roof: fires once via placementMode useEffect — NOT on canvas click

        // pick_house: user clicked a house — get lat/lng and reverse-geocode
        if (mode === 'pick_house') {
          try {
            const pickedPos = viewer.scene.pickPosition(screenPos);
            if (pickedPos && isFinite(pickedPos.x)) {
              const carto = C.Cartographic.fromCartesian(pickedPos);
              const pickedLat = C.Math.toDegrees(carto.latitude);
              const pickedLng = C.Math.toDegrees(carto.longitude);
              if (isValidCoord(pickedLat, pickedLng)) {
                addLog('PICK', `House picked at ${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`);
                setStatusMsg('House selected — loading solar data...');
                onPlacementModeChange('select');
                // Reverse geocode in background
                fetch(`/api/geocode?lat=${pickedLat}&lng=${pickedLng}`)
                  .then(r => r.json())
                  .then(data => {
                    const address = data?.data?.short_name || `${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`;
                    if (onLocationPick) onLocationPick(pickedLat, pickedLng, address);
                  })
                  .catch(() => {
                    if (onLocationPick) onLocationPick(pickedLat, pickedLng, `${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`);
                  });
              }
            }
          } catch (e: any) {
            addLog('ERROR', `pick_house: ${e.message}`);
          }
        }
      } catch (err: any) {"""
content = content.replace(old_click_comment, new_click_comment)
assert 'pick_house' in content, "pick_house click handler not added"

print("Step 4 done")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("All done - pick_house added to SolarEngine3D")