/**
 * Pipeline Test Script
 * 
 * Tests the refactored pipeline with various user queries
 * Monitors logs and identifies redundant code
 */

import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { prisma } from './src/lib/db';
import { logger } from './src/lib/telemetry/logger';

// Test queries covering different scenarios
const TEST_QUERIES = [
  // Gender-specific queries (critical for testing gender-first pipeline)
  "Show me high-rise skinny jeans for women in dark colors",
  "Find me men's dress shirts in blue",
  "I need a black dress for a wedding",
  
  // Age group queries
  "Show me summer dresses for kids",
  "I'm looking for baby clothes",
  
  // Complex queries with multiple constraints
  "High-rise skinny jeans for women in dark colors, preferably vintage wash",
  "Red maxi dresses with long sleeves for summer",
  "White cardigan sweater for office wear",
  
  // Simple queries
  "Show me dresses",
  "Jeans",
  "Tops",
];

async function runTestQuery(query: string, merchantId: string) {
  const sessionId = `test-session-${Date.now()}`;
  const startTime = Date.now();
  
  logger.info('test_query_starting', {
    query,
    sessionId,
    timestamp: new Date().toISOString(),
  });
  
  try {
    const result = await handleLoveshackfancyQuery({
      sessionId,
      message: query,
      merchantId,
      searchMethods: {
        lexical: false,
        semantic: true,
        concept: false,
      },
    });
    
    const duration = Date.now() - startTime;
    
    logger.info('test_query_complete', {
      query,
      sessionId,
      durationMs: duration,
      durationSeconds: (duration / 1000).toFixed(2),
      productCount: result.productCards.length,
      hasReplyText: !!result.replyText,
      replyLength: result.replyText?.length || 0,
      noExactMatch: result.noExactMatch,
      route: result.route,
    });
    
    return {
      query,
      duration,
      productCount: result.productCards.length,
      replyText: result.replyText,
      noExactMatch: result.noExactMatch,
      route: result.route,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('test_query_failed', {
      query,
      sessionId,
      durationMs: duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      query,
      duration,
      productCount: 0,
      replyText: '',
      noExactMatch: true,
      route: 'ERROR',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAllTests() {
  console.log('🚀 Starting pipeline tests...\n');
  
  // Get default merchant
  const defaultMerchant = await prisma.merchant.findUnique({ 
    where: { slug: 'default' } 
  });
  
  if (!defaultMerchant) {
    console.error('❌ Default merchant not found. Please seed the database.');
    process.exit(1);
  }
  
  console.log(`✅ Using merchant: ${defaultMerchant.id}\n`);
  
  const results: Array<{
    query: string;
    duration: number;
    productCount: number;
    success: boolean;
    error?: string;
  }> = [];
  
  // Run queries sequentially to monitor logs
  for (const query of TEST_QUERIES) {
    console.log(`\n📝 Testing: "${query}"`);
    const result = await runTestQuery(query, defaultMerchant.id);
    results.push(result);
    
    console.log(`   ⏱️  Duration: ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`   📦 Products: ${result.productCount}`);
    console.log(`   ${result.success ? '✅' : '❌'} ${result.success ? 'Success' : `Failed: ${result.error}`}`);
    
    // Small delay between queries to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n\n📊 Test Summary');
  console.log('='.repeat(60));
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const avgProductCount = successful.reduce((sum, r) => sum + r.productCount, 0) / (successful.length || 1);
  
  console.log(`Total queries: ${results.length}`);
  console.log(`Successful: ${successful.length} ✅`);
  console.log(`Failed: ${failed.length} ${failed.length > 0 ? '❌' : ''}`);
  console.log(`Average duration: ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`Average products per query: ${avgProductCount.toFixed(1)}`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed queries:');
    failed.forEach(f => {
      console.log(`   - "${f.query}": ${f.error}`);
    });
  }
  
  console.log('\n✅ Tests complete!');
  console.log('\n💡 Next steps:');
  console.log('   1. Review logs in app.log for detailed execution traces');
  console.log('   2. Identify redundant code patterns');
  console.log('   3. Look for repeated operations that can be optimized');
}

// Run tests
runAllTests()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
