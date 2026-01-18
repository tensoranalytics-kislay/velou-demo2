#!/bin/bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"

echo "🔍 Category Normalization Progress Check"
echo "========================================"
echo ""

if [ -f category-full-run.log ]; then
  echo "📄 Log file exists"
  total_lines=$(wc -l < category-full-run.log)
  echo "   Log lines: $total_lines"
  
  # Count batches processed
  batches=$(grep -c "Processing batch" category-full-run.log || echo "0")
  completed=$(grep -c "completed:.*normalized" category-full-run.log || echo "0")
  echo "   Batches started: $batches"
  echo "   Batches completed: $completed"
  echo ""
  
  # Last few lines
  echo "📋 Last 10 log entries:"
  tail -10 category-full-run.log | grep -E "(Processing|completed|Summary|mappings|Found)"
  echo ""
else
  echo "❌ Log file not found"
  echo ""
fi

if [ -f category-normalization-mapping.json ]; then
  mappings=$(jq 'length' category-normalization-mapping.json 2>/dev/null || echo "0")
  echo "✅ Mapping file exists"
  echo "   Total mappings: $mappings"
  echo ""
  
  if [ "$mappings" -gt 0 ]; then
    echo "📊 Sample conversions (first 10):"
    jq -r '.[0:10] | .[] | "\(.original) → \(.normalized.category)"' category-normalization-mapping.json 2>/dev/null || echo "Could not parse"
    echo ""
    
    echo "📈 Category reduction stats:"
    unique_before=$(jq '[.[].original] | unique | length' category-normalization-mapping.json 2>/dev/null || echo "0")
    unique_after=$(jq '[.[].normalized.category] | unique | length' category-normalization-mapping.json 2>/dev/null || echo "0")
    echo "   Unique categories before: $unique_before"
    echo "   Unique categories after: $unique_after"
    echo ""
    
    # Show most common target categories
    echo "🎯 Top 10 target categories:"
    jq -r '.[].normalized.category' category-normalization-mapping.json | sort | uniq -c | sort -rn | head -10
  fi
else
  echo "⏳ Mapping file not created yet"
fi

echo ""
echo "To check again: ./check-normalization-progress.sh"
