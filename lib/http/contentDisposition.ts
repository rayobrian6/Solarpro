// ═══════════════════════════════════════════════════════════════════════════
// contentDisposition — D1: THE DOWNLOADED FILE MUST CARRY THE CANONICAL NAME.
//
// WHY THIS EXISTS
// ──────────────────────────────────────────────────────────────────────────────
// The permit route already derives the download filename from the CANONICAL
// project record: the GET path from `projects.name`, the POST path from
// `project.projectName` AFTER the MCC §2 override has replaced the posted mirror
// with `projects.name`. Both send it in `Content-Disposition`.
//
// The browser then threw it away. `app/engineering/page.tsx` set
// `a.download = \`PermitPackage-${config.projectName}…\``, and `config` is the
// Engineering page's copy of `projects.engineering_config` — a MIRROR that does
// not round-trip. On the live Braidon project the two disagree exactly as that
// predicts: `projects.name` is "BRAIDON M PILLA — Solar" while
// `engineering_config.projectName` is "BRAIDON M PILLA — Solar TEST". The
// document inside was correctly identified; the file it saved as was not.
//
// `a.download` wins over `Content-Disposition` for same-origin responses, so the
// server being right was not enough. This module lets the client USE what the
// server sent instead of re-deriving an identity it does not own.
//
// WHAT IT IS
// A dependency-free RFC 6266 / RFC 5987 filename parser. `filename*` (with its
// charset and percent-encoding) takes precedence over plain `filename`, which is
// what the RFC requires and what every browser does.
//
// SECURITY
// The returned value is used as a SAVE name. Any path separator, traversal
// segment or control character is stripped: a response header is attacker-
// influenced input in the general case, and a download name containing `../`
// has no legitimate use.
// ═══════════════════════════════════════════════════════════════════════════

/** Strip anything that must never appear in a save-as name. */
function sanitizeDownloadName(raw: string): string {
  const noPath = raw
    .replace(/\\/g, '/')            // normalise Windows separators first
    .split('/').pop() ?? '';        // keep the last segment only — kills traversal
  return noPath
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')  // control characters
    .replace(/^\.+/, '')               // leading dots ("..", ".hidden")
    .trim();
}

/**
 * Extract the filename a `Content-Disposition` header specifies.
 *
 * Precedence follows RFC 6266 §4.3: an `filename*` parameter, when present and
 * parseable, wins over `filename`. Returns null when the header is absent, has
 * no filename parameter, or the value sanitizes away to nothing — the caller
 * then chooses a fallback that does NOT assert a stale identity.
 */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header || typeof header !== 'string') return null;

  // ── RFC 5987 extended parameter: filename*=UTF-8''percent%20encoded ──────
  // The charset and an optional language tag precede two single quotes.
  const ext = /;\s*filename\*\s*=\s*([^']*)'([^']*)'([^;]+)/i.exec(header);
  if (ext) {
    const value = ext[3].trim().replace(/^"|"$/g, '');
    try {
      // Only UTF-8 and ISO-8859-1 are permitted charsets; decodeURIComponent
      // handles UTF-8, and latin-1 percent escapes decode compatibly for the
      // ASCII range the permit route emits.
      const decoded = decodeURIComponent(value);
      const clean = sanitizeDownloadName(decoded);
      if (clean) return clean;
    } catch {
      // A malformed percent-escape is not fatal — fall through to `filename`.
    }
  }

  // ── plain parameter: filename="quoted value" or filename=bare ───────────
  // The quoted form is checked FIRST and is TERMINAL: if it matched, the header
  // did specify a quoted filename, and a value that sanitizes away to nothing
  // means "no usable name" — not "try again without the quotes". Falling
  // through here would re-capture the value WITH its delimiters and return a
  // stray quote character as the filename.
  const quoted = /;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) {
    const unescaped = quoted[1].replace(/\\(.)/g, '$1');
    return sanitizeDownloadName(unescaped) || null;
  }
  const bare = /;\s*filename\s*=\s*([^;]+)/i.exec(header);
  if (bare) {
    // Defensive: strip any stray delimiters an unbalanced header may leave.
    const stripped = bare[1].trim().replace(/^["']+|["']+$/g, '');
    return sanitizeDownloadName(stripped) || null;
  }
  return null;
}

/**
 * The save-as name for a downloaded package.
 *
 * The server's `Content-Disposition` is authoritative because it is derived from
 * the canonical project record. When it is absent or unparseable the fallback
 * is deliberately IDENTITY-FREE — a project id, never a project name — because
 * the only name the browser holds is the stale `engineering_config` mirror, and
 * printing that is the defect this module exists to remove.
 */
export function downloadFilenameFor(args: {
  header: string | null | undefined;
  projectId?: string | null;
  /** e.g. 'PermitPackage' | 'SLD' — used only by the identity-free fallback. */
  kind: string;
  /** e.g. 'pdf' | 'html' */
  extension: string;
  /** e.g. '-DRAFT' */
  suffix?: string;
}): string {
  const fromServer = parseContentDispositionFilename(args.header);
  if (fromServer) return fromServer;
  const id = (args.projectId ?? '').trim();
  const scope = id ? `-${id}` : '';
  return `${args.kind}${scope}${args.suffix ?? ''}.${args.extension}`;
}
