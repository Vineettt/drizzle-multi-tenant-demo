import 'dotenv/config';
import { createPostgresClient, handleScriptError, getRequiredArg, validateSchemaExists, getTablesInSchema } from '../script-utils';
import { applyMigrations } from '../migration-utils';
import path from 'path';

async function migrateTenant(schemaName: string) {
  const client = createPostgresClient();

  try {
    // Validate schema exists in tracker and database
    await validateSchemaExists(client, schemaName, {
      requireInTracker: true,
      requireInDatabase: true,
      action: 'migrate',
    });

    console.log(`Migrating tenant schema: ${schemaName}\n`);

    // Apply migrations to the tenant schema
    const migrationsFolder = path.join(process.cwd(), 'db', 'migrations', 'tenant');

    await applyMigrations({
      client,
      schemaName,
      migrationsFolder,
      logPrefix: '  ',
    });

    // Verify tables exist
    const tables = await getTablesInSchema(client, schemaName);

    console.log(`\n✓ Migration completed successfully`);
    console.log(`✓ Tables in schema ${schemaName}:`, tables.join(', ') || 'none');
    process.exit(0);
  } catch (error) {
    handleScriptError(error, `Error migrating tenant schema: ${schemaName}`);
  } finally {
    await client.end();
  }
}

// Get schema name from command line arguments
const schemaName = getRequiredArg(process.argv[2], 'pnpm db:migrate:tenant <schema_name>');
migrateTenant(schemaName);

