import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testSweatshirtWomen() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' }
  });
  
  if (!merchant) {
    console.error('Merchant not found');
    return;
  }
  
  const query = 'sweatshirt for women';
  const sessionId = `test-sweatshirt-${Date.now()}`;
  
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
              attributes: true,
            }
          });
          
          if (dbProduct) {
            // Check category
            const category = dbProduct.category || '';
            const subcategory = dbProduct.subcategory || '';
            const isSweatshirt = category.toLowerCase().includes('sweatshirt') || 
                                subcategory.toLowerCase().includes('sweatshirt') ||
                                product.title.toLowerCase().includes('sweatshirt') ||
                                product.title.toLowerCase().includes('sweat');
            
            // Check gender
            const gender = dbProduct.gender || '';
            const isWomens = gender.toLowerCase().includes('women') || 
                           gender.toLowerCase().includes('female') ||
                           category.toLowerCase().includes('women') ||
                           category.toLowerCase().includes('womens');
            
            console.log(`   Category: ${category}${subcategory ? ` / ${subcategory}` : ''}`);
            console.log(`   Gender: ${gender || 'N/A'}`);
            console.log(`   Is Sweatshirt: ${isSweatshirt ? '✅ YES' : '❌ NO'}`);
            console.log(`   Is Women's: ${isWomens ? '✅ YES' : '❌ NO'}`);
            
            // Overall match
            const matchesAll = isSweatshirt && isWomens;
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

testSweatshirtWomen().catch(console.error);
