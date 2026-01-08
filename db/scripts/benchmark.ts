import 'dotenv/config';
import postgres from 'postgres';
import { db } from '../db';
import { schemaTracker } from '../schema';
import { eq } from 'drizzle-orm';
import { createPostgresClient, setSearchPath, escapeSchemaName } from '../script-utils';
import { createTenantSchemaWithMigrations } from '../tenant-schema';
import { checkMigrations, formatTime } from '../../shared/db-utils';

/**
 * Performance Benchmarking Script for Multi-Schema Implementation
 * 
 * This script measures:
 * - Query performance (baseline vs with search_path switching)
 * - search_path switching overhead
 * - Schema-level isolation performance
 * - Comparison metrics for decision-making
 */

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

async function setupTestData(client: postgres.Sql) {
  console.log('Setting up test data...');
  
  const schema1 = `benchmark_tenant_1_${Date.now()}`;
  const schema2 = `benchmark_tenant_2_${Date.now()}`;

  // Create tenant schemas
  await createTenantSchemaWithMigrations(schema1);
  await createTenantSchemaWithMigrations(schema2);

  // Register in schema_tracker
  await db.insert(schemaTracker).values({ name: schema1 });
  await db.insert(schemaTracker).values({ name: schema2 });

  // Insert test data into each tenant schema
  await setSearchPath(client, schema1);
  for (let i = 0; i < 10; i++) {
    await client`
      INSERT INTO dummy_table (name, value, description)
      VALUES (${`User ${i} Tenant 1`}, ${`Value ${i}`}, ${`Description ${i}`})
    `;
  }

  await setSearchPath(client, schema2);
  for (let i = 0; i < 10; i++) {
    await client`
      INSERT INTO dummy_table (name, value, description)
      VALUES (${`User ${i} Tenant 2`}, ${`Value ${i}`}, ${`Description ${i}`})
    `;
  }

  console.log('   ✓ Test data created\n');
  return { schema1, schema2 };
}

async function cleanupTestData(client: postgres.Sql, schemaNames: string[]) {
  console.log('\nCleaning up test data...');
  try {
    for (const schemaName of schemaNames) {
      const escapedSchemaName = escapeSchemaName(schemaName);
      
      // Drop the schema first
      try {
        await client.unsafe(`DROP SCHEMA IF EXISTS ${escapedSchemaName} CASCADE`);
        console.log(`   ✓ Dropped schema: ${schemaName}`);
      } catch (error) {
        console.log(`   ⚠️  Could not drop schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Remove from schema_tracker using raw SQL (more reliable than Drizzle if table might not exist)
      try {
        await client.unsafe(`DELETE FROM schema_tracker WHERE name = '${schemaName.replace(/'/g, "''")}'`);
        console.log(`   ✓ Removed ${schemaName} from schema_tracker`);
      } catch (error) {
        // schema_tracker might not exist or schema might not be in tracker - that's okay
        console.log(`   ℹ️  Could not remove ${schemaName} from schema_tracker (may not exist)`);
      }
    }
    console.log('   ✓ Cleanup completed\n');
  } catch (error) {
    console.error('   ⚠ Cleanup failed:', error);
  }
}

