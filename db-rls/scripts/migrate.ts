import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Migration script for RLS approach
 * 
 * Checks if migrations have been generated before attempting to apply them.
 * Provides helpful error messages if migrations are missing.
 */
async function migrate() {
  if (!process.env.DATABASE_URL_ADMIN) {
    console.error('❌ Error: DATABASE_URL_ADMIN environment variable is required');
    process.exit(1);
  }

  const migrationsFolder = path.join(process.cwd(), 'db-rls', 'migrations');
  const metaFolder = path.join(migrationsFolder, 'meta');
  const journalPath = path.join(metaFolder, '_journal.json');

  // Check if migrations folder exists
  if (!fs.existsSync(migrationsFolder)) {
    console.error('❌ Error: Migrations folder does not exist.');
    console.error(`   Expected: ${migrationsFolder}`);
    console.error('\n   Please generate migrations first:');
    console.error('   pnpm db-rls:generate\n');
    process.exit(1);
  }

  // Check if meta folder exists
  if (!fs.existsSync(metaFolder)) {
    console.error('❌ Error: Migration metadata folder does not exist.');
    console.error(`   Expected: ${metaFolder}`);
    console.error('\n   Please generate migrations first:');
    console.error('   pnpm db-rls:generate\n');
    process.exit(1);
  }

  // Check if journal file exists
  if (!fs.existsSync(journalPath)) {
    console.error('❌ Error: Migration journal file not found.');
    console.error(`   Expected: ${journalPath}`);
    console.error('\n   This usually means migrations have not been generated yet.');
    console.error('\n   Please generate migrations first:');
    console.error('   pnpm db-rls:generate\n');
    process.exit(1);
  }

  // Check if journal has any migrations
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const migrations = journal.entries || [];
    
    if (migrations.length === 0) {
      console.warn('⚠️  Warning: No migrations found in journal.');
      console.warn('   Migration journal exists but contains no entries.');
      console.warn('\n   This might mean:');
      console.warn('   1. Schema matches database (no changes detected)');
      console.warn('   2. Migrations need to be regenerated');
      console.warn('\n   Try generating migrations:');
      console.warn('   pnpm db-rls:generate\n');
      process.exit(0);
    }

    console.log(`✓ Found ${migrations.length} migration(s) to apply\n`);
  } catch (error) {
    console.error('❌ Error: Failed to read migration journal.');
    console.error(`   File: ${journalPath}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n   Please regenerate migrations:');
    console.error('   pnpm db-rls:generate\n');
    process.exit(1);
  }

  // Migrations exist, proceed with drizzle-kit migrate
  try {
    console.log('Applying migrations...\n');
    execSync('drizzle-kit migrate --config=./db-rls/drizzle.config.ts', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('\n✓ Migrations applied successfully');
  } catch (error) {
    console.error('\n❌ Error: Failed to apply migrations');
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { migrate };
