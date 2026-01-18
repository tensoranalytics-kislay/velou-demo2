#!/bin/bash
# Extract timing information from logs for sample query

QUERY="I'm looking for a floral maxi dress for a summer beach wedding"

echo "Extracting timing information from logs..."
echo ""

tail -10000 app.log | grep "$QUERY" | grep -E "(handleLoveshackfancyQuery: starting|query_categorization_result|category_classification_complete|classifyQuery: complete|retrieval_complete|ranking_complete|reply_generation_complete)" | tail -20
