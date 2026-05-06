#!/usr/bin/env python3
"""Add micro_stages query to portal dashboard API route."""

import sys

fpath = "app/api/portal/dashboard/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# Find the documents block and add micro stages fetch after it
# Look for the return statement and add micro stage fetch before it

old_return = "    return NextResponse.json({"

# Make sure we only hit the FIRST/main return, not any error returns
# Find the last return NextResponse.json({ success: true in the file
import re
# Find the success return that includes documents
target = "    return NextResponse.json({\n      success: true,"

if target not in src:
    print("ERROR: Could not find success return")
    sys.exit(1)

# Find position
pos = src.rfind(target)
if pos == -1:
    print("ERROR: rfind failed")
    sys.exit(1)

# Insert micro stages fetch before the return
micro_fetch = """    // Fetch micro stages for all client projects (internal progress events)
    let microStages: { project_id: string; micro_stage: string; created_at: string }[] = [];
    if (projectIds.length > 0) {
      try {
        const microRows = await sql`
          SELECT
            project_id::text,
            micro_stage::text,
            created_at::text
          FROM project_micro_stages
          WHERE project_id = ANY(${projectIds})
          ORDER BY created_at ASC
        `;
        microStages = microRows.map((r: Record<string, unknown>) => ({
          project_id:  String(r.project_id),
          micro_stage: String(r.micro_stage),
          created_at:  String(r.created_at),
        }));
      } catch {
        // project_micro_stages may not exist yet — non-fatal
      }
    }

"""

src = src[:pos] + micro_fetch + src[pos:]
print("OK: Inserted micro stages fetch before return")

# Now add microStages to the return payload
old_payload = "    return NextResponse.json({\n      success: true,"
new_payload_search = "      stageHistory,"

# Find the stageHistory line in the return and add microStages after
if "      stageHistory," in src:
    src = src.replace("      stageHistory,", "      stageHistory,\n      microStages,", 1)
    print("OK: Added microStages to return payload")
elif "stageHistory:" in src:
    src = src.replace("stageHistory:", "stageHistory:\n      microStages,\n      // stageHistory:", 1)
    print("OK: Added microStages (fallback)")
else:
    # Just add it to documents line
    src = src.replace("      documents,", "      documents,\n      microStages,", 1)
    print("OK: Added microStages after documents")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: File written")