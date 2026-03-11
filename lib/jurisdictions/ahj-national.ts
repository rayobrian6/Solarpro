// ============================================================
// SolarPro National AHJ Database
// Comprehensive Authority Having Jurisdiction data for all 50 states
// Includes: major counties, cities, special districts
// Data: NEC version, permit fees, turnaround times, special requirements
// ============================================================

export interface AhjRecord {
  id: string;                    // unique slug: state-county-city
  stateCode: string;
  stateName: string;
  county: string;
  city: string;
  ahjName: string;               // official AHJ name
  ahjType: 'city' | 'county' | 'state' | 'special_district';
  // Contact
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  // NEC
  necVersion: '2017' | '2020' | '2023';
  localAmendments: string[];
  // Permit
  permitRequired: boolean;
  permitAuthority: string;
  onlinePermitting: boolean;
  expeditedAvailable: boolean;
  typicalPermitFee: string;
  feeStructure: string;          // how fee is calculated
  typicalPlanCheckDays: number;
  typicalPermitDays: number;
  // Inspection
  inspectionRequired: boolean;
  inspectionAuthority: string;
  // Interconnection
  utilityName: string;
  interconnectionProgram: string;
  interconnectionDays: number;
  netMeteringAvailable: boolean;
  // Fire / Setbacks
  roofSetbackInches: number;
  ridgeSetbackInches: number;
  valleySetbackInches: number;
  eaveSetbackInches: number;
  hipRoofSetbackInches: number;
  pathwayWidthInches: number;
  // Structural
  windSpeedMph: number;
  groundSnowLoadPsf: number;
  seismicDesignCategory: string;
  // Special requirements
  specialRequirements: string[];
  planSetRequirements: string[];
  // Rapid shutdown
  rapidShutdownRequired: boolean;
  rapidShutdownStandard: string;
  // Notes
  notes: string;
}

// ── Helper to build a standard record ────────────────────────────────────────
function ahj(partial: Partial<AhjRecord> & {
  id: string; stateCode: string; stateName: string;
  county: string; city: string; ahjName: string;
  necVersion: '2017' | '2020' | '2023';
  utilityName: string;
}): AhjRecord {
  return {
    ahjType: 'county',
    localAmendments: [],
    permitRequired: true,
    permitAuthority: 'Local Building Department',
    onlinePermitting: false,
    expeditedAvailable: false,
    typicalPermitFee: '$150–$500',
    feeStructure: 'Flat fee or valuation-based',
    typicalPlanCheckDays: 10,
    typicalPermitDays: 15,
    inspectionRequired: true,
    inspectionAuthority: 'Local Building Inspector',
    interconnectionProgram: 'Net Metering',
    interconnectionDays: 30,
    netMeteringAvailable: true,
    roofSetbackInches: 36,
    ridgeSetbackInches: 18,
    valleySetbackInches: 18,
    eaveSetbackInches: 0,
    hipRoofSetbackInches: 18,
    pathwayWidthInches: 36,
    windSpeedMph: 115,
    groundSnowLoadPsf: 0,
    seismicDesignCategory: 'B',
    specialRequirements: [],
    planSetRequirements: [
      'Site plan with module layout',
      'Single-line diagram (NEC compliant)',
      'Equipment cut sheets',
      'Structural calculations',
      'Electrical calculations',
    ],
    rapidShutdownRequired: true,
    rapidShutdownStandard: 'NEC 690.12',
    notes: '',
    phone: undefined,
    email: undefined,
    website: undefined,
    address: undefined,
    ...partial,
  };
}

