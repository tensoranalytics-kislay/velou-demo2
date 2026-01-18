#!/bin/bash
# Check LLM normalization quality without disturbing the process

cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"

echo "🔍 LLM Normalization Quality Check"
echo "===================================="
echo ""

if [ ! -f category-normalization-mapping.json ]; then
  echo "⏳ Mapping file not created yet."
  echo "   The script is still in extraction or LLM normalization phase."
  echo ""
  echo "Checking extraction progress..."
  if [ -f category-extraction-checkpoint.json ]; then
    extracted=$(jq 'length' category-extraction-checkpoint.json 2>/dev/null || echo "0")
    echo "   ✅ Extraction checkpoint: $extracted categories extracted"
  else
    echo "   ⏳ No checkpoint yet (extraction in progress)"
  fi
  exit 0
fi

total=$(jq 'length' category-normalization-mapping.json 2>/dev/null || echo "0")
verified=$(jq '[.[] | select(.verified == true)] | length' category-normalization-mapping.json 2>/dev/null || echo "0")
unique_targets=$(jq '[.[].normalized.category] | unique | length' category-normalization-mapping.json 2>/dev/null || echo "0")

echo "📊 Statistics:"
echo "   Total mappings: $total"
echo "   Verified: $verified"
echo "   Unique target categories: $unique_targets"
echo ""

echo "🎯 Top 15 Target Categories (normalization results):"
jq -r '.[].normalized.category' category-normalization-mapping.json | sort | uniq -c | sort -rn | head -15
echo ""

echo "✅ Sample Normalizations (first 10):"
jq -r '.[0:10] | .[] | "  \"\(.original)\" → \"\(.normalized.category)\"\(if .normalized.subcategory then " > \(.normalized.subcategory)" else "" end)"' category-normalization-mapping.json
echo ""

echo "🧠 Sample Reasoning (checking LLM quality):"
jq -r '.[0:5] | .[] | "  \(.original):\n    → \(.normalized.category)\n    Reasoning: \(.reasoning // "none")\n"' category-normalization-mapping.json
echo ""

echo "🔍 Gender Detection Examples:"
jq -r '.[] | select(.reasoning | test("95%|female|male|gender"; "i")) | "  \(.original) → \(.normalized.category)"' category-normalization-mapping.json | head -10
echo ""

echo "🏠 Non-Apparel Detection Examples:"
jq -r '.[] | select(.normalized.category | test("Bedding|Tabletop|Home|Accessories"; "i")) | "  \(.original) → \(.normalized.category)"' category-normalization-mapping.json | head -10
echo ""

echo "📉 Category Reduction Analysis:"
unique_sources=$(jq '[.[].original] | unique | length' category-normalization-mapping.json)
reduction=$(echo "scale=1; (($unique_sources - $unique_targets) / $unique_sources) * 100" | bc 2>/dev/null || echo "calculating...")
echo "   Source categories: $unique_sources"
echo "   Target categories: $unique_targets"
echo "   Reduction: ${reduction}%"
echo ""

echo "✅ Quality indicators look good if:"
echo "   1. Verified count = Total count"
echo "   2. Reasoning field contains meaningful explanations"
echo "   3. Target categories are from standard category tree"
echo "   4. Gender/age detection is working (check reasoning)"
