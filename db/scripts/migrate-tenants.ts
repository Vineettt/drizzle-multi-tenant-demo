import 'dotenv/config';
import { migrateAllTenantSchemas } from '../tenant-schema';
import { handleScriptError } from '../script-utils';

async function main() {
  console.log('Starting tenant schema migrations...\n');

  try {
    const results = await migrateAllTenantSchemas();

    if (results.failures > 0) {
      console.error('\nSome migrations failed:');
      results.errors.forEach(({ schema, error }) => {
        console.error(`  - ${schema}: ${error}`);
      });
      process.exit(1);
    }

    if (results.success === 0) {
      console.log('No tenant schemas found to migrate.');
      process.exit(0);
    }

    console.log('\n✓ All tenant schema migrations completed successfully');
    process.exit(0);
  } catch (error) {
    handleScriptError(error, 'Fatal error during migration');
  }
}

main();

