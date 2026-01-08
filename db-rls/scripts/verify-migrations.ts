import 'dotenv/config';
import { masterDb } from '../connections';
import { sql } from 'drizzle-orm';

/**
 * Verification script for RLS migrations
 * 
 * Verifies that migrations were applied correctly:
 * - Tables exist (organizations, users, stacks)
 * - RLS is enabled on tenant-scoped tables
 * - RLS policies exist
 * - Foreign keys are created
 * - Table ownership is correct
 */
async function verifyMigrations() {
  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error('DATABASE_URL_ADMIN environment variable is required');
  }

  try {
    console.log('=== Verifying RLS Migrations ===\n');

    // 1. Check if tables exist
    console.log('1. Checking table existence...');
    const tables = await masterDb.execute(sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN ('organizations', 'users', 'stacks')
      ORDER BY tablename
    `);
    
    const tableNames = tables.map((t: any) => t.tablename);
    const expectedTables = ['organizations', 'users', 'stacks'];
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));
    
    if (missingTables.length > 0) {
      console.error(`   ✗ Missing tables: ${missingTables.join(', ')}`);
      process.exit(1);
    }
    console.log(`   ✓ All tables exist: ${tableNames.join(', ')}\n`);

    // 2. Verify RLS is enabled on tenant-scoped tables
    console.log('2. Verifying RLS status...');
    const rlsStatus = await masterDb.execute(sql`
      SELECT tablename, rowsecurity as rls_enabled
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('organizations', 'users', 'stacks')
      ORDER BY tablename
    `);

    for (const row of rlsStatus as any[]) {
      const { tablename, rls_enabled } = row;
      if (tablename === 'organizations') {
        if (rls_enabled) {
          console.error(`   ✗ organizations should NOT have RLS enabled`);
          process.exit(1);
        }
        console.log(`   ✓ organizations: RLS disabled (correct)`);
      } else {
        if (!rls_enabled) {
          console.error(`   ✗ ${tablename} should have RLS enabled`);
          process.exit(1);
        }
        console.log(`   ✓ ${tablename}: RLS enabled`);
      }
    }
    console.log();

    // 3. Verify RLS policies exist
    console.log('3. Verifying RLS policies...');
    const policies = await masterDb.execute(sql`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'stacks')
      ORDER BY tablename, policyname
    `);

    const policyMap = new Map<string, string[]>();
    for (const row of policies as any[]) {
      const { tablename, policyname } = row;
      if (!policyMap.has(tablename)) {
        policyMap.set(tablename, []);
      }
      policyMap.get(tablename)!.push(policyname);
    }

    const expectedPolicies = {
      users: ['users_tenant_policy'],
      stacks: ['stacks_tenant_policy'],
    };

    for (const [table, expected] of Object.entries(expectedPolicies)) {
      const found = policyMap.get(table) || [];
      const missing = expected.filter(p => !found.includes(p));
      if (missing.length > 0) {
        console.error(`   ✗ Missing policies for ${table}: ${missing.join(', ')}`);
        process.exit(1);
      }
      console.log(`   ✓ ${table}: ${found.join(', ')}`);
    }
    console.log();

    // 4. Verify foreign keys
    console.log('4. Verifying foreign key constraints...');
    const foreignKeys = await masterDb.execute(sql`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN ('users', 'stacks')
      ORDER BY tc.table_name, kcu.column_name
    `);

    const expectedFKs = [
      { table: 'users', column: 'organization_id', refTable: 'organizations', refColumn: 'id' },
      { table: 'stacks', column: 'user_id', refTable: 'users', refColumn: 'id' },
    ];

    const foundFKs = new Set(
      (foreignKeys as any[]).map(fk => `${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`)
    );

    for (const expected of expectedFKs) {
      const fkKey = `${expected.table}.${expected.column} -> ${expected.refTable}.${expected.refColumn}`;
      if (!foundFKs.has(fkKey)) {
        console.error(`   ✗ Missing foreign key: ${fkKey}`);
        process.exit(1);
      }
      console.log(`   ✓ ${fkKey}`);
    }
    console.log();

    // 5. Verify table ownership (should be Neon owner, not app_owner)
    console.log('5. Verifying table ownership...');
    const ownership = await masterDb.execute(sql`
      SELECT tablename, tableowner
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('organizations', 'users', 'stacks')
      ORDER BY tablename
    `);

    for (const row of ownership as any[]) {
      const { tablename, tableowner } = row;
      if (tableowner === 'app_owner') {
        console.error(`   ✗ ${tablename} is owned by app_owner (should be Neon owner)`);
        process.exit(1);
      }
      console.log(`   ✓ ${tablename}: owned by ${tableowner}`);
    }
    console.log();

    // 6. Verify migration tracking table exists
    console.log('6. Verifying migration tracking...');
    const migrationTableExists = await masterDb.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
      )
    `);

    if (!(migrationTableExists as any[])[0].exists) {
      console.error('   ✗ Migration tracking table (__drizzle_migrations) does not exist');
      process.exit(1);
    }

    const appliedMigrations = await masterDb.execute(sql`
      SELECT hash FROM public.__drizzle_migrations ORDER BY id
    `);
    console.log(`   ✓ Migration tracking table exists`);
    console.log(`   ✓ Applied migrations: ${(appliedMigrations as any[]).length}`);
    (appliedMigrations as any[]).forEach((m: any, i: number) => {
      console.log(`     ${i + 1}. ${m.hash}`);
    });
    console.log();

    console.log('=== All Migrations Verified Successfully ===');
    console.log('\nSummary:');
    console.log('  ✓ All tables created');
    console.log('  ✓ RLS enabled on tenant-scoped tables');
    console.log('  ✓ RLS policies created');
    console.log('  ✓ Foreign keys established');
    console.log('  ✓ Table ownership correct');
    console.log('  ✓ Migrations tracked');
  } catch (error) {
    console.error('\n✗ Verification failed:');
    console.error(error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  verifyMigrations().catch(console.error);
}

export { verifyMigrations };
