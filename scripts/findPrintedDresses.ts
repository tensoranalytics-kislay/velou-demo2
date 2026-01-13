import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findPrintedDresses() {
  console.log('Searching for dresses with print/printed patterns...\n');

  // Query all dresses
  const allDresses = await prisma.product.findMany({
    where: {
      category: {
        contains: 'Dress',
      },
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      attributes: true,
    },
  });

  console.log(`Total dresses found: ${allDresses.length}\n`);

  const printedDresses: Array<{
    id: string;
    title: string;
    category: string;
    subcategory: string | null;
    pattern: string | string[];
  }> = [];

  for (const dress of allDresses) {
    const attrs = dress.attributes as any;
    const patternKeys = [
      'Pattern',
      'pattern',
      'pattern_print',
      'patternPrint',
      'patterns',
      'Pattern/Print',
    ];

    let patternValue: string | string[] | null = null;

    // Check all pattern keys
    for (const key of patternKeys) {
      if (attrs[key]) {
        patternValue = attrs[key];
        break;
      }
    }

    // Also check all keys for anything containing "print"
    if (!patternValue) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase().includes('print') || key.toLowerCase().includes('pattern')) {
          patternValue = value as string | string[];
          break;
        }
      }
    }

    if (patternValue) {
      const patternArray = Array.isArray(patternValue) ? patternValue : [patternValue];
      const patternStrings = patternArray.map(v => String(v).toLowerCase());
      
      // Check if any pattern contains "print" or "printed"
      const hasPrint = patternStrings.some(
        p => p.includes('print') || p.includes('printed')
      );

      if (hasPrint) {
        // Check if it's maxi, mini, or midi
        const categoryLower = dress.category.toLowerCase();
        const subcategoryLower = (dress.subcategory || '').toLowerCase();
        const titleLower = dress.title.toLowerCase();
        
        const isMaxiMiniMidi = 
          categoryLower.includes('maxi') ||
          categoryLower.includes('mini') ||
          categoryLower.includes('midi') ||
          subcategoryLower.includes('maxi') ||
          subcategoryLower.includes('mini') ||
          subcategoryLower.includes('midi') ||
          titleLower.includes('maxi') ||
          titleLower.includes('mini') ||
          titleLower.includes('midi');

        if (isMaxiMiniMidi) {
          printedDresses.push({
            id: dress.id,
            title: dress.title,
            category: dress.category,
            subcategory: dress.subcategory,
            pattern: patternValue,
          });
        }
      }
    }
  }

  console.log(`Found ${printedDresses.length} maxi/mini/midi dresses with print/printed patterns:\n`);

  if (printedDresses.length > 0) {
    printedDresses.forEach((dress, idx) => {
      console.log(`${idx + 1}. ${dress.title}`);
      console.log(`   ID: ${dress.id}`);
      console.log(`   Category: ${dress.category}`);
      if (dress.subcategory) {
        console.log(`   Subcategory: ${dress.subcategory}`);
      }
      console.log(`   Pattern: ${JSON.stringify(dress.pattern)}`);
      console.log('');
    });
  } else {
    console.log('❌ No dresses with print/printed patterns found in maxi/mini/midi categories.');
    console.log('\nChecking all dresses with print patterns (any length)...\n');
    
    // Check all dresses with print patterns regardless of length
    const allPrintedDresses: Array<{
      id: string;
      title: string;
      category: string;
      pattern: string | string[];
    }> = [];

    for (const dress of allDresses) {
      const attrs = dress.attributes as any;
      const patternKeys = ['Pattern', 'pattern', 'pattern_print', 'patternPrint', 'patterns'];
      
      let patternValue: string | string[] | null = null;
      for (const key of patternKeys) {
        if (attrs[key]) {
          patternValue = attrs[key];
          break;
        }
      }

      if (patternValue) {
        const patternArray = Array.isArray(patternValue) ? patternValue : [patternValue];
        const patternStrings = patternArray.map(v => String(v).toLowerCase());
        
        const hasPrint = patternStrings.some(
          p => p.includes('print') || p.includes('printed')
        );

        if (hasPrint) {
          allPrintedDresses.push({
            id: dress.id,
            title: dress.title,
            category: dress.category,
            pattern: patternValue,
          });
        }
      }
    }

    if (allPrintedDresses.length > 0) {
      console.log(`Found ${allPrintedDresses.length} dresses with print/printed patterns (all lengths):\n`);
      allPrintedDresses.slice(0, 10).forEach((dress, idx) => {
        console.log(`${idx + 1}. ${dress.title}`);
        console.log(`   Category: ${dress.category}`);
        console.log(`   Pattern: ${JSON.stringify(dress.pattern)}`);
        console.log('');
      });
      if (allPrintedDresses.length > 10) {
        console.log(`... and ${allPrintedDresses.length - 10} more`);
      }
    } else {
      console.log('❌ No dresses with print/printed patterns found at all.');
    }
  }

  await prisma.$disconnect();
}

findPrintedDresses().catch(console.error);
