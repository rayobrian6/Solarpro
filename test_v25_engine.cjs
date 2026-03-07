// lib/array-geometry.ts
function computeArrayGeometry(input) {
  const {
    panelCount,
    panel,
    orientation,
    rowCount,
    moduleGapIn = 0.5,
    rowGapIn = 6,
    railOverhangIn = 6,
    railsPerRow = 2
  } = input;
  const panelLongIn = orientation === "portrait" ? panel.lengthIn : panel.widthIn;
  const panelShortIn = orientation === "portrait" ? panel.widthIn : panel.lengthIn;
  const colCount = input.colCount ?? Math.ceil(panelCount / rowCount);
  const totalPanels = panelCount;
  const arrayWidthIn = colCount * panelLongIn + (colCount - 1) * moduleGapIn;
  const arrayHeightIn = rowCount * panelShortIn + (rowCount - 1) * rowGapIn;
  const railLengthIn = arrayWidthIn + 2 * railOverhangIn;
  const railLengthFt = railLengthIn / 12;
  const railCount = railsPerRow * rowCount;
  const railSpacingIn = panelShortIn;
  const midClampPositionsIn = [];
  const endClampPositionsIn = [];
  for (let r = 0; r < railCount; r++) {
    endClampPositionsIn.push([railOverhangIn, railLengthIn - railOverhangIn]);
    const mids = [];
    for (let c = 1; c < colCount; c++) {
      const pos = railOverhangIn + c * panelLongIn + (c - 0.5) * moduleGapIn;
      mids.push(pos);
    }
    midClampPositionsIn.push(mids);
  }
  const midClampsPerRail = Math.max(0, colCount - 1);
  const endClampsPerRail = 2;
  const totalMidClamps = midClampsPerRail * railCount;
  const totalEndClamps = endClampsPerRail * railCount;
  const totalPanelWeightLbs = panelCount * panel.weightLbs;
  const arrayAreaFt2 = arrayWidthIn / 12 * (arrayHeightIn / 12);
  const panelWeightPsfApprox = arrayAreaFt2 > 0 ? totalPanelWeightLbs / arrayAreaFt2 : 0;
  return {
    panelLongIn,
    panelShortIn,
    rowCount,
    colCount,
    totalPanels,
    arrayWidthIn,
    arrayHeightIn,
    railsPerRow,
    railCount,
    railLengthIn,
    railLengthFt,
    railSpacingIn,
    railOverhangIn,
    midClampPositionsIn,
    endClampPositionsIn,
    midClampsPerRail,
    endClampsPerRail,
    totalMidClamps,
    totalEndClamps,
    totalPanelWeightLbs,
    panelWeightPsfApprox,
    maxCantileverIn: railOverhangIn
    // updated by structural engine after mount layout
  };
}
function autoLayout(panelCount) {
  if (panelCount <= 6) return { rowCount: 1, colCount: panelCount };
  if (panelCount <= 12) return { rowCount: 2, colCount: Math.ceil(panelCount / 2) };
  if (panelCount <= 20) return { rowCount: 2, colCount: Math.ceil(panelCount / 2) };
  if (panelCount <= 30) return { rowCount: 3, colCount: Math.ceil(panelCount / 3) };
  if (panelCount <= 40) return { rowCount: 4, colCount: Math.ceil(panelCount / 4) };
  if (panelCount <= 60) return { rowCount: 4, colCount: Math.ceil(panelCount / 4) };
  return { rowCount: 5, colCount: Math.ceil(panelCount / 5) };
}

