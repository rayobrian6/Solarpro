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

// ── Auth Schemas ─────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().min(1, 'Full name is required.').transform(s => s.trim()),
  email: z.string().email('Valid email is required.').transform(s => s.toLowerCase().trim()),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  company: z.string().optional(),
  phone: z.string().optional(),
  tosAccepted: z.literal(true, { error: 'You must accept the Terms of Service and Confidentiality Agreement to create an account.' }),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required.').transform(s => s.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required.'),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email('Valid email is required.').transform(s => s.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

// ── Project / Client Schemas ─────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required.').transform(s => s.trim()),
  systemType: z.enum(['roof', 'ground', 'fence'], { error: 'systemType must be roof, ground, or fence' }),
  clientId: z.string().uuid().optional(),
  notes: z.string().optional(),
  address: z.string().optional(),
  stateCode: z.string().max(2).optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  zip: z.string().optional(),
  utilityName: z.string().optional(),
  utilityRatePerKwh: z.number().optional(),
  billData: z.any().optional(),
  systemSizeKw: z.number().optional(),
});

export const createClientSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').transform(s => s.trim()),
  email: z.string().email('Valid email address is required.').transform(s => s.toLowerCase().trim()),
  address: z.string().min(5, 'Full address is required.').transform(s => s.trim()),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  utilityProvider: z.string().optional(),
  monthlyKwh: z.number().optional(),
  annualKwh: z.number().optional(),
  averageMonthlyKwh: z.number().optional(),
  averageMonthlyBill: z.number().optional(),
  annualBill: z.number().optional(),
  utilityRate: z.number().optional(),
});

// ── Helper ───────────────────────────────────────────────────────────

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