// Test permit generation with full sample data including panel positions
import { writeFileSync } from 'fs';

const samplePayload = {
  project: {
    projectName: "123 Franklin St Solar Install",
    clientName: "John Smith",
    address: "123 Franklin St, Springfield, IL 62701",
    state: "IL",
    city: "Springfield",
    county: "Sangamon",
    zip: "62701",
    designer: "Solar Pro Engineering",
    date: new Date().toLocaleDateString(),
    systemType: "GRID_TIE",
    roofType: "shingle",
    mountingId: "ironridge-xr100",
    roofPitch: 4,
    rafterSpacing: 24,
    rafterSpan: 16,
    rafterSize: "2x6",
    rafterSpecies: "Douglas Fir",
    framingType: "rafter",
    windSpeed: 90,
    windExposure: "B",
    groundSnowLoad: 20,
    mainPanelAmps: 200,
    mainPanelBrand: "Square D",
    utilityMeter: "Ameren Illinois",
    acDisconnect: true,
    dcDisconnect: true,
    productionMeter: false,
    rapidShutdown: true,
    wireGauge: "#10 AWG",
    conduitType: "EMT",
    wireLength: 65,
    attachmentSpacing: 48,
    railSpacing: 48,
    interconnectionMethod: "LOAD_SIDE",
    panelBusRating: 200,
    utilityId: "ameren",
    ahjId: "",
    notes: "Residential rooftop solar installation. All work per NEC 2020 and local amendments.",
    panelVoc: 41.6,
    panelIsc: 12.26,
    panelWeightLbs: 44,
    panelLengthIn: 79.9,
    panelWidthIn: 40.9,
    // Panel positions from 3D design engine
    panelPositions: [
      { id: "p1", lat: 39.7984, lng: -89.6541, row: 0, col: 0, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p2", lat: 39.7984, lng: -89.6540, row: 0, col: 1, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p3", lat: 39.7984, lng: -89.6539, row: 0, col: 2, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p4", lat: 39.7983, lng: -89.6541, row: 1, col: 0, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p5", lat: 39.7983, lng: -89.6540, row: 1, col: 1, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p6", lat: 39.7983, lng: -89.6539, row: 1, col: 2, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p7", lat: 39.7982, lng: -89.6541, row: 2, col: 0, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
      { id: "p8", lat: 39.7982, lng: -89.6540, row: 2, col: 1, tilt: 20, azimuth: 180, wattage: 400, orientation: "portrait" },
    ],
    roofPlanes: [
      {
        id: "rp1",
        vertices: [
          { lat: 39.7985, lng: -89.6542 },
          { lat: 39.7985, lng: -89.6538 },
          { lat: 39.7981, lng: -89.6538 },
          { lat: 39.7981, lng: -89.6542 },
        ],
        pitch: 4,
        azimuth: 180,
        area: 1200,
      }
    ],
  },
  system: {
    totalDcKw: 3.2,
    totalAcKw: 3.0,
    totalPanels: 8,
    dcAcRatio: 1.07,
    topology: "STRING",
    inverters: [
      {
        manufacturer: "SolarEdge",
        model: "SE3000H-US",
        type: "string",
        acOutputKw: 3.0,
        maxDcVoltage: 480,
        efficiency: 97.6,
        ulListing: "UL 1741",
        strings: [
          {
            label: "String 1",
            panelCount: 8,
            panelManufacturer: "Q CELLS",
            panelModel: "Q.PEAK DUO BLK ML-G10+ 400",
            panelWatts: 400,
            panelVoc: 41.6,
            panelIsc: 12.26,
            wireGauge: "#10 AWG",
            wireLength: 65,
          }
        ]
      }
    ]
  },
  compliance: {
    overallStatus: "PASS",
    utilityName: "Ameren Illinois",
    electrical: { status: "PASS" },
    structural: { status: "PASS" }
  },
  rulesResult: null,
  bom: [
    { category: "Modules", description: "Q CELLS Q.PEAK DUO BLK ML-G10+ 400W", qty: 8, unit: "EA" },
    { category: "Inverters", description: "SolarEdge SE3000H-US", qty: 1, unit: "EA" },
    { category: "Racking", description: "IronRidge XR-100 Rail", qty: 4, unit: "EA" },
    { category: "Hardware", description: "IronRidge UFO End Clamp", qty: 16, unit: "EA" },
  ],
  overrides: [],
};

const baseUrl = 'http://localhost:3000';

// Test JWT (signed with JWT_SECRET=test-secret-for-local-permit-testing-only)
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlci0xIiwiZW1haWwiOiJ0ZXN0QHNvbGFycHJvLnRlc3QiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3MzUwMjMwMCwiZXhwIjoxNzczNTg4NzAwfQ.I2QWnmRH64T78VfSX0RXeR88DdABydQrlt44TVJwm_M';

async function testPermit() {
  console.log('Testing permit generation with full panel position data...');
  console.log('Panels:', samplePayload.project.panelPositions.length);
  console.log('Roof planes:', samplePayload.project.roofPlanes.length);
  
  try {
    const res = await fetch(`${baseUrl}/api/engineering/permit?format=html`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `solarpro_session=${TEST_TOKEN}`,
      },
      body: JSON.stringify(samplePayload),
    });
    
    console.log('Status:', res.status, res.statusText);
    
    if (res.ok) {
      const html = await res.text();
      console.log('HTML length:', html.length, 'bytes');
      console.log('Has panel grid:', html.includes('panel-cell') || html.includes('panelCell') || html.includes('rect') || html.includes('ARRAY'));
      console.log('Has AHJ section:', html.includes('AHJ') || html.includes('Authority'));
      console.log('Has load calc:', html.includes('220.82') || html.includes('Load Calculation'));
      console.log('Has BOM:', html.includes('Bill of Materials') || html.includes('BOM'));
      console.log('Has conductor schedule:', html.includes('Conductor') || html.includes('conductor'));
      writeFileSync('/workspace/test_permit_output_v4745.html', html);
      console.log('✅ Saved to /workspace/test_permit_output_v4745.html');
    } else {
      const errText = await res.text();
      console.error('❌ Error response:', errText.slice(0, 1000));
    }
  } catch (err) {
    console.error('❌ Fetch error:', err.message);
  }
}

testPermit();