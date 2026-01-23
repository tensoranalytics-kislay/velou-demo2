import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

const query = "hey I am looking for women's long sleeve t shirt";

async function testQuery() {
  console.log('================================================================================');
  console.log('TESTING QUERY');
  console.log('================================================================================\n');
  console.log(`Query: "${query}"\n`);
  
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  const sessionId = `test-long-sleeve-${Date.now()}`;
  
  const result = await handleAssistantQuery(merchantId, {
      message: query,
    sessionId,
  });
  
  console.log('================================================================================');
  console.log('RESULTS');
  console.log('================================================================================\n');
  
  console.log('📋 RESOLVED CONSTRAINTS:');
  if (result.resolvedConstraints) {
    const c = result.resolvedConstraints;
    console.log(`  Category: ${c.category || 'N/A'}`);
    console.log(`  Gender: ${c.genders?.join(', ') || 'N/A'}`);
    console.log(`  Sleeve Lengths: ${c.sleeveLengths?.join(', ') || 'N/A'}`);
    console.log(`  Colors: ${c.colors?.join(', ') || 'N/A'}`);
    console.log(`  Age Groups: ${c.ageGroups?.join(', ') || 'N/A'}`);
  } else {
    console.log('  N/A');
  }
  
  console.log('\n📋 CLASSIFICATION CONSTRAINTS:');
  if (result.resolvedClassificationConstraints) {
    const cc = result.resolvedClassificationConstraints;
    console.log(`  Sleeve Lengths: ${cc.sleeveLengths ? JSON.stringify(cc.sleeveLengths) : 'N/A'}`);
    console.log(`  Colors: ${cc.colors ? JSON.stringify(cc.colors) : 'N/A'}`);
    console.log(`  Age Groups: ${cc.ageGroups ? JSON.stringify(cc.ageGroups) : 'N/A'}`);
  } else {
    console.log('  N/A');
  }
  
  console.log(`\n📦 PRODUCTS RETURNED: ${result.productCards?.length || 0}\n`);
  
  if (result.productCards && result.productCards.length > 0) {
    console.log('================================================================================');
    console.log('PRODUCT AUDIT');
    console.log('================================================================================\n');
    
    for (let i = 0; i < result.productCards.length; i++) {
      const card = result.productCards[i];
      console.log(`${i + 1}. ${card.title}`);
      console.log(`   ID: ${card.id}`);
      console.log(`   Price: ${card.price || 'N/A'}`);
      
      // Fetch full product details from database
      const dbProduct = await prisma.product.findUnique({
        where: { id: card.id },
        select: {
          category: true,
          subcategory: true,
          attributes: true,
          ageGroup: true,
          sleeve: true,
        },
      });
      
      if (dbProduct) {
        console.log(`   Category: ${dbProduct.category || 'N/A'}`);
        console.log(`   Subcategory: ${dbProduct.subcategory || 'N/A'}`);
        console.log(`   AgeGroup: ${dbProduct.ageGroup || 'N/A'}`);
        
        // Check attributes and database columns
        const attributes = dbProduct.attributes as any;
        // Check database column first (primary source), then attributes (fallback)
        const sleeve = (dbProduct as any).sleeve || attributes?.sleeve || attributes?.sleeveLength || attributes?.extensible?.sleeve || attributes?.extensible?.sleeveLength;
        const color = attributes?.enriched_color || attributes?.color || attributes?.extensible?.color;
        const gender = attributes?.gender || attributes?.extensible?.gender;
        
        console.log(`   Sleeve Length: ${sleeve || 'N/A'}`);
        console.log(`   Color: ${color || 'N/A'}`);
        console.log(`   Gender (from attributes): ${gender || 'N/A'}`);
        
        // Audit matches
        console.log(`\n   CONSTRAINT MATCHES:`);
        
        // Check gender
        const expectedGender = 'female';
        const genderMatch = dbProduct.category?.toLowerCase().includes('women') || 
                           dbProduct.category?.toLowerCase().includes('womens') ||
                           gender?.toLowerCase() === 'female' ||
                           gender?.toLowerCase() === 'women';
        console.log(`     Gender: ${genderMatch ? '✅' : '❌'} (Expected: ${expectedGender}, Product: ${dbProduct.category || gender || 'N/A'})`);
        
        // Check sleeve length
        const expectedSleeve = 'Long';
        const sleeveMatch = sleeve && (
          sleeve.toLowerCase().includes('long') ||
          sleeve.toLowerCase() === 'long sleeve' ||
          sleeve.toLowerCase() === 'long-sleeve' ||
          sleeve.toLowerCase() === 'full sleeve' ||
          sleeve.toLowerCase() === 'full-sleeve'
        );
        console.log(`     Sleeve Length: ${sleeveMatch ? '✅' : '❌'} (Expected: Long, Product: ${sleeve || 'N/A'})`);
        
        // Check category (should be t-shirt related)
        const categoryMatch = dbProduct.category?.toLowerCase().includes('tee') ||
                             dbProduct.category?.toLowerCase().includes('t-shirt') ||
                             dbProduct.category?.toLowerCase().includes('shirt') ||
                             dbProduct.category?.toLowerCase().includes('top');
        console.log(`     Category (T-shirt/Top): ${categoryMatch ? '✅' : '❌'} (Product: ${dbProduct.category || 'N/A'})`);
        
        // Check age group (should be Adult)
        const ageGroupMatch = !dbProduct.ageGroup || 
                             dbProduct.ageGroup.toLowerCase() === 'adult' ||
                             dbProduct.ageGroup.toLowerCase().includes('adult') ||
                             dbProduct.category?.toLowerCase().includes('women');
        console.log(`     Age Group (Adult): ${ageGroupMatch ? '✅' : '❌'} (Product: ${dbProduct.ageGroup || 'N/A'})`);
        
        // Overall match
        const overallMatch = genderMatch && sleeveMatch && categoryMatch && ageGroupMatch;
        console.log(`\n     Overall Match: ${overallMatch ? '✅ PASS' : '❌ FAIL'}`);
      }
      
      console.log(`\n   Reason: ${card.reason || 'N/A'}\n`);
      console.log('─'.repeat(80));
      console.log('');
    }
    
    // Summary
    console.log('\n================================================================================');
    console.log('AUDIT SUMMARY');
    console.log('================================================================================\n');
    
    let genderMatches = 0;
    let sleeveMatches = 0;
    let categoryMatches = 0;
    let ageGroupMatches = 0;
    let overallMatches = 0;
    
    for (const card of result.productCards) {
      const dbProduct = await prisma.product.findUnique({
        where: { id: card.id },
        select: {
          category: true,
          attributes: true,
          ageGroup: true,
          sleeve: true,
        },
      });
      
      if (dbProduct) {
        const attributes = dbProduct.attributes as any;
        // Check database column first (primary source), then attributes (fallback)
        const sleeve = (dbProduct as any).sleeve || attributes?.sleeve || attributes?.sleeveLength || attributes?.extensible?.sleeve || attributes?.extensible?.sleeveLength;
        
        const genderMatch = dbProduct.category?.toLowerCase().includes('women') || 
                           dbProduct.category?.toLowerCase().includes('womens');
        const sleeveMatch = sleeve && (
          sleeve.toLowerCase().includes('long') ||
          sleeve.toLowerCase() === 'long sleeve' ||
          sleeve.toLowerCase() === 'long-sleeve'
        );
        const categoryMatch = dbProduct.category?.toLowerCase().includes('tee') ||
                             dbProduct.category?.toLowerCase().includes('t-shirt') ||
                             dbProduct.category?.toLowerCase().includes('shirt') ||
                             dbProduct.category?.toLowerCase().includes('top');
        const ageGroupMatch = !dbProduct.ageGroup || 
                             dbProduct.ageGroup.toLowerCase() === 'adult' ||
                             dbProduct.ageGroup.toLowerCase().includes('adult') ||
                             dbProduct.category?.toLowerCase().includes('women');
        
        if (genderMatch) genderMatches++;
        if (sleeveMatch) sleeveMatches++;
        if (categoryMatch) categoryMatches++;
        if (ageGroupMatch) ageGroupMatches++;
        if (genderMatch && sleeveMatch && categoryMatch && ageGroupMatch) overallMatches++;
      }
    }
    
    console.log(`Total Products: ${result.productCards.length}`);
    console.log(`Gender Match: ${genderMatches}/${result.productCards.length} (${(genderMatches/result.productCards.length*100).toFixed(1)}%)`);
    console.log(`Sleeve Length Match: ${sleeveMatches}/${result.productCards.length} (${(sleeveMatches/result.productCards.length*100).toFixed(1)}%)`);
    console.log(`Category Match: ${categoryMatches}/${result.productCards.length} (${(categoryMatches/result.productCards.length*100).toFixed(1)}%)`);
    console.log(`Age Group Match: ${ageGroupMatches}/${result.productCards.length} (${(ageGroupMatches/result.productCards.length*100).toFixed(1)}%)`);
    console.log(`Overall Match: ${overallMatches}/${result.productCards.length} (${(overallMatches/result.productCards.length*100).toFixed(1)}%)`);
  } else {
    console.log('⚠️  No products returned\n');
  }
  
  console.log('\n================================================================================');
  console.log('ASSISTANT REPLY');
  console.log('================================================================================\n');
  console.log(result.replyText || 'N/A');
  if (result.replyTextAfter) {
    console.log('\n' + result.replyTextAfter);
  }
  
  await prisma.$disconnect();
  console.log('\n✅ Test complete');
}

testQuery().catch(console.error);
