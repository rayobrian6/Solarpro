// Shared fetch helper for command-action modals.
// A bare fetch only rejects on network failure, not on HTTP 4xx/5xx — so the
// modals were treating permission/validation/server errors as success and
// advancing the project stage without anything being persisted. This wrapper
// throws on a non-2xx response so the caller's catch surfaces the real error.

export async function postJson(
  url: string,
  body: unknown,
  init?: { method?: string },
): Promise<unknown> {
  const res = await fetch(url, {
    method: init?.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { error?: string }));
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return res.json().catch(() => ({}));
}
