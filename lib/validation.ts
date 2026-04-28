/**
 * Input validation schemas using Zod.
 * Centralized schemas for API route input validation.
 * 
 * Usage:
 *   import { registerSchema, parseBody } from '@/lib/validation';
 *   const result = registerSchema.safeParse(body);
 *   // or use the helper:
 *   const { data, error } = parseBody(registerSchema, body);
 */
import { z } from 'zod';

// ── Auth Schemas ──────────────────────────────────────────────────────────────

// SECURITY: bcrypt silently truncates at 72 bytes. Some bcrypt wrappers hash
// the full input before truncating, causing CPU exhaustion on very long strings
// (bcrypt DoS). Reject passwords > 1000 chars before calling bcrypt.hash() or
// bcrypt.compare(). 1000 chars is well above any legitimate password length and
// safely below the range where bcrypt becomes expensive.
const PASSWORD_MAX = 1000;
const EMAIL_MAX    = 320; // RFC 5321 maximum email length

export const registerSchema = z.object({
  name: z.string().min(1, 'Full name is required.').max(200, 'Name too long.').transform(s => s.trim()),
  email: z.string().email('Valid email is required.').max(EMAIL_MAX, 'Email too long.').transform(s => s.toLowerCase().trim()),
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .max(PASSWORD_MAX, 'Password too long.'),
  company: z.string().max(200, 'Company name too long.').optional(),
  phone: z.string().max(30, 'Phone number too long.').optional(),
  tosAccepted: z.literal(true, { error: 'You must accept the Terms of Service and Confidentiality Agreement to create an account.' }),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required.').max(EMAIL_MAX, 'Email too long.').transform(s => s.toLowerCase().trim()),
  // SECURITY: bcrypt DoS — reject passwords > 1000 chars before hashing
  password: z.string()
    .min(1, 'Password is required.')
    .max(PASSWORD_MAX, 'Password too long.'),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email('Valid email is required.').max(EMAIL_MAX, 'Email too long.').transform(s => s.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.').max(512, 'Invalid token.'),
  // SECURITY: bcrypt DoS — reject passwords > 1000 chars before hashing
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .max(PASSWORD_MAX, 'Password too long.'),
});

// ── Project / Client Schemas ───────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required.').max(200, 'Project name too long.').transform(s => s.trim()),
  systemType: z.enum(['roof', 'ground', 'fence'], { error: 'systemType must be roof, ground, or fence' }),
  clientId: z.string().uuid().optional(),
  notes: z.string().max(5000, 'Notes too long.').optional(),
  address: z.string().max(500, 'Address too long.').optional(),
  stateCode: z.string().max(2).optional(),
  city: z.string().max(200, 'City too long.').optional(),
  county: z.string().max(200, 'County too long.').optional(),
  zip: z.string().max(20, 'ZIP too long.').optional(),
  utilityName: z.string().max(200, 'Utility name too long.').optional(),
  utilityRatePerKwh: z.number().optional(),
  billData: z.any().optional(),
  systemSizeKw: z.number().optional(),
});

export const createClientSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').max(200, 'Name too long.').transform(s => s.trim()),
  email: z.string().email('Valid email address is required.').max(EMAIL_MAX, 'Email too long.').transform(s => s.toLowerCase().trim()),
  address: z.string().min(5, 'Full address is required.').max(500, 'Address too long.').transform(s => s.trim()),
  phone: z.string().max(30, 'Phone too long.').optional(),
  city: z.string().max(200, 'City too long.').optional(),
  state: z.string().max(100, 'State too long.').optional(),
  zip: z.string().max(20, 'ZIP too long.').optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  utilityProvider: z.string().max(200, 'Utility provider too long.').optional(),
  monthlyKwh: z.number().optional(),
  annualKwh: z.number().optional(),
  averageMonthlyKwh: z.number().optional(),
  averageMonthlyBill: z.number().optional(),
  annualBill: z.number().optional(),
  utilityRate: z.number().optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns { data, error } — if error is non-null, return it as a 400 response.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown
): { data: z.infer<T> | null; error: string | null } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { data: result.data, error: null };
  }
  // Extract the first human-readable error message
  const firstIssue = result.error.issues[0];
  const msg = firstIssue?.message || 'Invalid input';
  return { data: null, error: msg };
}