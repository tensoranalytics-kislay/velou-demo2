import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

const failedPrompts = [
  {
    id: 3,
    query: "i am joining office next month, suggest me a dress to wear",
    description: "Occasion (Work) + Category + Inferred Colors"
  },
  {
    id: 4,
    query: "show me floral maxi dresses in pastel colors",
    description: "Pattern + Length + Color Shade"
  },
  {
    id: 5,
    query: "i need a black formal evening dress with long sleeves",
    description: "Multiple Constraints (Color + Occasion + Sleeve + Formality)"
  },
  {
    id: 6,
    query: "cotton summer dresses in light colors",
    description: "Material + Season + Color Shade"
  },
  {
    id: 9,
    query: "wedding guest dresses in navy or burgundy",
    description: "Occasion + Multiple Colors"
  },
  {
    id: 10,
    query: "relaxed fit linen pants for summer",
    description: "Fit + Material + Season (Different Category)"
  }
];

async function auditPrompt(prompt: typeof failedPrompts[0]) {
  console.log('\n' + '='.repeat(100));
  console.log(`AUDIT: Test ${prompt.id} - ${prompt.description}`);
  console.log('='.repeat(100));
  console.log(`Query: "${prompt.query}"\n`);

  const sessionId = `audit-${prompt.id}-${Date.now()}`;
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

  // Step 1: Run the query and get extracted constraints
  console.log('📋 STEP 1: Running query and extracting constraints...\n');
  const result = await handleAssistantQuery(merchantId, {
    message: prompt.query,
    sessionId,
  });

  console.log('Extracted Constraints:');
  console.log('  Resolved Constraints:', JSON.stringify(result.resolvedConstraints, null, 2));
  console.log('  Classification Constraints:', JSON.stringify(result.resolvedClassificationConstraints, null, 2));
  console.log(`  Products Returned: ${result.productCards.length}\n`);

  // Step 2: Check database for products that should match
  console.log('📊 STEP 2: Checking database for matching products...\n');

  const constraints = result.resolvedClassificationConstraints || {};
  
  // Check category
  let categoryFilter = '';
  if (result.resolvedConstraints?.category) {
    const categories = Array.isArray(result.resolvedConstraints.category) 
      ? result.resolvedConstraints.category 
      : [result.resolvedConstraints.category];
    categoryFilter = categories.map(cat => `'${cat.replace(/'/g, "''")}'`).join(', ');
  }

  // Check each constraint type in database
  const checks: any = {};

  // Category check
  if (categoryFilter) {
    const categoryCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE p."category" = ANY(ARRAY[${categoryFilter}]::text[])
      AND p."merchantId" = ${merchantId}
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
    `;
    checks.category = {
      filter: categoryFilter,
      count: Number((categoryCount as any[])[0]?.count || 0)
    };
  }

  // Style check
  if (constraints.styles?.values) {
    const styleValues = constraints.styles.values;
    const styles: string[] = Array.isArray(styleValues) ? styleValues : typeof styleValues === 'string' ? [styleValues] : [];
    const styleConditions = styles.map((style: string) =>
      `LOWER(COALESCE(p."silhouetteCut", '')) LIKE LOWER('%${style.replace(/'/g, "''")}%')`
    ).join(' OR ');
    const styleCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${styleConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.styles = {
      values: styles,
      count: Number((styleCount as any[])[0]?.count || 0)
    };
  }

  // Color check
  if (constraints.colors?.values) {
    const colorValues = constraints.colors.values;
    const colors: string[] = Array.isArray(colorValues) ? colorValues : typeof colorValues === 'string' ? [colorValues] : [];
    const colorConditions = colors.map((color: string) => 
      `(LOWER(COALESCE(p."enrichedColor", '')) LIKE LOWER('%${color.replace(/'/g, "''")}%') 
        OR LOWER(COALESCE(p."color", '')) LIKE LOWER('%${color.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER('%${color.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER('%${color.replace(/'/g, "''")}%'))`
    ).join(' OR ');
    const colorCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${colorConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.colors = {
      values: colors,
      count: Number((colorCount as any[])[0]?.count || 0)
    };
  }

  // Occasion check
  if (constraints.occasions?.values) {
    const occasionValues_raw = constraints.occasions.values;
    const occasions: string[] = Array.isArray(occasionValues_raw) ? occasionValues_raw : typeof occasionValues_raw === 'string' ? [occasionValues_raw] : [];
    const occasionValues = occasions.map((occ: string) => `'${occ.replace(/'/g, "''")}'`).join(', ');
    const occasionCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (p."occasionContext" IS NOT NULL AND p."occasionContext" && ARRAY[${occasionValues}]::text[])
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.occasions = {
      values: occasions,
      count: Number((occasionCount as any[])[0]?.count || 0)
    };
  }

  // Sleeve check
  if (constraints.sleeveLengths?.values) {
    const sleeveValues = constraints.sleeveLengths.values;
    const sleeves: string[] = Array.isArray(sleeveValues) ? sleeveValues : typeof sleeveValues === 'string' ? [sleeveValues] : [];
    const sleeveConditions = sleeves.map((sleeve: string) => 
      `LOWER(COALESCE(p."sleeve", '')) LIKE LOWER('%${sleeve.replace(/'/g, "''")}%')`
    ).join(' OR ');
    const sleeveCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${sleeveConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.sleeves = {
      values: sleeves,
      count: Number((sleeveCount as any[])[0]?.count || 0)
    };
  }

  // Length check
  if (constraints.lengths?.values) {
    const lengthValues = constraints.lengths.values;
    const lengths: string[] = Array.isArray(lengthValues) ? lengthValues : typeof lengthValues === 'string' ? [lengthValues] : [];
    const lengthConditions = lengths.map((length: string) => 
      `(LOWER(COALESCE(p."length", '')) LIKE LOWER('%${length.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.title, '')) LIKE LOWER('%${length.replace(/'/g, "''")}%'))`
    ).join(' OR ');
    const lengthCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${lengthConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.lengths = {
      values: lengths,
      count: Number((lengthCount as any[])[0]?.count || 0)
    };
  }

  // Material check
  if (constraints.materials?.values) {
    const materialValues = constraints.materials.values;
    const materials: string[] = Array.isArray(materialValues) ? materialValues : typeof materialValues === 'string' ? [materialValues] : [];
    const materialConditions = materials.map((material: string) => 
      `(LOWER(COALESCE(p."material", '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p."fabric", '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.attributes->>'material', '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.attributes->>'fabric', '')) LIKE LOWER('%${material.replace(/'/g, "''")}%'))`
    ).join(' OR ');
    const materialCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${materialConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.materials = {
      values: materials,
      count: Number((materialCount as any[])[0]?.count || 0)
    };
  }

  // Fit check
  if (constraints.fits?.values) {
    const fitValues = constraints.fits.values;
    const fits: string[] = Array.isArray(fitValues) ? fitValues : typeof fitValues === 'string' ? [fitValues] : [];
    const fitConditions = fits.map((fit: string) => 
      `LOWER(COALESCE(p."fit", '')) LIKE LOWER('%${fit.replace(/'/g, "''")}%')`
    ).join(' OR ');
    const fitCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${fitConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.fits = {
      values: fits,
      count: Number((fitCount as any[])[0]?.count || 0)
    };
  }

  // Season check
  if (constraints.seasons?.values) {
    const seasonValues = constraints.seasons.values;
    const seasons: string[] = Array.isArray(seasonValues) ? seasonValues : typeof seasonValues === 'string' ? [seasonValues] : [];
    const seasonConditions = seasons.map((season: string) => 
      `LOWER(COALESCE(p."season", '')) LIKE LOWER('%${season.replace(/'/g, "''")}%')`
    ).join(' OR ');
    const seasonCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${seasonConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.seasons = {
      values: seasons,
      count: Number((seasonCount as any[])[0]?.count || 0)
    };
  }

  // Pattern check
  if (constraints.patterns?.values) {
    const patternValues = constraints.patterns.values;
    const patterns: string[] = Array.isArray(patternValues) ? patternValues : typeof patternValues === 'string' ? [patternValues] : [];
    const patternConditions = patterns.map((pattern: string) => 
      `(LOWER(COALESCE(p.attributes->>'pattern', '')) LIKE LOWER('%${pattern.replace(/'/g, "''")}%')
        OR LOWER(COALESCE(p.title, '')) LIKE LOWER('%${pattern.replace(/'/g, "''")}%'))`
    ).join(' OR ');
    const patternCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${patternConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.patterns = {
      values: patterns,
      count: Number((patternCount as any[])[0]?.count || 0)
    };
  }

  // FormalityLevel check
  if (constraints.formalityLevel?.values) {
    const formalityValues = constraints.formalityLevel.values;
    const formalityLevels: string[] = Array.isArray(formalityValues) ? formalityValues : typeof formalityValues === 'string' ? [formalityValues] : [];
    const formalityConditions = formalityLevels.map((formality: string) => 
      `LOWER(COALESCE(p."formalityLevel", '')) LIKE LOWER('%${formality.replace(/'/g, "''")}%')`
    ).join(' OR ');
    const formalityCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "Product" p 
      WHERE (${formalityConditions})
      AND p."merchantId" = '${merchantId}'
      AND p."isActive" = true
      AND p."stockStatus" = 'in_stock'
      ${categoryFilter ? `AND p."category" = ANY(ARRAY[${categoryFilter}]::text[])` : ''}
    `);
    checks.formalityLevel = {
      values: formalityLevels,
      count: Number((formalityCount as any[])[0]?.count || 0)
    };
  }

  console.log('Database Check Results:');
  Object.entries(checks).forEach(([key, value]: [string, any]) => {
    const emoji = value.count > 0 ? '✅' : '❌';
    console.log(`  ${emoji} ${key}: ${value.count} products found`);
    if (value.values) {
      console.log(`     Values: ${value.values.join(', ')}`);
    }
  });

  // Step 3: Check combined constraints (AND logic)
  console.log('\n🔍 STEP 3: Checking combined constraints (AND logic)...\n');
  
  const constraintKeys = Object.keys(checks);
  if (constraintKeys.length > 1) {
    console.log('Combining constraints with AND logic:');
    constraintKeys.forEach(key => {
      const check = checks[key];
      console.log(`  - ${key}: ${check.count} products`);
    });

    // Try to find products matching ALL constraints
    const allConditions: string[] = [];
    if (checks.category) {
      allConditions.push(`p."category" = ANY(ARRAY[${checks.category.filter}]::text[])`);
    }
    if (checks.styles) {
      const styleConditions = checks.styles.values.map((style: string) => 
        `LOWER(COALESCE(p."silhouetteCut", '')) LIKE LOWER('%${style.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${styleConditions.join(' OR ')})`);
    }
    if (checks.colors) {
      const colorConditions = checks.colors.values.map((color: string) => 
        `(LOWER(COALESCE(p."enrichedColor", '')) LIKE LOWER('%${color.replace(/'/g, "''")}%') 
          OR LOWER(COALESCE(p."color", '')) LIKE LOWER('%${color.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER('%${color.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER('%${color.replace(/'/g, "''")}%'))`
      );
      allConditions.push(`(${colorConditions.join(' OR ')})`);
    }
    if (checks.occasions) {
      const occasionValues = checks.occasions.values.map((occ: string) => `'${occ.replace(/'/g, "''")}'`).join(', ');
      allConditions.push(`(p."occasionContext" IS NOT NULL AND p."occasionContext" && ARRAY[${occasionValues}]::text[])`);
    }
    if (checks.sleeves) {
      const sleeveConditions = checks.sleeves.values.map((sleeve: string) => 
        `LOWER(COALESCE(p."sleeve", '')) LIKE LOWER('%${sleeve.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${sleeveConditions.join(' OR ')})`);
    }
    if (checks.lengths) {
      const lengthConditions = checks.lengths.values.map((length: string) => 
        `(LOWER(COALESCE(p."length", '')) LIKE LOWER('%${length.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.title, '')) LIKE LOWER('%${length.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${lengthConditions.join(' OR ')})`);
    }
    if (checks.materials) {
      const materialConditions = checks.materials.values.map((material: string) => 
        `(LOWER(COALESCE(p."material", '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p."fabric", '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.attributes->>'material', '')) LIKE LOWER('%${material.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.attributes->>'fabric', '')) LIKE LOWER('%${material.replace(/'/g, "''")}%'))`
      );
      allConditions.push(`(${materialConditions.join(' OR ')})`);
    }
    if (checks.fits) {
      const fitConditions = checks.fits.values.map((fit: string) => 
        `LOWER(COALESCE(p."fit", '')) LIKE LOWER('%${fit.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${fitConditions.join(' OR ')})`);
    }
    if (checks.seasons) {
      const seasonConditions = checks.seasons.values.map((season: string) => 
        `LOWER(COALESCE(p."season", '')) LIKE LOWER('%${season.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${seasonConditions.join(' OR ')})`);
    }
    if (checks.patterns) {
      const patternConditions = checks.patterns.values.map((pattern: string) => 
        `(LOWER(COALESCE(p.attributes->>'pattern', '')) LIKE LOWER('%${pattern.replace(/'/g, "''")}%')
          OR LOWER(COALESCE(p.title, '')) LIKE LOWER('%${pattern.replace(/'/g, "''")}%'))`
      );
      allConditions.push(`(${patternConditions.join(' OR ')})`);
    }
    if (checks.formalityLevel) {
      const formalityConditions = checks.formalityLevel.values.map((formality: string) => 
        `LOWER(COALESCE(p."formalityLevel", '')) LIKE LOWER('%${formality.replace(/'/g, "''")}%')`
      );
      allConditions.push(`(${formalityConditions.join(' OR ')})`);
    }

    if (allConditions.length > 0) {
      const combinedQuery = `
        SELECT COUNT(*) as count FROM "Product" p 
        WHERE ${allConditions.join(' AND ')}
        AND p."merchantId" = '${merchantId}'
        AND p."isActive" = true
        AND p."stockStatus" = 'in_stock'
      `;
      
      try {
        const combinedCount = await prisma.$queryRawUnsafe(combinedQuery);
        const count = Number((combinedCount as any[])[0]?.count || 0);
        console.log(`\nCombined AND query result: ${count} products`);
        if (count === 0) {
          console.log('❌ No products match ALL constraints combined (AND logic)');
        } else {
          console.log('✅ Products exist that match all constraints');
        }
      } catch (error: any) {
        console.log(`❌ Error executing combined query: ${error.message}`);
      }
    }
  }

  // Step 4: Summary
  console.log('\n📝 STEP 4: Failure Analysis Summary\n');
  
  const issues: string[] = [];
  
  if (result.productCards.length === 0) {
    issues.push('No products returned by pipeline');
  }
  
  Object.entries(checks).forEach(([key, value]: [string, any]) => {
    if (value.count === 0 && key !== 'category') {
      issues.push(`${key}: No products found in database for values: ${value.values?.join(', ') || 'N/A'}`);
    }
  });

  if (issues.length > 0) {
    console.log('❌ Issues Found:');
    issues.forEach(issue => console.log(`   - ${issue}`));
  } else {
    console.log('✅ All individual constraints have matching products in database');
    console.log('⚠️  Issue is likely with AND logic combining constraints or SQL filter implementation');
  }

  console.log('\n' + '='.repeat(100) + '\n');
}

async function runAllAudits() {
  for (const prompt of failedPrompts) {
    await auditPrompt(prompt);
    // Small delay between audits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  await prisma.$disconnect();
}

runAllAudits().catch(console.error);
