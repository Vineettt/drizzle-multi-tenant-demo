import { withTenant, db, masterDb } from '../tenant-wrapper';
import { organizations, users, stacks } from '../schema';
import { eq, inArray } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { appDb } from '../connections';
import { timedOperation, formatTime, checkMigrations } from '../../shared/db-utils';

type User = InferSelectModel<typeof users>;
type Stack = InferSelectModel<typeof stacks>;
type Transaction = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

// Check for --timing flag
const args = process.argv.slice(2);
const showTiming = args.includes('--timing') || args.includes('-t');

/**
 * Cleanup function to remove test data created by this demo
 * Uses masterDb to bypass RLS for cleanup operations
 * Uses CASCADE delete - deleting organizations will automatically delete related users and stacks
 */
async function cleanup(createdOrgIds: string[]) {
  if (createdOrgIds.length === 0) {
    return;
  }
  
  console.log(`Cleaning up ${createdOrgIds.length} organization(s) created by this demo...`);
  try {
    await masterDb.delete(organizations)
      .where(inArray(organizations.id, createdOrgIds));
    
    console.log('   ✓ Cleanup completed (organizations and related data deleted via CASCADE)\n');
  } catch (error) {
    console.error('   ⚠ Warning: Cleanup failed:', error);
    console.log();
  }
}

/**
 * Demo script to test RLS multi-tenancy implementation
 * 
 * This script demonstrates:
 * - Creating organizations (master table, no tenant wrapper)
 * - Creating users and stacks (tenant-scoped, with tenant wrapper)
 * - Querying tenant-scoped data
 * - Testing tenant isolation
 * - Testing RLS enforcement
 */
