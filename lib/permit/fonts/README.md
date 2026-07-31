# CANONICAL EMBEDDED FONT PACK — v1.0.0

**STATUS: BUILT AND HASH-VERIFIED. NOT YET WIRED INTO THE PLANSET.**

Nothing in `lib/permit/` imports `fontPackData.ts` yet. The planset still emits no
`@font-face` and `--sans`/`--mono` in `generatePermit.ts:1708-1709` still ask for host
Arial / Courier New. Wiring it is the remaining half of D4 — see
`docs/PLANSET-17-PROJECTION-AND-RENDERING-CLOSURE.md` §2.

## Why it exists

The planset embeds no fonts, so text metrics come from whatever the rendering host has
installed. A host without Arial substitutes a metrically different face, dense blocks
rewrap taller, and page-fit reports clipping that describes the MACHINE rather than the
sheet. Liberation Sans / Liberation Mono are metric-compatible with Arial / Courier New,
so embedding them reproduces the accepted geometry exactly rather than reflowing it.

## Contents

| File | Family | Bytes | Source |
|---|---|---|---|
| SolarProSans-Regular.woff2 | SolarPro Sans | 42,904 | LiberationSans-Regular |
| SolarProSans-Bold.woff2 | SolarPro Sans | 43,164 | LiberationSans-Bold |
| SolarProMono-Regular.woff2 | SolarPro Mono | 37,196 | LiberationMono-Regular |
| SolarProMono-Bold.woff2 | SolarPro Mono | 37,108 | LiberationMono-Bold |
| SolarProSymbols-Regular.woff2 | SolarPro Symbols | 55,252 | DejaVuSans |

215,624 bytes total → 287,498 base64, about +16 % on a 1.75 MB planset. The unsubset TTFs
are ~1.45 MB (+110 %), which is why the pack is subset to declared unicode ranges.

`font-pack.manifest.json` carries every SHA-256, upstream release and tarball hash.
`fontPackData.ts` is the same bytes base64'd as a **bundled source module** — a serverless
function has no guarantee the `.woff2` files were traced into its deployment, and "CI and
production use the same font bytes" cannot rest on a file that might not be there.

## The symbol face

Liberation carries no glyph for six codepoints the planset actually prints: `⇒` U+21D2,
`▶` U+25B6, `◀` U+25C0, `⚠` U+26A0, `⚡` U+26A1, `✓` U+2713. Left to the browser those six
would fall back to a host font — the exact non-determinism this pack removes. `SolarPro
Symbols` is subset from DejaVu to **only the codepoints Liberation lacks**, so it can never
win a Latin glyph and cannot influence the metrics the fingerprint pins.

## Licences

- Liberation Fonts 2.1.5 — SIL Open Font License 1.1. Embedding and redistribution permitted.
- DejaVu 2.37 — Bitstream Vera derivative, permissive. Embedding and redistribution permitted.

Fonts are embedded **inside the generated artifact only**. Do not serve or expose them as
standalone downloadable assets.

## Rebuilding

```bash
python -m pip install "fonttools[woff]"
python scripts/build-font-pack.py <liberation-ttf-dir> <dejavu-ttf-dir>
```

The rebuild is **not byte-reproducible** (fontTools/brotli variance persists even with
`recalc_timestamp=False`). The vendored bytes plus the manifest hashes are the authority,
not a repeatable build — fail-closed verification must compare against the manifest.
