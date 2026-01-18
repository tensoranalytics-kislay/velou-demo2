#!/bin/bash

# Category Normalization - LIVE MODE
# This script will UPDATE the database with normalized categories

cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"

echo "🎯 Category Normalization - LIVE MODE"
echo "======================================"
echo ""
echo "⚠️  WARNING: This will UPDATE the database!"
echo "   - Will normalize all 2,854 categories"
echo "   - Will update Product.category and Product.subcategory columns"
echo "   - Backup will be saved to: category-normalization-backup.json"
echo "   - Checkpoint: category-extraction-checkpoint.json (for resume)"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

echo ""
echo "🚀 Starting normalization..."
echo ""

# Run without DRY_RUN (LIVE mode)
BATCH_SIZE=1 npx tsx scripts/normalize-categories.ts 2>&1 | tee category-normalization-live.log

echo ""
echo "✅ Normalization complete!"
echo "   Check category-normalization-live.log for details"
echo "   Mapping file: category-normalization-mapping.json"
