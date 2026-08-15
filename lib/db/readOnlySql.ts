// ═══════════════════════════════════════════════════════════════════════════
// readOnlySql — WS-A: A READ PATH THAT CANNOT WRITE.
//
// WHY THIS EXISTS
// ──────────────────────────────────────────────────────────────────────────────
// The issued-package GET at app/api/engineering/permit/route.ts contained a
// "self-heal": whenever the stored artifact was older than the current engine
// version, a READ regenerated the planset and wrote it back over the issued one
// with `INSERT … ON CONFLICT DO UPDATE`. Because `generatePermitHTML`
// unconditionally re-resolves `project.date`, and because that value reaches the
// DIGESTED `meta.generatedAtIso`, merely LOOKING at an issued package on a later
// day changed its issue date, its snapshot digest, its snapshot id and its CERT
// Document ID — and a licensed engineering review, which is bound to the exact
// digest it approved, stopped covering the document it had approved.
//
// Deleting that block fixes today. It does not stop the next one: nothing in the
// architecture made a read INCAPABLE of writing, so the same mistake was always
// one convenience helper away. This module is that structural guarantee.
//
// WHAT IT IS
// A transparent wrapper around the Neon tagged-template client that classifies
// every statement before it reaches the database and THROWS on anything that is
// not a read. It is not advisory and it is not a lint rule: a write on a
// read-only handle fails loudly, in tests and in production alike.
//
// WHAT IT IS NOT
// It is not a substitute for a database-level read-only transaction, and it does
// not claim to be. It guards the ONE thing that actually went wrong — application
// code issuing a mutation from a read path — and it does so at the seam every
// route already passes through.
// ═══════════════════════════════════════════════════════════════════════════

/** Thrown when a read-only handle is asked to mutate. Never caught internally —
 *  a read path that writes is a defect, not a condition to recover from. */
export class ReadOnlyViolationError extends Error {
  readonly context: string;
  readonly statement: string;
  constructor(context: string, statement: string, verb: string) {
    super(
      `READ-ONLY VIOLATION in ${context}: attempted ${verb} on a read-only database handle. `
      + `An issued-package read must not mutate persisted state — route the write through an `
      + `explicit, authorized mutation workflow. Statement: ${statement}`,
    );
    this.name = 'ReadOnlyViolationError';
    this.context = context;
    this.statement = statement;
  }
}

/** Statement verbs that mutate. Checked against the FIRST keyword so a literal
 *  such as a column named "update" inside a SELECT cannot trip the guard. */
const MUTATING = [
  'INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'MERGE', 'TRUNCATE',
  'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'COMMENT',
  'REINDEX', 'VACUUM', 'REFRESH', 'CLUSTER', 'COPY', 'CALL', 'DO',
] as const;

/** Reads. Anything not in this set is refused — the guard fails CLOSED, so a
 *  statement shape nobody anticipated is rejected rather than waved through. */
const READING = ['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE', 'SET'] as const;

/** Strip comments and leading noise, then return the first SQL keyword. */
export function firstKeyword(sql: string): string {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/--[^\n]*/g, ' ')            // line comments
    .replace(/^[\s(;]+/, '');             // leading whitespace / parens / semicolons
  const m = /^([A-Za-z]+)/.exec(cleaned);
  return (m?.[1] ?? '').toUpperCase();
}

/**
 * Classify a statement. Returns the offending verb when the statement mutates,
 * or null when it is a read.
 *
 * A `WITH` statement is only a read when it contains no data-modifying branch:
 * PostgreSQL allows `WITH x AS (INSERT … RETURNING …) SELECT …`, which is a
 * write wearing a read's first keyword. That case is caught explicitly.
 */
export function mutatingVerb(sql: string): string | null {
  const kw = firstKeyword(sql);
  if (!kw) return null;                        // empty / whitespace — nothing to run
  if ((MUTATING as readonly string[]).includes(kw)) return kw;
  if (kw === 'WITH') {
    // a data-modifying CTE is a write no matter what the outer statement says
    const inner = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO)\b/i.exec(sql);
    if (inner) return inner[1].split(/\s+/)[0].toUpperCase();
  }
  if ((READING as readonly string[]).includes(kw)) return null;
  // Unknown shape ⇒ refuse. Fail closed.
  return kw;
}

/** The Neon tagged-template client shape this wraps. Deliberately structural
 *  and permissive: the wrapper is TRANSPARENT, so callers keep the exact type
 *  (and the exact row typing) they had before the guard was inserted. */
type SqlTag = (...args: never[]) => unknown;

/**
 * Wrap a SQL client so it can only read.
 *
 * Every tagged-template call is classified before dispatch. `transaction`,
 * `query` and any other mutation-capable member are removed rather than
 * wrapped — a read path has no legitimate use for them, and leaving them
 * reachable would leave the barrier with a hole in exactly the place a future
 * "ensure" helper would find it.
 *
 * @param sql      the live client from getDbReady()
 * @param context  a label used in the violation message (e.g. 'permit/GET')
 * @param onQuery  optional observer, for tests that count statements
 */
export function readOnlySql<T extends SqlTag>(
  sql: T,
  context: string,
  onQuery?: (statement: string) => void,
): T {
  const raw = sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown;
  const guarded = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = Array.isArray(strings) ? (strings as readonly string[]).join('?') : String(strings);
    const verb = mutatingVerb(statement);
    onQuery?.(statement);
    if (verb) {
      throw new ReadOnlyViolationError(context, statement.replace(/\s+/g, ' ').trim().slice(0, 240), verb);
    }
    return raw(strings, ...values);
  }) as unknown as T;

  // Deliberately NOT forwarded: transaction / query / unsafe / begin — a
  // read-only handle must not expose a second door to the database. This is the
  // door the four-statement equipment reconciliation walked through.
  const BLOCKED = new Set(['transaction', 'query', 'unsafe', 'begin', 'end', 'reserve']);
  for (const key of Object.keys(sql as unknown as object)) {
    if (BLOCKED.has(key)) continue;
    try {
      (guarded as unknown as Record<string, unknown>)[key] =
        (sql as unknown as Record<string, unknown>)[key];
    } catch { /* frozen */ }
  }
  for (const key of BLOCKED) {
    try {
      Object.defineProperty(guarded, key, {
        configurable: true,
        get() {
          throw new ReadOnlyViolationError(context, `sql.${key}(…)`, key.toUpperCase());
        },
      });
    } catch { /* non-configurable */ }
  }
  return guarded;
}
