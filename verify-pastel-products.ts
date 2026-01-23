import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function verifyPastelProducts() {
  console.log('='.repeat(80));
  console.log('VERIFYING: Pastel Tops Products Quality');
  console.log('='.repeat(80));

  const queries = [
    'do you have any tops in pastel shades',
    'do you have any tops in pastel shades for women',
  ];

  for (const query of queries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Query: "${query}"`);
    console.log('='.repeat(80));

    try {
      const result = await handleAssistantQuery(
        'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
        {
          message: query,
          sessionId: `verify-pastel-${Date.now()}`,
        }
      );

      if (result.productCards && result.productCards.length > 0) {
        const productIds = result.productCards.map(p => p.id);
        const dbProducts = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            title: true,
            category: true,
            subcategory: true,
            enrichedColor: true,
            color: true,
            gender: true,
            priceCents: true,
            attributes: true,
            description: true,
          },
        });

        console.log(`\n📋 Detailed Product Verification:`);
        
        dbProducts.forEach((p, i) => {
          console.log(`\n   ${i + 1}. ${p.title}`);
          console.log(`      Category: ${p.category || 'N/A'}`);
          console.log(`      Subcategory: ${p.subcategory || 'N/A'}`);
          console.log(`      Gender: ${p.gender || 'N/A'}`);
          console.log(`      Price: $${((p.priceCents || 0) / 100).toFixed(2)}`);
          console.log(`      Color: ${p.enrichedColor || p.color || 'N/A'}`);
          
          // Check if it's actually a top
          const titleLower = (p.title || '').toLowerCase();
          const categoryLower = (p.category || '').toLowerCase();
          const isTop = categoryLower.includes('top') || 
                       titleLower.includes('top') || 
                       titleLower.includes('cardigan') ||
                       titleLower.includes('sweater') ||
                       titleLower.includes('tank') ||
                       titleLower.includes('blouse') ||
                       titleLower.includes('shirt');
          
          // Check if colors are actually pastel
          const colorStr = (p.enrichedColor || p.color || '').toLowerCase();
          const pastelKeywords = ['pastel', 'pale', 'soft', 'light', 'peach', 'lavender', 'mint', 'blush', 'powder', 'baby', 'angel', 'pearl', 'frozen', 'lychee'];
          const hasPastelColor = pastelKeywords.some(keyword => colorStr.includes(keyword));
          
          // Check if it's a light/soft color
          const lightColors = ['pink', 'blue', 'yellow', 'green', 'purple', 'lavender', 'mint', 'peach', 'blush', 'lemon', 'sky'];
          const hasLightColor = lightColors.some(color => colorStr.includes(color));
          
          console.log(`      ✅ Is Top: ${isTop ? 'YES' : 'NO'}`);
          console.log(`      ✅ Has Pastel Color: ${hasPastelColor ? 'YES' : 'NO'}`);
          console.log(`      ✅ Has Light Color: ${hasLightColor ? 'YES' : 'NO'}`);
          console.log(`      ✅ Overall Match: ${isTop && (hasPastelColor || hasLightColor) ? 'GOOD ✅' : 'QUESTIONABLE ⚠️'}`);
        });

        // Summary
        const allAreTops = dbProducts.every(p => {
          const titleLower = (p.title || '').toLowerCase();
          const categoryLower = (p.category || '').toLowerCase();
          return categoryLower.includes('top') || 
                 titleLower.includes('top') || 
                 titleLower.includes('cardigan') ||
                 titleLower.includes('sweater') ||
                 titleLower.includes('tank') ||
                 titleLower.includes('blouse') ||
                 titleLower.includes('shirt');
        });
        
        const allHavePastelColors = dbProducts.every(p => {
          const colorStr = (p.enrichedColor || p.color || '').toLowerCase();
          const pastelKeywords = ['pastel', 'pale', 'soft', 'light', 'peach', 'lavender', 'mint', 'blush', 'powder', 'baby', 'angel', 'pearl', 'frozen', 'lychee'];
          const lightColors = ['pink', 'blue', 'yellow', 'green', 'purple', 'lavender', 'mint', 'peach', 'blush', 'lemon', 'sky'];
          return pastelKeywords.some(k => colorStr.includes(k)) || 
                 lightColors.some(c => colorStr.includes(c));
        });

        console.log(`\n📊 Quality Summary:`);
        console.log(`   All Products Are Tops: ${allAreTops ? 'YES ✅' : 'NO ❌'}`);
        console.log(`   All Have Pastel/Light Colors: ${allHavePastelColors ? 'YES ✅' : 'NO ❌'}`);
        console.log(`   Overall Quality: ${allAreTops && allHavePastelColors ? 'EXCELLENT ✅' : 'NEEDS REVIEW ⚠️'}`);
      } else {
        console.log(`\n⚠️  No products returned`);
      }
    } catch (error: any) {
      console.error(`\n❌ ERROR: ${error.message}`);
    }
  }

  await prisma.$disconnect();
}

verifyPastelProducts().catch(console.error);
