/**
 * Test different sample prompt with GPT-4.1-mini
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_QUERY = "I'm looking for a floral maxi dress for a summer beach wedding";

async function testPipeline() {
  console.log('🧪 Testing pipeline with sample prompt...\n');
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
        sessionId: `test-sample-${Date.now()}`,
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
    
    if (result.productCards && result.productCards.length > 0) {
      console.log('\n📦 Products Returned:');
      result.productCards.slice(0, 4).forEach((card: any, i: number) => {
        console.log(`   ${i + 1}. ${card.title?.substring(0, 70)}...`);
        console.log(`      ID: ${card.id}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('📋 Check logs for detailed stage-by-stage breakdown');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
    }
  }
}

testPipeline().catch(console.error);
