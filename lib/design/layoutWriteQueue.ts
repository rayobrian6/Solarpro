/**
 * lib/design/layoutWriteQueue.ts
 *
 * ONE TAB, ONE LAYOUTS-ROW WRITE AT A TIME.
 *
 * 🚨 WHY THIS EXISTS — A TAB WAS REFUSING ITS OWN WRITES.
 *
 * There is a single `layouts` row per (project, user) and several routes write it:
 * `POST /api/projects/[id]/layout` (the autosave) and `POST /api/production` (the
 * Save button and Calculate Production) all land on the same row, and a trigger
 * re-stamps `updated_at` on every write. Each of those writes states the version it
 * was based on — `expectedUpdatedAt` — and the server turns it into an atomic claim,
 * refusing the write outright if the row has moved on. That guard is correct and it
 * stays.
 *
 * What it cannot see is the difference between *somebody else's* write and *this
 * tab's other write that has not come back yet*. `storedVersion()` only moves when a
 * response arrives, so two requests sent from one tab inside the same round trip both
 * state the same token. The server serialises them, the first one wins and moves the
 * row, and the second is refused — with the sentence "this design was saved somewhere
 * else — another tab, another device, or an older copy of this page" shown to a person
 * who has nothing else open. Whatever that second request carried is discarded.
 *
 * MEASURED, in the dev server log for a single browser tab:
 *
 *     POST /api/projects/433d…/layout    200 in 26181ms   <- won, moved the row
 *     POST /api/production               409 in 27860ms   <- refused, same base token
 *     …saved design has 4 panel(s), last written 03:49:31.545Z;
 *       this save carries 4 panel(s), based on the version from 03:48:33.882Z
 *
 * Identical content, one tab, and a refusal. The window is simply however long the
 * slower request takes, and `POST /api/production` runs a PVWatts simulation, so on a
 * healthy server it is still hundreds of milliseconds — comfortably longer than the
 * autosave debounce that a design change starts at the same moment. This is the third
 * time this row's concurrency control has bitten its own author; the first two were
 * sequential and were fixed by adopting the version each write returned (see
 * `noteSavedVersion` in components/design/useSiteDesign.ts). Adoption cannot fix the
 * concurrent case, because there is nothing to adopt yet.
 *
 * SO: every awaitable write of the layouts row from this tab goes through here, and
 * each one reads `expectedUpdatedAt` INSIDE its own turn — after its predecessor has
 * landed and been adopted. Two saves therefore state two different versions, which is
 * the truth. Nothing is weakened: a genuine collision with another tab or device is
 * still refused exactly as before, because this queue is per tab and says nothing
 * about anyone else.
 *
 * 🚨 READ THE TOKEN INSIDE THE CALLBACK, NOT BEFORE IT. Queueing a request whose
 * `expectedUpdatedAt` was read before it joined the queue gains nothing at all — it is
 * the same stale token, merely sent later. That is the whole mechanism, and it is what
 * `tests/layoutWriteQueue.test.ts` asserts.
 *
 * NOT here: the `beforeunload` beacon. `navigator.sendBeacon` is fire-and-forget at
 * page death — there is nothing to await and no UI left to report to, and its
 * trade-off is already documented at the call site.
 */

/**
 * The tail of this tab's write chain. Never rejects — see `enqueueLayoutWrite`.
 *
 * Module scope, deliberately: the thing being serialised is access to one database
 * row, and a per-component queue would put two DesignStudio mounts back into exactly
 * the race this removes.
 */
let tail: Promise<unknown> = Promise.resolve();

/** How many writes are waiting or running. Exposed for tests and diagnostics. */
let depth = 0;

/**
 * Run `write` after every write already queued from this tab has settled.
 *
 * Returns whatever `write` returns, and rejects with whatever it throws — the caller's
 * error handling is unchanged, it just runs later.
 */
export function enqueueLayoutWrite<T>(write: () => Promise<T>): Promise<T> {
  depth += 1;
  // 🚨 BOTH ARMS OF `then` ARE THE SAME CALLBACK, and that is load-bearing. With a
  // `tail` is a chain of SETTLEMENTS and never rejects, which is what makes the plain
  // `.then(write)` here safe.
  const run = tail.then(write) as Promise<T>;
  // 🚨 THE REJECTION ARM BELOW IS THE ONLY THING KEEPING THIS QUEUE ALIVE, and it is
  // the single place that invariant is enforced — do not move it or add a second copy
  // of it somewhere else.
  //
  // `run` rejects whenever a write fails: a dropped connection, a 500, a refusal that
  // threw. If that rejection were allowed to become the new `tail`, the next write's
  // `tail.then(write)` would never call `write` at all, and every later save in this
  // tab would silently never be sent — a permanent, invisible stop to all saving,
  // which is precisely the failure mode this area keeps producing. A predecessor's
  // outcome is its own caller's business and is never a reason to stop saving.
  //
  // It is also what stops an unhandled rejection: `run`'s rejection is already owned
  // by the caller that asked for the write.
  //
  // (An earlier draft ALSO passed `write` as the rejection arm above. Mutation testing
  // proved that arm was unreachable — `tail` cannot reject — so the comment claiming
  // it load-bearing was describing a hazard that never existed. One authority, which a
  // test can actually pin: see 'a rejected write does not wedge the queue'.)
  tail = run.then(
    () => { depth -= 1; },
    () => { depth -= 1; },
  );
  return run;
}

/** Writes currently queued or in flight from this tab. */
export function layoutWriteQueueDepth(): number {
  return depth;
}

/**
 * Drop the chain. FOR TESTS ONLY — module state otherwise leaks between cases.
 *
 * This does not cancel anything already running: a request in flight stays in flight,
 * because nothing here can recall it from the server.
 */
export function __resetLayoutWriteQueueForTests(): void {
  tail = Promise.resolve();
  depth = 0;
}
