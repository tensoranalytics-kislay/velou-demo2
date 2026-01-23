import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

async function testGenderAmbiguous() {
  console.log('='.repeat(80));
  console.log('TESTING: Gender-Ambiguous Query');
  console.log('='.repeat(80));

  const query = 'do you have any tops in pastel shades';

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Query: "${query}"`);
  console.log('='.repeat(80));

  try {
    const result = await handleAssistantQuery(
      'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      {
        message: query,
        sessionId: `test-gender-ambiguous-${Date.now()}`,
      }
    );

    console.log(`\n📦 Products Returned: ${result.productCards?.length || 0}`);
    console.log(`\n🔍 Extracted Constraints:`);
    console.log(`   Category: ${result.resolvedConstraints?.category?.join(', ') || 'N/A'}`);
    console.log(`   Colors: ${result.resolvedConstraints?.colors?.join(', ') || 'N/A'}`);
    console.log(`   Styles: ${result.resolvedConstraints?.styleTags?.join(', ') || 'N/A'}`);
    console.log(`   Reply Text: ${result.replyText?.substring(0, 200) || 'N/A'}...`);

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
          attributes: true,
        },
      });

      console.log(`\n📋 Products Analysis:`);
      const pastelColors = ['pastel', 'pale', 'soft', 'light', 'peach', 'lavender', 'mint', 'blush', 'powder', 'baby'];
      let pastelCount = 0;

      dbProducts.forEach((p, i) => {
        const color = (p.enrichedColor || p.color || '').toLowerCase();
        const isPastel = pastelColors.some(pc => color.includes(pc));
        if (isPastel) pastelCount++;

        console.log(`\n   ${i + 1}. ${p.title}`);
        console.log(`      Category: ${p.category || 'N/A'}`);
        console.log(`      Subcategory: ${p.subcategory || 'N/A'}`);
        console.log(`      Gender: ${p.gender || 'N/A'}`);
        console.log(`      Color: ${p.enrichedColor || p.color || 'N/A'}`);
        console.log(`      ✅ Is Pastel: ${isPastel ? 'YES' : 'NO'}`);
      });

      console.log(`\n📊 Summary:`);
      console.log(`   Total Products: ${dbProducts.length}`);
      console.log(`   Pastel Products: ${pastelCount}`);
      console.log(`   Accuracy: ${((pastelCount / dbProducts.length) * 100).toFixed(1)}%`);
    } else {
      console.log(`\n⚠️  No products returned. This might indicate:`);
      console.log(`   - Category classification failed (0 categories)`);
      console.log(`   - Clarification was triggered`);
      console.log(`   - Search returned no results`);
    }
  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
  }

  await prisma.$disconnect();
}

testGenderAmbiguous().catch(console.error);
