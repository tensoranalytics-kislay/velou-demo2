import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testFloralDressQuery() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  const query = 'I am looking for a floral dress';
  
  console.log('='.repeat(80));
  console.log('Testing: "I am looking for a floral dress"');
  console.log('='.repeat(80));
  console.log();

  const startTime = Date.now();

  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      sessionId: 'test-floral-dress',
      merchantId: merchantId,
    });

    const duration = Date.now() - startTime;

    const productCards = result.productCards || [];

    console.log(`✅ Query completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`📊 Total products returned: ${productCards.length}`);
    console.log();

    if (productCards.length > 0) {
      console.log('📦 Products Returned:');
      productCards.forEach((p, idx) => {
        const brand = (p as any).brand || 'Unknown';
        console.log(`  ${idx + 1}. ${p.title}`);
        console.log(`     Brand: ${brand}`);
        console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        if (p.reason) {
          console.log(`     Reason: ${p.reason.substring(0, 80)}...`);
        }
        console.log();
      });
    } else {
      console.log('❌ No products returned');
      console.log();
      console.log('Checking reply text for clarification or error messages...');
      if (result.replyText) {
        console.log(`Reply: ${result.replyText.substring(0, 200)}...`);
      }
      if (result.followupText) {
        console.log(`Follow-up: ${result.followupText.substring(0, 200)}...`);
      }
    }

    console.log();
    console.log('='.repeat(80));
    console.log('Query Details:');
    console.log('='.repeat(80));
    console.log(`Route: ${result.route || 'N/A'}`);
    console.log(`No Exact Match: ${result.noExactMatch || false}`);
    console.log(`Resolved Constraints:`, JSON.stringify(result.resolvedConstraints, null, 2));

  } catch (error) {
    console.error(`❌ Error:`, error);
  }

  process.exit(0);
}

testFloralDressQuery().catch(console.error);
