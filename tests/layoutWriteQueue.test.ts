/**
 * tests/layoutWriteQueue.test.ts
 *
 * THE TAB MUST NOT REFUSE ITS OWN WRITES.
 *
 * These cases model the real thing rather than the implementation: a single row that
 * carries a version, a server that refuses any write not based on the current version,
 * and a client that holds one token and adopts whatever each successful write returns.
 * That is `layouts` + `expectedUpdatedAt` + `noteSavedVersion`, and it is enough to
 * reproduce the 409 a single browser tab was giving itself.
 *
 * 🚨 THE FIRST CASE IS THE CONTROL AND IT MUST STAY. It fires the same two writes
 * WITHOUT the queue and asserts the refusal happens — so if `enqueueLayoutWrite` ever
 * degrades into a passthrough, the queued case below stops passing for a reason, and
 * this case proves the scenario was still capable of failing. A concurrency test whose
 * unguarded arm cannot fail is proving nothing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLayoutWriteQueueForTests,
  enqueueLayoutWrite,
  layoutWriteQueueDepth,
} from '@/lib/design/layoutWriteQueue';

/** One `layouts` row, with the trigger that re-stamps `updated_at` on every write. */
function makeRow() {
  let version = 1000;
  let content = 'seed';
  return {
    get version() { return version; },
    get content() { return content; },
    /** Mirrors the route: an atomic claim, refused when the row has moved on. */
    async write(expected: number | undefined, value: string, holdMs: number) {
      // The request is in flight for `holdMs` BEFORE the row is claimed, which is what
      // makes two overlapping writes overlap at all.
      await new Promise(r => setTimeout(r, holdMs));
      if (expected !== undefined && expected !== version) {
        throw new Error(`LAYOUT_STALE_WRITE: saved at ${version}, this save based on ${expected}`);
      }
      version += 1;
      content = value;
      return version;
    },
  };
}

/** The tab: one token for every writer in it, exactly like `site.storedVersion()`. */
function makeTab(row: ReturnType<typeof makeRow>) {
  let token: number | undefined = 1000;
  return {
    get token() { return token; },
    /**
     * 🚨 THE TOKEN IS READ HERE, INSIDE THE UNIT OF WORK. Hoisting this read to the
     * caller is the bug the queue exists to prevent, and `respects the token read at
     * the moment the write runs` below fails when it is hoisted.
     */
    async save(value: string, holdMs: number) {
      const based = token;
      const produced = await row.write(based, value, holdMs);
      token = produced;          // adopt what this write produced
      return produced;
    },
  };
}

describe('one tab writing the layouts row twice at once', () => {
  beforeEach(() => __resetLayoutWriteQueueForTests());

  it('🚨 CONTROL — unqueued, the second write is refused as somebody else’s', async () => {
    const row = makeRow();
    const tab = makeTab(row);

    // Both sent inside one round trip: the autosave and Calculate Production, which is
    // precisely what the server log showed.
    const results = await Promise.allSettled([
      tab.save('autosave', 30),
      tab.save('production', 40),
    ]);

    const refused = results.filter(r => r.status === 'rejected');
    expect(refused, 'the unguarded scenario must still be capable of failing, or the queued case proves nothing')
      .toHaveLength(1);
    expect(String((refused[0] as PromiseRejectedResult).reason))
      .toContain('LAYOUT_STALE_WRITE');
    // And the refused write's content is gone — this is the user's lost work.
    expect(row.content).toBe('autosave');
  });

  it('queued, both writes land and the row ends on the last one', async () => {
    const row = makeRow();
    const tab = makeTab(row);

    const results = await Promise.allSettled([
      enqueueLayoutWrite(() => tab.save('autosave', 30)),
      enqueueLayoutWrite(() => tab.save('production', 40)),
    ]);

    expect(results.map(r => r.status),
      'a tab must not refuse its own write — neither of these is somebody else')
      .toEqual(['fulfilled', 'fulfilled']);
    expect(row.version, 'both writes should have moved the row').toBe(1002);
    expect(row.content, 'the second write is the later intent and must be what is stored')
      .toBe('production');
  });

  it('respects the token read at the moment the write runs, not when it was queued', async () => {
    const row = makeRow();
    const tab = makeTab(row);
    const sent: Array<number | undefined> = [];

    await Promise.all([
      enqueueLayoutWrite(async () => { sent.push(tab.token); return tab.save('first', 20); }),
      enqueueLayoutWrite(async () => { sent.push(tab.token); return tab.save('second', 5); }),
    ]);

    // 🚨 TWO DIFFERENT TOKENS. Equal tokens would mean the second write joined the
    // queue carrying the version from before the first one landed — the stale token,
    // merely sent later, which is the whole failure being fixed.
    expect(sent[0]).toBe(1000);
    expect(sent[1], 'the second write must state the version the first one produced').toBe(1001);
  });

  it('never overlaps two writes', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const body = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(r => setTimeout(r, 10));
      running -= 1;
    };

    await Promise.all([1, 2, 3, 4, 5].map(() => enqueueLayoutWrite(body)));
    expect(maxConcurrent, 'writes to one row must be serialised').toBe(1);
  });

  it('🚨 a rejected write does not wedge the queue', async () => {
    const order: string[] = [];

    const boom = enqueueLayoutWrite(async () => {
      order.push('boom');
      throw new Error('connection dropped');
    });
    const after = enqueueLayoutWrite(async () => { order.push('after'); return 'ok'; });

    // The rejection still reaches ITS OWN caller — error handling is unchanged.
    await expect(boom).rejects.toThrow('connection dropped');
    // And the next save is sent anyway. A success-only chain would leave `after`
    // pending for the life of the page: a permanent, silent stop to all saving.
    await expect(after).resolves.toBe('ok');
    expect(order).toEqual(['boom', 'after']);
  });

  it('reports its depth and drains back to zero', async () => {
    expect(layoutWriteQueueDepth()).toBe(0);
    const a = enqueueLayoutWrite(async () => { await new Promise(r => setTimeout(r, 10)); });
    const b = enqueueLayoutWrite(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(layoutWriteQueueDepth()).toBe(2);
    await Promise.all([a, b]);
    expect(layoutWriteQueueDepth()).toBe(0);
  });
});
