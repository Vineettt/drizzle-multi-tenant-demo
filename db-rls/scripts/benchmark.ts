import { withTenant, db, masterDb } from '../tenant-wrapper';
import { organizations, users, stacks } from '../schema';
import { eq } from 'drizzle-orm';
import { checkMigrations, formatTime } from '../../shared/db-utils';

/**
 * Performance Benchmarking Script for RLS Implementation
 * 
 * This script measures:
 * - RLS overhead (queries with RLS vs without)
 * - Connection pooling efficiency
 * - Transaction performance
 * - Query performance with different tenant contexts
 * 
 * Usage:
 *   pnpm db-rls:benchmark                    # Use default iterations
 *   pnpm db-rls:benchmark --iterations 100   # Use 100 iterations for all benchmarks
 *   pnpm db-rls:benchmark -i 50              # Use 50 iterations (short form)
 */

// Parse command-line arguments
const args = process.argv.slice(2);
const getIterations = (defaultValue: number): number => {
  const iterationsIndex = args.findIndex(arg => arg === '--iterations' || arg === '-i');
  if (iterationsIndex !== -1 && args[iterationsIndex + 1]) {
    const value = parseInt(args[iterationsIndex + 1], 10);
    if (!isNaN(value) && value > 0) {
      return value;
    }
  }
  return defaultValue;
};

// Default iteration counts (can be overridden with --iterations flag)
const DEFAULT_ITERATIONS = {
  baseline: 50,
  standard: 50,
  insert: 50,
  batch: 20,
  select: 30,
};

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  operationsPerSecond: number;
}

function formatOpsPerSec(ops: number): string {
  if (ops >= 1000) return `${(ops / 1000).toFixed(2)}k ops/s`;
  return `${ops.toFixed(2)} ops/s`;
}

