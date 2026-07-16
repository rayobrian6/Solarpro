/**
 * Neon Serverless Driver Mock — pg-backed compatibility shim for local testing.
 *
 * Phase 1A.3 (GOV-19, GOV-22): The production code imports `neon` from
 * `@neondatabase/serverless` and uses tagged template literals to execute SQL
 * against the database. The Neon serverless driver communicates via HTTP/
 * WebSocket (fetch-based), which CANNOT connect to a standard local PostgreSQL
 * instance over TCP. This makes end-to-end testing of the migration governance
 * subsystem against a local PostgreSQL test database impossible without a shim.
 *
 * This mock module provides a drop-in replacement for the `neon()` function
 * that is backed by the `pg` (node-postgres) Pool. It implements both calling
 * conventions that the production code uses:
 *
 *   1. Tagged template literal (most common):
 *      const sql = neon(connectionString);
 *      const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 *   2. Function-call mode (used for dynamic SQL strings in transactions):
 *      await sql.transaction((txn) => [
 *        ...statements.map((stmt) => txn(stmt, [])),
 *      ]);
 *
 * The shim handles:
 * - Both tagged template and function-call query modes
 * - The `.transaction()` method (sequential query execution in a transaction)
 * - Array-mode and full-results options (returned as plain arrays/objects)
 * - Connection pooling via pg.Pool with proper cleanup on error
 *
 * This mock is used by the Phase 1A.3 e2e test harness via Vitest's
 * `vi.mock('@neondatabase/serverless')` to route all database operations
 * through the local PostgreSQL test database.
 *
 * IMPORTANT: This is a TEST-ONLY module. It is never imported in production
 * code. It exists solely to enable the migration governance e2e test suite
 * to exercise the canonical runner, ledger, and audit code paths against a
 * real (local, isolated) PostgreSQL instance without requiring a Neon
 * serverless endpoint.
 *
 * STATE SHARING: Vitest's vi.mock() factory evaluates this module in a
 * separate module graph from the test file's own dynamic imports. To ensure
 * the pool and schema state are shared across all module evaluations, we
 * store them on `globalThis` rather than module-level variables. This way,
 * setTestSchema() called from the test's beforeAll() affects the same state
 * that the vi.mock() factory's neon() function reads.
 */

