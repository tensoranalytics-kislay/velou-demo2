import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testPastelTops() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' }
  });
  
  if (!merchant) {
    console.error('Merchant not found');
    return;
  }
  
  const query = 'tops in pastel colours';
  const sessionId = `test-pastel-${Date.now()}`;
  
  console.log('='.repeat(80));
  console.log(`TESTING: "${query}"`);
  console.log('='.repeat(80));
  
  try {
    const result = await handleAssistantQuery(merchant.id, {
      message: query,
      sessionId,
      conversationContext: {},
    });
    
    console.log('\n📊 EXTRACTED CONSTRAINTS:');
    console.log('(Check logs above for detailed constraint extraction)');
    
    console.log('\n📦 RECOMMENDED PRODUCTS:');
    console.log(`Total Products: ${result.productCards?.length || 0}\n`);
    
    if (result.productCards && result.productCards.length > 0) {
        // Check each product's actual color in database
        for (let i = 0; i < result.productCards.length; i++) {
          const product = result.productCards[i];
          console.log(`${i + 1}. ${product.title}`);
          console.log(`   Product ID: ${product.id}`);
          console.log(`   Price: $${(product.priceCents / 100).toFixed(2)}`);
          if (product.reason) {
            console.log(`   Reason: ${product.reason}`);
          }
          
          // Check actual color from database
          if (product.id) {
            const dbProduct = await prisma.product.findUnique({
              where: { id: product.id },
            select: {
              color: true,
              enrichedColor: true,
              attributes: true,
            }
          });
          
          if (dbProduct) {
            const colors: string[] = [];
            if (dbProduct.color) colors.push(`color: ${dbProduct.color}`);
            if (dbProduct.enrichedColor) colors.push(`enrichedColor: ${dbProduct.enrichedColor}`);
            if (dbProduct.attributes && typeof dbProduct.attributes === 'object') {
              const attrs = dbProduct.attributes as any;
              if (attrs.Color) colors.push(`attributes.Color: ${Array.isArray(attrs.Color) ? attrs.Color.join(', ') : attrs.Color}`);
              if (attrs.color) colors.push(`attributes.color: ${Array.isArray(attrs.color) ? attrs.color.join(', ') : attrs.color}`);
            }
            
            console.log(`   Database Colors: ${colors.length > 0 ? colors.join(', ') : 'NONE'}`);
            
            // Check if colors contain pastel keywords
            const allColorText = colors.join(' ').toLowerCase();
            const pastelKeywords = ['pastel', 'pink', 'lavender', 'mint', 'peach', 'baby', 'soft', 'light', 'pale', 'powder', 'blush', 'rose', 'lilac', 'sage', 'cream', 'ivory'];
            const hasPastel = pastelKeywords.some(keyword => allColorText.includes(keyword));
            console.log(`   Is Pastel: ${hasPastel ? '✅ YES' : '❌ NO'}`);
          } else {
            console.log(`   Database Colors: NOT FOUND IN DATABASE`);
          }
        }
        console.log('');
      }
    } else {
      console.log('❌ No products returned');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPastelTops().catch(console.error);
