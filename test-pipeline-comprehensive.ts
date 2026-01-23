import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

interface TestQuery {
  name: string;
  query: string;
  type: 'vague' | 'direct';
  expectedConstraints?: {
    category?: string[];
    colors?: string[];
    styles?: string[];
    occasions?: string[];
    materials?: string[];
    [key: string]: any;
  };
}

const testQueries: TestQuery[] = [
  // VAGUE QUERIES (with categories)
  {
    name: 'Vague 1: Soft summer dress',
    query: 'I need something soft and flowy for a summer garden party. Show me dresses.',
    type: 'vague',
    expectedConstraints: {
      category: ['dress'],
      occasions: ['garden party', 'summer'],
      materials: ['soft', 'flowy'],
    },
  },
  {
    name: 'Vague 2: Elegant evening wear',
    query: 'Looking for something elegant and sophisticated for a formal event. I prefer dresses.',
    type: 'vague',
    expectedConstraints: {
      category: ['dress'],
      occasions: ['formal', 'evening'],
      formalityLevel: ['formal', 'elegant'],
    },
  },
  {
    name: 'Vague 3: Comfortable casual outfit',
    query: 'I want something comfortable and casual for everyday wear. Show me dresses that are easy to move in.',
    type: 'vague',
    expectedConstraints: {
      category: ['dress'],
      occasions: ['casual', 'everyday'],
      fits: ['comfortable', 'easy to move'],
    },
  },
  {
    name: 'Vague 4: Romantic date night look',
    query: 'Help me find a romantic dress for a special date night. Something feminine and flattering.',
    type: 'vague',
    expectedConstraints: {
      category: ['dress'],
      occasions: ['date night', 'romantic'],
      styles: ['feminine', 'flattering'],
    },
  },
  
  // DIRECT QUERIES (with categories)
  {
    name: 'Direct 1: Blue maxi dress',
    query: 'Do you have any blue maxi dresses?',
    type: 'direct',
    expectedConstraints: {
      category: ['dress'],
      colors: ['blue'],
      lengths: ['maxi'],
    },
  },
  {
    name: 'Direct 2: White A-line wedding dress',
    query: 'I need a white A-line wedding dress for my ceremony.',
    type: 'direct',
    expectedConstraints: {
      category: ['dress'],
      colors: ['white'],
      styles: ['A-Line', 'A-line'],
      occasions: ['wedding', 'ceremony'],
    },
  },
  {
    name: 'Direct 3: Pink floral midi dress',
    query: 'Show me pink floral midi dresses.',
    type: 'direct',
    expectedConstraints: {
      category: ['dress'],
      colors: ['pink'],
      patterns: ['floral'],
      lengths: ['midi'],
    },
  },
  {
    name: 'Direct 4: Black cocktail dress',
    query: 'I need a black cocktail dress for a party. Size medium.',
    type: 'direct',
    expectedConstraints: {
      category: ['dress'],
      colors: ['black'],
      occasions: ['cocktail', 'party'],
      sizes: ['medium'],
    },
  },
];

