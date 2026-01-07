import 'dotenv/config';
import path from 'path';
import { applyMigrations } from '../migration-utils';
import { createPostgresClient, handleScriptError } from '../script-utils';

async function migratePublic() {
  const client = createPostgresClient();

  try {
    console.log('Applying migrations to public schema (schema_tracker only)...\n');

    // Resolve public migrations path
    const migrationsFolder = path.join(process.cwd(), 'db', 'migrations', 'public');

    // Apply migrations using shared utility
    await applyMigrations({
      client,
      schemaName: 'public',
      migrationsFolder,
      logPrefix: '  ',
    });

    console.log('\n✓ Public schema migrations applied successfully');
    console.log('✓ Only schema_tracker table exists in public schema');
  } catch (error) {
    handleScriptError(error, 'Error applying public schema migrations');
  } finally {
    await client.end();
  }
}

migratePublic();
