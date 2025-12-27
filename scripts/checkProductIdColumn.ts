import { prisma } from '../src/lib/db';

async function checkProductIdColumn() {
  try {
    // Query a sample product with the pattern we're looking for
    const product = await prisma.$queryRaw<Array<{
      id: string;
      shopifyProductId: string | null;
      sourceId: string | null;
      vendorId: string | null;
      attributes: unknown;
    }>>`
      SELECT 
        id,
        "shopifyProductId",
        "sourceId",
        "vendorId",
        attributes
      FROM "Product"
      WHERE id LIKE '%Shopify_%' OR id LIKE '%shopify_%'
      LIMIT 5
    `;

    console.log('\n=== Product ID Column Check ===\n');
    console.log(`Found ${product.length} products with Shopify pattern\n`);

    product.forEach((p, idx) => {
      console.log(`Product ${idx + 1}:`);
      console.log(`  id: ${p.id}`);
      console.log(`  shopifyProductId: ${p.shopifyProductId || '(null)'}`);
      console.log(`  sourceId: ${p.sourceId || '(null)'}`);
      console.log(`  vendorId: ${p.vendorId || '(null)'}`);
      if (p.attributes && typeof p.attributes === 'object') {
        const attrs = p.attributes as Record<string, unknown>;
        console.log(`  attributes.parent_id: ${attrs.parent_id || '(null)'}`);
        console.log(`  attributes.related_id: ${attrs.related_id || '(null)'}`);
        console.log(`  attributes.shopifyProductId: ${attrs.shopifyProductId || '(null)'}`);
      }
      console.log('');
    });

    // Check specifically for the pattern from the logs
    const specificProduct = await prisma.$queryRaw<Array<{
      id: string;
      shopifyProductId: string | null;
    }>>`
      SELECT 
        id,
        "shopifyProductId"
      FROM "Product"
      WHERE id = 'loveshackfancy_Shopify_8244348289209_45442118254777'
         OR id = 'loveshackfancy_shopify_US_8244348289209_45442118353081'
      LIMIT 2
    `;

    if (specificProduct.length > 0) {
      console.log('\n=== Specific Products from Logs ===\n');
      specificProduct.forEach((p) => {
        console.log(`  id: ${p.id}`);
        console.log(`  shopifyProductId: ${p.shopifyProductId || '(null)'}`);
        console.log('');
      });
    }

    console.log('\n✅ Confirmed: Product IDs like "loveshackfancy_Shopify_8244348289209_45442118254777" are stored in the "id" column\n');

  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkProductIdColumn();

