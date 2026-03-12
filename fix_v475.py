#!/usr/bin/env python3
"""
v47.5 - Fix bill upload workflow pipeline:
1. Fix updateProject() to persist bill_data (containing full BillAnalysis)
2. Fix rowToProject() to hydrate billAnalysis, utilityName, utilityRatePerKwh, stateCode from bill_data
3. Fix project [id] page: handleUploadBill opens inline modal, onComplete persists to project
4. Fix version badge to v47.5
"""

import re

# ─────────────────────────────────────────────────────────────────────────────
# 1. Fix updateProject() in db-neon.ts to also save bill_data
# ─────────────────────────────────────────────────────────────────────────────
DB_NEON_PATH = '/workspace/solarpro/lib/db-neon.ts'

with open(DB_NEON_PATH, 'r') as f:
    content = f.read()

# Replace the updateProject SQL to include bill_data
OLD_UPDATE_SQL = """  const rows = await sql`
    UPDATE projects SET
      name          = ${merged.name},
      client_id     = ${clientId},
      status        = ${merged.status || 'lead'},
      system_type   = ${merged.systemType || 'roof'},
      notes         = ${merged.notes || ''},
      address       = ${merged.address || ''},
      lat           = ${merged.lat ?? null},
      lng           = ${merged.lng ?? null},
      system_size_kw= ${merged.systemSizeKw ?? null},
      updated_at    = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING *
  `;
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}"""

NEW_UPDATE_SQL = """  // Serialize bill_data JSONB — preserve existing if not provided in update
  const billDataJson = ('billData' in data && data.billData !== undefined)
    ? JSON.stringify(data.billData)
    : (current.billData ? JSON.stringify(current.billData) : null);

  const rows = await sql`
    UPDATE projects SET
      name          = ${merged.name},
      client_id     = ${clientId},
      status        = ${merged.status || 'lead'},
      system_type   = ${merged.systemType || 'roof'},
      notes         = ${merged.notes || ''},
      address       = ${merged.address || ''},
      lat           = ${merged.lat ?? null},
      lng           = ${merged.lng ?? null},
      system_size_kw= ${merged.systemSizeKw ?? null},
      bill_data     = ${billDataJson ? sql`${billDataJson}::jsonb` : sql`bill_data`},
      updated_at    = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING *
  `;
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}"""

if OLD_UPDATE_SQL in content:
    content = content.replace(OLD_UPDATE_SQL, NEW_UPDATE_SQL)
    print("✓ updateProject SQL updated")
else:
    print("✗ WARN: updateProject SQL not found exactly — checking...")
    # Try to find it differently
    if "system_size_kw= ${merged.systemSizeKw ?? null}," in content:
        print("  Found partial match. Will do targeted replacement.")
        content = content.replace(
            "      system_size_kw= ${merged.systemSizeKw ?? null},\n      updated_at    = NOW()",
            """      system_size_kw= ${merged.systemSizeKw ?? null},
      bill_data     = ${billDataJson ? sql`${billDataJson}::jsonb` : sql`bill_data`},
      updated_at    = NOW()"""
        )
        # Add billDataJson computation before the sql`` template literal
        content = content.replace(
            "  const rows = await sql`\n    UPDATE projects SET\n      name          = ${merged.name},",
            """  // Serialize bill_data JSONB — preserve existing if not provided in update
  const billDataJson = ('billData' in data && data.billData !== undefined)
    ? JSON.stringify(data.billData)
    : (current.billData ? JSON.stringify(current.billData) : null);

  const rows = await sql`
    UPDATE projects SET
      name          = ${merged.name},"""
        )
        print("  ✓ Applied targeted patch")
    else:
        print("  ✗ Could not patch updateProject — manual fix needed")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Fix rowToProject() to hydrate billAnalysis from bill_data
# ─────────────────────────────────────────────────────────────────────────────

OLD_ROW_TO_PROJECT = """function rowToProject(row: Record<string, unknown>): Project {
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
    billData: row.bill_data as Record<string, unknown> | undefined,
    engineeringSeed: row.engineering_seed
      ? (typeof row.engineering_seed === 'string'
          ? JSON.parse(row.engineering_seed)
          : row.engineering_seed) as import('@/types').EngineeringSeed
      : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}"""

