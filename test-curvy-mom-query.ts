/**
 * Test script for "curvy mom/woman" query
 * Tests the full pipeline and shows what constraints are extracted and how they're used
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function testCurvyMomQuery() {
  const sessionId = `test-curvy-mom-${Date.now()}`;
  // Test with a more specific query that mentions a product type
  const query = "I am a curvy mom, suggest me a dress to wear";
  
  console.log('='.repeat(80));
  console.log(`🧪 Testing Query: "${query}"`);
  console.log('='.repeat(80));
  console.log(`📡 API Base: ${API_BASE}\n`);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        pageType: 'HOME' as const,
        message: query,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 500)}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    console.log('\n📊 PIPELINE RESULTS');
    console.log('='.repeat(80));
    
    // Show extracted constraints
    console.log('\n🔍 EXTRACTED CONSTRAINTS:');
    console.log('-'.repeat(80));
    
    if (result.resolvedConstraints) {
      const constraints = result.resolvedConstraints;
      
      console.log('\n📋 Hard Filters (used at SQL level):');
      if (constraints.category) {
        console.log(`  • Category: ${JSON.stringify(constraints.category)}`);
      }
      if (constraints.genders?.length) {
        console.log(`  • Genders: ${JSON.stringify(constraints.genders)}`);
      }
      if (constraints.priceMinCents) {
        console.log(`  • Price Min: $${(constraints.priceMinCents / 100).toFixed(2)}`);
      }
      if (constraints.priceMaxCents) {
        console.log(`  • Price Max: $${(constraints.priceMaxCents / 100).toFixed(2)}`);
      }
      if (constraints.brands?.length) {
        console.log(`  • Brands: ${JSON.stringify(constraints.brands)}`);
      }
      if (constraints.inStockOnly !== false) {
        console.log(`  • Stock: In stock only: ${constraints.inStockOnly}`);
      }
      
      console.log('\n🎯 Soft Filters/Ranking (used for ranking/scoring):');
      if (constraints.colors?.length) {
        console.log(`  • Colors: ${JSON.stringify(constraints.colors)}`);
      }
      if (constraints.fabrics?.length) {
        console.log(`  • Fabrics: ${JSON.stringify(constraints.fabrics)}`);
      }
      if (constraints.materials?.length) {
        console.log(`  • Materials: ${JSON.stringify(constraints.materials)}`);
      }
      if (constraints.sizes?.length) {
        console.log(`  • Sizes: ${JSON.stringify(constraints.sizes)}`);
      }
      if (constraints.fit) {
        console.log(`  • Fit: ${constraints.fit}`);
      }
      if (constraints.seasons?.length) {
        console.log(`  • Seasons: ${JSON.stringify(constraints.seasons)}`);
      }
      if (constraints.occasions?.length) {
        console.log(`  • Occasions: ${JSON.stringify(constraints.occasions)}`);
      }
      if (constraints.ageGroups?.length) {
        console.log(`  • Age Groups: ${JSON.stringify(constraints.ageGroups)}`);
      }
      if (constraints.useCases?.length) {
        console.log(`  • Use Cases: ${JSON.stringify(constraints.useCases)}`);
      }
      if (constraints.query) {
        console.log(`  • Query Text (for ranking): "${constraints.query}"`);
      }
      
      // Show enriched fashion facets if present
      const enrichedFacets: string[] = [];
      if (constraints.lengths?.length) enrichedFacets.push(`lengths: ${JSON.stringify(constraints.lengths)}`);
      if (constraints.formalityLevel?.length) enrichedFacets.push(`formalityLevel: ${JSON.stringify(constraints.formalityLevel)}`);
      if (constraints.temperatureIntent) enrichedFacets.push(`temperatureIntent: ${constraints.temperatureIntent}`);
      if (constraints.humidityFriendly !== undefined) enrichedFacets.push(`humidityFriendly: ${constraints.humidityFriendly}`);
      if (constraints.occasionContext?.length) enrichedFacets.push(`occasionContext: ${JSON.stringify(constraints.occasionContext)}`);
      if (constraints.problemSolutions?.length) enrichedFacets.push(`problemSolutions: ${JSON.stringify(constraints.problemSolutions)}`);
      if (constraints.functionFeatures?.length) enrichedFacets.push(`functionFeatures: ${JSON.stringify(constraints.functionFeatures)}`);
      
      if (enrichedFacets.length > 0) {
        console.log('\n✨ Enriched Fashion Facets (for ranking/soft matching):');
        enrichedFacets.forEach(facet => console.log(`  • ${facet}`));
      }
    } else {
      console.log('  ⚠️  No resolvedConstraints in response');
    }
    
    // Show classification constraints if present
    if (result.resolvedClassificationConstraints) {
      console.log('\n📝 Classification Constraints (from classifier):');
      const classConstraints = result.resolvedClassificationConstraints;
      if (classConstraints.ageGroups?.length) {
        console.log(`  • Age Groups: ${JSON.stringify(classConstraints.ageGroups)}`);
      }
      if (classConstraints.fit) {
        console.log(`  • Fit: ${classConstraints.fit}`);
      }
      if (classConstraints.types) {
        console.log(`  • Types: ${JSON.stringify(classConstraints.types)}`);
      }
    }
    
    // Show results
    console.log('\n\n📦 SEARCH RESULTS:');
    console.log('-'.repeat(80));
    console.log(`  ⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`  📊 Products Returned: ${result.productCards?.length || 0}`);
    console.log(`  ✅ Exact Match: ${!result.noExactMatch ? 'Yes' : 'No'}`);
    console.log(`  🛤️  Route: ${result.route || 'UNKNOWN'}`);
    if (result.usedFollowUpContext) {
      console.log(`  🔄 Used Follow-up Context: Yes`);
    }
    
    if (result.productCards && result.productCards.length > 0) {
      console.log('\n  🎯 Top Products:');
      result.productCards.slice(0, 5).forEach((product: any, idx: number) => {
        console.log(`\n    ${idx + 1}. ${product.title?.substring(0, 60)}...`);
        console.log(`       💰 Price: $${((product.priceCents || 0) / 100).toFixed(2)}`);
        console.log(`       📂 Category: ${product.category || 'N/A'}`);
        if (product.attributes) {
          const attrs = product.attributes;
          const attrParts: string[] = [];
          if (attrs.color) attrParts.push(`Color: ${attrs.color}`);
          if (attrs.fabric) attrParts.push(`Fabric: ${attrs.fabric}`);
          if (attrs.fit) attrParts.push(`Fit: ${attrs.fit}`);
          if (attrs.length) attrParts.push(`Length: ${attrs.length}`);
          if (attrParts.length > 0) {
            console.log(`       🏷️  Attributes: ${attrParts.join(', ')}`);
          }
        }
        if (product.reason) {
          console.log(`       💬 Reason: ${product.reason}`);
        }
      });
    }
    
    // Show reply text
    if (result.replyText) {
      console.log('\n\n💬 ASSISTANT REPLY:');
      console.log('-'.repeat(80));
      console.log(result.replyText);
      if (result.replyTextAfter) {
        console.log('\n' + result.replyTextAfter);
      }
    }
    
    // Summary
    console.log('\n\n📈 SUMMARY:');
    console.log('='.repeat(80));
    console.log('\n🎯 Constraint Usage Breakdown:');
    console.log('\n   HARD FILTERS (SQL WHERE clause):');
    if (result.resolvedConstraints) {
      const c = result.resolvedConstraints;
      const hardFilters: string[] = [];
      if (c.category) hardFilters.push('category');
      if (c.genders?.length) hardFilters.push('genders');
      if (c.priceMinCents || c.priceMaxCents) hardFilters.push('price range');
      if (c.inStockOnly !== false) hardFilters.push('stock status');
      if (c.brands?.length) hardFilters.push('brands');
      console.log(`     - ${hardFilters.length > 0 ? hardFilters.join(', ') : 'None'}`);
    }
    
    console.log('\n   SOFT FILTERS/RANKING (in-memory scoring):');
    if (result.resolvedConstraints) {
      const c = result.resolvedConstraints;
      const softFilters: string[] = [];
      if (c.colors?.length) softFilters.push('colors');
      if (c.fabrics?.length) softFilters.push('fabrics');
      if (c.materials?.length) softFilters.push('materials');
      if (c.fit) softFilters.push('fit');
      if (c.seasons?.length) softFilters.push('seasons');
      if (c.occasions?.length) softFilters.push('occasions');
      if (c.ageGroups?.length) softFilters.push('ageGroups');
      if (c.query) softFilters.push('query text (full-text search)');
      console.log(`     - ${softFilters.length > 0 ? softFilters.join(', ') : 'None'}`);
    }
    
    console.log('\n   RESULTS:');
    console.log(`     - ${result.productCards?.length || 0} products returned`);
    console.log(`     - ${result.noExactMatch ? 'No exact match (relaxed)' : 'Exact match'} criteria`);
    console.log(`     - Query processed in ${(duration / 1000).toFixed(2)}s`);
    
    console.log('\n' + '='.repeat(80) + '\n');
    
    return result;
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Run the test
testCurvyMomQuery()
  .then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
