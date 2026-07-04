# REF-MFA-002: Frontend MFA Integration Requirements

**Document ID:** REF-MFA-002  
**Category:** Reference — Frontend Engineering  
**Compliance Mapping:** POL-SEC-009 (Password & Authentication Policy), SOC 2 CC6.1  
**Last Updated:** July 2025  
**Status:** Implementation Required

---

## Overview

The SolarPro backend is fully wired for TOTP-based MFA, but the frontend does not yet handle the MFA login flow, MFA enrollment prompts, or session expiration scenarios. This document specifies exactly what React components need to be built or modified to complete the MFA integration.

Three API response codes were added to the login and middleware flows that the frontend must handle:

| Code | Source | HTTP Status | Meaning |
|------|--------|-------------|---------|
| `MFA_REQUIRED` | `/api/auth/login` | 200 | Password verified; MFA challenge issued. Show TOTP input. |
| `MFA_ENROLLMENT_REQUIRED` | `/api/auth/login` | 403 | User's role requires MFA but it's not enabled. Must enroll first. |
| `SESSION_EXPIRED` | Middleware (API routes) | 401 | Session exceeded timeout (8hr admin, 24hr others). Must re-login. |

Additionally, the middleware redirects page requests to `/auth/login?reason=session_expired` when a session times out on a protected page.

---

## 1. Login Page Modifications (`app/auth/login/page.tsx`)

### 1.1 Current State

The login page currently calls `attemptLogin()` which checks for `data.success`, `DB_STARTING`, `DB_CONFIG_ERROR`, and generic errors. It does NOT inspect the `code` field in the response body. When MFA is required, the backend returns `{ success: false, code: 'MFA_REQUIRED' }` with a 200 status, and the frontend treats this as a generic auth error.

### 1.2 Required Changes

Add a **MFA verification step** that appears after successful password validation when the backend returns `MFA_REQUIRED`. The flow is:

1. User submits email + password
2. Backend verifies password → returns `{ success: false, code: 'MFA_REQUIRED', mfa_method: 'totp' }` + sets `solarpro_mfa_pending` cookie
3. Frontend transitions to a TOTP code input UI (still on the login page, no navigation)
4. User enters 6-digit TOTP code
5. Frontend calls `POST /api/auth/mfa/verify` with `{ code: '123456' }`
6. Backend validates TOTP → issues full session cookie → returns `{ success: true }`
7. Frontend proceeds with the normal post-login redirect

### 1.3 Implementation Details

**State additions:**

```typescript
const [mfaRequired, setMfaRequired] = useState(false);
const [mfaCode, setMfaCode] = useState('');
const [mfaMethod, setMfaMethod] = useState<string>('totp');
const [mfaError, setMfaError] = useState('');
const [mfaLoading, setMfaLoading] = useState(false);
const [showRecoveryCode, setShowRecoveryCode] = useState(false);
const [recoveryCode, setRecoveryCode] = useState('');
```

**Modified `attemptLogin` return type:**

Add `'mfa_required'` to the return union type. After the existing `data.success` check, add:

```typescript
// MFA required — password was valid, but MFA challenge must be completed
if (data.code === 'MFA_REQUIRED') {
  return 'mfa_required';
}

// MFA enrollment required — role mandates MFA but user hasn't enrolled
if (data.code === 'MFA_ENROLLMENT_REQUIRED') {
  setError(data.error || 'MFA enrollment is required for your account.');
  return 'auth_error';
}
```

**Modified `handleAttemptResult`:**

```typescript
if (result === 'mfa_required') {
  setMfaRequired(true);
  setMfaMethod(data.mfa_method || 'totp'); // capture from response
  setLoading(false);
  return;
}
```

Note: You'll need to capture `data.mfa_method` from the login response before returning `'mfa_required'`. Consider storing it in a ref or returning it alongside the result type.

**MFA verification handler:**

