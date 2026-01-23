# Pack Products Identification

## Summary

Pack products (t-shirt packs, jeans packs, box packs, etc.) can be identified in the database using **two key fields** stored in the `attributes` JSONB column.

---

## Identification Methods

### 1. **`set_vs_single` Field** (Primary Indicator)
- **Location**: `attributes->>'set_vs_single'`
- **Values**:
  - `"Set"` → Product is a pack/set
  - `"Single"` → Product is a single item
- **Example**:
  ```json
  {
    "set_vs_single": "Set"
  }
  ```

### 2. **`pack_size` Field** (Secondary Indicator)
- **Location**: `attributes->>'pack_size'`
- **Values**: Number of items in the pack (e.g., `"3"`, `"4"`, `"O/S"`)
- **Example**:
  ```json
  {
    "pack_size": "3"
  }
  ```

### 3. **Title Pattern** (Fallback)
- Products with "pack" in the title (case-insensitive)
- Example: `"Men's Luxe Stretch Tee 3-Pack"`

---

## SQL Queries to Find Pack Products

### Method 1: Using `set_vs_single`
```sql
SELECT id, title, category, attributes->>'set_vs_single' as set_vs_single, attributes->>'pack_size' as pack_size
FROM "Product"
WHERE attributes->>'set_vs_single' = 'Set'
  AND "isActive" = true;
```

### Method 2: Using `pack_size`
```sql
SELECT id, title, category, attributes->>'set_vs_single' as set_vs_single, attributes->>'pack_size' as pack_size
FROM "Product"
WHERE attributes->>'pack_size' IS NOT NULL
  AND attributes->>'pack_size' != ''
  AND "isActive" = true;
```

### Method 3: Combined (Most Reliable)
```sql
SELECT id, title, category, attributes->>'set_vs_single' as set_vs_single, attributes->>'pack_size' as pack_size
FROM "Product"
WHERE (
  attributes->>'set_vs_single' = 'Set'
  OR attributes->>'pack_size' IS NOT NULL
  OR LOWER(title) LIKE '%pack%'
)
  AND "isActive" = true;
```

---

## Examples from Database

### Example 1: T-Shirt 3-Pack
```json
{
  "title": "Men's Luxe Stretch Tee 3-Pack - Mott & Bow",
  "category": "Mens-tees",
  "attributes": {
    "set_vs_single": "Set",
    "pack_size": "3"
  }
}
```

### Example 2: V-Neck 4-Pack
```json
{
  "title": "Women's Set 01: The V-neck Marcy Essentials 4-Pack - Mott & Bow",
  "category": "Mens-tees",
  "attributes": {
    "set_vs_single": "Set",
    "pack_size": "4"
  }
}
```

### Example 3: His & Hers 4-Pack
```json
{
  "title": "Men's Set 01: The His & Hers Tees 4-Pack - Mott & Bow",
  "category": "Mens-tees",
  "attributes": {
    "set_vs_single": "Set",
    "pack_size": "4"
  }
}
```

---

## TypeScript/Prisma Query Example

```typescript
import { prisma } from './lib/db';

// Find all pack products
const packProducts = await prisma.$queryRaw<Array<{
  id: string;
  title: string;
  category: string;
  set_vs_single: string | null;
  pack_size: string | null;
}>>`
  SELECT 
    id,
    title,
    category,
    attributes->>'set_vs_single' as "set_vs_single",
    attributes->>'pack_size' as "pack_size"
  FROM "Product"
  WHERE (
    attributes->>'set_vs_single' = 'Set'
    OR attributes->>'pack_size' IS NOT NULL
    OR LOWER(title) LIKE '%pack%'
  )
    AND "isActive" = true
    AND "merchantId" = $1
`, merchantId);

// Filter pack products
const isPackProduct = (product: any): boolean => {
  const attrs = product.attributes as any;
  return (
    attrs?.set_vs_single === 'Set' ||
    (attrs?.pack_size && attrs.pack_size !== '') ||
    product.title.toLowerCase().includes('pack')
  );
};
```

---

## Usage Recommendations

### For Filtering Pack Products:
1. **Primary Check**: `attributes->>'set_vs_single' = 'Set'`
2. **Secondary Check**: `attributes->>'pack_size' IS NOT NULL`
3. **Fallback**: Title contains "pack" (case-insensitive)

### For Display:
- Use `pack_size` to show the number of items (e.g., "3-Pack", "4-Pack")
- Use `set_vs_single` to determine if it's a pack vs single item

### For Search/Filtering:
- Consider excluding pack products from certain searches if they're not relevant
- Or include them but clearly label them as packs in the UI

---

## Notes

- **`set_vs_single`** is the most reliable indicator (explicitly set to "Set" for packs)
- **`pack_size`** may be present even for single items in some cases (e.g., "O/S" for One Size)
- **Title pattern** is a good fallback but less reliable (may miss packs without "pack" in title)
- All pack-related data is stored in the `attributes` JSONB field, not as separate columns
