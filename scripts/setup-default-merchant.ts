/**
 * Post-Migration Setup Script
 * 
 * This script should be run AFTER the multi-tenant migration to:
 * 1. Create a default admin user
 * 2. Create a default API key for widget embedding
 * 
 * Prerequisites:
 *   npm install bcryptjs @types/bcryptjs
 * 
 * Usage:
 *   npx tsx scripts/setup-default-merchant.ts
 * 
 * Environment Variables Required:
 *   - DATABASE_URL
 *   - DEFAULT_ADMIN_EMAIL (optional, defaults to admin@velou.local)
 *   - DEFAULT_ADMIN_PASSWORD (optional, will prompt if not set)
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { randomBytes } from 'crypto';
import * as readline from 'readline';

// Initialize Prisma client
let prisma: PrismaClient;

try {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
} catch (error) {
  console.error('❌ Failed to initialize Prisma client:', error);
  process.exit(1);
}

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter admin password: ', (password) => {
      rl.close();
      resolve(password);
    });
  });
}

async function generateApiKey(): Promise<string> {
  const randomPart = randomBytes(16).toString('hex');
  return `pk_live_${randomPart}`;
}

async function setupDefaultMerchant() {
  try {
    console.log('🔧 Setting up default merchant...\n');

    // Verify Prisma client is initialized
    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    // Find default merchant
    const defaultMerchant = await prisma.merchant.findUnique({
      where: { slug: 'default' },
    });

    if (!defaultMerchant) {
      console.error('❌ Default merchant not found. Please run the migration first.');
      process.exit(1);
    }

    console.log(`✓ Found default merchant: ${defaultMerchant.name} (${defaultMerchant.slug})\n`);

    // Check if admin user already exists
    const existingAdmin = await prisma.merchantUser.findFirst({
      where: {
        merchantId: defaultMerchant.id,
        role: 'ADMIN',
      },
    });

    if (existingAdmin) {
      console.log(`⚠️  Admin user already exists: ${existingAdmin.email}`);
      console.log('   Skipping admin user creation.\n');
    } else {
      // Create admin user
      const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@velou.local';
      let adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;

      if (!adminPassword) {
        console.log('No DEFAULT_ADMIN_PASSWORD set. Please enter admin password:');
        adminPassword = await promptPassword();
      }

      if (!adminPassword || adminPassword.length < 8) {
        console.error('❌ Password must be at least 8 characters');
        process.exit(1);
      }

      const passwordHash = await hashPassword(adminPassword);

      const adminUser = await prisma.merchantUser.create({
        data: {
          merchantId: defaultMerchant.id,
          email: adminEmail,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
        },
      });

      console.log(`✓ Created admin user: ${adminUser.email}`);
      console.log(`  User ID: ${adminUser.id}`);
      console.log(`  Role: ${adminUser.role}\n`);
    }

    // Check if API key already exists
    const existingApiKey = await prisma.apiKey.findFirst({
      where: {
        merchantId: defaultMerchant.id,
        isActive: true,
      },
    });

    if (existingApiKey) {
      console.log(`⚠️  Active API key already exists: ${existingApiKey.name}`);
      console.log(`   Token: ${existingApiKey.token.substring(0, 20)}...`);
      console.log('   Skipping API key creation.\n');
    } else {
      // Create default API key
      const apiKeyToken = await generateApiKey();
      const apiKey = await prisma.apiKey.create({
        data: {
          merchantId: defaultMerchant.id,
          name: 'Default Widget Key',
          token: apiKeyToken,
          allowedOrigins: ['localhost:3000', '127.0.0.1:3000'],
          isActive: true,
        },
      });

      console.log(`✓ Created API key: ${apiKey.name}`);
      console.log(`  Token: ${apiKey.token}`);
      console.log(`  Allowed Origins: ${apiKey.allowedOrigins.join(', ')}\n`);
    }

    console.log('✅ Default merchant setup complete!');
    console.log('\nNext steps:');
    console.log('1. Update application code to use Merchant instead of BrandConfig');
    console.log('2. Implement encryption for sensitive fields');
    console.log('3. Update all queries to include merchantId filters');
    console.log('4. Test multi-tenant data isolation');

  } catch (error) {
    console.error('❌ Error setting up default merchant:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupDefaultMerchant();

