# Long Sleeve T-Shirt Query Test Results

## Query
"hey I am looking for women's long sleeve t shirt"

## Extracted Constraints

### Gender
- **Value**: `female` (extracted early)
- **Intent**: `required` (hard SQL filter)

### Category
- **Category**: `Womens-tees`
- **Classification**: `direct_search`

### Sleeve Length
- **Values**: `["Long"]`
- **Intent**: `required` (hard filter)

## Recommended Products

### 1. Black Knit Sleeve Detail Top
- **Product ID**: `201308000`
- **Price**: $34.99
- **Reason**: Chosen because comfortable and flattering.
- **Category**: `Womens-tees`
- **Gender**: `female`
- **Sleeve**: `Long`
- **Is T-Shirt**: ✅ YES
- **Is Women's**: ✅ YES
- **Is Long Sleeve**: ✅ YES
- **Matches All Requirements**: ✅ YES

### 2. White Embellished Long Sleeve Top
- **Product ID**: `203562025`
- **Price**: $29.99
- **Reason**: Chosen because comfortable and flattering.
- **Category**: `Womens-tees`
- **Gender**: `female`
- **Sleeve**: `Long`
- **Is T-Shirt**: ✅ YES
- **Is Women's**: ✅ YES
- **Is Long Sleeve**: ✅ YES
- **Matches All Requirements**: ✅ YES

### 3. Women's Classic Crew Neck Black T-Shirt | Size XS Fitted | Lightweight T-Shirt 50% Pima cotton 50% Modal by Mott & Bow
- **Product ID**: `fclt-marc-blac`
- **Price**: $44.99
- **Reason**: Chosen because flattering and comfortable.
- **Category**: `Womens-tees`
- **Gender**: `female`
- **Sleeve**: `Long`
- **Is T-Shirt**: ✅ YES
- **Is Women's**: ✅ YES
- **Is Long Sleeve**: ✅ YES
- **Matches All Requirements**: ✅ YES

### 4. Women's Classic Crew Neck Gray T-Shirt | Size M Fitted | Lightweight T-Shirt 50% Pima cotton 50% Modal by Mott & Bow
- **Product ID**: `fclt-marc-heag`
- **Price**: $44.99
- **Reason**: Chosen because comfortable and flattering.
- **Category**: `Womens-tees`
- **Gender**: `female`
- **Sleeve**: `Long`
- **Is T-Shirt**: ✅ YES
- **Is Women's**: ✅ YES
- **Is Long Sleeve**: ✅ YES
- **Matches All Requirements**: ✅ YES

## Analysis

### ✅ Constraint Extraction
- Gender correctly extracted as `female` with `required` intent
- Category correctly identified as `Womens-tees`
- Sleeve length correctly extracted as `Long` with `required` intent

### ✅ Product Quality
- **100% of all 4 products match all requirements** ✅
- All products are:
  - T-Shirts (category: Womens-tees)
  - Women's (gender: female)
  - Long Sleeve (sleeve: Long)

### ✅ Results Accuracy
- Perfect match rate: 4/4 products (100%)
- All products correctly match:
  - Women's requirement ✅
  - Long sleeve requirement ✅
  - T-shirt category requirement ✅

## Summary
The query "hey I am looking for women's long sleeve t shirt" is working **perfectly**:
- ✅ Constraints extracted: Gender (female, required), Category (Womens-tees), Sleeve Length (Long, required)
- ✅ **100% of products match all requirements** (4/4 products)
- ✅ All products are women's long sleeve t-shirts
