import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllPatterns() {
  console.log('Checking all pattern values in dresses...\n');

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
      attributes: true,
    },
  });

  console.log(`Total dresses: ${allDresses.length}\n`);

  const patternCounts: Map<string, number> = new Map();
  const dressesWithPatterns: Array<{ title: string; pattern: string | string[] }> = [];

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
      
      for (const pattern of patternArray) {
        const patternStr = String(pattern);
        patternCounts.set(patternStr, (patternCounts.get(patternStr) || 0) + 1);
        
        if (dressesWithPatterns.length < 20) {
          dressesWithPatterns.push({
            title: dress.title,
            pattern: patternValue,
          });
        }
      }
    }
  }

  console.log(`Pattern distribution in dresses:\n`);
  const sortedPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  sortedPatterns.forEach(([pattern, count]) => {
    console.log(`  ${pattern}: ${count} dresses`);
  });

  console.log(`\n\nSample dresses with patterns:\n`);
  dressesWithPatterns.slice(0, 10).forEach((dress, idx) => {
    console.log(`${idx + 1}. ${dress.title.substring(0, 70)}...`);
    console.log(`   Pattern: ${JSON.stringify(dress.pattern)}\n`);
  });

  // Check for any variations of "print"
  console.log(`\nChecking for any pattern containing "print" (case-insensitive):\n`);
  let foundAnyPrint = false;
  for (const [pattern, count] of sortedPatterns) {
    if (pattern.toLowerCase().includes('print')) {
      console.log(`  ✅ Found: "${pattern}" (${count} dresses)`);
      foundAnyPrint = true;
    }
  }
  if (!foundAnyPrint) {
    console.log(`  ❌ No patterns containing "print" found`);
  }

  await prisma.$disconnect();
}

checkAllPatterns().catch(console.error);
