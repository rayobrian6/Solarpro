// ═══════════════════════════════════════════════════════════════════════════
// braidon-original-audit-fixture.ts
//
// ██ IMMUTABLE CAMPAIGN ACCEPTANCE FIXTURE — DO NOT UPDATE FROM THE DATABASE ██
//
// This fixture FREEZES the ORIGINAL audited Braidon design that the W1/W2/W2.1/W3
// PermitDesignSnapshot campaign was accepted against (Ray, W3.1 §1). It exists so
// the corrected planset can be proven against the exact originally-audited design
// FOREVER, independent of the live database row — which has since diverged to an
// 88-module REC/Qcells hybrid state (see docs/evidence/braidon-live-w3...).
//
// Generating acceptance evidence from this fixture reads ZERO mutable DB rows.
// DO NOT "refresh" it from the live project. DO NOT reconcile it against the live
// REC/Qcells equipment-identity conflict. It is a frozen record.
//
// ── ORIGINAL AUDITED DESIGN (W3.1 §1 contract) ──────────────────────────────
//   • 31 × Q CELLS Q.PEAK DUO BLK ML-G10+ 400W   (catalog: qcells-peak-duo-400)
//   • 31 × Enphase IQ8A                           (catalog: enphase-iq8a)
//   • 12.40 kW DC
//   • 3 legal microinverter branches at 11 / 10 / 10  (planMicroBranches, IQ8A <=11 / <=20A)
//   • roof-mounted, Roof Tech RT-MINI (rooftech-mini), 2 roof planes
//   • project identity: BRAIDON M PILLA, 3 MELVIN DR APT A, GRANITE CITY, IL 62040
//
// ── PROVENANCE: recovered vs reconstructed ──────────────────────────────────
// RECOVERED verbatim from the W1 acceptance snapshot PDS-1F6CA27580EE
// (the campaign snapshot dump for docs/evidence/braidon-w1.planset-evidence.json),
// field-for-field:
//   • project identity (clientName / address / lat / lng)
//   • all 31 module positions (id, lat, lng, row, col, orientation, planeId)
//   • both roof-plane identities, pitches (16.52 / 18.25 deg) and azimuths (0 / 180 deg)
//   • module catalog identity + electrical (400 W, Voc 41.6, Isc 12.26)
//   • inverter catalog identity (IQ8A) and RT-MINI mount identity
//   • wind 115 mph / exposure C / ground snow 0 psf, SUPPLY_SIDE_TAP, 200 A bus
//
// RECONSTRUCTED deterministically (documented, NOT invented) because the W1
// snapshot geometry did not persist them:
//   • roof-plane VERTICES — computed as the axis-aligned bounding box of each
//     plane's recovered member-panel lat/lngs, padded ~6 ft. Gives the plane a
//     real polygon so roof-plane geometry + fire-setback bands resolve; it does
//     NOT alter any recovered module position. (If exact surveyed roof edges are
//     ever recovered, they supersede these bounding boxes.)
//   • roof-plane edgeTypes — nominal [eave, rake, ridge, rake] per plane.
//   • roofType "Composition Shingle" — the audited home's covering was not
//     persisted in the W1 snapshot; nominal residential value.
//
// OMITTED (deliberately): the recovered per-panel row/col grid indices. They
// encode the original 2-plane (front/back gable) design-tool grid, which is
// incompatible with the canonical single-array structural grid (V4 arrayGeometry)
// and left a phantom empty rail. The real module POSITIONS (lat/lng) are kept;
// the canonical rail/attachment grid is derived by the W3 structural authority.
//
// DELIBERATELY DETERMINISTIC (W3.1 §1): the fixture EXPLICITLY selects Qcells
// (subSystems.roof.panelId = qcells-peak-duo-400 == the fleet module), so the
// production REC-vs-Qcells EQUIPMENT-IDENTITY-CONFLICT legitimately does NOT fire
// here — recorded in evidence as fixture-deterministic-selection. This selection
// is local to the fixture and MUST NOT touch, reconcile, or alter any production
// row; the PRODUCTION conflict remains unresolved and blocking in the live evidence.
//
// HONEST BLOCKERS the fixture INTENTIONALLY preserves (the correct audited
// outcome — not defects to "fix" in the fixture): framing unverified, wind/snow
// AHJ authority unresolved, route-length estimate, RT-MINI racking-capacity
// source-not-archived + applicability gap, engineering-review pending.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '@/lib/permit/types';

