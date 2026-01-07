import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemaPublic from './schema-public';
import path from 'path';
import { applyMigrations } from './migration-utils';
import { escapeSchemaName, createPostgresClient } from './script-utils';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

/**
 * Validates schema name format according to PostgreSQL rules
 * @param schemaName - The schema name to validate
 * @throws Error if schema name is invalid
 */
export function validateSchemaName(schemaName: string): void {
  if (!schemaName || typeof schemaName !== 'string') {
    throw new Error('Schema name must be a non-empty string');
  }

  // PostgreSQL identifier rules: max 63 characters
  if (schemaName.length > 63) {
    throw new Error('Schema name must be 63 characters or less');
  }

  // Check for valid identifier pattern (letters, digits, underscore, must start with letter or underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
    throw new Error(
      'Schema name must start with a letter or underscore and contain only letters, digits, and underscores'
    );
  }

  // Reserved PostgreSQL keywords (basic check)
  const reservedKeywords = [
    'public',
    'pg_catalog',
    'pg_toast',
    'information_schema',
    'pg_temp',
    'pg_toast_temp',
  ];
  if (reservedKeywords.includes(schemaName.toLowerCase())) {
    throw new Error(`Schema name cannot be a reserved PostgreSQL keyword: ${schemaName}`);
  }
}

/**
 * Creates a tenant schema and applies Drizzle migrations
 * @param schemaName - The name of the tenant schema to create
 * @throws Error if schema creation or migration fails
 */
export async function createTenantSchemaWithMigrations(
  schemaName: string
): Promise<void> {
  validateSchemaName(schemaName);

  const client = createPostgresClient();

  try {
    // Create schema using safe identifier quoting
    // Escape schema name to prevent SQL injection (double quotes for PostgreSQL identifiers)
    const escapedSchemaName = escapeSchemaName(schemaName);
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${escapedSchemaName}`);

    // Resolve tenant migrations path (separate from public migrations)
    const migrationsFolder = path.join(process.cwd(), 'db', 'migrations', 'tenant');

    // Apply migrations using shared utility
    // This prevents Drizzle from creating unwanted "drizzle" schema
    await applyMigrations({
      client,
      schemaName,
      migrationsFolder,
      logPrefix: '  ',
    });
    
    // Check what tables exist in the tenant schema
    const tablesInSchema = await client`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ${schemaName}
      ORDER BY table_name
    `;
    console.log(`Tables in schema ${schemaName}:`, tablesInSchema.map((t: any) => t.table_name));
    
    // Verify dummy_table was created in tenant schema
    const tableCheck = await client`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = ${schemaName} AND table_name = 'dummy_table'
      )
    `;
    
    if (!tableCheck[0].exists) {
      // Check if table exists in public schema (wrong location)
      const publicTableCheck = await client`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'dummy_table'
        )
      `;
      
      const errorMsg = `dummy_table was not created in tenant schema ${schemaName}. ` +
        `Migration execution may have failed. ` +
        `Tables found in schema: ${tablesInSchema.map((t: any) => t.table_name).join(', ')}`;
      
      if (publicTableCheck[0].exists) {
        throw new Error(errorMsg + ' Note: dummy_table exists in public schema instead.');
      }
      
      throw new Error(errorMsg);
    }
  } catch (error) {
    // Cleanup: drop schema if creation/migration failed
    try {
      const escapedSchemaName = escapeSchemaName(schemaName);
      await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
    } catch (cleanupError) {
      console.error(`Failed to cleanup schema ${schemaName}:`, cleanupError);
    }
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Migrates all tenant schemas listed in schema_tracker table
 * @returns Object with success and failure counts
 */
export async function migrateAllTenantSchemas(): Promise<{
  success: number;
  failures: number;
  errors: Array<{ schema: string; error: string }>;
}> {
  const client = createPostgresClient();
  const db = drizzle(client, { schema: { ...schemaPublic } });

  const results = {
    success: 0,
    failures: 0,
    errors: [] as Array<{ schema: string; error: string }>,
  };

  try {
    // Query all schema names from schema_tracker
    const schemas = await db.select({ name: schemaPublic.schemaTracker.name }).from(schemaPublic.schemaTracker);

    if (schemas.length === 0) {
      console.log('No tenant schemas found in schema_tracker');
      return results;
    }

    console.log(`Found ${schemas.length} tenant schema(s) to migrate`);

    // Migrate each schema sequentially
    for (const { name } of schemas) {
      try {
        console.log(`Migrating schema: ${name}`);
        await createTenantSchemaWithMigrations(name);
        results.success++;
        console.log(`✓ Successfully migrated schema: ${name}`);
      } catch (error) {
        results.failures++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.errors.push({ schema: name, error: errorMessage });
        console.error(`✗ Failed to migrate schema ${name}:`, errorMessage);
      }
    }

    console.log(
      `\nMigration summary: ${results.success} succeeded, ${results.failures} failed`
    );
  } finally {
    await client.end();
  }

  return results;
}

