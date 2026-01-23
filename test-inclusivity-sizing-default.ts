import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testInclusivitySizingDefault() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

  console.log('='.repeat(80));
  console.log('Testing inclusivitySizing Default Behavior');
  console.log('='.repeat(80));
  console.log();

  // Test 1: Normal dress query (should default to "Standard Sizing")
  console.log('TEST 1: Normal dress query (should default to "Standard Sizing")');
  console.log('-'.repeat(80));
  const query1 = "I want a blue dress";
  console.log(`Query: "${query1}"`);
  console.log();

  try {
    const result1 = await handleLoveshackfancyQuery({
      message: query1,
      sessionId: 'test-session-normal-dress',
      merchantId: merchantId,
    });

    console.log('✅ Query 1 completed');
    console.log(`  Products returned: ${result1.productCards?.length || 0}`);
    console.log();
  } catch (error) {
    console.error('❌ Query 1 error:', error);
  }

  console.log();
  console.log('='.repeat(80));
  console.log();

  // Test 2: Curvy query (should extract "Plus Size" and override default)
  console.log('TEST 2: Curvy query (should extract "Plus Size" and override default)');
  console.log('-'.repeat(80));
  const query2 = "I am a curvy woman, suggest me a dress";
  console.log(`Query: "${query2}"`);
  console.log();

  try {
    const result2 = await handleLoveshackfancyQuery({
      message: query2,
      sessionId: 'test-session-curvy-dress',
      merchantId: merchantId,
    });

    console.log('✅ Query 2 completed');
    console.log(`  Products returned: ${result2.productCards?.length || 0}`);
    console.log();
  } catch (error) {
    console.error('❌ Query 2 error:', error);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('Test completed. Check logs above for inclusivitySizing filter behavior.');
  console.log('='.repeat(80));

  process.exit(0);
}

testInclusivitySizingDefault();
