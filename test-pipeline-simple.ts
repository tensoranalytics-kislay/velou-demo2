import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

const testQueries = [
  // VAGUE QUERIES
  { name: 'Vague 1: Soft summer dress', query: 'I need something soft and flowy for a summer garden party. Show me dresses.', type: 'vague' },
  { name: 'Vague 2: Elegant evening', query: 'Looking for something elegant for a formal event. I prefer dresses.', type: 'vague' },
  { name: 'Vague 3: Comfortable casual', query: 'I want something comfortable and casual for everyday wear. Show me dresses.', type: 'vague' },
  { name: 'Vague 4: Romantic date night', query: 'Help me find a romantic dress for a special date night.', type: 'vague' },
  
  // DIRECT QUERIES
  { name: 'Direct 1: Blue maxi', query: 'Do you have any blue maxi dresses?', type: 'direct' },
  { name: 'Direct 2: White A-line wedding', query: 'I need a white A-line wedding dress.', type: 'direct' },
  { name: 'Direct 3: Pink floral midi', query: 'Show me pink floral midi dresses.', type: 'direct' },
  { name: 'Direct 4: Black cocktail', query: 'I need a black cocktail dress for a party. Size medium.', type: 'direct' },
];

async function runTest(test: typeof testQueries[0], index: number) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST ${index + 1}/8: ${test.name}`);
  console.log(`Query: "${test.query}"`);
  console.log('='.repeat(80));

  try {
    const result = await handleAssistantQuery(
      'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      {
        message: test.query,
        sessionId: `test-${Date.now()}-${index}`,
      }
    );

    const productCount = result.productCards?.length || 0;
    const constraints = result.resolvedConstraints || {};
    
    console.log(`\n✅ SUCCESS`);
    console.log(`   Products: ${productCount}`);
    console.log(`   Colors: ${constraints.colors?.join(', ') || 'N/A'}`);
    console.log(`   Styles: ${constraints.styleTags?.join(', ') || 'N/A'}`);
    console.log(`   Lengths: ${constraints.lengths?.join(', ') || 'N/A'}`);
    
    if (productCount > 0) {
      const productIds = result.productCards!.map(p => p.id);
      const dbProducts = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true, category: true, enrichedColor: true, silhouetteCut: true, length: true }
      });
      
      console.log(`\n   Top Products:`);
      dbProducts.slice(0, 3).forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.title}`);
        console.log(`      Color: ${p.enrichedColor || 'N/A'}, Style: ${p.silhouetteCut || 'N/A'}, Length: ${p.length || 'N/A'}`);
      });
    }

    return { success: true, productCount, constraints };
  } catch (error: any) {
    console.log(`\n❌ ERROR: ${error.message}`);
    return { success: false, productCount: 0, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('PIPELINE TEST - 8 Queries (4 Vague + 4 Direct)');
  console.log('='.repeat(80));

  const results = [];
  for (let i = 0; i < testQueries.length; i++) {
    const result = await runTest(testQueries[i], i);
    results.push(result);
    // Small delay between tests
    if (i < testQueries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  const successCount = results.filter(r => r.success).length;
  const totalProducts = results.reduce((sum, r) => sum + r.productCount, 0);
  console.log(`\n✅ Passed: ${successCount}/8`);
  console.log(`📦 Total Products: ${totalProducts}`);
  console.log(`📊 Avg Products/Query: ${(totalProducts / results.length).toFixed(1)}`);

  await prisma.$disconnect();
}

main().catch(console.error);
