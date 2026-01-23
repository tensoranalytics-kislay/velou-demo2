/**
 * Audit script to check if all constraints are mapped correctly between:
 * 1. Dictionary extraction (build-category-specific-dictionaries.ts)
 * 2. SQL filtering (searchVectorIndexWithDeduplication in vector/index.ts)
 * 3. Post-SQL filtering (post-filter.ts)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface ConstraintMapping {
  constraint: string;
  dictionarySource: string[];
  sqlFilterSource: string[];
  postSQLFilterSource: string[];
  match: boolean;
  issues: string[];
}

const constraintMappings: ConstraintMapping[] = [];

// Read the build script
const buildScriptPath = join(__dirname, 'scripts/build-category-specific-dictionaries.ts');
const buildScript = readFileSync(buildScriptPath, 'utf-8');

// Read the SQL filter file
const vectorIndexPath = join(__dirname, 'src/lib/search/vector/index.ts');
const vectorIndex = readFileSync(vectorIndexPath, 'utf-8');

// Read the post-SQL filter file
const postFilterPath = join(__dirname, 'src/lib/search/filtering/post-filter.ts');
const postFilter = readFileSync(postFilterPath, 'utf-8');

console.log('================================================================================');
console.log('CONSTRAINT MAPPING AUDIT');
console.log('================================================================================\n');

// 1. COLORS
const colorDictMatch = buildScript.match(/extractColorValues\(product\.(enrichedColor|color)/);
const colorSQLMatch = vectorIndex.match(/enriched_color|attributes->>'color'/g);
const colorPostSQLMatch = postFilter.match(/product\.(enrichedColor|color)|attributes.*color/);

const colorMapping: ConstraintMapping = {
  constraint: 'colors',
  dictionarySource: ['enrichedColor (column)', 'color (column)'],
  sqlFilterSource: colorSQLMatch ? [...new Set(colorSQLMatch)] : [],
  postSQLFilterSource: colorPostSQLMatch ? ['enrichedColor/color'] : [],
  match: false,
  issues: [],
};

// Check if SQL filter checks enrichedColor column
if (!vectorIndex.includes('p.attributes->>\'enriched_color\'')) {
  colorMapping.issues.push('SQL filter should check p.attributes->>\'enriched_color\' (PRIMARY SOURCE)');
}
if (!vectorIndex.includes('p."enrichedColor"')) {
  colorMapping.issues.push('SQL filter should check p."enrichedColor" column (if it exists)');
}
colorMapping.match = colorMapping.issues.length === 0;
constraintMappings.push(colorMapping);

// 2. LENGTHS
const lengthDictMatch = buildScript.match(/extractAttributeValue\(product\.length/);
const lengthSQLMatch = vectorIndex.match(/p\."length"|attributes->>'length'/g);
const lengthPostSQLMatch = postFilter.match(/product\.length|attributes.*length/);

const lengthMapping: ConstraintMapping = {
  constraint: 'lengths',
  dictionarySource: ['length (column)', 'attributes->>\'length\''],
  sqlFilterSource: lengthSQLMatch ? [...new Set(lengthSQLMatch)] : [],
  postSQLFilterSource: lengthPostSQLMatch ? ['length'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."length"')) {
  lengthMapping.issues.push('SQL filter should check p."length" column (PRIMARY SOURCE)');
}
lengthMapping.match = lengthMapping.issues.length === 0;
constraintMappings.push(lengthMapping);

// 3. SLEEVES
const sleeveDictMatch = buildScript.match(/extractAttributeValue\(product\.sleeve/);
const sleeveSQLMatch = vectorIndex.match(/p\."sleeve"|attributes->>'sleeve'/g);
const sleevePostSQLMatch = postFilter.match(/product\.sleeve|attributes.*sleeve/);

const sleeveMapping: ConstraintMapping = {
  constraint: 'sleeves',
  dictionarySource: ['sleeve (column)', 'attributes->>\'sleeve\''],
  sqlFilterSource: sleeveSQLMatch ? [...new Set(sleeveSQLMatch)] : [],
  postSQLFilterSource: sleevePostSQLMatch ? ['sleeve'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."sleeve"')) {
  sleeveMapping.issues.push('SQL filter should check p."sleeve" column (PRIMARY SOURCE)');
}
sleeveMapping.match = sleeveMapping.issues.length === 0;
constraintMappings.push(sleeveMapping);

// 4. NECKLINES
const necklineDictMatch = buildScript.match(/extractAttributeValue\(product\.neckline/);
const necklineSQLMatch = vectorIndex.match(/p\."neckline"|attributes->>'neckline'/g);
const necklinePostSQLMatch = postFilter.match(/product\.neckline|attributes.*neckline/);

const necklineMapping: ConstraintMapping = {
  constraint: 'necklines',
  dictionarySource: ['neckline (column)', 'attributes->>\'neckline\''],
  sqlFilterSource: necklineSQLMatch ? [...new Set(necklineSQLMatch)] : [],
  postSQLFilterSource: necklinePostSQLMatch ? ['neckline'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."neckline"')) {
  necklineMapping.issues.push('SQL filter should check p."neckline" column (PRIMARY SOURCE)');
}
necklineMapping.match = necklineMapping.issues.length === 0;
constraintMappings.push(necklineMapping);

// 5. FORMALITY LEVEL
const formalityDictMatch = buildScript.match(/extractAttributeValue\(product\.formalityLevel/);
const formalitySQLMatch = vectorIndex.match(/p\."formalityLevel"|attributes->>'formalityLevel'/g);
const formalityPostSQLMatch = postFilter.match(/product\.formalityLevel|attributes.*formalityLevel/);

const formalityMapping: ConstraintMapping = {
  constraint: 'formalityLevel',
  dictionarySource: ['formalityLevel (column)', 'attributes->>\'formalityLevel\''],
  sqlFilterSource: formalitySQLMatch ? [...new Set(formalitySQLMatch)] : [],
  postSQLFilterSource: formalityPostSQLMatch ? ['formalityLevel'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."formalityLevel"')) {
  formalityMapping.issues.push('SQL filter should check p."formalityLevel" column (PRIMARY SOURCE)');
}
formalityMapping.match = formalityMapping.issues.length === 0;
constraintMappings.push(formalityMapping);

// 6. COLOR SHADE
const colorShadeDictMatch = buildScript.match(/extractAttributeValue\(product\.colorShade/);
const colorShadeSQLMatch = vectorIndex.match(/p\."colorShade"|attributes->>'colorShade'/g);
const colorShadePostSQLMatch = postFilter.match(/product\.colorShade|attributes.*colorShade/);

const colorShadeMapping: ConstraintMapping = {
  constraint: 'colorShade',
  dictionarySource: ['colorShade (column)', 'attributes->>\'colorShade\''],
  sqlFilterSource: colorShadeSQLMatch ? [...new Set(colorShadeSQLMatch)] : [],
  postSQLFilterSource: colorShadePostSQLMatch ? ['colorShade'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."colorShade"')) {
  colorShadeMapping.issues.push('SQL filter should check p."colorShade" column (PRIMARY SOURCE)');
}
colorShadeMapping.match = colorShadeMapping.issues.length === 0;
constraintMappings.push(colorShadeMapping);

// 7. FIT
const fitDictMatch = buildScript.match(/extractAttributeValue\(product\.fit/);
const fitSQLMatch = vectorIndex.match(/p\."fit"|attributes->>'fit'/g);
const fitPostSQLMatch = postFilter.match(/product\.fit|attributes.*fit/);

const fitMapping: ConstraintMapping = {
  constraint: 'fits',
  dictionarySource: ['fit (column)', 'attributes->>\'fit\''],
  sqlFilterSource: fitSQLMatch ? [...new Set(fitSQLMatch)] : [],
  postSQLFilterSource: fitPostSQLMatch ? ['fit'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."fit"')) {
  fitMapping.issues.push('SQL filter should check p."fit" column (PRIMARY SOURCE)');
}
fitMapping.match = fitMapping.issues.length === 0;
constraintMappings.push(fitMapping);

// 8. MATERIALS
const materialDictMatch = buildScript.match(/extractAttributeValue\(product\.(material|fabric)/);
const materialSQLMatch = vectorIndex.match(/p\."material"|p\."fabric"|attributes->>'material'|attributes->>'fabric'/g);
const materialPostSQLMatch = postFilter.match(/product\.(material|fabric)|attributes.*(material|fabric)/);

const materialMapping: ConstraintMapping = {
  constraint: 'materials',
  dictionarySource: ['material (column)', 'fabric (column)', 'attributes->>\'material\'', 'attributes->>\'fabric\''],
  sqlFilterSource: materialSQLMatch ? [...new Set(materialSQLMatch)] : [],
  postSQLFilterSource: materialPostSQLMatch ? ['material/fabric'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."material"') && !vectorIndex.includes('p."fabric"')) {
  materialMapping.issues.push('SQL filter should check p."material" or p."fabric" column (PRIMARY SOURCE)');
}
materialMapping.match = materialMapping.issues.length === 0;
constraintMappings.push(materialMapping);

// 9. OCCASIONS
const occasionDictMatch = buildScript.match(/extractAttributeValue\(product\.occasion/);
const occasionSQLMatch = vectorIndex.match(/p\."occasion"|p\."occasionContext"|attributes->>'occasion'/g);
const occasionPostSQLMatch = postFilter.match(/product\.occasion|attributes.*occasion/);

const occasionMapping: ConstraintMapping = {
  constraint: 'occasions',
  dictionarySource: ['occasion (column)', 'attributes->>\'occasion\''],
  sqlFilterSource: occasionSQLMatch ? [...new Set(occasionSQLMatch)] : [],
  postSQLFilterSource: occasionPostSQLMatch ? ['occasion'] : [],
  match: false,
  issues: [],
};

// Check if SQL filter checks occasionContext (array column) - this is the PRIMARY SOURCE
if (!vectorIndex.includes('p."occasionContext"')) {
  occasionMapping.issues.push('SQL filter should check p."occasionContext" column (PRIMARY SOURCE - array type)');
}
if (!vectorIndex.includes('p."occasion"')) {
  occasionMapping.issues.push('SQL filter should check p."occasion" column (if it exists)');
}
occasionMapping.match = occasionMapping.issues.length === 0;
constraintMappings.push(occasionMapping);

// 10. SEASONS
const seasonDictMatch = buildScript.match(/extractAttributeValue\(product\.season/);
const seasonSQLMatch = vectorIndex.match(/p\."season"|attributes->>'season'/g);
const seasonPostSQLMatch = postFilter.match(/product\.season|attributes.*season/);

const seasonMapping: ConstraintMapping = {
  constraint: 'seasons',
  dictionarySource: ['season (column)', 'attributes->>\'season\''],
  sqlFilterSource: seasonSQLMatch ? [...new Set(seasonSQLMatch)] : [],
  postSQLFilterSource: seasonPostSQLMatch ? ['season'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."season"')) {
  seasonMapping.issues.push('SQL filter should check p."season" column (PRIMARY SOURCE)');
}
seasonMapping.match = seasonMapping.issues.length === 0;
constraintMappings.push(seasonMapping);

// 11. STYLES
const styleDictMatch = buildScript.match(/extractAttributeValue\(null.*attr_style/);
const styleSQLMatch = vectorIndex.match(/p\."silhouetteCut"|attributes->>'style'/g);
const stylePostSQLMatch = postFilter.match(/product\.silhouetteCut|attributes.*style/);

const styleMapping: ConstraintMapping = {
  constraint: 'styles',
  dictionarySource: ['attributes->>\'style\' (only - no column in build script)'],
  sqlFilterSource: styleSQLMatch ? [...new Set(styleSQLMatch)] : [],
  postSQLFilterSource: stylePostSQLMatch ? ['silhouetteCut/style'] : [],
  match: false,
  issues: [],
};

// Dictionary uses attributes->>'style', but SQL should check silhouetteCut column (PRIMARY SOURCE)
if (!vectorIndex.includes('p."silhouetteCut"')) {
  styleMapping.issues.push('SQL filter should check p."silhouetteCut" column (PRIMARY SOURCE for styles)');
}
// Check if build script should also extract from silhouetteCut
if (!buildScript.includes('silhouetteCut')) {
  styleMapping.issues.push('Dictionary build script should extract from p."silhouetteCut" column (PRIMARY SOURCE)');
}
styleMapping.match = styleMapping.issues.length === 0;
constraintMappings.push(styleMapping);

// 12. PATTERNS
const patternDictMatch = buildScript.match(/extractAttributeValue\(null.*attr_pattern/);
const patternSQLMatch = vectorIndex.match(/attributes->>'pattern'|attributes->'Pattern'/g);
const patternPostSQLMatch = postFilter.match(/attributes.*pattern/);

const patternMapping: ConstraintMapping = {
  constraint: 'patterns',
  dictionarySource: ['attributes->>\'pattern\' (only - no column)'],
  sqlFilterSource: patternSQLMatch ? [...new Set(patternSQLMatch)] : [],
  postSQLFilterSource: patternPostSQLMatch ? ['pattern'] : [],
  match: true, // Patterns are only in attributes, so this should be fine
  issues: [],
};
constraintMappings.push(patternMapping);

// 13. SIZES
const sizeDictMatch = buildScript.match(/extractAttributeValue\(null.*attr_size/);
const sizeSQLMatch = vectorIndex.match(/attributes->>'size'|attributes->'Size'/g);
const sizePostSQLMatch = postFilter.match(/attributes.*size/);

const sizeMapping: ConstraintMapping = {
  constraint: 'sizes',
  dictionarySource: ['attributes->>\'size\' (only - no column)'],
  sqlFilterSource: sizeSQLMatch ? [...new Set(sizeSQLMatch)] : [],
  postSQLFilterSource: sizePostSQLMatch ? ['size'] : [],
  match: true, // Sizes are only in attributes, so this should be fine
  issues: [],
};
constraintMappings.push(sizeMapping);

// 14. RISES
const riseDictMatch = buildScript.match(/extractAttributeValue\(product\.riseWaist/);
const riseSQLMatch = vectorIndex.match(/p\."riseWaist"|attributes->>'rise'/g);
const risePostSQLMatch = postFilter.match(/product\.riseWaist|attributes.*rise/);

const riseMapping: ConstraintMapping = {
  constraint: 'rises',
  dictionarySource: ['riseWaist (column)', 'attributes->>\'riseWaist\'', 'attributes->>\'rise\''],
  sqlFilterSource: riseSQLMatch ? [...new Set(riseSQLMatch)] : [],
  postSQLFilterSource: risePostSQLMatch ? ['riseWaist'] : [],
  match: false,
  issues: [],
};

if (!vectorIndex.includes('p."riseWaist"')) {
  riseMapping.issues.push('SQL filter should check p."riseWaist" column (PRIMARY SOURCE)');
}
riseMapping.match = riseMapping.issues.length === 0;
constraintMappings.push(riseMapping);

// Print results
console.log('CONSTRAINT MAPPING RESULTS:\n');
const mismatches = constraintMappings.filter(m => !m.match);
const matches = constraintMappings.filter(m => m.match);

console.log(`✅ MATCHED: ${matches.length}/${constraintMappings.length}`);
matches.forEach(m => {
  console.log(`   - ${m.constraint}: ${m.dictionarySource.join(', ')}`);
});

console.log(`\n❌ MISMATCHED: ${mismatches.length}/${constraintMappings.length}`);
mismatches.forEach(m => {
  console.log(`\n   ${m.constraint}:`);
  console.log(`     Dictionary extracts from: ${m.dictionarySource.join(', ')}`);
  console.log(`     SQL filter checks: ${m.sqlFilterSource.join(', ') || 'NOT FOUND'}`);
  console.log(`     Issues:`);
  m.issues.forEach(issue => console.log(`       - ${issue}`));
});

console.log('\n================================================================================');
console.log('SUMMARY');
console.log('================================================================================\n');

if (mismatches.length === 0) {
  console.log('✅ All constraints are correctly mapped!');
} else {
  console.log(`⚠️  Found ${mismatches.length} constraint(s) with mapping issues:`);
  mismatches.forEach(m => {
    console.log(`   - ${m.constraint}: ${m.issues.length} issue(s)`);
  });
}
