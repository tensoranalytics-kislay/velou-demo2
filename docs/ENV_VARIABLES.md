# Environment Variables Reference

## Required Environment Variables

Add these to your `.env` file in the project root:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/velou"

# LLM Configuration
LLM_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
PRIMARY_LLM_MODEL="gpt-4.1"
REASONING_LLM_MODEL="o3-mini"
LIGHT_LLM_MODEL="gpt-4.1-mini"

# JWT Authentication (NEW - Required for Phase 0.2)
# Generate secrets with: openssl rand -base64 32
# Must be at least 32 characters long
JWT_SECRET="your-32-character-or-longer-secret-here"
REFRESH_TOKEN_SECRET="your-32-character-or-longer-refresh-secret-here"

# Node Environment
NODE_ENV="development"
```

## Generating JWT Secrets

### Using OpenSSL (Recommended)

```bash
# Generate JWT_SECRET
openssl rand -base64 32

# Generate REFRESH_TOKEN_SECRET
openssl rand -base64 32
```

### Using Node.js

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Security Notes

- **Never commit `.env` file to version control**
- **Use different secrets for development and production**
- **Secrets must be at least 32 characters long**
- **Rotate secrets periodically in production**

## Validation

The application will throw an error on startup if:
- `JWT_SECRET` is missing or less than 32 characters
- `REFRESH_TOKEN_SECRET` is missing or less than 32 characters

Error message:
```
JWT_SECRET must be set and at least 32 characters long. 
Generate with: openssl rand -base64 32
```