async function runComprehensiveTests() {
  console.log('='.repeat(100));
  console.log('COMPREHENSIVE PIPELINE TEST');
  console.log('Testing 8 queries: 4 vague + 4 direct (all with categories)');
  console.log('='.repeat(100));
  console.log('');

  const results: Array<{
    test: TestQuery;
    passed: boolean;
    issues: string[];
    productCount: number;
    extractedConstraints: any;
    products: any[];
  }> = [];

  for (let i = 0; i < testQueries.length; i++) {
    const test = testQueries[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}/${testQueries.length}: ${test.name}`);
    console.log(`Type: ${test.type.toUpperCase()}`);
    console.log(`Query: "${test.query}"`);
    console.log('='.repeat(100));

    try {
      const startTime = Date.now();
      const result = await handleAssistantQuery(
        'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
        {
          message: test.query,
          sessionId: `test-session-${Date.now()}-${i}`,
        }
      );
      const duration = Date.now() - startTime;

      console.log(`\n⏱️  Response Time: ${duration}ms`);
      console.log(`\n📝 Reply Text: ${result.replyText?.substring(0, 200)}...`);
      console.log(`\n📦 Product Count: ${result.productCards?.length || 0}`);
      console.log(`\n🎯 Route: ${result.route}`);

      // Extract constraints from resolved constraints
      const extractedConstraints = result.resolvedConstraints || {};
      console.log(`\n🔍 Extracted Constraints:`);
      console.log(`   Category: ${extractedConstraints.category || 'N/A'}`);
      console.log(`   Colors: ${extractedConstraints.colors?.join(', ') || 'N/A'}`);
      console.log(`   Styles: ${extractedConstraints.styleTags?.join(', ') || 'N/A'}`);
      console.log(`   Occasions: ${extractedConstraints.occasions?.join(', ') || 'N/A'}`);
      console.log(`   Materials: ${extractedConstraints.materials?.join(', ') || 'N/A'}`);
      console.log(`   Lengths: ${extractedConstraints.lengths?.join(', ') || 'N/A'}`);
      console.log(`   Sizes: ${extractedConstraints.sizes?.join(', ') || 'N/A'}`);

      // Validate constraint extraction
      const issues: string[] = [];
      let passed = true;

      if (test.expectedConstraints) {
        console.log(`\n✅ Constraint Validation:`);
        
        // Check category
        if (test.expectedConstraints.category) {
          const hasCategory = extractedConstraints.category?.some((c: string) =>
            test.expectedConstraints!.category!.some(exp => 
              c.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasCategory) {
            issues.push(`Missing expected category: ${test.expectedConstraints.category.join(', ')}`);
            passed = false;
          } else {
            console.log(`   ✓ Category matches`);
          }
        }

        // Check colors
        if (test.expectedConstraints.colors) {
          const hasColor = extractedConstraints.colors?.some((c: string) =>
            test.expectedConstraints!.colors!.some(exp => 
              c.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasColor && test.type === 'direct') {
            issues.push(`Missing expected color: ${test.expectedConstraints.colors.join(', ')}`);
            passed = false;
          } else if (hasColor) {
            console.log(`   ✓ Color matches`);
          }
        }

        // Check styles
        if (test.expectedConstraints.styles) {
          const hasStyle = extractedConstraints.styleTags?.some((s: string) =>
            test.expectedConstraints!.styles!.some(exp => 
              s.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasStyle && test.type === 'direct') {
            issues.push(`Missing expected style: ${test.expectedConstraints.styles.join(', ')}`);
            passed = false;
          } else if (hasStyle) {
            console.log(`   ✓ Style matches`);
          }
        }

        // Check occasions
        if (test.expectedConstraints.occasions) {
          const hasOccasion = extractedConstraints.occasions?.some((o: string) =>
            test.expectedConstraints!.occasions!.some(exp => 
              o.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasOccasion && test.type === 'direct') {
            issues.push(`Missing expected occasion: ${test.expectedConstraints.occasions.join(', ')}`);
            passed = false;
          } else if (hasOccasion) {
            console.log(`   ✓ Occasion matches`);
          }
        }

        // Check materials
        if (test.expectedConstraints.materials) {
          const hasMaterial = extractedConstraints.materials?.some((m: string) =>
            test.expectedConstraints!.materials!.some(exp => 
              m.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (hasMaterial) {
            console.log(`   ✓ Material matches`);
          }
        }

        // Check lengths
        if (test.expectedConstraints.lengths) {
          const hasLength = extractedConstraints.lengths?.some((l: string) =>
            test.expectedConstraints!.lengths!.some(exp => 
              l.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasLength && test.type === 'direct') {
            issues.push(`Missing expected length: ${test.expectedConstraints.lengths.join(', ')}`);
            passed = false;
          } else if (hasLength) {
            console.log(`   ✓ Length matches`);
          }
        }

        // Check sizes
        if (test.expectedConstraints.sizes) {
          const hasSize = extractedConstraints.sizes?.some((s: string) =>
            test.expectedConstraints!.sizes!.some(exp => 
              s.toLowerCase().includes(exp.toLowerCase())
            )
          );
          if (!hasSize && test.type === 'direct') {
            issues.push(`Missing expected size: ${test.expectedConstraints.sizes.join(', ')}`);
            passed = false;
          } else if (hasSize) {
            console.log(`   ✓ Size matches`);
          }
        }
      }

      // Validate products match constraints
      if (result.productCards && result.productCards.length > 0) {
        console.log(`\n📋 Products Returned:`);
        const productIds = result.productCards.map(p => p.id);
        const dbProducts = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            title: true,
            category: true,
            color: true,
            enrichedColor: true,
            silhouetteCut: true,
            length: true,
            occasion: true,
            attributes: true,
          },
        });

        for (let j = 0; j < Math.min(4, result.productCards.length); j++) {
          const card = result.productCards[j];
          const dbProduct = dbProducts.find(p => p.id === card.id);
          if (dbProduct) {
            console.log(`\n   ${j + 1}. ${card.title}`);
            console.log(`      ID: ${card.id}`);
            console.log(`      Category: ${dbProduct.category || 'N/A'}`);
            console.log(`      Color: ${dbProduct.enrichedColor || dbProduct.color || 'N/A'}`);
            console.log(`      Style: ${dbProduct.silhouetteCut || 'N/A'}`);
            console.log(`      Length: ${dbProduct.length || 'N/A'}`);
            console.log(`      Occasion: ${dbProduct.occasion || 'N/A'}`);
            
            // Check if product matches expected constraints
            const productIssues: string[] = [];
            if (test.expectedConstraints?.colors && dbProduct.enrichedColor) {
              const productColor = dbProduct.enrichedColor.toLowerCase();
              const matchesColor = test.expectedConstraints.colors.some(exp =>
                productColor.includes(exp.toLowerCase())
              );
              if (!matchesColor && test.type === 'direct') {
                productIssues.push(`Color mismatch: expected ${test.expectedConstraints.colors.join(', ')}, got ${dbProduct.enrichedColor}`);
              }
            }
            if (test.expectedConstraints?.styles && dbProduct.silhouetteCut) {
              const productStyle = dbProduct.silhouetteCut.toLowerCase();
              const matchesStyle = test.expectedConstraints.styles.some(exp =>
                productStyle.includes(exp.toLowerCase())
              );
              if (!matchesStyle && test.type === 'direct') {
                productIssues.push(`Style mismatch: expected ${test.expectedConstraints.styles.join(', ')}, got ${dbProduct.silhouetteCut}`);
              }
            }
            if (productIssues.length > 0) {
              console.log(`      ⚠️  Issues: ${productIssues.join('; ')}`);
              issues.push(...productIssues);
              passed = false;
            }
          }
        }
      } else {
        issues.push('No products returned');
        passed = false;
      }

      results.push({
        test,
        passed,
        issues,
        productCount: result.productCards?.length || 0,
        extractedConstraints,
        products: result.productCards || [],
      });

      if (passed) {
        console.log(`\n✅ TEST PASSED`);
      } else {
        console.log(`\n❌ TEST FAILED`);
        console.log(`   Issues: ${issues.join('; ')}`);
      }

    } catch (error: any) {
      console.error(`\n❌ ERROR: ${error.message}`);
      console.error(`Stack: ${error.stack}`);
      results.push({
        test,
        passed: false,
        issues: [error.message || String(error)],
        productCount: 0,
        extractedConstraints: {},
        products: [],
      });
    }
  }

  // Final Summary
  console.log(`\n\n${'='.repeat(100)}`);
  console.log('FINAL SUMMARY');
  console.log('='.repeat(100));
  
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  const totalProducts = results.reduce((sum, r) => sum + r.productCount, 0);
  const avgProducts = totalProducts / results.length;

  console.log(`\n📊 Overall Results:`);
  console.log(`   Total Tests: ${results.length}`);
  console.log(`   Passed: ${passedCount} (${((passedCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`   Failed: ${failedCount} (${((failedCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`   Total Products Returned: ${totalProducts}`);
  console.log(`   Average Products per Query: ${avgProducts.toFixed(1)}`);

  console.log(`\n📋 Test Breakdown:`);
  results.forEach((result, i) => {
    const status = result.passed ? '✅' : '❌';
    console.log(`   ${status} ${i + 1}. ${result.test.name}: ${result.productCount} products${result.issues.length > 0 ? ` - ${result.issues[0]}` : ''}`);
  });

  console.log(`\n${'='.repeat(100)}`);
  console.log('✅ Comprehensive test complete!');
  console.log('='.repeat(100));

  await prisma.$disconnect();
}

runComprehensiveTests().catch(console.error);
