import 'dotenv/config';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { handleScriptError } from '../script-utils';

async function listTenants() {
  try {
    console.log('Fetching tenant schemas from schema_tracker...\n');

    const schemas = await db.select().from(schemaTracker).orderBy(schemaTracker.name);

    if (schemas.length === 0) {
      console.log('No tenant schemas found in schema_tracker.');
      process.exit(0);
    }

    console.log(`Found ${schemas.length} tenant schema(s):\n`);
    console.log('┌─────────────────────────────────────────────────┬──────────────────────────────────────┐');
    console.log('│ Schema Name                                      │ ID                                   │');
    console.log('├─────────────────────────────────────────────────┼──────────────────────────────────────┤');

    schemas.forEach((schema) => {
      const name = schema.name.padEnd(47);
      const id = schema.id;
      console.log(`│ ${name} │ ${id} │`);
    });

    console.log('└─────────────────────────────────────────────────┴──────────────────────────────────────┘');
    console.log(`\nTotal: ${schemas.length} schema(s)`);
    process.exit(0);
  } catch (error) {
    handleScriptError(error, 'Error listing tenant schemas');
  }
}

listTenants();

