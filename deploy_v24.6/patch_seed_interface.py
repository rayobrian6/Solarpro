with open('types/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

project_section_marker = 'export interface Project {'
engineering_seed_interface = '''export interface EngineeringSeed {
  // Bill-derived usage data
  annual_kwh: number;
  monthly_kwh: number;
  electricity_rate: number | null;
  utility: string;
  // System sizing
  system_kw: number;
  panel_watt: number;
  panel_count: number;
  // Equipment defaults
  inverter_type: 'micro' | 'string' | 'optimizer';
  inverter_model: string;
  system_type: 'roof' | 'ground' | 'fence';
  // Production estimate
  production_factor: number;
  annual_production_kwh: number;
  // Pricing estimate
  cost_low: number;
  cost_high: number;
  // Location context
  state_code: string | null;
  // Metadata
  generated_at: string;
}

'''

if project_section_marker in content and 'export interface EngineeringSeed' not in content:
    content = content.replace(project_section_marker, engineering_seed_interface + project_section_marker)
    print('✅ Inserted EngineeringSeed interface before Project')
elif 'export interface EngineeringSeed' in content:
    print('⏭ EngineeringSeed interface already exists')
else:
    print('❌ Could not find Project interface marker')

with open('types/index.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')