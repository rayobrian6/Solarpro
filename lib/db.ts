// ============================================================
// FILE-PERSISTENT DATABASE (Production: replace with PostgreSQL/Supabase)
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type {
  User, Client, Project, Layout, ProductionResult,
  Proposal, SolarPanel, Inverter, MountingSystem, PricingConfig, Battery
} from '@/types';

// ─── Solar Panels (Real Market Data 2024) ────────────────────

const DB_FILE = path.join(process.cwd(), 'data', 'solarpro.db');
const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load data from file if exists
function loadFromFile<T>(key: string, defaultValue: T): T {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      return data[key] || defaultValue;
    }
  } catch (e) {
    console.error('Error loading from file:', e);
  }
  return defaultValue;
}

// Save data to file
function saveToFile(key: string, data: any) {
  try {
    let allData: any = {};
    if (fs.existsSync(DB_FILE)) {
      allData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
    allData[key] = data;
    fs.writeFileSync(DB_FILE, JSON.stringify(allData, null, 2));
  } catch (e) {
    console.error('Error saving to file:', e);
  }
}
export const defaultPanels: SolarPanel[] = [
  // ── SunPower ──
  {
    id: 'panel-sp1', manufacturer: 'SunPower', model: 'Maxeon 7 440W',
    wattage: 440, width: 1.046, height: 1.812, efficiency: 22.8,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.27,
    pricePerWatt: 0.52, warranty: 40, cellType: 'Maxeon IBC',
  },
  {
    id: 'panel-sp2', manufacturer: 'SunPower', model: 'Maxeon 6 AC 400W',
    wattage: 400, width: 1.046, height: 1.690, efficiency: 22.7,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.27,
    pricePerWatt: 0.48, warranty: 40, cellType: 'Maxeon IBC',
  },
  // ── REC Group ──
  {
    id: 'panel-rec1', manufacturer: 'REC Group', model: 'Alpha Pure-R 430W',
    wattage: 430, width: 1.016, height: 1.821, efficiency: 23.2,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.24,
    pricePerWatt: 0.44, warranty: 25, cellType: 'HJT',
  },
  {
    id: 'panel-rec2', manufacturer: 'REC Group', model: 'TwinPeak 5 405W',
    wattage: 405, width: 1.016, height: 1.821, efficiency: 21.9,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.26,
    pricePerWatt: 0.36, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Panasonic / EverVolt ──
  {
    id: 'panel-pan1', manufacturer: 'Panasonic', model: 'EverVolt HK Black 410W',
    wattage: 410, width: 1.052, height: 1.765, efficiency: 22.2,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.26,
    pricePerWatt: 0.45, warranty: 25, cellType: 'HIT',
  },
  // ── Jinko Solar ──
  {
    id: 'panel-jk1', manufacturer: 'Jinko Solar', model: 'Tiger Neo N-type 580W',
    wattage: 580, width: 1.134, height: 2.278, efficiency: 22.4,
    bifacial: true, bifacialFactor: 1.15, temperatureCoeff: -0.29,
    pricePerWatt: 0.28, warranty: 30, cellType: 'TOPCon N-type',
  },
  {
    id: 'panel-jk2', manufacturer: 'Jinko Solar', model: 'Tiger Neo 610W Bifacial',
    wattage: 610, width: 1.134, height: 2.384, efficiency: 22.6,
    bifacial: true, bifacialFactor: 1.18, temperatureCoeff: -0.28,
    pricePerWatt: 0.27, warranty: 30, cellType: 'TOPCon N-type',
  },
  {
    id: 'panel-jk3', manufacturer: 'Jinko Solar', model: 'Tiger Pro 72HC 545W',
    wattage: 545, width: 1.134, height: 2.278, efficiency: 21.1,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.35,
    pricePerWatt: 0.24, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Canadian Solar ──
  {
    id: 'panel-cs1', manufacturer: 'Canadian Solar', model: 'HiKu7 Bifacial 600W',
    wattage: 600, width: 1.303, height: 2.384, efficiency: 21.9,
    bifacial: true, bifacialFactor: 1.20, temperatureCoeff: -0.34,
    pricePerWatt: 0.26, warranty: 25, cellType: 'Mono PERC',
  },
  {
    id: 'panel-cs2', manufacturer: 'Canadian Solar', model: 'TOPBiHiKu7 620W',
    wattage: 620, width: 1.303, height: 2.384, efficiency: 22.5,
    bifacial: true, bifacialFactor: 1.22, temperatureCoeff: -0.29,
    pricePerWatt: 0.29, warranty: 30, cellType: 'TOPCon N-type',
  },
  {
    id: 'panel-cs3', manufacturer: 'Canadian Solar', model: 'HiKu6 Mono 430W',
    wattage: 430, width: 1.048, height: 1.879, efficiency: 21.9,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.35,
    pricePerWatt: 0.28, warranty: 25, cellType: 'Mono PERC',
  },
  // ── LONGi Solar ──
  {
    id: 'panel-lo1', manufacturer: 'LONGi Solar', model: 'Hi-MO 6 580W',
    wattage: 580, width: 1.134, height: 2.278, efficiency: 22.4,
    bifacial: true, bifacialFactor: 1.15, temperatureCoeff: -0.29,
    pricePerWatt: 0.25, warranty: 30, cellType: 'HPBC',
  },
  {
    id: 'panel-lo2', manufacturer: 'LONGi Solar', model: 'Hi-MO X6 Pro 615W',
    wattage: 615, width: 1.134, height: 2.384, efficiency: 22.8,
    bifacial: true, bifacialFactor: 1.20, temperatureCoeff: -0.28,
    pricePerWatt: 0.27, warranty: 30, cellType: 'HPBC',
  },
  // ── Trina Solar ──
  {
    id: 'panel-tr1', manufacturer: 'Trina Solar', model: 'Vertex S+ 435W',
    wattage: 435, width: 1.096, height: 1.754, efficiency: 22.6,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.30,
    pricePerWatt: 0.30, warranty: 25, cellType: 'TOPCon N-type',
  },
  {
    id: 'panel-tr2', manufacturer: 'Trina Solar', model: 'Vertex 600W Bifacial',
    wattage: 600, width: 1.303, height: 2.384, efficiency: 21.9,
    bifacial: true, bifacialFactor: 1.18, temperatureCoeff: -0.29,
    pricePerWatt: 0.26, warranty: 25, cellType: 'TOPCon N-type',
  },
  // ── Q CELLS ──
  {
    id: 'panel-qc1', manufacturer: 'Q CELLS', model: 'Q.PEAK DUO BLK ML-G10+ 400W',
    wattage: 400, width: 1.024, height: 1.740, efficiency: 22.4,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.34,
    pricePerWatt: 0.32, warranty: 25, cellType: 'Mono PERC',
  },
  {
    id: 'panel-qc2', manufacturer: 'Q CELLS', model: 'Q.TRON BFR-G2+ 430W',
    wattage: 430, width: 1.048, height: 1.879, efficiency: 21.9,
    bifacial: true, bifacialFactor: 1.12, temperatureCoeff: -0.29,
    pricePerWatt: 0.34, warranty: 25, cellType: 'TOPCon N-type',
  },
  // ── Silfab ──
  {
    id: 'panel-sf1', manufacturer: 'Silfab Solar', model: 'SIL-430 BG',
    wattage: 430, width: 1.048, height: 1.879, efficiency: 21.8,
    bifacial: true, bifacialFactor: 1.12, temperatureCoeff: -0.30,
    pricePerWatt: 0.38, warranty: 30, cellType: 'Mono PERC',
  },
  // ── Axitec ──
  {
    id: 'panel-ax1', manufacturer: 'Axitec', model: 'AXIblackpremium X HC 420W',
    wattage: 420, width: 1.048, height: 1.762, efficiency: 22.8,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.30,
    pricePerWatt: 0.35, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Hanwha Q CELLS ──
  {
    id: 'panel-hq1', manufacturer: 'Hanwha Q CELLS', model: 'Q.PEAK DUO XL-G11 500W',
    wattage: 500, width: 1.134, height: 2.094, efficiency: 21.1,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.34,
    pricePerWatt: 0.30, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Solaria ──
  {
    id: 'panel-sol1', manufacturer: 'Solaria', model: 'PowerXT-400R-PM',
    wattage: 400, width: 1.016, height: 1.740, efficiency: 22.6,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.29,
    pricePerWatt: 0.40, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Mission Solar ──
  {
    id: 'panel-ms1', manufacturer: 'Mission Solar', model: 'MSE PERC 72 400W',
    wattage: 400, width: 1.024, height: 1.740, efficiency: 21.5,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.37,
    pricePerWatt: 0.33, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Boviet Solar ──
  {
    id: 'panel-bv1', manufacturer: 'Boviet Solar', model: 'BVM6612M-420W',
    wattage: 420, width: 1.048, height: 1.762, efficiency: 21.4,
    bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.35,
    pricePerWatt: 0.29, warranty: 25, cellType: 'Mono PERC',
  },
  // ── Astronergy ──
  {
    id: 'panel-as1', manufacturer: 'Astronergy', model: 'CHSM72M(BL)-HC 580W',
    wattage: 580, width: 1.134, height: 2.278, efficiency: 22.4,
    bifacial: true, bifacialFactor: 1.15, temperatureCoeff: -0.30,
    pricePerWatt: 0.26, warranty: 25, cellType: 'TOPCon N-type',
  },
  // ── Sol Fence Specific (Vertical Bifacial) ──
  {
    id: 'panel-fence1', manufacturer: 'Jinko Solar', model: 'Tiger Neo Bifacial 400W (Fence)',
    wattage: 400, width: 1.046, height: 1.690, efficiency: 22.0,
    bifacial: true, bifacialFactor: 1.25, temperatureCoeff: -0.28,
    pricePerWatt: 0.30, warranty: 30, cellType: 'TOPCon N-type',
  },
  {
    id: 'panel-fence2', manufacturer: 'Canadian Solar', model: 'BiKu CS3W-440PB (Fence)',
    wattage: 440, width: 1.048, height: 1.879, efficiency: 22.2,
    bifacial: true, bifacialFactor: 1.22, temperatureCoeff: -0.34,
    pricePerWatt: 0.28, warranty: 25, cellType: 'Mono PERC Bifacial',
  },
  {
    id: 'panel-fence3', manufacturer: 'LONGi Solar', model: 'Hi-MO 5m 420W Bifacial (Fence)',
    wattage: 420, width: 1.048, height: 1.762, efficiency: 21.3,
    bifacial: true, bifacialFactor: 1.20, temperatureCoeff: -0.30,
    pricePerWatt: 0.27, warranty: 25, cellType: 'HPBC Bifacial',
  },
];

// ─── Inverters (Real Market Data 2024) ───────────────────────
export const defaultInverters: Inverter[] = [
  // ── Enphase Microinverters ──
  {
    id: 'inv-enp1', manufacturer: 'Enphase', model: 'IQ8+ Microinverter',
    capacity: 0.295, efficiency: 97.0, type: 'micro', pricePerUnit: 185,
    warranty: 25, batteryCompatible: true,
  },
  {
    id: 'inv-enp2', manufacturer: 'Enphase', model: 'IQ8M Microinverter',
    capacity: 0.330, efficiency: 97.0, type: 'micro', pricePerUnit: 195,
    warranty: 25, batteryCompatible: true,
  },
  {
    id: 'inv-enp3', manufacturer: 'Enphase', model: 'IQ8H Microinverter',
    capacity: 0.384, efficiency: 97.0, type: 'micro', pricePerUnit: 215,
    warranty: 25, batteryCompatible: true,
  },
  // ── SolarEdge String + Optimizers ──
  {
    id: 'inv-se1', manufacturer: 'SolarEdge', model: 'SE7600H-US (7.6kW)',
    capacity: 7.6, efficiency: 99.2, type: 'optimizer', pricePerUnit: 1450,
    warranty: 12, mpptChannels: 2, batteryCompatible: true,
  },
  {
    id: 'inv-se2', manufacturer: 'SolarEdge', model: 'SE10000H-US (10kW)',
    capacity: 10.0, efficiency: 99.2, type: 'optimizer', pricePerUnit: 1850,
    warranty: 12, mpptChannels: 2, batteryCompatible: true,
  },
  {
    id: 'inv-se3', manufacturer: 'SolarEdge', model: 'SE11400H-US (11.4kW)',
    capacity: 11.4, efficiency: 99.2, type: 'optimizer', pricePerUnit: 2100,
    warranty: 12, mpptChannels: 2, batteryCompatible: true,
  },
  {
    id: 'inv-se4', manufacturer: 'SolarEdge', model: 'SE17600H-US (17.6kW)',
    capacity: 17.6, efficiency: 99.2, type: 'optimizer', pricePerUnit: 2800,
    warranty: 12, mpptChannels: 2, batteryCompatible: true,
  },
  // ── SMA ──
  {
    id: 'inv-sma1', manufacturer: 'SMA', model: 'Sunny Boy 7.7-US',
    capacity: 7.7, efficiency: 97.0, type: 'string', pricePerUnit: 1200,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-sma2', manufacturer: 'SMA', model: 'Sunny Boy 10.0-US',
    capacity: 10.0, efficiency: 97.0, type: 'string', pricePerUnit: 1450,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-sma3', manufacturer: 'SMA', model: 'Sunny Tripower 15000TL-US',
    capacity: 15.0, efficiency: 98.4, type: 'string', pricePerUnit: 2200,
    warranty: 10, mpptChannels: 3, batteryCompatible: false,
  },
  // ── Fronius ──
  {
    id: 'inv-fr1', manufacturer: 'Fronius', model: 'Primo 8.2-1',
    capacity: 8.2, efficiency: 97.7, type: 'string', pricePerUnit: 1350,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-fr2', manufacturer: 'Fronius', model: 'Primo 15.0-1',
    capacity: 15.0, efficiency: 98.1, type: 'string', pricePerUnit: 2100,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-fr3', manufacturer: 'Fronius', model: 'Symo GEN24 10.0 Plus',
    capacity: 10.0, efficiency: 98.1, type: 'string', pricePerUnit: 2400,
    warranty: 10, mpptChannels: 2, batteryCompatible: true,
  },
  // ── Growatt ──
  {
    id: 'inv-gr1', manufacturer: 'Growatt', model: 'MIN 6000TL-X',
    capacity: 6.0, efficiency: 97.6, type: 'string', pricePerUnit: 850,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-gr2', manufacturer: 'Growatt', model: 'SPH 10000TL3 BH-UP',
    capacity: 10.0, efficiency: 97.6, type: 'string', pricePerUnit: 1600,
    warranty: 10, mpptChannels: 3, batteryCompatible: true,
  },
  // ── Solis ──
  {
    id: 'inv-sl1', manufacturer: 'Solis', model: 'S6-GR1P6K-M',
    capacity: 6.0, efficiency: 97.7, type: 'string', pricePerUnit: 780,
    warranty: 10, mpptChannels: 2, batteryCompatible: false,
  },
  {
    id: 'inv-sl2', manufacturer: 'Solis', model: 'RHI-3P10K-HVES-5G',
    capacity: 10.0, efficiency: 97.7, type: 'string', pricePerUnit: 1800,
    warranty: 10, mpptChannels: 2, batteryCompatible: true,
  },
  // ── Hoymiles Microinverters ──
  {
    id: 'inv-hm1', manufacturer: 'Hoymiles', model: 'HM-600 Microinverter',
    capacity: 0.600, efficiency: 96.7, type: 'micro', pricePerUnit: 120,
    warranty: 10, batteryCompatible: false,
  },
  {
    id: 'inv-hm2', manufacturer: 'Hoymiles', model: 'HMS-2000-4T Microinverter',
    capacity: 2.0, efficiency: 96.7, type: 'micro', pricePerUnit: 380,
    warranty: 10, batteryCompatible: false,
  },
  // ── APsystems ──
  {
    id: 'inv-ap1', manufacturer: 'APsystems', model: 'EZ1-M Microinverter',
    capacity: 0.800, efficiency: 96.5, type: 'micro', pricePerUnit: 145,
    warranty: 10, batteryCompatible: false,
  },
  // ── Generac ──
  {
    id: 'inv-gen1', manufacturer: 'Generac', model: 'PWRcell Inverter 7.6kW',
    capacity: 7.6, efficiency: 97.0, type: 'string', pricePerUnit: 2200,
    warranty: 10, mpptChannels: 2, batteryCompatible: true,
  },
];

// ─── Batteries (Real Market Data 2024) ───────────────────────
export const defaultBatteries: Battery[] = [
  // ── Tesla ──
  {
    id: 'bat-ts1', manufacturer: 'Tesla', model: 'Powerwall 3',
    capacityKwh: 13.5, powerKw: 11.5, peakPowerKw: 22.0,
    roundTripEfficiency: 97.5, chemistry: 'LFP',
    cycles: 4000, warranty: 10, pricePerUnit: 11500,
    stackable: true, maxUnits: 4,
    dimensions: '43.25" × 24" × 7.6"', weight: 130,
  },
  {
    id: 'bat-ts2', manufacturer: 'Tesla', model: 'Powerwall 2',
    capacityKwh: 13.5, powerKw: 7.0, peakPowerKw: 10.0,
    roundTripEfficiency: 90.0, chemistry: 'NMC',
    cycles: 3500, warranty: 10, pricePerUnit: 9200,
    stackable: true, maxUnits: 10,
    dimensions: '45.3" × 29.6" × 5.75"', weight: 114,
  },
  // ── Enphase ──
  {
    id: 'bat-enp1', manufacturer: 'Enphase', model: 'IQ Battery 5P',
    capacityKwh: 5.0, powerKw: 3.84, peakPowerKw: 7.68,
    roundTripEfficiency: 96.0, chemistry: 'LFP',
    cycles: 4000, warranty: 15, pricePerUnit: 4500,
    stackable: true, maxUnits: 4,
    dimensions: '26.1" × 12.8" × 7.7"', weight: 54,
  },
  {
    id: 'bat-enp2', manufacturer: 'Enphase', model: 'IQ Battery 10T',
    capacityKwh: 10.08, powerKw: 7.68, peakPowerKw: 15.36,
    roundTripEfficiency: 96.0, chemistry: 'LFP',
    cycles: 4000, warranty: 15, pricePerUnit: 8500,
    stackable: true, maxUnits: 2,
    dimensions: '42.1" × 12.8" × 7.7"', weight: 108,
  },
  // ── Franklin Electric ──
  {
    id: 'bat-fr1', manufacturer: 'Franklin Electric', model: 'aGate 13.6kWh',
    capacityKwh: 13.6, powerKw: 10.0, peakPowerKw: 20.0,
    roundTripEfficiency: 96.0, chemistry: 'LFP',
    cycles: 6000, warranty: 12, pricePerUnit: 10800,
    stackable: true, maxUnits: 3,
    dimensions: '44.1" × 24.4" × 8.7"', weight: 125,
  },
  // ── SolarEdge ──
  {
    id: 'bat-se1', manufacturer: 'SolarEdge', model: 'Home Battery 9.7kWh',
    capacityKwh: 9.7, powerKw: 5.0, peakPowerKw: 7.5,
    roundTripEfficiency: 94.5, chemistry: 'LFP',
    cycles: 6000, warranty: 10, pricePerUnit: 8200,
    stackable: true, maxUnits: 3,
    dimensions: '35.4" × 18.5" × 9.1"', weight: 100,
  },
  // ── Generac ──
  {
    id: 'bat-gen1', manufacturer: 'Generac', model: 'PWRcell M6 (9kWh)',
    capacityKwh: 9.0, powerKw: 4.5, peakPowerKw: 9.0,
    roundTripEfficiency: 96.5, chemistry: 'LFP',
    cycles: 7500, warranty: 10, pricePerUnit: 9500,
    stackable: true, maxUnits: 3,
    dimensions: '26" × 22" × 10"', weight: 95,
  },
  {
    id: 'bat-gen2', manufacturer: 'Generac', model: 'PWRcell M3 (4.5kWh)',
    capacityKwh: 4.5, powerKw: 4.5, peakPowerKw: 9.0,
    roundTripEfficiency: 96.5, chemistry: 'LFP',
    cycles: 7500, warranty: 10, pricePerUnit: 5200,
    stackable: true, maxUnits: 6,
    dimensions: '26" × 22" × 10"', weight: 55,
  },
  // ── LG Energy Solution ──
  {
    id: 'bat-lg1', manufacturer: 'LG Energy Solution', model: 'RESU16H Prime',
    capacityKwh: 16.0, powerKw: 7.0, peakPowerKw: 11.0,
    roundTripEfficiency: 95.0, chemistry: 'NMC',
    cycles: 4000, warranty: 10, pricePerUnit: 12500,
    stackable: false,
    dimensions: '35.6" × 18.5" × 7.5"', weight: 135,
  },
  {
    id: 'bat-lg2', manufacturer: 'LG Energy Solution', model: 'RESU10H Prime',
    capacityKwh: 9.6, powerKw: 5.0, peakPowerKw: 7.0,
    roundTripEfficiency: 95.0, chemistry: 'NMC',
    cycles: 4000, warranty: 10, pricePerUnit: 8800,
    stackable: false,
    dimensions: '35.6" × 18.5" × 7.5"', weight: 97,
  },
  // ── Sonnen ──
  {
    id: 'bat-son1', manufacturer: 'Sonnen', model: 'sonnenCore+ 10kWh',
    capacityKwh: 10.0, powerKw: 4.8, peakPowerKw: 8.0,
    roundTripEfficiency: 85.0, chemistry: 'LFP',
    cycles: 10000, warranty: 10, pricePerUnit: 11000,
    stackable: false,
    dimensions: '27.6" × 17.7" × 13.8"', weight: 113,
  },
  // ── Panasonic ──
  {
    id: 'bat-pan1', manufacturer: 'Panasonic', model: 'EverVolt 11.4kWh',
    capacityKwh: 11.4, powerKw: 5.5, peakPowerKw: 9.0,
    roundTripEfficiency: 89.0, chemistry: 'NMC',
    cycles: 3500, warranty: 10, pricePerUnit: 9800,
    stackable: true, maxUnits: 2,
    dimensions: '44.1" × 24.4" × 8.7"', weight: 120,
  },
  // ── Sungrow ──
  {
    id: 'bat-sg1', manufacturer: 'Sungrow', model: 'SBR096 9.6kWh',
    capacityKwh: 9.6, powerKw: 5.0, peakPowerKw: 8.0,
    roundTripEfficiency: 96.0, chemistry: 'LFP',
    cycles: 6000, warranty: 10, pricePerUnit: 7500,
    stackable: true, maxUnits: 4,
    dimensions: '28.3" × 17.7" × 9.1"', weight: 92,
  },
  // ── Fortress Power ──
  {
    id: 'bat-fp1', manufacturer: 'Fortress Power', model: 'eVault Max 18.5kWh',
    capacityKwh: 18.5, powerKw: 9.6, peakPowerKw: 14.4,
    roundTripEfficiency: 98.0, chemistry: 'LFP',
    cycles: 6000, warranty: 10, pricePerUnit: 14500,
    stackable: true, maxUnits: 2,
    dimensions: '47.2" × 24.4" × 9.1"', weight: 175,
  },
  // ── Duracell ──
  {
    id: 'bat-dur1', manufacturer: 'Duracell Energy', model: 'PowerBank 10kWh',
    capacityKwh: 10.0, powerKw: 5.0, peakPowerKw: 8.0,
    roundTripEfficiency: 95.0, chemistry: 'LFP',
    cycles: 6000, warranty: 10, pricePerUnit: 8900,
    stackable: true, maxUnits: 3,
    dimensions: '35.4" × 18.5" × 9.1"', weight: 98,
  },
];

// ─── Mounting Systems ─────────────────────────────────────────
export const defaultMounting: MountingSystem[] = [
  // Roof Mount
  {
    id: 'mount-1', name: 'IronRidge XR100 Flush Mount', type: 'roof',
    pricePerWatt: 0.12, manufacturer: 'IronRidge',
    description: 'Standard flush roof mount racking system with L-feet and rails',
  },
  {
    id: 'mount-2', name: 'Unirac SolarMount Flush', type: 'roof',
    pricePerWatt: 0.11, manufacturer: 'Unirac',
    description: 'Aluminum flush mount system for asphalt shingle roofs',
  },
  {
    id: 'mount-3', name: 'Esdec FlatFix Fusion (Flat Roof)', type: 'roof',
    pricePerWatt: 0.16, manufacturer: 'Esdec',
    description: 'Ballasted flat roof mounting system, no penetrations',
  },
  {
    id: 'mount-4', name: 'S-5! Metal Roof Clamps', type: 'roof',
    pricePerWatt: 0.14, manufacturer: 'S-5!',
    description: 'Standing seam metal roof attachment system',
  },
  // Ground Mount
  {
    id: 'mount-5', name: 'Unirac RM10 Ground Mount', type: 'ground',
    pricePerWatt: 0.18, manufacturer: 'Unirac',
    description: 'Adjustable tilt ground mount system with driven piers',
  },
  {
    id: 'mount-6', name: 'IronRidge Ground Mount', type: 'ground',
    pricePerWatt: 0.20, manufacturer: 'IronRidge',
    description: 'Heavy-duty ground mount with adjustable tilt 10-30°',
  },
  {
    id: 'mount-7', name: 'GameChange Solar Genius Tracker', type: 'ground',
    pricePerWatt: 0.28, manufacturer: 'GameChange Solar',
    description: 'Single-axis tracker for maximum production',
  },
  {
    id: 'mount-8', name: 'Array Technologies DuraTrack HZ v3', type: 'ground',
    pricePerWatt: 0.30, manufacturer: 'Array Technologies',
    description: 'Single-axis solar tracker, industry leading reliability',
  },
  // Sol Fence / Vertical Bifacial
  {
    id: 'mount-9', name: 'Sol Fence Standard System', type: 'fence',
    pricePerWatt: 0.22, manufacturer: 'Sol Fence',
    description: 'Vertical bifacial fence-integrated solar system with steel posts',
  },
  {
    id: 'mount-10', name: 'Sol Fence Premium (Decorative)', type: 'fence',
    pricePerWatt: 0.28, manufacturer: 'Sol Fence',
    description: 'Premium vertical bifacial system with decorative aluminum posts',
  },
  {
    id: 'mount-11', name: 'Schletter FS Vertical Bifacial', type: 'fence',
    pricePerWatt: 0.25, manufacturer: 'Schletter',
    description: 'Agrivoltaic vertical bifacial mounting system',
  },
];

export const defaultPricing: PricingConfig = {
  pricePerWatt: 3.20,
  laborCostPerWatt: 0.65,
  equipmentCostPerWatt: 1.80,
  fixedCosts: 1500,
  profitMargin: 20,
  taxCreditRate: 0, // §25D residential ITC repealed by P.L. 119-21 (July 4, 2025) for installs after 12/31/2025. Set to 30 for commercial §48E projects beginning construction before 7/4/2026.
  utilityEscalationRate: 3.5,
  systemLifeYears: 25,
};

// No demo data — all clients and projects are created by real users

// ─── Database Class ───────────────────────────────────────────
class Database {
  private clients: Map<string, Client> = new Map();
  private projects: Map<string, Project> = new Map();
  private layouts: Map<string, Layout> = new Map();
  private productions: Map<string, ProductionResult> = new Map();
  private proposals: Map<string, Proposal> = new Map();
  private panels: Map<string, SolarPanel> = new Map();
  private inverters: Map<string, Inverter> = new Map();
  private batteries: Map<string, Battery> = new Map();
  private mountings: Map<string, MountingSystem> = new Map();
  private pricing: PricingConfig = defaultPricing;

  constructor() {
    // Load persisted data from file (no demo seeding — real user data only)
    const savedClients = loadFromFile<Client[]>('clients', []);
    const savedProjects = loadFromFile<Project[]>('projects', []);
    const savedLayouts = loadFromFile<Layout[]>('layouts', []);
    const savedProductions = loadFromFile<ProductionResult[]>('productions', []);
    const savedProposals = loadFromFile<Proposal[]>('proposals', []);

    savedClients.forEach(c => this.clients.set(c.id, c));
    savedProjects.forEach(p => this.projects.set(p.id, p));
    savedLayouts.forEach(l => this.layouts.set(l.id, l));
    savedProductions.forEach(p => this.productions.set(p.id, p));
    savedProposals.forEach(p => this.proposals.set(p.id, p));

    defaultPanels.forEach(p => this.panels.set(p.id, p));
    defaultInverters.forEach(i => this.inverters.set(i.id, i));
    defaultBatteries.forEach(b => this.batteries.set(b.id, b));
    defaultMounting.forEach(m => this.mountings.set(m.id, m));
  }

  // Clients
  getClients(): Client[] { return Array.from(this.clients.values()); }
  getClientsByUser(userId: string): Client[] { return Array.from(this.clients.values()).filter(c => c.userId === userId); }
  getClient(id: string): Client | undefined { return this.clients.get(id); }
  saveClient(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client {
    const client: Client = { ...data, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.clients.set(client.id, client);
    saveToFile('clients', Array.from(this.clients.values()));
    return client;
  }
  updateClient(id: string, data: Partial<Client>): Client | undefined {
    const existing = this.clients.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.clients.set(id, updated);
    saveToFile('clients', Array.from(this.clients.values()));
    return updated;
  }
  deleteClient(id: string): boolean { return this.clients.delete(id); }

  // Projects
  getProjects(): Project[] {
    return Array.from(this.projects.values()).map(p => {
      const layout = this.getLayoutByProject(p.id);
      const production = this.getProductionByProject(p.id);
      return {
        ...p,
        client: this.clients.get(p.clientId),
        layout: layout || p.layout,
        production: production || p.production,
      };
    });
  }
  getProjectsByUser(userId: string): Project[] {
    return this.getProjects().filter(p => p.userId === userId);
  }
  getProject(id: string): Project | undefined {
    const p = this.projects.get(id);
    if (!p) return undefined;
    const layout = this.getLayoutByProject(id);
    const production = this.getProductionByProject(id);
    return {
      ...p,
      client: this.clients.get(p.clientId),
      layout: layout || p.layout,
      production: production || p.production,
    };
  }
  saveProject(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const project: Project = { ...data, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.projects.set(project.id, project);
    saveToFile('projects', Array.from(this.projects.values()));
    return { ...project, client: this.clients.get(project.clientId) };
  }
  updateProject(id: string, data: Partial<Project>): Project | undefined {
    const existing = this.projects.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.projects.set(id, updated);
    saveToFile('projects', Array.from(this.projects.values()));
    return { ...updated, client: this.clients.get(updated.clientId) };
  }
  deleteProject(id: string): boolean { return this.projects.delete(id); }

  // Layouts
  getLayout(id: string): Layout | undefined { return this.layouts.get(id); }
  getLayoutByProject(projectId: string): Layout | undefined {
    // Return the MOST RECENT layout for this project (sorted by updatedAt desc)
    const matching = Array.from(this.layouts.values()).filter(l => l.projectId === projectId);
    if (matching.length === 0) return undefined;
    return matching.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }
  saveLayout(data: Omit<Layout, 'id' | 'createdAt' | 'updatedAt'>): Layout {
    const layout: Layout = { ...data, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.layouts.set(layout.id, layout);
    saveToFile('layouts', Array.from(this.layouts.values()));
    return layout;
  }
  updateLayout(id: string, data: Partial<Layout>): Layout | undefined {
    const existing = this.layouts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.layouts.set(id, updated);
    saveToFile('layouts', Array.from(this.layouts.values()));
    return updated;
  }

  // Productions
  getProduction(id: string): ProductionResult | undefined { return this.productions.get(id); }
  getProductionByProject(projectId: string): ProductionResult | undefined {
    // Return the MOST RECENT production for this project (sorted by calculatedAt desc)
    const matching = Array.from(this.productions.values()).filter(p => p.projectId === projectId);
    if (matching.length === 0) return undefined;
    return matching.sort((a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime())[0];
  }
  saveProduction(data: Omit<ProductionResult, 'id' | 'calculatedAt'> & { calculatedAt?: string }): ProductionResult {
    const prod: ProductionResult = { ...data, id: uuidv4(), calculatedAt: data.calculatedAt || new Date().toISOString() };
    this.productions.set(prod.id, prod);
    saveToFile('productions', Array.from(this.productions.values()));
    return prod;
  }

  // Proposals
  getProposals(): Proposal[] { return Array.from(this.proposals.values()); }
  getProposalsByUser(userId: string): Proposal[] { return Array.from(this.proposals.values()).filter(p => (p as any).userId === userId); }
  getProposal(id: string): Proposal | undefined { return this.proposals.get(id); }
  getProposalByToken(token: string): Proposal | undefined {
    return Array.from(this.proposals.values()).find(p => p.shareToken === token);
  }
  saveProposal(data: Omit<Proposal, 'id' | 'createdAt' | 'updatedAt'>): Proposal {
    const proposal: Proposal = { ...data, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.proposals.set(proposal.id, proposal);
    saveToFile('proposals', Array.from(this.proposals.values()));
    return proposal;
  }
  updateProposal(id: string, data: Partial<Proposal>): Proposal | undefined {
    const existing = this.proposals.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.proposals.set(id, updated);
    saveToFile('proposals', Array.from(this.proposals.values()));
    return updated;
  }

  // Hardware
  getPanels(): SolarPanel[] { return Array.from(this.panels.values()); }
  getPanel(id: string): SolarPanel | undefined { return this.panels.get(id); }
  savePanel(data: Omit<SolarPanel, 'id'>): SolarPanel {
    const panel: SolarPanel = { ...data, id: uuidv4() };
    this.panels.set(panel.id, panel);
    return panel;
  }
  updatePanel(id: string, data: Partial<SolarPanel>): SolarPanel | undefined {
    const existing = this.panels.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.panels.set(id, updated);
    return updated;
  }

  // Inverters
  getInverters(): Inverter[] { return Array.from(this.inverters.values()); }
  getInverter(id: string): Inverter | undefined { return this.inverters.get(id); }
  saveInverter(data: Omit<Inverter, 'id'>): Inverter {
    const inverter: Inverter = { ...data, id: uuidv4() };
    this.inverters.set(inverter.id, inverter);
    return inverter;
  }
  updateInverter(id: string, data: Partial<Inverter>): Inverter | undefined {
    const existing = this.inverters.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.inverters.set(id, updated);
    return updated;
  }
  deleteInverter(id: string): boolean {
    return this.inverters.delete(id);
  }

  // Batteries
  getBatteries(): Battery[] { return Array.from(this.batteries.values()); }
  getBattery(id: string): Battery | undefined { return this.batteries.get(id); }
  saveBattery(data: Omit<Battery, 'id'>): Battery {
    const battery: Battery = { ...data, id: uuidv4() };
    this.batteries.set(battery.id, battery);
    return battery;
  }
  updateBattery(id: string, data: Partial<Battery>): Battery | undefined {
    const existing = this.batteries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.batteries.set(id, updated);
    return updated;
  }
  deleteBattery(id: string): boolean {
    return this.batteries.delete(id);
  }

  // Mounting Systems
  getMountings(): MountingSystem[] { return Array.from(this.mountings.values()); }
  getMounting(id: string): MountingSystem | undefined { return this.mountings.get(id); }
  saveMounting(data: Omit<MountingSystem, 'id'>): MountingSystem {
    const mounting: MountingSystem = { ...data, id: uuidv4() };
    this.mountings.set(mounting.id, mounting);
    return mounting;
  }
  updateMounting(id: string, data: Partial<MountingSystem>): MountingSystem | undefined {
    const existing = this.mountings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.mountings.set(id, updated);
    return updated;
  }
  deleteMounting(id: string): boolean {
    return this.mountings.delete(id);
  }

  // Panel delete
  deletePanel(id: string): boolean {
    return this.panels.delete(id);
  }

  getPricing(): PricingConfig { return this.pricing; }
  updatePricing(data: Partial<PricingConfig>): PricingConfig {
    this.pricing = { ...this.pricing, ...data };
    return this.pricing;
  }

  // Stats
  getStats() {
    const projects = this.getProjects();
    const clients = this.getClients();
    const proposals = this.getProposals();

    // Calculate real stats from actual data
    const projectsByStatus = { lead: 0, design: 0, proposal: 0, approved: 0, installed: 0 };
    const projectsByType = { roof: 0, ground: 0, fence: 0 };
    let totalSystemSizeKw = 0;
    let totalAnnualProductionKwh = 0;

    for (const p of projects) {
      if (p.status && projectsByStatus.hasOwnProperty(p.status)) {
        (projectsByStatus as any)[p.status]++;
      }
      if (p.systemType && projectsByType.hasOwnProperty(p.systemType)) {
        (projectsByType as any)[p.systemType]++;
      }
      const layout = this.getLayoutByProject(p.id);
      if (layout?.systemSizeKw) totalSystemSizeKw += layout.systemSizeKw;
      const production = this.getProductionByProject(p.id);
      if (production?.annualProductionKwh) totalAnnualProductionKwh += production.annualProductionKwh;
    }

    return {
      totalProjects: projects.length,
      totalClients: clients.length,
      totalProposals: proposals.length,
      totalSystemSizeKw: Math.round(totalSystemSizeKw * 10) / 10,
      totalAnnualProductionKwh: Math.round(totalAnnualProductionKwh),
      totalRevenue: 0,
      projectsByStatus,
      projectsByType,
      recentProjects: projects.slice(0, 5),
      monthlyRevenue: Array.from({ length: 12 }, (_, i) => ({
        month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
        revenue: 0,
      })),
    };
  }
}

const db = new Database();
export default db;