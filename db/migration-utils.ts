import postgres from 'postgres';
import path from 'path';
import fs from 'fs';
import { escapeSchemaName } from './script-utils';

export interface MigrationOptions {
  client: postgres.Sql;
  schemaName: string;
  migrationsFolder: string;
  logPrefix?: string;
}

/**
 * Applies migrations to a schema using manual SQL execution
 * Prevents Drizzle from creating unwanted "drizzle" schema
 */
export async function applyMigrations({
  client,
  schemaName,
  migrationsFolder,
  logPrefix = '',
}: MigrationOptions): Promise<void> {
  const escapedSchemaName = escapeSchemaName(schemaName);

  // Set search_path to target schema
  await client.unsafe(`SET search_path TO ${escapedSchemaName}, public`);

  // Verify search_path is set correctly
  const searchPathCheck = await client`SHOW search_path`;
  if (logPrefix) {
    console.log(`${logPrefix}Search path set to: ${searchPathCheck[0].search_path}`);
  }

  // Resolve migration paths
  const metaFolder = path.join(migrationsFolder, 'meta');
  const journalPath = path.join(metaFolder, '_journal.json');

  // Read migration journal to get list of migrations
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Migration journal not found at ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const migrations = journal.entries || [];

  if (migrations.length === 0) {
    if (logPrefix) {
      console.log(`${logPrefix}No migrations to apply`);
    }
    return;
  }

  // Create __drizzle_migrations table in target schema if it doesn't exist
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS ${escapedSchemaName}."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Check which migrations have already been applied
  const appliedMigrations = await client.unsafe(`
    SELECT hash FROM ${escapedSchemaName}."__drizzle_migrations"
  `);
  const appliedHashes = new Set(appliedMigrations.map((m: any) => m.hash));

  // Apply each migration that hasn't been applied yet
  let appliedCount = 0;
  for (const migration of migrations) {
    const migrationFile = path.join(migrationsFolder, `${migration.tag}.sql`);

    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found: ${migrationFile}`);
    }

    // Skip if already applied
    if (appliedHashes.has(migration.tag)) {
      if (logPrefix) {
        console.log(`${logPrefix}Skipping already applied migration: ${migration.tag}`);
      }
      continue;
    }

    if (logPrefix) {
      console.log(`${logPrefix}Applying migration: ${migration.tag}`);
    }

    // Read and execute SQL file
    // search_path is already set, so tables will be created in target schema
    const sql = fs.readFileSync(migrationFile, 'utf-8');

    // Execute SQL - search_path ensures tables are created in correct schema
    await client.unsafe(sql);

    // Record migration in __drizzle_migrations table
    await client.unsafe(`
      INSERT INTO ${escapedSchemaName}."__drizzle_migrations" (hash, created_at)
      VALUES ('${migration.tag}', ${Date.now()})
    `);

    appliedCount++;
  }

  if (logPrefix && appliedCount > 0) {
    console.log(`${logPrefix}Applied ${appliedCount} migration(s)`);
  }
}

