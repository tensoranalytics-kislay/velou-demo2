/**
 * Full pipeline test with LLM calls for Dr. Martens query
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_QUERY = "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it";

async function testFullPipeline() {
  console.log('🧪 Testing FULL PIPELINE with LLM calls...\n');
  console.log(`Query: "${TEST_QUERY}"`);
  console.log(`API URL: ${API_URL}/api/assistant\n`);
  console.log('⏱️  Starting timer...\n');

  const startTime = Date.now();

  try {
    const response = await fetch(`${API_URL}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: `test-dr-martens-${Date.now()}`,
        pageType: 'HOME',
        message: TEST_QUERY,
        history: [],
      }),
    });

    const endTime = Date.now();
    const duration = endTime - startTime;
    const result = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', response.status, result);
      return;
    }

    console.log('='.repeat(80));
    console.log('✅ PIPELINE EXECUTION COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n⏱️  Total Pipeline Duration: ${duration}ms (${(duration/1000).toFixed(2)}s)`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Products returned: ${result.productCards?.length || 0}`);
    console.log(`   Reply length: ${result.replyText?.length || 0} chars`);
    console.log(`   No exact match: ${result.noExactMatch || false}`);
    
    if (result.productCards && result.productCards.length > 0) {
      console.log('\n📦 Products Returned:');
      result.productCards.forEach((card: any, i: number) => {
        console.log(`\n   ${i + 1}. ${card.title || 'Unknown'}`);
        console.log(`      ID: ${card.id}`);
        console.log(`      Price: ${card.priceCents ? `$${(card.priceCents/100).toFixed(2)}` : 'N/A'}`);
      });
    } else {
      console.log('\n⚠️  No products returned - check if clarification was triggered');
    }

    console.log('\n' + '='.repeat(80));
    console.log('📋 Next: Check detailed logs in app.log for stage-by-stage breakdown');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
    }
  }
}

testFullPipeline().catch(console.error);
