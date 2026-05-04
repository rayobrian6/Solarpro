const { Client } = require('pg');

async function testKnowledgeLoading() {
  const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
  });

  try {
    await client.connect();
    console.log('✓ Connected to database\n');

    // Simulate the solardogKnowledgeGet() function with a dummy userId
    const userId = 'test-user-123';
    console.log(`Testing knowledge query with userId: ${userId}\n`);

    // Query all knowledge items (matching the actual solardogKnowledgeGet logic)
    const result = await client.query(`
      SELECT * FROM solarpro_knowledge_items
      WHERE (user_id = $1 OR is_global = TRUE)
      ORDER BY type ASC, label ASC
    `, [userId]);

    console.log(`✓ Query returned ${result.rows.length} knowledge items\n`);

    if (result.rows.length === 0) {
      console.log('❌ NO KNOWLEDGE ITEMS FOUND - This is the bug!');
      return;
    }

    // Format the knowledge items like SolarDog does
    const knowledgeItemsStr = result.rows.map(k => 
      `   [${k.type}] ${k.label}${k.route ? ' (' + k.route + ')' : ''}: ${k.description}` +
      (k.aliases && k.aliases.length > 0 ? ` | aliases: ${k.aliases.join(', ')}` : '')
    ).join('\n');

    console.log('Knowledge items that would be injected into SolarDog prompts:');
    console.log('========================================');
    console.log(knowledgeItemsStr);
    console.log('========================================\n');

    console.log('✅ SUCCESS! SolarDog now has access to all knowledge items!');
    console.log(`   - ${result.rows.filter(r => r.type === 'page').length} pages`);
    console.log(`   - ${result.rows.filter(r => r.type === 'button').length} buttons`);
    console.log(`   - ${result.rows.filter(r => r.type === 'workflow').length} workflows`);
    console.log(`   - ${result.rows.filter(r => r.type === 'warning').length} warnings`);
    console.log(`   - ${result.rows.filter(r => r.type === 'mode').length} modes`);
    console.log(`   - ${result.rows.filter(r => r.type === 'equipment').length} equipment types`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testKnowledgeLoading();