```typescript
async function handleMFAVerify(e: React.FormEvent) {
  e.preventDefault();
  if (!mfaCode || mfaCode.length !== 6) {
    setMfaError('Please enter a 6-digit code.');
    return;
  }

  setMfaLoading(true);
  setMfaError('');

  try {
    const body = showRecoveryCode
      ? { recovery_code: recoveryCode }
      : { code: mfaCode };

    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // MFA verified — full session cookie is now set
      // If recovery code was used, user should re-enroll
      if (data.should_reenroll) {
        // Optionally show a brief message, then redirect
        // User should visit /settings/security to re-enroll
      }
      window.location.href = redirect;
    } else {
      setMfaError(data.error || 'Invalid verification code.');
    }
  } catch {
    setMfaError('Network error. Please try again.');
  } finally {
    setMfaLoading(false);
  }
}
```

**UI additions:**

When `mfaRequired === true`, replace the email/password form with a TOTP input form:

```tsx
{mfaRequired ? (
  <form onSubmit={handleMFAVerify} className="space-y-4">
    <div className="text-center mb-4">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
        <Shield size={24} className="text-amber-400" />
      </div>
      <h2 className="text-xl font-black text-white">Two-Factor Authentication</h2>
      <p className="text-slate-400 text-sm mt-1">
        Enter the code from your authenticator app.
      </p>
    </div>

    <div>
      <label className="block text-xs text-slate-400 mb-1.5 font-medium">
        Verification Code
      </label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={mfaCode}
        onChange={e => { setMfaCode(e.target.value.replace(/\D/g, '')); setMfaError(''); }}
        placeholder="000000"
        autoFocus
        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
      />
    </div>

    {mfaError && (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
        <p className="text-red-400 text-sm">{mfaError}</p>
      </div>
    )}

    <button
      type="submit"
      disabled={mfaLoading || mfaCode.length !== 6}
      className="w-full btn-primary py-3 text-base font-bold justify-center disabled:opacity-60"
    >
      {mfaLoading ? (<><span className="spinner w-4 h-4" /> Verifying…</>) : 'Verify'}
    </button>

    <button
      type="button"
      onClick={() => setShowRecoveryCode(!showRecoveryCode)}
      className="w-full text-sm text-slate-400 hover:text-slate-300 transition-colors"
    >
      {showRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
    </button>

    {showRecoveryCode && (
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-medium">Recovery Code</label>
        <input
          type="text"
          value={recoveryCode}
          onChange={e => { setRecoveryCode(e.target.value.trim()); setMfaError(''); }}
          placeholder="Enter recovery code"
          className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
        />
      </div>
    )}

    <button
      type="button"
      onClick={() => { setMfaRequired(false); setMfaCode(''); setMfaError(''); }}
      className="w-full text-sm text-slate-500 hover:text-slate-400 transition-colors mt-2"
    >
      ← Back to login
    </button>
  </form>
) : (
  // ... existing email/password form
)}
```

### 1.4 Session Expiration Handling

The middleware redirects to `/auth/login?reason=session_expired` when a page request has an expired session. Add this to the login page:

```typescript
useEffect(() => {
  const reason = searchParams.get('reason');
  if (reason === 'session_expired') {
    setError('Your session has expired. Please log in again.');
  }
}, [searchParams]);
```

For API routes, the middleware returns `{ code: 'SESSION_EXPIRED' }` with a 401 status. The frontend should check for this code in any API call and redirect to the login page:

```typescript
// Utility function for consistent session expiration handling
export function handleSessionExpired(response: Response) {
  if (response.status === 401) {
    // Check if it's a session expiration vs. general auth failure
    return response.clone().json().then(data => {
      if (data.code === 'SESSION_EXPIRED') {
        window.location.href = '/auth/login?reason=session_expired';
        return true;
      }
      return false;
    }).catch(() => false);
  }
  return Promise.resolve(false);
}
```