/** RECOVERED — the 31 original audited module positions (W1 snapshot PDS-1F6CA27580EE). */
const ORIGINAL_PANELS = [
    {
      "id": "9fba8156-b339-4d7f-80e1-a17d7fa46869",
      "lat": 38.70615885430071,
      "lng": -90.04628470889985,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "eb4237d5-6e13-4ed4-b4c2-085a7fe7c9b6",
      "lat": 38.706158792465246,
      "lng": -90.04627168829549,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "d6417ca1-cc4b-439d-a097-90f9599a2b6c",
      "lat": 38.70615883049046,
      "lng": -90.04625867441894,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "f0688cfb-a79f-4be5-8278-fee5674032d8",
      "lat": 38.70615877278821,
      "lng": -90.04624555396623,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "8a28e781-5ac8-4fba-b478-b0197f45eb16",
      "lat": 38.70615871095253,
      "lng": -90.04623253336136,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "e199a7e9-1462-4683-bde3-ef561fdb9cf0",
      "lat": 38.70615874897786,
      "lng": -90.04621951948425,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "20698113-49ae-48f6-a30b-dacbdf9337ac",
      "lat": 38.70617368132112,
      "lng": -90.04628469588157,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "72825f06-4f22-44c5-8d88-5f7baeece33c",
      "lat": 38.70617371934631,
      "lng": -90.04627168200503,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "13ffd908-c4a3-4786-9d74-b2579565fc6c",
      "lat": 38.706173657510945,
      "lng": -90.04625866140053,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "b7235620-be0d-4da9-9e26-fe4b33fd82c8",
      "lat": 38.706173695536116,
      "lng": -90.04624564752378,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "f22831dc-a061-4040-8b8f-43b60cc27fe4",
      "lat": 38.706173633700665,
      "lng": -90.04623262691885,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "b6a18d9c-4b39-4bcd-9520-0fe275fd1755",
      "lat": 38.706173571865186,
      "lng": -90.04621960631383,
      "orientation": "portrait",
      "planeId": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "azimuth": 0,
      "tilt": 16.517622167804127,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "5c4d555b-01d5-4e98-ab37-2a64d33075a6",
      "lat": 38.706118819800174,
      "lng": -90.04620881129466,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "eca748e7-ee44-4b75-81b4-c4001cf1c47e",
      "lat": 38.70611879407421,
      "lng": -90.0462218111904,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "033886f7-1b18-47b4-a9e9-8b1a37671e90",
      "lat": 38.706118868149986,
      "lng": -90.04623491142048,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "6a6ad379-7736-436e-9402-8b0cab4d8040",
      "lat": 38.70611884242401,
      "lng": -90.04624791131621,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "01ec2ff6-967a-4b40-b054-0a76677b91ac",
      "lat": 38.706118816698044,
      "lng": -90.04626091121197,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "35a552be-e8d4-4f44-809c-4af9c9f6dd18",
      "lat": 38.70611879077419,
      "lng": -90.04627401110692,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "4af7e871-5fe7-4e7b-81ea-b357d86486f7",
      "lat": 38.70611876504823,
      "lng": -90.0462870110027,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "acf25511-4090-4dc8-aaf3-5c01d1b3b8a1",
      "lat": 38.70611883932188,
      "lng": -90.04630001123358,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "122fff8f-3eac-49fc-9513-4895030cb5b2",
      "lat": 38.70611881339803,
      "lng": -90.04631311112854,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "1902d8e5-dda0-4b2b-aae4-dd4239707c2b",
      "lat": 38.70610414550239,
      "lng": -90.04619578230346,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "dd967856-a338-4a82-aba3-b456bff5338f",
      "lat": 38.706104119776434,
      "lng": -90.0462087821992,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "03054964-c497-4582-a200-061d1429e7d9",
      "lat": 38.70610409385258,
      "lng": -90.04622188209416,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "4078f174-71e4-4f70-a035-3ca2d00b09f3",
      "lat": 38.70610406812662,
      "lng": -90.04623488198989,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "13833614-34f0-46eb-9053-aea85e7c86ce",
      "lat": 38.70610414240028,
      "lng": -90.04624788222074,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "1edd7aa7-4515-4cf2-9e01-8f7b61148506",
      "lat": 38.70610411647642,
      "lng": -90.04626098211573,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "6e7e3f4c-25b1-4644-a51f-173c2cd0149a",
      "lat": 38.70610409075047,
      "lng": -90.04627398201146,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "fbe49bce-4bc9-486e-bbe8-3fc0b933c470",
      "lat": 38.70610406502451,
      "lng": -90.04628698190723,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "460532ff-54a4-4130-8212-cc1ef7f8f08c",
      "lat": 38.70610413910027,
      "lng": -90.04630008213728,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    },
    {
      "id": "67dceff0-598d-4610-ab91-7d7571d87e49",
      "lat": 38.70610411337433,
      "lng": -90.04631308203307,
      "orientation": "portrait",
      "planeId": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "azimuth": 180,
      "tilt": 18.24908301732976,
      "wattage": 400,
      "systemType": "roof"
    }
  ];

