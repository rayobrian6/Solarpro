/**
 * lib/http/userFacingError.ts
 *
 * WHAT A PERSON IS TOLD WHEN A REQUEST FAILS — AND WHAT THEY ARE NOT.
 *
 * 🚨 THE PRODUCT WAS PASTING RAW SERVER BODIES INTO TOASTS.
 *
 * Two call sites did `toast.error(... ${errText.slice(0, 200)})` with the
 * response body verbatim. When the server returns a deliberate message that is
 * fine — it was written for the user. When it returns an HTML error page, a
 * stack trace or a database driver's complaint, the installer gets 200
 * characters of someone else's internals and no idea what to do.
 *
 * A competitor-failure audit catalogued exactly this in rival products — one
 * shows users a literal Python `TypeError` — and then found the same shape in
 * our own code. It is a small thing that does disproportionate damage: a person
 * who sees a stack trace stops believing the rest of the screen.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A deliberate message is shown. Anything else is summarised by its status, and
 * the raw text is returned SEPARATELY so the caller can log it. Nothing is
 * discarded — diagnosis still works, it just does not happen in a toast.
 */

export interface UserFacingError {
  /** Safe to show. Always a complete sentence, never empty. */
  message: string;
  /** The raw body, for the console or an audit log. May be empty. */
  detail: string;
  /** True when `message` came from the server rather than from the status. */
  fromServer: boolean;
}

/** Status-shaped sentences, for when the body is not something to show. */
function sentenceFor(status: number): string {
  if (status === 0)   return 'Could not reach the server. Check your connection and try again.';
  if (status === 401) return 'Your session has expired. Sign in again and retry.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That was not found — it may have been deleted or renamed.';
  if (status === 409) return 'This was refused because the underlying data changed. Reload and try again.';
  if (status === 413) return 'That request was too large to process.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status === 504 || status === 408) return 'The server took too long to respond. Try again.';
  if (status >= 500)  return 'The server hit an unexpected problem. Nothing was changed. Try again, and report it if it persists.';
  if (status >= 400)  return 'The request was rejected.';
  return 'Something went wrong.';
}

/**
 * Does this body look like something a HUMAN was meant to read?
 *
 * Conservative on purpose: when in doubt it is treated as internal and
 * withheld. Showing one fewer useful message costs a support question; showing
 * one stack trace costs the user's confidence in everything else on screen.
 */
function looksInternal(body: string): boolean {
  const s = body.trim();
  if (!s) return true;
  if (s.startsWith('<')) return true;                       // an HTML error page
  if (/^\s*at\s+\S+.*:\d+:\d+/m.test(s)) return true;       // a stack frame
  if (/\b(Traceback|TypeError|ReferenceError|ECONNREFUSED|ETIMEDOUT|SyntaxError)\b/.test(s)) return true;
  if (/\b(select|insert|update|delete)\s+.*\bfrom\b/i.test(s)) return true;  // leaked SQL
  // 🚨 DATABASE DRIVER TEXT — the commonest leak of all, and the one this
  // function missed on its first pass. A route that pipes a Postgres error
  // into its `error` field produces a JSON body that looks deliberate: it is
  // short, it is not HTML, it has no stack frame. It is still the schema
  // talking to a roofer.
  if (/^error:\s/i.test(s)) return true;                    // node-postgres prefixes with this
  if (/\b(relation|column|constraint|schema|role)\b[^\n]{0,80}\bdoes not exist\b/i.test(s)) return true;
  if (/\bduplicate key value\b|\bviolates .{0,40}constraint\b|\bdeadlock detected\b/i.test(s)) return true;
  if (/\b(ENOTFOUND|EHOSTUNREACH|ERR_[A-Z_]+|PGRST\d+|SQLSTATE)\b/.test(s)) return true;
  if (s.length > 300) return true;                          // nobody writes a 300-char toast on purpose
  return false;
}

/**
 * Turn a failed response into something worth showing.
 *
 * @param status   the HTTP status (0 for a network failure)
 * @param rawBody  the response body as text; may be empty
 * @param action   what the user was doing, e.g. 'Permit generation'
 */
export function userFacingServerError(
  status: number,
  rawBody: string | null | undefined,
  action?: string,
): UserFacingError {
  const raw = typeof rawBody === 'string' ? rawBody : '';
  const prefix = action ? `${action} failed` : 'That failed';

  // A JSON body with an `error`/`message` field is a message the server CHOSE
  // to send. Those are written for this situation and are the most useful thing
  // we can show — but they are still checked, because a route that forwards a
  // driver error into `error` is common.
  let chosen = '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = parsed?.error ?? parsed?.message;
    if (typeof candidate === 'string' && candidate.trim()) chosen = candidate.trim();
  } catch { /* not JSON — fall through */ }

  if (chosen && !looksInternal(chosen)) {
    return { message: `${prefix}: ${chosen}`, detail: raw, fromServer: true };
  }

  return {
    message: `${prefix} (${status}). ${sentenceFor(status)}`,
    detail: raw,
    fromServer: false,
  };
}