NEW_ROW_TO_PROJECT = """function rowToProject(row: Record<string, unknown>): Project {
  // Hydrate bill_data JSONB into typed BillAnalysis + utility fields
  const rawBillData = row.bill_data as Record<string, unknown> | undefined;
  let billAnalysis: import('@/types').BillAnalysis | undefined;
  let utilityName: string | undefined;
  let utilityRatePerKwh: number | undefined;
  let stateCode: string | undefined;

  if (rawBillData) {
    // bill_data may have been saved with billAnalysis nested or flat
    if (rawBillData._billAnalysis) {
      // New format: bill_data._billAnalysis = BillAnalysis object
      billAnalysis = rawBillData._billAnalysis as import('@/types').BillAnalysis;
      utilityName = (rawBillData._utilityName as string) || undefined;
      utilityRatePerKwh = (rawBillData._utilityRatePerKwh as number) || undefined;
      stateCode = (rawBillData._stateCode as string) || undefined;
    } else if (rawBillData.monthlyKwh && Array.isArray(rawBillData.monthlyKwh)) {
      // Legacy flat format: bill_data IS the BillAnalysis
      billAnalysis = rawBillData as unknown as import('@/types').BillAnalysis;
    }
  }

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
    billData: rawBillData,
    billAnalysis,
    utilityName,
    utilityRatePerKwh,
    stateCode,
    engineeringSeed: row.engineering_seed
      ? (typeof row.engineering_seed === 'string'
          ? JSON.parse(row.engineering_seed)
          : row.engineering_seed) as import('@/types').EngineeringSeed
      : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}"""

if OLD_ROW_TO_PROJECT in content:
    content = content.replace(OLD_ROW_TO_PROJECT, NEW_ROW_TO_PROJECT)
    print("✓ rowToProject() hydration updated")
else:
    print("✗ WARN: rowToProject() not found exactly")
    # Check partial
    if "billData: row.bill_data as Record<string, unknown> | undefined," in content:
        print("  Found partial match in rowToProject")

with open(DB_NEON_PATH, 'w') as f:
    f.write(content)

print(f"✓ db-neon.ts written")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Also fix getProjectWithDetails to hydrate billAnalysis in the return object
# ─────────────────────────────────────────────────────────────────────────────

with open(DB_NEON_PATH, 'r') as f:
    content = f.read()

# Find the return object in getProjectWithDetails and add billAnalysis hydration
OLD_DETAILS_RETURN = """  return {
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
}"""

NEW_DETAILS_RETURN = """  // Hydrate bill_data JSONB into typed BillAnalysis + utility fields
  const rawBillData = row.bill_data as Record<string, unknown> | undefined;
  let billAnalysis: import('@/types').BillAnalysis | undefined;
  let utilityName: string | undefined;
  let utilityRatePerKwh: number | undefined;
  let stateCode: string | undefined;

  if (rawBillData) {
    if (rawBillData._billAnalysis) {
      billAnalysis = rawBillData._billAnalysis as import('@/types').BillAnalysis;
      utilityName = (rawBillData._utilityName as string) || undefined;
      utilityRatePerKwh = (rawBillData._utilityRatePerKwh as number) || undefined;
      stateCode = (rawBillData._stateCode as string) || undefined;
    } else if (rawBillData.monthlyKwh && Array.isArray(rawBillData.monthlyKwh)) {
      billAnalysis = rawBillData as unknown as import('@/types').BillAnalysis;
    }
  }

  return {
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
    billData: rawBillData,
    billAnalysis,
    utilityName,
    utilityRatePerKwh,
    stateCode,
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
}"""

if OLD_DETAILS_RETURN in content:
    content = content.replace(OLD_DETAILS_RETURN, NEW_DETAILS_RETURN)
    print("✓ getProjectWithDetails return object updated")
else:
    print("✗ WARN: getProjectWithDetails return not found exactly")

with open(DB_NEON_PATH, 'w') as f:
    f.write(content)

print("✓ db-neon.ts final write done")

# ─────────────────────────────────────────────────────────────────────────────
# 4. Fix version.ts
# ─────────────────────────────────────────────────────────────────────────────

VERSION_PATH = '/workspace/solarpro/lib/version.ts'
with open(VERSION_PATH, 'r') as f:
    ver_content = f.read()

# Replace version
ver_content = re.sub(r"APP_VERSION\s*=\s*['&quot;]v?47\.[0-9]+['&quot;]", "APP_VERSION = '47.5'", ver_content)
ver_content = re.sub(r"BUILD_VERSION\s*=\s*['&quot;]v?47\.[0-9]+['&quot;]", "BUILD_VERSION = 'v47.5'", ver_content)
ver_content = re.sub(r"version:\s*['&quot;]v?47\.[0-9]+['&quot;]", "version: '47.5'", ver_content)

with open(VERSION_PATH, 'w') as f:
    f.write(ver_content)

print("✓ version.ts updated to v47.5")

print("\nAll db-neon.ts and version.ts patches applied.")
print("Next: Fix project page to open inline bill modal + persist on complete")