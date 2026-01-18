#!/usr/bin/env tsx

/**
 * Realistic User Query Test Suite
 * Tests the pipeline with proper direct and indirect queries
 */

interface TestQuery {
  query: string;
  description: string;
  type: 'direct' | 'indirect' | 'follow-up';
  expectedGender?: 'male' | 'female' | null;
  expectedProductType?: string;
  shouldHaveResults: boolean;
}

const TEST_QUERIES: TestQuery[] = [
  // DIRECT QUERIES - Clear product type + gender
  {
    query: "Show me jeans for women",
    description: "Direct query with product type and gender",
    type: 'direct',
    expectedGender: 'female',
    expectedProductType: 'jeans',
    shouldHaveResults: true,
  },
  {
    query: "I need a dress shirt for men",
    description: "Direct query with formal product type and gender",
    type: 'direct',
    expectedGender: 'male',
    expectedProductType: 'shirt',
    shouldHaveResults: true,
  },
  {
    query: "Find me a summer dress",
    description: "Direct query with product type (dress implies female)",
    type: 'direct',
    expectedGender: 'female',
    expectedProductType: 'dress',
    shouldHaveResults: true,
  },
  {
    query: "I want high-rise skinny jeans in dark colors",
    description: "Direct query with specific style and color",
    type: 'direct',
    expectedGender: 'female', // jeans + high-rise + skinny typically female
    expectedProductType: 'jeans',
    shouldHaveResults: true,
  },
  {
    query: "Show me polo shirts for men",
    description: "Direct query with casual product type and gender",
    type: 'direct',
    expectedGender: 'male',
    expectedProductType: 'polo',
    shouldHaveResults: true,
  },

  // INDIRECT QUERIES - Need interpretation
  {
    query: "I'm looking for something comfortable to wear at home",
    description: "Indirect query - needs to infer loungewear/casual",
    type: 'indirect',
    expectedGender: null, // Should infer from context or default
    expectedProductType: 'loungewear',
    shouldHaveResults: true,
  },
  {
    query: "What should I wear to a beach wedding?",
    description: "Indirect query - needs to infer occasion and style",
    type: 'indirect',
    expectedGender: null,
    expectedProductType: 'dress',
    shouldHaveResults: true,
  },
  {
    query: "I need something for work that's professional but not too formal",
    description: "Indirect query - needs to infer business casual",
    type: 'indirect',
    expectedGender: null,
    expectedProductType: 'shirt',
    shouldHaveResults: true,
  },
  {
    query: "Looking for something in navy blue",
    description: "Indirect query - only color specified",
    type: 'indirect',
    expectedGender: null,
    expectedProductType: null,
    shouldHaveResults: true,
  },

  // FOLLOW-UP QUERIES - Building on previous context
  {
    query: "Show me tops",
    description: "Follow-up query - needs previous context for gender",
    type: 'follow-up',
    expectedGender: null, // Should use previous context
    expectedProductType: 'top',
    shouldHaveResults: true,
  },
  {
    query: "in blue",
    description: "Follow-up query - just color refinement",
    type: 'follow-up',
    expectedGender: null, // Should use previous context
    expectedProductType: null,
    shouldHaveResults: true,
  },
  {
    query: "casual style",
    description: "Follow-up query - style refinement",
    type: 'follow-up',
    expectedGender: null, // Should use previous context
    expectedProductType: null,
    shouldHaveResults: true,
  },
];

interface Conversation {
  sessionId: string;
  messages: Array<{
    query: string;
    type: 'direct' | 'indirect' | 'follow-up';
    expectedGender?: 'male' | 'female' | null;
  }>;
}

const CONVERSATIONS: Conversation[] = [
  {
    sessionId: 'conv-1-women-jeans',
    messages: [
      { query: "Show me jeans for women", type: 'direct', expectedGender: 'female' },
      { query: "in dark colors", type: 'follow-up', expectedGender: 'female' },
      { query: "high rise", type: 'follow-up', expectedGender: 'female' },
    ],
  },
  {
    sessionId: 'conv-2-men-shirts',
    messages: [
      { query: "I need dress shirts for men", type: 'direct', expectedGender: 'male' },
      { query: "in white or light blue", type: 'follow-up', expectedGender: 'male' },
      { query: "slim fit", type: 'follow-up', expectedGender: 'male' },
    ],
  },
  {
    sessionId: 'conv-3-indirect-discovery',
    messages: [
      { query: "What should I wear to a wedding?", type: 'indirect', expectedGender: null },
      { query: "something elegant", type: 'follow-up', expectedGender: null },
      { query: "in navy or black", type: 'follow-up', expectedGender: null },
    ],
  },
  {
    sessionId: 'conv-4-casual-comfort',
    messages: [
      { query: "I need comfortable clothes for lounging", type: 'indirect', expectedGender: null },
      { query: "soft fabrics", type: 'follow-up', expectedGender: null },
    ],
  },
];

