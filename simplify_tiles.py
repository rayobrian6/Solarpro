#!/usr/bin/env python3
import re

# Read the file
with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Simplify the Google 3D Tiles loading
old_tiles = '''  // ─── Load Google Photorealistic 3D Tiles ─────────────────────────────────────────────────────
  async function loadGoogleTiles(viewer: any) {
    const C = window.Cesium;
    try {
      const tileset = await C.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
        {
          showCreditsOnScreen: true,
          maximumScreenSpaceError: 4,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 0.00278,
          dynamicScreenSpaceErrorFactor: 4.0,
          skipLevelOfDetail: true,
          baseScreenSpaceError: 1024,
          skipScreenSpaceErrorFactor: 16,
          skipLevels: 1,
          immediatelyLoadDesiredLevelOfDetail: false,
          loadSiblings: false,
          cullWithChildrenBounds: true,
        }
      );'''

new_tiles = '''  // ─── Load Google Photorealistic 3D Tiles ─────────────────────────────────────────────────────
  async function loadGoogleTiles(viewer: any) {
    const C = window.Cesium;
    try {
      console.log('[SolarEngine3D] Loading Google 3D Tiles...');
      const tileset = await C.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
        {
          showCreditsOnScreen: true,
          maximumScreenSpaceError: 16,  // Increased for better performance
          skipLevelOfDetail: false,  // Disabled to prevent errors
          immediatelyLoadDesiredLevelOfDetail: true,  // Load immediately
          loadSiblings: true,  // Load siblings for better rendering
        }
      );'''

content = content.replace(old_tiles, new_tiles)

# Write the file
with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Simplified Google 3D Tiles loading")