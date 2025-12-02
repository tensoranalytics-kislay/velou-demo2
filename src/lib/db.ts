import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

/**
 * Check if we're in a build context where DATABASE_URL might not be available
 */
const isBuildTime = () => {
  const nextPhase = process.env.NEXT_PHASE;
  if (nextPhase === 'phase-production-build' || 
      nextPhase === 'phase-development-build' ||
      nextPhase === 'phase-export') {
    return true;
  }
  if (process.env.VERCEL === '1' && !process.env.VERCEL_ENV) {
    return true;
  }
  return false;
};

// During build, Prisma will still try to validate DATABASE_URL
// We need to provide a placeholder or handle it gracefully
const getPrismaConfig = () => {
  if (isBuildTime() && !process.env.DATABASE_URL) {
    // During build without DATABASE_URL, use a placeholder
    // Prisma will still validate the schema but won't connect
    return {
      datasources: {
        db: {
          url: 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
        },
      },
      log: [] as const, // No logging during build
    };
  }
  return {
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  };
};

export const prisma =
  global.prisma ??
  new PrismaClient(getPrismaConfig());

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

