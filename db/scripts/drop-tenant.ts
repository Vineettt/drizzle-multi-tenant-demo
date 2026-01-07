import 'dotenv/config';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { eq } from 'drizzle-orm';
import { getRequiredArg, handleScriptError, escapeSchemaName, createPostgresClient, findSchemaInTracker } from '../script-utils';

async function dropTenant(schemaName: string) {
  const client = createPostgresClient();

  try {
    console.log(`Dropping tenant schema: ${schemaName}...\n`);

    // Check if schema exists in tracker
    const existing = await findSchemaInTracker(schemaName);

    if (!existing) {
      console.warn(`Warning: Schema '${schemaName}' not found in schema_tracker.`);
      console.log('Proceeding with schema drop anyway...\n');
    }

    // Drop the schema
    const escapedSchemaName = escapeSchemaName(schemaName);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
    console.log(`✓ Schema dropped: ${schemaName}`);

    // Remove from schema_tracker
    if (existing) {
      await db.delete(schemaTracker).where(eq(schemaTracker.name, schemaName));
      console.log(`✓ Removed from schema_tracker: ${schemaName}`);
    }

    console.log(`\n✓ Successfully dropped tenant schema: ${schemaName}`);
    process.exit(0);
  } catch (error) {
    handleScriptError(error, `Error dropping tenant schema: ${schemaName}`);
  } finally {
    await client.end();
  }
}

// Get schema name from command line arguments
const schemaName = getRequiredArg(process.argv[2], 'pnpm db:drop:tenant <schema_name>');
dropTenant(schemaName);

