import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';

interface TestCase {
  query: string;
  expectedConstraints: {
    category?: string[];
    styles?: string[];
    colors?: string[];
    occasions?: string[];
    sleeveLengths?: string[];
    lengths?: string[];
    materials?: string[];
    fits?: string[];
    necklines?: string[];
    ageGroups?: string[];
  };
  description: string;
}

const testCases: TestCase[] = [
  {
    query: "do you have any aline dresses?",
    expectedConstraints: {
      category: ["Women's Dresses"],
      styles: ["A-Line"],
      ageGroups: ["Adult"],
    },
    description: "Single style constraint (A-Line)"
  },
  {
    query: "hey I am looking for women's long sleeve t shirt",
    expectedConstraints: {
      category: ["Womens-tees"],
      sleeveLengths: ["Long"],
      ageGroups: ["Adult"],
      colors: ["White", "Beige", "Black", "Navy", "Gray"],
    },
    description: "Sleeve length + gender + category"
  },
  {
    query: "i am joining office next month, suggest me a dress to wear",
    expectedConstraints: {
      category: ["Women's Dresses"],
      occasions: ["Work"],
      ageGroups: ["Adult"],
      colors: ["White", "Beige", "Navy Blue", "Black", "Gray"],
    },
    description: "Occasion (Work) + category + inferred colors"
  },
  {
    query: "show me floral maxi dresses in pastel colors",
    expectedConstraints: {
      category: ["Women's Dresses"],
      lengths: ["Maxi"],
      patterns: ["Floral"],
      colors: ["Pastel"],
    },
    description: "Pattern + length + color shade"
  },
  {
    query: "i need a black formal evening dress with long sleeves",
    expectedConstraints: {
      category: ["Women's Dresses"],
      colors: ["Black"],
      occasions: ["Evening"],
      sleeveLengths: ["Long"],
      formalityLevel: ["Formal"],
    },
    description: "Multiple constraints: color + occasion + sleeve + formality"
  },
  {
    query: "cotton summer dresses in light colors",
    expectedConstraints: {
      category: ["Women's Dresses"],
      materials: ["Cotton"],
      seasons: ["Summer"],
      colors: ["Light"],
    },
    description: "Material + season + color shade"
  },
  {
    query: "v-neck fitted tops for women",
    expectedConstraints: {
      category: ["Womens-tees", "Tops"],
      necklines: ["V-Neck"],
      fits: ["Fitted"],
      ageGroups: ["Adult"],
    },
    description: "Neckline + fit + category"
  },
  {
    query: "mini dresses with short sleeves in pink or red",
    expectedConstraints: {
      category: ["Women's Dresses"],
      lengths: ["Mini"],
      sleeveLengths: ["Short"],
      colors: ["Pink", "Red"],
    },
    description: "Length + sleeve + multiple colors (OR)"
  },
  {
    query: "wedding guest dresses in navy or burgundy",
    expectedConstraints: {
      category: ["Women's Dresses"],
      occasions: ["Wedding"],
      colors: ["Navy", "Burgundy"],
    },
    description: "Occasion + multiple colors"
  },
  {
    query: "relaxed fit linen pants for summer",
    expectedConstraints: {
      category: ["Pants", "Bottoms"],
      fits: ["Relaxed"],
      materials: ["Linen"],
      seasons: ["Summer"],
    },
    description: "Fit + material + season (different category)"
  }
];

interface TestResult {
  testCase: TestCase;
  productsReturned: number;
  resolvedConstraints: any;
  classificationConstraints: any;
  products: Array<{
    id: string;
    title: string;
    category: string;
    matches: {
      category: boolean;
      style?: boolean;
      color?: boolean;
      occasion?: boolean;
      sleeve?: boolean;
      length?: boolean;
      material?: boolean;
      fit?: boolean;
      neckline?: boolean;
      ageGroup: boolean;
    };
    actualAttributes: any;
  }>;
  matchRate: {
    category: number;
    style?: number;
    color?: number;
    occasion?: number;
    sleeve?: number;
    length?: number;
    material?: number;
    fit?: number;
    neckline?: number;
    ageGroup: number;
    overall: number;
  };
}

