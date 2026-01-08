import { masterDb } from '../tenant-wrapper';
import { organizations, users, stacks } from '../schema';
import { sql } from 'drizzle-orm';
import { tableExists } from '../../shared/db-utils';

/**
 * Cleanup script to delete all data or drop all tables from the database
 * 
 * Usage:
 *   pnpm db-rls:cleanup          - Delete all data (truncate tables)
 *   pnpm db-rls:cleanup --drop   - Drop all tables (complete reset)
 */

async function truncateAllTables() {
  console.log('🗑️  Truncating all tables...');
  
  try {
    let truncatedAny = false;
    
    const tables = [
      { name: 'stacks', display: 'stacks' },
      { name: 'users', display: 'users' },
      { name: 'organizations', display: 'organizations' },
    ];
    
    for (const table of tables) {
      const exists = await tableExists(masterDb, 'public', table.name);
      if (exists) {
        await masterDb.execute(sql.raw(`TRUNCATE TABLE ${table.name} CASCADE`));
        console.log(`   ✓ Truncated ${table.display} table`);
        truncatedAny = true;
      } else {
        console.log(`   ℹ️  ${table.display} table does not exist (skipping)`);
      }
    }
    
    if (truncatedAny) {
      console.log('\n✅ All tables truncated successfully');
    } else {
      console.log('\n✅ No tables to truncate');
    }
  } catch (error) {
    console.error('❌ Error truncating tables:', error);
    throw error;
  }
}

async function dropAllTables() {
  console.log('🗑️  Dropping all tables...');
  
  try {
    let droppedAny = false;
    
    const tables = [
      { name: 'stacks', display: 'stacks' },
      { name: 'users', display: 'users' },
      { name: 'organizations', display: 'organizations' },
    ];
    
    for (const table of tables) {
      const exists = await tableExists(masterDb, 'public', table.name);
      if (exists) {
        await masterDb.execute(sql.raw(`DROP TABLE IF EXISTS ${table.name} CASCADE`));
        console.log(`   ✓ Dropped ${table.display} table`);
        droppedAny = true;
      } else {
        console.log(`   ℹ️  ${table.display} table does not exist`);
      }
    }
    
    const migrationsExists = await tableExists(masterDb, 'public', '__drizzle_migrations');
    if (migrationsExists) {
      await masterDb.execute(sql`DROP TABLE IF EXISTS __drizzle_migrations CASCADE`);
      console.log('   ✓ Dropped migration tracking table');
      droppedAny = true;
    } else {
      console.log('   ℹ️  __drizzle_migrations table does not exist');
    }
    
    if (droppedAny) {
      console.log('\n✅ All tables dropped successfully');
      console.log('⚠️  Note: You will need to run migrations again: pnpm db-rls:migrate');
    } else {
      console.log('\n✅ No tables to drop');
    }
  } catch (error) {
    console.error('❌ Error dropping tables:', error);
    throw error;
  }
}

async function showTableStats() {
  console.log('\n📊 Current database state:');
  
  try {
    const orgExists = await tableExists(masterDb, 'public', 'organizations');
    const userExists = await tableExists(masterDb, 'public', 'users');
    const stackExists = await tableExists(masterDb, 'public', 'stacks');
    
    if (!orgExists && !userExists && !stackExists) {
      console.log('   ℹ️  No tables exist in database');
      return;
    }
    
    if (orgExists) {
      try {
        const orgCount = await masterDb.select().from(organizations);
        console.log(`   Organizations: ${orgCount.length}`);
      } catch (error) {
        console.log('   Organizations: table exists but cannot read data');
      }
    } else {
      console.log('   Organizations: table does not exist');
    }
    
    if (userExists) {
      try {
        const userCount = await masterDb.select().from(users);
        console.log(`   Users: ${userCount.length}`);
      } catch (error) {
        console.log('   Users: table exists but cannot read data');
      }
    } else {
      console.log('   Users: table does not exist');
    }
    
    if (stackExists) {
      try {
        const stackCount = await masterDb.select().from(stacks);
        console.log(`   Stacks: ${stackCount.length}`);
      } catch (error) {
        console.log('   Stacks: table exists but cannot read data');
      }
    } else {
      console.log('   Stacks: table does not exist');
    }
  } catch (error) {
    console.log('   ⚠️  Could not read table stats (tables may not exist)');
  }
}

async function cleanup() {
  const args = process.argv.slice(2);
  const dropTables = args.includes('--drop') || args.includes('-d');
  
  console.log('=== Database Cleanup Script ===\n');
  
  await showTableStats();
  
  if (dropTables) {
    console.log('\n⚠️  WARNING: This will DROP all tables (complete reset)');
    console.log('   You will need to run migrations again after this.');
    await dropAllTables();
  } else {
    console.log('\n⚠️  WARNING: This will DELETE all data from all tables');
    console.log('   Tables will remain but all data will be removed.');
    await truncateAllTables();
  }
  
  if (!dropTables) {
    await showTableStats();
  }
  
  console.log('\n✅ Cleanup complete');
}

if (require.main === module) {
  cleanup()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Cleanup failed:', error);
      process.exit(1);
    });
}

export { cleanup, truncateAllTables, dropAllTables };