/** Recovered plane identity/pitch/azimuth; RECONSTRUCTED bounding-box vertices + nominal edges. */
const ORIGINAL_ROOF_PLANES = [
    {
      "id": "7ca114b6-3980-46b9-9642-57c4f9447c0c",
      "pitch": 16.517622167804127,
      "azimuth": 0,
      "vertices": [
        {
          "lat": 38.7061422,
          "lng": -90.0463058
        },
        {
          "lat": 38.7061422,
          "lng": -90.0461984
        },
        {
          "lat": 38.7061902,
          "lng": -90.0461984
        },
        {
          "lat": 38.7061902,
          "lng": -90.0463058
        }
      ],
      "edgeTypes": [
        "eave",
        "rake",
        "ridge",
        "rake"
      ]
    },
    {
      "id": "aa72d4e3-2a53-48de-9fde-88acb2a8e01a",
      "pitch": 18.24908301732976,
      "azimuth": 180,
      "vertices": [
        {
          "lat": 38.7060876,
          "lng": -90.0463342
        },
        {
          "lat": 38.7060876,
          "lng": -90.0461747
        },
        {
          "lat": 38.7061354,
          "lng": -90.0461747
        },
        {
          "lat": 38.7061354,
          "lng": -90.0463342
        }
      ],
      "edgeTypes": [
        "eave",
        "rake",
        "ridge",
        "rake"
      ]
    }
  ];

export const braidonOriginalAuditFixture: PermitInput = {
  projectId: 'braidon-original-audit-fixture',
  project: {
    projectName: 'BRAIDON — original GreenLancer audit (frozen acceptance fixture)',
    clientName: 'BRAIDON M PILLA',
    address: '3 MELVIN DR APT A, GRANITE CITY, IL 62040',
    designer: 'SolarPro Engineering',
    date: '2026-07-21',
    notes: 'Immutable W3.1 §1 acceptance fixture — original audited 31 x Qcells 400W + IQ8A design.',
    systemType: 'roof',
    // Deterministic Qcells selection (W3.1 §1): matches the fleet module, so the
    // production REC-vs-Qcells identity conflict does NOT fire on the fixture.
    subSystems: { roof: { panelId: 'qcells-peak-duo-400' } } as any,
    mainPanelAmps: 200,
    mainPanelBrand: 'Square D',
    panelBusRating: 200,
    utilityMeter: 'Net Meter',
    utilityName: 'Ameren Illinois',
    acDisconnect: true,
    dcDisconnect: false,
    productionMeter: false,
    rapidShutdown: true,
    conduitType: 'EMT',
    wireGauge: '10 AWG',
    wireLength: 45,
    interconnectionMethod: 'SUPPLY_SIDE_TAP',
    lat: 38.7061678,
    lng: -90.0461651,
    city: 'Granite City', state: 'IL', zip: '62040', county: 'Madison',
    roofType: 'Composition Shingle',   // RECONSTRUCTED (nominal) — not persisted in W1 snapshot
    mountingSystem: 'Roof Tech RT-MINI',
    mountingSystemId: 'rooftech-mini',
    // Framing INTENTIONALLY unverified — preserves the honest STRUCTURAL-FRAMING-
    // UNVERIFIED blocker that the original audit correctly carried.
    framingType: 'unknown',
    // NO ahjWindSpeedMph / ahjGroundSnowPsf — preserves the honest WIND-SNOW-
    // AUTHORITY-UNRESOLVED blocker (no confirmed AHJ wind/snow authority).
    panelVoc: 41.6, panelIsc: 12.26, panelWeightLbs: 44.1,
    panelLengthIn: 70.9, panelWidthIn: 41.7,
    panelPositions: ORIGINAL_PANELS as any[],
    roofPlanes: ORIGINAL_ROOF_PLANES.map(rp => ({ ...rp, source: 'frozen-fixture', confirmed: true })) as any[],
  },
  system: {
    totalDcKw: 12.40,
    totalAcKw: 0,
    totalPanels: 31,
    dcAcRatio: 0,
    topology: 'micro',
    inverters: [{
      manufacturer: 'Enphase',
      model: 'IQ8A',
      type: 'micro',
      acOutputKw: 0.349,               // IQ8A continuous 349 VA (per-unit)
      maxDcVoltage: 60,
      efficiency: 0.97,
      ulListing: 'UL 1741-SA',
      inverterId: 'enphase-iq8a',
      strings: [{
        label: 'String 1',
        panelCount: 31,
        panelManufacturer: 'Q CELLS',
        panelModel: 'Q.PEAK DUO BLK ML-G10+ 400W',
        panelWatts: 400,
        panelVoc: 41.6,
        panelIsc: 12.26,
        wireGauge: '10 AWG',
        wireLength: 45,
      }],
    }],
  },
  compliance: {
    overallStatus: 'pass',
    // necVersion intentionally OMITTED -> codesSource defaults (matches the
    // original audit's defaulted code editions; V11 deferred remains honest).
    jurisdiction: { state: 'IL', ahj: '' } as any,
    structural: {
      wind: { windSpeed: 115, exposureCategory: 'C' },
      snow: { groundSnowLoad: 0 },
      seismic: { sdc: 'B' },
    },
  },
  layout: {
    type: 'roof',
    panels: ORIGINAL_PANELS as any[],
    geometry: { roofPlanes: ORIGINAL_ROOF_PLANES as any[] },
  },
};

export default braidonOriginalAuditFixture;
