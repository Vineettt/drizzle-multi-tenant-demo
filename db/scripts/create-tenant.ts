import 'dotenv/config';
import { createTenantSchemaWithMigrations, validateSchemaName } from '../tenant-schema';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { eq } from 'drizzle-orm';
import { getRequiredArg, handleScriptError, setSearchPath, createPostgresClient, findSchemaInTracker } from '../script-utils';

async function createTenant(schemaName: string) {
  try {
    // Validate schema name format
    validateSchemaName(schemaName);
    console.log(`✓ Schema name validated: ${schemaName}`);

    // Check if schema already exists in tracker
    const existing = await findSchemaInTracker(schemaName);

    if (existing) {
      console.error(`Error: Schema '${schemaName}' already exists in schema_tracker`);
      process.exit(1);
    }

    // Create tenant schema and apply migrations
    console.log(`Creating tenant schema: ${schemaName}...`);
    await createTenantSchemaWithMigrations(schemaName);
    console.log(`✓ Schema created and migrations applied: ${schemaName}`);

    // Insert into schema_tracker table
    await db.insert(schemaTracker).values({
      name: schemaName,
    });
    console.log(`✓ Schema registered in schema_tracker: ${schemaName}`);

    // Optional: Insert test data into dummy_table in tenant schema
    console.log('\nInserting test data...');
    const tenantClient = createPostgresClient();

    try {
      // Set search_path to tenant schema
      await setSearchPath(tenantClient, schemaName);

      // Insert test data
      const testData = await tenantClient`
        INSERT INTO dummy_table (name, value)
        VALUES ('test_entry', 'This is a test value')
        RETURNING id, name, value, created_at
      `;

      console.log('✓ Test data inserted:');
      console.log(JSON.stringify(testData[0], null, 2));

      // Query the data back
      const queriedData = await tenantClient`
        SELECT * FROM dummy_table ORDER BY created_at DESC LIMIT 1
      `;

      console.log('\n✓ Queried data from tenant schema:');
      console.log(JSON.stringify(queriedData[0], null, 2));
    } finally {
      await tenantClient.end();
    }

    console.log(`\n✓ Successfully created tenant schema: ${schemaName}`);
    process.exit(0);
  } catch (error) {
    handleScriptError(error, `Error creating tenant schema: ${schemaName}`);
  }
}

// Get schema name from command line arguments
const schemaName = getRequiredArg(process.argv[2], 'pnpm db:create:tenant <schema_name>');
createTenant(schemaName);

