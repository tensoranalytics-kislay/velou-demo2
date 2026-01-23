import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testOfficeDressQuery() {
  const query = "I am joining office next month, suggest me a dress to wear";
  const sessionId = `test-office-dress-${Date.now()}`;
  
  console.log('='.repeat(80));
  console.log('TESTING: Office Dress Query');
  console.log('='.repeat(80));
  console.log(`Query: "${query}"`);
  console.log(`Session ID: ${sessionId}`);
  console.log('');

  // Get default merchant
  const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
  if (!merchant) {
    console.error('❌ Default merchant not found');
    process.exit(1);
  }

  console.log(`✅ Using merchant: ${merchant.brandName} (${merchant.id})\n`);

  try {
    const result = await handleAssistantQuery(merchant.id, {
      sessionId,
      message: query,
      pageType: 'HOME' as const,
      history: [],
      conversationContext: {},
    });

    console.log('='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log(`Reply Text: ${result.replyText}`);
    console.log('');
    console.log(`Products Returned: ${result.productCards?.length || 0}`);
    console.log('');

    if (result.productCards && result.productCards.length > 0) {
      console.log('RECOMMENDED PRODUCTS:');
      console.log('='.repeat(80));
      
      result.productCards.forEach((product, index) => {
        console.log(`\n${index + 1}. ${product.title}`);
        console.log(`   ID: ${product.id}`);
        console.log(`   Price: $${(product.priceCents / 100).toFixed(2)}`);
        if (product.salePriceCents) {
          console.log(`   Sale Price: $${(product.salePriceCents / 100).toFixed(2)}`);
        }
        console.log(`   Reason: ${product.reason}`);
        console.log(`   Attributes:`);
        if (product.attributes) {
          if (product.attributes.color) console.log(`     - Color: ${product.attributes.color}`);
          if (product.attributes.material) console.log(`     - Material: ${product.attributes.material}`);
          if (product.attributes.length) console.log(`     - Length: ${product.attributes.length}`);
          if (product.attributes.sleeve) console.log(`     - Sleeve: ${product.attributes.sleeve}`);
          if (product.attributes.neckline) console.log(`     - Neckline: ${product.attributes.neckline}`);
          if (product.attributes.style) console.log(`     - Style: ${product.attributes.style}`);
          if (product.attributes.occasion) console.log(`     - Occasion: ${product.attributes.occasion}`);
          if (product.attributes.season) console.log(`     - Season: ${product.attributes.season}`);
        }
        console.log(`   URL: ${product.productUrl}`);
      });

      // Audit products in database
      console.log('\n' + '='.repeat(80));
      console.log('DATABASE AUDIT');
      console.log('='.repeat(80));
      
      for (const product of result.productCards) {
        const dbProduct = await prisma.product.findUnique({
          where: { id: product.id },
          select: {
            id: true,
            title: true,
            category: true,
            subcategory: true,
            color: true,
            enrichedColor: true,
            material: true,
            fabric: true,
            occasion: true,
            occasionContext: true,
            season: true,
            fit: true,
            length: true,
            sleeve: true,
            neckline: true,
            silhouetteCut: true,
            formalityLevel: true,
            priceCents: true,
            salePriceCents: true,
          },
        });

        if (dbProduct) {
          console.log(`\nProduct: ${dbProduct.title}`);
          console.log(`  Category: ${dbProduct.category} / ${dbProduct.subcategory || 'N/A'}`);
          console.log(`  Color: ${dbProduct.color || 'N/A'} / Enriched: ${dbProduct.enrichedColor || 'N/A'}`);
          console.log(`  Material: ${dbProduct.material || 'N/A'} / Fabric: ${dbProduct.fabric || 'N/A'}`);
          console.log(`  Occasion: ${dbProduct.occasion || 'N/A'} / OccasionContext: ${JSON.stringify(dbProduct.occasionContext || [])}`);
          console.log(`  Season: ${dbProduct.season || 'N/A'}`);
          console.log(`  Fit: ${dbProduct.fit || 'N/A'}`);
          console.log(`  Length: ${dbProduct.length || 'N/A'}`);
          console.log(`  Sleeve: ${dbProduct.sleeve || 'N/A'}`);
          console.log(`  Neckline: ${dbProduct.neckline || 'N/A'}`);
          console.log(`  SilhouetteCut: ${dbProduct.silhouetteCut || 'N/A'}`);
          console.log(`  FormalityLevel: ${dbProduct.formalityLevel || 'N/A'}`);
          console.log(`  Price: $${(dbProduct.priceCents / 100).toFixed(2)}`);
        } else {
          console.log(`\nProduct ${product.id} not found in database`);
        }
      }
    } else {
      console.log('NO PRODUCTS RETURNED');
    }

    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('ERROR:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

testOfficeDressQuery();
