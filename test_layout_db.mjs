/**
 * test_layout_db.mjs
 * Direct DB verification using @neondatabase/serverless
 * Run: node test_layout_db.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Manually parse .env.local
const envPath = join(__dirname, '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
  process.env[key] = val;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env.local');
  process.exit(1);
}

console.log('DATABASE_URL present:', DATABASE_URL.slice(0, 30) + '...');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(DATABASE_URL);

console.log('\n=== LAYOUT DB VERIFICATION ===\n');

try {
  // 1. Check layouts table schema
  console.log('1. CHECKING LAYOUTS TABLE SCHEMA...');
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'layouts'
    ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.log('   ❌ layouts table does NOT exist!');
  } else {
    const colNames = cols.map(c => c.column_name);
    console.log('   Columns:', colNames.join(', '));
    console.log('   panels column:', colNames.includes('panels') ? '✅' : '❌ MISSING');
    console.log('   roof_planes column:', colNames.includes('roof_planes') ? '✅' : '❌ MISSING');
    console.log('   map_center column:', colNames.includes('map_center') ? '✅' : '❌ MISSING');
  }

  // 2. Count total layouts
  console.log('\n2. CHECKING LAYOUTS TABLE CONTENTS...');
  const total = await sql`SELECT COUNT(*) as cnt FROM layouts`;
  console.log('   Total layout rows:', total[0].cnt);

  // 3. Check most recent layouts
  console.log('\n3. MOST RECENT 5 LAYOUTS...');
  const recent = await sql`
    SELECT 
      id,
      project_id,
      jsonb_array_length(COALESCE(panels, '[]'::jsonb)) as panel_count,
      CASE WHEN roof_planes IS NULL THEN 'NULL' 
           WHEN roof_planes::text = 'null' THEN 'null_json'
           ELSE jsonb_array_length(roof_planes)::text || ' planes'
      END as roof_planes_status,
      total_panels,
      system_size_kw,
      updated_at
    FROM layouts
    ORDER BY updated_at DESC
    LIMIT 5
  `;
  
  if (recent.length === 0) {
    console.log('   ❌ NO LAYOUTS IN DB — nothing has ever been saved!');
  } else {
    recent.forEach((r, i) => {
      console.log(`   [${i+1}] project_id=${r.project_id}`);
      console.log(`        panels=${r.panel_count} | roof_planes=${r.roof_planes_status} | total_panels=${r.total_panels} | kW=${r.system_size_kw}`);
      console.log(`        updated=${r.updated_at}`);
    });
  }

  // 4. Layouts with roof_planes
  console.log('\n4. LAYOUTS WITH ROOF PLANES...');
  const withRoofPlanes = await sql`
    SELECT COUNT(*) as cnt
    FROM layouts
    WHERE roof_planes IS NOT NULL 
      AND roof_planes::text != 'null'
      AND jsonb_array_length(roof_planes) > 0
  `;
  console.log('   Layouts with roof_planes:', withRoofPlanes[0].cnt);

  // 5. Layouts with panels
  console.log('\n5. LAYOUTS WITH PANELS...');
  const withPanels = await sql`
    SELECT COUNT(*) as cnt
    FROM layouts
    WHERE panels IS NOT NULL 
      AND jsonb_array_length(panels) > 0
  `;
  console.log('   Layouts with panels:', withPanels[0].cnt);

  // 6. Sample most recent layout with panels
  console.log('\n6. SAMPLE — MOST RECENT LAYOUT WITH PANELS...');
  const sample = await sql`
    SELECT 
      id, project_id,
      panels -> 0 as first_panel,
      roof_planes -> 0 as first_roof_plane,
      jsonb_array_length(panels) as panel_count,
      total_panels,
      updated_at
    FROM layouts
    WHERE panels IS NOT NULL AND jsonb_array_length(panels) > 0
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (sample.length === 0) {
    console.log('   ❌ No layout with panels found in DB');
  } else {
    const s = sample[0];
    const fp = s.first_panel;
    const frp = s.first_roof_plane;
    console.log('   project_id:', s.project_id);
    console.log('   panel_count:', s.panel_count, '| total_panels:', s.total_panels);
    console.log('   first_panel keys:', fp ? Object.keys(fp).join(', ') : 'N/A');
    console.log('   first_panel.lat:', fp?.lat ?? 'MISSING ❌');
    console.log('   first_panel.lng:', fp?.lng ?? 'MISSING ❌');
    console.log('   first_roof_plane:', frp ? JSON.stringify(frp).slice(0, 120) : 'NULL ❌');
    console.log('   updated_at:', s.updated_at);
  }

  // 7. Check projects table for project count
  console.log('\n7. PROJECTS TABLE...');
  const projects = await sql`SELECT COUNT(*) as cnt FROM projects WHERE deleted_at IS NULL`;
  console.log('   Total active projects:', projects[0].cnt);

  console.log('\n=== VERIFICATION COMPLETE ===');

} catch (err) {
  console.error('❌ DB ERROR:', err.message);
  console.error(err.stack);
}