import postgres from 'postgres';
import { db } from './db';
import { schemaTracker } from './schema';
import { eq } from 'drizzle-orm';

/**
 * Creates a postgres client with standard configuration
 */
export function createPostgresClient(): postgres.Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return postgres(process.env.DATABASE_URL!, { max: 1 });
}

/**
 * Escapes schema name for safe use in SQL queries
 */
export function escapeSchemaName(schemaName: string): string {
  if (schemaName === 'public') {
    return 'public';
  }
  return `"${schemaName.replace(/"/g, '""')}"`;
}

/**
 * Validates and gets command line argument
 */
export function getRequiredArg(
  arg: string | undefined,
  usage: string
): string {
  if (!arg) {
    console.error('Error: Argument is required');
    console.log(`Usage: ${usage}`);
    process.exit(1);
  }
  return arg;
}

/**
 * Handles script errors with consistent formatting
 */
export function handleScriptError(error: unknown, context: string): never {
  console.error(`\n✗ ${context}`);
  if (error instanceof Error) {
    console.error(`  ${error.message}`);
  } else {
    console.error(`  ${String(error)}`);
  }
  process.exit(1);
}

/**
 * Sets search_path for a schema
 */
export async function setSearchPath(
  client: postgres.Sql,
  schemaName: string
): Promise<void> {
  const escapedSchemaName = escapeSchemaName(schemaName);
  await client.unsafe(`SET search_path TO ${escapedSchemaName}, public`);
}

/**
 * Checks if a schema exists in schema_tracker
 */
export async function findSchemaInTracker(schemaName: string) {
  const existing = await db
    .select()
    .from(schemaTracker)
    .where(eq(schemaTracker.name, schemaName))
    .limit(1);
  return existing.length > 0 ? existing[0] : null;
}

/**
 * Checks if a schema exists in the database
 */
export async function schemaExistsInDatabase(
  client: postgres.Sql,
  schemaName: string
): Promise<boolean> {
  const result = await client`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.schemata 
      WHERE schema_name = ${schemaName}
    )
  `;
  return result[0].exists;
}

/**
 * Checks if a table exists in a schema
 */
export async function tableExistsInSchema(
  client: postgres.Sql,
  schemaName: string,
  tableName: string
): Promise<boolean> {
  const result = await client`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = ${schemaName} AND table_name = ${tableName}
    )
  `;
  return result[0].exists;
}

/**
 * Gets all tables in a schema (excluding system tables)
 */
export async function getTablesInSchema(
  client: postgres.Sql,
  schemaName: string,
  excludeTables: string[] = ['__drizzle_migrations']
): Promise<string[]> {
  const excludeList = excludeTables.map((t) => `'${t}'`).join(', ');
  const tables = await client.unsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = '${schemaName}'
    ${excludeTables.length > 0 ? `AND table_name NOT IN (${excludeList})` : ''}
    ORDER BY table_name
  `);
  return tables.map((t: any) => t.table_name);
}

/**
 * Validates that a schema exists in tracker and database, with helpful error messages
 */
export async function validateSchemaExists(
  client: postgres.Sql,
  schemaName: string,
  options: {
    requireInTracker?: boolean;
    requireInDatabase?: boolean;
    action?: string; // e.g., "migrate", "drop"
  } = {}
): Promise<{
  inTracker: boolean;
  inDatabase: boolean;
}> {
  const {
    requireInTracker = false,
    requireInDatabase = false,
    action = 'perform this operation',
  } = options;

  const inTracker = (await findSchemaInTracker(schemaName)) !== null;
  const inDatabase = await schemaExistsInDatabase(client, schemaName);

  if (requireInTracker && !inTracker) {
    console.error(`Error: Schema '${schemaName}' not found in schema_tracker`);
    console.log(`Available schemas can be listed with: pnpm db:list:tenants`);
    process.exit(1);
  }

  if (requireInDatabase && !inDatabase) {
    console.error(`Error: Schema '${schemaName}' does not exist in database`);
    if (action === 'migrate') {
      console.log(`Create it with: pnpm db:create:tenant ${schemaName}`);
    }
    process.exit(1);
  }

  return { inTracker, inDatabase };
}

/**
 * Gets expected migrations from migration journal
 */
export function getExpectedMigrations(migrationsFolder: string): string[] {
  const path = require('path');
  const fs = require('fs');
  const metaFolder = path.join(migrationsFolder, 'meta');
  const journalPath = path.join(metaFolder, '_journal.json');

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Migration journal not found at ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const migrations = journal.entries || [];
  return migrations.map((m: any) => m.tag);
}

/**
 * Gets applied migrations for a schema
 */
export async function getAppliedMigrations(
  client: postgres.Sql,
  schemaName: string
): Promise<string[]> {
  const escapedSchemaName = escapeSchemaName(schemaName);
  const appliedMigrations = await client.unsafe(`
    SELECT hash FROM ${escapedSchemaName}."__drizzle_migrations"
    ORDER BY id
  `);
  return appliedMigrations.map((m: any) => m.hash);
}

