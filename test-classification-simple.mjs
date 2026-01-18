/**
 * Simple test script to verify constraint extraction with LLM
 * Uses ESM to load environment variables properly
 */

import { readFileSync } from 'fs';

// Load .env file manually
const envContent = readFileSync('.env', 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=][^=]*?)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim();
    // Remove quotes if present
    const cleanValue = value.replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) {
      process.env[key] = cleanValue;
    }
  }
});

// Now import the actual test (will be transpiled by tsx)
import('./test-classification-extraction.ts');