async function runTest(testCase: TestCase, index: number): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST ${index + 1}/10: ${testCase.description}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Query: "${testCase.query}"\n`);

  const sessionId = `test-multi-${index}-${Date.now()}`;
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

  const result = await handleAssistantQuery(merchantId, {
    message: testCase.query,
    sessionId,
  });

  // Get product details from database
  const productIds = result.productCards.map(card => card.id);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      attributes: true,
      silhouetteCut: true,
      sleeve: true,
      length: true,
      neckline: true,
      fit: true,
      material: true,
      fabric: true,
      occasionContext: true,
      formalityLevel: true,
      ageGroup: true,
      enrichedColor: true,
      color: true,
    },
  });

  // Analyze each product
  const analyzedProducts = products.map(product => {
    const attrs = product.attributes as any || {};
    
    // Check matches
    const matches: any = {
      category: false,
      ageGroup: false,
    };

    // Category match
    if (testCase.expectedConstraints.category) {
      matches.category = testCase.expectedConstraints.category.some(cat =>
        product.category?.toLowerCase().includes(cat.toLowerCase().replace("'s", "").replace("'", "")) ||
        cat.toLowerCase().includes(product.category?.toLowerCase() || "")
      );
    } else {
      matches.category = true; // No category constraint
    }

    // Style match
    if (testCase.expectedConstraints.styles) {
      const productStyle = product.silhouetteCut || attrs?.silhouetteCut || attrs?.style || '';
      const titleLower = product.title?.toLowerCase() || '';
      matches.style = testCase.expectedConstraints.styles.some(style => {
        const styleLower = style.toLowerCase();
        return productStyle?.toLowerCase().includes(styleLower) ||
               styleLower.includes(productStyle?.toLowerCase() || '') ||
               titleLower.includes(styleLower);
      });
    }

    // Color match
    if (testCase.expectedConstraints.colors) {
      const productColors = product.enrichedColor || product.color || attrs?.enriched_color || attrs?.color || [];
      const productColorArray = Array.isArray(productColors) ? productColors : [productColors].filter(Boolean);
      const productColorStr = product.title?.toLowerCase() || '';
      matches.color = testCase.expectedConstraints.colors.some(color => {
        const colorLower = color.toLowerCase();
        return productColorArray.some((pc: string) =>
          pc?.toLowerCase().includes(colorLower) || colorLower.includes(pc?.toLowerCase())
        ) || productColorStr.includes(colorLower);
      });
    }

    // Occasion match
    if (testCase.expectedConstraints.occasions) {
      const productOccasions = product.occasionContext || [];
      const productOccasionArray = Array.isArray(productOccasions) ? productOccasions : [productOccasions].filter(Boolean);
      matches.occasion = testCase.expectedConstraints.occasions.some(occ =>
        productOccasionArray.some((po: string) =>
          po?.toLowerCase().includes(occ.toLowerCase()) || occ.toLowerCase().includes(po?.toLowerCase())
        )
      );
    }

    // Sleeve match
    if (testCase.expectedConstraints.sleeveLengths) {
      const productSleeve = product.sleeve || attrs?.sleeve || attrs?.sleeveLength || '';
      matches.sleeve = testCase.expectedConstraints.sleeveLengths.some(sleeve => {
        const sleeveLower = sleeve.toLowerCase();
        return productSleeve?.toLowerCase().includes(sleeveLower) ||
               sleeveLower.includes(productSleeve?.toLowerCase() || '');
      });
    }

    // Length match
    if (testCase.expectedConstraints.lengths) {
      const productLength = product.length || attrs?.length || attrs?.lengths?.[0] || product.silhouetteCut || '';
      const productLengthStr = Array.isArray(productLength) ? productLength[0] : productLength;
      const titleLower = product.title?.toLowerCase() || '';
      matches.length = testCase.expectedConstraints.lengths.some(length => {
        const lengthLower = length.toLowerCase();
        return productLengthStr?.toLowerCase().includes(lengthLower) ||
               lengthLower.includes(productLengthStr?.toLowerCase() || '') ||
               titleLower.includes(lengthLower);
      });
    }

    // Material match
    if (testCase.expectedConstraints.materials) {
      const productMaterials = product.material || product.fabric || attrs?.material || attrs?.fabric || attrs?.Material || attrs?.Fabric || [];
      const productMaterialArray = Array.isArray(productMaterials) ? productMaterials : [productMaterials].filter(Boolean);
      matches.material = testCase.expectedConstraints.materials.some(material => {
        const materialLower = material.toLowerCase();
        return productMaterialArray.some((pm: string) =>
          pm?.toLowerCase().includes(materialLower) || materialLower.includes(pm?.toLowerCase())
        );
      });
    }

    // Fit match
    if (testCase.expectedConstraints.fits) {
      const productFit = product.fit || attrs?.fit || attrs?.Fit || '';
      matches.fit = testCase.expectedConstraints.fits.some(fit => {
        const fitLower = fit.toLowerCase();
        return productFit?.toLowerCase().includes(fitLower) ||
               fitLower.includes(productFit?.toLowerCase() || '');
      });
    }

    // Neckline match
    if (testCase.expectedConstraints.necklines) {
      const productNeckline = product.neckline || attrs?.neckline || attrs?.Neckline || '';
      matches.neckline = testCase.expectedConstraints.necklines.some(neckline => {
        const necklineLower = neckline.toLowerCase();
        return productNeckline?.toLowerCase().includes(necklineLower) ||
               necklineLower.includes(productNeckline?.toLowerCase() || '');
      });
    }

    // Age group match
    matches.ageGroup = !product.ageGroup ||
      product.ageGroup.toLowerCase() === 'adult' ||
      product.ageGroup.toLowerCase().includes('adult') ||
      product.category?.toLowerCase().includes('women') ||
      product.category?.toLowerCase().includes('men');

    return {
      id: product.id,
      title: product.title,
      category: product.category,
      matches,
      actualAttributes: {
        silhouetteCut: product.silhouetteCut,
        sleeve: product.sleeve,
        length: product.length,
        neckline: product.neckline,
        fit: product.fit,
        material: product.material || product.fabric,
        occasionContext: product.occasionContext,
        formalityLevel: product.formalityLevel,
        ageGroup: product.ageGroup,
        color: product.enrichedColor || product.color,
      }
    };
  });

  // Calculate match rates
  const matchRate: any = {
    category: 0,
    ageGroup: 0,
    overall: 0,
  };

  if (testCase.expectedConstraints.style) matchRate.style = 0;
  if (testCase.expectedConstraints.colors) matchRate.color = 0;
  if (testCase.expectedConstraints.occasions) matchRate.occasion = 0;
  if (testCase.expectedConstraints.sleeveLengths) matchRate.sleeve = 0;
  if (testCase.expectedConstraints.lengths) matchRate.length = 0;
  if (testCase.expectedConstraints.materials) matchRate.material = 0;
  if (testCase.expectedConstraints.fits) matchRate.fit = 0;
  if (testCase.expectedConstraints.necklines) matchRate.neckline = 0;

  analyzedProducts.forEach(product => {
    if (product.matches.category) matchRate.category++;
    if (product.matches.ageGroup) matchRate.ageGroup++;
    if (product.matches.style !== undefined && product.matches.style) matchRate.style++;
    if (product.matches.color !== undefined && product.matches.color) matchRate.color++;
    if (product.matches.occasion !== undefined && product.matches.occasion) matchRate.occasion++;
    if (product.matches.sleeve !== undefined && product.matches.sleeve) matchRate.sleeve++;
    if (product.matches.length !== undefined && product.matches.length) matchRate.length++;
    if (product.matches.material !== undefined && product.matches.material) matchRate.material++;
    if (product.matches.fit !== undefined && product.matches.fit) matchRate.fit++;
    if (product.matches.neckline !== undefined && product.matches.neckline) matchRate.neckline++;

    // Overall match: all specified constraints must match
    const allConstraintsMatch = Object.entries(product.matches).every(([key, value]) => {
      if (key === 'ageGroup') return true; // Age group is usually inferred
      const expected = (testCase.expectedConstraints as any)[key === 'style' ? 'styles' : key === 'sleeve' ? 'sleeveLengths' : key === 'length' ? 'lengths' : key + 's'];
      if (!expected || expected.length === 0) return true; // No constraint specified
      return value === true;
    });
    if (allConstraintsMatch) matchRate.overall++;
  });

  const totalProducts = analyzedProducts.length;
  Object.keys(matchRate).forEach(key => {
    matchRate[key] = totalProducts > 0 ? (matchRate[key] / totalProducts) * 100 : 0;
  });

  return {
    testCase,
    productsReturned: totalProducts,
    resolvedConstraints: result.resolvedConstraints,
    classificationConstraints: result.resolvedClassificationConstraints,
    products: analyzedProducts,
    matchRate,
  };
}

async function runAllTests() {
  console.log('================================================================================');
  console.log('COMPREHENSIVE CONSTRAINT TESTING');
  console.log('================================================================================');
  console.log(`Testing ${testCases.length} diverse queries with multiple constraints\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    try {
      const result = await runTest(testCases[i], i);
      results.push(result);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`\n❌ Test ${i + 1} failed:`, error);
      results.push({
        testCase: testCases[i],
        productsReturned: 0,
        resolvedConstraints: null,
        classificationConstraints: null,
        products: [],
        matchRate: {} as any,
      });
    }
  }

  // Generate comprehensive analysis
  console.log('\n\n' + '='.repeat(80));
  console.log('COMPREHENSIVE ANALYSIS REPORT');
  console.log('='.repeat(80));

  // Summary statistics
  const totalProducts = results.reduce((sum, r) => sum + r.productsReturned, 0);
  const avgProductsPerTest = totalProducts / results.length;
  const testsWithProducts = results.filter(r => r.productsReturned > 0).length;

  console.log(`\n📊 OVERALL STATISTICS:`);
  console.log(`   Total Tests: ${results.length}`);
  console.log(`   Tests with Products: ${testsWithProducts}/${results.length} (${(testsWithProducts/results.length*100).toFixed(1)}%)`);
  console.log(`   Total Products Returned: ${totalProducts}`);
  console.log(`   Average Products per Test: ${avgProductsPerTest.toFixed(1)}`);

  // Detailed results per test
  console.log(`\n📋 DETAILED RESULTS BY TEST:\n`);
  
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.testCase.description}`);
    console.log(`   Query: "${result.testCase.query}"`);
    console.log(`   Products Returned: ${result.productsReturned}`);
    
    if (result.productsReturned > 0) {
      console.log(`   Match Rates:`);
      Object.entries(result.matchRate).forEach(([key, value]) => {
        if (key !== 'overall') {
          const emoji = (value as number) >= 80 ? '✅' : (value as number) >= 50 ? '⚠️' : '❌';
          console.log(`     ${emoji} ${key}: ${(value as number).toFixed(1)}%`);
        }
      });
      const overallEmoji = (result.matchRate.overall as number) >= 80 ? '✅' : (result.matchRate.overall as number) >= 50 ? '⚠️' : '❌';
      console.log(`     ${overallEmoji} Overall: ${(result.matchRate.overall as number).toFixed(1)}%`);
      
      // Show sample products
      console.log(`   Sample Products:`);
      result.products.slice(0, 2).forEach((p, i) => {
        console.log(`     ${i + 1}. ${p.title}`);
        console.log(`        Category: ${p.category}`);
        const mismatches = Object.entries(p.matches).filter(([k, v]) => {
          const expected = (result.testCase.expectedConstraints as any)[k === 'style' ? 'styles' : k === 'sleeve' ? 'sleeveLengths' : k === 'length' ? 'lengths' : k + 's'];
          return expected && expected.length > 0 && v === false;
        });
        if (mismatches.length > 0) {
          console.log(`        ❌ Missing: ${mismatches.map(([k]) => k).join(', ')}`);
        }
      });
    } else {
      console.log(`   ⚠️  No products returned`);
    }
    console.log('');
  });

  // Constraint type analysis
  console.log(`\n📈 CONSTRAINT TYPE ANALYSIS:\n`);
  
  const constraintTypes = ['category', 'style', 'color', 'occasion', 'sleeve', 'length', 'material', 'fit', 'neckline', 'ageGroup'];
  constraintTypes.forEach(type => {
    const testsWithConstraint = results.filter(r => {
      const key = type === 'style' ? 'styles' : type === 'sleeve' ? 'sleeveLengths' : type === 'length' ? 'lengths' : type + 's';
      return (r.testCase.expectedConstraints as any)[key];
    });
    
    if (testsWithConstraint.length > 0) {
      const avgMatchRate = testsWithConstraint.reduce((sum, r) => {
        const matchKey = type === 'style' ? 'style' : type === 'sleeve' ? 'sleeve' : type === 'length' ? 'length' : type === 'ageGroup' ? 'ageGroup' : type;
        return sum + ((r.matchRate as any)[matchKey] || 0);
      }, 0) / testsWithConstraint.length;
      
      const emoji = avgMatchRate >= 80 ? '✅' : avgMatchRate >= 50 ? '⚠️' : '❌';
      console.log(`   ${emoji} ${type}: ${avgMatchRate.toFixed(1)}% (${testsWithConstraint.length} tests)`);
    }
  });

  // Edge cases analysis
  console.log(`\n🔍 EDGE CASES ANALYSIS:\n`);
  
  const edgeCases = [
    { name: 'Multiple Colors (OR)', tests: results.filter(r => r.testCase.expectedConstraints.colors && r.testCase.expectedConstraints.colors.length > 1) },
    { name: 'Multiple Constraints (AND)', tests: results.filter(r => {
      const constraints = Object.values(r.testCase.expectedConstraints).filter(v => v && (v as any[]).length > 0);
      return constraints.length >= 3;
    }) },
    { name: 'Style + Color', tests: results.filter(r => r.testCase.expectedConstraints.styles && r.testCase.expectedConstraints.colors) },
    { name: 'Occasion + Other', tests: results.filter(r => r.testCase.expectedConstraints.occasions && Object.keys(r.testCase.expectedConstraints).length > 2) },
  ];

  edgeCases.forEach(edgeCase => {
    if (edgeCase.tests.length > 0) {
      const avgOverall = edgeCase.tests.reduce((sum, r) => sum + (r.matchRate.overall || 0), 0) / edgeCase.tests.length;
      const emoji = avgOverall >= 80 ? '✅' : avgOverall >= 50 ? '⚠️' : '❌';
      console.log(`   ${emoji} ${edgeCase.name}: ${avgOverall.toFixed(1)}% overall match (${edgeCase.tests.length} tests)`);
    }
  });

  // Issues found
  console.log(`\n⚠️  ISSUES FOUND:\n`);
  
  const issues: string[] = [];
  
  results.forEach((result, index) => {
    if (result.productsReturned === 0) {
      issues.push(`Test ${index + 1}: No products returned for "${result.testCase.query}"`);
    } else if (result.matchRate.overall < 50) {
      issues.push(`Test ${index + 1}: Low overall match rate (${result.matchRate.overall.toFixed(1)}%) for "${result.testCase.query}"`);
    }
    
    // Check specific constraint issues
    Object.entries(result.matchRate).forEach(([key, value]) => {
      if (key !== 'overall' && (value as number) < 50) {
        const expected = (result.testCase.expectedConstraints as any)[key === 'style' ? 'styles' : key === 'sleeve' ? 'sleeveLengths' : key === 'length' ? 'lengths' : key + 's'];
        if (expected && expected.length > 0) {
          issues.push(`Test ${index + 1}: Low ${key} match rate (${(value as number).toFixed(1)}%)`);
        }
      }
    });
  });

  if (issues.length > 0) {
    issues.forEach(issue => console.log(`   - ${issue}`));
  } else {
    console.log(`   ✅ No major issues found!`);
  }

  // Recommendations
  console.log(`\n💡 RECOMMENDATIONS:\n`);
  
  const recommendations: string[] = [];
  
  const lowMatchConstraints = constraintTypes.filter(type => {
    const testsWithConstraint = results.filter(r => {
      const key = type === 'style' ? 'styles' : type === 'sleeve' ? 'sleeveLengths' : type === 'length' ? 'lengths' : type + 's';
      return (r.testCase.expectedConstraints as any)[key];
    });
    if (testsWithConstraint.length === 0) return false;
    const avgMatchRate = testsWithConstraint.reduce((sum, r) => {
      const matchKey = type === 'style' ? 'style' : type === 'sleeve' ? 'sleeve' : type === 'length' ? 'length' : type === 'ageGroup' ? 'ageGroup' : type;
      return sum + ((r.matchRate as any)[matchKey] || 0);
    }, 0) / testsWithConstraint.length;
    return avgMatchRate < 70;
  });

  if (lowMatchConstraints.length > 0) {
    recommendations.push(`Improve matching for: ${lowMatchConstraints.join(', ')}`);
  }

  if (testsWithProducts < results.length) {
    recommendations.push(`Investigate why ${results.length - testsWithProducts} tests returned 0 products`);
  }

  if (recommendations.length > 0) {
    recommendations.forEach(rec => console.log(`   - ${rec}`));
  } else {
    console.log(`   ✅ Pipeline is working well!`);
  }

  await prisma.$disconnect();
  
  return results;
}

runAllTests().catch(console.error);
