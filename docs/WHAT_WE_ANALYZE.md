# What We're Analyzing in the Database

## The Problem We're Solving

Your database currently stores **each size variant as a separate Product row**. This means:

```
Same dress, 5 sizes = 5 separate Product rows:
- Product 1: "Floral Summer Dress" - Size S
- Product 2: "Floral Summer Dress" - Size M  
- Product 3: "Floral Summer Dress" - Size L
- Product 4: "Floral Summer Dress" - Size XL
- Product 5: "Floral Summer Dress" - Size XXL
```

**This causes**:
- 5-10x more database rows than unique products
- Duplicate search results (same dress shows up 5 times)
- Slow queries (must deduplicate on every search)
- Wasted storage (duplicate titles, descriptions, images, embeddings)

---

## What the Analysis Script Does

The `analyze-database.ts` script examines your database to understand:

### 1. 📊 **Basic Statistics**
- **Total Products**: How many Product rows exist
- **Unique Products**: How many actual unique products (after grouping variants)
- **Duplication Factor**: How many variants per product (e.g., 5x means 5 sizes per product)
- **Average Variants**: Average number of size variants per product

**Why**: Tells us how much duplication exists and how much we can reduce storage.

### 2. 🔑 **Deduplication Key Analysis**
Checks how many products have keys that let us group variants together:

- **parent_id**: Products that share a parent_id are variants
- **related_id**: Products that share a related_id are variants  
- **shopifyProductId**: Shopify products with same parent ID are variants
- **sourceId**: Products with same base sourceId (minus size suffix) are variants
- **Products without keys**: Products that can't be grouped (need manual review)

**Why**: We need these keys to group variants together during migration. If products don't have keys, we can't automatically group them.

**Example**:
```
✅ Good: 3 products with parent_id="dress-123" → Can group them
❌ Bad: 3 products with no parent_id → Can't group automatically
```

### 3. 📦 **Duplicate Groups**
Finds groups of products that are actually the same product (different sizes):

- **Group size**: How many variants in each group (2, 3, 5, 10, etc.)
- **Product IDs**: Which products belong to each group
- **Deduplication key**: What key was used to group them

**Why**: Shows us exactly which products need to be merged during migration.

**Example Output**:
```
Group 1: parent_id="dress-123"
  - Product A (Size S)
  - Product B (Size M)
  - Product C (Size L)
  → Will become: 1 Product + 3 ProductVariants
```

### 4. 👕 **Size Distribution**
Analyzes how sizes are stored in your database:

- **Size values**: What sizes exist (S, M, L, XL, etc.)
- **Size count**: How many products have each size
- **Size format**: Are sizes in `attributes.sizes` array, `attributes.size` string, or `sourceId`?

**Why**: 
- Shows if sizes are extractable (can we get size from each product?)
- Reveals data quality issues (inconsistent size formats)
- Helps plan how to migrate sizes to ProductVariant table

**Example**:
```
Size S: 10,000 products
Size M: 10,000 products
Size L: 10,000 products
→ Confirms we have size variants
```

### 5. 📁 **Category Distribution**
Counts products by category:

- **Categories**: What categories exist (dresses, shirts, pants, etc.)
- **Product count**: How many products in each category
- **Percentage**: What % of products are in each category

**Why**: 
- Helps understand your catalog structure
- Identifies which categories have most duplication
- Useful for planning migration batches

### 6. 🔍 **Sample Duplicates**
Shows examples of duplicate products:

- **Product titles**: Same title, different sizes
- **Deduplication keys**: What key groups them
- **Size values**: What sizes each variant has
- **Parent/Related IDs**: The relationship keys

**Why**: 
- Lets you manually verify the grouping logic is correct
- Shows real examples of what will be merged
- Helps catch edge cases

---

## Example Analysis Output

```
📊 BASIC STATISTICS
────────────────────────────────────────────────────────────────────────────────
Total Products:           50,000
Unique Products:          10,000
Avg Variants per Product: 5.00
Duplication Factor:      5.00x

🔑 DEDUPLICATION KEY AVAILABILITY
────────────────────────────────────────────────────────────────────────────────
Products with parent_id:  30,000 (60.0%)  ← Can group these automatically
Products with related_id: 15,000 (30.0%)  ← Can group these automatically
Products with shopifyId:  25,000 (50.0%)  ← Can group these automatically
Products without key:     5,000 (10.0%)   ← Need manual review

📦 DUPLICATE GROUPS
────────────────────────────────────────────────────────────────────────────────
Total duplicate groups:   10,000
Max variants in group:   12
Min variants in group:   2
Avg variants in group:   5.00

Top 10 duplicate groups:
  1. parent_dress-123: 8 variants
  2. shopify_8203037769913: 6 variants
  3. related_shirt-456: 5 variants
  ...

👕 SIZE DISTRIBUTION
────────────────────────────────────────────────────────────────────────────────
  S           10,000 (20.0%)
  M           10,000 (20.0%)
  L           10,000 (20.0%)
  XL          8,000 (16.0%)
  ...

🔍 SAMPLE DUPLICATES
────────────────────────────────────────────────────────────────────────────────
1. Floral Summer Dress
   ID: product-123-size-s
   Dedup Key: parent_dress-123
   Size: S
   Parent ID: dress-123

2. Floral Summer Dress
   ID: product-123-size-m
   Dedup Key: parent_dress-123
   Size: M
   Parent ID: dress-123
```

---

## What This Tells Us

### ✅ **Good Signs**:
- High deduplication key coverage (>80%) = Most products can be grouped automatically
- Consistent duplication factor (5-6x) = Predictable migration
- Clear size distribution = Sizes are extractable

### ⚠️ **Warning Signs**:
- Low deduplication key coverage (<50%) = Many products need manual review
- Very high duplication (20x+) = May indicate data quality issues
- Inconsistent size formats = Harder to extract sizes during migration

### 📋 **Migration Planning**:
- **Estimated unique products**: How many Product rows to create
- **Estimated variants**: How many ProductVariant rows to create
- **Manual review needed**: How many products need human review
- **Storage reduction**: How much space we'll save (~70-80%)

---

## How This Helps the Migration

1. **Know what we're dealing with**: Understand duplication patterns before migration
2. **Plan migration batches**: Group products that can be migrated together
3. **Identify risks**: Find products that need special handling
4. **Estimate effort**: Know how much work the migration will be
5. **Verify correctness**: Sample duplicates let us verify grouping logic

---

## Real-World Example

**Before Analysis**:
- You see 50,000 products in database
- Don't know how many are duplicates
- Don't know if you can group them

**After Analysis**:
- Know you have 10,000 unique products
- Know 40,000 are size variants
- Know 90% can be grouped automatically
- Know 10% need manual review
- Know you'll save ~80% storage

**Migration Plan**:
- Create 10,000 Product rows (one per unique product)
- Create 50,000 ProductVariant rows (one per size)
- Manually review 5,000 products without deduplication keys
- Process in 50 batches of 1,000 products each

---

## Summary

The analysis answers:
1. **How much duplication?** → Duplication factor
2. **Can we group variants?** → Deduplication key coverage
3. **What needs manual work?** → Products without keys
4. **How much will we save?** → Storage reduction estimate
5. **Is the data good?** → Size/category distribution quality

This information is **critical** for planning a safe, successful migration! 🚀










