import 'dotenv/config';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { createPostgresClient, handleScriptError, setSearchPath, schemaExistsInDatabase, tableExistsInSchema, getExpectedMigrations, getAppliedMigrations } from '../script-utils';
import path from 'path';

async function healthCheck() {
  const client = createPostgresClient();
  const results = {
    totalSchemas: 0,
    healthySchemas: [] as string[],
    unhealthySchemas: [] as Array<{ schema: string; issue: string }>,
    orphanedSchemas: [] as string[],
  };

  try {
    console.log('=== Tenant Schema Health Check ===\n');

    // Get all tracked schemas
    const trackedSchemas = await db.select().from(schemaTracker);
    results.totalSchemas = trackedSchemas.length;

    console.log(`Found ${trackedSchemas.length} tracked schema(s)\n`);

    // Get expected migrations from journal
    const tenantMigrationsFolder = path.join(process.cwd(), 'db', 'migrations', 'tenant');
    let expectedMigrations: string[] = [];
    try {
      expectedMigrations = getExpectedMigrations(tenantMigrationsFolder);
      console.log(`Expected tenant migrations: ${expectedMigrations.length}`);
      if (expectedMigrations.length > 0) {
        console.log(`  ${expectedMigrations.join(', ')}\n`);
      } else {
        console.log('  (no migrations)\n');
      }
    } catch (error) {
      console.warn(`Warning: Could not read migration journal: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // Check each tracked schema
    for (const { name } of trackedSchemas) {
      try {
        // Check if schema exists
        const schemaExists = await schemaExistsInDatabase(client, name);

        if (!schemaExists) {
          results.unhealthySchemas.push({
            schema: name,
            issue: 'Schema does not exist in database',
          });
          console.log(`✗ ${name}: Schema does not exist`);
          continue;
        }

        // Check if dummy_table exists in schema
        await setSearchPath(client, name);
        const tableExists = await tableExistsInSchema(client, name, 'dummy_table');

        if (!tableExists) {
          results.unhealthySchemas.push({
            schema: name,
            issue: 'dummy_table does not exist',
          });
          console.log(`✗ ${name}: dummy_table missing`);
          continue;
        }

        // Check migration status - verify all expected migrations are applied
        try {
          // Check if __drizzle_migrations table exists in tenant schema
          const migrationsTableExists = await tableExistsInSchema(client, name, '__drizzle_migrations');
          
          if (!migrationsTableExists) {
            results.unhealthySchemas.push({
              schema: name,
              issue: '__drizzle_migrations table does not exist',
            });
            console.log(`✗ ${name}: Migration tracking table missing`);
            continue;
          }

          // Get applied migrations for this schema
          const appliedMigrations = await getAppliedMigrations(client, name);
          const appliedSet = new Set(appliedMigrations);
          const expectedSet = new Set(expectedMigrations);

          // Check for missing migrations
          const missingMigrations = expectedMigrations.filter((m) => !appliedSet.has(m));
          // Check for extra migrations (shouldn't happen, but good to detect)
          const extraMigrations = appliedMigrations.filter((m) => !expectedSet.has(m));

          if (missingMigrations.length > 0 || extraMigrations.length > 0) {
            const issues: string[] = [];
            if (missingMigrations.length > 0) {
              issues.push(`Missing migrations: ${missingMigrations.join(', ')}`);
            }
            if (extraMigrations.length > 0) {
              issues.push(`Extra migrations: ${extraMigrations.join(', ')}`);
            }
            results.unhealthySchemas.push({
              schema: name,
              issue: `Migration mismatch: ${issues.join('; ')}`,
            });
            console.log(`✗ ${name}: ${issues.join('; ')}`);
            continue;
          }

          // All migrations match
          if (expectedMigrations.length > 0) {
            console.log(`✓ ${name}: All ${expectedMigrations.length} migration(s) applied`);
          }
        } catch (migrationError) {
          results.unhealthySchemas.push({
            schema: name,
            issue: `Migration check failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
          });
          console.log(`✗ ${name}: Migration check failed`);
          continue;
        }

        results.healthySchemas.push(name);
        console.log(`✓ ${name}: Healthy`);
      } catch (error) {
        results.unhealthySchemas.push({
          schema: name,
          issue: error instanceof Error ? error.message : String(error),
        });
        console.log(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Check for orphaned schemas (exist in DB but not in tracker)
    console.log('\nChecking for orphaned schemas...');
    const allSchemas = await client`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1', 'public')
      AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name
    `;

    const trackedNames = new Set(trackedSchemas.map((s) => s.name));
    for (const row of allSchemas) {
      if (!trackedNames.has(row.schema_name)) {
        results.orphanedSchemas.push(row.schema_name);
      }
    }

    if (results.orphanedSchemas.length > 0) {
      console.log(`Found ${results.orphanedSchemas.length} orphaned schema(s):`);
      results.orphanedSchemas.forEach((name) => {
        console.log(`  - ${name}`);
      });
    } else {
      console.log('No orphaned schemas found');
    }

    // Summary
    console.log('\n=== Health Check Summary ===');
    console.log(`Total tracked schemas: ${results.totalSchemas}`);
    console.log(`Healthy: ${results.healthySchemas.length}`);
    console.log(`Unhealthy: ${results.unhealthySchemas.length}`);
    console.log(`Orphaned: ${results.orphanedSchemas.length}`);

    if (results.unhealthySchemas.length > 0) {
      console.log('\nUnhealthy schemas:');
      results.unhealthySchemas.forEach(({ schema, issue }) => {
        console.log(`  - ${schema}: ${issue}`);
      });
    }

    if (results.orphanedSchemas.length > 0) {
      console.log('\nOrphaned schemas (exist in DB but not tracked):');
      results.orphanedSchemas.forEach((name) => {
        console.log(`  - ${name}`);
      });
    }

    // Exit with error code if issues found
    if (results.unhealthySchemas.length > 0 || results.orphanedSchemas.length > 0) {
      process.exit(1);
    }

    console.log('\n✓ All schemas are healthy!');
    process.exit(0);
  } catch (error) {
    handleScriptError(error, 'Health check failed');
  } finally {
    await client.end();
  }
}

healthCheck();