async function testQuery(query: string, sessionId: string): Promise<any> {
  try {
    const response = await fetch('http://localhost:3000/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        message: query,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error testing query "${query}":`, error);
    throw error;
  }
}

async function analyzeResults(results: any, testQuery: TestQuery): Promise<void> {
  const products = results.productCards || [];
  const productTitles = products.map((p: any) => p.title || '').join(', ');
  
  console.log(`\n📋 Query: "${testQuery.query}"`);
  console.log(`   Type: ${testQuery.type}`);
  console.log(`   Products returned: ${products.length}`);
  
  if (products.length > 0) {
    console.log(`   Sample products: ${productTitles.substring(0, 150)}...`);
    
    // Check for wrong gender products
    const wrongGenderProducts = products.filter((p: any) => {
      const title = (p.title || '').toLowerCase();
      if (testQuery.expectedGender === 'female') {
        return title.includes("men's") || title.includes("mens-") || title.includes(" mens ");
      } else if (testQuery.expectedGender === 'male') {
        return title.includes("women's") || title.includes("womens-") || title.includes(" womens ");
      }
      return false;
    });
    
    if (wrongGenderProducts.length > 0) {
      console.log(`   ❌ WRONG GENDER: Found ${wrongGenderProducts.length} products with wrong gender`);
      wrongGenderProducts.forEach((p: any) => {
        console.log(`      - ${p.title}`);
      });
    } else if (testQuery.expectedGender) {
      console.log(`   ✅ Gender filter working correctly`);
    }
  } else {
    if (testQuery.shouldHaveResults) {
      console.log(`   ⚠️  WARNING: Expected results but got 0 products`);
    } else {
      console.log(`   ✅ Correctly returned 0 results`);
    }
  }
}

async function testConversation(conversation: Conversation): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🗣️  Conversation: ${conversation.sessionId}`);
  console.log(`${'='.repeat(80)}`);
  
  for (const message of conversation.messages) {
    console.log(`\n💬 User: "${message.query}"`);
    
    try {
      const results = await testQuery(message.query, conversation.sessionId);
      const products = results.productCards || [];
      
      console.log(`   ✅ Response received (${products.length} products)`);
      
      // Check for wrong gender
      if (message.expectedGender) {
        const wrongGender = products.filter((p: any) => {
          const title = (p.title || '').toLowerCase();
          if (message.expectedGender === 'female') {
            return title.includes("men's") || title.includes("mens-");
          } else if (message.expectedGender === 'male') {
            return title.includes("women's") || title.includes("womens-");
          }
          return false;
        });
        
        if (wrongGender.length > 0) {
          console.log(`   ❌ WRONG GENDER: ${wrongGender.length} products with wrong gender`);
        } else {
          console.log(`   ✅ Gender filter correct`);
        }
      }
      
      // Small delay between messages
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`   ❌ Error:`, error);
    }
  }
}

async function main() {
  console.log('🚀 Starting Realistic Query Test Suite\n');
  console.log(`Testing ${TEST_QUERIES.length} individual queries and ${CONVERSATIONS.length} conversations\n`);
  
  // Test individual queries
  console.log(`${'='.repeat(80)}`);
  console.log('📝 Testing Individual Queries');
  console.log(`${'='.repeat(80)}`);
  
  for (const testQuery of TEST_QUERIES) {
    try {
      const results = await testQuery(testQuery.query, `test-${testQuery.type}-${Date.now()}`);
      await analyzeResults(results, testQuery);
      
      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`❌ Failed to test "${testQuery.query}":`, error);
    }
  }
  
  // Test conversations
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('💬 Testing Conversations with Follow-ups');
  console.log(`${'='.repeat(80)}`);
  
  for (const conversation of CONVERSATIONS) {
    await testConversation(conversation);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('✅ Test Suite Complete');
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(console.error);
