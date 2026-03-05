import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require');

async function run() {
  try {
    console.log('Running Migration 002: Add lat/lng to projects...');
    
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`;
    console.log('✓ Added lat column');
    
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`;
    console.log('✓ Added lng column');
    
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_lat_lng ON projects(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL`;
    console.log('✓ Created spatial index');
    
    // Verify columns exist
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'projects' 
      ORDER BY ordinal_position
    `;
    console.log('\nProjects table columns:');
    cols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));
    
    console.log('\n✅ Migration 002 complete');
  } catch(e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  }
}

run();