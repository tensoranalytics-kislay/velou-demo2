import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function fixFalsePositives() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('Fetching all products with set_vs_single = "Set"...');
  
  // Get ALL products with set_vs_single = 'Set'
  const products = await prisma.$queryRaw<Array<{
    id: string;
    title: string;
    category: string;
    attributes: any;
    set_vs_single: string | null;
    pack_size: string | null;
  }>>`
    SELECT 
      id,
      title,
      category,
      attributes,
      attributes->>'set_vs_single' as "set_vs_single",
      attributes->>'pack_size' as "pack_size"
    FROM "Product"
    WHERE attributes->>'set_vs_single' = 'Set'
      AND "isActive" = true
      AND "merchantId" = ${merchantId}
    ORDER BY category, title
  `;
  
  console.log(`Analyzing ${products.length} products...`);
  
  const falsePositives: Array<{
    id: string;
    title: string;
    category: string;
    attributes: any;
  }> = [];
  
  products.forEach((p) => {
    const titleLower = p.title.toLowerCase();
    const hasPackKeyword = titleLower.includes('pack') || 
                          titleLower.includes('bundle') ||
                          titleLower.includes('multi') ||
                          titleLower.includes('pair') ||
                          /\d+-pack/i.test(p.title) ||
                          /\d+-piece/i.test(p.title) ||
                          /\d+-set/i.test(p.title);
    
    // Valid pack_size (not null, not empty, not 'O/S')
    const hasValidPackSize = p.pack_size && 
                            p.pack_size !== '' && 
                            p.pack_size !== 'O/S' &&
                            !isNaN(Number(p.pack_size));
    
    if (!hasPackKeyword && !hasValidPackSize) {
      falsePositives.push({
        id: p.id,
        title: p.title,
        category: p.category,
        attributes: p.attributes
      });
    }
  });
  
  console.log(`Found ${falsePositives.length} false positives to fix`);
  console.log();
  
  // Update each false positive
  let updatedCount = 0;
  let errorCount = 0;
  
  for (const product of falsePositives) {
    try {
      // Update the attributes JSONB field
      const updatedAttributes = {
        ...product.attributes,
        set_vs_single: 'Single'
      };
      
      await prisma.product.update({
        where: { id: product.id },
        data: {
          attributes: updatedAttributes
        }
      });
      
      updatedCount++;
      
      if (updatedCount % 20 === 0) {
        console.log(`Updated ${updatedCount}/${falsePositives.length} products...`);
      }
    } catch (error) {
      console.error(`Error updating product ${product.id} (${product.title}):`, error);
      errorCount++;
    }
  }
  
  console.log();
  console.log(`✅ Updated ${updatedCount} products`);
  if (errorCount > 0) {
    console.log(`❌ Errors: ${errorCount}`);
  }
  console.log();
  
  // Verify the changes
  console.log('Verifying changes...');
  const verifyProducts = await prisma.$queryRaw<Array<{
    id: string;
    title: string;
    set_vs_single: string | null;
  }>>`
    SELECT 
      id,
      title,
      attributes->>'set_vs_single' as "set_vs_single"
    FROM "Product"
    WHERE id = ANY(${falsePositives.map(p => p.id)}::text[])
  `;
  
  const stillSet = verifyProducts.filter(p => p.set_vs_single === 'Set');
  const nowSingle = verifyProducts.filter(p => p.set_vs_single === 'Single');
  
  console.log(`Verification Results:`);
  console.log(`  - Still "Set": ${stillSet.length}`);
  console.log(`  - Now "Single": ${nowSingle.length}`);
  console.log(`  - Total checked: ${verifyProducts.length}`);
  
  if (stillSet.length > 0) {
    console.log();
    console.log('Products still marked as "Set":');
    stillSet.forEach(p => {
      console.log(`  - ${p.title} (${p.id})`);
    });
  }
  
  if (nowSingle.length === falsePositives.length) {
    console.log();
    console.log('✅ All false positives successfully updated to "Single"!');
  }
  
  await prisma.$disconnect();
}

fixFalsePositives().catch(console.error);