async function benchmark(
  name: string,
  iterations: number,
  operation: () => Promise<void>
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warm-up run
  await operation();

  // Benchmark runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const operationsPerSecond = 1000 / averageTime;

  return {
    name,
    iterations,
    totalTime,
    averageTime,
    minTime,
    maxTime,
    operationsPerSecond,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n📊 ${result.name}`);
  console.log(`   Iterations: ${result.iterations}`);
  console.log(`   Total Time: ${formatTime(result.totalTime)}`);
  console.log(`   Average: ${formatTime(result.averageTime)}`);
  console.log(`   Min: ${formatTime(result.minTime)}`);
  console.log(`   Max: ${formatTime(result.maxTime)}`);
  console.log(`   Throughput: ${formatOpsPerSec(result.operationsPerSecond)}`);
}

async function setupTestData() {
  console.log('Setting up test data...');
  
  // Create test organizations
  const [org1] = await db.insert(organizations).values({
    name: `Benchmark Org 1 ${Date.now()}`,
  }).returning();

  const [org2] = await db.insert(organizations).values({
    name: `Benchmark Org 2 ${Date.now()}`,
  }).returning();

  // Create users for each tenant
  const users1 = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      withTenant(org1.id, async (tx) => {
        const [user] = await tx.insert(users).values({
          organizationId: org1.id,
          name: `User ${i} Tenant 1`,
          email: `user${i}@tenant1.com`,
        }).returning();
        return user;
      })
    )
  );

  const users2 = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      withTenant(org2.id, async (tx) => {
        const [user] = await tx.insert(users).values({
          organizationId: org2.id,
          name: `User ${i} Tenant 2`,
          email: `user${i}@tenant2.com`,
        }).returning();
        return user;
      })
    )
  );

  // Create stacks for each user
  for (const user of users1) {
    await withTenant(org1.id, async (tx) => {
      await tx.insert(stacks).values({
        organizationId: org1.id,
        userId: user.id,
        name: `Stack for ${user.name}`,
        description: 'Benchmark stack',
      });
    });
  }

  for (const user of users2) {
    await withTenant(org2.id, async (tx) => {
      await tx.insert(stacks).values({
        organizationId: org2.id,
        userId: user.id,
        name: `Stack for ${user.name}`,
        description: 'Benchmark stack',
      });
    });
  }

  console.log('   ✓ Test data created\n');
  return { org1, org2, users1, users2 };
}

async function cleanupTestData(orgIds: string[]) {
  console.log('\nCleaning up test data...');
  try {
    await masterDb.delete(organizations)
      .where(eq(organizations.id, orgIds[0] as any));
    if (orgIds.length > 1) {
      await masterDb.delete(organizations)
        .where(eq(organizations.id, orgIds[1] as any));
    }
    console.log('   ✓ Cleanup completed\n');
  } catch (error) {
    console.error('   ⚠ Cleanup failed:', error);
  }
}

async function runBenchmarks() {
  const benchmarkStartTime = performance.now();
  console.log('=== RLS Performance Benchmarking ===\n');

  // Get iteration counts (use --iterations flag if provided, otherwise use defaults)
  const globalIterations = getIterations(0); // 0 means use defaults
  const iterations = {
    baseline: globalIterations || DEFAULT_ITERATIONS.baseline,
    standard: globalIterations || DEFAULT_ITERATIONS.standard,
    insert: globalIterations || DEFAULT_ITERATIONS.insert,
    batch: globalIterations || DEFAULT_ITERATIONS.batch,
    select: globalIterations || DEFAULT_ITERATIONS.select,
  };

  if (globalIterations) {
    console.log(`📊 Using ${globalIterations} iterations for all benchmarks (override with --iterations or -i)\n`);
  } else {
    console.log(`📊 Using default iterations: baseline=${iterations.baseline}, standard=${iterations.standard}, insert=${iterations.insert}, batch=${iterations.batch}, select=${iterations.select}\n`);
    console.log(`💡 Tip: Use --iterations <number> or -i <number> to override all benchmarks\n`);
  }

  // Check if migrations have been run
  await checkMigrations(masterDb, 'public', 'organizations', 'pnpm db-rls:migrate');

  const { org1, org2 } = await setupTestData();
  const orgIds = [org1.id, org2.id];

  try {
    const results: BenchmarkResult[] = [];

    // ========================================================================
    // Benchmark 0: Baseline - Network Latency (No Transaction, No RLS)
    // ========================================================================
    console.log('Running Benchmark 0: Baseline network latency...');
    const baselineResult = await benchmark(
      'Baseline (organizations table, no RLS, no transaction)',
      iterations.baseline,
      async () => {
        // Query organizations table (no RLS) using appDb - measures pure network latency
        await db.select().from(organizations).limit(1);
      }
    );
    results.push(baselineResult);
    printResult(baselineResult);

    // ========================================================================
    // Benchmark 1: SELECT Query Performance (RLS Enabled)
    // ========================================================================
    console.log('\nRunning Benchmark 1: SELECT queries with RLS...');
    const rlsSelectResult = await benchmark(
      'SELECT with RLS (app owner, withTenant)',
      iterations.standard,
      async () => {
        await withTenant(org1.id, async (tx) => {
          await tx.select().from(users);
        });
      }
    );
    results.push(rlsSelectResult);
    printResult(rlsSelectResult);

    // ========================================================================
    // Benchmark 2: SELECT Query Performance (RLS Bypassed)
    // ========================================================================
    console.log('\nRunning Benchmark 2: SELECT queries without RLS...');
    const noRlsSelectResult = await benchmark(
      'SELECT without RLS (master owner, bypasses RLS)',
      iterations.standard,
      async () => {
        await masterDb.select().from(users);
      }
    );
    results.push(noRlsSelectResult);
    printResult(noRlsSelectResult);

    // ========================================================================
    // Benchmark 3: INSERT Performance (RLS Enabled)
    // ========================================================================
    console.log('\nRunning Benchmark 3: INSERT operations with RLS...');
    const rlsInsertResult = await benchmark(
      'INSERT with RLS (app owner)',
      iterations.insert,
      async () => {
        await withTenant(org1.id, async (tx) => {
          await tx.insert(users).values({
            organizationId: org1.id,
            name: 'Benchmark User',
            email: `bench${Date.now()}@test.com`,
          });
        });
      }
    );
    results.push(rlsInsertResult);
    printResult(rlsInsertResult);

    // ========================================================================
    // Benchmark 4: Complex Query with JOIN (RLS Enabled)
    // ========================================================================
    console.log('\nRunning Benchmark 4: JOIN queries with RLS...');
    const rlsJoinResult = await benchmark(
      'JOIN with RLS (app owner)',
      iterations.standard,
      async () => {
        await withTenant(org1.id, async (tx) => {
          await tx
            .select({
              userName: users.name,
              userEmail: users.email,
              orgName: organizations.name,
            })
            .from(users)
            .innerJoin(organizations, eq(users.organizationId, organizations.id));
        });
      }
    );
    results.push(rlsJoinResult);
    printResult(rlsJoinResult);

    // ========================================================================
    // Benchmark 5: Tenant Context Switching
    // ========================================================================
    console.log('\nRunning Benchmark 5: Tenant context switching...');
    const contextSwitchResult = await benchmark(
      'Tenant context switching',
      iterations.standard,
      async () => {
        // Switch between tenants
        await withTenant(org1.id, async (tx) => {
          await tx.select().from(users);
        });
        await withTenant(org2.id, async (tx) => {
          await tx.select().from(users);
        });
      }
    );
    results.push(contextSwitchResult);
    printResult(contextSwitchResult);

    // ========================================================================
    // Benchmark 6: Transaction Overhead
    // ========================================================================
    console.log('\nRunning Benchmark 6: Transaction overhead...');
    const transactionResult = await benchmark(
      'Transaction overhead (SET LOCAL)',
      iterations.standard,
      async () => {
        await withTenant(org1.id, async (tx) => {
          // Just set context, no query
        });
      }
    );
    results.push(transactionResult);
    printResult(transactionResult);

    // ========================================================================
    // Benchmark 7: Single INSERT Operations (Multiple Transactions)
    // ========================================================================
    console.log('\nRunning Benchmark 7: Single INSERT operations (multiple transactions)...');
    const singleInsertResult = await benchmark(
      'Single INSERT operations (5 separate transactions)',
      iterations.batch,
      async () => {
        // Create 5 users in 5 separate transactions
        for (let i = 0; i < 5; i++) {
          await withTenant(org1.id, async (tx) => {
            await tx.insert(users).values({
              organizationId: org1.id,
              name: `Single User ${i}`,
              email: `single${Date.now()}-${i}@test.com`,
            });
          });
        }
      }
    );
    results.push(singleInsertResult);
    printResult(singleInsertResult);

    // ========================================================================
    // Benchmark 8: Batch INSERT Operations (Single Transaction)
    // ========================================================================
    console.log('\nRunning Benchmark 8: Batch INSERT operations (single transaction)...');
    const batchInsertResult = await benchmark(
      'Batch INSERT operations (5 inserts in 1 transaction)',
      iterations.batch,
      async () => {
        // Create 5 users in a single transaction
        await withTenant(org1.id, async (tx) => {
          await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
              tx.insert(users).values({
                organizationId: org1.id,
                name: `Batch User ${i}`,
                email: `batch${Date.now()}-${i}@test.com`,
              })
            )
          );
        });
      }
    );
    results.push(batchInsertResult);
    printResult(batchInsertResult);

    // ========================================================================
    // Benchmark 9: Single SELECT Operations (Multiple Transactions)
    // ========================================================================
    console.log('\nRunning Benchmark 9: Single SELECT operations (multiple transactions)...');
    const singleSelectResult = await benchmark(
      'Single SELECT operations (5 separate transactions)',
      iterations.select,
      async () => {
        // Execute 5 queries in 5 separate transactions
        for (let i = 0; i < 5; i++) {
          await withTenant(org1.id, async (tx) => {
            await tx.select().from(users).limit(1);
          });
        }
      }
    );
    results.push(singleSelectResult);
    printResult(singleSelectResult);

    // ========================================================================
    // Benchmark 10: Batch SELECT Operations (Single Transaction)
    // ========================================================================
    console.log('\nRunning Benchmark 10: Batch SELECT operations (single transaction)...');
    const batchSelectResult = await benchmark(
      'Batch SELECT operations (5 queries in 1 transaction)',
      iterations.select,
      async () => {
        // Execute 5 queries in a single transaction
        await withTenant(org1.id, async (tx) => {
          await Promise.all(
            Array.from({ length: 5 }, () =>
              tx.select().from(users).limit(1)
            )
          );
        });
      }
    );
    results.push(batchSelectResult);
    printResult(batchSelectResult);

    // ========================================================================
    // Summary: Calculate RLS Overhead
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('📈 PERFORMANCE SUMMARY');
    console.log('='.repeat(60));

    // Calculate overhead breakdown
    const networkLatency = baselineResult.averageTime;
    const transactionOverhead = transactionResult.averageTime;
    const queryWithRls = rlsSelectResult.averageTime;
    const queryWithoutRls = noRlsSelectResult.averageTime;
    
    // Breakdown:
    // - baseline: networkLatency + simpleQueryExecution
    // - queryWithoutRls: networkLatency + queryExecution (users table, no transaction, no RLS)
    // - transactionOverhead: networkLatency + transactionSetup + SET LOCAL
    // - queryWithRls: networkLatency + transactionSetup + SET LOCAL + queryExecution + rlsPolicyEvaluation
    
    const queryExecutionTime = queryWithoutRls - networkLatency;
    const transactionSetupCost = transactionOverhead - networkLatency;
    const totalOverhead = queryWithRls - queryWithoutRls;
    const actualRlsOverhead = totalOverhead - transactionSetupCost;
    
    console.log(`\n🔍 Overhead Breakdown:`);
    console.log(`   Baseline (network latency + simple query): ${formatTime(networkLatency)}`);
    console.log(`   Query execution time (users table, no RLS): ${formatTime(queryExecutionTime)}`);
    console.log(`   Transaction setup cost (SET LOCAL): ${formatTime(transactionSetupCost)}`);
    console.log(`   Actual RLS policy overhead: ${formatTime(Math.max(0, actualRlsOverhead))}`);
    
    console.log(`\n📊 Query Performance Comparison:`);
    console.log(`   SELECT with RLS (withTenant): ${formatTime(queryWithRls)}`);
    console.log(`   SELECT without RLS (masterDb): ${formatTime(queryWithoutRls)}`);
    console.log(`   Total overhead: ${formatTime(totalOverhead)} (${((totalOverhead / queryWithoutRls) * 100).toFixed(2)}%)`);
    
    if (actualRlsOverhead < 5) {
      console.log(`   ✅ RLS policy overhead is minimal (< 5ms)`);
    } else if (actualRlsOverhead < 15) {
      console.log(`   ⚠️  RLS policy overhead is acceptable (< 15ms)`);
    } else {
      console.log(`   ⚠️  RLS policy overhead is significant (> 15ms)`);
    }

    console.log(`\n⚡ Throughput Comparison:`);
    console.log(`   With RLS: ${formatOpsPerSec(rlsSelectResult.operationsPerSecond)}`);
    console.log(`   Without RLS: ${formatOpsPerSec(noRlsSelectResult.operationsPerSecond)}`);
    console.log(`   Difference: ${((noRlsSelectResult.operationsPerSecond - rlsSelectResult.operationsPerSecond) / rlsSelectResult.operationsPerSecond * 100).toFixed(2)}% slower`);

    console.log(`\n🔄 Context Switching Performance:`);
    console.log(`   Average: ${formatTime(contextSwitchResult.averageTime)}`);
    console.log(`   Throughput: ${formatOpsPerSec(contextSwitchResult.operationsPerSecond)}`);

    console.log(`\n💾 Transaction Overhead:`);
    console.log(`   SET LOCAL overhead: ${formatTime(transactionResult.averageTime)}`);
    console.log(`   This is the cost of setting tenant context per transaction`);
    
    console.log(`\n💡 Key Insight:`);
    console.log(`   Most overhead comes from transaction setup (~${formatTime(transactionOverhead)}).`);
    console.log(`   Batch multiple operations in a single withTenant() call to amortize this cost.`);

    // ========================================================================
    // Batch vs Single Operations Comparison
    // ========================================================================
    console.log(`\n📦 Batch vs Single Operations Comparison:`);
    
    const singleInsertTime = singleInsertResult.averageTime;
    const batchInsertTime = batchInsertResult.averageTime;
    const insertImprovement = ((singleInsertTime - batchInsertTime) / singleInsertTime) * 100;
    
    console.log(`\n   INSERT Operations (5 operations):`);
    console.log(`      Single transactions: ${formatTime(singleInsertTime)} (5 separate withTenant calls)`);
    console.log(`      Batch transaction:   ${formatTime(batchInsertTime)} (1 withTenant call)`);
    console.log(`      Improvement:        ${insertImprovement.toFixed(1)}% faster with batching`);
    console.log(`      Time saved:         ${formatTime(singleInsertTime - batchInsertTime)}`);
    console.log(`      Throughput (single): ${formatOpsPerSec(1000 / (singleInsertTime / 5))}`);
    console.log(`      Throughput (batch): ${formatOpsPerSec(1000 / (batchInsertTime / 5))}`);
    
    const singleSelectTime = singleSelectResult.averageTime;
    const batchSelectTime = batchSelectResult.averageTime;
    const selectImprovement = ((singleSelectTime - batchSelectTime) / singleSelectTime) * 100;
    
    console.log(`\n   SELECT Operations (5 queries):`);
    console.log(`      Single transactions: ${formatTime(singleSelectTime)} (5 separate withTenant calls)`);
    console.log(`      Batch transaction:   ${formatTime(batchSelectTime)} (1 withTenant call)`);
    console.log(`      Improvement:        ${selectImprovement.toFixed(1)}% faster with batching`);
    console.log(`      Time saved:         ${formatTime(singleSelectTime - batchSelectTime)}`);
    console.log(`      Throughput (single): ${formatOpsPerSec(1000 / (singleSelectTime / 5))}`);
    console.log(`      Throughput (batch): ${formatOpsPerSec(1000 / (batchSelectTime / 5))}`);
    
    console.log(`\n   💡 Recommendation:`);
    console.log(`      Always batch related operations in a single withTenant() call.`);
    console.log(`      For ${Math.round(5 / (batchInsertTime / singleInsertTime))} operations, batching saves ~${formatTime(singleInsertTime - batchInsertTime)} per batch.`);

    const benchmarkEndTime = performance.now();
    const totalExecutionTime = benchmarkEndTime - benchmarkStartTime;

    console.log('\n' + '='.repeat(60));
    console.log('✅ Benchmarking Complete');
    console.log('='.repeat(60));
    console.log(`\n⏱️  Total execution time: ${formatTime(totalExecutionTime)}`);

  } catch (error) {
    console.error('\n❌ Benchmarking failed:', error);
    throw error;
  } finally {
    await cleanupTestData(orgIds);
  }
}

// Run benchmarks if executed directly
if (require.main === module) {
  runBenchmarks()
    .then(() => {
      console.log('\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runBenchmarks };
