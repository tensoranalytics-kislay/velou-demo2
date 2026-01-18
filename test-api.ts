/**
 * API Test Script
 * 
 * Tests the refactored pipeline by calling the API endpoint directly
 * Like a normal user would use the system
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// Test queries covering different scenarios
const TEST_QUERIES = [
  // Gender-specific queries (critical for testing gender-first pipeline)
  "Show me high-rise skinny jeans for women in dark colors",
  "Find me men's dress shirts",
  "I need a black dress for a wedding",
  
  // Age group queries
  "Show me summer dresses for kids",
  
  // Complex queries with multiple constraints
  "High-rise skinny jeans for women in dark colors, preferably vintage wash",
  
  // Simple queries
  "Show me dresses",
  "Jeans",
];

async function testQuery(query: string) {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  console.log(`\n📝 Testing: "${query}"`);
  
  try {
    const response = await fetch(`${API_BASE}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        pageType: 'HOME' as const,
        message: query,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    console.log(`   ⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📦 Products: ${result.productCards?.length || 0}`);
    console.log(`   ✅ Success: ${!result.noExactMatch ? 'Exact match' : 'No exact match'}`);
    console.log(`   📝 Reply length: ${result.replyText?.length || 0} chars`);
    
    if (result.productCards && result.productCards.length > 0) {
      console.log(`   🎯 First product: ${result.productCards[0].title?.substring(0, 50)}...`);
    }
    
    return {
      query,
      duration,
      productCount: result.productCards?.length || 0,
      success: response.ok,
      hasReply: !!result.replyText,
      noExactMatch: result.noExactMatch,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      query,
      duration,
      productCount: 0,
      success: false,
      hasReply: false,
      noExactMatch: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTests() {
  console.log('🚀 Starting API tests...\n');
  console.log(`📍 API Base: ${API_BASE}`);
  console.log('⏳ Waiting for server to be ready...\n');
  
  // Wait for server to be ready
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const healthCheck = await fetch(`${API_BASE}/api/health`);
      if (healthCheck.ok) {
        serverReady = true;
        console.log('✅ Server is ready!\n');
        break;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (!serverReady) {
    console.error('❌ Server not ready after 30 seconds. Please start it manually: npm run dev');
    process.exit(1);
  }
  
  const results: Array<{
    query: string;
    duration: number;
    productCount: number;
    success: boolean;
  }> = [];
  
  // Run queries sequentially
  for (const query of TEST_QUERIES) {
    const result = await testQuery(query);
    results.push(result);
    
    // Small delay between queries
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n\n📊 Test Summary');
  console.log('='.repeat(60));
  const successful = results.filter(r => r.success);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const avgProductCount = successful.reduce((sum, r) => sum + r.productCount, 0) / (successful.length || 1);
  
  console.log(`Total queries: ${results.length}`);
  console.log(`Successful: ${successful.length} ✅`);
  console.log(`Failed: ${results.length - successful.length} ❌`);
  console.log(`Average duration: ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`Average products per query: ${avgProductCount.toFixed(1)}`);
  
  console.log('\n💡 Next steps:');
  console.log('   1. Review logs in app.log for detailed execution traces');
  console.log('   2. Identify redundant code patterns');
  console.log('   3. Look for repeated operations that can be optimized');
  
  process.exit(0);
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
