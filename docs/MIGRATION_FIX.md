# Migration Fix Guide

## Issue
`prisma migrate dev` fails with shadow database errors because:
1. The Product table was created before migrations were tracked
2. The shadow database tries to replay all migrations from scratch
3. Some migrations reference tables/columns that don't exist in the shadow database

## Solution

### For Production/Deployment
Use `prisma migrate deploy` which doesn't use a shadow database:

```bash
npx prisma migrate deploy
```

This applies pending migrations without validation against a shadow database.

### For Development
Use `prisma db push` for schema changes during development:

```bash
npx prisma db push
```

This syncs your schema directly to the database without creating migration files.

### When You Need to Create New Migrations

1. **Option 1: Use `prisma migrate dev --create-only`**
   ```bash
   npx prisma migrate dev --create-only --name your_migration_name
   ```
   This creates the migration file without applying it. Then manually review and apply with `prisma migrate deploy`.

2. **Option 2: Use `prisma migrate diff`**
   ```bash
   npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url $DATABASE_URL --script > migration.sql
   ```
   Then manually create a migration folder and add the SQL.

## Current Status

✅ **Database is up to date** - All migrations have been applied using `prisma migrate deploy`
✅ **Schema matches database** - Verified with `prisma migrate status`
✅ **Setup script works** - Default merchant, admin user, and API key created

## Why This Happens

The shadow database validation in `prisma migrate dev` requires:
- All migrations to be replayable from scratch
- No dependencies on tables/columns created outside migrations
- Proper ordering of migrations

Since your database was created before migrations were fully tracked, the shadow database can't replay the full history.

## Recommendation

For this project, use:
- **`prisma migrate deploy`** for applying migrations (production/CI)
- **`prisma db push`** for rapid development iterations
- **Manual migration creation** when you need proper migration files

The database is fully functional and all Phase 0 migrations are complete.

