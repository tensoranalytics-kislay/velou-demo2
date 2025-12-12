/**
 * Password Hashing and Verification
 * 
 * Uses bcryptjs for secure password hashing with salt rounds.
 * 
 * Security Notes:
 * - Salt rounds: 12 (good balance of security and performance)
 * - Never log passwords or hashes
 * - Use constant-time comparison (bcrypt handles this)
 */

import bcrypt from 'bcryptjs';

/**
 * Number of salt rounds for bcrypt hashing
 * 12 rounds = ~300ms hash time (good security/performance balance)
 */
const SALT_ROUNDS = 12;

/**
 * Hash a plain text password
 * 
 * @param password - Plain text password (will be hashed)
 * @returns Promise resolving to bcrypt hash string
 * @throws Error if hashing fails
 * 
 * Example:
 *   const hash = await hashPassword('mySecurePassword123');
 *   // Store hash in database
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error) {
    throw new Error('Failed to hash password');
  }
}

/**
 * Verify a plain text password against a bcrypt hash
 * 
 * @param password - Plain text password to verify
 * @param hash - bcrypt hash from database
 * @returns Promise resolving to true if password matches, false otherwise
 * @throws Error if verification fails (not just mismatch)
 * 
 * Example:
 *   const isValid = await verifyPassword('mySecurePassword123', storedHash);
 *   if (isValid) {
 *     // Password is correct
 *   }
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    const isValid = await bcrypt.compare(password, hash);
    return isValid;
  } catch (error) {
    // Log error but don't expose details to caller
    console.error('Password verification error:', error);
    return false;
  }
}


