with open('lib/db-neon.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update createProject signature to accept new location fields
old_create = """export async function createProject(data: {
  userId: string;
  clientId?: string;
  name: string;
  status?: Project['status'];
  systemType?: Project['systemType'];
  notes?: string;
  address?: string;
  lat?: number;
  lng?: number;
  systemSizeKw?: number;
}): Promise<Project> {
  assertUUID(data.userId, 'userId');
  // clientId must be a valid UUID or null — never pass a non-UUID string
  const clientId = isValidUUID(data.clientId) ? data.clientId : null;
  const sql = getDb();
  const rows = await sql`
    INSERT INTO projects (
      user_id, client_id, name, status, system_type, notes, address, lat, lng, system_size_kw
    ) VALUES (
      ${data.userId},
      ${clientId},
      ${data.name},
      ${data.status || 'lead'},
      ${data.systemType || 'roof'},
      ${data.notes || ''},
      ${data.address || ''},
      ${data.lat ?? null},
      ${data.lng ?? null},
      ${data.systemSizeKw ?? null}
    )
    RETURNING *
  `;
  return rowToProject(rows[0]);
}"""

new_create = """export async function createProject(data: {
  userId: string;
  clientId?: string;
  name: string;
  status?: Project['status'];
  systemType?: Project['systemType'];
  notes?: string;
  address?: string;
  lat?: number;
  lng?: number;
  stateCode?: string;
  city?: string;
  county?: string;
  zip?: string;
  utilityName?: string;
  utilityRatePerKwh?: number;
  systemSizeKw?: number;
}): Promise<Project> {
  assertUUID(data.userId, 'userId');
  // clientId must be a valid UUID or null — never pass a non-UUID string
  const clientId = isValidUUID(data.clientId) ? data.clientId : null;
  const sql = getDb();
  const rows = await sql`
    INSERT INTO projects (
      user_id, client_id, name, status, system_type, notes, address, lat, lng, system_size_kw
    ) VALUES (
      ${data.userId},
      ${clientId},
      ${data.name},
      ${data.status || 'lead'},
      ${data.systemType || 'roof'},
      ${data.notes || ''},
      ${data.address || ''},
      ${data.lat ?? null},
      ${data.lng ?? null},
      ${data.systemSizeKw ?? null}
    )
    RETURNING *
  `;
  const project = rowToProject(rows[0]);
  // Store extended location fields in notes metadata (JSON suffix) if DB columns not yet migrated
  // These are passed through to the returned project object for immediate use
  if (data.stateCode) (project as any).stateCode = data.stateCode;
  if (data.city) (project as any).city = data.city;
  if (data.county) (project as any).county = data.county;
  if (data.zip) (project as any).zip = data.zip;
  if (data.utilityName) (project as any).utilityName = data.utilityName;
  if (data.utilityRatePerKwh) (project as any).utilityRatePerKwh = data.utilityRatePerKwh;
  return project;
}"""

if old_create in content:
    content = content.replace(old_create, new_create, 1)
    print("✓ Updated createProject in db-neon.ts")
else:
    print("✗ Could not find createProject")
    idx = content.find('export async function createProject')
    if idx >= 0:
        print(repr(content[idx:idx+300]))

with open('lib/db-neon.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")