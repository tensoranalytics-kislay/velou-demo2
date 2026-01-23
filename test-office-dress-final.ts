import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

const query = "i am joining office next month, suggest me a dress to wear";

async function testOfficeDress() {
  console.log('================================================================================');
  console.log('TESTING: Office Dress Query');
  console.log('================================================================================\n');
  console.log(`Query: "${query}"\n`);

  const sessionId = `test-office-dress-final-${Date.now()}`;
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
      console.log('  Materials:', c.materials?.join(', ') || 'N/A');
      console.log('  Patterns:', c.patterns?.join(', ') || 'N/A');
      console.log('  Occasions:', c.occasions?.join(', ') || 'N/A');
      console.log('  Seasons:', c.seasons?.join(', ') || 'N/A');
      console.log('  Formality Level:', c.formalityLevel || 'N/A');
      console.log('  Lengths:', c.lengths?.join(', ') || 'N/A');
      console.log('  Sleeve Lengths:', c.sleeveLengths?.join(', ') || 'N/A');
      console.log('  Necklines:', c.necklines?.join(', ') || 'N/A');
      console.log('  Fits:', c.fits?.join(', ') || 'N/A');
      console.log('  Styles:', c.styles?.join(', ') || 'N/A');
      console.log('  Price Min:', c.priceMinCents ? `$${c.priceMinCents / 100}` : 'N/A');
      console.log('  Price Max:', c.priceMaxCents ? `$${c.priceMaxCents / 100}` : 'N/A');
    }

    // Get classification constraints
    console.log('\n📋 CLASSIFICATION CONSTRAINTS:');
    if (result.resolvedClassificationConstraints) {
      const cc = result.resolvedClassificationConstraints;
      console.log('  Occasions:', cc.occasions ? JSON.stringify(cc.occasions) : 'N/A');
      console.log('  Formality Level:', cc.formalityLevel ? JSON.stringify(cc.formalityLevel) : 'N/A');
      console.log('  Seasons:', cc.seasons ? JSON.stringify(cc.seasons) : 'N/A');
      console.log('  Age Groups:', cc.ageGroups ? JSON.stringify(cc.ageGroups) : 'N/A');
      console.log('  Sleeve Lengths:', cc.sleeveLengths ? JSON.stringify(cc.sleeveLengths) : 'N/A');
    }

    // Get enhanced query
    console.log('\n📝 ENHANCED QUERY:');
    console.log(`  "${result.enhancedQuery || 'N/A'}"`);

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
          occasionContext: true,
          sleeve: true,
          length: true,
          neckline: true,
          formalityLevel: true,
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
        console.log(`   Subcategory: ${product?.subcategory || 'N/A'}`);
        
        // Check constraint matches
        const attrs = product?.attributes as any || {};
        console.log(`\n   CONSTRAINT MATCHES:`);
        
        // Category
        const categoryMatch = result.resolvedConstraints?.category 
          ? (Array.isArray(result.resolvedConstraints.category) 
              ? result.resolvedConstraints.category.includes(product?.category || '')
              : result.resolvedConstraints.category === product?.category)
          : null;
        console.log(`     Category: ${categoryMatch !== null ? (categoryMatch ? '✅' : '❌') : '✅'} (${product?.category || 'N/A'})`);
        
        // Occasions - check occasionContext column (PRIMARY SOURCE)
        if (result.resolvedConstraints?.occasions && result.resolvedConstraints.occasions.length > 0) {
          const productOccasions = product?.occasionContext || [];
          const productOccasionArray = Array.isArray(productOccasions) ? productOccasions : [productOccasions].filter(Boolean);
          const occasionMatch = result.resolvedConstraints.occasions.some(o => 
            productOccasionArray.some((po: string) => po?.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(po?.toLowerCase()))
          );
          console.log(`     Occasions: ${occasionMatch ? '✅' : '❌'} (Product: ${productOccasionArray.join(', ') || 'N/A'}, Query: ${result.resolvedConstraints.occasions.join(', ')})`);
        }
        
        // Sleeve Lengths - check sleeve column (PRIMARY SOURCE)
        if (result.resolvedConstraints?.sleeveLengths && result.resolvedConstraints.sleeveLengths.length > 0) {
          const productSleeve = product?.sleeve || attrs?.sleeve || attrs?.sleeveLength || '';
          const sleeveMatch = result.resolvedConstraints.sleeveLengths.some(s => {
            const sLower = s.toLowerCase();
            return productSleeve?.toLowerCase().includes(sLower) || sLower.includes(productSleeve?.toLowerCase() || '');
          });
          console.log(`     Sleeve Lengths: ${sleeveMatch ? '✅' : '❌'} (Product: ${productSleeve || 'N/A'}, Query: ${result.resolvedConstraints.sleeveLengths.join(', ')})`);
        }
        
        // Colors
        if (result.resolvedConstraints?.colors && result.resolvedConstraints.colors.length > 0) {
          const productColors = attrs.enriched_color || attrs.color || attrs.enrichedColor || [];
          const productColorArray = Array.isArray(productColors) ? productColors : [productColors].filter(Boolean);
          const productColorStr = product?.title?.toLowerCase() || '';
          const colorMatch = result.resolvedConstraints.colors.some(c => {
            const cLower = c.toLowerCase();
            return productColorArray.some((pc: string) => 
              pc?.toLowerCase().includes(cLower) || cLower.includes(pc?.toLowerCase())
            ) || productColorStr.includes(cLower);
          });
          console.log(`     Colors: ${colorMatch ? '✅' : '❌'} (Product: ${productColorArray.join(', ') || productColorStr || 'N/A'}, Query: ${result.resolvedConstraints.colors.join(', ')})`);
        }
        
        // Formality Level
        if (result.resolvedConstraints?.formalityLevel) {
          const productFormality = product?.formalityLevel || attrs.formalityLevel || attrs.formality || 'N/A';
          const formalityMatch = productFormality.toLowerCase().includes(result.resolvedConstraints.formalityLevel.toLowerCase()) ||
                                 result.resolvedConstraints.formalityLevel.toLowerCase().includes(productFormality.toLowerCase());
          console.log(`     Formality: ${formalityMatch ? '✅' : '❌'} (Product: ${productFormality}, Query: ${result.resolvedConstraints.formalityLevel})`);
        }
        
        // Lengths - check length column (PRIMARY SOURCE)
        if (result.resolvedConstraints?.lengths && result.resolvedConstraints.lengths.length > 0) {
          const productLength = product?.length || attrs.length || attrs.lengths?.[0] || product?.silhouetteCut || '';
          const productLengthStr = Array.isArray(productLength) ? productLength[0] : productLength;
          const titleLower = product?.title?.toLowerCase() || '';
          const lengthMatch = result.resolvedConstraints.lengths.some(l => {
            const lLower = l.toLowerCase();
            return productLengthStr?.toLowerCase().includes(lLower) || 
                   lLower.includes(productLengthStr?.toLowerCase() || '') ||
                   titleLower.includes(lLower);
          });
          console.log(`     Lengths: ${lengthMatch ? '✅' : '❌'} (Product: ${productLengthStr || 'N/A'}, Query: ${result.resolvedConstraints.lengths.join(', ')})`);
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
      let occasionMatches = 0;
      let sleeveMatches = 0;
      let colorMatches = 0;
      let formalityMatches = 0;
      let lengthMatches = 0;
      let ageGroupMatches = 0;
      let overallMatches = 0;
      
      for (const card of result.productCards) {
        const product = products.find(p => p.id === card.id);
        if (product) {
          const attrs = product.attributes as any || {};
          
          const categoryMatch = result.resolvedConstraints?.category 
            ? (Array.isArray(result.resolvedConstraints.category) 
                ? result.resolvedConstraints.category.includes(product.category || '')
                : result.resolvedConstraints.category === product.category)
            : true;
          
          const productOccasions = product.occasionContext || [];
          const productOccasionArray = Array.isArray(productOccasions) ? productOccasions : [productOccasions].filter(Boolean);
          const occasionMatch = !result.resolvedConstraints?.occasions || result.resolvedConstraints.occasions.length === 0 ||
            result.resolvedConstraints.occasions.some(o => 
              productOccasionArray.some((po: string) => po?.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(po?.toLowerCase()))
            );
          
          const productSleeve = product.sleeve || attrs?.sleeve || '';
          const sleeveMatch = !result.resolvedConstraints?.sleeveLengths || result.resolvedConstraints.sleeveLengths.length === 0 ||
            result.resolvedConstraints.sleeveLengths.some(s => {
              const sLower = s.toLowerCase();
              return productSleeve?.toLowerCase().includes(sLower) || sLower.includes(productSleeve?.toLowerCase() || '');
            });
          
          const productColors = attrs.enriched_color || attrs.color || [];
          const productColorArray = Array.isArray(productColors) ? productColors : [productColors].filter(Boolean);
          const colorMatch = !result.resolvedConstraints?.colors || result.resolvedConstraints.colors.length === 0 ||
            result.resolvedConstraints.colors.some(c => {
              const cLower = c.toLowerCase();
              return productColorArray.some((pc: string) => 
                pc?.toLowerCase().includes(cLower) || cLower.includes(pc?.toLowerCase())
              );
            });
          
          const productFormality = product.formalityLevel || attrs.formalityLevel || '';
          const formalityMatch = !result.resolvedConstraints?.formalityLevel ||
            productFormality.toLowerCase().includes(result.resolvedConstraints.formalityLevel.toLowerCase()) ||
            result.resolvedConstraints.formalityLevel.toLowerCase().includes(productFormality.toLowerCase());
          
          const productLength = product.length || attrs.length || '';
          const lengthMatch = !result.resolvedConstraints?.lengths || result.resolvedConstraints.lengths.length === 0 ||
            result.resolvedConstraints.lengths.some(l => {
              const lLower = l.toLowerCase();
              return productLength?.toLowerCase().includes(lLower) || lLower.includes(productLength?.toLowerCase() || '');
            });
          
          const ageGroupMatch = !product.ageGroup || 
                               product.ageGroup.toLowerCase() === 'adult' ||
                               product.ageGroup.toLowerCase().includes('adult') ||
                               product.category?.toLowerCase().includes('women');
          
          if (categoryMatch) categoryMatches++;
          if (occasionMatch) occasionMatches++;
          if (sleeveMatch) sleeveMatches++;
          if (colorMatch) colorMatches++;
          if (formalityMatch) formalityMatches++;
          if (lengthMatch) lengthMatches++;
          if (ageGroupMatch) ageGroupMatches++;
          if (categoryMatch && occasionMatch && sleeveMatch && colorMatch && formalityMatch && lengthMatch && ageGroupMatch) overallMatches++;
        }
      }
      
      console.log(`\nTotal Products: ${result.productCards.length}`);
      console.log(`Category Match: ${categoryMatches}/${result.productCards.length} (${(categoryMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Occasion Match: ${occasionMatches}/${result.productCards.length} (${(occasionMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Sleeve Length Match: ${sleeveMatches}/${result.productCards.length} (${(sleeveMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Color Match: ${colorMatches}/${result.productCards.length} (${(colorMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Formality Match: ${formalityMatches}/${result.productCards.length} (${(formalityMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Length Match: ${lengthMatches}/${result.productCards.length} (${(lengthMatches/result.productCards.length*100).toFixed(1)}%)`);
      console.log(`Age Group Match: ${ageGroupMatches}/${result.productCards.length} (${(ageGroupMatches/result.productCards.length*100).toFixed(1)}%)`);
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

testOfficeDress().catch(console.error);
