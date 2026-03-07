import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_SOLAR_API_KEY = process.env.GOOGLE_SOLAR_API_KEY || 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';
const PIXEL_SIZE = 0.5;

// ── UTM Zone 17N → WGS84 ─────────────────────────────────────────────────────
function utmToLatLng(easting: number, northing: number, zone = 17): { lat: number; lng: number } {
  const k0 = 0.9996, a = 6378137.0, e = 0.0818191908;
  const e2 = e*e, e4 = e2*e2, e6 = e2*e4;
  const x = easting - 500000.0, y = northing;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const M = y / k0;
  const mu = M / (a * (1 - e2/4 - 3*e4/64 - 5*e6/256));
  const e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
  const phi1 = mu + (3*e1/2 - 27*e1**3/32)*Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32)*Math.sin(4*mu)
    + (151*e1**3/96)*Math.sin(6*mu)
    + (1097*e1**4/512)*Math.sin(8*mu);
  const N1 = a / Math.sqrt(1 - e2*Math.sin(phi1)**2);
  const T1 = Math.tan(phi1)**2;
  const C1 = e2*Math.cos(phi1)**2 / (1-e2);
  const R1 = a*(1-e2) / (1-e2*Math.sin(phi1)**2)**1.5;
  const D = x / (N1*k0);
  const lat = phi1 - (N1*Math.tan(phi1)/R1) * (D**2/2
    - (5+3*T1+10*C1-4*C1**2-9*e2)*D**4/24
    + (61+90*T1+298*C1+45*T1**2-252*e2-3*C1**2)*D**6/720);
  const lon = lon0 + (D - (1+2*T1+C1)*D**3/6
    + (5-2*C1+28*T1-3*C1**2+8*e2+24*T1**2)*D**5/120) / Math.cos(phi1);
  return { lat: lat * 180/Math.PI, lng: lon * 180/Math.PI };
}

// Detect UTM zone from longitude
function utmZone(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

// ── Convex hull (Graham scan) ─────────────────────────────────────────────────
function convexHull(pts: {lat:number;lng:number}[]) {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a,b) => a.lat !== b.lat ? a.lat-b.lat : a.lng-b.lng);
  const cross = (O:any,A:any,B:any) => (A.lng-O.lng)*(B.lat-O.lat)-(A.lat-O.lat)*(B.lng-O.lng);
  const lower:any[]=[], upper:any[]=[];
  for (const p of sorted) { while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop(); lower.push(p); }
  for (let i=sorted.length-1;i>=0;i--) { const p=sorted[i]; while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return [...lower,...upper];
}

// ── Gaussian blur ─────────────────────────────────────────────────────────────
function gaussianBlur(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(data.length);
  const radius = Math.ceil(sigma * 2);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i*i)/(2*sigma*sigma)); kernel.push(v); ksum += v; }
  const k = kernel.map(v => v/ksum);
  const tmp = new Float32Array(data.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let s=0; for (let i=-radius;i<=radius;i++) { const xi=Math.max(0,Math.min(w-1,x+i)); s+=data[y*w+xi]*k[i+radius]; } tmp[y*w+x]=s;
  }
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let s=0; for (let i=-radius;i<=radius;i++) { const yi=Math.max(0,Math.min(h-1,y+i)); s+=tmp[yi*w+x]*k[i+radius]; } out[y*w+x]=s;
  }
  return out;
}

// ── Sobel gradient ────────────────────────────────────────────────────────────
function sobelGradient(data: Float32Array, w: number, h: number) {
  const gx = new Float32Array(data.length), gy = new Float32Array(data.length);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const i = y*w+x;
    gx[i] = (-data[(y-1)*w+(x-1)] - 2*data[y*w+(x-1)] - data[(y+1)*w+(x-1)]
             + data[(y-1)*w+(x+1)] + 2*data[y*w+(x+1)] + data[(y+1)*w+(x+1)]) / (8*PIXEL_SIZE);
    gy[i] = (-data[(y-1)*w+(x-1)] - 2*data[(y-1)*w+x] - data[(y-1)*w+(x+1)]
             + data[(y+1)*w+(x-1)] + 2*data[(y+1)*w+x] + data[(y+1)*w+(x+1)]) / (8*PIXEL_SIZE);
  }
  return { gx, gy };
}