// lib/mounting-hardware-db.ts
var MOUNTING_SYSTEMS = [
  // ══════════════════════════════════════════════════════════════════════════
  // IRONRIDGE — Rail-Based Residential
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "ironridge-xr100",
    manufacturer: "IronRidge",
    productLine: "XR Rail",
    model: "XR100",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"],
    description: "IronRidge XR100 aluminum rail system for residential asphalt shingle roofs",
    rail: {
      model: "XR100",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      // 1800 ft-lbs × 12
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      // 14 ft standard section
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-2962"
    },
    mount: {
      model: "IronRidge L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 500,
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-2962",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"]
    },
    hardware: {
      midClamp: "IronRidge UFO Mid Clamp",
      endClamp: "IronRidge UFO End Clamp",
      railSplice: "IronRidge XR100 Splice",
      groundLug: "IronRidge Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "IronRidge Flashing Kit",
      bondingHardware: "IronRidge Bond Washer"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-2962",
    engineeringDataSource: "IronRidge XR100 Engineering Design Guide Rev 2.0",
    lastUpdated: "2024-01"
  },
  {
    id: "ironridge-xr1000",
    manufacturer: "IronRidge",
    productLine: "XR Rail",
    model: "XR1000",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"],
    description: "IronRidge XR1000 heavy-duty rail for high wind/snow zones",
    rail: {
      model: "XR1000",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 2,
      widthIn: 1,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 36e3,
      // 3000 ft-lbs × 12
      shearCapacityLbs: 3200,
      maxSpanIn: 84,
      maxCantileverIn: 30,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1.25,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-2962"
    },
    mount: {
      model: "IronRidge L-Foot Heavy",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1e3,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 84,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-2962",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"]
    },
    hardware: {
      midClamp: "IronRidge UFO Mid Clamp",
      endClamp: "IronRidge UFO End Clamp",
      railSplice: "IronRidge XR1000 Splice",
      groundLug: "IronRidge Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "IronRidge Flashing Kit",
      bondingHardware: "IronRidge Bond Washer"
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-2962",
    engineeringDataSource: "IronRidge XR1000 Engineering Design Guide Rev 2.0",
    lastUpdated: "2024-01"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // UNIRAC — Rail-Based Residential & Commercial
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "unirac-solarmount",
    manufacturer: "Unirac",
    productLine: "SolarMount",
    model: "SolarMount Classic",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"],
    description: "Unirac SolarMount Classic aluminum rail system",
    rail: {
      model: "SolarMount Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.75,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 24e3,
      shearCapacityLbs: 2400,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-1894"
    },
    mount: {
      model: "Unirac L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 550,
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-1894",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"]
    },
    hardware: {
      midClamp: "Unirac Mid Clamp",
      endClamp: "Unirac End Clamp",
      railSplice: "Unirac Rail Splice",
      groundLug: "Unirac Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "Unirac Flashing Kit",
      bondingHardware: "Unirac Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-1894",
    engineeringDataSource: "Unirac SolarMount Engineering Design Guide 2023",
    lastUpdated: "2023-06"
  },
  {
    id: "unirac-sme",
    manufacturer: "Unirac",
    productLine: "SolarMount Evolution",
    model: "SME",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated", "tile_concrete"],
    description: "Unirac SolarMount Evolution \u2014 next-gen rail system with integrated bonding",
    rail: {
      model: "SME Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.75,
      widthIn: 1,
      wallThicknessIn: 0.14,
      momentCapacityInLbs: 26400,
      shearCapacityLbs: 2600,
      maxSpanIn: 78,
      maxCantileverIn: 26,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1.05,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-1894"
    },
    mount: {
      model: "Unirac SME L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 78,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-1894",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated", "tile_concrete"]
    },
    hardware: {
      midClamp: "Unirac SME Mid Clamp",
      endClamp: "Unirac SME End Clamp",
      railSplice: "Unirac SME Splice",
      groundLug: "Unirac Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "Unirac Flashing Kit",
      bondingHardware: "Unirac Bond Clip"
    },
    maxWindSpeedMph: 170,
    maxSnowLoadPsf: 60,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-1894",
    engineeringDataSource: "Unirac SME Engineering Design Guide 2023",
    lastUpdated: "2023-09"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // ROOF TECH — Rail-Less (RT-MINI)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "rooftech-mini",
    manufacturer: "Roof Tech",
    productLine: "RT-MINI",
    model: "RT-MINI",
    category: "roof_residential",
    systemType: "rail_less",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake"],
    description: "Roof Tech RT-MINI rail-less mount \u2014 2 lag bolts per mount, ICC-ES ESR-3575",
    mount: {
      model: "RT-MINI",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 900,
      // 2 × 450 lbs/lag (ICC-ES ESR-3575)
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,
      // per lag bolt (ICC-ES ESR-3575)
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-3575",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake"]
    },
    hardware: {
      midClamp: "RT-MINI Mid Clamp",
      endClamp: "RT-MINI End Clamp",
      railSplice: "N/A \u2014 Rail-less system",
      groundLug: "RT-MINI Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS (2 per mount)',
      flashingKit: "RT-MINI Flashing Kit",
      bondingHardware: "RT-MINI Bond Clip"
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-3575",
    engineeringDataSource: "Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023",
    lastUpdated: "2023-01"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // SNAPNRACK — Rail-Based
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "snapnrack-100",
    manufacturer: "SnapNrack",
    productLine: "Series 100",
    model: "Series 100",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"],
    description: "SnapNrack Series 100 aluminum rail system",
    rail: {
      model: "Series 100 Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 20400,
      shearCapacityLbs: 2100,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.92,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-3575"
    },
    mount: {
      model: "SnapNrack L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 500,
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"]
    },
    hardware: {
      midClamp: "SnapNrack Mid Clamp",
      endClamp: "SnapNrack End Clamp",
      railSplice: "SnapNrack Rail Splice",
      groundLug: "SnapNrack Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "SnapNrack Flashing Kit",
      bondingHardware: "SnapNrack Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: "SnapNrack Series 100 Engineering Design Guide 2023",
    lastUpdated: "2023-03"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // QUICKMOUNT PV — Tile Hook Systems
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "quickmount-classic",
    manufacturer: "QuickMount PV",
    productLine: "Classic Mount",
    model: "QM-Classic",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake"],
    description: "QuickMount PV Classic Mount \u2014 integrated flashing, asphalt shingle",
    mount: {
      model: "QM-Classic",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-2835",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake"]
    },
    rail: {
      model: "QM Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-2835"
    },
    hardware: {
      midClamp: "QM Mid Clamp",
      endClamp: "QM End Clamp",
      railSplice: "QM Rail Splice",
      groundLug: "QM Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "QM Classic Flashing (integrated)",
      bondingHardware: "QM Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-2835",
    engineeringDataSource: "QuickMount PV Classic Mount ICC-ES ESR-2835",
    lastUpdated: "2023-06"
  },
  {
    id: "quickmount-tile",
    manufacturer: "QuickMount PV",
    productLine: "Tile Replacement Mount",
    model: "QM-Tile",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["tile_concrete", "tile_clay"],
    description: "QuickMount PV Tile Replacement Mount \u2014 concrete/clay tile roofs",
    mount: {
      model: "QM-Tile",
      attachmentMethod: "tile_replacement",
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1e3,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 60,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-2835",
      ul2703Listed: true,
      compatibleRoofTypes: ["tile_concrete", "tile_clay"]
    },
    rail: {
      model: "QM Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 60,
      maxCantileverIn: 20,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: "ICC-ES ESR-2835"
    },
    hardware: {
      midClamp: "QM Mid Clamp",
      endClamp: "QM End Clamp",
      railSplice: "QM Rail Splice",
      groundLug: "QM Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      tileHook: "QM Tile Replacement Hook",
      bondingHardware: "QM Bond Clip"
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 10,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-2835",
    engineeringDataSource: "QuickMount PV Tile Replacement Mount ICC-ES ESR-2835",
    lastUpdated: "2023-06"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // S-5! — Standing Seam Metal Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "s5-pvkit",
    manufacturer: "S-5!",
    productLine: "PV Kit",
    model: "S-5! PVKit 2.0",
    category: "roof_residential",
    systemType: "standing_seam",
    compatibleRoofTypes: ["metal_standing_seam"],
    description: "S-5! PVKit 2.0 \u2014 no-penetration standing seam clamp system",
    mount: {
      model: "S-5! PVKIT Clamp",
      attachmentMethod: "standing_seam_clamp",
      upliftCapacityLbs: 800,
      // per clamp (varies by seam profile)
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 0,
      // no roof penetrations
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      // no rafter penetration
      iccEsReport: "FM 4478 Approved",
      ul2703Listed: true,
      compatibleRoofTypes: ["metal_standing_seam"]
    },
    rail: {
      model: "S-5! Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.5,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 18e3,
      shearCapacityLbs: 1800,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.88,
      ul2703Listed: true
    },
    hardware: {
      midClamp: "S-5! Mid Clamp",
      endClamp: "S-5! End Clamp",
      railSplice: "S-5! Rail Splice",
      groundLug: "S-5! Ground Lug",
      lagBolt: "N/A \u2014 No penetrations",
      bondingHardware: "S-5! Bond Clip"
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 1,
    ul2703Listed: true,
    fm4478Approved: true,
    engineeringDataSource: "S-5! PVKit 2.0 Engineering Design Guide 2023",
    lastUpdated: "2023-08"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // K2 SYSTEMS — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "k2-crossrail",
    manufacturer: "K2 Systems",
    productLine: "CrossRail",
    model: "CrossRail Pro",
    category: "roof_commercial",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated", "metal_standing_seam"],
    description: "K2 Systems CrossRail Pro \u2014 commercial-grade rail system",
    rail: {
      model: "CrossRail Pro",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 2,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 36e3,
      shearCapacityLbs: 3600,
      maxSpanIn: 84,
      maxCantileverIn: 30,
      spliceIntervalIn: 192,
      // 16 ft sections
      weightLbsPerFt: 1.3,
      ul2703Listed: true
    },
    mount: {
      model: "K2 L-Foot Pro",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 84,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated", "metal_standing_seam"]
    },
    hardware: {
      midClamp: "K2 Mid Clamp",
      endClamp: "K2 End Clamp",
      railSplice: "K2 CrossRail Splice",
      groundLug: "K2 Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "K2 Flashing Kit",
      bondingHardware: "K2 Bond Clip"
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: "K2 Systems CrossRail Pro Engineering Manual 2023",
    lastUpdated: "2023-05"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // ECOFASTEN — Rail-Less
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "ecofasten-rockit",
    manufacturer: "EcoFasten",
    productLine: "Rock-It",
    model: "Rock-It Gen 4",
    category: "roof_residential",
    systemType: "rail_less",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake"],
    description: "EcoFasten Rock-It Gen 4 \u2014 rail-less mount with integrated flashing",
    mount: {
      model: "Rock-It Gen 4",
      attachmentMethod: "rail_less_lag",
      upliftCapacityLbs: 800,
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: "ICC-ES ESR-3575",
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake"]
    },
    hardware: {
      midClamp: "EcoFasten Mid Clamp",
      endClamp: "EcoFasten End Clamp",
      railSplice: "N/A \u2014 Rail-less",
      groundLug: "EcoFasten Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS (2 per mount)',
      flashingKit: "EcoFasten Integrated Flashing",
      bondingHardware: "EcoFasten Bond Clip"
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: "ICC-ES ESR-3575",
    engineeringDataSource: "EcoFasten Rock-It Gen 4 Engineering Guide 2023",
    lastUpdated: "2023-04"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // SCHLETTER — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "schletter-classic",
    manufacturer: "Schletter",
    productLine: "Classic",
    model: "Schletter Classic Rail",
    category: "roof_commercial",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated", "metal_standing_seam", "flat_tpo"],
    description: "Schletter Classic commercial rail system \u2014 high-load capacity",
    rail: {
      model: "Schletter Classic Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 2,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 38400,
      shearCapacityLbs: 3800,
      maxSpanIn: 90,
      maxCantileverIn: 32,
      spliceIntervalIn: 192,
      weightLbsPerFt: 1.35,
      ul2703Listed: true
    },
    mount: {
      model: "Schletter L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 750,
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 650,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 90,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated", "metal_standing_seam"]
    },
    hardware: {
      midClamp: "Schletter Mid Clamp",
      endClamp: "Schletter End Clamp",
      railSplice: "Schletter Rail Splice",
      groundLug: "Schletter Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "Schletter Flashing Kit",
      bondingHardware: "Schletter Bond Clip"
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 80,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: "Schletter Classic Rail Engineering Manual 2023",
    lastUpdated: "2023-07"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // SUNMODO — Rail-Based
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "sunmodo-ez",
    manufacturer: "SunModo",
    productLine: "EZ Mount",
    model: "SunModo EZ",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"],
    description: "SunModo EZ Mount \u2014 quick-install rail system",
    mount: {
      model: "SunModo EZ L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 550,
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "wood_shake", "metal_corrugated"]
    },
    rail: {
      model: "SunModo Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true
    },
    hardware: {
      midClamp: "SunModo Mid Clamp",
      endClamp: "SunModo End Clamp",
      railSplice: "SunModo Rail Splice",
      groundLug: "SunModo Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "SunModo Flashing Kit",
      bondingHardware: "SunModo Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: "SunModo EZ Mount Engineering Guide 2023",
    lastUpdated: "2023-02"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // DPW SOLAR — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "dpw-powerrail",
    manufacturer: "DPW Solar",
    productLine: "Power Rail",
    model: "Power Rail D-Series",
    category: "roof_commercial",
    systemType: "rail_based",
    compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated", "flat_tpo", "flat_epdm"],
    description: "DPW Solar Power Rail D-Series \u2014 commercial heavy-duty rail",
    rail: {
      model: "Power Rail D-Series",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 2.25,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 42e3,
      shearCapacityLbs: 4200,
      maxSpanIn: 96,
      maxCantileverIn: 36,
      spliceIntervalIn: 192,
      weightLbsPerFt: 1.45,
      ul2703Listed: true
    },
    mount: {
      model: "DPW L-Foot",
      attachmentMethod: "l_foot_lag",
      upliftCapacityLbs: 800,
      downwardCapacityLbs: 1300,
      shearCapacityLbs: 700,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 96,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ["asphalt_shingle", "metal_corrugated"]
    },
    hardware: {
      midClamp: "DPW Mid Clamp",
      endClamp: "DPW End Clamp",
      railSplice: "DPW Rail Splice",
      groundLug: "DPW Ground Lug",
      lagBolt: '1/2" \xD7 3" Lag Bolt SS',
      flashingKit: "DPW Flashing Kit",
      bondingHardware: "DPW Bond Clip"
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 80,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: "DPW Solar Power Rail D-Series Engineering Manual 2023",
    lastUpdated: "2023-06"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PANELCLAW — Commercial Ballasted Flat Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "panelclaw-polar-bear",
    manufacturer: "PanelClaw",
    productLine: "Polar Bear",
    model: "Polar Bear 3",
    category: "roof_commercial",
    systemType: "ballasted_flat",
    compatibleRoofTypes: ["flat_tpo", "flat_epdm", "flat_pvc", "flat_gravel"],
    description: "PanelClaw Polar Bear 3 \u2014 ballasted flat roof system, no penetrations",
    mount: {
      model: "Polar Bear 3 Base",
      attachmentMethod: "ballasted",
      upliftCapacityLbs: 0,
      // ballast-only, no mechanical attachment
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ["flat_tpo", "flat_epdm", "flat_pvc", "flat_gravel"]
    },
    ballast: {
      blockWeightLbs: 40,
      blockDimensionsIn: [16, 8, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 8,
      windUpliftResistanceLbs: 40,
      maxWindSpeedMph: 130,
      exposureCategories: ["B", "C"],
      tiltAngleDeg: 10,
      rowSpacingFt: 8
    },
    hardware: {
      midClamp: "PanelClaw Mid Clamp",
      endClamp: "PanelClaw End Clamp",
      railSplice: "N/A",
      groundLug: "PanelClaw Ground Lug",
      lagBolt: "N/A \u2014 Ballasted",
      bondingHardware: "PanelClaw Bond Clip"
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    fm4478Approved: true,
    engineeringDataSource: "PanelClaw Polar Bear 3 Engineering Design Guide 2023",
    lastUpdated: "2023-09"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // GAMECHANGE SOLAR — Commercial Ballasted + Ground Mount
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "gamechange-genius",
    manufacturer: "GameChange Solar",
    productLine: "Genius Tracker",
    model: "Genius Tracker",
    category: "ground_mount",
    systemType: "tracker_single_axis",
    compatibleRoofTypes: ["any"],
    description: "GameChange Solar Genius Tracker \u2014 single-axis tracker for utility-scale",
    mount: {
      model: "Genius Tracker Pile",
      attachmentMethod: "driven_pile",
      upliftCapacityLbs: 15e3,
      downwardCapacityLbs: 2e4,
      shearCapacityLbs: 8e3,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 240,
      // 20 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ["any"]
    },
    tracker: {
      trackerType: "single_axis",
      rowSpacingFt: 18,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 60,
      rotationRangeDeg: 60,
      actuatorType: "slew_drive",
      foundationType: "driven_pile",
      pileSpacingFt: 20,
      gcoverageRatio: 0.4,
      windSpeedMaxMph: 130,
      stowAngleDeg: 52
    },
    hardware: {
      midClamp: "GameChange Mid Clamp",
      endClamp: "GameChange End Clamp",
      railSplice: "GameChange Torque Tube Splice",
      groundLug: "GameChange Ground Lug",
      lagBolt: "N/A \u2014 Pile Foundation",
      bondingHardware: "GameChange Bond Clip"
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: "GameChange Solar Genius Tracker Engineering Manual 2023",
    lastUpdated: "2023-10"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // NEXTRACKER — Single-Axis Tracker
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "nextracker-nr3",
    manufacturer: "NEXTracker",
    productLine: "NX Horizon",
    model: "NX Horizon",
    category: "ground_mount",
    systemType: "tracker_single_axis",
    compatibleRoofTypes: ["any"],
    description: "NEXTracker NX Horizon \u2014 self-powered single-axis tracker",
    mount: {
      model: "NX Horizon Pile",
      attachmentMethod: "driven_pile",
      upliftCapacityLbs: 2e4,
      downwardCapacityLbs: 25e3,
      shearCapacityLbs: 1e4,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 288,
      // 24 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ["any"]
    },
    tracker: {
      trackerType: "single_axis",
      rowSpacingFt: 20,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 90,
      rotationRangeDeg: 60,
      actuatorType: "slew_drive",
      foundationType: "driven_pile",
      pileSpacingFt: 24,
      gcoverageRatio: 0.42,
      windSpeedMaxMph: 140,
      stowAngleDeg: 52
    },
    hardware: {
      midClamp: "NEXTracker Mid Clamp",
      endClamp: "NEXTracker End Clamp",
      railSplice: "NEXTracker Torque Tube Splice",
      groundLug: "NEXTracker Ground Lug",
      lagBolt: "N/A \u2014 Pile Foundation",
      bondingHardware: "NEXTracker Bond Clip"
    },
    maxWindSpeedMph: 140,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: "NEXTracker NX Horizon Engineering Manual 2023",
    lastUpdated: "2023-11"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // ARRAY TECHNOLOGIES — Single-Axis Tracker
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "array-tech-duratrack",
    manufacturer: "Array Technologies",
    productLine: "DuraTrack",
    model: "DuraTrack HZ v3",
    category: "ground_mount",
    systemType: "tracker_single_axis",
    compatibleRoofTypes: ["any"],
    description: "Array Technologies DuraTrack HZ v3 \u2014 horizontal single-axis tracker",
    mount: {
      model: "DuraTrack Pile",
      attachmentMethod: "driven_pile",
      upliftCapacityLbs: 18e3,
      downwardCapacityLbs: 22e3,
      shearCapacityLbs: 9e3,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 264,
      // 22 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ["any"]
    },
    tracker: {
      trackerType: "single_axis",
      rowSpacingFt: 19,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 72,
      rotationRangeDeg: 60,
      actuatorType: "slew_drive",
      foundationType: "driven_pile",
      pileSpacingFt: 22,
      gcoverageRatio: 0.41,
      windSpeedMaxMph: 135,
      stowAngleDeg: 52
    },
    hardware: {
      midClamp: "Array Tech Mid Clamp",
      endClamp: "Array Tech End Clamp",
      railSplice: "Array Tech Torque Tube Splice",
      groundLug: "Array Tech Ground Lug",
      lagBolt: "N/A \u2014 Pile Foundation",
      bondingHardware: "Array Tech Bond Clip"
    },
    maxWindSpeedMph: 135,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: "Array Technologies DuraTrack HZ v3 Engineering Manual 2023",
    lastUpdated: "2023-09"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // ACECLAMP — Corrugated Metal Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "aceclamp-corrugated",
    manufacturer: "AceClamp",
    productLine: "Metal Roof",
    model: "AceClamp Corrugated",
    category: "roof_residential",
    systemType: "rail_based",
    compatibleRoofTypes: ["metal_corrugated"],
    description: "AceClamp corrugated metal roof mount \u2014 no penetrations",
    mount: {
      model: "AceClamp Corrugated",
      attachmentMethod: "corrugated_clamp",
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 0,
      // clamp only, no penetrations
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ["metal_corrugated"]
    },
    rail: {
      model: "AceClamp Rail",
      materialAlloy: "6005-T5 aluminum",
      heightIn: 1.66,
      widthIn: 1,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true
    },
    hardware: {
      midClamp: "AceClamp Mid Clamp",
      endClamp: "AceClamp End Clamp",
      railSplice: "AceClamp Rail Splice",
      groundLug: "AceClamp Ground Lug",
      lagBolt: "N/A \u2014 Clamp system",
      bondingHardware: "AceClamp Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 1,
    ul2703Listed: true,
    engineeringDataSource: "AceClamp Corrugated Metal Roof Engineering Guide 2023",
    lastUpdated: "2023-05"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // GROUND MOUNT — Dual Post (Generic)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "ground-dual-post-driven",
    manufacturer: "Generic",
    productLine: "Ground Mount",
    model: "Dual-Post Driven Pile",
    category: "ground_mount",
    systemType: "ground_dual_post",
    compatibleRoofTypes: ["any"],
    description: "Standard dual-post driven pile ground mount system",
    mount: {
      model: "Dual-Post Driven Pile",
      attachmentMethod: "driven_pile",
      upliftCapacityLbs: 8e3,
      downwardCapacityLbs: 12e3,
      shearCapacityLbs: 5e3,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 144,
      // 12 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ["any"]
    },
    groundMount: {
      pileType: "driven",
      pileSpacingFt: 10,
      maxPileSpanFt: 12,
      pileEmbedmentFt: 4,
      pileCapacityUpliftLbs: 8e3,
      pileCapacityDownwardLbs: 12e3,
      pileCapacityLateralLbs: 5e3,
      frameSpanFt: 10,
      maxArrayWidthFt: 100,
      maxArrayHeightFt: 20,
      tiltAngleDeg: 20,
      groundClearanceIn: 24
    },
    hardware: {
      midClamp: "Ground Mount Mid Clamp",
      endClamp: "Ground Mount End Clamp",
      railSplice: "Ground Mount Rail Splice",
      groundLug: "Ground Mount Ground Lug",
      lagBolt: "N/A \u2014 Pile Foundation",
      bondingHardware: "Ground Mount Bond Clip"
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: false,
    engineeringDataSource: "ASCE 7-22 Ground Mount Design Standards",
    lastUpdated: "2024-01"
  },
  {
    id: "ground-single-post-helical",
    manufacturer: "Generic",
    productLine: "Ground Mount",
    model: "Single-Post Helical Pile",
    category: "ground_mount",
    systemType: "ground_helical",
    compatibleRoofTypes: ["any"],
    description: "Single-post helical pile ground mount \u2014 ideal for rocky/sandy soil",
    mount: {
      model: "Single-Post Helical Pile",
      attachmentMethod: "helical_pile",
      upliftCapacityLbs: 1e4,
      downwardCapacityLbs: 15e3,
      shearCapacityLbs: 6e3,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 120,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ["any"]
    },
    groundMount: {
      pileType: "helical",
      pileSpacingFt: 8,
      maxPileSpanFt: 10,
      pileEmbedmentFt: 6,
      pileCapacityUpliftLbs: 1e4,
      pileCapacityDownwardLbs: 15e3,
      pileCapacityLateralLbs: 6e3,
      frameSpanFt: 8,
      maxArrayWidthFt: 80,
      maxArrayHeightFt: 15,
      tiltAngleDeg: 20,
      groundClearanceIn: 24
    },
    hardware: {
      midClamp: "Ground Mount Mid Clamp",
      endClamp: "Ground Mount End Clamp",
      railSplice: "Ground Mount Rail Splice",
      groundLug: "Ground Mount Ground Lug",
      lagBolt: "N/A \u2014 Helical Pile",
      bondingHardware: "Ground Mount Bond Clip"
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 60,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: false,
    engineeringDataSource: "ASCE 7-22 Helical Pile Design Standards",
    lastUpdated: "2024-01"
  },
  // ══════════════════════════════════════════════════════════════════════════
  // ESDEC — Flat Roof Ballasted
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "esdec-flatfix",
    manufacturer: "Esdec",
    productLine: "FlatFix",
    model: "FlatFix Fusion",
    category: "roof_commercial",
    systemType: "ballasted_flat",
    compatibleRoofTypes: ["flat_tpo", "flat_epdm", "flat_pvc", "flat_gravel"],
    description: "Esdec FlatFix Fusion \u2014 ballasted flat roof system with aerodynamic design",
    mount: {
      model: "FlatFix Fusion Base",
      attachmentMethod: "ballasted",
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ["flat_tpo", "flat_epdm", "flat_pvc", "flat_gravel"]
    },
    ballast: {
      blockWeightLbs: 33,
      blockDimensionsIn: [14, 7, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 6,
      windUpliftResistanceLbs: 33,
      maxWindSpeedMph: 120,
      exposureCategories: ["B", "C"],
      tiltAngleDeg: 10,
      rowSpacingFt: 7
    },
    hardware: {
      midClamp: "Esdec Mid Clamp",
      endClamp: "Esdec End Clamp",
      railSplice: "N/A",
      groundLug: "Esdec Ground Lug",
      lagBolt: "N/A \u2014 Ballasted",
      bondingHardware: "Esdec Bond Clip"
    },
    maxWindSpeedMph: 120,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    engineeringDataSource: "Esdec FlatFix Fusion Engineering Design Guide 2023",
    lastUpdated: "2023-08"
  }
];
function getMountingSystemById(id) {
  return MOUNTING_SYSTEMS.find((s) => s.id === id);
}
var LEGACY_ID_MAP = {
  "ironridge-xr100": "ironridge-xr100",
  "ironridge-xr1000": "ironridge-xr1000",
  "unirac-solarmount": "unirac-solarmount",
  "unirac-sme": "unirac-sme",
  "rooftech-mini": "rooftech-mini",
  "rt-mini": "rooftech-mini",
  "snapnrack-100": "snapnrack-100",
  "quickmount-classic": "quickmount-classic",
  "quickmount-tile": "quickmount-tile",
  "s5-pvkit": "s5-pvkit",
  "k2-crossrail": "k2-crossrail",
  "ecofasten-rockit": "ecofasten-rockit",
  "dpw-powerrail": "dpw-powerrail",
  "schletter-classic": "schletter-classic",
  "esdec-flatfix": "esdec-flatfix",
  "rail-based": "ironridge-xr100",
  "rail-less": "rooftech-mini",
  "ballasted": "panelclaw-polar-bear",
  "ground-mount": "ground-dual-post-driven",
  "tracker": "nextracker-nr3"
};
function resolveMountingSystemId(id) {
  return LEGACY_ID_MAP[id] ?? id;
}

// lib/structural-engine-v4.ts
var NDS_FB = {
  "Douglas Fir-Larch": { "2x4": 900, "2x6": 1150, "2x8": 1e3, "2x10": 900, "2x12": 825 },
  "Southern Pine": { "2x4": 1500, "2x6": 1250, "2x8": 1050, "2x10": 1050, "2x12": 975 },
  "Hem-Fir": { "2x4": 850, "2x6": 850, "2x8": 850, "2x10": 800, "2x12": 775 },
  "Spruce-Pine-Fir": { "2x4": 875, "2x6": 875, "2x8": 875, "2x10": 800, "2x12": 725 }
};
var NDS_FV = {
  "Douglas Fir-Larch": 180,
  "Southern Pine": 175,
  "Hem-Fir": 150,
  "Spruce-Pine-Fir": 135
};
var NDS_E = {
  "Douglas Fir-Larch": 16e5,
  "Southern Pine": 16e5,
  "Hem-Fir": 15e5,
  "Spruce-Pine-Fir": 14e5
};
var LUMBER_DIMS = {
  "2x4": { b: 1.5, d: 3.5 },
  "2x6": { b: 1.5, d: 5.5 },
  "2x8": { b: 1.5, d: 7.25 },
  "2x10": { b: 1.5, d: 9.25 },
  "2x12": { b: 1.5, d: 11.25 }
};
var TRUSS_CAPACITY_PSF = {
  "16": 55,
  "20": 50,
  "24": 45,
  "28": 40,
  "32": 35,
  "36": 30
};
function getKz(heightFt, exposure) {
  if (exposure === "B") {
    if (heightFt <= 15) return 0.57;
    if (heightFt <= 20) return 0.62;
    if (heightFt <= 25) return 0.66;
    if (heightFt <= 30) return 0.7;
    return 0.76;
  } else if (exposure === "C") {
    if (heightFt <= 15) return 0.85;
    if (heightFt <= 20) return 0.9;
    if (heightFt <= 25) return 0.94;
    if (heightFt <= 30) return 0.98;
    return 1.04;
  } else {
    if (heightFt <= 15) return 1.03;
    if (heightFt <= 20) return 1.08;
    if (heightFt <= 25) return 1.12;
    if (heightFt <= 30) return 1.16;
    return 1.22;
  }
}
function calcVelocityPressure(windSpeedMph, exposure, heightFt) {
  const Kz = getKz(heightFt, exposure);
  const Kzt = 1;
  const Kd = 0.85;
  return 256e-5 * Kz * Kzt * Kd * windSpeedMph * windSpeedMph;
}
function getGCp(zone, pitchDeg) {
  if (zone === "interior") {
    return { uplift: -1.5, downward: 1.5 };
  } else if (zone === "edge") {
    return { uplift: -2, downward: 2 };
  } else {
    return { uplift: -2.5, downward: 2.5 };
  }
}
function calcRoofSnowLoad(groundSnow, pitchDeg) {
  const Ce = 1;
  const Ct = 1;
  const Is = 1;
  const Cs = pitchDeg <= 5 ? 1 : Math.max(0, Math.cos(pitchDeg * Math.PI / 180));
  const pf = 0.7 * Ce * Ct * Is * groundSnow;
  const roofSnow = Cs * pf;
  return { roofSnow, Cs, Ct, Is };
}
function analyzeRafter(input, pvDeadLoadPsf, snowLoadPsf) {
  const { rafterSize, rafterSpacingIn, rafterSpanFt } = input;
  const woodSpecies = input.woodSpecies ?? "Douglas Fir-Larch";
  const notes = [];
  let framingType = input.framingType;
  let autoDetected = false;
  if (framingType === "unknown") {
    framingType = rafterSpacingIn >= 24 ? "truss" : "rafter";
    autoDetected = true;
    notes.push(`Framing auto-detected as ${framingType.toUpperCase()} (${rafterSpacingIn}" O.C.)`);
  }
  const roofDeadLoad = input.roofDeadLoadPsf ?? 15;
  if (framingType === "truss") {
    const spanKey = String(Math.round(rafterSpanFt / 4) * 4);
    const trussCapacity = TRUSS_CAPACITY_PSF[spanKey] ?? 45;
    const totalLoad = roofDeadLoad + pvDeadLoadPsf + snowLoadPsf;
    const utilization = totalLoad / trussCapacity;
    return {
      framingType: "truss",
      size: rafterSize,
      spacingIn: rafterSpacingIn,
      spanFt: rafterSpanFt,
      species: woodSpecies,
      totalLoadPsf: totalLoad,
      pvDeadLoadPsf,
      roofDeadLoadPsf: roofDeadLoad,
      snowLoadPsf,
      bendingMomentDemandFtLbs: 0,
      bendingMomentCapacityFtLbs: trussCapacity,
      bendingUtilization: utilization,
      shearDemandLbs: 0,
      shearCapacityLbs: 0,
      shearUtilization: 0,
      deflectionIn: 0,
      allowableDeflectionIn: 0,
      deflectionUtilization: 0,
      overallUtilization: utilization,
      passes: utilization <= 1,
      notes: [
        ...notes,
        `BCSI truss capacity = ${trussCapacity} psf (${spanKey} ft span)`,
        `Total load = ${totalLoad.toFixed(1)} psf (DL ${roofDeadLoad} + PV ${pvDeadLoadPsf.toFixed(1)} + Snow ${snowLoadPsf.toFixed(1)})`,
        `Utilization = ${(utilization * 100).toFixed(0)}%`
      ]
    };
  }
  const dims = LUMBER_DIMS[rafterSize] ?? LUMBER_DIMS["2x6"];
  const { b, d } = dims;
  const S = b * d * d / 6;
  const I = b * d * d * d / 12;
  const Fb_ref = NDS_FB[woodSpecies]?.[rafterSize] ?? 1e3;
  const Fv_ref = NDS_FV[woodSpecies] ?? 180;
  const E_ref = NDS_E[woodSpecies] ?? 16e5;
  const CD = 1.15;
  const CM = 1;
  const Ct = 1;
  const CF_b = rafterSize === "2x4" ? 1.5 : rafterSize === "2x6" ? 1.3 : rafterSize === "2x8" ? 1.2 : rafterSize === "2x10" ? 1.1 : 1;
  const Cr = 1.15;
  const Fb_prime = Fb_ref * CD * CM * Ct * CF_b * Cr;
  const Fv_prime = Fv_ref * CD * CM * Ct;
  const E_prime = E_ref * CM * Ct;
  const tributaryWidthFt = rafterSpacingIn / 12;
  const totalLoadPsf = roofDeadLoad + pvDeadLoadPsf + snowLoadPsf;
  const w = totalLoadPsf * tributaryWidthFt;
  const L = rafterSpanFt;
  const M_demand_ftLbs = w * L * L / 8;
  const M_demand_inLbs = M_demand_ftLbs * 12;
  const M_capacity_inLbs = Fb_prime * S;
  const M_capacity_ftLbs = M_capacity_inLbs / 12;
  const bendingUtil = M_demand_inLbs / M_capacity_inLbs;
  const V_demand = w * L / 2;
  const fv_actual = 1.5 * V_demand / (b * d);
  const shearUtil = fv_actual / Fv_prime;
  const w_inPerIn = w / 12;
  const L_in = L * 12;
  const delta = 5 * w_inPerIn * Math.pow(L_in, 4) / (384 * E_prime * I);
  const delta_allow = L_in / 240;
  const deflUtil = delta / delta_allow;
  const overallUtil = Math.max(bendingUtil, shearUtil, deflUtil);
  return {
    framingType: "rafter",
    size: rafterSize,
    spacingIn: rafterSpacingIn,
    spanFt: rafterSpanFt,
    species: woodSpecies,
    totalLoadPsf,
    pvDeadLoadPsf,
    roofDeadLoadPsf: roofDeadLoad,
    snowLoadPsf,
    bendingMomentDemandFtLbs: M_demand_ftLbs,
    bendingMomentCapacityFtLbs: M_capacity_ftLbs,
    bendingUtilization: bendingUtil,
    shearDemandLbs: V_demand,
    shearCapacityLbs: Fv_prime * b * d / 1.5,
    shearUtilization: shearUtil,
    deflectionIn: delta,
    allowableDeflectionIn: delta_allow,
    deflectionUtilization: deflUtil,
    overallUtilization: overallUtil,
    passes: overallUtil <= 1,
    notes: [
      ...notes,
      `Fb' = ${Fb_prime.toFixed(0)} psi (Fb=${Fb_ref} \xD7 CD=${CD} \xD7 CF=${CF_b} \xD7 Cr=${Cr})`,
      `Bending: ${(bendingUtil * 100).toFixed(0)}%, Shear: ${(shearUtil * 100).toFixed(0)}%, Deflection: ${(deflUtil * 100).toFixed(0)}%`
    ]
  };
}
function calcMountLayout(geometry, system, netUpliftPsf) {
  const mount = system.mount;
  const maxSpacingIn = mount.maxSpacingIn;
  const mountCapacityLbs = mount.upliftCapacityLbs;
  const railSpanIn = geometry.railSpacingIn;
  let spacingIn = maxSpacingIn;
  let iterations = 0;
  let spacingWasReduced = false;
  while (spacingIn >= 12) {
    iterations++;
    const tribAreaFt22 = spacingIn * railSpanIn / 144;
    const upliftPerMount2 = netUpliftPsf * tribAreaFt22;
    const sf = mountCapacityLbs / upliftPerMount2;
    if (sf >= 1.5) break;
    spacingIn -= 6;
    spacingWasReduced = true;
  }
  spacingIn = Math.max(12, spacingIn);
  const tribAreaFt2 = spacingIn * railSpanIn / 144;
  const upliftPerMount = netUpliftPsf * tribAreaFt2;
  const safetyFactor = mountCapacityLbs / upliftPerMount;
  const downwardPerMount = 0;
  const mountsPerRail = Math.ceil(geometry.railLengthIn / spacingIn) + 1;
  const mountCount = mountsPerRail * geometry.railCount;
  return {
    mountSpacingIn: spacingIn,
    mountCount,
    mountsPerRail,
    safetyFactor,
    upliftPerMountLbs: upliftPerMount,
    downwardPerMountLbs: downwardPerMount,
    mountCapacityLbs,
    tributaryAreaPerMountFt2: tribAreaFt2,
    spacingWasReduced,
    maxAllowedSpacingIn: maxSpacingIn
  };
}
function analyzeRail(geometry, system, mountLayout, totalLoadPsf) {
  if (!system.rail) return void 0;
  const rail = system.rail;
  const spanIn = mountLayout.mountSpacingIn;
  const cantileverIn = Math.min(spanIn / 3, rail.maxCantileverIn);
  const tribWidthIn = geometry.railSpacingIn;
  const tribWidthFt = tribWidthIn / 12;
  const w = totalLoadPsf * tribWidthFt;
  const spanFt = spanIn / 12;
  const M_demand_inLbs = w * spanFt * spanFt / 8 * 12;
  const utilizationRatio = M_demand_inLbs / rail.momentCapacityInLbs;
  return {
    passes: utilizationRatio <= 1 && spanIn <= rail.maxSpanIn,
    railSpanIn: spanIn,
    maxAllowedSpanIn: rail.maxSpanIn,
    cantileverIn,
    maxAllowedCantileverIn: rail.maxCantileverIn,
    momentDemandInLbs: M_demand_inLbs,
    momentCapacityInLbs: rail.momentCapacityInLbs,
    utilizationRatio,
    railSystem: `${system.manufacturer} ${system.rail.model}`
  };
}
function analyzeBallast(input, system, geometry, netUpliftPsf) {
  const ballast = system.ballast;
  if (!ballast) {
    return {
      totalBallastBlocks: 0,
      ballastWeightLbs: 0,
      blocksPerModule: 0,
      ballastWeightPerModuleLbs: 0,
      roofLoadPsf: 0,
      roofCapacityPsf: 0,
      passes: false,
      notes: ["No ballast specification found for this system"]
    };
  }
  const moduleAreaFt2 = input.panelLengthIn * input.panelWidthIn / 144;
  const upliftPerModuleLbs = netUpliftPsf * moduleAreaFt2;
  const frictionCoeff = 0.5;
  const requiredBallastLbs = upliftPerModuleLbs / frictionCoeff;
  const blocksRequired = Math.ceil(requiredBallastLbs / ballast.blockWeightLbs);
  const blocksPerModule = Math.max(
    ballast.minBlocksPerModule,
    Math.min(ballast.maxBlocksPerModule, blocksRequired)
  );
  const totalBlocks = blocksPerModule * input.panelCount;
  const totalBallastWeight = totalBlocks * ballast.blockWeightLbs;
  const arrayAreaFt2 = geometry.arrayWidthIn / 12 * (geometry.arrayHeightIn / 12);
  const panelWeightPsf = input.panelCount * input.panelWeightLbs / arrayAreaFt2;
  const ballastWeightPsf = totalBallastWeight / arrayAreaFt2;
  const roofLoadPsf = panelWeightPsf + ballastWeightPsf + (input.roofDeadLoadPsf ?? 15);
  const roofCapacityPsf = 30;
  const passes = roofLoadPsf <= roofCapacityPsf && blocksPerModule <= ballast.maxBlocksPerModule;
  return {
    totalBallastBlocks: totalBlocks,
    ballastWeightLbs: totalBallastWeight,
    blocksPerModule,
    ballastWeightPerModuleLbs: blocksPerModule * ballast.blockWeightLbs,
    roofLoadPsf,
    roofCapacityPsf,
    passes,
    notes: [
      `Uplift per module: ${upliftPerModuleLbs.toFixed(0)} lbs`,
      `Required ballast: ${requiredBallastLbs.toFixed(0)} lbs/module`,
      `Blocks per module: ${blocksPerModule} \xD7 ${ballast.blockWeightLbs} lbs = ${blocksPerModule * ballast.blockWeightLbs} lbs`,
      `Total ballast: ${totalBlocks} blocks \xD7 ${ballast.blockWeightLbs} lbs = ${totalBallastWeight.toFixed(0)} lbs`,
      `Roof load: ${roofLoadPsf.toFixed(1)} psf (capacity: ${roofCapacityPsf} psf)`
    ]
  };
}
function analyzeGroundMount(input, system, geometry, netUpliftPsf, netDownwardPsf) {
  const gm = system.groundMount;
  if (!gm) {
    return {
      pileCount: 0,
      pileSpacingFt: 0,
      pileEmbedmentFt: 0,
      upliftPerPileLbs: 0,
      downwardPerPileLbs: 0,
      lateralPerPileLbs: 0,
      pileCapacityUpliftLbs: 0,
      pileCapacityDownwardLbs: 0,
      safetyFactorUplift: 0,
      safetyFactorDownward: 0,
      passes: false,
      notes: ["No ground mount specification found for this system"]
    };
  }
  const arrayWidthFt = geometry.arrayWidthIn / 12;
  const arrayHeightFt = geometry.arrayHeightIn / 12;
  const arrayAreaFt2 = arrayWidthFt * arrayHeightFt;
  const pilesPerRow = Math.ceil(arrayWidthFt / gm.pileSpacingFt) + 1;
  const pileRows = 2;
  const totalPiles = pilesPerRow * pileRows;
  const tribAreaPerPileFt2 = arrayAreaFt2 / totalPiles;
  const upliftPerPile = netUpliftPsf * tribAreaPerPileFt2;
  const downwardPerPile = netDownwardPsf * tribAreaPerPileFt2 + input.panelCount * input.panelWeightLbs / totalPiles;
  const lateralPerPile = upliftPerPile * 0.3;
  const sfUplift = gm.pileCapacityUpliftLbs / upliftPerPile;
  const sfDownward = gm.pileCapacityDownwardLbs / downwardPerPile;
  const requiredEmbedment = Math.max(gm.pileEmbedmentFt, (input.frostDepthIn ?? 36) / 12 + 1);
  const passes = sfUplift >= 1.5 && sfDownward >= 1.5;
  return {
    pileCount: totalPiles,
    pileSpacingFt: gm.pileSpacingFt,
    pileEmbedmentFt: requiredEmbedment,
    upliftPerPileLbs: upliftPerPile,
    downwardPerPileLbs: downwardPerPile,
    lateralPerPileLbs: lateralPerPile,
    pileCapacityUpliftLbs: gm.pileCapacityUpliftLbs,
    pileCapacityDownwardLbs: gm.pileCapacityDownwardLbs,
    safetyFactorUplift: sfUplift,
    safetyFactorDownward: sfDownward,
    passes,
    notes: [
      `Array: ${arrayWidthFt.toFixed(1)}' \xD7 ${arrayHeightFt.toFixed(1)}' = ${arrayAreaFt2.toFixed(0)} ft\xB2`,
      `Piles: ${pilesPerRow} per row \xD7 ${pileRows} rows = ${totalPiles} total`,
      `Pile spacing: ${gm.pileSpacingFt} ft`,
      `Uplift per pile: ${upliftPerPile.toFixed(0)} lbs (SF = ${sfUplift.toFixed(2)})`,
      `Downward per pile: ${downwardPerPile.toFixed(0)} lbs (SF = ${sfDownward.toFixed(2)})`,
      `Required embedment: ${requiredEmbedment.toFixed(1)} ft (frost depth: ${input.frostDepthIn ?? 36}")`
    ]
  };
}
function analyzeTracker(input, system, geometry, netUpliftPsf) {
  const tracker = system.tracker;
  if (!tracker) {
    return {
      rowCount: 0,
      rowSpacingFt: 0,
      modulesPerRow: 0,
      totalTrackerLength: 0,
      gcoverageRatio: 0,
      windLoadPsf: netUpliftPsf,
      stowAngleDeg: 0,
      passes: false,
      notes: ["No tracker specification found for this system"]
    };
  }
  const rowSpacingFt = input.trackerRowSpacingFt ?? tracker.rowSpacingFt;
  const modulesPerRow = tracker.moduleRowsPerTracker;
  const rowCount = Math.ceil(input.panelCount / (modulesPerRow * tracker.maxModulesPerTracker));
  const totalTrackerLength = geometry.arrayWidthIn / 12;
  const gcoverageRatio = input.gcoverageRatio ?? tracker.gcoverageRatio;
  const passes = input.windSpeed <= tracker.windSpeedMaxMph;
  return {
    rowCount,
    rowSpacingFt,
    modulesPerRow,
    totalTrackerLength,
    gcoverageRatio,
    windLoadPsf: netUpliftPsf,
    stowAngleDeg: tracker.stowAngleDeg,
    passes,
    notes: [
      `Tracker rows: ${rowCount}`,
      `Row spacing: ${rowSpacingFt} ft`,
      `GCR: ${(gcoverageRatio * 100).toFixed(0)}%`,
      `Stow angle: ${tracker.stowAngleDeg}\xB0 (wind > ${tracker.windSpeedMaxMph * 0.7} mph)`,
      `Max wind: ${tracker.windSpeedMaxMph} mph (design: ${input.windSpeed} mph)`
    ]
  };
}
function calcRackingBOM(geometry, system, mountLayout, ballastAnalysis, groundMountAnalysis) {
  const hw = system.hardware;
  const isRailBased = system.systemType === "rail_based" || system.systemType === "standing_seam";
  const isBallasted = system.systemType === "ballasted_flat";
  const isGroundMount = [
    "ground_single_post",
    "ground_dual_post",
    "ground_driven_pile",
    "ground_helical",
    "ground_concrete"
  ].includes(system.systemType);
  const railSectionLenFt = system.rail ? system.rail.spliceIntervalIn / 12 : 14;
  const railLengthFt = geometry.railLengthIn / 12;
  const railsPerRun = isRailBased ? Math.ceil(railLengthFt / railSectionLenFt) : 0;
  const railQty = railsPerRun * geometry.railCount;
  const splicesPerRail = isRailBased ? Math.max(0, railsPerRun - 1) : 0;
  const totalSplices = splicesPerRail * geometry.railCount;
  const mountQty = mountLayout.mountCount;
  const midClampQty = geometry.totalMidClamps;
  const endClampQty = geometry.totalEndClamps;
  const groundLugQty = Math.ceil(geometry.totalPanels / 2);
  const lagBoltsPerMount = system.mount.fastenersPerMount;
  const lagBoltQty = mountQty * lagBoltsPerMount;
  const needsFlashing = [
    "l_foot_lag",
    "standoff_lag",
    "direct_attach",
    "tile_hook",
    "tile_replacement",
    "rail_less_lag"
  ].includes(system.mount.attachmentMethod);
  const flashingQty = needsFlashing ? mountQty : 0;
  const bondingClipQty = geometry.totalPanels;
  const bom = {
    rails: {
      qty: railQty,
      lengthFt: railLengthFt,
      unit: "ea",
      description: isRailBased ? `${system.manufacturer} ${system.rail?.model} Rail \u2014 ${railLengthFt.toFixed(1)} ft each` : "N/A \u2014 Rail-less or ballasted system",
      partNumber: system.rail?.model ?? "N/A"
    },
    railSplices: {
      qty: totalSplices,
      unit: "ea",
      description: isRailBased ? `${system.manufacturer} Rail Splice` : "N/A",
      partNumber: hw.railSplice
    },
    mounts: {
      qty: mountQty,
      unit: "ea",
      description: `${system.manufacturer} ${system.mount.model} (${mountLayout.mountSpacingIn}" spacing)`,
      partNumber: system.mount.model
    },
    lFeet: {
      qty: mountQty,
      unit: "ea",
      description: `${system.manufacturer} L-Foot / Mount Base`,
      partNumber: system.mount.model
    },
    midClamps: {
      qty: midClampQty,
      unit: "ea",
      description: `${system.manufacturer} ${hw.midClamp}`,
      partNumber: hw.midClamp
    },
    endClamps: {
      qty: endClampQty,
      unit: "ea",
      description: `${system.manufacturer} ${hw.endClamp}`,
      partNumber: hw.endClamp
    },
    groundLugs: {
      qty: groundLugQty,
      unit: "ea",
      description: `${system.manufacturer} ${hw.groundLug} (1 per 2 panels, NEC 690.47)`,
      partNumber: hw.groundLug
    },
    lagBolts: {
      qty: lagBoltQty,
      unit: "ea",
      description: lagBoltQty > 0 ? `${hw.lagBolt} (${lagBoltsPerMount} per mount \xD7 ${mountQty} mounts)` : "N/A \u2014 No penetrations",
      partNumber: hw.lagBolt
    },
    flashingKits: {
      qty: flashingQty,
      unit: "ea",
      description: needsFlashing ? hw.flashingKit ?? `${system.manufacturer} Flashing Kit` : "N/A",
      partNumber: hw.flashingKit ?? "N/A"
    },
    bondingClips: {
      qty: bondingClipQty,
      unit: "ea",
      description: `${system.manufacturer} ${hw.bondingHardware} (1 per panel, UL 2703)`,
      partNumber: hw.bondingHardware
    }
  };
  if (isBallasted && ballastAnalysis) {
    bom.ballastBlocks = {
      qty: ballastAnalysis.totalBallastBlocks,
      weightLbs: ballastAnalysis.ballastWeightLbs,
      unit: "ea",
      description: `${system.manufacturer} Ballast Block \u2014 ${system.ballast?.blockWeightLbs} lbs each`
    };
  }
  if (isGroundMount && groundMountAnalysis) {
    bom.piles = {
      qty: groundMountAnalysis.pileCount,
      unit: "ea",
      description: `${system.manufacturer} ${system.mount.attachmentMethod.replace("_", " ")} pile`,
      embedmentFt: groundMountAnalysis.pileEmbedmentFt
    };
  }
  return bom;
}
function runStructuralCalcV4(input) {
  const errors = [];
  const warnings = [];
  const recommendations = [];
  const resolvedId = resolveMountingSystemId(input.mountingSystemId);
  let system = getMountingSystemById(resolvedId);
  if (!system) {
    system = getMountingSystemById("ironridge-xr100");
    warnings.push({
      code: "UNKNOWN_MOUNTING_SYSTEM",
      message: `Mounting system '${input.mountingSystemId}' not found. Using IronRidge XR100.`,
      severity: "warning",
      suggestion: "Select a valid mounting system from the database"
    });
  }
  const { rowCount: autoRows, colCount: autoCols } = autoLayout(input.panelCount);
  const rowCount = input.rowCount ?? autoRows;
  const colCount = input.colCount ?? autoCols;
  const geometryInput = {
    panelCount: input.panelCount,
    panel: {
      lengthIn: input.panelLengthIn,
      widthIn: input.panelWidthIn,
      weightLbs: input.panelWeightLbs
    },
    orientation: input.panelOrientation,
    rowCount,
    colCount,
    moduleGapIn: input.moduleGapIn ?? 0.5,
    rowGapIn: input.rowGapIn ?? 6,
    railOverhangIn: 6,
    railsPerRow: 2
  };
  const geometry = computeArrayGeometry(geometryInput);
  const heightFt = input.meanRoofHeight ?? 15;
  const qz = calcVelocityPressure(input.windSpeed, input.windExposure, heightFt);
  const roofZone = "interior";
  const gcp = getGCp(roofZone, input.roofPitch);
  const netUpliftPsf = Math.abs(qz * gcp.uplift);
  const netDownwardPsf = qz * gcp.downward;
  const windAnalysis = {
    velocityPressurePsf: qz,
    netUpliftPressurePsf: netUpliftPsf,
    netDownwardPressurePsf: netDownwardPsf,
    roofZone,
    gcpUplift: gcp.uplift,
    gcpDownward: gcp.downward,
    exposureCoeff: getKz(heightFt, input.windExposure),
    designWindSpeedMph: input.windSpeed
  };
  const { roofSnow, Cs, Ct, Is } = calcRoofSnowLoad(input.groundSnowLoad, input.roofPitch);
  const snowAnalysis = {
    groundSnowLoadPsf: input.groundSnowLoad,
    roofSnowLoadPsf: roofSnow,
    slopeFactor: Cs,
    thermalFactor: Ct,
    importanceFactor: Is
  };
  const rackingWeightPerPanel = input.rackingWeightPerPanelLbs ?? 4;
  const totalSystemWeightLbs = geometry.totalPanelWeightLbs + input.panelCount * rackingWeightPerPanel;
  const arrayAreaFt2 = geometry.arrayWidthIn / 12 * (geometry.arrayHeightIn / 12);
  const pvDeadLoadPsf = arrayAreaFt2 > 0 ? totalSystemWeightLbs / arrayAreaFt2 : 4;
  const mountLayout = calcMountLayout(geometry, system, netUpliftPsf);
  const skipMountCheck = input.installationType === "commercial_ballasted" || input.installationType === "ground_mount" || input.installationType === "tracker" || system.systemType === "ballasted_flat" || system.systemType === "ground_single_post" || system.systemType === "ground_dual_post" || system.systemType === "ground_driven_pile" || system.systemType === "ground_helical" || system.systemType === "ground_concrete" || system.systemType === "tracker_single_axis" || system.systemType === "tracker_dual_axis";
  if (!skipMountCheck && mountLayout.safetyFactor < 1.5) {
    errors.push({
      code: "MOUNT_INSUFFICIENT_CAPACITY",
      message: `Mount safety factor ${mountLayout.safetyFactor.toFixed(2)} < 1.5 required`,
      severity: "error",
      suggestion: "Upgrade to higher-capacity mount or reduce mount spacing",
      reference: "ASCE 7-22 \xA726.10"
    });
  }
  const totalLoadPsf = (input.roofDeadLoadPsf ?? 15) + pvDeadLoadPsf + roofSnow;
  const railAnalysis = analyzeRail(geometry, system, mountLayout, totalLoadPsf);
  if (railAnalysis && !railAnalysis.passes) {
    if (railAnalysis.utilizationRatio > 1) {
      errors.push({
        code: "RAIL_OVERSTRESSED",
        message: `Rail bending utilization ${(railAnalysis.utilizationRatio * 100).toFixed(0)}% exceeds 100%`,
        severity: "error",
        suggestion: "Reduce mount spacing or upgrade to heavier rail profile",
        reference: "ASCE 7-22 / Manufacturer Engineering Data"
      });
    }
    if (mountLayout.mountSpacingIn > (system.rail?.maxSpanIn ?? 72)) {
      errors.push({
        code: "RAIL_SPAN_EXCEEDED",
        message: `Mount spacing ${mountLayout.mountSpacingIn}" exceeds max rail span ${system.rail?.maxSpanIn}"`,
        severity: "error",
        suggestion: "Reduce mount spacing to within manufacturer limits",
        reference: system.iccEsReport ?? "Manufacturer Engineering Data"
      });
    }
  }
  const rafterAnalysis = analyzeRafter(input, pvDeadLoadPsf, roofSnow);
  if (!rafterAnalysis.passes) {
    if (rafterAnalysis.framingType === "truss") {
      warnings.push({
        code: "TRUSS_OVERSTRESSED",
        message: `Truss utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%`,
        severity: "warning",
        suggestion: "Consult truss manufacturer for actual capacity",
        reference: "BCSI / Truss Manufacturer Engineering Data"
      });
    } else {
      errors.push({
        code: "RAFTER_OVERSTRESSED",
        message: `Rafter utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%`,
        severity: "error",
        suggestion: "Upgrade rafter size, reduce span, or reduce attachment spacing",
        reference: "NDS 2018 / ASCE 7-22"
      });
    }
  }
  let ballastAnalysis;
  if (system.systemType === "ballasted_flat") {
    ballastAnalysis = analyzeBallast(input, system, geometry, netUpliftPsf);
    if (!ballastAnalysis.passes) {
      errors.push({
        code: "BALLAST_INSUFFICIENT",
        message: `Ballast insufficient: ${ballastAnalysis.blocksPerModule} blocks/module required`,
        severity: "error",
        suggestion: "Add more ballast blocks or use mechanically attached system",
        reference: "ASCE 7-22 / Manufacturer Engineering Data"
      });
    }
  }
  let groundMountAnalysis;
  if ([
    "ground_single_post",
    "ground_dual_post",
    "ground_driven_pile",
    "ground_helical",
    "ground_concrete"
  ].includes(system.systemType)) {
    groundMountAnalysis = analyzeGroundMount(input, system, geometry, netUpliftPsf, netDownwardPsf);
    if (!groundMountAnalysis.passes) {
      errors.push({
        code: "PILE_INSUFFICIENT_CAPACITY",
        message: `Pile safety factor insufficient (uplift SF=${groundMountAnalysis.safetyFactorUplift.toFixed(2)})`,
        severity: "error",
        suggestion: "Increase pile embedment depth or reduce pile spacing",
        reference: "ASCE 7-22 / Geotechnical Engineering"
      });
    }
  }
  let trackerAnalysis;
  if (["tracker_single_axis", "tracker_dual_axis"].includes(system.systemType)) {
    trackerAnalysis = analyzeTracker(input, system, geometry, netUpliftPsf);
    if (!trackerAnalysis.passes) {
      errors.push({
        code: "TRACKER_WIND_EXCEEDED",
        message: `Design wind speed ${input.windSpeed} mph exceeds tracker max ${system.tracker?.windSpeedMaxMph} mph`,
        severity: "error",
        suggestion: "Use stow mode or select tracker rated for higher wind speed",
        reference: "Manufacturer Engineering Data"
      });
    }
  }
  const rackingBOM = calcRackingBOM(geometry, system, mountLayout, ballastAnalysis, groundMountAnalysis);
  if (input.windSpeed >= 130) {
    recommendations.push("High wind zone: verify all fastener embedment depths and use stainless steel hardware");
  }
  if (input.groundSnowLoad >= 40) {
    recommendations.push("High snow load: verify roof structure capacity with structural engineer");
  }
  if (mountLayout.spacingWasReduced) {
    recommendations.push(`Mount spacing auto-reduced to ${mountLayout.mountSpacingIn}" to achieve SF \u2265 1.5`);
  }
  if (input.framingType === "unknown") {
    const detected = rafterAnalysis.framingType;
    recommendations.push(`Framing auto-detected as ${detected.toUpperCase()} (${input.rafterSpacingIn}" O.C.). Field-verify before installation.`);
  }
  if (system.iccEsReport) {
    recommendations.push(`Mounting system certified per ${system.iccEsReport}`);
  }
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const status = hasErrors ? "FAIL" : hasWarnings ? "WARNING" : "PASS";
  return {
    status,
    installationType: input.installationType,
    arrayGeometry: geometry,
    wind: windAnalysis,
    snow: snowAnalysis,
    mountLayout,
    railAnalysis,
    rafterAnalysis,
    ballastAnalysis,
    groundMountAnalysis,
    trackerAnalysis,
    rackingBOM,
    totalSystemWeightLbs,
    addedDeadLoadPsf: pvDeadLoadPsf,
    mountingSystem: system,
    errors,
    warnings,
    recommendations,
    debugInfo: {
      framingTypeResolved: rafterAnalysis.framingType,
      autoDetectedFraming: input.framingType === "unknown",
      mountSpacingIterations: 0,
      pvDeadLoadPsf
    }
  };
}

// test_v25_engine.ts
var test1Input = {
  installationType: "roof_residential",
  windSpeed: 115,
  windExposure: "B",
  groundSnowLoad: 20,
  meanRoofHeight: 15,
  roofPitch: 20,
  framingType: "unknown",
  rafterSize: "2x6",
  rafterSpacingIn: 24,
  rafterSpanFt: 16,
  woodSpecies: "Douglas Fir-Larch",
  panelCount: 10,
  panelLengthIn: 65,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: "portrait",
  rowCount: 2,
  colCount: 5,
  mountingSystemId: "ironridge-xr100",
  rackingWeightPerPanelLbs: 4,
  roofDeadLoadPsf: 15
};
var test2Input = {
  installationType: "commercial_ballasted",
  windSpeed: 110,
  windExposure: "B",
  groundSnowLoad: 0,
  meanRoofHeight: 30,
  roofPitch: 0,
  framingType: "unknown",
  rafterSize: "2x6",
  rafterSpacingIn: 24,
  rafterSpanFt: 20,
  panelCount: 200,
  panelLengthIn: 65,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: "portrait",
  rowCount: 10,
  colCount: 20,
  mountingSystemId: "esdec-flatfix",
  rackingWeightPerPanelLbs: 4,
  roofMembrane: "tpo",
  roofDeadLoadPsf: 15
};
var test3Input = {
  installationType: "ground_mount",
  windSpeed: 120,
  windExposure: "C",
  groundSnowLoad: 5,
  meanRoofHeight: 8,
  roofPitch: 25,
  framingType: "unknown",
  rafterSize: "2x6",
  rafterSpacingIn: 24,
  rafterSpanFt: 16,
  panelCount: 50,
  panelLengthIn: 65,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: "portrait",
  rowCount: 5,
  colCount: 10,
  mountingSystemId: "ground-dual-post-driven",
  rackingWeightPerPanelLbs: 6,
  soilType: "loam",
  frostDepthIn: 36
};
function printResult(name, result) {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: " + name);
  console.log("=".repeat(60));
  console.log("Status:          " + result.status);
  if (result.wind) {
    console.log("Wind Speed:      " + result.wind.designWindSpeedMph + " mph");
    console.log("Velocity Press:  " + result.wind.velocityPressurePsf?.toFixed(2) + " psf");
    console.log("Net Uplift:      " + result.wind.netUpliftPressurePsf?.toFixed(2) + " psf");
    console.log("GCp Uplift:      " + result.wind.gcpUplift?.toFixed(2));
  }
  if (result.snow) {
    console.log("Ground Snow:     " + result.snow.groundSnowLoadPsf + " psf");
    console.log("Roof Snow:       " + result.snow.roofSnowLoadPsf?.toFixed(1) + " psf");
  }
  if (result.attachment) {
    console.log("Safety Factor:   " + result.attachment.safetyFactor?.toFixed(2));
    console.log("Max Spacing:     " + result.attachment.maxAllowedSpacing + '"');
    console.log("Uplift/Attach:   " + result.attachment.upliftPerAttachment?.toFixed(1) + " lbs");
  }
  if (result.rafterAnalysis) {
    console.log("Framing Type:    " + result.rafterAnalysis.framingType);
    console.log("Utilization:     " + (result.rafterAnalysis.overallUtilization * 100).toFixed(0) + "%");
  }
  if (result.mountLayout) {
    console.log("Mount Count:     " + result.mountLayout.mountCount);
    console.log("Mount Spacing:   " + result.mountLayout.mountSpacing + '"');
    console.log("Uplift/Mount:    " + result.mountLayout.upliftPerMount?.toFixed(1) + " lbs");
  }
  if (result.rackingBOM) {
    console.log("\nRACKING BOM:");
    if (result.rackingBOM.mounts) console.log("  Mounts:        " + result.rackingBOM.mounts.qty);
    if (result.rackingBOM.rails) console.log("  Rails:         " + result.rackingBOM.rails.qty + " " + result.rackingBOM.rails.unit);
    if (result.rackingBOM.lFeet) console.log("  L-Feet:        " + result.rackingBOM.lFeet.qty);
    if (result.rackingBOM.midClamps) console.log("  Mid Clamps:    " + result.rackingBOM.midClamps.qty);
    if (result.rackingBOM.endClamps) console.log("  End Clamps:    " + result.rackingBOM.endClamps.qty);
    if (result.rackingBOM.ballastBlocks) console.log("  Ballast Blks:  " + result.rackingBOM.ballastBlocks.qty + " (" + result.rackingBOM.ballastBlocks.weightLbs?.toLocaleString() + " lbs)");
    if (result.rackingBOM.piles) console.log("  Piles:         " + result.rackingBOM.piles.qty);
  }
  if (result.ballastAnalysis) {
    const ba = result.ballastAnalysis;
    console.log("\nBALLAST ANALYSIS:");
    console.log("  Blocks/Module: " + ba.blocksPerModule);
    console.log("  Total Blocks:  " + ba.totalBallastBlocks);
    console.log("  Total Weight:  " + ba.ballastWeightLbs?.toLocaleString() + " lbs");
    console.log("  Roof Load:     " + ba.roofLoadPsf?.toFixed(1) + " psf");
    console.log("  Roof Capacity: " + ba.roofCapacityPsf?.toFixed(1) + " psf");
    console.log("  Passes:        " + (ba.passes ? "YES" : "NO"));
    if (ba.notes?.length > 0) ba.notes.forEach((n) => console.log("  Note: " + n));
  }
  if (result.groundMountAnalysis) {
    const gm = result.groundMountAnalysis;
    console.log("\nGROUND MOUNT ANALYSIS:");
    console.log("  Pile Count:    " + gm.pileCount);
    console.log("  Pile Spacing:  " + gm.pileSpacingFt + " ft");
    console.log("  Embedment:     " + gm.pileEmbedmentFt + " ft");
    console.log("  Uplift/Pile:   " + gm.upliftPerPileLbs?.toFixed(0) + " lbs");
    console.log("  Downward/Pile: " + gm.downwardPerPileLbs?.toFixed(0) + " lbs");
    console.log("  SF Uplift:     " + gm.safetyFactorUplift?.toFixed(2));
    console.log("  SF Downward:   " + gm.safetyFactorDownward?.toFixed(2));
    console.log("  Passes:        " + (gm.passes ? "YES" : "NO"));
    if (gm.notes?.length > 0) gm.notes.forEach((n) => console.log("  Note: " + n));
  }
  if (result.errors?.length > 0) {
    console.log("\nERRORS:");
    result.errors.forEach((e) => console.log("  [" + e.severity + "] " + e.code + ": " + e.message));
  }
  if (result.warnings?.length > 0) {
    console.log("\nWARNINGS:");
    result.warnings.forEach((w) => console.log("  [" + w.severity + "] " + w.code + ": " + w.message));
  }
  const passed = result.status === "PASS" || result.status === "WARNING";
  console.log("\n" + (passed ? "PASS" : "FAIL") + ": " + name);
  return passed;
}
console.log("V25.1 Structural Engine V4 Validation Tests");
console.log("=".repeat(60));
var allPassed = true;
try {
  const r1 = runStructuralCalcV4(test1Input);
  const p1 = printResult("Test 1: Residential (10 panels, 115mph, 20psf)", r1);
  allPassed = allPassed && p1;
} catch (e) {
  console.log("TEST 1 ERROR: " + e.message);
  allPassed = false;
}
try {
  const r2 = runStructuralCalcV4(test2Input);
  const p2 = printResult("Test 2: Commercial Ballasted (200 panels)", r2);
  allPassed = allPassed && p2;
} catch (e) {
  console.log("TEST 2 ERROR: " + e.message);
  allPassed = false;
}
try {
  const r3 = runStructuralCalcV4(test3Input);
  const p3 = printResult("Test 3: Ground Mount (50 panels)", r3);
  allPassed = allPassed && p3;
} catch (e) {
  console.log("TEST 3 ERROR: " + e.message);
  allPassed = false;
}
console.log("\n" + "=".repeat(60));
console.log(allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
