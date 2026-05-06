#!/usr/bin/env python3
"""Add documents query to GET /api/admin/projects/[id] route."""

import sys

fpath = "app/api/admin/projects/[id]/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# Add documents to the parallel Promise.all fetch
old_parallel = """    const [rows, historyRows] = await Promise.all([
      sql`
        SELECT
          p.id, p.name, p.address, p.system_size_kw, p.status,
          p.origin, p.deleted_at, p.created_at, p.updated_at,
          p.homeowner_stage,
          u.name  AS owner_name,
          u.email AS owner_email,
          u.id    AS owner_id,
          c.name  AS client_name,
          c.email AS client_email,
          c.id    AS client_id
        FROM projects p
        LEFT JOIN users   u ON u.id = p.user_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ${id}
        LIMIT 1
      `,
      sql`
        SELECT
          h.id, h.stage, h.note, h.created_at,
          a.name  AS changed_by_name,
          a.email AS changed_by_email
        FROM project_homeowner_stage_history h
        LEFT JOIN users a ON a.id = h.changed_by
        WHERE h.project_id = ${id}
        ORDER BY h.created_at DESC
        LIMIT 50
      `,
    ]);"""

new_parallel = """    const [rows, historyRows, fileRows] = await Promise.all([
      sql`
        SELECT
          p.id, p.name, p.address, p.system_size_kw, p.status,
          p.origin, p.deleted_at, p.created_at, p.updated_at,
          p.homeowner_stage,
          u.name  AS owner_name,
          u.email AS owner_email,
          u.id    AS owner_id,
          c.name  AS client_name,
          c.email AS client_email,
          c.id    AS client_id
        FROM projects p
        LEFT JOIN users   u ON u.id = p.user_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ${id}
        LIMIT 1
      `,
      sql`
        SELECT
          h.id, h.stage, h.note, h.created_at,
          a.name  AS changed_by_name,
          a.email AS changed_by_email
        FROM project_homeowner_stage_history h
        LEFT JOIN users a ON a.id = h.changed_by
        WHERE h.project_id = ${id}
        ORDER BY h.created_at DESC
        LIMIT 50
      `,
      sql`
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

if old_parallel not in src:
    print("ERROR: Could not find Promise.all block")
    sys.exit(1)

src = src.replace(old_parallel, new_parallel, 1)
print("OK: Added fileRows to Promise.all")

# Update the return to include documents
old_return = """    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
    });"""

new_return = """    // Normalize document labels for display
    const documents = fileRows.map((r: Record<string, unknown>) => ({
      file_type:   r.file_type ? String(r.file_type) : undefined,
      label:       String(r.label ?? r.file_name ?? 'Document'),
      uploaded_at: String(r.uploaded_at),
    }));

    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
      documents,
    });"""

if old_return not in src:
    print("ERROR: Could not find return block")
    sys.exit(1)

src = src.replace(old_return, new_return, 1)
print("OK: Added documents to GET response")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: File written")