// ── Connected component labeling ──────────────────────────────────────────────
function labelComponents(mask: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(mask.length).fill(-1);
  let count = 0;
  for (let start=0; start<mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const stack = [start]; labels[start] = count;
    while (stack.length) {
      const idx = stack.pop()!;
      const y = Math.floor(idx/w), x = idx%w;
      for (const [dy,dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const ny=y+dy, nx=x+dx;
        if (ny<0||ny>=h||nx<0||nx>=w) continue;
        const ni=ny*w+nx;
        if (mask[ni] && labels[ni]<0) { labels[ni]=count; stack.push(ni); }
      }
    }
    count++;
  }
  return { labels, count };
}

// ── Get boundary pixels of a labeled region ───────────────────────────────────
function getBoundaryPoints(labels: Int32Array, w: number, h: number, lbl: number, step: number) {
  const pts: {row:number;col:number}[] = [];
  for (let y=0;y<h;y+=step) for (let x=0;x<w;x+=step) {
    if (labels[y*w+x]!==lbl) continue;
    let boundary = false;
    for (const [dy,dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const ny=y+dy, nx=x+dx;
      if (ny<0||ny>=h||nx<0||nx>=w||labels[ny*w+nx]!==lbl) { boundary=true; break; }
    }
    if (boundary) pts.push({row:y,col:x});
  }
  return pts;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  if (!lat || !lng) return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });

  try {
    // 1. Fetch DSM URL
    const dlUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=60&view=DSM_LAYER&requiredQuality=HIGH&pixelSizeMeters=${PIXEL_SIZE}&key=${GOOGLE_SOLAR_API_KEY}`;
    const dlRes = await fetch(dlUrl);
    if (!dlRes.ok) throw new Error(`dataLayers: ${dlRes.status}`);
    const dlData = await dlRes.json();
    if (dlData.error) throw new Error(dlData.error.message || 'dataLayers error');
    const dsmUrl = dlData.dsmUrl + `&key=${GOOGLE_SOLAR_API_KEY}`;

    // 2. Download DSM GeoTIFF
    const tiffRes = await fetch(dsmUrl);
    if (!tiffRes.ok) throw new Error(`DSM download: ${tiffRes.status}`);
    const arrayBuffer = await tiffRes.arrayBuffer();

    // 3. Parse GeoTIFF
    const geotiff = await import('geotiff');
    const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const w = rasters.width, h = rasters.height;
    const raw = rasters[0] as Float32Array;

    // 4. Get geographic bounds (UTM Zone 17N for Ohio)
    const bbox = image.getBoundingBox(); // [west, south, east, north] in UTM meters
    const [utmWest, utmSouth, utmEast, utmNorth] = bbox;
    const zone = utmZone(lng);

    const pxToLatLng = (row: number, col: number) => {
      const utmE = utmWest + (col / w) * (utmEast - utmWest);
      const utmN = utmNorth - (row / h) * (utmNorth - utmSouth);
      return utmToLatLng(utmE, utmN, zone);
    }

    // 5. Smooth DSM
    const smoothed = gaussianBlur(raw, w, h, 1.5);

    // 6. Gradients (in m/m)
    const { gx, gy } = sobelGradient(smoothed, w, h);

    // 7. Pitch and azimuth per pixel
    const pitch = new Float32Array(raw.length);
    const azimuth = new Float32Array(raw.length);
    for (let i=0;i<raw.length;i++) {
      const slopeMag = Math.sqrt(gx[i]*gx[i] + gy[i]*gy[i]);
      pitch[i] = Math.atan(slopeMag) * 180 / Math.PI;
      // gy is N-S gradient (positive = rising southward = downslope is north = az 0)
      // gx is E-W gradient (positive = rising eastward = downslope is west = az 270)
      azimuth[i] = ((Math.atan2(gx[i], -gy[i]) * 180 / Math.PI) + 360) % 360;
    }

    // 8. Ground level
    const sortedElev = Array.from(smoothed).sort((a,b)=>a-b);
    const groundLevel = sortedElev[Math.floor(sortedElev.length * 0.15)];

    // 9. Roof mask: on building, pitched 5-60°
    const roofMask = new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) {
      roofMask[i] = (smoothed[i] > groundLevel + 2.0 && pitch[i] > 5 && pitch[i] < 60) ? 1 : 0;
    }

    // 10. Quantize azimuth to 22.5° bins
    const azBin = new Float32Array(raw.length).fill(-1);
    for (let i=0;i<raw.length;i++) {
      if (roofMask[i]) azBin[i] = Math.round(azimuth[i] / 22.5) * 22.5;
    }

    const uniqueAz = Array.from(new Set(Array.from(azBin).filter(v=>v>=0))).sort((a,b)=>a-b);
    const roofPlanes: any[] = [];

    for (const azVal of uniqueAz) {
      const planeMask = new Uint8Array(raw.length);
      for (let i=0;i<raw.length;i++) planeMask[i] = azBin[i]===azVal ? 1 : 0;
      const { labels, count } = labelComponents(planeMask, w, h);

      for (let lbl=0;lbl<count;lbl++) {
        const indices: number[] = [];
        for (let i=0;i<labels.length;i++) if (labels[i]===lbl) indices.push(i);
        if (indices.length < 40) continue;

        const pitchVals = indices.map(i=>pitch[i]).sort((a,b)=>a-b);
        const elevVals  = indices.map(i=>smoothed[i]).sort((a,b)=>a-b);
        const medPitch  = pitchVals[Math.floor(pitchVals.length/2)];
        const medElev   = elevVals[Math.floor(elevVals.length/2)];

        const rows = indices.map(i=>Math.floor(i/w));
        const cols = indices.map(i=>i%w);
        const centerRow = rows.reduce((s,v)=>s+v,0)/rows.length;
        const centerCol = cols.reduce((s,v)=>s+v,0)/cols.length;
        const center = pxToLatLng(centerRow, centerCol);

        // Get boundary → convex hull in WGS84
        const boundaryPts = getBoundaryPoints(labels, w, h, lbl, 2);
        if (boundaryPts.length < 3) continue;
        const latLngPts = boundaryPts.map(p => pxToLatLng(p.row, p.col));
        const hull = convexHull(latLngPts);
        if (hull.length < 3) continue;

        roofPlanes.push({
          pitchDegrees:   Math.round(medPitch * 10) / 10,
          azimuthDegrees: Math.round(azVal % 360 * 10) / 10,
          elevationM:     Math.round(medElev * 100) / 100,
          areaM2:         Math.round(indices.length * PIXEL_SIZE * PIXEL_SIZE * 10) / 10,
          center:  { lat: Math.round(center.lat*1e7)/1e7, lng: Math.round(center.lng*1e7)/1e7 },
          polygon: hull.map(p => ({ lat: Math.round(p.lat*1e7)/1e7, lng: Math.round(p.lng*1e7)/1e7 })),
        });
      }
    }

    roofPlanes.sort((a,b) => b.areaM2 - a.areaM2);

    return NextResponse.json({
      groundElevationM: Math.round(groundLevel * 100) / 100,
      roofPlanes: roofPlanes.slice(0, 20),
      utmZone: zone,
    });

  } catch (err: any) {
    console.error('DSM route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}