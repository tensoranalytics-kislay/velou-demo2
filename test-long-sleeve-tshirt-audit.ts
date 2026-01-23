import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testLongSleeveTShirt() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' }
  });
  
  if (!merchant) {
    console.error('Merchant not found');
    return;
  }
  
  const query = "hey I am looking for women's long sleeve t shirt";
  const sessionId = `test-longsleeve-${Date.now()}`;
  
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
              gender: true,
              sleeve: true,
              attributes: true,
            }
          });
          
          if (dbProduct) {
            // Check category
            const category = dbProduct.category || '';
            const subcategory = dbProduct.subcategory || '';
            const isTShirt = category.toLowerCase().includes('top') || 
                           category.toLowerCase().includes('tee') ||
                           subcategory.toLowerCase().includes('tee') ||
                           subcategory.toLowerCase().includes('t-shirt') ||
                           product.title.toLowerCase().includes('t-shirt') ||
                           product.title.toLowerCase().includes('tee');
            
            // Check gender
            const gender = dbProduct.gender || '';
            const isWomens = gender.toLowerCase().includes('women') || 
                           gender.toLowerCase().includes('female') ||
                           category.toLowerCase().includes('women');
            
            // Check sleeve length
            const sleeve = dbProduct.sleeve || '';
            const attrs = dbProduct.attributes && typeof dbProduct.attributes === 'object' 
              ? dbProduct.attributes as any 
              : {};
            const attrSleeve = attrs.sleeve || attrs.Sleeve || attrs.sleeveLength || attrs['Sleeve Length'] || '';
            const finalSleeve = sleeve || attrSleeve || '';
            const isLongSleeve = finalSleeve.toLowerCase().includes('long') ||
                               finalSleeve.toLowerCase().includes('three-quarter') ||
                               finalSleeve.toLowerCase().includes('3/4');
            
            console.log(`   Category: ${category}${subcategory ? ` / ${subcategory}` : ''}`);
            console.log(`   Gender: ${gender || 'N/A'}`);
            console.log(`   Sleeve: ${finalSleeve || 'N/A'}`);
            console.log(`   Is T-Shirt: ${isTShirt ? '✅ YES' : '❌ NO'}`);
            console.log(`   Is Women's: ${isWomens ? '✅ YES' : '❌ NO'}`);
            console.log(`   Is Long Sleeve: ${isLongSleeve ? '✅ YES' : '❌ NO'}`);
            
            // Overall match
            const matchesAll = isTShirt && isWomens && isLongSleeve;
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

testLongSleeveTShirt().catch(console.error);
