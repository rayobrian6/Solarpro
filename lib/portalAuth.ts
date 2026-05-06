/**
 * portalAuth.ts
 * Lightweight, read-only auth for the homeowner portal.
 *
 * Completely separate from the main solarpro_session (SolarPro user auth).
 * Portal sessions contain: clientId, email, name.
 * Signed with the same JWT_SECRET — no new secret needed.
 */
import jwt from 'jsonwebtoken';

export const PORTAL_COOKIE_NAME = 'solarpro_portal_session';
export const PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface PortalSession {
  clientId: string;
  email: string;
  name: string;
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signPortalToken(session: PortalSession): string {
  return jwt.sign(session, getJwtSecret(), {
    expiresIn: '7d',
    subject: 'portal',
  });
}

export function verifyPortalToken(token: string): PortalSession | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      subject: 'portal',
    }) as Record<string, any>;
    if (!decoded?.clientId || !decoded?.email) return null;
    return {
      clientId: String(decoded.clientId),
      email:    String(decoded.email),
      name:     String(decoded.name ?? decoded.email),
    };
  } catch {
    return null;
  }
}

export function makePortalCookie(token: string): string {
  const expires = new Date(Date.now() + PORTAL_COOKIE_MAX_AGE * 1000).toUTCString();
  const secure  = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PORTAL_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expires}`;
}

export function clearPortalCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PORTAL_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

/** Read portal session from a Request object (works in API routes and middleware) */
export function getPortalSession(req: Request | { headers: { get(name: string): string | null } }): PortalSession | null {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${PORTAL_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyPortalToken(match[1]);
}