import 'dotenv/config';
import { createPostgresClient, handleScriptError, tableExistsInSchema } from '../script-utils';

/**
 * Cleanup script to drop all tenant schemas and public tables
 * 
 * Usage:
 *   pnpm db:cleanup:drop   - Drop all tenant schemas and public tables (complete reset)
 */

async function dropAllTenantSchemas(client: ReturnType<typeof createPostgresClient>) {
  console.log('🗑️  Dropping all tenant schemas...');
  
  try {
    // Get all non-system schemas from the database directly
    // This ensures we drop all tenant schemas, even if they're not in schema_tracker
    const allSchemas = await client`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
        AND schema_name NOT LIKE 'pg_temp_%'
        AND schema_name NOT LIKE 'pg_toast_temp_%'
      ORDER BY schema_name
    `;
    
    // Filter out 'public' schema (we'll handle public tables separately)
    const tenantSchemas = allSchemas
      .map((s: any) => s.schema_name)
      .filter((name: string) => name !== 'public');
    
    if (tenantSchemas.length === 0) {
      console.log('   ℹ️  No tenant schemas found in database');
    } else {
      console.log(`   Found ${tenantSchemas.length} tenant schema(s) in database`);
      
      // Drop each tenant schema
      let droppedCount = 0;
      for (const schemaName of tenantSchemas) {
        const escapedSchemaName = `"${schemaName.replace(/"/g, '""')}"`;
        try {
          await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
          console.log(`   ✓ Dropped schema: ${schemaName}`);
          droppedCount++;
        } catch (error) {
          // Schema might not exist or might be in use - log and continue
          console.log(`   ⚠️  Could not drop schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log(`\n   Dropped ${droppedCount} of ${tenantSchemas.length} tenant schema(s)`);
    }
    
    // Clear schema_tracker if it exists (for cleanup)
    const trackerExists = await tableExistsInSchema(client, 'public', 'schema_tracker');
    if (trackerExists) {
      try {
        await client.unsafe(`DELETE FROM schema_tracker`);
        console.log('   ✓ Cleared schema_tracker');
      } catch (error) {
        // Table might have been dropped already - that's okay
        console.log('   ℹ️  Could not clear schema_tracker (may have been dropped)');
      }
    }
    
    console.log('\n✅ Tenant schema cleanup completed');
  } catch (error) {
    console.error('❌ Error dropping tenant schemas:', error);
    throw error;
  }
}

async function dropPublicTables(client: ReturnType<typeof createPostgresClient>) {
  console.log('🗑️  Dropping public schema tables...');
  
  try {
    let droppedAny = false;
    
    // Drop schema_tracker if it exists
    const trackerExists = await tableExistsInSchema(client, 'public', 'schema_tracker');
    if (trackerExists) {
      await client.unsafe(`DROP TABLE IF EXISTS schema_tracker CASCADE`);
      console.log('   ✓ Dropped schema_tracker table');
      droppedAny = true;
    } else {
      console.log('   ℹ️  schema_tracker table does not exist');
    }
    
    // Drop migration tracking table if it exists
    const migrationsExists = await tableExistsInSchema(client, 'public', '__drizzle_migrations');
    if (migrationsExists) {
      await client.unsafe(`DROP TABLE IF EXISTS __drizzle_migrations CASCADE`);
      console.log('   ✓ Dropped __drizzle_migrations table');
      droppedAny = true;
    } else {
      console.log('   ℹ️  __drizzle_migrations table does not exist');
    }
    
    if (droppedAny) {
      console.log('\n✅ All public tables dropped successfully');
    } else {
      console.log('\n✅ No public tables to drop');
    }
  } catch (error) {
    console.error('❌ Error dropping public tables:', error);
    throw error;
  }
}

async function cleanup() {
  const args = process.argv.slice(2);
  const dropTables = args.includes('--drop') || args.includes('-d');
  
  if (!dropTables) {
    console.error('❌ Error: This script only supports drop mode');
    console.log('Usage: pnpm db:cleanup:drop');
    process.exit(1);
  }
  
  console.log('=== Database Cleanup Script (Drop Mode) ===\n');
  console.log('⚠️  WARNING: This will DROP all tenant schemas and public tables');
  console.log('   You will need to run migrations again after this.\n');
  
  const client = createPostgresClient();
  
  try {
    // Drop all tenant schemas
    await dropAllTenantSchemas(client);
    
    // Drop public schema tables
    await dropPublicTables(client);
    
    console.log('\n✅ Cleanup complete');
    console.log('⚠️  Note: You will need to run migrations again:');
    console.log('   - pnpm db:migrate (for public schema)');
    console.log('   - pnpm db:migrate:tenants (for tenant schemas)');
  } catch (error) {
    handleScriptError(error, 'Cleanup failed');
  } finally {
    await client.end();
  }
}

// Run cleanup if executed directly
if (require.main === module) {
  cleanup();
}

export { cleanup };
