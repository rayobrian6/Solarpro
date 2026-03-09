with open('components/design/DesignStudio.tsx', 'r') as f:
    content = f.read()

# 1. Add handleLocationPick callback after fetchSolarData definition
# Insert after the fetchSolarData useCallback (around line 718)
old_after_fetch = """  }, []);


  // \u2500\u2500 Resolve location on load"""
new_after_fetch = """  }, []);

  // \u2500\u2500 Handle house pick from 3D view \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Called when user clicks a house in Pick House mode.
  // Updates the map center, fetches new Solar API data, and updates the address bar.
  const handleLocationPick = useCallback(async (pickedLat: number, pickedLng: number, pickedAddress: string) => {
    // Clear existing panels \u2014 new house, fresh start
    setPanels([]);
    lastSavedPanelsRef.current = '[]';
    setProduction(null);
    setCostEstimate(null);
    setCalcMessage('');
    setSolarApiData(null);
    setRoofSegments([]);

    // Update map center and address bar
    setMapCenter({ lat: pickedLat, lng: pickedLng });
    setAddressSearch(pickedAddress);
    setLocationStatus('found');

    // Show toast
    toast.info('\U0001f3e1 House selected', `Loading solar data for ${pickedAddress}`);

    // Fetch Solar API data for the new location
    fetchSolarData(pickedLat, pickedLng);

    // Save resolved coords back to project (non-fatal)
    if (project.id) {
      fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pickedLat, lng: pickedLng, address: pickedAddress }),
      }).catch(() => {});
    }
  }, [fetchSolarData, project.id, toast]);

  // \u2500\u2500 Resolve location on load"""

if old_after_fetch in content:
    content = content.replace(old_after_fetch, new_after_fetch)
    print("Step 1 done: handleLocationPick added")
else:
    print("ERROR: insertion point not found")
    idx = content.find("// \u2500\u2500 Resolve location on load")
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+50]))

# 2. Add onLocationPick prop to SolarEngine3D usage
old_solar_engine = """              onError={(error) => {
                console.error('3D engine error:', error);
                setShow3D(false);
              }}
            />"""
new_solar_engine = """              onError={(error) => {
                console.error('3D engine error:', error);
                setShow3D(false);
              }}
              onLocationPick={handleLocationPick}
            />"""

if old_solar_engine in content:
    content = content.replace(old_solar_engine, new_solar_engine)
    print("Step 2 done: onLocationPick prop added to SolarEngine3D")
else:
    print("ERROR: SolarEngine3D onError block not found")
    idx = content.find("onError={(error) => {")
    if idx >= 0:
        print(repr(content[idx:idx+150]))

with open('components/design/DesignStudio.tsx', 'w') as f:
    f.write(content)

print("All done")