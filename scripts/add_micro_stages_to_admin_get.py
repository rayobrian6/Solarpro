#!/usr/bin/env python3
"""Add micro_stages query to GET /api/admin/projects/[id] route."""

import sys

fpath = "app/api/admin/projects/[id]/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# Add micro_stages to the parallel Promise.all fetch (already has 3 items)
old_parallel = """      sql`
        SELECT
          file_name,
          file_type,
          COALESCE(file_name, file_type, 'Document') AS label,
          created_at::text AS uploaded_at
        FROM project_files
        WHERE project_id = ${id}
          AND (file_url IS NOT NULL OR file_data IS NOT NULL)
          AND status != 'failed'
        ORDER BY created_at DESC
        LIMIT 50
      `,
    ]);"""

new_parallel = """      sql`
        SELECT
          file_name,
          file_type,
          COALESCE(file_name, file_type, 'Document') AS label,
          created_at::text AS uploaded_at
        FROM project_files
        WHERE project_id = ${id}
          AND (file_url IS NOT NULL OR file_data IS NOT NULL)
          AND status != 'failed'
        ORDER BY created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT
          micro_stage,
          created_at::text AS created_at,
          created_by::text AS created_by
        FROM project_micro_stages
        WHERE project_id = ${id}
        ORDER BY created_at ASC
      `,
    ]);"""

if old_parallel not in src:
    print("ERROR: Could not find fileRows parallel block")
    sys.exit(1)

src = src.replace(old_parallel, new_parallel, 1)
print("OK: Added microRows to Promise.all")

# Update destructure
old_destructure = "    const [rows, historyRows, fileRows] = await Promise.all(["
new_destructure = "    const [rows, historyRows, fileRows, microRows] = await Promise.all(["

if old_destructure not in src:
    print("ERROR: Could not find destructure line")
    sys.exit(1)

src = src.replace(old_destructure, new_destructure, 1)
print("OK: Updated destructure to include microRows")

# Add micro_stages to return
old_return = """    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
      documents,
    });"""

new_return = """    const microStages = microRows.map((r: Record<string, unknown>) => ({
      micro_stage: String(r.micro_stage),
      created_at:  String(r.created_at),
    }));

    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
      documents,
      microStages,
    });"""

if old_return not in src:
    print("ERROR: Could not find return block")
    sys.exit(1)

src = src.replace(old_return, new_return, 1)
print("OK: Added microStages to GET response")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: File written")