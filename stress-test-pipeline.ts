/**
 * Comprehensive Stress Test for Pipeline
 * Tests real user-like conversations with follow-ups
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const LOG_FILE = join(process.cwd(), 'app.log');

interface Conversation {
  name: string;
  description: string;
  messages: Array<{
    query: string;
    expected: {
      gender?: 'male' | 'female' | null;
      ageGroup?: string;
      category?: string;
      minProducts?: number;
      shouldNotContain?: string[];
      shouldContain?: string[];
    };
  }>;
}

const CONVERSATIONS: Conversation[] = [
  {
    name: "Women's Jeans Discovery with Refinement",
    description: "User starts vague, then refines with color and fit",
    messages: [
      {
        query: "I need jeans",
        expected: {
          minProducts: 1,
        },
      },
      {
        query: "for women",
        expected: {
          gender: 'female',
          category: 'jeans',
          minProducts: 1,
          shouldNotContain: ["men's", "mens", "boys"],
        },
      },
      {
        query: "in dark colors",
        expected: {
          gender: 'female',
          category: 'jeans',
          minProducts: 1,
          shouldNotContain: ["men's", "mens"],
        },
      },
    ],
  },
  {
    name: "Men's Shirt Discovery",
    description: "Direct query for men's shirts",
    messages: [
      {
        query: "Show me dress shirts for men",
        expected: {
          gender: 'male',
          category: 'shirt',
          minProducts: 1,
          shouldNotContain: ["women's", "womens", "girls"],
        },
      },
    ],
  },
  {
    name: "Kids Clothing with Age Change",
    description: "User asks for kids, then changes to baby",
    messages: [
      {
        query: "I need clothes for my 5 year old",
        expected: {
          ageGroup: 'Kids',
          minProducts: 1,
          shouldNotContain: ["adult", "women's", "men's"],
        },
      },
      {
        query: "actually, for a baby",
        expected: {
          ageGroup: 'Baby',
          minProducts: 1,
          shouldNotContain: ["adult", "kids", "children"],
        },
      },
    ],
  },
  {
    name: "Dress Discovery with Occasion",
    description: "User asks for dress, then adds occasion",
    messages: [
      {
        query: "I need a dress",
        expected: {
          gender: 'female', // Should infer from product type
          category: 'dress',
          minProducts: 1,
          shouldNotContain: ["men's", "mens"],
        },
      },
      {
        query: "for a wedding",
        expected: {
          gender: 'female',
          category: 'dress',
          minProducts: 1,
        },
      },
    ],
  },
  {
    name: "Complex Refinement",
    description: "Multiple refinements in sequence",
    messages: [
      {
        query: "Show me tops",
        expected: {
          minProducts: 1,
        },
      },
      {
        query: "for women",
        expected: {
          gender: 'female',
          minProducts: 1,
          shouldNotContain: ["men's", "mens"],
        },
      },
      {
        query: "in blue",
        expected: {
          gender: 'female',
          minProducts: 1,
        },
      },
      {
        query: "casual style",
        expected: {
          gender: 'female',
          minProducts: 1,
        },
      },
    ],
  },
  {
    name: "Gender Switch",
    description: "User switches from women to men",
    messages: [
      {
        query: "Show me jeans for women",
        expected: {
          gender: 'female',
          category: 'jeans',
          minProducts: 1,
          shouldNotContain: ["men's", "mens"],
        },
      },
      {
        query: "actually, for men",
        expected: {
          gender: 'male',
          category: 'jeans',
          minProducts: 1,
          shouldNotContain: ["women's", "womens"],
        },
      },
    ],
  },
  {
    name: "Vague to Specific",
    description: "User starts very vague, becomes specific",
    messages: [
      {
        query: "what do you have",
        expected: {
          minProducts: 1,
        },
      },
      {
        query: "dresses",
        expected: {
          gender: 'female',
          category: 'dress',
          minProducts: 1,
        },
      },
      {
        query: "in black",
        expected: {
          gender: 'female',
          category: 'dress',
          minProducts: 1,
        },
      },
    ],
  },
];

function readLogFile(): string {
  try {
    return readFileSync(LOG_FILE, 'utf-8');
  } catch (error) {
    return '';
  }
}

function extractPipelineInfo(logContent: string, sessionId: string, query: string): {
  steps: Array<{ step: string; timestamp: string; data: any }>;
  gender?: string;
  ageGroup?: string;
  categories?: string[];
  issues: string[];
} {
  const lines = logContent.split('\n');
  const queryStart = query.substring(0, 40).toLowerCase();
  const steps: Array<{ step: string; timestamp: string; data: any }> = [];
  let gender: string | undefined;
  let ageGroup: string | undefined;
  let categories: string[] | undefined;
  const issues: string[] = [];
  
  const stepPatterns = [
    'gender_and_agegroup_extracted_early',
    'categories_filtered_before_classification',
    'category_classification_complete',
    'categories_filtered_by_gender_after_classification',
    'dictionary_refinement_starting_before_retrieval',
    'dictionary_refinement_complete_before_retrieval',
    'starting_retrieval',
    'retrieval_complete',
    'ranking_complete',
  ];
  
  let foundSession = false;
  for (const line of lines) {
    if (!line.includes('INFO') && !line.includes('DEBUG') && !line.includes('WARN') && !line.includes('ERROR')) continue;
    
    // Check if this line is for our session
    if (line.includes(sessionId)) {
      foundSession = true;
    }
    if (!foundSession && !line.includes(queryStart)) continue;
    
    // Extract JSON from log line
    try {
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        const logData = JSON.parse(jsonMatch[0]);
        const message = logData.message || '';
        
        // Check for errors/warnings
        if (line.includes('ERROR')) {
          issues.push(`ERROR: ${message} - ${JSON.stringify(logData)}`);
        }
        if (line.includes('WARN')) {
          issues.push(`WARN: ${message} - ${JSON.stringify(logData)}`);
        }
        
        // Check for pipeline steps
        for (const pattern of stepPatterns) {
          if (message.includes(pattern)) {
            steps.push({
              step: pattern,
              timestamp: line.match(/\[(.*?)\]/)?.[1] || '',
              data: logData,
            });
            
            // Extract key values
            if (pattern === 'gender_and_agegroup_extracted_early') {
              gender = logData.resolvedGender;
              ageGroup = logData.resolvedAgeGroup;
            }
            if (pattern === 'categories_filtered_before_classification' || 
                pattern === 'categories_filtered_by_gender_after_classification') {
              categories = logData.filteredCategories || logData.categories || categories;
            }
          }
        }
      }
    } catch (e) {
      // Skip malformed JSON
    }
  }
  
  return { steps, gender, ageGroup, categories, issues };
}

function checkProductQuality(products: any[], expected: Conversation['messages'][0]['expected']): {
  matches: string[];
  issues: string[];
} {
  const matches: string[] = [];
  const issues: string[] = [];
  
  if (!products || products.length === 0) {
    if ((expected.minProducts || 1) > 0) {
      issues.push(`No products returned (expected at least ${expected.minProducts || 1})`);
    }
    return { matches, issues };
  }
  
  // Check count
  if (products.length < (expected.minProducts || 1)) {
    issues.push(`Too few products: got ${products.length}, expected at least ${expected.minProducts || 1}`);
  } else {
    matches.push(`Product count: ${products.length}`);
  }
  
  // Check gender
  if (expected.gender) {
    const wrongGender = products.some(p => {
      const title = (p.title || '').toLowerCase();
      if (expected.gender === 'female') {
        return title.includes("men's") || title.includes("mens") || title.includes("boys");
      } else if (expected.gender === 'male') {
        return title.includes("women's") || title.includes("womens") || title.includes("girls");
      }
      return false;
    });
    
    if (wrongGender) {
      issues.push(`Wrong gender products found (expected ${expected.gender})`);
    } else {
      matches.push(`Gender: ${expected.gender}`);
    }
  }
  
  // Check category
  if (expected.category) {
    const hasCategory = products.some(p => {
      const title = (p.title || '').toLowerCase();
      return title.includes(expected.category!.toLowerCase());
    });
    
    if (!hasCategory) {
      issues.push(`Category not found: expected ${expected.category}`);
    } else {
      matches.push(`Category: ${expected.category}`);
    }
  }
  
  // Check should not contain
  if (expected.shouldNotContain) {
    const hasForbidden = products.some(p => {
      const title = (p.title || '').toLowerCase();
      return expected.shouldNotContain!.some(term => title.includes(term.toLowerCase()));
    });
    
    if (hasForbidden) {
      issues.push(`Contains forbidden terms: ${expected.shouldNotContain.join(', ')}`);
    } else {
      matches.push(`No forbidden terms`);
    }
  }
  
  return { matches, issues };
}

async function testConversation(conversation: Conversation, index: number): Promise<{
  name: string;
  success: boolean;
  messageResults: Array<{
    query: string;
    success: boolean;
    productCount: number;
    pipelineSteps: number;
    genderMatch: boolean;
    ageGroupMatch: boolean;
    issues: string[];
    productQuality: { matches: string[]; issues: string[] };
  }>;
  overallIssues: string[];
}> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`💬 Conversation ${index + 1}/${CONVERSATIONS.length}: ${conversation.name}`);
  console.log(`Description: ${conversation.description}`);
  console.log(`Messages: ${conversation.messages.length}`);
  console.log(`${'='.repeat(80)}`);
  
  const sessionId = `stress-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const messageResults: any[] = [];
  const overallIssues: string[] = [];
  
  // Get initial log position
  let logBefore = readLogFile();
  let logBeforeLines = logBefore.split('\n').length;
  
  for (let i = 0; i < conversation.messages.length; i++) {
    const message = conversation.messages[i];
    console.log(`\n📨 Message ${i + 1}/${conversation.messages.length}: "${message.query}"`);
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${API_BASE}/api/assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          message: message.query,
          merchantId: process.env.MERCHANT_ID || 'loveshackfancy',
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
      }
      
      const result = await response.json();
      const duration = Date.now() - startTime;
      
      // Wait for logs
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Read logs
      const logAfter = readLogFile();
      const logLines = logAfter.split('\n').slice(logBeforeLines);
      const logContent = logLines.join('\n');
      logBeforeLines = logAfter.split('\n').length;
      
      // Extract pipeline info
      const { steps, gender, ageGroup, categories, issues: logIssues } = extractPipelineInfo(logContent, sessionId, message.query);
      
      console.log(`  ⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`  📦 Products: ${result.productCards?.length || 0}`);
      console.log(`  🔗 Pipeline Steps: ${steps.length}`);
      
      if (steps.length < 6) {
        overallIssues.push(`Message ${i + 1}: Only ${steps.length} pipeline steps (expected at least 6)`);
      }
      
      // Check pipeline steps
      const requiredSteps = [
        'gender_and_agegroup_extracted_early',
        'dictionary_refinement_starting_before_retrieval',
        'starting_retrieval',
        'retrieval_complete',
      ];
      
      const missingSteps = requiredSteps.filter(step => !steps.some(s => s.step.includes(step)));
      if (missingSteps.length > 0) {
        overallIssues.push(`Message ${i + 1}: Missing pipeline steps: ${missingSteps.join(', ')}`);
      }
      
      // Check gender/ageGroup
      const genderMatch = !message.expected.gender || gender === message.expected.gender;
      const ageGroupMatch = !message.expected.ageGroup || ageGroup === message.expected.ageGroup;
      
      if (!genderMatch) {
        overallIssues.push(`Message ${i + 1}: Gender mismatch - got ${gender}, expected ${message.expected.gender}`);
      }
      if (!ageGroupMatch) {
        overallIssues.push(`Message ${i + 1}: AgeGroup mismatch - got ${ageGroup}, expected ${message.expected.ageGroup}`);
      }
      
      console.log(`  🎯 Gender: ${gender || 'null'} ${genderMatch ? '✅' : '❌'}`);
      console.log(`  🎯 AgeGroup: ${ageGroup || 'null'} ${ageGroupMatch ? '✅' : '❌'}`);
      if (categories) {
        console.log(`  📂 Categories: ${categories.join(', ')}`);
      }
      
      // Check products
      const productQuality = checkProductQuality(result.productCards || [], message.expected);
      
      if (productQuality.issues.length > 0) {
        console.log(`  ❌ Product Issues:`);
        productQuality.issues.forEach(issue => {
          console.log(`     - ${issue}`);
          overallIssues.push(`Message ${i + 1}: ${issue}`);
        });
      }
      
      if (productQuality.matches.length > 0) {
        console.log(`  ✅ Product Matches: ${productQuality.matches.join(', ')}`);
      }
      
      // Check log issues
      if (logIssues.length > 0) {
        console.log(`  ⚠️  Log Issues: ${logIssues.length}`);
        logIssues.forEach(issue => {
          console.log(`     - ${issue.substring(0, 100)}`);
          overallIssues.push(`Message ${i + 1}: ${issue}`);
        });
      }
      
      // Show sample products
      if (result.productCards && result.productCards.length > 0) {
        console.log(`  📋 Sample Products:`);
        result.productCards.slice(0, 2).forEach((p: any, idx: number) => {
          console.log(`     ${idx + 1}. ${p.title || 'Unknown'}`);
          if (p.reason) {
            console.log(`        Reason: ${p.reason.substring(0, 80)}...`);
          }
        });
      }
      
      messageResults.push({
        query: message.query,
        success: genderMatch && ageGroupMatch && productQuality.issues.length === 0 && logIssues.length === 0,
        productCount: result.productCards?.length || 0,
        pipelineSteps: steps.length,
        genderMatch,
        ageGroupMatch,
        issues: [...productQuality.issues, ...logIssues],
        productQuality,
      });
      
    } catch (error) {
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      overallIssues.push(`Message ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      messageResults.push({
        query: message.query,
        success: false,
        productCount: 0,
        pipelineSteps: 0,
        genderMatch: false,
        ageGroupMatch: false,
        issues: [error instanceof Error ? error.message : String(error)],
        productQuality: { matches: [], issues: [] },
      });
    }
    
    // Wait between messages
    if (i < conversation.messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  const success = messageResults.every(r => r.success) && overallIssues.length === 0;
  
  console.log(`\n${success ? '✅' : '❌'} Conversation Result: ${success ? 'PASS' : 'FAIL'}`);
  if (overallIssues.length > 0) {
    console.log(`   Total Issues: ${overallIssues.length}`);
  }
  
  return {
    name: conversation.name,
    success,
    messageResults,
    overallIssues,
  };
}

async function runStressTest() {
  console.log('🚀 Starting Pipeline Stress Test');
  console.log('='.repeat(80));
  console.log(`API URL: ${API_BASE}`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`Conversations: ${CONVERSATIONS.length}`);
  
  // Check server
  try {
    const healthCheck = await fetch(`${API_BASE}/api/health`);
    if (!healthCheck.ok) {
      console.error('❌ Server health check failed');
      process.exit(1);
    }
    console.log('✅ Server is running\n');
  } catch (error) {
    console.error('❌ Cannot connect to server');
    process.exit(1);
  }
  
  const results: any[] = [];
  
  // Run conversations sequentially
  for (let i = 0; i < CONVERSATIONS.length; i++) {
    const conversation = CONVERSATIONS[i];
    const result = await testConversation(conversation, i);
    results.push(result);
    
    // Wait between conversations
    if (i < CONVERSATIONS.length - 1) {
      console.log(`\n⏳ Waiting 3 seconds before next conversation...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 Stress Test Summary');
  console.log('='.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\nOverall Statistics:`);
  console.log(`  Total conversations: ${results.length}`);
  console.log(`  ✅ Passed: ${successful.length}`);
  console.log(`  ❌ Failed: ${failed.length}`);
  
  const totalMessages = results.reduce((sum, r) => sum + r.messageResults.length, 0);
  const successfulMessages = results.reduce((sum, r) => sum + r.messageResults.filter((m: any) => m.success).length, 0);
  console.log(`  Total messages: ${totalMessages}`);
  console.log(`  ✅ Successful messages: ${successfulMessages}`);
  console.log(`  ❌ Failed messages: ${totalMessages - successfulMessages}`);
  
  // Pipeline step analysis
  console.log(`\n🔗 Pipeline Step Analysis:`);
  const allSteps = new Set<string>();
  results.forEach(r => {
    r.messageResults.forEach((m: any) => {
      // Extract steps from message results
    });
  });
  
  const avgSteps = results.reduce((sum, r) => {
    return sum + r.messageResults.reduce((s: number, m: any) => s + m.pipelineSteps, 0);
  }, 0) / totalMessages;
  console.log(`  Average pipeline steps per message: ${avgSteps.toFixed(1)}`);
  
  // Issue analysis
  const allIssues = results.flatMap(r => r.overallIssues);
  const issueTypes = new Map<string, number>();
  allIssues.forEach(issue => {
    const type = issue.split(':')[0] || 'Other';
    issueTypes.set(type, (issueTypes.get(type) || 0) + 1);
  });
  
  if (issueTypes.size > 0) {
    console.log(`\n⚠️  Issue Types:`);
    Array.from(issueTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
  }
  
  // Failed conversations
  if (failed.length > 0) {
    console.log(`\n❌ Failed Conversations:`);
    failed.forEach((r, i) => {
      console.log(`\n  ${i + 1}. ${r.name}`);
      console.log(`     Issues: ${r.overallIssues.length}`);
      r.overallIssues.slice(0, 5).forEach(issue => console.log(`       - ${issue}`));
    });
  }
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: successful.length,
      failed: failed.length,
      totalMessages,
      successfulMessages,
      failedMessages: totalMessages - successfulMessages,
    },
    issueTypes: Object.fromEntries(issueTypes),
    results: results.map(r => ({
      name: r.name,
      success: r.success,
      messageCount: r.messageResults.length,
      messageResults: r.messageResults.map((m: any) => ({
        query: m.query,
        success: m.success,
        productCount: m.productCount,
        pipelineSteps: m.pipelineSteps,
        genderMatch: m.genderMatch,
        ageGroupMatch: m.ageGroupMatch,
        issues: m.issues,
      })),
      overallIssues: r.overallIssues,
    })),
  };
  
  writeFileSync(
    join(process.cwd(), 'stress-test-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n💾 Detailed report saved to: stress-test-report.json`);
  console.log(`\n✅ Stress test complete!`);
  
  process.exit(failed.length > 0 ? 1 : 0);
}

runStressTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
