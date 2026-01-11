# Troubleshooting Guide

## Database Connection Issues

### Error: "Can't reach database server"

This error occurs when the scripts cannot connect to your PostgreSQL database.

#### Common Causes & Solutions

**1. DATABASE_URL not set**
```bash
# Check if DATABASE_URL is set
echo $DATABASE_URL

# Set it (replace with your actual connection string)
export DATABASE_URL="postgresql://user:password@host:port/database"

# Or add to .env file
echo 'DATABASE_URL="postgresql://user:password@host:port/database"' >> .env
```

**2. Database server not running**
- Check if your Neon database is active in the Neon dashboard
- For local databases, ensure PostgreSQL is running:
  ```bash
  # macOS
  brew services list | grep postgresql
  
  # Linux
  sudo systemctl status postgresql
  ```

**3. Network/Firewall issues**
- Check if you can reach the database host:
  ```bash
  # Test connection (replace with your host)
  telnet ep-icy-forest-adq5qfri-pooler.c-2.us-east-1.aws.neon.tech 5432
  ```
- For Neon databases, check if your IP is whitelisted
- For cloud databases, verify security group/firewall rules

**4. Incorrect credentials**
- Verify username and password in DATABASE_URL
- Check if password contains special characters that need URL encoding
- For Neon, ensure you're using the correct connection string from dashboard

**5. Connection pooler issues (Neon)**
- Neon uses connection poolers. Try:
  - Direct connection (remove `-pooler` from hostname)
  - Or use the pooler connection string from Neon dashboard

#### Testing Connection

```bash
# Test with psql
psql $DATABASE_URL -c "SELECT 1;"

# Test with Prisma
npx prisma db execute --stdin <<< "SELECT 1;"
```

#### Neon-Specific Issues

If using Neon database:

1. **Get correct connection string**:
   - Go to Neon dashboard
   - Select your project
   - Copy the connection string (use "Pooled connection" for better performance)

2. **Connection pooler**:
   - Neon uses `-pooler` suffix for pooled connections
   - Direct connections don't have `-pooler`
   - Try both if one doesn't work

3. **IP allowlist**:
   - Check if your IP is allowed
   - Add your IP in Neon dashboard if needed

4. **Database sleep**:
   - Neon databases sleep after inactivity
   - First connection may take a few seconds to wake up

---

## Script Execution Issues

### Error: "Command not found: #"

This happens when you copy-paste commands with comments. Remove the `#` lines:

```bash
# ❌ Wrong
# npm run analyze:database
npm run analyze:database

# ✅ Correct
npm run analyze:database
```

### Error: "No such file or directory"

The analysis scripts generate output files. If they fail, files won't be created:

1. Fix the database connection issue first
2. Re-run the script
3. Files will be created on successful execution

---

## Data Analysis Issues

### Out of Memory

If analyzing large databases causes memory issues:

```bash
# Analyze specific merchant (smaller dataset)
MERCHANT_ID=merchant_123 npm run analyze:database

# Or modify batch size in the script
```

### Slow Queries

For very large databases:

1. Use SQL queries directly (`analyze-database-queries.sql`)
2. Run queries in smaller chunks
3. Add indexes if needed (see DATABASE_AUDIT.md)

---

## Migration Preparation Issues

### Validation Fails

If data integrity validation fails:

1. **Review the errors**:
   ```bash
   npm run migrate:prepare
   # Check the error messages
   ```

2. **Fix data quality issues**:
   - Missing titles: Update products with empty titles
   - Missing categories: Set default category or fix data
   - Invalid prices: Fix price data

3. **Re-run validation**:
   ```bash
   npm run migrate:prepare
   ```

### No Duplicate Groups Found

If migration prep shows no duplicate groups:

1. **Verify deduplication logic**:
   - Check if products have parent_id, related_id, or shopifyProductId
   - Review sample products manually

2. **Check analysis results**:
   ```bash
   cat database-analysis-results.json
   # Look for duplicateGroups array
   ```

---

## Environment Setup

### Check Environment Variables

```bash
# List all environment variables
env | grep -i database

# Check specific variable
echo $DATABASE_URL
echo $MERCHANT_ID
echo $BATCH_SIZE
```

### Load from .env File

If using `.env` file:

```bash
# Check if .env exists
ls -la .env

# Load environment variables
source .env  # or
export $(cat .env | xargs)
```

---

## Getting Help

1. **Check logs**: Scripts output detailed error messages
2. **Review documentation**: See DATABASE_AUDIT.md and PHASE1_IMPLEMENTATION.md
3. **Test connection**: Use `psql` or Prisma CLI to test database connection
4. **Check database status**: Verify database is running and accessible

---

## Quick Diagnostic Commands

```bash
# 1. Check DATABASE_URL
echo $DATABASE_URL

# 2. Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# 3. Check Prisma connection
npx prisma db execute --stdin <<< "SELECT 1;"

# 4. List merchants (if connected)
psql $DATABASE_URL -c "SELECT id, name FROM \"Merchant\" LIMIT 5;"

# 5. Check product count (if connected)
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Product\" WHERE \"isActive\" = true;"
```