import { Pool, PoolClient, QueryResult } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Global State (shared across module evaluations via globalThis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal type for the shared state stored on globalThis.
 */
interface NeonMockState {
  pool: Pool | null;
  testSchema: string | null;
}

/**
 * Symbol key for the shared state on globalThis.
 */
const STATE_KEY = Symbol.for('__neonMockState__');

/**
 * Get the shared mock state from globalThis, creating it if necessary.
 * This ensures that all module evaluations of this file share the same
 * pool and schema state, even across vi.mock() boundaries.
 */
function getSharedState(): NeonMockState {
  if (!(globalThis as Record<symbol, unknown>)[STATE_KEY]) {
    (globalThis as Record<symbol, unknown>)[STATE_KEY] = {
      pool: null,
      testSchema: null,
    } as NeonMockState;
  }
  return (globalThis as Record<symbol, unknown>)[STATE_KEY] as NeonMockState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Pool Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the test schema for search_path isolation. All subsequent queries
 * will use `<schema>,public` as the search_path. This ensures unqualified
 * table names (used by the production ledger/runner code) resolve to the
 * isolated test schema.
 *
 * If the pool was already created without a schema, it is closed and
 * recreated with the schema's search_path option.
 *
 * @param schema The schema name to use (e.g. 'phase1a3_e2e_test').
 */
export function setTestSchema(schema: string | null): void {
  const state = getSharedState();
  const oldSchema = state.testSchema;
  state.testSchema = schema;

  // If the schema changed and a pool already exists, close and recreate it
  // so the new pool picks up the search_path option.
  if (state.pool && oldSchema !== schema) {
    state.pool.end().catch(() => {
      // Best-effort close — ignore errors.
    });
    state.pool = null;
  }
}

/**
 * Get or create the shared pg Pool.
 *
 * The pool is initialized from `TEST_DATABASE_URL` (or `DATABASE_URL` if
 * `TEST_DATABASE_URL` is not set). If no URL is available, the pool is not
 * created and all queries will throw — callers should check for the
 * environment variable before using the mock.
 *
 * If the test schema is set, the pool's `options` parameter is configured with
 * `search_path=<schema>,public` so that all connections use the isolated
 * test schema by default.
 */
function getPool(): Pool {
  const state = getSharedState();
  if (!state.pool) {
    const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
    if (!url) {
      throw new Error(
        '[neon-serverless-mock] No TEST_DATABASE_URL or DATABASE_URL set. ' +
          'Cannot create pg Pool for local testing.',
      );
    }
    const poolConfig: {
      connectionString: string;
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
      options?: string;
    } = {
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
    if (state.testSchema) {
      poolConfig.options = `-c search_path=${state.testSchema},public`;
    }
    state.pool = new Pool(poolConfig);
  }
  return state.pool;
}

/**
 * Close the shared pool and reset the schema. Called by test cleanup hooks.
 * Uses a timeout to prevent hanging if connections are stuck.
 */
export async function closePool(): Promise<void> {
  const state = getSharedState();
  if (state.pool) {
    // Close the pool with a timeout to prevent hanging.
    await Promise.race([
      state.pool.end(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    state.pool = null;
  }
  state.testSchema = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Resolution: Tagged Template + Function-Call Modes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a SQL string with numbered placeholders from a tagged template.
 *
 * Neon's tagged template converts `${value}` interpolations into `$1, $2, ...`
 * bind parameters. This function replicates that transformation.
 */
function buildParameterizedQuery(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }

  return { text: text.trim(), params };
}

/**
 * Resolve a query from either tagged template mode or function-call mode.
 *
 * The Neon driver supports two calling conventions:
 *
 * 1. Tagged template:  sql`SELECT * FROM t WHERE id = ${value}`
 *    - `strings` is a TemplateStringsArray (array of string segments)
 *    - `values` is an array of interpolated values: [value]
 *    - We convert ${value} → $1 using buildParameterizedQuery
 *
 * 2. Function-call:    sql('SELECT * FROM t WHERE id = $1', [value])
 *    - `strings` is a plain string (the query text with $1, $2, ... placeholders)
 *    - `values` is [[value]] (rest params wrapping the params array)
 *    - We use strings as text and values[0] as the params array
 *
 * The production code uses BOTH modes:
 * - Tagged template for most queries: sql`SELECT ... WHERE id = ${id}`
 * - Function-call for dynamic SQL in transactions: txn(stmt, [])
 *   where stmt is a string from BOOTSTRAP_LEDGER_DDL.split(';')
 *
 * This function detects the mode by checking if `strings` is a string
 * (function-call mode) or a TemplateStringsArray (tagged template mode).
 */
function resolveQuery(
  strings: TemplateStringsArray | string,
  values: unknown[],
): { text: string; params: unknown[] } {
  if (typeof strings === 'string') {
    // Function-call mode: sql('SELECT $1', [value]) or txn(stmt, params)
    // In this mode, the first argument is the query text (with $1, $2, ...
    // placeholders already in place), and the first element of the rest
    // params is the parameter array.
    const rawParams = values[0];
    return {
      text: strings.trim(),
      params: Array.isArray(rawParams) ? (rawParams as unknown[]) : [],
    };
  }
  // Tagged template mode: sql`SELECT ${value}`
  return buildParameterizedQuery(strings, values);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tagged Template / Function-Call SQL Executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A SQL executor that mimics the Neon `neon()` function.
 *
 * Supports both calling conventions:
 *   const rows = await sql`SELECT * FROM t WHERE id = ${value}`;
 *   const rows = await sql('SELECT * FROM t WHERE id = $1', [value]);
 */
export type NeonSqlFunction = ((
  strings: TemplateStringsArray | string,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>) & {
  transaction: <T = unknown[]>(
    callback: (txn: NeonTxnFunction) => unknown[],
  ) => Promise<T>;
};

/**
 * A transaction-scoped SQL executor. Inside a Neon `sql.transaction()` callback,
 * the `txn` function supports the same two calling conventions as `sql`.
 */
export type NeonTxnFunction = (
  strings: TemplateStringsArray | string,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

/**
 * Execute a query using a specific pg client (transaction context).
 * Handles both tagged template and function-call modes.
 */
async function executeWithClient(
  client: PoolClient,
  strings: TemplateStringsArray | string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  const { text, params } = resolveQuery(strings, values);
  const result = await client.query(text, params as unknown[]);
  return result.rows as Record<string, unknown>[];
}

/**
 * Create a SQL executor backed by pg PoolClient.
 *
 * @param client The pg client to use for queries (either from pool or from a
 *               transaction). If null, a client is acquired from the pool per
 *               query and released after (with try/finally for safety).
 */
function createSqlExecutor(client: PoolClient | null): NeonSqlFunction {
  const execute = async (
    strings: TemplateStringsArray | string,
    values: unknown[],
  ): Promise<Record<string, unknown>[]> => {
    const { text, params } = resolveQuery(strings, values);
    let localClient: PoolClient | null = null;
    let result: QueryResult;

    try {
      if (client) {
        // Use the provided client (transaction context).
        result = await client.query(text, params as unknown[]);
      } else {
        // Acquire a client from the pool, execute, release.
        localClient = await getPool().connect();
        result = await localClient.query(text, params as unknown[]);
      }

      return result.rows as Record<string, unknown>[];
    } finally {
      // CRITICAL: Always release the pool-acquired client, even on error.
      // Without this, failed queries leak connections and exhaust the pool,
      // causing "timeout exceeded when trying to connect" on subsequent tests.
      if (localClient) {
        localClient.release();
      }
    }
  };

  const sqlFn = (async (
    strings: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    return execute(strings, values);
  }) as NeonSqlFunction;

  // The .transaction() method: BEGIN, execute callback queries, COMMIT/ROLLBACK.
  sqlFn.transaction = async <T = unknown[]>(
    callback: (txn: NeonTxnFunction) => unknown[],
  ): Promise<T> => {
    const txnClient = await getPool().connect();
    try {
      await txnClient.query('BEGIN');

      // Build the txn executor that uses the transaction client.
      // Supports both tagged template and function-call modes.
      const txnFn: NeonTxnFunction = async (
        strings: TemplateStringsArray | string,
        ...values: unknown[]
      ): Promise<Record<string, unknown>[]> => {
        return executeWithClient(txnClient, strings, values);
      };

      // The callback must return an array of query promises.
      // The Neon driver expects the callback to be synchronous and return
      // an array of promises. We resolve all of them.
      const queryPromises = callback(txnFn);

      // CRITICAL: Use Promise.allSettled (not Promise.all) to ensure ALL
      // query promises settle before we proceed to COMMIT/ROLLBACK and
      // release the client. With Promise.all, the first rejection leaves
      // pending queries on the connection — when the client is released
      // back to the pool, those pending queries interfere with the next
      // test's queries, causing "timeout exceeded when trying to connect".
      const settled = await Promise.allSettled(queryPromises);

      // If any query rejected, throw the first rejection's reason.
      // This preserves the error semantics of Promise.all (throw on first
      // failure) while ensuring all queries have completed.
      for (const result of settled) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
      }

      await txnClient.query('COMMIT');
      return queryPromises as unknown as T;
    } catch (err) {
      await txnClient.query('ROLLBACK').catch(() => {
        // Best-effort rollback.
      });
      throw err;
    } finally {
      txnClient.release();
    }
  };

  return sqlFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// neon() Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `neon()` factory function. Creates a SQL executor for the given
 * connection string (or uses the pool's connection string if no URL is
 * provided, matching Neon's behavior where the URL is cached).
 *
 * In this shim, the connection string is used to verify that the pool exists,
 * but all executors share the same pool (since the test database is a single
 * local instance). This is sufficient for e2e testing.
 *
 * @param connectionString The PostgreSQL connection string (optional — the
 *                          pool uses TEST_DATABASE_URL/DATABASE_URL if not
 *                          provided).
 * @returns A NeonSqlFunction with tagged template, function-call, and
 *          .transaction() support.
 */
export function neon(connectionString?: string): NeonSqlFunction {
  // Ensure the pool is initialized. The connection string from the production
  // code (process.env.DATABASE_URL) is ignored here — the pool always uses
  // TEST_DATABASE_URL for local testing. This is intentional: production code
  // sets DATABASE_URL, but the e2e tests must use the isolated test database.
  void connectionString;
  getPool();
  return createSqlExecutor(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional Exports (for compatibility with @neondatabase/serverless)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * neonConfig stub. The production code may set neonConfig properties; this
 * mock accepts any property assignment without effect (local pg doesn't use
 * HTTP/WebSocket configuration).
 */
export const neonConfig = {
  useSecureWebSocket: true,
  pipelineConnect: true,
  fetchEndpoint: undefined as string | undefined,
  fetchConnectionCache: true,
  webSocketConstructor: undefined as unknown,
  poolAnonymousLinks: false,
};

/**
 * Pool re-export for compatibility. The Neon serverless driver exports a Pool
 * class that some code may use. This mock re-exports pg's Pool.
 */
export { Pool } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Type Re-exports (for compatibility)
// ─────────────────────────────────────────────────────────────────────────────

// NeonQueryFunction type stub — the production code uses this type for type
// annotations. We export a compatible type.
export type NeonQueryFunction<
  A extends boolean = false,
  F extends boolean = false,
> = NeonSqlFunction;
