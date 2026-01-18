#!/bin/bash

# Simple realistic query test script
# Tests proper direct and indirect queries

echo "🧪 Testing Realistic User Queries"
echo "=================================="
echo ""

# Test 1: Direct query with product type + gender
echo "Test 1: Direct query - 'Show me jeans for women'"
RESULT1=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-direct","message":"Show me jeans for women"}' | \
  jq -r '.productCards[0:3] | .[] | .title' 2>/dev/null)
echo "Products:"
echo "$RESULT1" | head -3
echo ""

# Test 2: Direct query - men's shirts
echo "Test 2: Direct query - 'I need dress shirts for men'"
RESULT2=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-direct-2","message":"I need dress shirts for men"}' | \
  jq -r '.productCards[0:3] | .[] | .title' 2>/dev/null)
echo "Products:"
echo "$RESULT2" | head -3
echo ""

# Test 3: Indirect query - product type implies gender
echo "Test 3: Indirect query - 'Find me a summer dress'"
RESULT3=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-indirect","message":"Find me a summer dress"}' | \
  jq -r '.productCards[0:3] | .[] | .title' 2>/dev/null)
echo "Products:"
echo "$RESULT3" | head -3
echo ""

# Test 4: Direct query with style details
echo "Test 4: Direct query with details - 'I want high-rise skinny jeans in dark colors'"
RESULT4=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-detailed","message":"I want high-rise skinny jeans in dark colors"}' | \
  jq -r '.productCards[0:3] | .[] | .title' 2>/dev/null)
echo "Products:"
echo "$RESULT4" | head -3
echo ""

# Test 5: Follow-up conversation
echo "Test 5: Follow-up conversation"
echo "  Message 1: 'Show me tops'"
RESULT5A=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-followup","message":"Show me tops"}' | \
  jq -r '.productCards[0:2] | .[] | .title' 2>/dev/null)
echo "  Products:"
echo "$RESULT5A" | head -2
sleep 2

echo "  Message 2: 'for women'"
RESULT5B=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-followup","message":"for women"}' | \
  jq -r '.productCards[0:2] | .[] | .title' 2>/dev/null)
echo "  Products:"
echo "$RESULT5B" | head -2
sleep 2

echo "  Message 3: 'in blue'"
RESULT5C=$(curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-realistic-followup","message":"in blue"}' | \
  jq -r '.productCards[0:2] | .[] | .title' 2>/dev/null)
echo "  Products:"
echo "$RESULT5C" | head -2
echo ""

echo "✅ Tests complete"
echo ""
echo "Checking logs for gender filtering..."
tail -200 app.log 2>/dev/null | grep -E "test-realistic.*gender_hard_filter|test-realistic.*Men's|test-realistic.*Women's" | tail -10
