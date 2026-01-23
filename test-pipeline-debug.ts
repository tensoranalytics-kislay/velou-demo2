import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testPipeline() {
  // Get merchant ID
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' }
  });
  
  if (!merchant) {
    console.error('Merchant not found');
    return;
  }
  
  const merchantId = merchant.id;
  const sessionId = `debug-test-${Date.now()}`;
  
  console.log('='.repeat(80));
  console.log('TEST 1: Office Dress Query');
  console.log('='.repeat(80));
  
  const query1 = "I am joining office next month, suggest me a dress to wear";
  
  try {
    const result1 = await handleAssistantQuery(merchantId, {
      message: query1,
      sessionId,
      conversationContext: {},
    });
    
    console.log('\n📊 RESULTS:');
    console.log(`Products Returned: ${result1.productCards?.length || 0}`);
    if (result1.productCards && result1.productCards.length > 0) {
      console.log('\nTop 3 Products:');
      result1.productCards.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Simple Dress Query');
  console.log('='.repeat(80));
  
  const query2 = "show me dresses";
  
  try {
    const result2 = await handleAssistantQuery(merchantId, {
      message: query2,
      sessionId: `${sessionId}-2`,
      conversationContext: {},
    });
    
    console.log('\n📊 RESULTS:');
    console.log(`Products Returned: ${result2.productCards?.length || 0}`);
    if (result2.productCards && result2.productCards.length > 0) {
      console.log('\nTop 3 Products:');
      result2.productCards.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Pastel Tops Query');
  console.log('='.repeat(80));
  
  const query3 = "do you have any tops in pastel shades";
  
  try {
    const result3 = await handleAssistantQuery(merchantId, {
      message: query3,
      sessionId: `${sessionId}-3`,
      conversationContext: {},
    });
    
    console.log('\n📊 RESULTS:');
    console.log(`Products Returned: ${result3.productCards?.length || 0}`);
    if (result3.productCards && result3.productCards.length > 0) {
      console.log('\nTop 3 Products:');
      result3.productCards.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  await prisma.$disconnect();
}

testPipeline().catch(console.error);
