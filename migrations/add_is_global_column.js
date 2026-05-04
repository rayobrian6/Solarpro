const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function addMissingColumns() {
  await client.connect();
  
  console.log('Adding missing columns to solarpro_knowledge_items table...');
  
  try {
    // Add is_global column
    await client.query(`
      ALTER TABLE solarpro_knowledge_items
      ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE
    `);
    console.log('✓ Added is_global column');
    
    // Add user_id column
    await client.query(`
      ALTER TABLE solarpro_knowledge_items
      ADD COLUMN IF NOT EXISTS user_id TEXT
    `);
    console.log('✓ Added user_id column');
    
    // Set all existing rows to is_global = TRUE
    const result = await client.query(`
      UPDATE solarpro_knowledge_items
      SET is_global = TRUE
      WHERE is_global = FALSE OR is_global IS NULL
    `);
    console.log(`✓ Set ${result.rowCount} existing rows to is_global = TRUE`);
    
    // Verify the changes
    const schemaCheck = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'solarpro_knowledge_items'
        AND column_name IN ('is_global', 'user_id')
      ORDER BY ordinal_position
    `);
    
    console.log('\nUpdated columns:');
    console.table(schemaCheck.rows);
    
    const countCheck = await client.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN is_global = TRUE THEN 1 ELSE 0 END) as global_count
      FROM solarpro_knowledge_items
    `);
    
    console.log(`\nTotal items: ${countCheck.rows[0].total}`);
    console.log(`Global items: ${countCheck.rows[0].global_count}`);
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

addMissingColumns().catch(console.error);