import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

// Lazy getter — only throws at runtime, NOT at build time
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return secret;
}

export const COOKIE_NAME = 'solarpro_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getDb() {
  const url = process.env.DATABASE_URL!;
  return neon(url);
}

// ── Password helpers ──────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT / Session ─────────────────────────────────────────────────────────────
// JWT contains ONLY identity — id, name, email, company.
// Role is NEVER stored in the JWT. Always fetch from DB.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  company?: string;
  // role intentionally omitted — always read from DB
}

export function signToken(user: SessionUser): string {
  // Only sign identity fields — no role
  const payload: SessionUser = {
    id:      user.id,
    name:    user.name,
    email:   user.email,
    company: user.company,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionUser;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
export function makeSessionCookie(token: string): string {
  const expires = new Date(Date.now() + COOKIE_MAX_AGE * 1000).toUTCString();
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Get current user from request cookies ────────────────────────────────────
export function getUserFromRequest(req: Request): SessionUser | null {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}