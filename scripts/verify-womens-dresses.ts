import { prisma } from '../src/lib/db';

async function main() {
  console.log('🔍 Verifying Women\'s Dresses Category\n');
  console.log('='.repeat(80));
  
  // Get 100 random products with category "Women's Dresses"
  const allDresses = await prisma.product.findMany({
    where: {
      category: "Women's Dresses",
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      gender: true,
      ageGroup: true,
      subcategory: true,
      vendorId: true,
    },
    take: 1000, // Get more to sample randomly
  });

  // Randomly select 100
  const shuffled = allDresses.sort(() => 0.5 - Math.random());
  const sample = shuffled.slice(0, 100);

  console.log(`\n📊 Sample Size: 100 products (from ${allDresses.length} total "Women's Dresses")\n`);

  // Analyze the sample
  let confirmedWomens = 0;
  let hasWomensInTitle = 0;
  let hasDressInTitle = 0;
  let wrongGender = 0;
  let wrongAge = 0;
  let suspicious: Array<{ title: string; gender: string | null; ageGroup: string | null }> = [];

  console.log('📋 Sample Products (first 30):\n');
  sample.slice(0, 30).forEach((product, i) => {
    const title = product.title || 'No title';
    const hasWomen = /women|ladies|female/i.test(title);
    const hasDress = /dress/i.test(title);
    const isWomens = product.gender === 'female' || product.gender === 'F';
    const isAdult = !product.ageGroup || (product.ageGroup !== 'kids' && product.ageGroup !== 'baby');
    
    if (hasWomen) hasWomensInTitle++;
    if (hasDress) hasDressInTitle++;
    if (isWomens) confirmedWomens++;
    if (!isWomens && product.gender) wrongGender++;
    if (!isAdult) wrongAge++;
    
    if (!hasDress || !isWomens || !isAdult) {
      suspicious.push({
        title: title.substring(0, 60),
        gender: product.gender,
        ageGroup: product.ageGroup,
      });
    }

    console.log(`   ${(i + 1).toString().padStart(3)}. ${title.substring(0, 65)}${title.length > 65 ? '...' : ''}`);
    console.log(`        Gender: ${product.gender || 'null'} | Age: ${product.ageGroup || 'null'} | Subcategory: ${product.subcategory || 'none'}`);
  });

  // Statistics
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Analysis Results:\n');
  
  const allConfirmed = sample.filter(p => {
    const isWomens = p.gender === 'female' || p.gender === 'F';
    const isAdult = !p.ageGroup || (p.ageGroup !== 'kids' && p.ageGroup !== 'baby');
    const hasDress = /dress/i.test(p.title || '');
    return isWomens && isAdult && hasDress;
  }).length;

  console.log(`   ✅ Products with "Women's"/"Ladies" in title: ${hasWomensInTitle}/100`);
  console.log(`   ✅ Products with "dress" in title: ${hasDressInTitle}/100`);
  console.log(`   ✅ Products with gender=female: ${confirmedWomens}/100`);
  console.log(`   ✅ Products that are adult (not kids/baby): ${100 - wrongAge}/100`);
  console.log(`   ✅ Fully confirmed (female + adult + has "dress"): ${allConfirmed}/100`);

  if (wrongGender > 0) {
    console.log(`   ⚠️  Products with non-female gender: ${wrongGender}`);
  }
  if (wrongAge > 0) {
    console.log(`   ⚠️  Products with kids/baby age group: ${wrongAge}`);
  }

  // Show suspicious products
  if (suspicious.length > 0) {
    console.log(`\n⚠️  Potentially Suspicious Products (${suspicious.length}):\n`);
    suspicious.slice(0, 15).forEach((p, i) => {
      console.log(`   ${i + 1}. "${p.title}..."`);
      console.log(`      Gender: ${p.gender || 'null'}, Age: ${p.ageGroup || 'null'}`);
    });
    if (suspicious.length > 15) {
      console.log(`   ... and ${suspicious.length - 15} more`);
    }
  }

  // Subcategory distribution
  const subcategories = sample.reduce((acc, p) => {
    const sub = p.subcategory || 'None';
    acc[sub] = (acc[sub] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\n📋 Subcategory Distribution:\n`);
  Object.entries(subcategories)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sub, count]) => {
      console.log(`   ${sub.padEnd(30)} ${count} products`);
    });

  console.log('\n' + '='.repeat(80));
  const qualityScore = (allConfirmed / 100) * 100;
  console.log(`\n✅ Quality Score: ${qualityScore.toFixed(0)}% (${allConfirmed}/100 fully confirmed as women's adult dresses)`);
  
  if (qualityScore >= 95) {
    console.log('   🎉 Excellent! Category appears correctly normalized.\n');
  } else if (qualityScore >= 85) {
    console.log('   ✅ Good! Most products are correctly categorized.\n');
  } else {
    console.log('   ⚠️  Warning: Some products may be incorrectly categorized.\n');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
