import { prisma } from './src/lib/db';

async function checkProductAttributes() {
  const productIds = ['100041500', '100042209', '200697000', '200769000'];
  
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      attributes: true,
      silhouetteCut: true,
    },
  });

  console.log('='.repeat(80));
  console.log('PRODUCT ATTRIBUTES FROM DATABASE');
  console.log('='.repeat(80));

  for (const product of products) {
    console.log(`\n${product.title}`);
    console.log(`ID: ${product.id}`);
    console.log(`Category: ${product.category}`);
    console.log(`Subcategory: ${product.subcategory}`);
    console.log(`Silhouette Cut: ${product.silhouetteCut || 'N/A'}`);
    
    const attrs = product.attributes as any || {};
    console.log('\nAttributes:');
    console.log(`  Color: ${attrs.color || attrs.colors || 'N/A'}`);
    console.log(`  Occasion: ${attrs.occasion || attrs.occasions || 'N/A'}`);
    console.log(`  Length: ${attrs.length || attrs.lengths || 'N/A'}`);
    console.log(`  Sleeve: ${attrs.sleeve || attrs.sleeveLength || attrs.sleeveLengths || 'N/A'}`);
    console.log(`  Style: ${attrs.style || attrs.styles || 'N/A'}`);
    console.log(`  Formality: ${attrs.formalityLevel || attrs.formality || 'N/A'}`);
    console.log(`  Season: ${attrs.season || attrs.seasons || 'N/A'}`);
    console.log(`  Age Group: ${attrs.ageGroup || attrs.ageGroups || 'N/A'}`);
    
    // Show all keys
    console.log(`\n  All attribute keys: ${Object.keys(attrs).join(', ')}`);
  }

  await prisma.$disconnect();
}

checkProductAttributes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
