const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function checkIsGlobal() {
  await client.connect();
  
  const result = await client.query('SELECT COUNT(*) as total, SUM(CASE WHEN is_global = TRUE THEN 1 ELSE 0 END) as global_count FROM solarpro_knowledge_items');
  console.log('Total items:', result.rows[0].total);
  console.log('Global items:', result.rows[0].global_count);
  console.log('Non-global items:', parseInt(result.rows[0].total) - parseInt(result.rows[0].global_count));
  
  // Show all non-global items if any
  if (parseInt(result.rows[0].global_count) < parseInt(result.rows[0].total)) {
    const nonGlobal = await client.query('SELECT type, label FROM solarpro_knowledge_items WHERE is_global = FALSE OR is_global IS NULL');
    console.log('\nNon-global items:');
    nonGlobal.rows.forEach(row => {
      console.log(`  [${row.type}] ${row.label}`);
    });
  }
  
  await client.end();
}

checkIsGlobal().catch(console.error);