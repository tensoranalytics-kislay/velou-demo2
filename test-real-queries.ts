/**
 * Real Query Testing Script
 * Runs actual queries with full LLM calls and analyzes results
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// Diverse real-world queries to test
const REAL_QUERIES = [
  {
    query: "Show me high-rise skinny jeans for women in dark colors",
    expected: {
      gender: "female",
      category: "jeans",
      colors: ["dark", "black", "navy"],
      fit: "skinny",
      rise: "high-rise"
    }
  },
  {
    query: "I need a black dress for a wedding",
    expected: {
      gender: "female",
      category: "dress",
      colors: ["black"],
      occasion: "wedding",
      formality: "formal"
    }
  },
  {
    query: "Find me summer dresses for kids",
    expected: {
      ageGroup: "kids",
      category: "dress",
      season: "summer"
    }
  },
  {
    query: "Show me casual t-shirts for men",
    expected: {
      gender: "male",
      category: "t-shirt",
      style: "casual"
    }
  },
  {
    query: "I want a floral maxi dress in pastel colors",
    expected: {
      gender: "female",
      category: "dress",
      pattern: "floral",
      length: "maxi",
      colors: ["pastel", "pink", "lavender", "mint"]
    }
  },
  {
    query: "Find me workout leggings in black or navy",
    expected: {
      category: "leggings",
      colors: ["black", "navy"],
      occasion: "workout"
    }
  }
];

async function testQuery(testCase: typeof REAL_QUERIES[0], index: number) {
  const sessionId = `real-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📝 Test ${index + 1}/${REAL_QUERIES.length}`);
  console.log(`Query: "${testCase.query}"`);
  console.log(`Expected: ${JSON.stringify(testCase.expected, null, 2)}`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    const response = await fetch(`${API_BASE}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        pageType: 'HOME' as const,
        message: testCase.query,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    console.log(`\n⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`📦 Products returned: ${result.productCards?.length || 0}`);
    console.log(`✅ Success: ${!result.noExactMatch ? 'Exact match' : 'No exact match'}`);
    
    // Analyze products
    if (result.productCards && result.productCards.length > 0) {
      console.log(`\n📋 Product Analysis:`);
      result.productCards.forEach((card: any, idx: number) => {
        console.log(`\n  Product ${idx + 1}:`);
        console.log(`    Title: ${card.title}`);
        console.log(`    Price: $${((card.priceCents || 0) / 100).toFixed(2)}`);
        console.log(`    Reason: ${card.reason || 'N/A'}`);
        if (card.keyAttributes && card.keyAttributes.length > 0) {
          console.log(`    Attributes: ${card.keyAttributes.join(', ')}`);
        }
      });
      
      // Check if products match expected criteria
      console.log(`\n🔍 Quality Check:`);
      const products = result.productCards;
      
      // Check gender
      if (testCase.expected.gender) {
        const genderMatch = products.some((p: any) => {
          const title = (p.title || '').toLowerCase();
          return title.includes('women') || title.includes('womens') || 
                 title.includes('men') || title.includes('mens') ||
                 title.includes('girls') || title.includes('boys');
        });
        console.log(`  Gender match: ${genderMatch ? '✅' : '❌'} (expected: ${testCase.expected.gender})`);
      }
      
      // Check category
      if (testCase.expected.category) {
        const categoryMatch = products.some((p: any) => {
          const title = (p.title || '').toLowerCase();
          const category = testCase.expected.category!.toLowerCase();
          return title.includes(category) || title.includes(category + 's');
        });
        console.log(`  Category match: ${categoryMatch ? '✅' : '❌'} (expected: ${testCase.expected.category})`);
      }
      
      // Check colors
      if (testCase.expected.colors) {
        const colorMatch = products.some((p: any) => {
          const title = (p.title || '').toLowerCase();
          return testCase.expected.colors!.some(color => title.includes(color.toLowerCase()));
        });
        console.log(`  Color match: ${colorMatch ? '✅' : '❌'} (expected: ${testCase.expected.colors.join(' or ')})`);
      }
      
      // Check pattern
      if (testCase.expected.pattern) {
        const patternMatch = products.some((p: any) => {
          const title = (p.title || '').toLowerCase();
          return title.includes(testCase.expected.pattern!.toLowerCase());
        });
        console.log(`  Pattern match: ${patternMatch ? '✅' : '❌'} (expected: ${testCase.expected.pattern})`);
      }
      
      // Check occasion
      if (testCase.expected.occasion) {
        const occasionMatch = products.some((p: any) => {
          const reason = (p.reason || '').toLowerCase();
          return reason.includes(testCase.expected.occasion!.toLowerCase());
        });
        console.log(`  Occasion match: ${occasionMatch ? '✅' : '❌'} (expected: ${testCase.expected.occasion})`);
      }
    } else {
      console.log(`\n⚠️  No products returned`);
    }
    
    if (result.replyText) {
      console.log(`\n💬 Reply: ${result.replyText.substring(0, 200)}...`);
    }
    
    return {
      query: testCase.query,
      duration,
      productCount: result.productCards?.length || 0,
      success: response.ok,
      products: result.productCards || [],
      reply: result.replyText,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      query: testCase.query,
      duration,
      productCount: 0,
      success: false,
      products: [],
      reply: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTests() {
  console.log('🚀 Starting Real Query Tests with Full LLM Calls...\n');
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
  
  const results: any[] = [];
  
  // Run queries sequentially with delays
  for (let i = 0; i < REAL_QUERIES.length; i++) {
    const testCase = REAL_QUERIES[i];
    const result = await testQuery(testCase, i);
    results.push(result);
    
    // Delay between queries to avoid rate limiting
    if (i < REAL_QUERIES.length - 1) {
      console.log(`\n⏳ Waiting 5 seconds before next query...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 Test Summary');
  console.log('='.repeat(80));
  const successful = results.filter(r => r.success);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const avgProductCount = successful.reduce((sum, r) => sum + r.productCount, 0) / (successful.length || 1);
  
  console.log(`Total queries: ${results.length}`);
  console.log(`Successful: ${successful.length} ✅`);
  console.log(`Failed: ${results.length - successful.length} ❌`);
  console.log(`Average duration: ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`Average products per query: ${avgProductCount.toFixed(1)}`);
  
  console.log('\n📋 Detailed Results:');
  results.forEach((r, i) => {
    console.log(`\n  ${i + 1}. "${r.query.substring(0, 60)}..."`);
    console.log(`     Products: ${r.productCount}, Duration: ${(r.duration / 1000).toFixed(2)}s, Success: ${r.success ? '✅' : '❌'}`);
    if (r.products && r.products.length > 0) {
      console.log(`     First product: ${r.products[0].title?.substring(0, 50)}...`);
    }
  });
  
  console.log('\n💡 Next steps:');
  console.log('   1. Review logs in app.log for detailed pipeline execution');
  console.log('   2. Check if products match query intent');
  console.log('   3. Verify gender filtering is working correctly');
  console.log('   4. Check constraint matching accuracy');
  
  process.exit(0);
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
