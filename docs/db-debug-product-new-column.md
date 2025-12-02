# Debugging `column "new" does not exist` on `Product` upserts

When uploading a unified catalog CSV from the admin UI, you may see errors like:

```text
Invalid `prisma.product.upsert()` invocation:

The column "new" does not exist in the current database.
```

## What this means

- The application’s TypeScript layer **no longer sends any top‑level `new` field** to Prisma.
- The `Product` Prisma model does **not** define a `new` column – all flexible, vendor‑specific data is stored inside the JSON `attributes` field.
- The ingestion pipeline (`src/lib/catalog/ingestUnifiedCsv.ts`) enforces a strict whitelist of top‑level fields and explicitly strips any accidental top‑level `new` property before calling `prisma.product.upsert`.

If you are still seeing `The column "new" does not exist in the current database.` during an upsert, the most likely cause is:

> A **PostgreSQL trigger, generated column, or expression index** on the `"Product"` table is still referencing a column named `new` (or `NEW."new"`), left over from an earlier iteration of the schema.

Because those DB objects run on every `INSERT`/`UPDATE`, they will cause an error even if the application does not send a `new` column.

## How to inspect your database

Run the following SQL in your Postgres console (e.g. `psql`, DBeaver, or your DB UI). Adjust object names if your `Product` table or functions use different names.

```sql
-- 1) List all non-internal triggers on the Product table
SELECT tgname, tgfoid::regprocedure
FROM pg_trigger
WHERE tgrelid = '"Product"'::regclass
  AND NOT tgisinternal;

-- 2) Show the Product table definition and indexes
\d+ "Product";

-- 3) For each trigger function from step (1), inspect the function body.
-- Replace product_search_vector_update with the actual function name if different.
SELECT pg_get_functiondef('product_search_vector_update'::regprocedure);
```

Look for any occurrences of a field or expression named `new` in:

- Trigger function bodies (`NEW."new"`, `"new"` inside JSON‑building code, etc.).
- Expression indexes or computed columns defined on the `"Product"` table.

## How to fix it

If you find a trigger or index that still references a `new` column:

1. **Confirm** that the `Product` table no longer has a `new` column:

   ```sql
   \d "Product"
   ```

2. Decide how to handle the offending DB object:

   - If it’s an old/unused trigger or index from a prior version, you can safely drop it.
   - If it’s meant to keep a search index up to date (e.g., `product_search_vector_update`), update its definition to stop referencing `new` and redeploy it via a migration.

3. Example: dropping a vestigial trigger or index (replace names with the actual ones from your DB):

   ```sql
   -- EXAMPLE ONLY – adjust names to match your environment
   DROP TRIGGER IF EXISTS product_new_column_trigger ON "Product";

   -- If you have an index that references "new", drop or recreate it:
   DROP INDEX IF EXISTS "Product_new_expr_idx";
   ```

> ⚠️ **Important:** Always review and understand the existing trigger/index definitions before dropping or modifying them, especially in production. Coordinate with your DBA or team lead as needed.

After cleaning up any DB‑side references to `new`, re‑run your CSV upload. With the current ingestion code and schema, the application will not attempt to create or update a `new` column, and the `prisma.product.upsert()` calls should succeed.


