with open('lib/db-neon.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update rowToProject to include engineering_seed
old_row_to_project = '''function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    name: row.name as string,
    status: (row.status as Project['status']) || 'lead',
    systemType: (row.system_type as Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}'''

new_row_to_project = '''function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    name: row.name as string,
    status: (row.status as Project['status']) || 'lead',
    systemType: (row.system_type as Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    engineeringSeed: row.engineering_seed
      ? (typeof row.engineering_seed === 'string'
          ? JSON.parse(row.engineering_seed)
          : row.engineering_seed) as import('@/types').EngineeringSeed
      : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}'''

if old_row_to_project in content:
    content = content.replace(old_row_to_project, new_row_to_project)
    print('✅ Updated rowToProject with engineering_seed')
else:
    print('❌ Could not find rowToProject function')

# 2. Update getProjectWithDetails return object to include engineering_seed
old_return = '''  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    client,
    name: row.name as string,
    status: (row.status as import('@/types').Project['status']) || 'lead',
    systemType: (row.system_type as import('@/types').Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    layout,
    production,
    costEstimate,
    selectedPanel,
    selectedInverter,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}'''

new_return = '''  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    client,
    name: row.name as string,
    status: (row.status as import('@/types').Project['status']) || 'lead',
    systemType: (row.system_type as import('@/types').Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    layout,
    production,
    costEstimate,
    selectedPanel,
    selectedInverter,
    engineeringSeed: row.engineering_seed
      ? (typeof row.engineering_seed === 'string'
          ? JSON.parse(row.engineering_seed)
          : row.engineering_seed) as import('@/types').EngineeringSeed
      : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}'''

if old_return in content:
    content = content.replace(old_return, new_return)
    print('✅ Updated getProjectWithDetails return with engineering_seed')
else:
    print('❌ Could not find getProjectWithDetails return block')

with open('lib/db-neon.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')