async function runBenchmarks() {
  console.log('=== Multi-Schema Performance Benchmarking ===\n');

  const client = createPostgresClient();
  
  // Check if migrations have been run
  await checkMigrations(client, 'public', 'schema_tracker', 'pnpm db:migrate');
  
  const { schema1, schema2 } = await setupTestData(client);
  const schemaNames = [schema1, schema2];

  try {
    const results: BenchmarkResult[] = [];

    // ========================================================================
    // Benchmark 0: Baseline - Query Public Schema (No search_path Switch)
    // ========================================================================
    console.log('Running Benchmark 0: Baseline query (public schema)...');
    const baselineResult = await benchmark(
      'Baseline (schema_tracker table, no search_path switch)',
      100,
      async () => {
        await db.select().from(schemaTracker).limit(1);
      }
    );
    results.push(baselineResult);
    printResult(baselineResult);

    // ========================================================================
    // Benchmark 1: Query with search_path Switch
    // ========================================================================
    console.log('\nRunning Benchmark 1: Query with search_path switch...');
    const searchPathResult = await benchmark(
      'Query with search_path switch',
      100,
      async () => {
        await setSearchPath(client, schema1);
        await client`SELECT * FROM dummy_table LIMIT 10`;
      }
    );
    results.push(searchPathResult);
    printResult(searchPathResult);

    // ========================================================================
    // Benchmark 2: search_path Switching Overhead
    // ========================================================================
    console.log('\nRunning Benchmark 2: search_path switching overhead...');
    const switchOverheadResult = await benchmark(
      'search_path switching overhead',
      100,
      async () => {
        await setSearchPath(client, schema1);
        // Just switch, no query
      }
    );
    results.push(switchOverheadResult);
    printResult(switchOverheadResult);

    // ========================================================================
    // Benchmark 3: Query Without search_path Switch (Schema-Qualified)
    // ========================================================================
    console.log('\nRunning Benchmark 3: Schema-qualified query (no search_path)...');
    const schemaQualifiedResult = await benchmark(
      'Schema-qualified query (no search_path switch)',
      100,
      async () => {
        const escapedSchema = escapeSchemaName(schema1);
        await client.unsafe(`SELECT * FROM ${escapedSchema}.dummy_table LIMIT 10`);
      }
    );
    results.push(schemaQualifiedResult);
    printResult(schemaQualifiedResult);

    // ========================================================================
    // Benchmark 4: Schema Context Switching
    // ========================================================================
    console.log('\nRunning Benchmark 4: Schema context switching...');
    const contextSwitchResult = await benchmark(
      'Schema context switching',
      100,
      async () => {
        // Switch between schemas and query
        await setSearchPath(client, schema1);
        await client`SELECT COUNT(*) FROM dummy_table`;
        await setSearchPath(client, schema2);
        await client`SELECT COUNT(*) FROM dummy_table`;
      }
    );
    results.push(contextSwitchResult);
    printResult(contextSwitchResult);

    // ========================================================================
    // Benchmark 5: INSERT Performance
    // ========================================================================
    console.log('\nRunning Benchmark 5: INSERT operations...');
    const insertResult = await benchmark(
      'INSERT with search_path',
      50,
      async () => {
        await setSearchPath(client, schema1);
        await client`
          INSERT INTO dummy_table (name, value, description)
          VALUES ('Benchmark Item', 'Test Value', 'Benchmark Description')
        `;
      }
    );
    results.push(insertResult);
    printResult(insertResult);

    // ========================================================================
    // Summary: Calculate Overhead
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('📈 PERFORMANCE SUMMARY');
    console.log('='.repeat(60));

    const networkLatency = baselineResult.averageTime;
    const searchPathSwitchOverhead = switchOverheadResult.averageTime;
    const queryWithSearchPath = searchPathResult.averageTime;
    const queryWithSchemaQualified = schemaQualifiedResult.averageTime;

    // Calculate overhead breakdown
    const queryExecutionTime = queryWithSchemaQualified - networkLatency;
    const searchPathOverhead = searchPathSwitchOverhead - networkLatency;
    const totalSearchPathOverhead = queryWithSearchPath - queryWithSchemaQualified;

    console.log(`\n🔍 Overhead Breakdown:`);
    console.log(`   Baseline (network latency + simple query): ${formatTime(networkLatency)}`);
    console.log(`   Query execution time (dummy_table): ${formatTime(queryExecutionTime)}`);
    console.log(`   search_path switching overhead: ${formatTime(searchPathOverhead)}`);
    console.log(`   Total overhead (search_path + query): ${formatTime(totalSearchPathOverhead)}`);

    console.log(`\n📊 Query Performance Comparison:`);
    console.log(`   With search_path switch: ${formatTime(queryWithSearchPath)}`);
    console.log(`   Schema-qualified (no switch): ${formatTime(queryWithSchemaQualified)}`);
    console.log(`   Overhead: ${formatTime(totalSearchPathOverhead)} (${((totalSearchPathOverhead / queryWithSchemaQualified) * 100).toFixed(2)}%)`);

    if (totalSearchPathOverhead < 5) {
      console.log(`   ✅ search_path overhead is minimal (< 5ms)`);
    } else if (totalSearchPathOverhead < 15) {
      console.log(`   ⚠️  search_path overhead is acceptable (< 15ms)`);
    } else {
      console.log(`   ⚠️  search_path overhead is significant (> 15ms)`);
    }

    console.log(`\n⚡ Throughput Comparison:`);
    console.log(`   With search_path: ${formatOpsPerSec(searchPathResult.operationsPerSecond)}`);
    console.log(`   Schema-qualified: ${formatOpsPerSec(schemaQualifiedResult.operationsPerSecond)}`);
    console.log(`   Difference: ${((schemaQualifiedResult.operationsPerSecond - searchPathResult.operationsPerSecond) / searchPathResult.operationsPerSecond * 100).toFixed(2)}% slower with search_path`);

    console.log(`\n🔄 Schema Context Switching:`);
    console.log(`   Average: ${formatTime(contextSwitchResult.averageTime)}`);
    console.log(`   Throughput: ${formatOpsPerSec(contextSwitchResult.operationsPerSecond)}`);

    console.log(`\n💡 Key Insights:`);
    console.log(`   - search_path switching adds ~${formatTime(searchPathOverhead)} overhead per switch`);
    console.log(`   - Schema-qualified queries avoid search_path overhead but require schema name`);
    console.log(`   - Multi-schema approach has no RLS policy evaluation overhead`);
    console.log(`   - No transaction overhead (unlike RLS approach)`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Benchmarking Complete');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Benchmarking failed:', error);
    throw error;
  } finally {
    await cleanupTestData(client, schemaNames);
    await client.end();
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
