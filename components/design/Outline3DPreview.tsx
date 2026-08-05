'use client';

// components/design/Outline3DPreview.tsx
// 3D preview of an outline document. Renders the extruded roof + house meshes
// using Three.js with orbit controls. Self-contained: instantiates its own
// scene, camera, renderer, controls, and disposes them on unmount.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { extrudeOutlineDocument } from '@/lib/3d/outlineExtrude';
import type { OutlineDocument } from '@/lib/outline/types';

export interface Outline3DPreviewProps {
  outline: OutlineDocument;
  width?: number;
  height?: number;
}

export default function Outline3DPreview({
  outline,
  width = 760,
  height = 480,
}: Outline3DPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Initialise scene once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    scene.fog = new THREE.Fog('#0f172a', 30, 120);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      500,
    );
    camera.position.set(15, 12, 15);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);
    controls.minDistance = 3;
    controls.maxDistance = 80;
    controlsRef.current = controls;

    // Lighting: ambient + sun
    const ambient = new THREE.AmbientLight('#cbd5e1', 0.45);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#fde68a', 1.2);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 80;
    scene.add(sun);
    // Fill light from the other side so the back faces aren't pitch black
    const fill = new THREE.DirectionalLight('#94a3b8', 0.3);
    fill.position.set(-15, 8, -10);
    scene.add(fill);

    // Ground plane (receives shadows)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 1,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid on the ground for scale reference
    const grid = new THREE.GridHelper(80, 40, '#334155', '#1e293b');
    grid.position.y = 0.01;
    scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(2);
    axes.position.y = 0.02;
    scene.add(axes);

    // Animation loop (needed for OrbitControls damping)
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      // No-op for fixed-size preview; we use the prop dimensions.
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      controls.dispose();
      renderer.dispose();
      // Remove canvas from DOM
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      // Dispose scene resources
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
    };
  }, [width, height]);

  // Update meshes when outline changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove any previously added outline meshes
    const toRemove: THREE.Object3D[] = [];
    scene.traverse(obj => {
      if (obj.userData?.isOutlineMesh) toRemove.push(obj);
    });
    toRemove.forEach(o => {
      scene.remove(o);
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) {
          o.material.forEach(m => m.dispose());
        } else {
          o.material.dispose();
        }
      }
    });

    const result = extrudeOutlineDocument(outline);
    if (!result) return;

    const roofMat = new THREE.MeshStandardMaterial({
      color: result.roofColor,
      roughness: 0.7,
      metalness: 0.05,
    });
    const roof = new THREE.Mesh(result.roof, roofMat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.userData.isOutlineMesh = true;
    scene.add(roof);

    const houseMat = new THREE.MeshStandardMaterial({
      color: result.houseColor,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
    });
    const house = new THREE.Mesh(result.house, houseMat);
    house.castShadow = true;
    house.receiveShadow = true;
    house.userData.isOutlineMesh = true;
    scene.add(house);

    // Re-aim the camera to fit the geometry. Use the bbox of both meshes.
    const bbox = new THREE.Box3();
    bbox.expandByObject(roof);
    bbox.expandByObject(house);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 4);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      const dist = maxDim * 1.8;
      camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
      camera.lookAt(center);
      controls.target.copy(center);
      controls.update();
    }
  }, [outline]);

  return (
    <div
      ref={mountRef}
      style={{ width, height }}
      className="rounded-lg overflow-hidden border border-slate-700 bg-slate-900"
    />
  );
}
