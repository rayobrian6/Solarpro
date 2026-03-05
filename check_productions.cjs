const { neon } = require('@neondatabase/serverless');
const DATABASE_URL = 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require';

async function check() {
  const sql = neon(DATABASE_URL);
  
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'productions' AND table_schema = 'public'
    ORDER BY ordinal_position
  `;
  console.log('productions columns:');
  cols.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));

  // Check unique constraint
  const constraints = await sql`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conrelid = 'productions'::regclass
  `;
  console.log('\nproductions constraints:');
  constraints.forEach(c => console.log(`  - ${c.conname} (${c.contype})`));
}

check().catch(console.error);