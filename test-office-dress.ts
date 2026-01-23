import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';
import { getState } from './src/lib/chat/ConversationStateService';

async function testOfficeDress() {
  console.log('='.repeat(80));
  console.log('TESTING: Office Dress Query');
  console.log('='.repeat(80));
  console.log('\nQuery: "i am joining office next month, suggest me a dress to wear"\n');

  const sessionId = `test-office-dress-${Date.now()}`;
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

  try {
    const result = await handleAssistantQuery(merchantId, {
      message: 'i am joining office next month, suggest me a dress to wear',
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
      console.log('  Occasions:', cc.occasions || 'N/A');
      console.log('  Formality Level:', cc.formalityLevel || 'N/A');
      console.log('  Seasons:', cc.seasons || 'N/A');
      console.log('  Age Groups:', cc.ageGroups || 'N/A');
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
        
        // Colors - check both attributes.colors and enriched color fields
        if (result.resolvedConstraints?.colors && result.resolvedConstraints.colors.length > 0) {
          const productColors = attrs.colors || attrs.color || attrs.enrichedColor || [];
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
        
        // Materials
        if (result.resolvedConstraints?.materials && result.resolvedConstraints.materials.length > 0) {
          const productMaterials = attrs.materials || [];
          const materialMatch = result.resolvedConstraints.materials.some(m => 
            productMaterials.some((pm: string) => pm.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(pm.toLowerCase()))
          );
          console.log(`     Materials: ${materialMatch ? '✅' : '❌'} (Product: ${productMaterials.join(', ') || 'N/A'}, Query: ${result.resolvedConstraints.materials.join(', ')})`);
        }
        
        // Occasions - check attributes.occasion, attributes.occasions, and extensible fields
        if (result.resolvedConstraints?.occasions && result.resolvedConstraints.occasions.length > 0) {
          const productOccasions = attrs.occasion || attrs.occasions || attrs.occasionContext || [];
          const productOccasionArray = Array.isArray(productOccasions) ? productOccasions : [productOccasions].filter(Boolean);
          const occasionMatch = result.resolvedConstraints.occasions.some(o => 
            productOccasionArray.some((po: string) => po?.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(po?.toLowerCase()))
          );
          console.log(`     Occasions: ${occasionMatch ? '✅' : '❌'} (Product: ${productOccasionArray.join(', ') || 'N/A'}, Query: ${result.resolvedConstraints.occasions.join(', ')})`);
        }
        
        // Formality Level
        if (result.resolvedConstraints?.formalityLevel) {
          const productFormality = attrs.formalityLevel || attrs.formality || 'N/A';
          const formalityMatch = productFormality.toLowerCase().includes(result.resolvedConstraints.formalityLevel.toLowerCase()) ||
                                 result.resolvedConstraints.formalityLevel.toLowerCase().includes(productFormality.toLowerCase());
          console.log(`     Formality: ${formalityMatch ? '✅' : '❌'} (Product: ${productFormality}, Query: ${result.resolvedConstraints.formalityLevel})`);
        }
        
        // Lengths - check attributes.length, attributes.lengths, and silhouetteCut
        if (result.resolvedConstraints?.lengths && result.resolvedConstraints.lengths.length > 0) {
          const productLength = attrs.length || attrs.lengths?.[0] || product?.silhouetteCut || '';
          const productLengthStr = Array.isArray(productLength) ? productLength[0] : productLength;
          const titleLower = product?.title?.toLowerCase() || '';
          const lengthMatch = result.resolvedConstraints.lengths.some(l => {
            const lLower = l.toLowerCase();
            return productLengthStr?.toLowerCase().includes(lLower) || 
                   lLower.includes(productLengthStr?.toLowerCase()) ||
                   titleLower.includes(lLower);
          });
          console.log(`     Lengths: ${lengthMatch ? '✅' : '❌'} (Product: ${productLengthStr || 'N/A'}, Query: ${result.resolvedConstraints.lengths.join(', ')})`);
        }
        
        // Sleeve Lengths - check attributes.sleeve, attributes.sleeveLength, attributes.sleeveLengths
        if (result.resolvedConstraints?.sleeveLengths && result.resolvedConstraints.sleeveLengths.length > 0) {
          const productSleeveLength = attrs.sleeve || attrs.sleeveLength || attrs.sleeveLengths?.[0] || '';
          const productSleeveStr = Array.isArray(productSleeveLength) ? productSleeveLength[0] : productSleeveLength;
          const titleLower = product?.title?.toLowerCase() || '';
          const sleeveMatch = result.resolvedConstraints.sleeveLengths.some(s => {
            const sLower = s.toLowerCase();
            return productSleeveStr?.toLowerCase().includes(sLower) || 
                   sLower.includes(productSleeveStr?.toLowerCase()) ||
                   titleLower.includes(sLower);
          });
          console.log(`     Sleeve Lengths: ${sleeveMatch ? '✅' : '❌'} (Product: ${productSleeveStr || 'N/A'}, Query: ${result.resolvedConstraints.sleeveLengths.join(', ')})`);
        }
        
        // Necklines
        if (result.resolvedConstraints?.necklines && result.resolvedConstraints.necklines.length > 0) {
          const productNeckline = attrs.neckline || attrs.necklines?.[0] || '';
          const productNecklineStr = Array.isArray(productNeckline) ? productNeckline[0] : productNeckline;
          const necklineMatch = result.resolvedConstraints.necklines.some(n => 
            productNecklineStr?.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(productNecklineStr?.toLowerCase())
          );
          console.log(`     Necklines: ${necklineMatch ? '✅' : '❌'} (Product: ${productNecklineStr || 'N/A'}, Query: ${result.resolvedConstraints.necklines.join(', ')})`);
        }
        
        // Styles - check attributes.style, attributes.styles, styleTags, and silhouetteCut
        if (result.resolvedConstraints?.styles && result.resolvedConstraints.styles.length > 0) {
          const productStyle = attrs.style || attrs.styles?.[0] || result.resolvedConstraints.styleTags?.[0] || product?.silhouetteCut || '';
          const productStyleStr = Array.isArray(productStyle) ? productStyle[0] : productStyle;
          const styleMatch = result.resolvedConstraints.styles.some(s => 
            productStyleStr?.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(productStyleStr?.toLowerCase())
          );
          console.log(`     Styles: ${styleMatch ? '✅' : '❌'} (Product: ${productStyleStr || 'N/A'}, Query: ${result.resolvedConstraints.styles.join(', ')})`);
        }
        
        // Price Range
        if (result.resolvedConstraints?.priceMinCents || result.resolvedConstraints?.priceMaxCents) {
          const price = product?.priceCents || 0;
          const minMatch = !result.resolvedConstraints.priceMinCents || price >= result.resolvedConstraints.priceMinCents;
          const maxMatch = !result.resolvedConstraints.priceMaxCents || price <= result.resolvedConstraints.priceMaxCents;
          console.log(`     Price Range: ${minMatch && maxMatch ? '✅' : '❌'} (Product: $${price / 100}, Range: $${result.resolvedConstraints.priceMinCents ? result.resolvedConstraints.priceMinCents / 100 : 'any'}-$${result.resolvedConstraints.priceMaxCents ? result.resolvedConstraints.priceMaxCents / 100 : 'any'})`);
        }
        
        // Show reason
        if (card.reason) {
          console.log(`\n   Reason: ${card.reason}`);
        }
      }
    } else {
      console.log('\n⚠️  No products returned');
    }

    // Show reply text
    console.log('\n' + '='.repeat(80));
    console.log('ASSISTANT REPLY');
    console.log('='.repeat(80));
    console.log(result.replyText);
    if (result.replyTextAfter) {
      console.log(result.replyTextAfter);
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

testOfficeDress()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
