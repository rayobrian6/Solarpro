with open('types/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """export interface Project {
  id: string;
  userId: string;
  clientId?: string;           // optional — project can exist without a client
  client?: Client;
  name: string;
  status: ProjectStatus;
  systemType: SystemType;
  address?: string;            // project site address
  lat?: number;                // geocoded latitude
  lng?: number;                // geocoded longitude
  systemSizeKw?: number;       // calculated system size"""

new = """export interface Project {
  id: string;
  userId: string;
  clientId?: string;           // optional — project can exist without a client
  client?: Client;
  name: string;
  status: ProjectStatus;
  systemType: SystemType;
  address?: string;            // project site address
  lat?: number;                // geocoded latitude
  lng?: number;                // geocoded longitude
  stateCode?: string;          // 2-letter state code (e.g. 'CA', 'TX')
  city?: string;               // city name
  county?: string;             // county name
  zip?: string;                // ZIP code
  utilityName?: string;        // detected utility provider name
  utilityRatePerKwh?: number;  // detected utility rate $/kWh
  systemSizeKw?: number;       // calculated system size"""

if old in content:
    content = content.replace(old, new, 1)
    with open('types/index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Done - types/index.ts updated")
else:
    print("ERROR: target string not found")
    # Show what's around systemSizeKw
    idx = content.find('systemSizeKw')
    print(repr(content[max(0,idx-400):idx+100]))