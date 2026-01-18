import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

async function testCurvyMomQuery() {
  console.log('='.repeat(80));
  console.log('Testing: "I am a curvy mom, suggest me a dress"');
  console.log('='.repeat(80));
  console.log();

  const query = "I am a curvy mom, suggest me a dress";
  
  // Use the actual merchant ID from database (slug='default')
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      sessionId: 'test-session-curvy-mom',
      merchantId: merchantId,
    });

    console.log('✅ Query completed successfully\n');
    
    console.log('📊 Results Summary:');
    console.log(`  Products returned: ${result.productCards?.length || 0}`);
    console.log(`  Has reply: ${!!result.replyText}`);
    console.log();

    if (result.productCards && result.productCards.length > 0) {
      console.log('📦 Sample Products:');
      result.productCards.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
        console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        console.log(`     Category: ${p.category}`);
        console.log(`     inclusivitySizing: ${(p as any).inclusivitySizing || 'null'}`);
        console.log();
      });
    }

    console.log('💬 Reply Preview:');
    console.log(result.replyText?.substring(0, 200) || 'No reply');
    console.log();

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    process.exit(0);
  }
}

testCurvyMomQuery();
