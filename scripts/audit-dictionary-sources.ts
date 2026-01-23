/**
 * Audit Dictionary Sources
 * 
 * Checks if category-specific dictionaries are being extracted from the correct
 * database columns by comparing with SQL filter locations.
 */

import { prisma } from '../src/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DictionaryStats {
  constraintType: string;
  totalValues: number;
  categoriesWithData: number;
  categoriesWithoutData: number;
  sampleValues: string[];
  extractionSources: string[];
}

async function auditDictionarySources() {
  console.log('🔍 Auditing Dictionary Sources...\n');

  await prisma.$connect();

  // Load pre-built dictionaries
  const dictionariesPath = join(process.cwd(), 'src/lib/search/filtering/category-specific-dictionaries.json');
  let dictionaries: any;
  try {
    dictionaries = JSON.parse(readFileSync(dictionariesPath, 'utf-8'));
  } catch (error) {
    console.error('❌ Could not load dictionaries file:', dictionariesPath);
    console.error('   Run: npx tsx scripts/build-category-specific-dictionaries.ts\n');
    process.exit(1);
  }

  const metadata = dictionaries.metadata;
  console.log(`   Loaded dictionaries: ${metadata.totalCategories} categories, ${metadata.totalProducts} products\n`);

  // Get all category keys (excluding metadata)
  const categoryKeys = Object.keys(dictionaries).filter(key => key !== 'metadata');
  console.log(`   Analyzing ${categoryKeys.length} category dictionaries...\n`);

  // Analyze each constraint type
  const constraintTypes = [
    'availableColors',
    'availableLengths',
    'availableSleeves',
    'availableNecklines',
    'availableFormalityLevels',
    'availableColorShades',
    'availableFits',
    'availableMaterials',
    'availableOccasions',
    'availableSeasons',
    'availableStyles',
    'availablePatterns',
    'availableSizes',
    'availableRises',
  ];

  const stats: DictionaryStats[] = [];

  for (const constraintType of constraintTypes) {
    const allValues = new Set<string>();
    let categoriesWithData = 0;
    let categoriesWithoutData = 0;
    const sampleValues: string[] = [];

    for (const key of categoryKeys) {
      const dict = dictionaries[key] as any;
      const values = dict[constraintType] || [];
      
      if (values.length > 0) {
        categoriesWithData++;
        values.forEach((v: string) => allValues.add(v));
        if (sampleValues.length < 10) {
          sampleValues.push(...values.slice(0, 10 - sampleValues.length));
        }
      } else {
        categoriesWithoutData++;
      }
    }

    stats.push({
      constraintType,
      totalValues: allValues.size,
      categoriesWithData,
      categoriesWithoutData,
      sampleValues: sampleValues.slice(0, 10),
      extractionSources: [], // Will be filled by checking the build script
    });
  }

  // Check database columns for each constraint type
  console.log('📊 Dictionary Statistics:\n');
  console.log('Constraint Type'.padEnd(25) + 'Total Values'.padEnd(15) + 'Categories With Data'.padEnd(25) + 'Categories Without Data');
  console.log('-'.repeat(90));

  for (const stat of stats) {
    const valuesStr = stat.totalValues.toString().padEnd(15);
    const withDataStr = stat.categoriesWithData.toString().padEnd(25);
    const withoutDataStr = stat.categoriesWithoutData.toString();
    console.log(`${stat.constraintType.padEnd(25)}${valuesStr}${withDataStr}${withoutDataStr}`);
  }

  console.log('\n');

  // Check extraction sources from build script
  console.log('🔍 Checking Extraction Sources (from build script):\n');

  const extractionMap: Record<string, string[]> = {
    'availableColors': ['p."enrichedColor"', 'p."color"'],
    'availableLengths': ['p."length"', 'attributes->>\'length\'', 'attributes->>\'Length\''],
    'availableSleeves': ['p."sleeve"', 'attributes->>\'sleeve\'', 'attributes->>\'Sleeve\''],
    'availableNecklines': ['p."neckline"', 'attributes->>\'neckline\'', 'attributes->>\'Neckline\''],
    'availableFormalityLevels': ['p."formalityLevel"', 'attributes->>\'formalityLevel\'', 'attributes->>\'FormalityLevel\''],
    'availableColorShades': ['p."colorShade"', 'attributes->>\'colorShade\'', 'attributes->>\'ColorShade\''],
    'availableFits': ['p."fit"', 'attributes->>\'fit\'', 'attributes->>\'Fit\''],
    'availableMaterials': ['p."material"', 'p."fabric"', 'attributes->>\'material\'', 'attributes->>\'Material\'', 'attributes->>\'fabric\'', 'attributes->>\'Fabric\''],
    'availableOccasions': ['p."occasion"', 'p."occasionContext"', 'attributes->>\'occasion\'', 'attributes->>\'Occasion\''],
    'availableSeasons': ['p."season"', 'attributes->>\'season\'', 'attributes->>\'Season\''],
    'availableStyles': ['p."silhouetteCut"', 'attributes->>\'style\'', 'attributes->>\'Style\''],
    'availablePatterns': ['attributes->>\'pattern\'', 'attributes->>\'Pattern\''],
    'availableSizes': ['attributes->>\'size\'', 'attributes->>\'Size\''],
    'availableRises': ['p."riseWaist"', 'attributes->>\'riseWaist\'', 'attributes->>\'RiseWaist\'', 'attributes->>\'rise\'', 'attributes->>\'Rise\''],
  };

  // Check SQL filter sources
  console.log('🔍 Checking SQL Filter Sources (from vector/index.ts):\n');

  const sqlFilterMap: Record<string, string[]> = {
    'availableColors': ['p."enrichedColor"', 'p."color"', 'attributes->>\'color\'', 'attributes->>\'enriched_color\''],
    'availableLengths': ['p."length"', 'attributes->>\'length\''],
    'availableSleeves': ['p."sleeve"', 'attributes->>\'sleeve\'', 'attributes->>\'sleeveLength\''],
    'availableNecklines': ['p."neckline"', 'attributes->>\'neckline\''],
    'availableFormalityLevels': ['attributes->>\'formalityLevel\''],
    'availableColorShades': ['p."colorShade"', 'attributes->>\'colorShade\''],
    'availableFits': ['p."fit"', 'attributes->>\'fit\''],
    'availableMaterials': ['p."material"', 'p."fabric"', 'attributes->>\'material\'', 'attributes->>\'fabric\''],
    'availableOccasions': ['p."occasionContext"', 'p."occasion"', 'attributes->>\'Occasion\'', 'attributes->>\'occasion\''],
    'availableSeasons': ['p."season"', 'attributes->>\'season\''],
    'availableStyles': ['p."silhouetteCut"', 'attributes->>\'style\''],
    'availablePatterns': ['attributes->>\'pattern\''],
    'availableSizes': ['attributes->>\'size\''],
    'availableRises': ['p."riseWaist"', 'attributes->>\'riseWaist\'', 'attributes->>\'rise\''],
  };

  // Compare extraction sources with SQL filter sources
  console.log('📋 Source Comparison:\n');
  console.log('Constraint Type'.padEnd(25) + 'Dictionary Sources'.padEnd(40) + 'SQL Filter Sources');
  console.log('-'.repeat(120));

  const issues: string[] = [];

  for (const constraintType of constraintTypes) {
    const dictSources = extractionMap[constraintType] || [];
    const sqlSources = sqlFilterMap[constraintType] || [];
    
    // Check for missing sources in dictionary extraction
    const missingInDict: string[] = [];
    for (const sqlSource of sqlSources) {
      const found = dictSources.some(ds => 
        ds.toLowerCase().includes(sqlSource.toLowerCase().replace(/[^a-z]/g, '')) ||
        sqlSource.toLowerCase().includes(ds.toLowerCase().replace(/[^a-z]/g, ''))
      );
      if (!found) {
        missingInDict.push(sqlSource);
      }
    }

    // Check for missing sources in SQL filters
    const missingInSQL: string[] = [];
    for (const dictSource of dictSources) {
      const found = sqlSources.some(ss => 
        ss.toLowerCase().includes(dictSource.toLowerCase().replace(/[^a-z]/g, '')) ||
        dictSource.toLowerCase().includes(ss.toLowerCase().replace(/[^a-z]/g, ''))
      );
      if (!found && !dictSource.includes('capital')) { // Ignore capital variants
        missingInSQL.push(dictSource);
      }
    }

    const dictStr = dictSources.join(', ').substring(0, 38).padEnd(40);
    const sqlStr = sqlSources.join(', ').substring(0, 50);
    
    console.log(`${constraintType.padEnd(25)}${dictStr}${sqlStr}`);

    if (missingInDict.length > 0) {
      issues.push(`❌ ${constraintType}: Dictionary missing sources: ${missingInDict.join(', ')}`);
    }
    if (missingInSQL.length > 0) {
      issues.push(`⚠️  ${constraintType}: SQL filters missing sources: ${missingInSQL.join(', ')}`);
    }
  }

  console.log('\n');

  // Check for small dictionaries
  console.log('📉 Checking for Small Dictionaries (< 5 values):\n');
  const smallDictionaries: Array<{ category: string; constraintType: string; valueCount: number }> = [];

  for (const key of categoryKeys) {
    const dict = dictionaries[key] as any;
    for (const constraintType of constraintTypes) {
      const values = dict[constraintType] || [];
      if (values.length > 0 && values.length < 5) {
        smallDictionaries.push({
          category: key,
          constraintType,
          valueCount: values.length,
        });
      }
    }
  }

  if (smallDictionaries.length > 0) {
    console.log(`   Found ${smallDictionaries.length} small dictionaries:\n`);
    for (const small of smallDictionaries.slice(0, 20)) {
      console.log(`   - ${small.category}: ${small.constraintType} (${small.valueCount} values)`);
    }
    if (smallDictionaries.length > 20) {
      console.log(`   ... and ${smallDictionaries.length - 20} more\n`);
    }
  } else {
    console.log('   ✅ No small dictionaries found\n');
  }

  // Check database for actual data availability
  console.log('🔍 Checking Database Column Availability:\n');
  
  const columnChecks: Record<string, { column: string; nonNullCount: number; totalProducts: number }> = {};

  // Sample check on a few categories
  const sampleCategories = categoryKeys.slice(0, 5);
  
  for (const key of sampleCategories) {
    const [category, subcategoryStr] = key.split('|');
    const subcategory = subcategoryStr || null;

    const whereClause: any = {
      category,
      isActive: true,
    };
    if (subcategory) {
      whereClause.subcategory = subcategory;
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      select: {
        id: true,
        enrichedColor: true,
        color: true,
        length: true,
        sleeve: true,
        neckline: true,
        formalityLevel: true,
        colorShade: true,
        fit: true,
        material: true,
        fabric: true,
        occasion: true,
        occasionContext: true,
        season: true,
        silhouetteCut: true,
        riseWaist: true,
        attributes: true,
      },
      take: 100, // Sample
    });

    if (products.length > 0) {
      const checks: Record<string, { column: string; nonNullCount: number }> = {
        'enrichedColor': { column: 'enrichedColor', nonNullCount: 0 },
        'color': { column: 'color', nonNullCount: 0 },
        'length': { column: 'length', nonNullCount: 0 },
        'sleeve': { column: 'sleeve', nonNullCount: 0 },
        'neckline': { column: 'neckline', nonNullCount: 0 },
        'formalityLevel': { column: 'formalityLevel', nonNullCount: 0 },
        'colorShade': { column: 'colorShade', nonNullCount: 0 },
        'fit': { column: 'fit', nonNullCount: 0 },
        'material': { column: 'material', nonNullCount: 0 },
        'fabric': { column: 'fabric', nonNullCount: 0 },
        'occasion': { column: 'occasion', nonNullCount: 0 },
        'occasionContext': { column: 'occasionContext', nonNullCount: 0 },
        'season': { column: 'season', nonNullCount: 0 },
        'silhouetteCut': { column: 'silhouetteCut', nonNullCount: 0 },
        'riseWaist': { column: 'riseWaist', nonNullCount: 0 },
      };

      for (const product of products) {
        if (product.enrichedColor) checks['enrichedColor'].nonNullCount++;
        if (product.color) checks['color'].nonNullCount++;
        if (product.length) checks['length'].nonNullCount++;
        if (product.sleeve) checks['sleeve'].nonNullCount++;
        if (product.neckline) checks['neckline'].nonNullCount++;
        if (product.formalityLevel) checks['formalityLevel'].nonNullCount++;
        if (product.colorShade) checks['colorShade'].nonNullCount++;
        if (product.fit) checks['fit'].nonNullCount++;
        if (product.material) checks['material'].nonNullCount++;
        if (product.fabric) checks['fabric'].nonNullCount++;
        if (product.occasion) checks['occasion'].nonNullCount++;
        if (product.occasionContext && Array.isArray(product.occasionContext) && product.occasionContext.length > 0) {
          checks['occasionContext'].nonNullCount++;
        }
        if (product.season) checks['season'].nonNullCount++;
        if (product.silhouetteCut) checks['silhouetteCut'].nonNullCount++;
        if (product.riseWaist) checks['riseWaist'].nonNullCount++;
      }

      console.log(`   Category: ${key} (${products.length} products sampled)`);
      for (const [key, check] of Object.entries(checks)) {
        const percentage = ((check.nonNullCount / products.length) * 100).toFixed(1);
        console.log(`     ${check.column.padEnd(20)}: ${check.nonNullCount}/${products.length} (${percentage}%)`);
      }
      console.log('');
    }
  }

  // Summary
  console.log('\n📋 Summary:\n');
  
  if (issues.length > 0) {
    console.log('⚠️  Issues Found:\n');
    for (const issue of issues) {
      console.log(`   ${issue}`);
    }
    console.log('');
  } else {
    console.log('   ✅ No source mismatches found\n');
  }

  // Check for missing occasionContext in dictionary extraction
  console.log('🔍 Checking for Missing occasionContext Extraction:\n');
  const buildScriptPath = join(process.cwd(), 'scripts/build-category-specific-dictionaries.ts');
  const buildScript = readFileSync(buildScriptPath, 'utf-8');
  
  if (!buildScript.includes('occasionContext')) {
    console.log('   ❌ occasionContext is NOT being extracted in the build script!');
    console.log('   ⚠️  This is a critical issue - occasions are stored in occasionContext array column\n');
  } else {
    console.log('   ✅ occasionContext is being extracted\n');
  }

  if (!buildScript.includes('silhouetteCut')) {
    console.log('   ❌ silhouetteCut is NOT being extracted in the build script!');
    console.log('   ⚠️  This is a critical issue - styles are stored in silhouetteCut column\n');
  } else {
    console.log('   ✅ silhouetteCut is being extracted\n');
  }

  await prisma.$disconnect();
}

auditDictionarySources().catch(console.error);