async function demo() {
  const demoStartTime = performance.now();
  console.log('=== RLS Multi-Tenancy Demo ===\n');
  if (showTiming) {
    console.log('⏱️  Timing enabled (use --timing or -t flag)\n');
  }

  // Check if migrations have been run
  await checkMigrations(masterDb, 'public', 'organizations', 'pnpm db-rls:migrate');

  const createdOrgIds: string[] = [];

  try {
    // ========================================================================
    // 1. Create Organization (Master Table - No Tenant Wrapper)
    // ========================================================================
    console.log('1. Creating organization (tenant)...');
    const { result: orgResult, time: orgTime } = await timedOperation(
      'Insert organization',
      async () => await db.insert(organizations).values({
        name: 'Acme Corp',
      }).returning(),
      showTiming
    );
    const [org] = orgResult;
    createdOrgIds.push(org.id);
    console.log(`   ✓ Created organization: ${org.name} (ID: ${org.id} = Tenant ID)\n`);

    // ========================================================================
    // 2. Create User for Tenant 1 (Tenant-Scoped - With Tenant Wrapper)
    // ========================================================================
    console.log('2. Creating user for tenant 1...');
    const { result: user1Result, time: user1Time } = await timedOperation(
      'Insert user (with RLS)',
      async () => await withTenant(org.id, async (tx: Transaction) => {
        return await tx.insert(users).values({
          organizationId: org.id,
          name: 'John Doe',
          email: 'john@example.com',
        }).returning();
      }),
      showTiming
    );
    const [user1] = user1Result;
    console.log(`   ✓ Created user: ${user1.name} (ID: ${user1.id})\n`);

    // ========================================================================
    // 3. Create Stack for Tenant 1 (Tenant-Scoped - With Tenant Wrapper)
    // ========================================================================
    console.log('3. Creating stack for tenant 1...');
    const { result: stack1Result, time: stack1Time } = await timedOperation(
      'Insert stack (with RLS)',
      async () => await withTenant(org.id, async (tx: Transaction) => {
        return await tx.insert(stacks).values({
          organizationId: org.id,
          userId: user1.id,
          name: 'Frontend Stack',
          description: 'React + TypeScript',
        }).returning();
      }),
      showTiming
    );
    const [stack1] = stack1Result;
    console.log(`   ✓ Created stack: ${stack1.name} (ID: ${stack1.id})\n`);

    // ========================================================================
    // 4. Create Second Organization (Tenant 2)
    // ========================================================================
    console.log('4. Creating organization for tenant 2...');
    const { result: org2Result, time: org2Time } = await timedOperation(
      'Insert organization',
      async () => await db.insert(organizations).values({
        name: 'Beta Inc',
      }).returning(),
      showTiming
    );
    const [org2] = org2Result;
    createdOrgIds.push(org2.id);
    console.log(`   ✓ Created organization: ${org2.name} (ID: ${org2.id} = Tenant 2 ID)\n`);

    // ========================================================================
    // 5. Create User and Stack for Tenant 2 (To Test Bidirectional Isolation)
    // ========================================================================
    console.log('5. Creating user and stack for tenant 2...');
    const { result: user2Result, time: user2Time } = await timedOperation(
      'Insert user (with RLS)',
      async () => await withTenant(org2.id, async (tx: Transaction) => {
        return await tx.insert(users).values({
          organizationId: org2.id,
          name: 'Jane Smith',
          email: 'jane@beta.com',
        }).returning();
      }),
      showTiming
    );
    const [user2] = user2Result;
    console.log(`   ✓ Created user: ${user2.name} (ID: ${user2.id})`);

    const { result: stack2Result, time: stack2Time } = await timedOperation(
      'Insert stack (with RLS)',
      async () => await withTenant(org2.id, async (tx: Transaction) => {
        return await tx.insert(stacks).values({
          organizationId: org2.id,
          userId: user2.id,
          name: 'Backend Stack',
          description: 'Node.js + Express',
        }).returning();
      }),
      showTiming
    );
    const [stack2] = stack2Result;
    console.log(`   ✓ Created stack: ${stack2.name} (ID: ${stack2.id})\n`);

    // ========================================================================
    // 6. Query Users for Tenant 1 (Should Return Only Tenant 1's Users)
    // ========================================================================
    console.log('6. Querying users for tenant 1 (should only see tenant 1 data)...');
    const { result: tenant1Users, time: query1Time } = await timedOperation(
      'Query users (with RLS)',
      async () => await withTenant(org.id, async (tx: Transaction) => {
        return await tx.select().from(users);
      }),
      showTiming
    );
    console.log(`   ✓ Found ${tenant1Users.length} user(s) for tenant 1 (expected: 1)`);
    tenant1Users.forEach((user: User) => {
      console.log(`     - ${user.name} (${user.email})`);
    });
    // Verify tenant 1 cannot see tenant 2's data
    const tenant1SeesTenant2User = tenant1Users.some((u: User) => u.id === user2.id);
    if (tenant1SeesTenant2User) {
      console.log('   ✗ ERROR: Tenant 1 can see tenant 2\'s user! RLS failed!\n');
    } else {
      console.log('   ✓ Tenant 1 correctly isolated from tenant 2\'s data\n');
    }

    // ========================================================================
    // 7. Query Stacks for Tenant 1 (Should Return Only Tenant 1's Stacks)
    // ========================================================================
    console.log('7. Querying stacks for tenant 1 (should only see tenant 1 data)...');
    const { result: tenant1Stacks, time: query2Time } = await timedOperation(
      'Query stacks (with RLS)',
      async () => await withTenant(org.id, async (tx: Transaction) => {
        return await tx.select().from(stacks);
      }),
      showTiming
    );
    console.log(`   ✓ Found ${tenant1Stacks.length} stack(s) for tenant 1 (expected: 1)`);
    tenant1Stacks.forEach((stack: Stack) => {
      console.log(`     - ${stack.name}: ${stack.description || 'No description'}`);
    });
    // Verify tenant 1 cannot see tenant 2's data
    const tenant1SeesTenant2Stack = tenant1Stacks.some((s: Stack) => s.id === stack2.id);
    if (tenant1SeesTenant2Stack) {
      console.log('   ✗ ERROR: Tenant 1 can see tenant 2\'s stack! RLS failed!\n');
    } else {
      console.log('   ✓ Tenant 1 correctly isolated from tenant 2\'s data\n');
    }

    // ========================================================================
    // 8. Test Tenant Isolation (Tenant 2 Should Only See Tenant 2's Data)
    // ========================================================================
    console.log('8. Testing tenant isolation (tenant 2 should only see tenant 2 data)...');
    const { result: tenant2Users, time: query3Time } = await timedOperation(
      'Query users for tenant 2 (with RLS)',
      async () => await withTenant(org2.id, async (tx: Transaction) => {
        return await tx.select().from(users);
      }),
      showTiming
    );
    const { result: tenant2Stacks, time: query4Time } = await timedOperation(
      'Query stacks for tenant 2 (with RLS)',
      async () => await withTenant(org2.id, async (tx: Transaction) => {
        return await tx.select().from(stacks);
      }),
      showTiming
    );
    console.log(`   ✓ Tenant 2 users: ${tenant2Users.length} (expected: 1)`);
    tenant2Users.forEach((user: User) => {
      console.log(`     - ${user.name} (${user.email})`);
    });
    console.log(`   ✓ Tenant 2 stacks: ${tenant2Stacks.length} (expected: 1)`);
    tenant2Stacks.forEach((stack: Stack) => {
      console.log(`     - ${stack.name}: ${stack.description || 'No description'}`);
    });
    
    // Verify tenant 2 cannot see tenant 1's data
    const tenant2SeesTenant1User = tenant2Users.some((u: User) => u.id === user1.id);
    const tenant2SeesTenant1Stack = tenant2Stacks.some((s: Stack) => s.id === stack1.id);
    
    if (tenant2Users.length === 1 && tenant2Stacks.length === 1 && 
        !tenant2SeesTenant1User && !tenant2SeesTenant1Stack) {
      console.log('   ✓ Tenant isolation working correctly! Both tenants isolated.\n');
    } else {
      console.log('   ✗ ERROR: Tenant isolation failed!');
      if (tenant2SeesTenant1User) console.log('     - Tenant 2 can see tenant 1\'s user!');
      if (tenant2SeesTenant1Stack) console.log('     - Tenant 2 can see tenant 1\'s stack!');
      console.log();
    }

    // ========================================================================
    // 9. Test Master Owner Bypasses RLS (Admin Operations)
    // ========================================================================
    console.log('9. Testing master owner (should bypass RLS)...');
    const { result: allUsersAdmin, time: adminQueryTime } = await timedOperation(
      'Query all users (master owner, bypasses RLS)',
      async () => await masterDb.select().from(users),
      showTiming
    );
    const expectedUserCount = 2; // This demo creates 2 users (one per tenant)
    console.log(`   ✓ Master owner can see ${allUsersAdmin.length} user(s) (bypasses RLS, expected: ${expectedUserCount})`);
    if (allUsersAdmin.length === expectedUserCount) {
      console.log('   ✓ Master owner correctly sees all data from both tenants\n');
    } else {
      console.log(`   ⚠ Warning: Expected ${expectedUserCount} users, found ${allUsersAdmin.length}\n`);
    }

    // ========================================================================
    // 10. Test Cross-Table Query with Join
    // ========================================================================
    console.log('10. Testing cross-table query with join...');
    const { result: usersWithOrgs, time: joinQueryTime } = await timedOperation(
      'Join query (users + organizations, with RLS)',
      async () => await withTenant(org.id, async (tx: Transaction) => {
        return await tx
          .select({
            userName: users.name,
            userEmail: users.email,
            orgName: organizations.name,
          })
          .from(users)
          .innerJoin(organizations, eq(users.organizationId, organizations.id));
      }),
      showTiming
    );
    console.log(`   ✓ Found ${usersWithOrgs.length} user(s) with organization info`);
    usersWithOrgs.forEach(({ userName, userEmail, orgName }: { userName: string; userEmail: string; orgName: string }) => {
      console.log(`     - ${userName} (${userEmail}) at ${orgName}`);
    });
    console.log();

    // ========================================================================
    // 11. Compare Single vs Batch Transactions
    // ========================================================================
    console.log('11. Comparing single vs batch transactions...');
    
    // Create test organization for comparison
    const { result: testOrgResult } = await timedOperation(
      'Create test organization',
      async () => await db.insert(organizations).values({
        name: `Test Org ${Date.now()}`,
      }).returning(),
      false // Don't show timing for this
    );
    const [testOrg] = testOrgResult;
    createdOrgIds.push(testOrg.id);

    // Single transactions approach (multiple withTenant calls)
    console.log('   Testing single transactions (multiple withTenant calls)...');
    const singleTransactionStart = performance.now();
    let singleUserIds: string[] = [];
    let singleStackIds: string[] = [];
    
    for (let i = 0; i < 3; i++) {
      const { result: singleUserResult } = await timedOperation(
        `   Single transaction ${i + 1}: Insert user`,
        async () => await withTenant(testOrg.id, async (tx: Transaction) => {
          return await tx.insert(users).values({
            organizationId: testOrg.id,
            name: `User ${i + 1}`,
            email: `user${i + 1}@test.com`,
          }).returning();
        }),
        showTiming
      );
      singleUserIds.push(singleUserResult[0].id);

      const { result: singleStackResult } = await timedOperation(
        `   Single transaction ${i + 1}: Insert stack`,
        async () => await withTenant(testOrg.id, async (tx: Transaction) => {
          return await tx.insert(stacks).values({
            organizationId: testOrg.id,
            userId: singleUserIds[i],
            name: `Stack ${i + 1}`,
            description: `Description ${i + 1}`,
          }).returning();
        }),
        showTiming
      );
      singleStackIds.push(singleStackResult[0].id);
    }
    
    const singleTransactionTime = performance.now() - singleTransactionStart;
    if (showTiming) {
      console.log(`   ⏱️  Total time (single transactions): ${formatTime(singleTransactionTime)}`);
    }
    console.log(`   ✓ Created ${singleUserIds.length} user(s) and ${singleStackIds.length} stack(s) using single transactions\n`);

    // Batch transactions approach (single withTenant call)
    console.log('   Testing batch transactions (single withTenant call)...');
    const batchTransactionStart = performance.now();
    let batchUserIds: string[] = [];
    let batchStackIds: string[] = [];
    
    const { result: batchResult } = await timedOperation(
      'Batch transaction: Insert 3 users + 3 stacks',
      async () => await withTenant(testOrg.id, async (tx: Transaction) => {
        // Insert all users in batch
        const batchUsers = await Promise.all(
          Array.from({ length: 3 }, (_, i) =>
            tx.insert(users).values({
              organizationId: testOrg.id,
              name: `Batch User ${i + 1}`,
              email: `batchuser${i + 1}@test.com`,
            }).returning()
          )
        );
        batchUserIds = batchUsers.map(u => u[0].id);

        // Insert all stacks in batch (using the user IDs from same transaction)
        const batchStacks = await Promise.all(
          batchUserIds.map((userId, i) =>
            tx.insert(stacks).values({
              organizationId: testOrg.id,
              userId: userId,
              name: `Batch Stack ${i + 1}`,
              description: `Batch Description ${i + 1}`,
            }).returning()
          )
        );
        batchStackIds = batchStacks.map(s => s[0].id);

        return { users: batchUsers, stacks: batchStacks };
      }),
      showTiming
    );
    
    const batchTransactionTime = performance.now() - batchTransactionStart;
    if (showTiming) {
      console.log(`   ⏱️  Total time (batch transaction): ${formatTime(batchTransactionTime)}`);
    }
    console.log(`   ✓ Created ${batchUserIds.length} user(s) and ${batchStackIds.length} stack(s) using batch transaction\n`);

    // Comparison summary
    if (showTiming) {
      const improvement = ((singleTransactionTime - batchTransactionTime) / singleTransactionTime) * 100;
      console.log('   📊 Performance Comparison:');
      console.log(`      Single transactions: ${formatTime(singleTransactionTime)}`);
      console.log(`      Batch transaction:    ${formatTime(batchTransactionTime)}`);
      console.log(`      Improvement:         ${improvement.toFixed(1)}% faster with batching`);
      console.log(`      Time saved:          ${formatTime(singleTransactionTime - batchTransactionTime)}`);
      console.log();
    }

    const demoEndTime = performance.now();
    const totalTime = demoEndTime - demoStartTime;
    
    console.log('=== Demo Completed Successfully ===');
    if (showTiming) {
      console.log(`\n⏱️  Total execution time: ${formatTime(totalTime)}`);
    }
    
    await cleanup(createdOrgIds);
  } catch (error) {
    console.error('=== Demo Failed ===');
    console.error(error);
    
    if (createdOrgIds.length > 0) {
      console.log('\nAttempting to clean up created organizations...');
      await cleanup(createdOrgIds);
    }
    
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  demo().catch(console.error);
}

export { demo };
