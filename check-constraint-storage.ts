import { prisma } from './src/lib/db';

async function checkConstraintStorage() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('🔍 Checking Constraint Storage Formats in Database...\n');
  
  // Get sample products with various attributes
  const samples = await prisma.$queryRaw<Array<{
    id: string;
    attributes: any;
  }>>`
    SELECT p.id, p.attributes
    FROM "Product" p
    WHERE p."merchantId" = ${merchantId}
      AND p."isActive" = true
      AND (
        p.attributes->'Pattern' IS NOT NULL
        OR p.attributes->'material' IS NOT NULL
        OR p.attributes->'occasion' IS NOT NULL
        OR p.attributes->'season' IS NOT NULL
        OR p.attributes->'Style' IS NOT NULL
        OR p.attributes->'sleeve' IS NOT NULL
        OR p.attributes->'neckline' IS NOT NULL
        OR p.attributes->'fit' IS NOT NULL
      )
    LIMIT 20
  `;
  
  const storageTypes = new Map<string, Set<string>>();
  
  samples.forEach((p) => {
    const attrs = p.attributes || {};
    
    // Check each constraint type
    const constraints = [
      'Pattern', 'pattern_print',
      'material', 'fabric', 'materials',
      'occasion', 'occasionContext',
      'season', 'seasonalCues',
      'Style', 'style', 'style_labels',
      'sleeve', 'sleeveLength', 'Sleeve Length',
      'neckline', 'Neckline',
      'fit', 'Fit',
      'sizes', 'size',
      'collection',
      'embellishments',
      'formalityLevel',
      'colorShade',
      'colorUndertone',
      'seasonalPalette'
    ];
    
    constraints.forEach((key) => {
      if (attrs[key] !== undefined && attrs[key] !== null) {
        const value = attrs[key];
        const type = Array.isArray(value) ? 'array' : typeof value;
        const valueStr = typeof value === 'string' ? `"${value.substring(0, 50)}"` : JSON.stringify(value).substring(0, 100);
        
        if (!storageTypes.has(key)) {
          storageTypes.set(key, new Set());
        }
        storageTypes.get(key)!.add(`${type}: ${valueStr}`);
      }
    });
  });
  
  console.log('📊 Constraint Storage Format Summary:\n');
  
  const issues: string[] = [];
  
  storageTypes.forEach((types, key) => {
    console.log(`${key}:`);
    types.forEach((type) => {
      console.log(`  - ${type}`);
    });
    
    // Check for potential issues
    const hasArray = Array.from(types).some(t => t.startsWith('array:'));
    const hasString = Array.from(types).some(t => t.startsWith('string:'));
    
    if (hasArray && hasString) {
      issues.push(`${key}: Mixed storage (both array and string)`);
    }
    
    console.log();
  });
  
  if (issues.length > 0) {
    console.log('⚠️  Potential Issues Found:\n');
    issues.forEach((issue) => {
      console.log(`  - ${issue}`);
    });
  }
  
  // Test specific constraint queries
  console.log('\n\n🧪 Testing Constraint Queries:\n');
  
  // Test Pattern (we know this should be array)
  const patternTest = await prisma.$queryRaw<Array<{ pattern_text: string; pattern_type: string }>>`
    SELECT 
      p.attributes->>'Pattern' as pattern_text,
      jsonb_typeof(p.attributes->'Pattern') as pattern_type
    FROM "Product" p
    WHERE p."merchantId" = ${merchantId}
      AND p."isActive" = true
      AND p.attributes->'Pattern' IS NOT NULL
    LIMIT 5
  `;
  
  console.log('Pattern examples:');
  patternTest.forEach((p) => {
    console.log(`  Type: ${p.pattern_type}, Text: ${p.pattern_text?.substring(0, 50)}`);
  });
  
  // Test Style (check if array or string)
  const styleTest = await prisma.$queryRaw<Array<{ style_text: string; style_type: string }>>`
    SELECT 
      p.attributes->>'Style' as style_text,
      jsonb_typeof(p.attributes->'Style') as style_type
    FROM "Product" p
    WHERE p."merchantId" = ${merchantId}
      AND p."isActive" = true
      AND p.attributes->'Style' IS NOT NULL
    LIMIT 5
  `;
  
  console.log('\nStyle examples:');
  styleTest.forEach((p) => {
    console.log(`  Type: ${p.style_type}, Text: ${p.style_text?.substring(0, 50)}`);
  });
  
  // Test occasion (check if array or string)
  const occasionTest = await prisma.$queryRaw<Array<{ occasion_text: string; occasion_type: string }>>`
    SELECT 
      p.attributes->>'occasion' as occasion_text,
      jsonb_typeof(p.attributes->'occasion') as occasion_type
    FROM "Product" p
    WHERE p."merchantId" = ${merchantId}
      AND p."isActive" = true
      AND p.attributes->'occasion' IS NOT NULL
    LIMIT 5
  `;
  
  console.log('\nOccasion examples:');
  occasionTest.forEach((p) => {
    console.log(`  Type: ${p.occasion_type}, Text: ${p.occasion_text?.substring(0, 50)}`);
  });
  
  await prisma.$disconnect();
}

checkConstraintStorage();
