/**
 * REAL SIMULATION AUDIT — Pricing Flow
 * Traces the exact data path from DB → API → Proposal page
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Load env
dotenv.config({ path: '.env.local' });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function audit() {
  console.log('\n========================================');
  console.log('PRICING SYSTEM REAL SIMULATION AUDIT');
  console.log('========================================\n');

  // ── 1. Check pricing_config table ──────────────────────────────────────────
  console.log('1. PRICING CONFIG TABLE');
  console.log('─────────────────────────────────────');
  try {
    const rows = await sql`SELECT * FROM pricing_config LIMIT 5`;
    if (rows.length === 0) {
      console.log('❌ pricing_config table is EMPTY — no config saved!');
    } else {
      console.log(`✅ ${rows.length} row(s) found`);
      const r = rows[0];
      console.log(`   price_per_watt:          ${r.price_per_watt}`);
      console.log(`   roof_price_per_watt:     ${r.roof_price_per_watt}`);
      console.log(`   ground_price_per_watt:   ${r.ground_price_per_watt}`);
      console.log(`   fence_price_per_watt:    ${r.fence_price_per_watt}`);
      console.log(`   profit_margin:           ${r.profit_margin}`);
      console.log(`   updated_at:              ${r.updated_at}`);
    }
  } catch (e) {
    console.log(`❌ pricing_config table ERROR: ${e.message}`);
  }

  // ── 2. Check layouts table ──────────────────────────────────────────────────
  console.log('\n2. LAYOUTS TABLE (last 3)');
  console.log('─────────────────────────────────────');
  try {
    const rows = await sql`SELECT id, project_id, system_size_kw, total_panels, system_type, updated_at FROM layouts ORDER BY updated_at DESC LIMIT 3`;
    if (rows.length === 0) {
      console.log('❌ No layouts found — no design studio work done yet');
    } else {
      for (const r of rows) {
        console.log(`   Layout ${r.id.slice(0,8)}... | project: ${r.project_id.slice(0,8)}... | size: ${r.system_size_kw} kW | panels: ${r.total_panels} | type: ${r.system_type}`);
      }
    }
  } catch (e) {
    console.log(`❌ layouts ERROR: ${e.message}`);
  }

  // ── 3. Check productions table ─────────────────────────────────────────────
  console.log('\n3. PRODUCTIONS TABLE (last 3)');
  console.log('─────────────────────────────────────');
  try {
    const rows = await sql`SELECT id, project_id, annual_production_kwh, data_json, calculated_at FROM productions ORDER BY calculated_at DESC LIMIT 3`;
    if (rows.length === 0) {
      console.log('❌ No productions found — production never calculated');
    } else {
      for (const r of rows) {
        const dj = r.data_json;
        const hasCostEstimate = dj && dj.costEstimate;
        const cashPrice = hasCostEstimate ? dj.costEstimate.cashPrice : 'MISSING';
        console.log(`   Production ${r.id.slice(0,8)}... | project: ${r.project_id.slice(0,8)}... | annual: ${r.annual_production_kwh} kWh`);
        console.log(`     data_json.costEstimate: ${hasCostEstimate ? '✅ EXISTS' : '❌ MISSING'}`);
        console.log(`     cashPrice: ${cashPrice}`);
        if (hasCostEstimate) {
          console.log(`     grossCost: ${dj.costEstimate.grossCost}`);
          console.log(`     netCost: ${dj.costEstimate.netCost}`);
          console.log(`     pricePerWatt: ${dj.costEstimate.pricePerWatt}`);
        }
      }
    }
  } catch (e) {
    console.log(`❌ productions ERROR: ${e.message}`);
  }

  // ── 4. Check projects table ────────────────────────────────────────────────
  console.log('\n4. PROJECTS TABLE (last 3)');
  console.log('─────────────────────────────────────');
  try {
    const rows = await sql`SELECT id, name, system_type, system_size_kw, status, updated_at FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3`;
    if (rows.length === 0) {
      console.log('❌ No projects found');
    } else {
      for (const r of rows) {
        console.log(`   Project ${r.id.slice(0,8)}... | "${r.name}" | type: ${r.system_type} | size: ${r.system_size_kw} kW | status: ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`❌ projects ERROR: ${e.message}`);
  }

  // ── 5. Check proposals table ───────────────────────────────────────────────
  console.log('\n5. PROPOSALS TABLE (last 3)');
  console.log('─────────────────────────────────────');
  try {
    const rows = await sql`SELECT id, project_id, data_json, created_at FROM proposals ORDER BY created_at DESC LIMIT 3`;
    if (rows.length === 0) {
      console.log('❌ No proposals found');
    } else {
      for (const r of rows) {
        console.log(`   Proposal ${r.id.slice(0,8)}... | project: ${r.project_id.slice(0,8)}...`);
      }
    }
  } catch (e) {
    console.log(`❌ proposals ERROR: ${e.message}`);
  }

  // ── 6. Simulate getProjectWithDetails for most recent project ──────────────
  console.log('\n6. SIMULATE getProjectWithDetails (most recent project)');
  console.log('─────────────────────────────────────');
  try {
    const projects = await sql`SELECT id, user_id, name FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`;
    if (projects.length === 0) {
      console.log('❌ No projects to test');
    } else {
      const p = projects[0];
      console.log(`   Testing project: "${p.name}" (${p.id.slice(0,8)}...)`);

      const [layoutRows, productionRows] = await Promise.all([
        sql`SELECT * FROM layouts WHERE project_id = ${p.id} ORDER BY updated_at DESC LIMIT 1`,
        sql`SELECT * FROM productions WHERE project_id = ${p.id} ORDER BY calculated_at DESC LIMIT 1`,
      ]);

      if (layoutRows.length === 0) {
        console.log('   ❌ NO LAYOUT — systemSizeKw will be 0 → price will be "—"');
        console.log('   ⚠️  User must go to Design Studio and place panels first');
      } else {
        const l = layoutRows[0];
        console.log(`   ✅ Layout found: ${l.system_size_kw} kW, ${l.total_panels} panels, type: ${l.system_type}`);
        
        // Simulate price calculation
        const ppw = 3.10; // default
        const price = Math.round(l.system_size_kw * 1000 * ppw);
        console.log(`   💰 Live price would be: $${price.toLocaleString()} (${l.system_size_kw}kW × $${ppw}/W)`);
      }

      if (productionRows.length === 0) {
        console.log('   ❌ NO PRODUCTION — costEstimate will be undefined');
        console.log('   ⚠️  User must run production calculation first');
      } else {
        const pr = productionRows[0];
        const dj = pr.data_json;
        if (dj?.costEstimate?.cashPrice) {
          console.log(`   ✅ costEstimate.cashPrice = $${dj.costEstimate.cashPrice.toLocaleString()}`);
        } else {
          console.log('   ❌ data_json.costEstimate.cashPrice is MISSING');
          console.log(`   data_json keys: ${dj ? Object.keys(dj).join(', ') : 'null'}`);
        }
      }
    }
  } catch (e) {
    console.log(`❌ Simulation ERROR: ${e.message}`);
  }

  // ── 7. Simulate admin pricing POST ────────────────────────────────────────
  console.log('\n7. SIMULATE ADMIN PRICING SAVE (upsert test)');
  console.log('─────────────────────────────────────');
  try {
    // Read current value
    const before = await sql`SELECT price_per_watt FROM pricing_config LIMIT 1`;
    const beforeVal = before[0]?.price_per_watt ?? 'N/A';
    console.log(`   Before: price_per_watt = ${beforeVal}`);

    // Upsert with test value
    const testVal = 3.33;
    await sql`
      INSERT INTO pricing_config (price_per_watt, updated_at)
      VALUES (${testVal}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        price_per_watt = EXCLUDED.price_per_watt,
        updated_at = NOW()
    `;

    // Read back
    const after = await sql`SELECT price_per_watt FROM pricing_config LIMIT 1`;
    const afterVal = after[0]?.price_per_watt;
    if (afterVal == testVal) {
      console.log(`   ✅ Upsert works: price_per_watt = ${afterVal}`);
    } else {
      console.log(`   ❌ Upsert FAILED: expected ${testVal}, got ${afterVal}`);
    }

    // Restore original
    await sql`
      UPDATE pricing_config SET price_per_watt = ${beforeVal}, updated_at = NOW()
    `;
    console.log(`   ✅ Restored to ${beforeVal}`);
  } catch (e) {
    console.log(`❌ Upsert test ERROR: ${e.message}`);
    // Check if the ON CONFLICT needs a different target
    console.log('   Checking pricing_config schema...');
    try {
      const schema = await sql`
        SELECT column_name, data_type, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'pricing_config'
        ORDER BY ordinal_position
      `;
      console.log('   Columns:', schema.map(c => `${c.column_name}(${c.data_type})`).join(', '));
      
      const constraints = await sql`
        SELECT constraint_name, constraint_type 
        FROM information_schema.table_constraints 
        WHERE table_name = 'pricing_config'
      `;
      console.log('   Constraints:', constraints.map(c => `${c.constraint_name}(${c.constraint_type})`).join(', '));
    } catch (e2) {
      console.log(`   Schema check failed: ${e2.message}`);
    }
  }

  console.log('\n========================================');
  console.log('AUDIT COMPLETE');
  console.log('========================================\n');
}

audit().catch(console.error);