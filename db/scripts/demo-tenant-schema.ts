import 'dotenv/config';
import { createTenantSchemaWithMigrations } from '../tenant-schema';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { eq } from 'drizzle-orm';
import { createPostgresClient, handleScriptError, setSearchPath, escapeSchemaName } from '../script-utils';
import { timedOperation, formatTime } from '../../shared/db-utils';

const TEST_SCHEMA_NAME = 'demo_tenant_001';

// Check for --timing flag
const args = process.argv.slice(2);
const showTiming = args.includes('--timing') || args.includes('-t');

async function demo() {
  const demoStartTime = performance.now();
  console.log('=== Tenant Schema Demo ===\n');
  if (showTiming) {
    console.log('⏱️  Timing enabled (use --timing or -t flag)\n');
  }

  const client = createPostgresClient();

  try {
    // Cleanup: Drop existing demo schema if it exists (from previous runs)
    console.log(`Cleaning up any existing '${TEST_SCHEMA_NAME}' schema...`);
    try {
      const escapedSchemaName = escapeSchemaName(TEST_SCHEMA_NAME);
      await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
      // Also remove from tracker if it exists
      await db.delete(schemaTracker).where(eq(schemaTracker.name, TEST_SCHEMA_NAME));
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    console.log('✓ Cleanup complete\n');

    // Step 1: Create test tenant schema
    console.log(`Step 1: Creating test tenant schema '${TEST_SCHEMA_NAME}'...`);
    const { time: schemaCreateTime } = await timedOperation(
      'Create tenant schema with migrations',
      async () => await createTenantSchemaWithMigrations(TEST_SCHEMA_NAME),
      showTiming
    );
    console.log(`✓ Schema created: ${TEST_SCHEMA_NAME}\n`);

    // Step 2: Insert into schema_tracker table
    console.log('Step 2: Registering schema in schema_tracker...');
    const { time: registerTime } = await timedOperation(
      'Register schema in schema_tracker',
      async () => await db.insert(schemaTracker).values({
        name: TEST_SCHEMA_NAME,
      }),
      showTiming
    );
    console.log(`✓ Schema registered in schema_tracker\n`);

    // Step 3: Insert test data into dummy_table in tenant schema
    console.log('Step 3: Inserting test data into dummy_table...');
    await setSearchPath(client, TEST_SCHEMA_NAME);

    const { result: insertResult, time: insertTime } = await timedOperation(
      'Insert test data',
      async () => await client`
        INSERT INTO dummy_table (name, value)
        VALUES 
          ('demo_item_1', 'First test item'),
          ('demo_item_2', 'Second test item'),
          ('demo_item_3', 'Third test item')
        RETURNING id, name, value, created_at
      `,
      showTiming
    );

    console.log(`✓ Inserted ${insertResult.length} test records:`);
    insertResult.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name}: ${row.value} (ID: ${row.id})`);
    });
    console.log();

    // Step 4: Query the data back from tenant schema
    console.log('Step 4: Querying data from tenant schema...');
    const { result: queriedData, time: queryTime } = await timedOperation(
      'Query dummy_table',
      async () => await client`
        SELECT * FROM dummy_table ORDER BY created_at DESC
      `,
      showTiming
    );

    console.log(`✓ Retrieved ${queriedData.length} records:`);
    queriedData.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name}: ${row.value}`);
      console.log(`     Created: ${row.created_at}`);
    });
    console.log();

    // Step 5: List all schemas from schema_tracker
    console.log('Step 5: Listing all schemas from schema_tracker...');
    const { result: allSchemas, time: listTime } = await timedOperation(
      'List schemas from schema_tracker',
      async () => await db.select().from(schemaTracker),
      showTiming
    );

    console.log(`✓ Found ${allSchemas.length} schema(s) in tracker:`);
    allSchemas.forEach((schema, index) => {
      console.log(`  ${index + 1}. ${schema.name} (ID: ${schema.id})`);
    });
    console.log();

    // Step 6: Cleanup - drop demo schema
    console.log('Step 6: Cleaning up demo schema...');
    try {
      const escapedSchemaName = escapeSchemaName(TEST_SCHEMA_NAME);
      await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
      await db.delete(schemaTracker).where(eq(schemaTracker.name, TEST_SCHEMA_NAME));
      console.log(`✓ Demo schema '${TEST_SCHEMA_NAME}' dropped and removed from tracker\n`);
    } catch (cleanupError) {
      console.warn(`⚠ Warning: Failed to cleanup demo schema: ${cleanupError}`);
      console.log(`  You can manually drop it with: pnpm db:drop:tenant ${TEST_SCHEMA_NAME}\n`);
    }

    const demoEndTime = performance.now();
    const totalTime = demoEndTime - demoStartTime;
    
    console.log('=== Demo completed successfully! ===');
    if (showTiming) {
      console.log(`\n⏱️  Total execution time: ${formatTime(totalTime)}`);
    }
    process.exit(0);
  } catch (error) {
    handleScriptError(error, 'Demo failed');
  } finally {
    await client.end();
  }
}

demo();