---

## 2. MFA Enrollment Flow (`/settings/security` or similar)

### 2.1 Two-Step Enrollment Process

The MFA setup endpoint (`/api/auth/mfa/setup`) uses a two-step process:

**Step 1 — POST `/api/auth/mfa/setup`** (generates secret + recovery codes):

Response:
```json
{
  "uri": "otpauth://totp/SolarPro:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=SolarPro&digits=6&algorithm=SHA1",
  "secret": "JBSWY3DPEHPK3PXP",
  "recovery_codes": ["abc123-def", "ghi456-jkl", ...],
  "message": "Scan the QR code with your authenticator app, then verify with a code to complete setup."
}
```

**Step 2 — PUT `/api/auth/mfa/setup`** (verifies first code to activate MFA):

Request:
```json
{ "code": "123456" }
```

Response:
```json
{
  "success": true,
  "message": "MFA has been enabled for your account."
}
```

### 2.2 Enrollment UI Requirements

1. **QR Code Display**: Convert the `otpauth://` URI to a QR code. Use a library like `qrcode.react` or render via an SVG QR code generator. The QR code should be displayed alongside the manual secret (`secret` field) for users who can't scan.

2. **Recovery Code Display**: Show the 8 recovery codes in a clearly labeled section. Add a "Download" button that saves them as a text file, and a "Copy All" button. Display a prominent warning: "Save these recovery codes in a secure location. They will not be shown again."

3. **Verification Input**: After the user scans the QR code, show a 6-digit input field. On submit, call `PUT /api/auth/mfa/setup` with `{ code }`.

4. **Success Confirmation**: On successful verification, show a confirmation message and update the user context to reflect `mfa_enabled: true`.

### 2.3 Enrollment Required Redirect

When the login endpoint returns `MFA_ENROLLMENT_REQUIRED` (403), the user should be redirected to a page where they can enroll in MFA before they can access the application. Options:

- **Option A**: Redirect to `/settings/security` with a banner: "MFA enrollment is required for your account. Please set up two-factor authentication to continue."
- **Option B**: Show an inline enrollment flow on the login page itself (similar to the MFA verify flow above).

Option B is recommended because the user doesn't have a full session yet — they've only passed password verification. The enrollment endpoint requires an active session (`getUserFromRequest`), so we need to issue a temporary session for enrollment.

**IMPORTANT**: The current `POST /api/auth/mfa/setup` requires an authenticated session. The `MFA_ENROLLMENT_REQUIRED` response does NOT issue a session cookie. To make enrollment work from the login page, one of these changes is needed:

1. **Preferred**: Issue an MFA pending token (like `MFA_REQUIRED` does) but with a flag like `mfa_enrollment: true`, then modify the setup route to accept MFA pending tokens in addition to regular sessions.
2. **Alternative**: Issue a short-lived session cookie with a `must_enroll_mfa` flag that the middleware allows through to the setup route but blocks all other routes.

Until this backend change is made, `MFA_ENROLLMENT_REQUIRED` should display the error message and instruct the user to contact their administrator or log in from a device that already has access.

---

## 3. Session Timeout UX

### 3.1 Proactive Timeout Warning

The middleware enforces session timeouts at 8 hours (admin/staff) and 24 hours (homeowners). To provide a better UX, add a proactive warning before expiration:

- Track the session `iat` (issued-at) timestamp from the JWT, available via `/api/auth/me` response
- Show a warning toast/banner 5 minutes before expiration: "Your session will expire in 5 minutes. Click to extend."
- A "Refresh Session" button can call `/api/auth/me` which issues a refreshed JWT (if this behavior is implemented)

### 3.2 Expired Session Redirect

When the middleware detects an expired session:
- **Page requests**: Redirects to `/auth/login?reason=session_expired`
- **API requests**: Returns `{ error: "Session expired", code: "SESSION_EXPIRED" }` with 401

