/**
 * Solar Math Library
 * Physically accurate sun position, shadow, and panel calculations
 */

export interface SunPosition {
  azimuth: number;   // degrees from north, clockwise
  elevation: number; // degrees above horizon
  zenith: number;    // degrees from vertical
}

export interface PanelGeometry {
  lat: number;
  lng: number;
  elevation: number;
  tilt: number;      // degrees from horizontal
  azimuth: number;   // degrees from north
  width: number;     // meters
  height: number;    // meters
}

/**
 * Calculate sun position using NOAA Solar Calculator algorithm
 */
export function getSunPosition(lat: number, lng: number, date: Date): SunPosition {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // Julian date
  const JD = date.getTime() / 86400000 + 2440587.5;
  const JC = (JD - 2451545) / 36525;

  // Geometric mean longitude of sun (degrees)
  const L0 = (280.46646 + JC * (36000.76983 + JC * 0.0003032)) % 360;

  // Geometric mean anomaly of sun (degrees)
  const M = 357.52911 + JC * (35999.05029 - 0.0001537 * JC);

  // Equation of center
  const Mrad = M * rad;
  const C = Math.sin(Mrad) * (1.914602 - JC * (0.004817 + 0.000014 * JC))
    + Math.sin(2 * Mrad) * (0.019993 - 0.000101 * JC)
    + Math.sin(3 * Mrad) * 0.000289;

  // Sun's true longitude
  const sunLon = L0 + C;

  // Apparent longitude
  const omega = 125.04 - 1934.136 * JC;
  const lambda = sunLon - 0.00569 - 0.00478 * Math.sin(omega * rad);

  // Mean obliquity of ecliptic
  const epsilon0 = 23 + (26 + (21.448 - JC * (46.8150 + JC * (0.00059 - JC * 0.001813))) / 60) / 60;
  const epsilon = epsilon0 + 0.00256 * Math.cos(omega * rad);

  // Sun declination
  const sinDec = Math.sin(epsilon * rad) * Math.sin(lambda * rad);
  const declination = Math.asin(sinDec) * deg;

  // Equation of time (minutes)
  const y = Math.tan((epsilon / 2) * rad) ** 2;
  const L0rad = L0 * rad;
  const Mrad2 = M * rad;
  const eot = 4 * deg * (y * Math.sin(2 * L0rad)
    - 2 * 0.016708634 * Math.sin(Mrad2)
    + 4 * 0.016708634 * y * Math.sin(Mrad2) * Math.cos(2 * L0rad)
    - 0.5 * y * y * Math.sin(4 * L0rad)
    - 1.25 * 0.016708634 * 0.016708634 * Math.sin(2 * Mrad2));

  // Solar noon and hour angle
  // Use UTC time + longitude to compute true solar time — avoids browser timezone issues
  // trueSolarTime = UTC minutes + equation of time + longitude correction (4 min/degree)
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = ((utcMinutes + eot + lng * 4) % 1440 + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 - 180;

  // Solar zenith angle
  const latRad = lat * rad;
  const decRad = declination * rad;
  const haRad = hourAngle * rad;
  const cosZenith = Math.sin(latRad) * Math.sin(decRad)
    + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) * deg;
  const elevation = 90 - zenith;

  // Solar azimuth
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * cosZenith)
    / (Math.cos(latRad) * Math.sin(zenith * rad));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
  if (hourAngle > 0) azimuth = 360 - azimuth;

  return { azimuth, elevation, zenith };
}

/**
 * Convert lat/lng/alt to ECEF (Earth-Centered Earth-Fixed) coordinates
 */
export function latLngAltToECEF(lat: number, lng: number, alt: number): [number, number, number] {
  const rad = Math.PI / 180;
  const a = 6378137.0; // WGS84 semi-major axis
  const e2 = 0.00669437999014; // WGS84 eccentricity squared

  const latR = lat * rad;
  const lngR = lng * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);

  const x = (N + alt) * Math.cos(latR) * Math.cos(lngR);
  const y = (N + alt) * Math.cos(latR) * Math.sin(lngR);
  const z = (N * (1 - e2) + alt) * Math.sin(latR);

  return [x, y, z];
}

/**
 * Calculate panel normal vector from tilt and azimuth
 */
export function getPanelNormal(tiltDeg: number, azimuthDeg: number): [number, number, number] {
  const rad = Math.PI / 180;
  const tilt = tiltDeg * rad;
  const az = azimuthDeg * rad;

  // Normal vector in local ENU (East-North-Up) coordinates
  const nx = Math.sin(tilt) * Math.sin(az);
  const ny = Math.sin(tilt) * Math.cos(az);
  const nz = Math.cos(tilt);

  return [nx, ny, nz];
}

/**
 * Calculate shading factor for a panel given sun position
 * Returns 0 (full shade) to 1 (full sun)
 */
export function getPanelShadingFactor(
  panelTilt: number,
  panelAzimuth: number,
  sunElevation: number,
  sunAzimuth: number
): number {
  if (sunElevation <= 0) return 0; // Night

  const rad = Math.PI / 180;
  const [nx, ny, nz] = getPanelNormal(panelTilt, panelAzimuth);

  // Sun direction vector
  const sunEl = sunElevation * rad;
  const sunAz = sunAzimuth * rad;
  const sx = Math.cos(sunEl) * Math.sin(sunAz);
  const sy = Math.cos(sunEl) * Math.cos(sunAz);
  const sz = Math.sin(sunEl);

  // Dot product of panel normal and sun direction
  const dot = nx * sx + ny * sy + nz * sz;
  return Math.max(0, dot);
}

/**
 * Calculate annual energy production for a panel
 */
export function calculatePanelEnergy(
  wattage: number,
  tilt: number,
  azimuth: number,
  lat: number,
  peakSunHours: number = 5.5
): number {
  // Simple model: adjust for tilt and azimuth
  const optimalTilt = Math.abs(lat);
  const tiltFactor = 1 - Math.abs(tilt - optimalTilt) / 90 * 0.2;
  const azFactor = 1 - Math.abs(azimuth - 180) / 180 * 0.15;
  return wattage * peakSunHours * 365 * tiltFactor * azFactor / 1000; // kWh/year
}

/**
 * Get color for shade heatmap (0=full shade red, 1=full sun green)
 */
export function getShadeColor(factor: number): string {
  const r = Math.round(255 * (1 - factor));
  const g = Math.round(255 * factor);
  return `rgb(${r},${g},0)`;
}