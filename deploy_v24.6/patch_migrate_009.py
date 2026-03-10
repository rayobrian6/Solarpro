with open('app/api/migrate/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_end = '''    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error('[POST /api/migrate]', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}'''

new_end = '''    // Migration 009: engineering_seed JSONB column on projects
    try {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'engineering_seed'
      `;
      if (exists.length === 0) {
        await sql`ALTER TABLE projects ADD COLUMN engineering_seed JSONB`;
        results.push('✅ Added engineering_seed column to projects');
      } else {
        results.push('⏭ projects.engineering_seed already exists');
      }
    } catch (e: any) {
      results.push(`⚠️ projects.engineering_seed: ${e.message}`);
    }

    // Migration 010: project_files table (BYTEA storage for workspace files)
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_files (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id     UUID NOT NULL,
          file_name   TEXT NOT NULL,
          file_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
          file_size   INTEGER NOT NULL DEFAULT 0,
          file_data   BYTEA NOT NULL,
          category    TEXT NOT NULL DEFAULT 'engineering',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ project_files table ready');
    } catch (e: any) {
      results.push(`⚠️ project_files table: ${e.message}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error('[POST /api/migrate]', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}'''

if old_end in content:
    content = content.replace(old_end, new_end)
    print('✅ Added Migration 009 + 010 to migrate route')
else:
    print('❌ Could not find end of migrate route')

with open('app/api/migrate/route.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')