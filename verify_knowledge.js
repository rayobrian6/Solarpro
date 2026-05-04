const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function verifyKnowledge() {
  await client.connect();
  
  console.log('=== SolarDog Knowledge Base Verification ===\n');
  
  // Check totals
  const totals = await client.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN is_global = TRUE THEN 1 ELSE 0 END) as global_count,
      COUNT(DISTINCT type) as types
    FROM solarpro_knowledge_items
  `);
  
  console.log(`Total items: ${totals.rows[0].total}`);
  console.log(`Global items: ${totals.rows[0].global_count}`);
  console.log(`Unique types: ${totals.rows[0].types}\n`);
  
  // Breakdown by type
  const byType = await client.query(`
    SELECT type, COUNT(*) as count, 
           SUM(CASE WHEN is_global = TRUE THEN 1 ELSE 0 END) as global_count
    FROM solarpro_knowledge_items
    GROUP BY type
    ORDER BY count DESC
  `);
  
  console.log('By type:');
  byType.rows.forEach(row => {
    console.log(`  ${row.type}: ${row.count.toString().padEnd(3)} (global: ${row.global_count})`);
  });
  
  // Sample items
  const samples = await client.query(`
    SELECT type, label, description
    FROM solarpro_knowledge_items
    LIMIT 3
  `);
  
  console.log('\nSample items:');
  samples.rows.forEach((row, i) => {
    console.log(`  ${i+1}. [${row.type}] ${row.label}`);
    console.log(`     ${row.description.substring(0, 60)}...`);
  });
  
  await client.end();
  console.log('\n✅ Verification complete!');
}

verifyKnowledge().catch(console.error);