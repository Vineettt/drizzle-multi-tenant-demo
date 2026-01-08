import { sql } from 'drizzle-orm';
import postgres from 'postgres';

export function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Executes an async operation and measures its execution time
 * 
 * @param name - Name/description of the operation
 * @param operation - Async function to execute
 * @param showTiming - Whether to show timing (default: true)
 * @returns Result of the operation and execution time
 */
export async function timedOperation<T>(
  name: string,
  operation: () => Promise<T>,
  showTiming: boolean = true
): Promise<{ result: T; time: number }> {
  const start = performance.now();
  const result = await operation();
  const end = performance.now();
  const time = end - start;
  
  if (showTiming) {
    console.log(`   ⏱️  ${name}: ${formatTime(time)}`);
  }
  
  return { result, time };
}

type Connection = 
  | postgres.Sql 
  | { execute: (query: any) => Promise<any> };

function isPostgresClient(connection: Connection): connection is postgres.Sql {
  return typeof (connection as postgres.Sql).unsafe === 'function';
}

/**
 * Checks if a table exists in a schema
 * 
 * Works with both:
 * - Raw postgres client (`postgres.Sql`)
 * - Drizzle ORM (`{ execute: (query) => Promise<any> }`)
 * 
 * @param connection - Postgres client or Drizzle database instance
 * @param schemaName - Schema name (e.g., 'public')
 * @param tableName - Table name to check
 * @returns True if table exists, false otherwise
 * 
 * @example
 * ```typescript
 * // With postgres client
 * const client = createPostgresClient();
 * const exists = await tableExists(client, 'public', 'users');
 * 
 * // With Drizzle
 * const exists = await tableExists(masterDb, 'public', 'users');
 * ```
 */
export async function tableExists(
  connection: Connection,
  schemaName: string,
  tableName: string
): Promise<boolean> {
  try {
    if (isPostgresClient(connection)) {
      const result = await connection`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        )
      `;
      return result[0].exists;
    } else {
      const result = await connection.execute(sql`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        )
      `);
      return (result as any[])[0].exists;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Checks if migrations have been run by verifying a table exists
 * 
 * Exits with error message if migrations haven't been run.
 * 
 * @param connection - Postgres client or Drizzle database instance
 * @param schemaName - Schema name (e.g., 'public')
 * @param tableName - Table name that should exist after migrations
 * @param migrationCommand - Command to run migrations (e.g., 'pnpm db:migrate')
 * 
 * @example
 * ```typescript
 * // Multi-schema approach
 * await checkMigrations(client, 'public', 'schema_tracker', 'pnpm db:migrate');
 * 
 * // RLS approach
 * await checkMigrations(masterDb, 'public', 'organizations', 'pnpm db-rls:migrate');
 * ```
 */
export async function checkMigrations(
  connection: Connection,
  schemaName: string,
  tableName: string,
  migrationCommand: string
): Promise<void> {
  try {
    const exists = await tableExists(connection, schemaName, tableName);
    
    if (!exists) {
      console.error('❌ Error: Migrations have not been run.');
      console.error(`   The ${tableName} table does not exist in ${schemaName} schema.`);
      console.error('\n   Please run migrations first:');
      console.error(`   ${migrationCommand}\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error checking migrations:', error);
    console.error('\n   Please ensure migrations are run:');
    console.error(`   ${migrationCommand}\n`);
    process.exit(1);
  }
}
