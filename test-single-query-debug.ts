import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSingleQuery() {
  const query = 'do you have any aline dresses?';
  
  console.log('='.repeat(100));
  console.log(`Testing: "${query}"`);
  console.log('='.repeat(100));
  
  const result = await handleLoveshackfancyQuery({
    message: query,
    sessionId: `test-debug-${Date.now()}`,
    merchantId: 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
  });
  
  console.log('\n📊 RESULT SUMMARY:');
  console.log('-'.repeat(100));
  console.log(`Products returned: ${result.productCards?.length || 0}`);
  console.log(`\nConstraints in ranking:`);
  console.log(JSON.stringify(result.constraintsPassedToRanking, null, 2));
  console.log(`\nResolved constraints:`);
  console.log(JSON.stringify(result.resolvedConstraints, null, 2));
  
  if (result.productCards && result.productCards.length > 0) {
    console.log(`\nTop 3 Products:`);
    result.productCards.slice(0, 3).forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.title}`);
    });
  }
  
  await prisma.$disconnect();
}

testSingleQuery().catch(console.error);
