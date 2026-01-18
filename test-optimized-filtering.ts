/**
 * Test script to verify the optimized single-pass filtering works correctly
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_QUERY = "dresses that go well with Dr. Martens high top chelsea shoes";

async function testQuery() {
  console.log('🧪 Testing optimized post-SQL filtering...\n');
  console.log(`Query: "${TEST_QUERY}"`);
  console.log(`API URL: ${API_URL}/api/assistant\n`);

  const startTime = Date.now();

  try {
    const response = await fetch(`${API_URL}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: `test-${Date.now()}`,
        pageType: 'HOME',
        message: TEST_QUERY,
        history: [],
      }),
    });

    const duration = Date.now() - startTime;
    const result = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', response.status, result);
      return;
    }

    console.log('✅ API Response received');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Products returned: ${result.productCards?.length || 0}`);
    console.log(`   Reply length: ${result.replyText?.length || 0} chars`);
    
    if (result.productCards && result.productCards.length > 0) {
      console.log('\n📦 Sample products:');
      result.productCards.slice(0, 3).forEach((card: any, i: number) => {
        console.log(`   ${i + 1}. ${card.title?.substring(0, 60)}...`);
        console.log(`      ID: ${card.id}`);
      });
    }

    console.log('\n✅ Test completed successfully!');
    console.log('\n📋 Next: Check app.log for detailed execution logs');
    console.log('   Look for: buildDictionariesAndFilter logs');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
    }
  }
}

testQuery().catch(console.error);
