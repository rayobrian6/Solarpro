-- SolarPro V2.5 Schema Updates
-- Smart Engineering Automation Platform

-- Add environmental/site data tables
CREATE TABLE IF NOT EXISTS site_conditions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  state VARCHAR(2),
  county VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  nec_version VARCHAR(10) DEFAULT '2020',
  wind_speed_mph DECIMAL(5, 2), -- ASCE 7-16/7-22 values
  ground_snow_load_psf DECIMAL(6, 2), -- NOAA values
  exposure_category VARCHAR(20) DEFAULT 'B', -- A, B, C, D
  wind_design_speed_mph DECIMAL(5, 2), -- Adjusted for importance
  seismic_design_category VARCHAR(10), -- Optional for future
  flood_zone VARCHAR(10), -- Optional for future
  auto_configured BOOLEAN DEFAULT TRUE,
  calculated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id)
);

-- Add hardware components catalog
CREATE TABLE IF NOT EXISTS hardware_components (
  id SERIAL PRIMARY KEY,
  category VARCHAR(50), -- 'racking', 'mount', 'conduit', 'wire', 'breakers', 'modules'
  manufacturer VARCHAR(100),
  model VARCHAR(100),
  part_number VARCHAR(100),
  specs JSONB, -- {uplift_capacity: 200, max_spacing: 48, material: 'aluminum', ...}
  cost DECIMAL(10, 2),
  weight_lbs DECIMAL(8, 2),
  length_inches DECIMAL(8, 2),
  width_inches DECIMAL(8, 2),
  depth_inches DECIMAL(8, 2),
  ul_listed BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add project hardware selections
CREATE TABLE IF NOT EXISTS project_hardware (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  component_id INTEGER REFERENCES hardware_components(id),
  quantity INTEGER DEFAULT 1,
  auto_selected BOOLEAN DEFAULT TRUE,
  selected_at TIMESTAMP DEFAULT NOW()
);

-- Add auto-configuration audit log
CREATE TABLE IF NOT EXISTS auto_config_log (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  field_name VARCHAR(100),
  auto_value JSONB,
  original_value JSONB,
  override_value JSONB,
  was_overridden BOOLEAN DEFAULT FALSE,
  reason TEXT,
  calculated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_site_conditions_project ON site_conditions(project_id);
CREATE INDEX IF NOT EXISTS idx_site_conditions_state_county ON site_conditions(state, county);
CREATE INDEX IF NOT EXISTS idx_hardware_category ON hardware_components(category);
CREATE INDEX IF NOT EXISTS idx_project_hardware_project ON project_hardware(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_config_log_project ON auto_config_log(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_config_log_calculated ON auto_config_log(calculated_at DESC);

-- Seed Roof Tech Mini II with L-Bracket hardware
INSERT INTO hardware_components (category, manufacturer, model, part_number, specs, cost, weight_lbs, length_inches, width_inches, depth_inches, ul_listed, notes) VALUES
('racking', 'Roof Tech', 'Mini II with L-Bracket', 'RT-AL2-MINI-2', 
 '{"uplift_capacity_lbs": 200, "downward_capacity_lbs": 200, "lateral_capacity_lbs": 150, "max_spacing_inches": 48, "min_spacing_inches": 24, "material": "6063-T6 Aluminum", "finish": "Anodized Black", "compatible_roof_types": ["asphalt_shingle", "metal_standing_seam", "tile"], "certifications": ["UL 1703", "IBC 2018", "IRC 2018"]}',
 15.99, 2.4, 12, 2.5, 1.5, TRUE, 'Mid-clamp for 2 modules. Aluminum L-bracket included for flush mount on composition shingle.')
ON CONFLICT DO NOTHING;

-- Seed common conductors for auto-selection
INSERT INTO hardware_components (category, manufacturer, model, part_number, specs, cost, weight_lbs, ul_listed) VALUES
('conductor', 'Southwire', 'THHN Copper 6 AWG', '62849401',
 '{"type": "THHN", "material": "copper", "awg": 6, "ampacity_75c": 65, "ampacity_90c": 75, "diameter_inches": 0.162, "iec_area_mm2": 13.3}',
 2.85, 0.12, TRUE),
('conductor', 'Southwire', 'THHN Copper 8 AWG', '62849402',
 '{"type": "THHN", "material": "copper", "awg": 8, "ampacity_75c": 50, "ampacity_90c": 55, "diameter_inches": 0.128, "iec_area_mm2": 8.37}',
 1.89, 0.08, TRUE),
('conductor', 'Southwire', 'THHN Copper 10 AWG', '62849403',
 '{"type": "THHN", "material": "copper", "awg": 10, "ampacity_75c": 35, "ampacity_90c": 40, "diameter_inches": 0.102, "iec_area_mm2": 5.26}',
 1.15, 0.05, TRUE),
('conductor', 'Southwire', 'XHHW-2 Copper 6 AWG', '62850001',
 '{"type": "XHHW-2", "material": "copper", "awg": 6, "ampacity_75c": 75, "ampacity_90c": 85, "diameter_inches": 0.162, "iec_area_mm2": 13.3}',
 3.25, 0.12, TRUE),
('conductor', 'Southwire', 'USE-2 Copper 6 AWG', '62854001',
 '{"type": "USE-2", "material": "copper", "awg": 6, "ampacity_75c": 65, "ampacity_90c": 75, "diameter_inches": 0.162, "iec_area_mm2": 13.3}',
 2.95, 0.12, TRUE),
('conductor', 'Southwire', 'PV Wire 10 AWG', '62849001',
 '{"type": "PV", "material": "copper", "awg": 10, "ampacity_60c": 30, "ampacity_75c": 35, "diameter_inches": 0.102, "iec_area_mm2": 5.26}',
 1.45, 0.05, TRUE)
ON CONFLICT DO NOTHING;

-- Seed common AC breakers
INSERT INTO hardware_components (category, manufacturer, model, part_number, specs, cost, weight_lbs, ul_listed) VALUES
('breakers', 'Siemens', 'Q2100', 'Q2100',
 '{"type": "mcb", "poles": 2, "amperage": 100, "voltage": 240, "interrupting_rating_ka": 10, "series": "Q", "approved_for_panelboard": TRUE}',
 28.50, 1.2, TRUE),
('breakers', 'Siemens', 'Q230', 'Q230',
 '{"type": "mcb", "poles": 2, "amperage": 30, "voltage": 240, "interrupting_rating_ka": 10, "series": "Q", "approved_for_panelboard": TRUE}',
 12.30, 0.4, TRUE),
('breakers', 'Siemens', 'Q220', 'Q220',
 '{"type": "mcb", "poles": 2, "amperage": 20, "voltage": 240, "interrupting_rating_ka": 10, "series": "Q", "approved_for_panelboard": TRUE}',
 10.15, 0.3, TRUE),
('breakers', 'Siemens', 'Q215', 'Q215',
 '{"type": "mcb", "poles": 2, "amperage": 15, "voltage": 240, "interrupting_rating_ka": 10, "series": "Q", "approved_for_panelboard": TRUE}',
 9.25, 0.3, TRUE),
('breakers', 'Square D', 'HOM2150CP', 'HOM2150CP',
 '{"type": "mcb", "poles": 2, "amperage": 150, "voltage": 240, "interrupting_rating_ka": 22, "series": "Homeline", "approved_for_panelboard": TRUE}',
 45.99, 1.5, TRUE)
ON CONFLICT DO NOTHING;

-- Seed common conduit types
INSERT INTO hardware_components (category, manufacturer, model, part_number, specs, cost, weight_lbs, ul_listed) VALUES
('conduit', 'Carlon', 'Schedule 40 PVC 1"', '2E048',
 '{"type": "schedule40", "material": "pvc", "nominal_size_inches": 1, "actual_id_inches": 1.049, "od_inches": 1.315, "wall_thickness_inches": 0.133}',
 4.25, 0.25, TRUE),
('conduit', 'Carlon', 'Schedule 40 PVC 3/4"', '2E047',
 '{"type": "schedule40", "material": "pvc", "nominal_size_inches": 0.75, "actual_id_inches": 0.824, "od_inches": 1.050, "wall_thickness_inches": 0.113}',
 2.85, 0.18, TRUE),
('conduit', 'Carlon', 'Schedule 40 PVC 1/2"', '2E046',
 '{"type": "schedule40", "material": "pvc", "nominal_size_inches": 0.5, "actual_id_inches": 0.622, "od_inches": 0.840, "wall_thickness_inches": 0.109}',
 1.95, 0.12, TRUE),
('conduit', 'Carlon', 'EMT 1"', 'E1R',
 '{"type": "emt", "material": "galvanized_steel", "nominal_size_inches": 1, "actual_id_inches": 1.049, "od_inches": 1.315, "wall_thickness_inches": 0.066}',
 6.50, 0.35, TRUE),
('conduit', 'Carlon', 'EMT 3/4"', 'E3/4R',
 '{"type": "emt", "material": "galvanized_steel", "nominal_size_inches": 0.75, "actual_id_inches": 0.824, "od_inches": 1.050, "wall_thickness_inches": 0.062}',
 4.75, 0.28, TRUE)
ON CONFLICT DO NOTHING;

-- State to NEC version mapping
CREATE TABLE IF NOT EXISTS state_nec_mapping (
  state VARCHAR(2) PRIMARY KEY,
  nec_version VARCHAR(10),
  effective_date DATE,
  notes TEXT
);

INSERT INTO state_nec_mapping (state, nec_version, effective_date, notes) VALUES
('CA', '2023', '2023-01-01', 'California Electrical Code based on NEC 2023'),
('NY', '2023', '2023-01-01', 'NYC amended NEC 2023'),
('MA', '2023', '2023-01-01', 'Mass. amended NEC 2023'),
('WA', '2023', '2020-07-01', 'Washington state adopted NEC 2020'),
('TX', '2023', '2023-09-01', 'Texas adopted NEC 2023'),
('FL', '2020', '2017-12-31', 'Florida NEC 2020'),
('AZ', '2023', '2023-07-01', 'Arizona NEC 2023'),
('CO', '2020', '2020-07-01', 'Colorado NEC 2020'),
('NV', '2020', '2020-07-01', 'Nevada NEC 2020'),
('NM', '2020', '2020-07-01', 'New Mexico NEC 2020'),
('OR', '2023', '2024-01-01', 'Oregon NEC 2023'),
('UT', '2020', '2020-07-01', 'Utah NEC 2020'),
('NC', '2020', '2018-01-01', 'North Carolina NEC 2020'),
('SC', '2020', '2020-01-01', 'South Carolina NEC 2020'),
('GA', '2020', '2020-07-01', 'Georgia NEC 2020'),
('VA', '2023', '2024-01-01', 'Virginia NEC 2023'),
('MD', '2023', '2024-01-01', 'Maryland NEC 2023'),
('PA', '2020', '2018-01-01', 'Pennsylvania NEC 2020'),
('NJ', '2023', '2023-01-01', 'New Jersey NEC 2023'),
('CT', '2023', '2023-01-01', 'Connecticut NEC 2023'),
('RI', '2023', '2023-01-01', 'Rhode Island NEC 2023'),
('VT', '2020', '2019-01-01', 'Vermont NEC 2020'),
('NH', '2020', '2020-01-01', 'New Hampshire NEC 2020'),
('ME', '2020', '2020-07-01', 'Maine NEC 2020')
ON CONFLICT DO NOTHING;

-- County to wind/snow defaults (sample data - full mapping would be comprehensive)
CREATE TABLE IF NOT EXISTS county_environmental_data (
  id SERIAL PRIMARY KEY,
  state VARCHAR(2),
  county VARCHAR(100),
  wind_speed_mph DECIMAL(5, 2),
  ground_snow_load_psf DECIMAL(6, 2),
  exposure_category VARCHAR(20) DEFAULT 'B',
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(state, county)
);

-- Sample environmental data (will be expanded with real NOAA/ASCE data)
INSERT INTO county_environmental_data (state, county, wind_speed_mph, ground_snow_load_psf, exposure_category) VALUES
('CA', 'Los Angeles', 90, 0, 'B'),
('CA', 'Orange', 90, 0, 'B'),
('CA', 'San Diego', 90, 0, 'B'),
('CA', 'Santa Clara', 90, 0, 'B'),
('CA', 'San Francisco', 110, 0, 'C'),
('TX', 'Harris', 120, 0, 'B'),
('TX', 'Dallas', 115, 5, 'B'),
('TX', 'Tarrant', 115, 5, 'B'),
('TX', 'Bexar', 110, 0, 'B'),
('TX', 'Travis', 115, 5, 'B'),
('FL', 'Miami-Dade', 180, 0, 'C'),
('FL', 'Broward', 160, 0, 'C'),
('FL', 'Palm Beach', 150, 0, 'C'),
('NY', 'New York', 110, 30, 'B'),
('NY', 'Kings', 110, 30, 'B'),
('NY', 'Queens', 110, 30, 'B'),
('WA', 'King', 100, 20, 'B'),
('WA', 'Pierce', 100, 20, 'B'),
('WA', 'Snohomish', 110, 25, 'C'),
('AZ', 'Maricopa', 90, 0, 'B'),
('AZ', 'Pima', 85, 0, 'B'),
('CO', 'Denver', 115, 30, 'B'),
('CO', 'Jefferson', 115, 30, 'B'),
('NC', 'Mecklenburg', 105, 10, 'B'),
('NC', 'Wake', 105, 10, 'B'),
('GA', 'Fulton', 110, 5, 'B'),
('GA', 'DeKalb', 110, 5, 'B')
ON CONFLICT DO NOTHING;

-- Comments for future enhancements
-- TODO: Add rapid shutdown rules mapping by jurisdiction
-- TODO: Add utility rate database integration (OpenEI)
-- TODO: Add FEMA flood zone integration
-- TODO: Add NREL PVWatts integration for production modeling