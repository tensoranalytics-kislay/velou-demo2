/**
 * Direct test of the assistant pipeline for "do you have any aline dresses?"
 * This bypasses the HTTP layer and calls the orchestrator directly
 */

import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { prisma } from './src/lib/db';

async function testAlineQuery() {
  console.log('='.repeat(80));
  console.log('TESTING: "do you have any aline dresses?"');
  console.log('='.repeat(80));
  
  // Get default merchant
  const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
  if (!merchant) {
    console.error('❌ Default merchant not found');
    process.exit(1);
  }

  console.log(`\n✅ Using merchant: ${merchant.brandName} (${merchant.id})\n`);

  const sessionId = `test-aline-${Date.now()}`;
  
  const result = await handleLoveshackfancyQuery({
    sessionId,
    message: 'do you have any aline dresses?',
    merchantId: merchant.id,
    history: [],
    // conversationState removed - not part of AssistantQueryInput API
    merchantData: {
      brandName: merchant.brandName,
      voiceInstructions: merchant.voiceInstructions,
      datasetContext: merchant.datasetContext,
      faq: (merchant.faq as Array<{ question: string; answer: string }> | null) || null,
    },
  });

  console.log('\n' + '='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log('\nReply Text:', result.replyText);
  console.log('\nRoute:', result.route);
  console.log('\nResolved Constraints:', JSON.stringify(result.resolvedConstraints, null, 2));
  console.log('\nProduct Count:', result.productCards?.length || 0);
  
  if (result.productCards && result.productCards.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('PRODUCTS RETURNED');
    console.log('='.repeat(80));
    
    for (let i = 0; i < result.productCards.length; i++) {
      const product = result.productCards[i];
      console.log(`\n${i + 1}. ${product.title}`);
      console.log(`   ID: ${product.id}`);
      console.log(`   Price: ${product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'N/A'}`);
      console.log(`   Reason: ${product.reason || 'N/A'}`);
      console.log(`   Category: ${product.category || 'N/A'}`);
      
      // Check if product is actually "aline"
      const isAline = checkIfAline(product);
      console.log(`   ✅ Is A-Line: ${isAline ? 'YES' : 'NO'}`);
      
      if (product.attributes) {
        const attrs = product.attributes as any;
        console.log(`   SilhouetteCut: ${attrs.silhouetteCut || 'N/A'}`);
        console.log(`   Style Labels: ${attrs.style_labels || attrs.styleLabels || 'N/A'}`);
        console.log(`   Style: ${attrs.style || attrs.Style || 'N/A'}`);
      }
    }
    
    // Summary - check database directly since productCards don't include silhouetteCut
    const productIds = result.productCards.map(p => p.id);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true, silhouetteCut: true }
    });
    const alineCount = dbProducts.filter(p => 
      p.silhouetteCut && p.silhouetteCut.toLowerCase().includes('a-line')
    ).length;
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nTotal products: ${result.productCards.length}`);
    console.log(`A-Line products: ${alineCount}`);
    console.log(`Accuracy: ${((alineCount / result.productCards.length) * 100).toFixed(1)}%`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ Test complete!');
  console.log('='.repeat(80));
  console.log('\n📋 Check app.log for detailed constraint extraction logs');
  
  await prisma.$disconnect();
}

function checkIfAline(product: any): boolean {
  // Check multiple sources for A-Line indication
  const title = (product.title || '').toLowerCase();
  const description = (product.description || '').toLowerCase();
  const attrs = product.attributes || {};
  
  // Check title/description
  if (title.includes('a-line') || title.includes('aline') || 
      description.includes('a-line') || description.includes('aline')) {
    return true;
  }
  
  // Check silhouetteCut column (database column, not in attributes)
  const silhouetteCut = product.silhouetteCut || attrs.silhouetteCut;
  if (silhouetteCut && 
      (silhouetteCut.toLowerCase().includes('a-line') || 
       silhouetteCut.toLowerCase().includes('aline'))) {
    return true;
  }
  
  // Check style_labels
  const styleLabels = attrs.style_labels || attrs.styleLabels;
  if (styleLabels) {
    const labels = Array.isArray(styleLabels) ? styleLabels : [styleLabels];
    if (labels.some((l: string) => l && (l.toLowerCase().includes('a-line') || l.toLowerCase().includes('aline')))) {
      return true;
    }
  }
  
  // Check style attribute
  const style = attrs.style || attrs.Style;
  if (style) {
    const styles = Array.isArray(style) ? style : [style];
    if (styles.some((s: string) => s && (s.toLowerCase().includes('a-line') || s.toLowerCase().includes('aline')))) {
      return true;
    }
  }
  
  return false;
}

testAlineQuery().catch(console.error);
