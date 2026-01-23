/**
 * Test 4 queries with pre-built dictionary cache
 * Compare products and timing with previous results
 */

import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

const queries = [
  "I am a curvy mom/woman, suggest me a dress to wear.",
  "I am going to Bahamas for vacation, suggest me a dress.",
  "attending a black tie wedding, suggest me a dress.",
  "have dr.martens high top chelsea shoes, suggest me a dress that goes well with it"
];

const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

interface QueryResult {
  query: string;
  startTime: number;
  endTime: number;
  duration: number;
  productCount: number;
  productIds: string[];
  replyText: string;
  stages: {
    classification?: { start: number; end: number; duration: number };
    retrieval?: { start: number; end: number; duration: number };
    ranking?: { start: number; end: number; duration: number };
    reply?: { start: number; end: number; duration: number };
  };
}

async function runQuery(query: string, index: number): Promise<QueryResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Query ${index + 1}: ${query}`);
  console.log('='.repeat(80));
  
  const startTime = Date.now();
  const result: QueryResult = {
    query,
    startTime,
    endTime: 0,
    duration: 0,
    productCount: 0,
    productIds: [],
    replyText: '',
    stages: {},
  };

  try {
    const queryResult = await handleLoveshackfancyQuery({
      message: query,
      sessionId: `test-session-cache-${index}`,
      merchantId: merchantId,
    });

    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    result.productCount = queryResult.productCards?.length || 0;
    result.productIds = queryResult.productCards?.map(p => p.id) || [];
    result.replyText = queryResult.replyText || '';

    console.log(`\n✅ Completed in ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`   Products returned: ${result.productCount}`);
    console.log(`   Reply length: ${result.replyText.length} chars`);
    
    if (result.productIds.length > 0) {
      console.log(`   Sample product IDs: ${result.productIds.slice(0, 3).join(', ')}`);
    }

  } catch (error) {
    console.error(`❌ Error:`, error);
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
  }

  return result;
}

async function main() {
  console.log('🚀 Testing 4 queries with PRE-BUILT DICTIONARY CACHE');
  console.log('='.repeat(80));
  console.log(`Start time: ${new Date().toISOString()}\n`);

  const results: QueryResult[] = [];

  for (let i = 0; i < queries.length; i++) {
    const result = await runQuery(queries[i], i);
    results.push(result);
    
    // Small delay between queries
    if (i < queries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();

  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  const avgTime = totalTime / results.length;
  const totalProducts = results.reduce((sum, r) => sum + r.productCount, 0);

  console.log(`Total queries: ${results.length}`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Average time per query: ${(avgTime / 1000).toFixed(2)}s`);
  console.log(`Total products returned: ${totalProducts}`);
  console.log();

  console.log('Per-query breakdown:');
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${(r.duration / 1000).toFixed(2)}s - ${r.productCount} products - "${r.query.substring(0, 50)}..."`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log('PRODUCT IDS FOR COMPARISON');
  console.log('='.repeat(80));
  console.log();

  results.forEach((r, i) => {
    console.log(`Query ${i + 1}: ${r.productIds.length} products`);
    if (r.productIds.length > 0) {
      console.log(`  IDs: ${r.productIds.join(', ')}`);
    } else {
      console.log(`  (no products)`);
    }
    console.log();
  });

  // Save results to file for comparison
  const fs = await import('fs');
  const path = await import('path');
  const outputPath = path.join(process.cwd(), 'FOUR_QUERIES_TEST_WITH_CACHE.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      query: r.query,
      duration: r.duration,
      productCount: r.productCount,
      productIds: r.productIds,
      replyTextLength: r.replyText.length,
    })),
    summary: {
      totalQueries: results.length,
      totalTime: totalTime,
      averageTime: avgTime,
      totalProducts: totalProducts,
    }
  }, null, 2));

  console.log(`\n✅ Results saved to: ${outputPath}`);
  console.log(`\nEnd time: ${new Date().toISOString()}`);

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
