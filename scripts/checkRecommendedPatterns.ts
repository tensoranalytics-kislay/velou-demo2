import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPatterns() {
  const productIds = [
    '8217312821433', // Galatea Metallic Silk Chiffon Maxi Dress
    '8179604455609', // Sorone Satin Lace Maxi Slip Dress
    '8217313083577', // Iridia Satin Maxi Slip Dress
    '8084019511481', // Annavelle Silk Chiffon Maxi Dress
  ];

  console.log('Checking patterns for recommended products:\n');

  for (const id of productIds) {
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        attributes: true,
      },
    });

    if (!product) {
      console.log(`❌ Product ${id} not found\n`);
      continue;
    }

    const attrs = product.attributes as any;
    const patternKeys = [
      'Pattern',
      'pattern',
      'pattern_print',
      'patternPrint',
      'patterns',
      'Pattern/Print',
    ];

    let foundPattern = false;
    const patternValues: string[] = [];

    for (const key of patternKeys) {
      if (attrs[key]) {
        foundPattern = true;
        const value = attrs[key];
        if (Array.isArray(value)) {
          patternValues.push(...value);
        } else {
          patternValues.push(String(value));
        }
      }
    }

    // Also check all keys for anything containing "print"
    for (const [key, value] of Object.entries(attrs)) {
      if (key.toLowerCase().includes('print') || key.toLowerCase().includes('pattern')) {
        if (!patternKeys.includes(key)) {
          foundPattern = true;
          if (Array.isArray(value)) {
            patternValues.push(...(value as string[]));
          } else {
            patternValues.push(String(value));
          }
        }
      }
    }

    // Check if any pattern value contains "print" or "printed"
    const hasPrint = patternValues.some(
      v => v.toLowerCase().includes('print') || v.toLowerCase().includes('printed')
    );

    console.log(`Product: ${product.title.substring(0, 60)}...`);
    console.log(`  ID: ${product.id}`);
    console.log(`  Has pattern field: ${foundPattern ? '✅' : '❌'}`);
    if (foundPattern) {
      console.log(`  Pattern values: ${JSON.stringify(patternValues)}`);
      console.log(`  Contains "print"/"printed": ${hasPrint ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log(`  No pattern field found in attributes`);
      console.log(`  Available attribute keys: ${Object.keys(attrs).slice(0, 10).join(', ')}...`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

checkPatterns().catch(console.error);
