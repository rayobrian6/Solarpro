#!/usr/bin/env python3
"""Add Migration 028 (unique constraint on project_micro_stages) to migrate route."""

fpath = "app/api/migrate/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

old_end = "      results.push('\u2705 Migration 027 complete: project_micro_stages table ready');\n    } catch (e: unknown) {\n      results.push(`\u26a0\ufe0f Migration 027 (project_micro_stages): ${(e as Error).message}`);\n    }\n\n        return NextResponse.json({ success: true, results });"

new_end = """      results.push('\u2705 Migration 027 complete: project_micro_stages table ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 027 (project_micro_stages): ${(e as Error).message}`);
    }

    // -- Migration 028: Unique constraint on project_micro_stages --------------
    try {
      await sql`
        ALTER TABLE project_micro_stages
          ADD CONSTRAINT uq_project_micro_stage
          UNIQUE (project_id, micro_stage)
      `;
      results.push('\u2705 Migration 028 complete: uq_project_micro_stage constraint added');
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      // Idempotent: constraint already exists is not a real error
      if (msg.includes('already exists') || msg.includes('uq_project_micro_stage')) {
        results.push('\u2139\ufe0f Migration 028 skipped: uq_project_micro_stage already exists');
      } else {
        results.push(`\u26a0\ufe0f Migration 028 (uq_project_micro_stage): ${msg}`);
      }
    }

        return NextResponse.json({ success: true, results });"""

if old_end not in src:
    print("ERROR: Could not find Migration 027 tail block")
    import sys; sys.exit(1)

src = src.replace(old_end, new_end, 1)

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("OK: Migration 028 block added to migrate route")