import re

with open('types/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the Project interface and add engineeringSeed field + EngineeringSeed interface before it
# We'll insert the EngineeringSeed interface before the Project section
# and add the field inside Project

# 1. Add engineeringSeed field to Project interface (before notes?)
old_project_field = '  billAnalysis?: BillAnalysis;\n  notes?: string;'
new_project_field = '  billAnalysis?: BillAnalysis;\n  engineeringSeed?: EngineeringSeed;  // structured seed from bill upload\n  notes?: string;'

if old_project_field in content:
    content = content.replace(old_project_field, new_project_field)
    print('✅ Added engineeringSeed field to Project interface')
else:
    print('❌ Could not find billAnalysis field in Project interface')

# 2. Insert EngineeringSeed interface before the Project section
# Find the line with "Project" section header (the unicode box line)
project_section_marker = 'export interface Project {'
engineering_seed_interface = '''// ─── Engineering Seed ─────────────────────────────────────────────────────────
// Structured data object generated from bill upload.
// Stored as JSONB on the project record and used to auto-populate all
// engineering modules (System Config, Electrical, SLD, BOM, Proposal).
export interface EngineeringSeed {
  // Bill-derived usage data
  annual_kwh: number;
  monthly_kwh: number;
  electricity_rate: number | null;   // $/kWh — null if not parsed from bill
  utility: string;                   // utility name from bill or geocode
  // System sizing
  system_kw: number;
  panel_watt: number;                // e.g. 440
  panel_count: number;
  // Equipment defaults
  inverter_type: 'micro' | 'string' | 'optimizer';
  inverter_model: string;            // e.g. "Enphase IQ8+"
  system_type: 'roof' | 'ground' | 'fence';
  // Production estimate
  production_factor: number;         // kWh/kW/year — e.g. 1350 for CA
  annual_production_kwh: number;     // system_kw * production_factor
  // Pricing estimate
  cost_low: number;                  // low end $/W * system_kw * 1000
  cost_high: number;                 // high end $/W * system_kw * 1000
  // Location context
  state_code: string | null;         // e.g. "CA", "TX"
  // Metadata
  generated_at: string;              // ISO timestamp
}

'''

if project_section_marker in content and 'EngineeringSeed' not in content:
    content = content.replace(project_section_marker, engineering_seed_interface + project_section_marker)
    print('✅ Inserted EngineeringSeed interface before Project')
elif 'EngineeringSeed' in content:
    print('⏭ EngineeringSeed interface already exists')
else:
    print('❌ Could not find Project interface marker')

with open('types/index.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')