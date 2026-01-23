import { prisma } from './src/lib/db';

async function checkOccasionLocations() {
  console.log('================================================================================');
  console.log('CHECKING ALL POSSIBLE LOCATIONS FOR OCCASIONS IN DRESSES');
  console.log('================================================================================\n');
  
  // Get a sample of dresses to check all possible fields
  const sampleDresses = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    occasionContext: any;
    attributes: any;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."occasionContext",
      p.attributes
    FROM "Product" p
    WHERE LOWER(p."category") LIKE '%dress%'
    LIMIT 20
  `;
  
  console.log(`Analyzing ${sampleDresses.length} sample dresses...\n`);
  
  // Check what occasion-related fields exist in attributes
  const occasionFields = new Set<string>();
  const occasionValues = new Map<string, Set<string>>();
  
  sampleDresses.forEach(dress => {
    if (dress.attributes) {
      // Check all possible occasion field names
      const possibleFields = [
        'occasion',
        'Occasion',
        'occasionContext',
        'occasions',
        'Occasions',
        'event',
        'Event',
        'events',
        'Events',
        'useCase',
        'useCases',
        'UseCase',
        'UseCases',
        'context',
        'Context',
        'suitableFor',
        'SuitableFor',
        'suitable_for',
        'extensible'
      ];
      
      possibleFields.forEach(field => {
        if (dress.attributes[field] !== undefined && dress.attributes[field] !== null) {
          occasionFields.add(field);
          
          const value = dress.attributes[field];
          if (!occasionValues.has(field)) {
            occasionValues.set(field, new Set());
          }
          
          if (Array.isArray(value)) {
            value.forEach(v => {
              if (typeof v === 'string') {
                occasionValues.get(field)!.add(v);
              }
            });
          } else if (typeof value === 'string') {
            occasionValues.get(field)!.add(value);
          } else if (typeof value === 'object' && value !== null) {
            // Check nested objects
            Object.keys(value).forEach(key => {
              if (key.toLowerCase().includes('occasion') || 
                  key.toLowerCase().includes('event') ||
                  key.toLowerCase().includes('context')) {
                occasionFields.add(`${field}.${key}`);
                const nestedValue = value[key];
                if (Array.isArray(nestedValue)) {
                  nestedValue.forEach(v => {
                    if (typeof v === 'string') {
                      occasionValues.get(`${field}.${key}`)?.add(v) || 
                      occasionValues.set(`${field}.${key}`, new Set([v]));
                    }
                  });
                } else if (typeof nestedValue === 'string') {
                  occasionValues.get(`${field}.${key}`)?.add(nestedValue) ||
                  occasionValues.set(`${field}.${key}`, new Set([nestedValue]));
                }
              }
            });
          }
        }
      });
    }
  });
  
  console.log('1. Occasion-related fields found in attributes:');
  if (occasionFields.size > 0) {
    occasionFields.forEach(field => {
      console.log(`   - ${field}`);
      const values = occasionValues.get(field);
      if (values && values.size > 0) {
        console.log(`     Sample values: ${Array.from(values).slice(0, 5).join(', ')}${values.size > 5 ? '...' : ''}`);
      }
    });
  } else {
    console.log('   No occasion-related fields found in attributes');
  }
  
  // Check 2: Query for dresses with occasions in different locations
  console.log('\n2. Checking dresses with occasions in different locations...\n');
  
  // Check attributes->>'occasion' (lowercase string)
  const occasionString = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p.attributes->>'occasion' IS NOT NULL
      AND p.attributes->>'occasion' != ''
  `;
  console.log(`   attributes->>'occasion' (string): ${occasionString[0]?.count || 0} dresses`);
  
  // Check attributes->'Occasion' (capital O, JSON array)
  const occasionArray = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p.attributes->'Occasion' IS NOT NULL
      AND jsonb_typeof(p.attributes->'Occasion') = 'array'
  `;
  console.log(`   attributes->'Occasion' (array): ${occasionArray[0]?.count || 0} dresses`);
  
  // Check attributes->'extensible'->>'occasion'
  const extensibleOccasion = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p.attributes->'extensible' IS NOT NULL
      AND p.attributes->'extensible'->>'occasion' IS NOT NULL
      AND p.attributes->'extensible'->>'occasion' != ''
  `;
  console.log(`   attributes->'extensible'->>'occasion': ${extensibleOccasion[0]?.count || 0} dresses`);
  
  // Check attributes->'extensible'->'Occasion' (array)
  const extensibleOccasionArray = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p.attributes->'extensible' IS NOT NULL
      AND p.attributes->'extensible'->'Occasion' IS NOT NULL
      AND jsonb_typeof(p.attributes->'extensible'->'Occasion') = 'array'
  `;
  console.log(`   attributes->'extensible'->'Occasion' (array): ${extensibleOccasionArray[0]?.count || 0} dresses`);
  
  // Check occasionContext column
  const occasionContextColumn = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NOT NULL
  `;
  console.log(`   occasionContext column: ${occasionContextColumn[0]?.count || 0} dresses`);
  
  // Check 3: Sample products with occasions in different locations
  console.log('\n3. Sample dresses with occasions in different locations:\n');
  
  // Sample with attributes->>'occasion'
  if (Number(occasionString[0]?.count || 0) > 0) {
    console.log('   Dresses with attributes->>\'occasion\' (string):');
    const samples = await prisma.$queryRaw<Array<{ 
      id: string; 
      title: string; 
      occasion: string;
    }>>`
      SELECT 
        p.id,
        p.title,
        p.attributes->>'occasion' as occasion
      FROM "Product" p
      WHERE 
        LOWER(p."category") LIKE '%dress%'
        AND p.attributes->>'occasion' IS NOT NULL
        AND p.attributes->>'occasion' != ''
      LIMIT 5
    `;
    samples.forEach((p, i) => {
      console.log(`     ${i + 1}. ${p.title}`);
      console.log(`        Occasion: ${p.occasion}`);
    });
    console.log('');
  }
  
  // Sample with attributes->'Occasion' (array)
  if (Number(occasionArray[0]?.count || 0) > 0) {
    console.log('   Dresses with attributes->\'Occasion\' (array):');
    const samples = await prisma.$queryRaw<Array<{ 
      id: string; 
      title: string; 
      occasion: any;
    }>>`
      SELECT 
        p.id,
        p.title,
        p.attributes->'Occasion' as occasion
      FROM "Product" p
      WHERE 
        LOWER(p."category") LIKE '%dress%'
        AND p.attributes->'Occasion' IS NOT NULL
        AND jsonb_typeof(p.attributes->'Occasion') = 'array'
      LIMIT 5
    `;
    samples.forEach((p, i) => {
      console.log(`     ${i + 1}. ${p.title}`);
      console.log(`        Occasion: ${JSON.stringify(p.occasion)}`);
    });
    console.log('');
  }
  
  // Check 4: Compare occasionContext column vs attributes
  console.log('4. Comparison: occasionContext column vs attributes...\n');
  
  const bothLocations = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NOT NULL
      AND (
        p.attributes->>'occasion' IS NOT NULL
        OR p.attributes->'Occasion' IS NOT NULL
        OR (p.attributes->'extensible' IS NOT NULL AND p.attributes->'extensible'->>'occasion' IS NOT NULL)
      )
  `;
  console.log(`   Dresses with occasions in BOTH column AND attributes: ${bothLocations[0]?.count || 0}`);
  
  const onlyColumn = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NOT NULL
      AND (
        p.attributes->>'occasion' IS NULL OR p.attributes->>'occasion' = ''
      )
      AND p.attributes->'Occasion' IS NULL
      AND (
        p.attributes->'extensible' IS NULL 
        OR p.attributes->'extensible'->>'occasion' IS NULL
        OR p.attributes->'extensible'->>'occasion' = ''
      )
  `;
  console.log(`   Dresses with occasions ONLY in column (not in attributes): ${onlyColumn[0]?.count || 0}`);
  
  const onlyAttributes = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NULL
      AND (
        p.attributes->>'occasion' IS NOT NULL AND p.attributes->>'occasion' != ''
        OR p.attributes->'Occasion' IS NOT NULL
        OR (p.attributes->'extensible' IS NOT NULL AND p.attributes->'extensible'->>'occasion' IS NOT NULL)
      )
  `;
  console.log(`   Dresses with occasions ONLY in attributes (not in column): ${onlyAttributes[0]?.count || 0}`);
  
  await prisma.$disconnect();
}

checkOccasionLocations().catch(console.error);
