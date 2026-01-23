import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testAlineDresses() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' }
  });
  
  if (!merchant) {
    console.error('Merchant not found');
    return;
  }
  
  const query = 'do you have any aline dresses?';
  const sessionId = `test-aline-${Date.now()}`;
  
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
      // Check each product's actual attributes in database
      for (let i = 0; i < result.productCards.length; i++) {
        const product = result.productCards[i];
        console.log(`${i + 1}. ${product.title}`);
        console.log(`   Product ID: ${product.id}`);
        console.log(`   Price: $${(product.priceCents / 100).toFixed(2)}`);
        if (product.reason) {
          console.log(`   Reason: ${product.reason}`);
        }
        
        // Check actual attributes from database
        if (product.id) {
          const dbProduct = await prisma.product.findUnique({
            where: { id: product.id },
            select: {
              category: true,
              subcategory: true,
              silhouetteCut: true,
              attributes: true,
            }
          });
          
          if (dbProduct) {
            // Check category
            const category = dbProduct.category || '';
            const subcategory = dbProduct.subcategory || '';
            const isDress = category.toLowerCase().includes('dress') || 
                           subcategory.toLowerCase().includes('dress') ||
                           product.title.toLowerCase().includes('dress');
            
            // Check if A-line
            const silhouetteCut = dbProduct.silhouetteCut || '';
            const attrs = dbProduct.attributes && typeof dbProduct.attributes === 'object' 
              ? dbProduct.attributes as any 
              : {};
            const attrSilhouette = attrs.silhouetteCut || attrs.Silhouette || attrs.silhouette || attrs['Silhouette Cut'] || '';
            const finalSilhouette = silhouetteCut || attrSilhouette || '';
            
            // Check for A-line in various forms
            const isAline = finalSilhouette.toLowerCase().includes('a-line') ||
                           finalSilhouette.toLowerCase().includes('aline') ||
                           finalSilhouette.toLowerCase().includes('a line') ||
                           product.title.toLowerCase().includes('a-line') ||
                           product.title.toLowerCase().includes('aline') ||
                           product.title.toLowerCase().includes('a line');
            
            console.log(`   Category: ${category}${subcategory ? ` / ${subcategory}` : ''}`);
            console.log(`   Silhouette Cut: ${finalSilhouette || 'N/A'}`);
            console.log(`   Is Dress: ${isDress ? '✅ YES' : '❌ NO'}`);
            console.log(`   Is A-Line: ${isAline ? '✅ YES' : '❌ NO'}`);
            
            // Overall match
            const matchesAll = isDress && isAline;
            console.log(`   Matches All Requirements: ${matchesAll ? '✅ YES' : '❌ NO'}`);
          } else {
            console.log(`   Database Info: NOT FOUND IN DATABASE`);
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

testAlineDresses().catch(console.error);
