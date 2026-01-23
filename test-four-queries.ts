import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';
import * as fs from 'fs';

const queries = [
  "I am a curvy mom/woman, suggest me a dress to wear.",
  "I am going to Bahamas for vacation, suggest me a dress.",
  "attending a black tie wedding, suggest me a dress",
  "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it"
];

const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

async function runQuery(query: string, index: number) {
  console.log('\n' + '='.repeat(100));
  console.log(`QUERY ${index + 1}/${queries.length}: "${query}"`);
  console.log('='.repeat(100));
  console.log();

  const sessionId = `test-session-${index + 1}-${Date.now()}`;
  const logFile = `test-query-${index + 1}-${Date.now()}.log`;
  
  try {
    const startTime = Date.now();
    
    const result = await handleLoveshackfancyQuery({
      message: query,
      sessionId: sessionId,
      merchantId: merchantId,
    });

    const duration = Date.now() - startTime;

    console.log('✅ Query completed successfully\n');
    console.log('📊 Results Summary:');
    console.log(`  Products returned: ${result.productCards?.length || 0}`);
    console.log(`  Has reply: ${!!result.replyText}`);
    console.log(`  Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log();

    if (result.productCards && result.productCards.length > 0) {
      console.log('📦 Products Returned:');
      result.productCards.slice(0, 5).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
        console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        console.log(`     Category: ${p.category}`);
        if ((p as any).inclusivitySizing) {
          console.log(`     inclusivitySizing: ${(p as any).inclusivitySizing}`);
        }
        console.log();
      });
    } else {
      console.log('⚠️  No products returned');
      console.log();
    }

    console.log('💬 Reply Preview:');
    console.log(result.replyText?.substring(0, 300) || 'No reply');
    console.log();

    // Write detailed log to file
    const logContent = {
      query,
      sessionId,
      timestamp: new Date().toISOString(),
      duration,
      results: {
        productCount: result.productCards?.length || 0,
        hasReply: !!result.replyText,
        replyPreview: result.replyText?.substring(0, 500),
        products: result.productCards?.slice(0, 10).map(p => ({
          id: p.id,
          title: p.title,
          priceCents: p.priceCents,
          category: p.category,
          inclusivitySizing: (p as any).inclusivitySizing,
        })),
      },
    };

    fs.writeFileSync(logFile, JSON.stringify(logContent, null, 2));
    console.log(`📝 Detailed log saved to: ${logFile}`);
    console.log();

    return { query, success: true, productCount: result.productCards?.length || 0, duration, logFile };

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    
    const errorLog = {
      query,
      sessionId,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    
    const errorLogFile = `test-query-${index + 1}-error-${Date.now()}.log`;
    fs.writeFileSync(errorLogFile, JSON.stringify(errorLog, null, 2));
    console.log(`📝 Error log saved to: ${errorLogFile}`);
    console.log();

    return { query, success: false, error: error instanceof Error ? error.message : String(error), errorLogFile };
  }
}

async function runAllQueries() {
  console.log('🚀 Starting Full Pipeline Test');
  console.log(`Testing ${queries.length} queries...`);
  console.log();

  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const result = await runQuery(queries[i], i);
    results.push(result);
    
    // Wait a bit between queries to avoid rate limiting
    if (i < queries.length - 1) {
      console.log('⏳ Waiting 2 seconds before next query...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(100));
  console.log();

  results.forEach((result, index) => {
    console.log(`Query ${index + 1}: "${result.query.substring(0, 60)}..."`);
    if (result.success) {
      console.log(`  ✅ Success - Products: ${result.productCount}, Duration: ${result.duration}ms`);
      console.log(`  📝 Log: ${result.logFile}`);
    } else {
      console.log(`  ❌ Failed - Error: ${result.error}`);
      console.log(`  📝 Error Log: ${result.errorLogFile}`);
    }
    console.log();
  });

  const summary = {
    totalQueries: queries.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalProducts: results.filter(r => r.success).reduce((sum, r) => sum + (r.productCount || 0), 0),
    results: results.map(r => ({
      query: r.query,
      success: r.success,
      productCount: r.productCount || 0,
      duration: r.duration,
      logFile: r.logFile || r.errorLogFile,
    })),
  };

  const summaryFile = `test-summary-${Date.now()}.json`;
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`📝 Summary saved to: ${summaryFile}`);
  console.log();

  process.exit(0);
}

runAllQueries();
