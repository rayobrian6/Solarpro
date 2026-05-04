const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function checkTableSchema() {
  await client.connect();
  
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'solarpro_knowledge_items'
    ORDER BY ordinal_position
  `);
  
  console.log('Current table schema:');
  console.table(result.rows);
  
  // Also check if table exists
  const tableExists = await client.query(`
    SELECT to_regclass('public.solarpro_knowledge_items') as exists
  `);
  console.log('\nTable exists:', tableExists.rows[0].exists);
  
  await client.end();
}

checkTableSchema().catch(console.error);