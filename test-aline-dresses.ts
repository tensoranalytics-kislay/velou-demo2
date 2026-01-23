import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

const query = "do you have any aline dresses?";

async function testAlineDresses() {
  console.log('================================================================================');
  console.log('TESTING: A-Line Dresses Query');
  console.log('================================================================================\n');
  console.log(`Query: "${query}"\n`);

  const sessionId = `test-aline-dresses-${Date.now()}`;
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

  try {
    const result = await handleAssistantQuery(merchantId, {
      message: query,
      sessionId,
    });

    console.log('\n' + '='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));

    // Get resolved constraints
    console.log('\n📋 RESOLVED CONSTRAINTS:');
    if (result.resolvedConstraints) {
      const c = result.resolvedConstraints;
      console.log('  Category:', c.category || 'N/A');
      console.log('  Colors:', c.colors?.join(', ') || 'N/A');
      console.log('  Styles:', c.styles?.join(', ') || 'N/A');
      console.log('  Age Groups:', c.ageGroups?.join(', ') || 'N/A');
    }

    // Get classification constraints
    console.log('\n📋 CLASSIFICATION CONSTRAINTS:');
    if (result.resolvedClassificationConstraints) {
      const cc = result.resolvedClassificationConstraints;
      console.log('  Styles:', cc.styles ? JSON.stringify(cc.styles) : 'N/A');
      console.log('  Age Groups:', cc.ageGroups ? JSON.stringify(cc.ageGroups) : 'N/A');
    }

    // Products returned
    console.log(`\n📦 PRODUCTS RETURNED: ${result.productCards.length}`);
    
    if (result.productCards.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('PRODUCT AUDIT');
      console.log('-'.repeat(80));

      // Get full product details from database
      const productIds = result.productCards.map(card => card.id);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
          priceCents: true,
          attributes: true,
          silhouetteCut: true,
          ageGroup: true,
        },
      });

      for (let i = 0; i < result.productCards.length; i++) {
        const card = result.productCards[i];
        const product = products.find(p => p.id === card.id);
        
        console.log(`\n${i + 1}. ${card.title || product?.title || 'N/A'}`);
        console.log(`   ID: ${card.id}`);
        console.log(`   Price: $${(product?.priceCents || 0) / 100}`);
        console.log(`   Category: ${product?.category || 'N/A'}`);
        
        // Check if it's actually A-Line
        const attrs = product?.attributes as any || {};
        const silhouetteCut = product?.silhouetteCut || attrs?.silhouetteCut || attrs?.style || '';
        const titleLower = product?.title?.toLowerCase() || '';
        const isAline = silhouetteCut?.toLowerCase().includes('a-line') || 
                       silhouetteCut?.toLowerCase().includes('aline') ||
                       titleLower.includes('a-line') ||
                       titleLower.includes('aline');
        
        console.log(`   SilhouetteCut: ${silhouetteCut || 'N/A'}`);
        console.log(`   Is A-Line: ${isAline ? '✅ YES' : '❌ NO'}`);
        
        // Check constraint matches
        console.log(`\n   CONSTRAINT MATCHES:`);
        
        // Category
        const categoryMatch = result.resolvedConstraints?.category 
          ? (Array.isArray(result.resolvedConstraints.category) 
              ? result.resolvedConstraints.category.includes(product?.category || '')
              : result.resolvedConstraints.category === product?.category)
          : null;
        console.log(`     Category: ${categoryMatch !== null ? (categoryMatch ? '✅' : '❌') : '✅'} (${product?.category || 'N/A'})`);
        
        // Style (A-Line)
        if (result.resolvedConstraints?.styles && result.resolvedConstraints.styles.length > 0) {
          const styleMatch = result.resolvedConstraints.styles.some(s => {
            const sLower = s.toLowerCase();
            return silhouetteCut?.toLowerCase().includes(sLower) || 
                   sLower.includes(silhouetteCut?.toLowerCase() || '') ||
                   titleLower.includes(sLower);
          });
          console.log(`     Style (A-Line): ${styleMatch ? '✅' : '❌'} (Product: ${silhouetteCut || 'N/A'}, Query: ${result.resolvedConstraints.styles.join(', ')})`);
        }
        
        // Age Group
        const ageGroupMatch = !product?.ageGroup || 
                             product.ageGroup.toLowerCase() === 'adult' ||
                             product.ageGroup.toLowerCase().includes('adult') ||
                             product?.category?.toLowerCase().includes('women');
        console.log(`     Age Group (Adult): ${ageGroupMatch ? '✅' : '❌'} (Product: ${product?.ageGroup || 'N/A'})`);
        
        console.log(`\n   Reason: ${card.reason || 'N/A'}`);
      }
      
      // Summary
      console.log('\n' + '='.repeat(80));
      console.log('AUDIT SUMMARY');
      console.log('='.repeat(80));
      
      let categoryMatches = 0;
      let styleMatches = 0;
      let ageGroupMatches = 0;
      let alineMatches = 0;
      let overallMatches = 0;
      
      for (const card of result.productCards) {
        const product = products.find(p => p.id === card.id);
        if (product) {
          const attrs = product.attributes as any || {};
          const silhouetteCut = product.silhouetteCut || attrs?.silhouetteCut || attrs?.style || '';
          const titleLower = product.title?.toLowerCase() || '';
          const isAline = silhouetteCut?.toLowerCase().includes('a-line') || 
                         silhouetteCut?.toLowerCase().includes('aline') ||
                         titleLower.includes('a-line') ||
                         titleLower.includes('aline');
          
          const categoryMatch = result.resolvedConstraints?.category 
            ? (Array.isArray(result.resolvedConstraints.category) 
                ? result.resolvedConstraints.category.includes(product.category || '')
                : result.resolvedConstraints.category === product.category)
            : true;
          
          const styleMatch = !result.resolvedConstraints?.styles || result.resolvedConstraints.styles.length === 0 ||
            result.resolvedConstraints.styles.some(s => {
              const sLower = s.toLowerCase();
              return silhouetteCut?.toLowerCase().includes(sLower) || 
                     sLower.includes(silhouetteCut?.toLowerCase() || '') ||
                     titleLower.includes(sLower);
            });
          
          const ageGroupMatch = !product.ageGroup || 
                               product.ageGroup.toLowerCase() === 'adult' ||
                               product.ageGroup.toLowerCase().includes('adult') ||
                               product.category?.toLowerCase().includes('women');
          
          if (categoryMatch) categoryMatches++;
          if (styleMatch) styleMatches++;
          if (ageGroupMatch) ageGroupMatches++;
          if (isAline) alineMatches++;
          if (categoryMatch && styleMatch && ageGroupMatch && isAline) overallMatches++;
        }
      }
      
      console.log(`\nTotal Products: ${result.productCards.length}`);
      console.log(`Category Match: ${categoryMatches}/${result.productCards.length} (${(categoryMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Style Match: ${styleMatches}/${result.productCards.length} (${(styleMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Age Group Match: ${ageGroupMatches}/${result.productCards.length} (${(ageGroupMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Actually A-Line: ${alineMatches}/${result.productCards.length} (${(alineMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Overall Match: ${overallMatches}/${result.productCards.length} (${(overallMatches/result.productCards.length*100).toFixed(1)}%)`);
    } else {
      console.log('\n⚠️  No products returned');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('ASSISTANT REPLY');
    console.log('='.repeat(80));
    console.log(`\n${result.replyText || 'N/A'}`);
    if (result.replyTextAfter) {
      console.log(`\n${result.replyTextAfter}`);
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

testAlineDresses().catch(console.error);
