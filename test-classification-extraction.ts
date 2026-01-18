/**
 * Test script to verify constraint extraction with LLM
 * Tests classification with "dresses for curvy women" query
 */

// Environment variables should be loaded automatically by Next.js config
// If not, they'll be loaded when config.ts is imported

import { classifyQueryWithMetadata } from './src/lib/loveshackfancy/classifier';
import { loadConstraintDictionaries } from './src/lib/loveshackfancy/constraint-dictionaries';

async function testClassificationExtraction() {
  console.log('🧪 Testing Classification Constraint Extraction\n');
  console.log('=' .repeat(80));
  
  // Load dictionaries to verify values exist
  const dictionaries = loadConstraintDictionaries();
  console.log('\n📚 Dictionary Summary:');
  console.log(`  Styles: ${dictionaries.styles.length} values (includes: ${dictionaries.styles.slice(0, 5).join(', ')})`);
  console.log(`  Necklines: ${dictionaries.necklines.length} values`);
  console.log(`  Lengths: ${dictionaries.lengths.length} values`);
  console.log(`  Fits: ${dictionaries.fits.length} values`);
  console.log(`  ColorUndertone: ${dictionaries.colorUndertone?.length || 0} values`);
  console.log(`  SeasonalPalette: ${dictionaries.seasonalPalette?.length || 0} values`);
  
  const testQuery = "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it";
  console.log(`\n🔍 Testing Query: "${testQuery}"\n`);
  console.log('Expected extractions (styling/occasion-based):');
  console.log('  - Product terms: "dress"');
  console.log('  - gender: "female" (dress)');
  console.log('  - styles: possibly ["Casual", "Bohemian", "Romantic"] (matches Dr. Martens aesthetic)');
  console.log('  - occasions: possibly ["Casual", "Daytime"]');
  console.log('  - formalityLevel: possibly ["Casual"]');
  console.log('  - Pairing intent: matching with existing shoes');
  
  console.log('\n' + '='.repeat(80));
  console.log('📞 Calling LLM for classification...\n');
  
  try {
    const startTime = Date.now();
    const result = await classifyQueryWithMetadata(
      testQuery,
      null, // lastConstraints
      null  // enhancedQuery
    );
    const duration = Date.now() - startTime;
    
    console.log('✅ Classification Complete\n');
    console.log('='.repeat(80));
    console.log('\n📊 RESULTS:\n');
    
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s\n`);
    
    console.log('📝 Classification Type:', result.classification.type);
    console.log('📊 Confidence:', result.classification.confidence);
    console.log('🏷️  Product Terms:', result.classification.productTerms);
    
    console.log('\n🎯 EXTRACTED CONSTRAINTS:\n');
    const constraints = result.classification.constraints;
    
    // Check styles
    if (constraints.styles) {
      const styleValues = Array.isArray(constraints.styles) 
        ? constraints.styles 
        : (constraints.styles as any)?.values || [];
      const styleIntent = (constraints.styles as any)?.intent || 'N/A';
      console.log(`  ✅ styles: ${JSON.stringify(styleValues)} [intent: ${styleIntent}]`);
      console.log(`     ${styleValues.length > 0 ? '✅' : '❌'} Has values`);
      
      // Check if expected values are present
      const expectedStyles = ['A-Line', 'Wrap', 'Fit and Flare', 'Empire'];
      const foundExpected = expectedStyles.filter(s => 
        styleValues.some((v: string) => v.toLowerCase().includes(s.toLowerCase()))
      );
      console.log(`     Expected values found: ${foundExpected.join(', ') || 'NONE'}`);
    } else {
      console.log(`  ❌ styles: null (NOT EXTRACTED)`);
    }
    
    // Check necklines
    if (constraints.necklines) {
      const necklineValues = Array.isArray(constraints.necklines) 
        ? constraints.necklines 
        : (constraints.necklines as any)?.values || [];
      const necklineIntent = (constraints.necklines as any)?.intent || 'N/A';
      console.log(`  ✅ necklines: ${JSON.stringify(necklineValues)} [intent: ${necklineIntent}]`);
    } else {
      console.log(`  ⚠️  necklines: null`);
    }
    
    // Check lengths
    if (constraints.lengths) {
      const lengthValues = Array.isArray(constraints.lengths) 
        ? constraints.lengths 
        : (constraints.lengths as any)?.values || [];
      const lengthIntent = (constraints.lengths as any)?.intent || 'N/A';
      console.log(`  ✅ lengths: ${JSON.stringify(lengthValues)} [intent: ${lengthIntent}]`);
    } else {
      console.log(`  ⚠️  lengths: null`);
    }
    
    // Check fits
    if (constraints.fits) {
      const fitValues = Array.isArray(constraints.fits) 
        ? constraints.fits 
        : (constraints.fits as any)?.values || [];
      const fitIntent = (constraints.fits as any)?.intent || 'N/A';
      console.log(`  ✅ fits: ${JSON.stringify(fitValues)} [intent: ${fitIntent}]`);
    } else {
      console.log(`  ⚠️  fits: null`);
    }
    
    // Check ageGroups
    if (constraints.ageGroups) {
      const ageValues = Array.isArray(constraints.ageGroups) 
        ? constraints.ageGroups 
        : (constraints.ageGroups as any)?.values || [];
      const ageIntent = (constraints.ageGroups as any)?.intent || 'N/A';
      console.log(`  ✅ ageGroups: ${JSON.stringify(ageValues)} [intent: ${ageIntent}]`);
    } else {
      console.log(`  ⚠️  ageGroups: null`);
    }
    
    // Check gender
    console.log(`  ${constraints.gender ? '✅' : '⚠️ '} gender: ${constraints.gender || 'null'}`);
    
    // Check other constraints
    const otherConstraints = ['colors', 'materials', 'occasions', 'patterns', 'sizes', 
                              'formalityLevel', 'rises', 'sleeveLengths', 'collections', 
                              'seasons', 'colorShade', 'colorUndertone', 'embellishments', 'seasonalPalette'];
    otherConstraints.forEach(key => {
      const value = (constraints as any)[key];
      if (value) {
        const values = Array.isArray(value) ? value : (value as any)?.values || [];
        const intent = (value as any)?.intent || 'N/A';
        if (values.length > 0) {
          console.log(`  ✅ ${key}: ${JSON.stringify(values)} [intent: ${intent}]`);
        }
      }
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📋 FULL CONSTRAINTS OBJECT:');
    console.log(JSON.stringify(constraints, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('\n🔍 VALIDATION:\n');
    
    // Validate against dictionaries
    if (constraints.styles) {
      const styleValues = Array.isArray(constraints.styles) 
        ? constraints.styles 
        : (constraints.styles as any)?.values || [];
      const invalidStyles = styleValues.filter((s: string) => 
        !dictionaries.styles.some(d => d.toLowerCase() === s.toLowerCase())
      );
      if (invalidStyles.length > 0) {
        console.log(`  ❌ Invalid styles found: ${JSON.stringify(invalidStyles)}`);
        console.log(`     (Not in dictionary)`);
      } else {
        console.log(`  ✅ All styles are valid (found in dictionary)`);
      }
    }
    
    console.log('\n✅ Test Complete!\n');
    
  } catch (error) {
    console.error('\n❌ Error during classification:');
    console.error(error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
  
  process.exit(0);
}

testClassificationExtraction();