// ============================================================
// NATIONAL AHJ DATABASE
// ============================================================
export const AHJ_NATIONAL: AhjRecord[] = [

  // ── ALABAMA ──────────────────────────────────────────────────────────────
  ahj({ id:'al-jefferson-birmingham', stateCode:'AL', stateName:'Alabama', county:'Jefferson', city:'Birmingham', ahjName:'City of Birmingham Building Department', ahjType:'city', necVersion:'2020', utilityName:'Alabama Power', phone:'(205) 254-2831', website:'https://www.birminghamal.gov', typicalPermitFee:'$150–$400', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:0, specialRequirements:['Alabama Power interconnection application required'] }),
  ahj({ id:'al-mobile-mobile', stateCode:'AL', stateName:'Alabama', county:'Mobile', city:'Mobile', ahjName:'City of Mobile Building Inspections', ahjType:'city', necVersion:'2020', utilityName:'Alabama Power', phone:'(251) 208-7911', typicalPermitFee:'$100–$350', typicalPlanCheckDays:5, typicalPermitDays:10, windSpeedMph:130, groundSnowLoadPsf:0, specialRequirements:['Hurricane zone — wind uplift calcs required'] }),
  ahj({ id:'al-madison-huntsville', stateCode:'AL', stateName:'Alabama', county:'Madison', city:'Huntsville', ahjName:'City of Huntsville Permits & Inspections', ahjType:'city', necVersion:'2020', utilityName:'Huntsville Utilities', phone:'(256) 427-5000', typicalPermitFee:'$150–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:5 }),

  // ── ARIZONA ──────────────────────────────────────────────────────────────
  ahj({ id:'az-maricopa-phoenix', stateCode:'AZ', stateName:'Arizona', county:'Maricopa', city:'Phoenix', ahjName:'City of Phoenix Development Services', ahjType:'city', necVersion:'2020', utilityName:'APS (Arizona Public Service)', phone:'(602) 262-7811', website:'https://www.phoenix.gov/pdd', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', feeStructure:'$4.50 per $1,000 valuation', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:100, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['APS interconnection application required','HOA approval may be required'], planSetRequirements:['Site plan','SLD','Structural calcs','Equipment cut sheets','Load calculations'], notes:'Phoenix allows online permit submission via ProjectDox' }),
  ahj({ id:'az-maricopa-scottsdale', stateCode:'AZ', stateName:'Arizona', county:'Maricopa', city:'Scottsdale', ahjName:'City of Scottsdale Building Safety', ahjType:'city', necVersion:'2020', utilityName:'APS (Arizona Public Service)', phone:'(480) 312-2500', website:'https://www.scottsdaleaz.gov', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:100, groundSnowLoadPsf:0, specialRequirements:['APS interconnection required','Scottsdale has strict HOA overlay zones'] }),
  ahj({ id:'az-maricopa-mesa', stateCode:'AZ', stateName:'Arizona', county:'Maricopa', city:'Mesa', ahjName:'City of Mesa Development Services', ahjType:'city', necVersion:'2020', utilityName:'SRP (Salt River Project)', phone:'(480) 644-2351', onlinePermitting:true, typicalPermitFee:'$150–$450', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:100, groundSnowLoadPsf:0, specialRequirements:['SRP interconnection application required'] }),
  ahj({ id:'az-maricopa-chandler', stateCode:'AZ', stateName:'Arizona', county:'Maricopa', city:'Chandler', ahjName:'City of Chandler Building Safety', ahjType:'city', necVersion:'2020', utilityName:'SRP (Salt River Project)', phone:'(480) 782-3000', onlinePermitting:true, typicalPermitFee:'$150–$400', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:100, groundSnowLoadPsf:0 }),
  ahj({ id:'az-maricopa-tempe', stateCode:'AZ', stateName:'Arizona', county:'Maricopa', city:'Tempe', ahjName:'City of Tempe Community Development', ahjType:'city', necVersion:'2020', utilityName:'APS (Arizona Public Service)', phone:'(480) 350-4311', onlinePermitting:true, typicalPermitFee:'$150–$400', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:100, groundSnowLoadPsf:0 }),
  ahj({ id:'az-pima-tucson', stateCode:'AZ', stateName:'Arizona', county:'Pima', city:'Tucson', ahjName:'City of Tucson Development Services', ahjType:'city', necVersion:'2020', utilityName:'TEP (Tucson Electric Power)', phone:'(520) 791-5550', website:'https://www.tucsonaz.gov/dsd', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:100, groundSnowLoadPsf:0, specialRequirements:['TEP interconnection application required'] }),
  ahj({ id:'az-pima-county', stateCode:'AZ', stateName:'Arizona', county:'Pima', city:'Unincorporated', ahjName:'Pima County Development Services', ahjType:'county', necVersion:'2020', utilityName:'TEP (Tucson Electric Power)', phone:'(520) 724-9000', typicalPermitFee:'$150–$400', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:100, groundSnowLoadPsf:0 }),

  // ── CALIFORNIA ───────────────────────────────────────────────────────────
  ahj({ id:'ca-los-angeles-la', stateCode:'CA', stateName:'California', county:'Los Angeles', city:'Los Angeles', ahjName:'City of Los Angeles LADBS', ahjType:'city', necVersion:'2023', utilityName:'LADWP', phone:'(213) 482-0000', website:'https://www.ladbs.org', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$300–$1,000', feeStructure:'$1.50 per watt DC', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', localAmendments:['Title 24 California Energy Code','CALGreen','LADBS local amendments'], specialRequirements:['LADWP interconnection application','Title 24 compliance','Seismic zone D requirements'], planSetRequirements:['Site plan with setbacks','SLD','Structural calcs (seismic)','Title 24 compliance','Equipment cut sheets','Load calculations'], notes:'LADBS allows solar permits over-the-counter for standard residential systems' }),
  ahj({ id:'ca-los-angeles-long-beach', stateCode:'CA', stateName:'California', county:'Los Angeles', city:'Long Beach', ahjName:'City of Long Beach Development Services', ahjType:'city', necVersion:'2023', utilityName:'SCE (Southern California Edison)', phone:'(562) 570-6194', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['SCE Rule 21 interconnection','Title 24 compliance'] }),
  ahj({ id:'ca-los-angeles-county', stateCode:'CA', stateName:'California', county:'Los Angeles', city:'Unincorporated', ahjName:'LA County Building & Safety', ahjType:'county', necVersion:'2023', utilityName:'SCE (Southern California Edison)', phone:'(626) 458-3173', website:'https://dpw.lacounty.gov/building', onlinePermitting:true, typicalPermitFee:'$250–$800', typicalPlanCheckDays:5, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['SCE Rule 21 interconnection','Title 24 compliance','CAL FIRE setbacks in high fire zones'] }),
  ahj({ id:'ca-san-diego-san-diego', stateCode:'CA', stateName:'California', county:'San Diego', city:'San Diego', ahjName:'City of San Diego Development Services', ahjType:'city', necVersion:'2023', utilityName:'SDG&E (San Diego Gas & Electric)', phone:'(619) 446-5000', website:'https://www.sandiego.gov/development-services', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['SDG&E Rule 21 interconnection','NEM 3.0 applies','Title 24 compliance'] }),
  ahj({ id:'ca-san-diego-county', stateCode:'CA', stateName:'California', county:'San Diego', city:'Unincorporated', ahjName:'San Diego County Planning & Development', ahjType:'county', necVersion:'2023', utilityName:'SDG&E (San Diego Gas & Electric)', phone:'(858) 694-2960', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['SDG&E Rule 21','CAL FIRE setbacks in SRA zones'] }),
  ahj({ id:'ca-orange-anaheim', stateCode:'CA', stateName:'California', county:'Orange', city:'Anaheim', ahjName:'City of Anaheim Planning & Building', ahjType:'city', necVersion:'2023', utilityName:'SCE (Southern California Edison)', phone:'(714) 765-5153', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D' }),
  ahj({ id:'ca-orange-irvine', stateCode:'CA', stateName:'California', county:'Orange', city:'Irvine', ahjName:'City of Irvine Community Development', ahjType:'city', necVersion:'2023', utilityName:'SCE (Southern California Edison)', phone:'(949) 724-6000', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', notes:'Irvine has streamlined solar permitting — often same-day for standard systems' }),
  ahj({ id:'ca-riverside-riverside', stateCode:'CA', stateName:'California', county:'Riverside', city:'Riverside', ahjName:'City of Riverside Building & Safety', ahjType:'city', necVersion:'2023', utilityName:'SCE (Southern California Edison)', phone:'(951) 826-5697', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D' }),
  ahj({ id:'ca-sacramento-sacramento', stateCode:'CA', stateName:'California', county:'Sacramento', city:'Sacramento', ahjName:'City of Sacramento Community Development', ahjType:'city', necVersion:'2023', utilityName:'SMUD (Sacramento Municipal Utility District)', phone:'(916) 808-8300', website:'https://www.cityofsacramento.org/Community-Development', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:105, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['SMUD interconnection application','Title 24 compliance'], notes:'SMUD territory — different interconnection process than PG&E/SCE' }),
  ahj({ id:'ca-santa-clara-san-jose', stateCode:'CA', stateName:'California', county:'Santa Clara', city:'San Jose', ahjName:'City of San Jose Building Division', ahjType:'city', necVersion:'2023', utilityName:'PG&E (Pacific Gas & Electric)', phone:'(408) 535-3555', website:'https://www.sanjoseca.gov/building', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$250–$800', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['PG&E Rule 21 interconnection','NEM 3.0 applies','Title 24 compliance'] }),
  ahj({ id:'ca-alameda-oakland', stateCode:'CA', stateName:'California', county:'Alameda', city:'Oakland', ahjName:'City of Oakland Building Services', ahjType:'city', necVersion:'2023', utilityName:'PG&E (Pacific Gas & Electric)', phone:'(510) 238-3444', onlinePermitting:true, typicalPermitFee:'$250–$700', typicalPlanCheckDays:5, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:0, seismicDesignCategory:'D', specialRequirements:['PG&E Rule 21','NEM 3.0','Title 24'] }),
  ahj({ id:'ca-fresno-fresno', stateCode:'CA', stateName:'California', county:'Fresno', city:'Fresno', ahjName:'City of Fresno Development & Resource Management', ahjType:'city', necVersion:'2023', utilityName:'PG&E (Pacific Gas & Electric)', phone:'(559) 621-8000', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:105, groundSnowLoadPsf:0, seismicDesignCategory:'D' }),

  // ── COLORADO ─────────────────────────────────────────────────────────────
  ahj({ id:'co-denver-denver', stateCode:'CO', stateName:'Colorado', county:'Denver', city:'Denver', ahjName:'City & County of Denver Community Planning', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(720) 865-2705', website:'https://www.denvergov.org/cpd', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Xcel Energy interconnection application','Denver Green Building Ordinance may apply'] }),
  ahj({ id:'co-jefferson-lakewood', stateCode:'CO', stateName:'Colorado', county:'Jefferson', city:'Lakewood', ahjName:'City of Lakewood Building Division', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(303) 987-7500', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B' }),
  ahj({ id:'co-el-paso-colorado-springs', stateCode:'CO', stateName:'Colorado', county:'El Paso', city:'Colorado Springs', ahjName:'City of Colorado Springs Building', ahjType:'city', necVersion:'2020', utilityName:'Colorado Springs Utilities', phone:'(719) 385-5905', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['CSU interconnection application required'] }),
  ahj({ id:'co-boulder-boulder', stateCode:'CO', stateName:'Colorado', county:'Boulder', city:'Boulder', ahjName:'City of Boulder Building Services', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(303) 441-3200', website:'https://bouldercolorado.gov/building', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:115, groundSnowLoadPsf:35, seismicDesignCategory:'B', notes:'Boulder has progressive solar policies and streamlined permitting' }),

  // ── FLORIDA ──────────────────────────────────────────────────────────────
  ahj({ id:'fl-miami-dade-miami', stateCode:'FL', stateName:'Florida', county:'Miami-Dade', city:'Miami', ahjName:'Miami-Dade County Building Department', ahjType:'county', necVersion:'2020', utilityName:'FPL (Florida Power & Light)', phone:'(786) 315-2000', website:'https://www.miamidade.gov/building', onlinePermitting:true, typicalPermitFee:'$200–$700', feeStructure:'$3.50 per $1,000 valuation', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:175, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['Hurricane zone — HVHZ (High Velocity Hurricane Zone)','Miami-Dade NOA (Notice of Acceptance) required for all products','Wind uplift calculations mandatory','FPL interconnection application'], planSetRequirements:['Site plan','SLD','Structural calcs (HVHZ)','Miami-Dade NOA for panels/racking','Equipment cut sheets','Wind uplift calcs'], notes:'HVHZ is the most stringent wind zone in the US — all equipment must have Miami-Dade NOA' }),
  ahj({ id:'fl-broward-fort-lauderdale', stateCode:'FL', stateName:'Florida', county:'Broward', city:'Fort Lauderdale', ahjName:'City of Fort Lauderdale Building Services', ahjType:'city', necVersion:'2020', utilityName:'FPL (Florida Power & Light)', phone:'(954) 828-5000', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:170, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['HVHZ requirements','Miami-Dade NOA required','FPL interconnection'] }),
  ahj({ id:'fl-palm-beach-west-palm-beach', stateCode:'FL', stateName:'Florida', county:'Palm Beach', city:'West Palm Beach', ahjName:'City of West Palm Beach Building', ahjType:'city', necVersion:'2020', utilityName:'FPL (Florida Power & Light)', phone:'(561) 822-1400', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:160, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['Wind zone requirements','FPL interconnection'] }),
  ahj({ id:'fl-hillsborough-tampa', stateCode:'FL', stateName:'Florida', county:'Hillsborough', city:'Tampa', ahjName:'City of Tampa Construction Services', ahjType:'city', necVersion:'2020', utilityName:'TECO (Tampa Electric)', phone:'(813) 274-3100', website:'https://www.tampa.gov/construction-services', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['TECO interconnection application','Wind zone B requirements'] }),
  ahj({ id:'fl-orange-orlando', stateCode:'FL', stateName:'Florida', county:'Orange', city:'Orlando', ahjName:'City of Orlando Permitting Services', ahjType:'city', necVersion:'2020', utilityName:'OUC (Orlando Utilities Commission)', phone:'(407) 246-2271', website:'https://www.orlando.gov/Permits-Licenses', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['OUC interconnection application'] }),
  ahj({ id:'fl-duval-jacksonville', stateCode:'FL', stateName:'Florida', county:'Duval', city:'Jacksonville', ahjName:'City of Jacksonville Building Inspection Division', ahjType:'city', necVersion:'2020', utilityName:'JEA (Jacksonville Electric Authority)', phone:'(904) 255-8300', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['JEA interconnection application'] }),

  // ── GEORGIA ──────────────────────────────────────────────────────────────
  ahj({ id:'ga-fulton-atlanta', stateCode:'GA', stateName:'Georgia', county:'Fulton', city:'Atlanta', ahjName:'City of Atlanta Office of Buildings', ahjType:'city', necVersion:'2020', utilityName:'Georgia Power', phone:'(404) 330-6150', website:'https://www.atlantaga.gov/government/departments/city-planning/office-of-buildings', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['Georgia Power interconnection application'] }),
  ahj({ id:'ga-gwinnett-county', stateCode:'GA', stateName:'Georgia', county:'Gwinnett', city:'Unincorporated', ahjName:'Gwinnett County Building & Construction', ahjType:'county', necVersion:'2020', utilityName:'Georgia Power', phone:'(678) 518-6000', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'B' }),

  // ── ILLINOIS ─────────────────────────────────────────────────────────────
  ahj({ id:'il-cook-chicago', stateCode:'IL', stateName:'Illinois', county:'Cook', city:'Chicago', ahjName:'City of Chicago Department of Buildings', ahjType:'city', necVersion:'2017', utilityName:'ComEd (Commonwealth Edison)', phone:'(312) 744-3449', website:'https://www.chicago.gov/city/en/depts/bldgs.html', onlinePermitting:true, typicalPermitFee:'$300–$1,000', feeStructure:'$25 per $1,000 valuation', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', localAmendments:['Chicago Electrical Code (local amendments to NEC 2017)','Chicago Building Code'], specialRequirements:['Chicago Electrical Code compliance','ComEd interconnection application','Chicago-licensed electrician required'], notes:'Chicago uses NEC 2017 with significant local amendments — verify Chicago Electrical Code compliance' }),
  ahj({ id:'il-cook-county', stateCode:'IL', stateName:'Illinois', county:'Cook', city:'Unincorporated', ahjName:'Cook County Building & Zoning', ahjType:'county', necVersion:'2017', utilityName:'ComEd (Commonwealth Edison)', phone:'(312) 603-0500', typicalPermitFee:'$200–$600', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B' }),

  // ── NEVADA ───────────────────────────────────────────────────────────────
  ahj({ id:'nv-clark-las-vegas', stateCode:'NV', stateName:'Nevada', county:'Clark', city:'Las Vegas', ahjName:'City of Las Vegas Building & Safety', ahjType:'city', necVersion:'2020', utilityName:'NV Energy', phone:'(702) 229-6251', website:'https://www.lasvegasnevada.gov/Government/Departments/Building-Safety', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:105, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['NV Energy interconnection application'] }),
  ahj({ id:'nv-clark-henderson', stateCode:'NV', stateName:'Nevada', county:'Clark', city:'Henderson', ahjName:'City of Henderson Building & Fire Safety', ahjType:'city', necVersion:'2020', utilityName:'NV Energy', phone:'(702) 267-3950', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:105, groundSnowLoadPsf:0, seismicDesignCategory:'B', notes:'Henderson has one of the fastest solar permit turnarounds in Nevada' }),
  ahj({ id:'nv-clark-north-las-vegas', stateCode:'NV', stateName:'Nevada', county:'Clark', city:'North Las Vegas', ahjName:'City of North Las Vegas Building & Code Enforcement', ahjType:'city', necVersion:'2020', utilityName:'NV Energy', phone:'(702) 633-1534', onlinePermitting:true, typicalPermitFee:'$150–$450', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:105, groundSnowLoadPsf:0, seismicDesignCategory:'B' }),
  ahj({ id:'nv-washoe-reno', stateCode:'NV', stateName:'Nevada', county:'Washoe', city:'Reno', ahjName:'City of Reno Development Services', ahjType:'city', necVersion:'2020', utilityName:'NV Energy', phone:'(775) 334-2350', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:20, seismicDesignCategory:'C' }),

  // ── NEW JERSEY ───────────────────────────────────────────────────────────
  ahj({ id:'nj-bergen-county', stateCode:'NJ', stateName:'New Jersey', county:'Bergen', city:'Unincorporated', ahjName:'Bergen County Building Department', ahjType:'county', necVersion:'2017', utilityName:'PSE&G (Public Service Electric & Gas)', phone:'(201) 336-6000', typicalPermitFee:'$200–$600', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', localAmendments:['NJ Uniform Construction Code (UCC)'], specialRequirements:['NJ UCC compliance','PSE&G interconnection application','NJ BPU net metering'] }),
  ahj({ id:'nj-essex-newark', stateCode:'NJ', stateName:'New Jersey', county:'Essex', city:'Newark', ahjName:'City of Newark Division of Buildings', ahjType:'city', necVersion:'2017', utilityName:'PSE&G (Public Service Electric & Gas)', phone:'(973) 733-6400', typicalPermitFee:'$200–$600', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['NJ UCC compliance','PSE&G interconnection'] }),
  ahj({ id:'nj-middlesex-county', stateCode:'NJ', stateName:'New Jersey', county:'Middlesex', city:'Unincorporated', ahjName:'Middlesex County Construction Office', ahjType:'county', necVersion:'2017', utilityName:'PSE&G (Public Service Electric & Gas)', phone:'(732) 745-3100', typicalPermitFee:'$200–$600', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['NJ UCC compliance'] }),

  // ── NEW YORK ─────────────────────────────────────────────────────────────
  ahj({ id:'ny-new-york-nyc', stateCode:'NY', stateName:'New York', county:'New York', city:'New York City', ahjName:'NYC Department of Buildings (DOB)', ahjType:'city', necVersion:'2020', utilityName:'Con Edison', phone:'(212) 566-5000', website:'https://www.nyc.gov/site/buildings', onlinePermitting:true, typicalPermitFee:'$500–$2,000', feeStructure:'$100 filing fee + $15 per $1,000 valuation', typicalPlanCheckDays:15, typicalPermitDays:20, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', localAmendments:['NYC Building Code (local amendments)','NYC Electrical Code'], specialRequirements:['NYC DOB filing required','PE or RA stamp required','Con Edison interconnection','NYC Electrical Code compliance','Special inspection may be required'], planSetRequirements:['DOB-compliant drawings','PE/RA stamped','Site plan','SLD','Structural calcs','Equipment cut sheets','Special inspection forms'], notes:'NYC requires PE or RA stamp on all permit drawings — most complex jurisdiction in the US' }),
  ahj({ id:'ny-suffolk-county', stateCode:'NY', stateName:'New York', county:'Suffolk', city:'Unincorporated', ahjName:'Suffolk County Department of Public Works', ahjType:'county', necVersion:'2020', utilityName:'PSEG Long Island', phone:'(631) 853-4000', typicalPermitFee:'$200–$700', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:120, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['PSEG Long Island interconnection','NY-Sun incentive program'] }),
  ahj({ id:'ny-westchester-county', stateCode:'NY', stateName:'New York', county:'Westchester', city:'Unincorporated', ahjName:'Westchester County Building Department', ahjType:'county', necVersion:'2020', utilityName:'Con Edison', phone:'(914) 995-4000', typicalPermitFee:'$200–$700', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Con Edison interconnection','NY-Sun incentive'] }),

  // ── NORTH CAROLINA ───────────────────────────────────────────────────────
  ahj({ id:'nc-mecklenburg-charlotte', stateCode:'NC', stateName:'North Carolina', county:'Mecklenburg', city:'Charlotte', ahjName:'Mecklenburg County Code Enforcement', ahjType:'county', necVersion:'2020', utilityName:'Duke Energy Carolinas', phone:'(704) 336-3800', website:'https://www.mecknc.gov/LUESA/CodeEnforcement', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:5, seismicDesignCategory:'B', specialRequirements:['Duke Energy interconnection application','NC Utilities Commission net metering'] }),
  ahj({ id:'nc-wake-raleigh', stateCode:'NC', stateName:'North Carolina', county:'Wake', city:'Raleigh', ahjName:'City of Raleigh Inspections & Permits', ahjType:'city', necVersion:'2020', utilityName:'Duke Energy Progress', phone:'(919) 996-2495', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:5, seismicDesignCategory:'B', specialRequirements:['Duke Energy Progress interconnection'] }),

  // ── OHIO ─────────────────────────────────────────────────────────────────
  ahj({ id:'oh-franklin-columbus', stateCode:'OH', stateName:'Ohio', county:'Franklin', city:'Columbus', ahjName:'City of Columbus Building & Zoning Services', ahjType:'city', necVersion:'2020', utilityName:'AEP Ohio (Columbus Southern Power)', phone:'(614) 645-7433', website:'https://www.columbus.gov/bzs', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['AEP Ohio interconnection application'] }),
  ahj({ id:'oh-cuyahoga-cleveland', stateCode:'OH', stateName:'Ohio', county:'Cuyahoga', city:'Cleveland', ahjName:'City of Cleveland Building & Housing', ahjType:'city', necVersion:'2020', utilityName:'FirstEnergy (Cleveland Electric Illuminating)', phone:'(216) 664-2000', typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['FirstEnergy interconnection application'] }),

  // ── PENNSYLVANIA ─────────────────────────────────────────────────────────
  ahj({ id:'pa-philadelphia-philadelphia', stateCode:'PA', stateName:'Pennsylvania', county:'Philadelphia', city:'Philadelphia', ahjName:'City of Philadelphia Department of Licenses & Inspections', ahjType:'city', necVersion:'2017', utilityName:'PECO Energy', phone:'(215) 686-2400', website:'https://www.phila.gov/departments/department-of-licenses-and-inspections', onlinePermitting:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['PECO interconnection application','Philadelphia local amendments'] }),
  ahj({ id:'pa-allegheny-pittsburgh', stateCode:'PA', stateName:'Pennsylvania', county:'Allegheny', city:'Pittsburgh', ahjName:'City of Pittsburgh Bureau of Building Inspection', ahjType:'city', necVersion:'2017', utilityName:'Duquesne Light', phone:'(412) 255-2175', typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Duquesne Light interconnection'] }),

  // ── TEXAS ────────────────────────────────────────────────────────────────
  ahj({ id:'tx-harris-houston', stateCode:'TX', stateName:'Texas', county:'Harris', city:'Houston', ahjName:'City of Houston Permits & Inspections', ahjType:'city', necVersion:'2020', utilityName:'CenterPoint Energy', phone:'(832) 394-8800', website:'https://www.houstontx.gov/permits', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', feeStructure:'$0.25 per sq ft + $50 base', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['CenterPoint Energy interconnection','ERCOT grid — no FERC jurisdiction','Wind zone requirements'], notes:'Houston is in ERCOT — different interconnection rules than rest of US' }),
  ahj({ id:'tx-dallas-dallas', stateCode:'TX', stateName:'Texas', county:'Dallas', city:'Dallas', ahjName:'City of Dallas Development Services', ahjType:'city', necVersion:'2020', utilityName:'Oncor Electric Delivery', phone:'(214) 948-4480', website:'https://dallascityhall.com/departments/sustainabledevelopment/developmentservices', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['Oncor interconnection application','ERCOT grid'] }),
  ahj({ id:'tx-travis-austin', stateCode:'TX', stateName:'Texas', county:'Travis', city:'Austin', ahjName:'City of Austin Development Services', ahjType:'city', necVersion:'2020', utilityName:'Austin Energy', phone:'(512) 978-4000', website:'https://www.austintexas.gov/department/development-services', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['Austin Energy interconnection','Austin Energy rebate program available'], notes:'Austin Energy has one of the best solar incentive programs in Texas' }),
  ahj({ id:'tx-bexar-san-antonio', stateCode:'TX', stateName:'Texas', county:'Bexar', city:'San Antonio', ahjName:'City of San Antonio Development Services', ahjType:'city', necVersion:'2020', utilityName:'CPS Energy', phone:'(210) 207-1111', website:'https://www.sanantonio.gov/DSD', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['CPS Energy interconnection','CPS Energy rebate program'] }),
  ahj({ id:'tx-tarrant-fort-worth', stateCode:'TX', stateName:'Texas', county:'Tarrant', city:'Fort Worth', ahjName:'City of Fort Worth Development Services', ahjType:'city', necVersion:'2020', utilityName:'Oncor Electric Delivery', phone:'(817) 392-2222', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'A', specialRequirements:['Oncor interconnection','ERCOT grid'] }),
  ahj({ id:'tx-collin-plano', stateCode:'TX', stateName:'Texas', county:'Collin', city:'Plano', ahjName:'City of Plano Building Inspections', ahjType:'city', necVersion:'2020', utilityName:'Oncor Electric Delivery', phone:'(972) 941-7151', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'A', notes:'Plano has streamlined solar permitting' }),

  // ── VIRGINIA ─────────────────────────────────────────────────────────────
  ahj({ id:'va-fairfax-county', stateCode:'VA', stateName:'Virginia', county:'Fairfax', city:'Unincorporated', ahjName:'Fairfax County Building Development Division', ahjType:'county', necVersion:'2020', utilityName:'Dominion Energy Virginia', phone:'(703) 222-0801', website:'https://www.fairfaxcounty.gov/landdevelopment', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['Dominion Energy interconnection application','Virginia SCC net metering'] }),
  ahj({ id:'va-arlington-county', stateCode:'VA', stateName:'Virginia', county:'Arlington', city:'Arlington', ahjName:'Arlington County Building Division', ahjType:'county', necVersion:'2020', utilityName:'Dominion Energy Virginia', phone:'(703) 228-3800', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['Dominion Energy interconnection'] }),
  ahj({ id:'va-richmond-richmond', stateCode:'VA', stateName:'Virginia', county:'Richmond City', city:'Richmond', ahjName:'City of Richmond Permits & Inspections', ahjType:'city', necVersion:'2020', utilityName:'Dominion Energy Virginia', phone:'(804) 646-0500', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:20, seismicDesignCategory:'B' }),

  // ── WASHINGTON ───────────────────────────────────────────────────────────
  ahj({ id:'wa-king-seattle', stateCode:'WA', stateName:'Washington', county:'King', city:'Seattle', ahjName:'City of Seattle Department of Construction & Inspections', ahjType:'city', necVersion:'2020', utilityName:'Seattle City Light', phone:'(206) 684-8950', website:'https://www.seattle.gov/sdci', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'D', specialRequirements:['Seattle City Light interconnection','Washington State Energy Code','Seismic zone D requirements'], notes:'Seattle has progressive solar policies and online permitting' }),
  ahj({ id:'wa-king-county', stateCode:'WA', stateName:'Washington', county:'King', city:'Unincorporated', ahjName:'King County Department of Local Services', ahjType:'county', necVersion:'2020', utilityName:'Puget Sound Energy', phone:'(206) 296-6600', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'D', specialRequirements:['PSE interconnection','Washington State Energy Code'] }),
  ahj({ id:'wa-pierce-tacoma', stateCode:'WA', stateName:'Washington', county:'Pierce', city:'Tacoma', ahjName:'City of Tacoma Planning & Development Services', ahjType:'city', necVersion:'2020', utilityName:'Tacoma Power', phone:'(253) 591-5030', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'D', specialRequirements:['Tacoma Power interconnection'] }),

  // ── MASSACHUSETTS ────────────────────────────────────────────────────────
  ahj({ id:'ma-suffolk-boston', stateCode:'MA', stateName:'Massachusetts', county:'Suffolk', city:'Boston', ahjName:'City of Boston Inspectional Services Department', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy', phone:'(617) 635-5300', website:'https://www.boston.gov/departments/inspectional-services', onlinePermitting:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:120, groundSnowLoadPsf:40, seismicDesignCategory:'C', localAmendments:['Massachusetts State Building Code (780 CMR)'], specialRequirements:['Eversource interconnection','MA DOER net metering','780 CMR compliance','SREC-II or SMART program registration'], notes:'Massachusetts has strong solar incentives — SMART program provides additional revenue' }),
  ahj({ id:'ma-middlesex-cambridge', stateCode:'MA', stateName:'Massachusetts', county:'Middlesex', city:'Cambridge', ahjName:'City of Cambridge Inspectional Services', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy', phone:'(617) 349-6100', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:40, seismicDesignCategory:'C', specialRequirements:['Eversource interconnection','SMART program'] }),
  ahj({ id:'ma-worcester-worcester', stateCode:'MA', stateName:'Massachusetts', county:'Worcester', city:'Worcester', ahjName:'City of Worcester Inspectional Services', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy', phone:'(508) 799-1180', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:40, seismicDesignCategory:'C', specialRequirements:['Eversource interconnection','SMART program'] }),

  // ── MARYLAND ─────────────────────────────────────────────────────────────
  ahj({ id:'md-montgomery-county', stateCode:'MD', stateName:'Maryland', county:'Montgomery', city:'Unincorporated', ahjName:'Montgomery County Department of Permitting Services', ahjType:'county', necVersion:'2020', utilityName:'Pepco (Potomac Electric Power)', phone:'(240) 777-0311', website:'https://www.montgomerycountymd.gov/permitting', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['Pepco interconnection application','MD PSC net metering','Montgomery County Green Building requirements'] }),
  ahj({ id:'md-prince-georges-county', stateCode:'MD', stateName:'Maryland', county:"Prince George's", city:'Unincorporated', ahjName:"Prince George's County Department of Permitting, Inspections & Enforcement", ahjType:'county', necVersion:'2020', utilityName:'Pepco (Potomac Electric Power)', phone:'(301) 636-2050', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['Pepco interconnection','MD PSC net metering'] }),
  ahj({ id:'md-baltimore-baltimore', stateCode:'MD', stateName:'Maryland', county:'Baltimore City', city:'Baltimore', ahjName:'Baltimore City Department of Housing & Community Development', ahjType:'city', necVersion:'2020', utilityName:'BGE (Baltimore Gas & Electric)', phone:'(410) 396-3360', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', specialRequirements:['BGE interconnection','MD PSC net metering'] }),

  // ── CONNECTICUT ──────────────────────────────────────────────────────────
  ahj({ id:'ct-hartford-hartford', stateCode:'CT', stateName:'Connecticut', county:'Hartford', city:'Hartford', ahjName:'City of Hartford Building Department', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy CT', phone:'(860) 757-9000', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:30, seismicDesignCategory:'B', localAmendments:['Connecticut State Building Code'], specialRequirements:['Eversource CT interconnection','CT PURA net metering','Residential Solar Investment Program'] }),
  ahj({ id:'ct-fairfield-bridgeport', stateCode:'CT', stateName:'Connecticut', county:'Fairfield', city:'Bridgeport', ahjName:'City of Bridgeport Building Department', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy CT', phone:'(203) 576-7221', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Eversource CT interconnection','CT PURA net metering'] }),

  // ── MICHIGAN ─────────────────────────────────────────────────────────────
  ahj({ id:'mi-wayne-detroit', stateCode:'MI', stateName:'Michigan', county:'Wayne', city:'Detroit', ahjName:'City of Detroit Buildings, Safety Engineering & Environmental', ahjType:'city', necVersion:'2020', utilityName:'DTE Energy', phone:'(313) 224-3158', typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['DTE Energy interconnection application','Michigan net metering'] }),
  ahj({ id:'mi-kent-grand-rapids', stateCode:'MI', stateName:'Michigan', county:'Kent', city:'Grand Rapids', ahjName:'City of Grand Rapids Building Safety', ahjType:'city', necVersion:'2020', utilityName:'Consumers Energy', phone:'(616) 456-3000', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:35, seismicDesignCategory:'B', specialRequirements:['Consumers Energy interconnection'] }),

  // ── MINNESOTA ────────────────────────────────────────────────────────────
  ahj({ id:'mn-hennepin-minneapolis', stateCode:'MN', stateName:'Minnesota', county:'Hennepin', city:'Minneapolis', ahjName:'City of Minneapolis Community Planning & Economic Development', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(612) 673-3000', website:'https://www.minneapolismn.gov/business-services/licenses-permits-inspections', onlinePermitting:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:50, seismicDesignCategory:'A', specialRequirements:['Xcel Energy interconnection','Minnesota net metering','Snow load calculations required'], notes:'High snow loads in Minnesota — structural calcs critical' }),
  ahj({ id:'mn-ramsey-saint-paul', stateCode:'MN', stateName:'Minnesota', county:'Ramsey', city:'Saint Paul', ahjName:'City of Saint Paul Safety & Inspections', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(651) 266-8989', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:50, seismicDesignCategory:'A', specialRequirements:['Xcel Energy interconnection','Snow load calcs required'] }),

  // ── OREGON ───────────────────────────────────────────────────────────────
  ahj({ id:'or-multnomah-portland', stateCode:'OR', stateName:'Oregon', county:'Multnomah', city:'Portland', ahjName:'City of Portland Bureau of Development Services', ahjType:'city', necVersion:'2020', utilityName:'PGE (Portland General Electric)', phone:'(503) 823-7300', website:'https://www.portland.gov/bds', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$200–$600', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'D', specialRequirements:['PGE interconnection application','Oregon net metering','Seismic zone D requirements'], notes:'Portland is in seismic zone D — structural calcs must address seismic loads' }),
  ahj({ id:'or-washington-hillsboro', stateCode:'OR', stateName:'Oregon', county:'Washington', city:'Hillsboro', ahjName:'City of Hillsboro Building Division', ahjType:'city', necVersion:'2020', utilityName:'PGE (Portland General Electric)', phone:'(503) 681-6100', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:25, seismicDesignCategory:'D' }),

  // ── TENNESSEE ────────────────────────────────────────────────────────────
  ahj({ id:'tn-davidson-nashville', stateCode:'TN', stateName:'Tennessee', county:'Davidson', city:'Nashville', ahjName:'Metro Nashville Codes Administration', ahjType:'city', necVersion:'2020', utilityName:'NES (Nashville Electric Service)', phone:'(615) 862-6500', website:'https://www.nashville.gov/departments/codes', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:5, seismicDesignCategory:'B', specialRequirements:['NES interconnection application','Tennessee net metering'] }),
  ahj({ id:'tn-shelby-memphis', stateCode:'TN', stateName:'Tennessee', county:'Shelby', city:'Memphis', ahjName:'City of Memphis Division of Construction Code Enforcement', ahjType:'city', necVersion:'2020', utilityName:'MLGW (Memphis Light Gas & Water)', phone:'(901) 636-6500', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:5, seismicDesignCategory:'C', specialRequirements:['MLGW interconnection application','New Madrid seismic zone — structural calcs required'] }),

  // ── SOUTH CAROLINA ───────────────────────────────────────────────────────
  ahj({ id:'sc-charleston-charleston', stateCode:'SC', stateName:'South Carolina', county:'Charleston', city:'Charleston', ahjName:'City of Charleston Building Inspection Services', ahjType:'city', necVersion:'2020', utilityName:'Dominion Energy South Carolina', phone:'(843) 724-3765', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'C', specialRequirements:['Dominion Energy SC interconnection','Wind zone requirements'] }),
  ahj({ id:'sc-richland-columbia', stateCode:'SC', stateName:'South Carolina', county:'Richland', city:'Columbia', ahjName:'City of Columbia Building Permits', ahjType:'city', necVersion:'2020', utilityName:'SCE&G (South Carolina Electric & Gas)', phone:'(803) 545-3400', typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:5, seismicDesignCategory:'C', specialRequirements:['SCE&G interconnection'] }),

  // ── UTAH ─────────────────────────────────────────────────────────────────
  ahj({ id:'ut-salt-lake-salt-lake-city', stateCode:'UT', stateName:'Utah', county:'Salt Lake', city:'Salt Lake City', ahjName:'Salt Lake City Building Services', ahjType:'city', necVersion:'2020', utilityName:'Rocky Mountain Power', phone:'(801) 535-6000', website:'https://www.slc.gov/building', onlinePermitting:true, expeditedAvailable:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'D', specialRequirements:['Rocky Mountain Power interconnection','Utah net metering','Seismic zone D — structural calcs required'], notes:'Salt Lake City has streamlined solar permitting' }),
  ahj({ id:'ut-utah-provo', stateCode:'UT', stateName:'Utah', county:'Utah', city:'Provo', ahjName:'City of Provo Building Division', ahjType:'city', necVersion:'2020', utilityName:'Rocky Mountain Power', phone:'(801) 852-6400', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:3, typicalPermitDays:5, windSpeedMph:110, groundSnowLoadPsf:35, seismicDesignCategory:'D' }),

  // ── HAWAII ───────────────────────────────────────────────────────────────
  ahj({ id:'hi-honolulu-honolulu', stateCode:'HI', stateName:'Hawaii', county:'Honolulu', city:'Honolulu', ahjName:'City & County of Honolulu Department of Planning & Permitting', ahjType:'city', necVersion:'2020', utilityName:'HECO (Hawaiian Electric)', phone:'(808) 768-8000', website:'https://www.honolulu.gov/dpp', onlinePermitting:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'D', localAmendments:['Hawaii State Building Code','Hawaii Electrical Code'], specialRequirements:['HECO interconnection application','Hawaii net metering (NEM)','Hurricane zone requirements','Seismic zone D'], notes:'Hawaii has complex interconnection rules — HECO has been restrictive on new solar connections' }),

  // ── IDAHO ────────────────────────────────────────────────────────────────
  ahj({ id:'id-ada-boise', stateCode:'ID', stateName:'Idaho', county:'Ada', city:'Boise', ahjName:'City of Boise Planning & Development Services', ahjType:'city', necVersion:'2020', utilityName:'Idaho Power', phone:'(208) 384-3830', website:'https://www.cityofboise.org/departments/planning-and-development-services', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'C', specialRequirements:['Idaho Power interconnection application','Idaho net metering'] }),

  // ── NEW MEXICO ───────────────────────────────────────────────────────────
  ahj({ id:'nm-bernalillo-albuquerque', stateCode:'NM', stateName:'New Mexico', county:'Bernalillo', city:'Albuquerque', ahjName:'City of Albuquerque Planning Department', ahjType:'city', necVersion:'2020', utilityName:'PNM (Public Service Company of New Mexico)', phone:'(505) 924-3946', website:'https://www.cabq.gov/planning', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:10, seismicDesignCategory:'C', specialRequirements:['PNM interconnection application','New Mexico net metering'] }),

  // ── LOUISIANA ────────────────────────────────────────────────────────────
  ahj({ id:'la-orleans-new-orleans', stateCode:'LA', stateName:'Louisiana', county:'Orleans', city:'New Orleans', ahjName:'City of New Orleans Department of Safety & Permits', ahjType:'city', necVersion:'2020', utilityName:'Entergy New Orleans', phone:'(504) 658-7100', typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:150, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['Hurricane zone — wind uplift calcs required','Entergy interconnection','Flood zone considerations'], notes:'New Orleans is in a high wind zone — HVHZ-like requirements for coastal areas' }),
  ahj({ id:'la-east-baton-rouge-baton-rouge', stateCode:'LA', stateName:'Louisiana', county:'East Baton Rouge', city:'Baton Rouge', ahjName:'City-Parish of Baton Rouge Building Codes', ahjType:'city', necVersion:'2020', utilityName:'Entergy Gulf States Louisiana', phone:'(225) 389-3040', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:130, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['Entergy interconnection','Wind zone requirements'] }),

  // ── KENTUCKY ─────────────────────────────────────────────────────────────
  ahj({ id:'ky-jefferson-louisville', stateCode:'KY', stateName:'Kentucky', county:'Jefferson', city:'Louisville', ahjName:'Louisville Metro Inspections, Permits & Licenses', ahjType:'city', necVersion:'2020', utilityName:'LG&E (Louisville Gas & Electric)', phone:'(502) 574-3321', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:15, seismicDesignCategory:'B', specialRequirements:['LG&E interconnection application','Kentucky net metering'] }),

  // ── INDIANA ──────────────────────────────────────────────────────────────
  ahj({ id:'in-marion-indianapolis', stateCode:'IN', stateName:'Indiana', county:'Marion', city:'Indianapolis', ahjName:'City of Indianapolis Department of Business & Neighborhood Services', ahjType:'city', necVersion:'2020', utilityName:'AES Indiana (Indianapolis Power & Light)', phone:'(317) 327-5137', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['AES Indiana interconnection','Indiana net metering'] }),

  // ── WISCONSIN ────────────────────────────────────────────────────────────
  ahj({ id:'wi-milwaukee-milwaukee', stateCode:'WI', stateName:'Wisconsin', county:'Milwaukee', city:'Milwaukee', ahjName:'City of Milwaukee Department of Neighborhood Services', ahjType:'city', necVersion:'2020', utilityName:'We Energies', phone:'(414) 286-2268', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'A', specialRequirements:['We Energies interconnection','Wisconsin net metering','Snow load calcs required'] }),
  ahj({ id:'wi-dane-madison', stateCode:'WI', stateName:'Wisconsin', county:'Dane', city:'Madison', ahjName:'City of Madison Building Inspection', ahjType:'city', necVersion:'2020', utilityName:'MG&E (Madison Gas & Electric)', phone:'(608) 266-4551', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'A', specialRequirements:['MG&E interconnection','Wisconsin net metering'] }),

  // ── MISSOURI ─────────────────────────────────────────────────────────────
  ahj({ id:'mo-jackson-kansas-city', stateCode:'MO', stateName:'Missouri', county:'Jackson', city:'Kansas City', ahjName:'City of Kansas City Codes Administration', ahjType:'city', necVersion:'2020', utilityName:'Evergy (Kansas City Power & Light)', phone:'(816) 513-1500', onlinePermitting:true, typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['Evergy interconnection application','Missouri net metering'] }),
  ahj({ id:'mo-st-louis-st-louis', stateCode:'MO', stateName:'Missouri', county:'St. Louis City', city:'St. Louis', ahjName:'City of St. Louis Building Division', ahjType:'city', necVersion:'2020', utilityName:'Ameren Missouri', phone:'(314) 622-3313', typicalPermitFee:'$150–$500', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:115, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['Ameren Missouri interconnection'] }),

  // ── KANSAS ───────────────────────────────────────────────────────────────
  ahj({ id:'ks-sedgwick-wichita', stateCode:'KS', stateName:'Kansas', county:'Sedgwick', city:'Wichita', ahjName:'City of Wichita Building Inspection', ahjType:'city', necVersion:'2020', utilityName:'Evergy (Westar Energy)', phone:'(316) 268-4421', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['Evergy interconnection','Kansas net metering'] }),

  // ── OKLAHOMA ─────────────────────────────────────────────────────────────
  ahj({ id:'ok-oklahoma-oklahoma-city', stateCode:'OK', stateName:'Oklahoma', county:'Oklahoma', city:'Oklahoma City', ahjName:'City of Oklahoma City Development Services', ahjType:'city', necVersion:'2020', utilityName:'OG&E (Oklahoma Gas & Electric)', phone:'(405) 297-2578', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:10, seismicDesignCategory:'B', specialRequirements:['OG&E interconnection','Oklahoma net metering','Tornado zone — wind uplift calcs'] }),
  ahj({ id:'ok-tulsa-tulsa', stateCode:'OK', stateName:'Oklahoma', county:'Tulsa', city:'Tulsa', ahjName:'City of Tulsa Development Services', ahjType:'city', necVersion:'2020', utilityName:'PSO (Public Service Company of Oklahoma)', phone:'(918) 596-7526', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:10, seismicDesignCategory:'B', specialRequirements:['PSO interconnection','Wind uplift calcs'] }),

  // ── ARKANSAS ─────────────────────────────────────────────────────────────
  ahj({ id:'ar-pulaski-little-rock', stateCode:'AR', stateName:'Arkansas', county:'Pulaski', city:'Little Rock', ahjName:'City of Little Rock Building Permits', ahjType:'city', necVersion:'2020', utilityName:'Entergy Arkansas', phone:'(501) 371-4832', typicalPermitFee:'$100–$350', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:10, seismicDesignCategory:'B', specialRequirements:['Entergy Arkansas interconnection'] }),

  // ── MISSISSIPPI ──────────────────────────────────────────────────────────
  ahj({ id:'ms-hinds-jackson', stateCode:'MS', stateName:'Mississippi', county:'Hinds', city:'Jackson', ahjName:'City of Jackson Building Permits', ahjType:'city', necVersion:'2020', utilityName:'Entergy Mississippi', phone:'(601) 960-1111', typicalPermitFee:'$100–$350', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:0, seismicDesignCategory:'B', specialRequirements:['Entergy Mississippi interconnection'] }),

  // ── IOWA ─────────────────────────────────────────────────────────────────
  ahj({ id:'ia-polk-des-moines', stateCode:'IA', stateName:'Iowa', county:'Polk', city:'Des Moines', ahjName:'City of Des Moines Permit & Development Center', ahjType:'city', necVersion:'2020', utilityName:'MidAmerican Energy', phone:'(515) 283-4200', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'A', specialRequirements:['MidAmerican Energy interconnection','Iowa net metering'] }),

  // ── NEBRASKA ─────────────────────────────────────────────────────────────
  ahj({ id:'ne-douglas-omaha', stateCode:'NE', stateName:'Nebraska', county:'Douglas', city:'Omaha', ahjName:'City of Omaha Building Permits', ahjType:'city', necVersion:'2020', utilityName:'OPPD (Omaha Public Power District)', phone:'(402) 444-5350', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'A', specialRequirements:['OPPD interconnection application'] }),

  // ── SOUTH DAKOTA ─────────────────────────────────────────────────────────
  ahj({ id:'sd-minnehaha-sioux-falls', stateCode:'SD', stateName:'South Dakota', county:'Minnehaha', city:'Sioux Falls', ahjName:'City of Sioux Falls Building Services', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(605) 367-8888', onlinePermitting:true, typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'A', specialRequirements:['Xcel Energy interconnection','Snow load calcs required'] }),

  // ── NORTH DAKOTA ─────────────────────────────────────────────────────────
  ahj({ id:'nd-cass-fargo', stateCode:'ND', stateName:'North Dakota', county:'Cass', city:'Fargo', ahjName:'City of Fargo Building Inspections', ahjType:'city', necVersion:'2020', utilityName:'Xcel Energy', phone:'(701) 241-1450', typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:40, seismicDesignCategory:'A', specialRequirements:['Xcel Energy interconnection','Heavy snow load calcs required'] }),

  // ── MONTANA ──────────────────────────────────────────────────────────────
  ahj({ id:'mt-yellowstone-billings', stateCode:'MT', stateName:'Montana', county:'Yellowstone', city:'Billings', ahjName:'City of Billings Building Division', ahjType:'city', necVersion:'2020', utilityName:'NorthWestern Energy', phone:'(406) 657-8261', typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:115, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['NorthWestern Energy interconnection','Montana net metering','Snow load calcs required'] }),

  // ── WYOMING ──────────────────────────────────────────────────────────────
  ahj({ id:'wy-laramie-cheyenne', stateCode:'WY', stateName:'Wyoming', county:'Laramie', city:'Cheyenne', ahjName:'City of Cheyenne Building Division', ahjType:'city', necVersion:'2020', utilityName:'Black Hills Energy', phone:'(307) 637-6265', typicalPermitFee:'$100–$400', typicalPlanCheckDays:5, typicalPermitDays:7, windSpeedMph:120, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Black Hills Energy interconnection','High wind zone — wind uplift calcs'] }),

  // ── ALASKA ───────────────────────────────────────────────────────────────
  ahj({ id:'ak-anchorage-anchorage', stateCode:'AK', stateName:'Alaska', county:'Anchorage', city:'Anchorage', ahjName:'Municipality of Anchorage Development Services', ahjType:'city', necVersion:'2020', utilityName:'Chugach Electric Association', phone:'(907) 343-8151', typicalPermitFee:'$200–$600', typicalPlanCheckDays:10, typicalPermitDays:15, windSpeedMph:120, groundSnowLoadPsf:50, seismicDesignCategory:'D', specialRequirements:['Chugach Electric interconnection','Heavy snow load calcs required','Seismic zone D','Permafrost considerations in some areas'], notes:'Alaska has extreme snow loads and seismic activity — structural calcs are critical' }),

  // ── RHODE ISLAND ─────────────────────────────────────────────────────────
  ahj({ id:'ri-providence-providence', stateCode:'RI', stateName:'Rhode Island', county:'Providence', city:'Providence', ahjName:'City of Providence Inspection & Standards', ahjType:'city', necVersion:'2020', utilityName:'National Grid RI', phone:'(401) 680-5600', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:30, seismicDesignCategory:'C', localAmendments:['Rhode Island State Building Code'], specialRequirements:['National Grid RI interconnection','RI net metering','RI Renewable Energy Fund incentives'] }),

  // ── NEW HAMPSHIRE ────────────────────────────────────────────────────────
  ahj({ id:'nh-hillsborough-manchester', stateCode:'NH', stateName:'New Hampshire', county:'Hillsborough', city:'Manchester', ahjName:'City of Manchester Building Department', ahjType:'city', necVersion:'2020', utilityName:'Eversource Energy NH', phone:'(603) 624-6450', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:50, seismicDesignCategory:'C', specialRequirements:['Eversource NH interconnection','NH net metering','Heavy snow load calcs required'] }),

  // ── VERMONT ──────────────────────────────────────────────────────────────
  ahj({ id:'vt-chittenden-burlington', stateCode:'VT', stateName:'Vermont', county:'Chittenden', city:'Burlington', ahjName:'City of Burlington Code Enforcement', ahjType:'city', necVersion:'2020', utilityName:'Green Mountain Power', phone:'(802) 865-7188', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:50, seismicDesignCategory:'B', specialRequirements:['Green Mountain Power interconnection','Vermont net metering','Heavy snow load calcs required','Vermont Clean Energy Development Fund'] }),

  // ── MAINE ────────────────────────────────────────────────────────────────
  ahj({ id:'me-cumberland-portland', stateCode:'ME', stateName:'Maine', county:'Cumberland', city:'Portland', ahjName:'City of Portland Inspections Division', ahjType:'city', necVersion:'2020', utilityName:'Central Maine Power', phone:'(207) 874-8300', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:120, groundSnowLoadPsf:50, seismicDesignCategory:'C', specialRequirements:['CMP interconnection','Maine net metering','Heavy snow load calcs required'] }),

  // ── DELAWARE ─────────────────────────────────────────────────────────────
  ahj({ id:'de-new-castle-wilmington', stateCode:'DE', stateName:'Delaware', county:'New Castle', city:'Wilmington', ahjName:'City of Wilmington License & Inspections', ahjType:'city', necVersion:'2020', utilityName:'Delmarva Power', phone:'(302) 576-3030', typicalPermitFee:'$150–$500', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:20, seismicDesignCategory:'B', specialRequirements:['Delmarva Power interconnection','Delaware net metering'] }),

  // ── WEST VIRGINIA ────────────────────────────────────────────────────────
  ahj({ id:'wv-kanawha-charleston', stateCode:'WV', stateName:'West Virginia', county:'Kanawha', city:'Charleston', ahjName:'City of Charleston Building Permits', ahjType:'city', necVersion:'2020', utilityName:'Appalachian Power (AEP)', phone:'(304) 348-8000', typicalPermitFee:'$100–$400', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:110, groundSnowLoadPsf:30, seismicDesignCategory:'B', specialRequirements:['Appalachian Power interconnection','WV net metering'] }),

  // ── DISTRICT OF COLUMBIA ─────────────────────────────────────────────────
  ahj({ id:'dc-dc-washington', stateCode:'DC', stateName:'District of Columbia', county:'DC', city:'Washington', ahjName:'DC Department of Buildings', ahjType:'city', necVersion:'2020', utilityName:'Pepco (Potomac Electric Power)', phone:'(202) 671-3500', website:'https://dob.dc.gov', onlinePermitting:true, typicalPermitFee:'$200–$700', typicalPlanCheckDays:7, typicalPermitDays:10, windSpeedMph:115, groundSnowLoadPsf:25, seismicDesignCategory:'B', localAmendments:['DC Construction Codes'], specialRequirements:['Pepco interconnection','DC net metering','DC Renewable Portfolio Standard','Solar for All program'] }),
];

// ── Search functions ──────────────────────────────────────────────────────────

export function searchAhj(query: {
  stateCode?: string;
  county?: string;
  city?: string;
  zipCode?: string;
  text?: string;
}): AhjRecord[] {
  let results = AHJ_NATIONAL;

  if (query.stateCode) {
    results = results.filter(a => a.stateCode.toUpperCase() === query.stateCode!.toUpperCase());
  }

  if (query.city) {
    const cityLower = query.city.toLowerCase();
    const cityMatches = results.filter(a => a.city.toLowerCase().includes(cityLower));
    if (cityMatches.length > 0) results = cityMatches;
  }

  if (query.county) {
    const countyLower = query.county.toLowerCase().replace(' county', '');
    const countyMatches = results.filter(a =>
      a.county.toLowerCase().replace(' county', '').includes(countyLower)
    );
    if (countyMatches.length > 0) results = countyMatches;
  }

  if (query.text) {
    const textLower = query.text.toLowerCase();
    results = results.filter(a =>
      a.ahjName.toLowerCase().includes(textLower) ||
      a.city.toLowerCase().includes(textLower) ||
      a.county.toLowerCase().includes(textLower) ||
      a.stateName.toLowerCase().includes(textLower) ||
      a.utilityName.toLowerCase().includes(textLower)
    );
  }

  return results;
}

export function getAhjById(id: string): AhjRecord | null {
  return AHJ_NATIONAL.find(a => a.id === id) || null;
}

export function getAhjsByState(stateCode: string): AhjRecord[] {
  return AHJ_NATIONAL.filter(a => a.stateCode.toUpperCase() === stateCode.toUpperCase());
}

export function getAhjByAddress(address: string): AhjRecord | null {
  if (!address) return null;

  // Parse state from address
  const stateMatch = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*,|\s*$)/);
  const stateCode = stateMatch?.[1];
  if (!stateCode) return null;

  // Parse city from address
  const parts = address.split(',').map(p => p.trim());
  const cityPart = parts.length >= 2 ? parts[parts.length - 2] : null;

  // Try city match first
  if (cityPart) {
    const cityResults = searchAhj({ stateCode, city: cityPart });
    if (cityResults.length > 0) return cityResults[0];
  }

  // Fall back to first AHJ in state
  const stateResults = getAhjsByState(stateCode);
  return stateResults.length > 0 ? stateResults[0] : null;
}

export function getTotalAhjCount(): number {
  return AHJ_NATIONAL.length;
}

export function getStatesSummary(): { stateCode: string; stateName: string; count: number }[] {
  const map = new Map<string, { stateName: string; count: number }>();
  for (const a of AHJ_NATIONAL) {
    const existing = map.get(a.stateCode);
    if (existing) {
      existing.count++;
    } else {
      map.set(a.stateCode, { stateName: a.stateName, count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([stateCode, v]) => ({ stateCode, ...v }))
    .sort((a, b) => a.stateCode.localeCompare(b.stateCode));
}