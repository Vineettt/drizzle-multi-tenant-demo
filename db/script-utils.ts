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

