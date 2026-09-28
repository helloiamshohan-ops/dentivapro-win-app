import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Offline verifier only; fixed-code activation cannot resist reverse engineering.
const activationSalt = Buffer.from('d2a4c781934d5f6bc879a0d1e4632f08', 'hex');
const activationDigest = Buffer.from('f055451152dff4267faf88c1debb7317fe6467c8ef48589cd34a256e2b99b772', 'hex');
const options = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export function activationMatches(input: string): boolean {
  const calculated = scryptSync(input, activationSalt, 32, options);
  return timingSafeEqual(calculated, activationDigest);
}
export function hashPassword(password: string): string {
  if (password.length < 12 || password.length > 256) throw new Error('Password must contain 12–256 characters.');
  const salt = randomBytes(16);
  return `scrypt-v1:${salt.toString('hex')}:${scryptSync(password, salt, 64, options).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(parts[1], 'hex'), 64, options), Buffer.from(parts[2], 'hex'));
}
