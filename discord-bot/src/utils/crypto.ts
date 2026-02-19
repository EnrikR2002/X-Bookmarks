/**
 * AES-256-GCM encryption utilities for storing X auth tokens
 */

import crypto from 'crypto';

/**
 * Encrypts a string using AES-256-GCM.
 * Returns: IV (32 hex) + AuthTag (32 hex) + Ciphertext (variable hex)
 */
export function encryptToken(plaintext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be exactly 64 hex characters (32 bytes)');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex');
}

/**
 * Decrypts a string encrypted with encryptToken()
 */
export function decryptToken(ciphertext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be exactly 64 hex characters (32 bytes)');
  }

  const iv = Buffer.from(ciphertext.slice(0, 32), 'hex');
  const authTag = Buffer.from(ciphertext.slice(32, 64), 'hex');
  const encrypted = Buffer.from(ciphertext.slice(64), 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}