The frontend should handle both cases gracefully with clear messaging that the session timed out (not that there was an error).

---

## 4. Complete API Contract Summary

### Login Flow

```
POST /api/auth/login
  Body: { email, password }
  Response (no MFA):     { success: true, data: { user } } + Set-Cookie: solarpro_session
  Response (MFA required): { success: false, code: "MFA_REQUIRED", mfa_method: "totp" } + Set-Cookie: solarpro_mfa_pending
  Response (MFA enrollment): { success: false, code: "MFA_ENROLLMENT_REQUIRED", error: "..." } (403)
  Response (invalid):    { success: false, error: "Invalid email or password." } (401)
  Response (rate limit): { success: false, error: "Too many login attempts..." } (429)
```

### MFA Verify Flow

```
POST /api/auth/mfa/verify
  Requires: solarpro_mfa_pending cookie (set by login when MFA_REQUIRED)
  Body: { code: "123456" } OR { recovery_code: "abc123-def" }
  Response (success): { success: true, data: { user } } + Set-Cookie: solarpro_session + Clear-Cookie: solarpro_mfa_pending
  Response (recovery): { success: true, should_reenroll: true, data: { user } } + Set-Cookie: solarpro_session + Clear-Cookie: solarpro_mfa_pending
  Response (invalid): { error: "Invalid verification code" } (400)
  Response (expired): { error: "MFA session expired. Please log in again." } (401)
  Response (rate limit): { error: "Rate limit exceeded" } (429)
```

### MFA Setup Flow

```
POST /api/auth/mfa/setup        (Step 1 — generate secret)
  Requires: solarpro_session cookie
  Response: { uri, secret, recovery_codes, message }

PUT /api/auth/mfa/setup         (Step 2 — verify and enable)
  Requires: solarpro_session cookie
  Body: { code: "123456" }
  Response (success): { success: true, message: "MFA has been enabled..." }
  Response (invalid): { error: "Invalid verification code" } (400)
```

---

## 5. Cookie Summary

| Cookie Name | Purpose | Max Age | Path | Set By |
|---|---|---|---|---|
| `solarpro_session` | Full authenticated session | 7 days | `/` | Login, MFA verify |
| `solarpro_mfa_pending` | Temporary MFA challenge token | 5 minutes | `/api/auth/mfa` | Login (when MFA required) |

Both cookies are `httpOnly`, `secure` (in production), and `sameSite: lax`.

---

## 6. Recommended Implementation Order

1. Add `MFA_REQUIRED` handling to login page (highest impact — unblocks MFA-enrolled users)
2. Add session expiration detection and redirect
3. Build MFA enrollment page under `/settings/security`
4. Add `MFA_ENROLLMENT_REQUIRED` handling (requires backend change for sessionless enrollment)
5. Add proactive session timeout warning

---

## 7. Libraries and Dependencies

- **QR Code**: `qrcode.react` (lightweight, React-native QR rendering) — `npm install qrcode.react`
- **No other new dependencies needed** — TOTP input is a standard 6-digit text field

---

## 8. Testing Checklist

After implementing frontend MFA, verify:

- [ ] Login with MFA-disabled user → direct to dashboard (no MFA prompt)
- [ ] Login with MFA-enabled user → show TOTP input → valid code → dashboard
- [ ] Login with MFA-enabled user → show TOTP input → invalid code → error message
- [ ] Login with MFA-enabled user → use recovery code → success → should_reenroll banner
- [ ] Login with MFA-required-role but MFA not enabled → MFA_ENROLLMENT_REQUIRED message
- [ ] Session expiration on page → redirect to login with "session expired" message
- [ ] Session expiration on API call → 401 with SESSION_EXPIRED code → redirect to login
- [ ] MFA pending token expiry (5 min) → "MFA session expired" → back to login
- [ ] Rate limiting on MFA verify → 429 after 10 attempts in 5 minutes
