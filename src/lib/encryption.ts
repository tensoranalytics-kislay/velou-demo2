/**
 * Encryption Utility
 * 
 * Provides encryption/decryption for sensitive fields like:
 * - API keys
 * - OAuth tokens
 * - Passwords (hashing is separate, this is for storage encryption)
 * 
 * Uses AES-256-GCM for authenticated encryption.
 * 
 * Security Notes:
 * - Encryption key must be 32 bytes (256 bits)
 * - Each encrypted value includes IV and auth tag
 * - Encryption key should be stored in environment variable
 * - Key rotation requires re-encrypting all values
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Get encryption key from environment
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.warn(
    'ENCRYPTION_KEY not set. Encryption will fail. ' +
    'Generate with: openssl rand -base64 32'
  );
}

// Algorithm configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Derive encryption key from password using scrypt
 * 
 * @param password - Base password/key
 * @param salt - Salt for key derivation
 * @returns Derived key
 */
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
}

/**
 * Encrypt a plain text value
 * 
 * @param plaintext - Value to encrypt
 * @returns Encrypted value (base64 encoded: salt:iv:tag:ciphertext)
 * @throws Error if encryption fails or key not configured
 * 
 * Format: base64(salt) + ':' + base64(iv) + ':' + base64(tag) + ':' + base64(ciphertext)
 */
export async function encrypt(plaintext: string): Promise<string> {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  if (!plaintext) {
    return plaintext; // Don't encrypt empty strings
  }

  try {
    // Generate salt and IV
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // Derive key from password and salt
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Create cipher
    const cipher = createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get auth tag
    const tag = cipher.getAuthTag();

    // Combine: salt:iv:tag:ciphertext (all base64)
    const result = [
      salt.toString('base64'),
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');

    return result;
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypt an encrypted value
 * 
 * @param encrypted - Encrypted value (from encrypt function)
 * @returns Decrypted plain text
 * @throws Error if decryption fails, key not configured, or value is invalid
 */
export async function decrypt(encrypted: string): Promise<string> {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  if (!encrypted || !encrypted.includes(':')) {
    // Not encrypted or invalid format, return as-is
    return encrypted;
  }

  try {
    // Parse: salt:iv:tag:ciphertext
    const parts = encrypted.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted format');
    }

    const [saltBase64, ivBase64, tagBase64, ciphertextBase64] = parts;

    // Decode from base64
    const salt = Buffer.from(saltBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    // Derive key
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if a value is encrypted
 * 
 * @param value - Value to check
 * @returns true if value appears to be encrypted
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  // Encrypted values have format: base64:base64:base64:base64
  return value.includes(':') && value.split(':').length === 4;
}

/**
 * Example usage:
 * 
 * ```typescript
 * import { encrypt, decrypt } from '@/lib/encryption';
 * 
 * // Encrypt before storing
 * const encryptedToken = await encrypt(accessToken);
 * await prisma.merchant.update({
 *   where: { id: merchantId },
 *   data: { shopifyAccessToken: encryptedToken },
 * });
 * 
 * // Decrypt when reading
 * const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
 * if (merchant?.shopifyAccessToken) {
 *   const accessToken = await decrypt(merchant.shopifyAccessToken);
 *   // Use accessToken...
 * }
 * ```
 */


