#!/usr/bin/env python3
import re

# Read the file
with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Disable shadows in viewer initialization
old_viewer_config = '''    const viewer = new C.Viewer(cesiumRef.current, {
      imageryProvider: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: true,
      terrainShadows: C.ShadowMode.ENABLED,
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
    });'''

new_viewer_config = '''    const viewer = new C.Viewer(cesiumRef.current, {
      imageryProvider: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: false,
      terrainShadows: C.ShadowMode.DISABLED,
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
    });'''

content = content.replace(old_viewer_config, new_viewer_config)

# Also disable shadow map
old_shadow_map = '''    // Shadows
    viewer.shadows = true;
    viewer.shadowMap.enabled = true;
    viewer.shadowMap.softShadows = true;
    viewer.shadowMap.size = 2048;
    viewer.shadowMap.maximumDistance = 5000;'''

new_shadow_map = '''    // Shadows - disabled to prevent rendering errors
    viewer.shadows = false;
    viewer.shadowMap.enabled = false;
    viewer.shadowMap.softShadows = false;
    viewer.shadowMap.size = 2048;
    viewer.shadowMap.maximumDistance = 5000;'''

content = content.replace(old_shadow_map, new_shadow_map)

# Write the file
with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Disabled shadows to prevent rendering errors")