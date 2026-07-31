#!/usr/bin/env python3
"""
build-font-pack.py — produce the CANONICAL EMBEDDED FONT PACK for the planset.

WHY THIS EXISTS
The planset embeds no @font-face and asks for host fonts (Arial / Courier New).
A rendering host without them substitutes a metrically different face, dense text
rewraps taller, and page-fit reports clipping that describes the MACHINE rather
than the sheet. The only way to make planset geometry host-independent is to ship
the exact font bytes inside the artifact.

WHAT IT PRODUCES
Liberation Sans / Liberation Mono — metric-compatible with Arial / Courier New,
so embedding them reproduces the accepted geometry exactly rather than reflowing
it — subset to the planset's character repertoire and converted to WOFF2, plus a
manifest recording version, provenance and SHA-256 of every face.

Subsetting matters: the four full TTFs are ~1.45 MB, which base64-embedded would
more than double a 1.75 MB planset. The subset is a small fraction of that.

REPRODUCE (one-time authoring step; NOT a runtime or CI dependency):
    python -m pip install "fonttools[woff]"
    python scripts/build-font-pack.py

Upstream: https://github.com/liberationfonts/liberation-fonts (SIL OFL 1.1)
          liberation-fonts-ttf-2.1.5.tar.gz
          sha256 7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0
"""
import hashlib
import io
import json
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

PACK_VERSION = '1.0.0'
UPSTREAM_RELEASE = 'liberation-fonts-ttf-2.1.5'
UPSTREAM_URL = 'https://github.com/liberationfonts/liberation-fonts'
UPSTREAM_TARBALL_SHA256 = '7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0'
LICENSE = 'SIL Open Font License 1.1'

# The planset's character repertoire, declared as RANGES rather than harvested
# from one artifact: a subset tuned to a single generated package would render
# .notdef the first time a new symbol appeared. Coverage is asserted at test time
# (tests/planset/font-pack.test.ts) so a character outside this set FAILS CLOSED
# instead of printing tofu.
UNICODE_RANGES = [
    (0x0020, 0x007E),   # Basic Latin
    (0x00A0, 0x00FF),   # Latin-1 Supplement — ° · × ÷ ² § Ø
    (0x0370, 0x03FF),   # Greek — Σ Ω (summation / ohms)
    (0x2000, 0x206F),   # General Punctuation — – — ' " " • … ″
    (0x2070, 0x209F),   # Super/subscripts
    (0x20A0, 0x20BF),   # Currency
    (0x2100, 0x214F),   # Letterlike — ℃ ℉ №
    (0x2190, 0x21FF),   # Arrows — → ⇒
    (0x2200, 0x22FF),   # Math operators — − ≤ ≥ Σ ∅
    (0x2500, 0x257F),   # Box drawing — ─ ═
    (0x25A0, 0x25FF),   # Geometric shapes — ▪ ▲ ▶ ◀
    (0x2600, 0x26FF),   # Misc symbols — ⚠ ⚡
    (0x2700, 0x27BF),   # Dingbats — ✓ ✗
]

FACES = [
    ('SolarProSans-Regular',  'LiberationSans-Regular.ttf',  'SolarPro Sans', '400', 'normal'),
    ('SolarProSans-Bold',     'LiberationSans-Bold.ttf',     'SolarPro Sans', '700', 'normal'),
    ('SolarProMono-Regular',  'LiberationMono-Regular.ttf',  'SolarPro Mono', '400', 'normal'),
    ('SolarProMono-Bold',     'LiberationMono-Bold.ttf',     'SolarPro Mono', '700', 'normal'),
]

# Liberation carries no glyph for six symbols the planset genuinely prints
# (⇒ ▶ ◀ ⚠ ⚡ ✓ — verified against the accepted Planset 17 artifact). Left to the
# browser those six would fall back to a HOST font, reintroducing exactly the
# host dependence this pack exists to remove. So a third family carries them.
#
# It is subset to ONLY the codepoints Liberation lacks, which is what makes it
# safe: it can never win a Latin glyph, so it cannot influence the text metrics
# the fingerprint pins. The CSS stack is 'SolarPro Sans', 'SolarPro Symbols' —
# the second family is reached only for glyphs the first does not have.
SYMBOL_FACE = ('SolarProSymbols-Regular', 'DejaVuSans.ttf', 'SolarPro Symbols', '400', 'normal')
SYMBOL_BLOCKS = [
    (0x2190, 0x21FF),   # Arrows — ⇒
    (0x2200, 0x22FF),   # Math operators
    (0x2500, 0x257F),   # Box drawing
    (0x25A0, 0x25FF),   # Geometric shapes — ▶ ◀
    (0x2600, 0x26FF),   # Misc symbols — ⚠ ⚡
    (0x2700, 0x27BF),   # Dingbats — ✓
]
DEJAVU_RELEASE = 'dejavu-fonts-ttf-2.37'
DEJAVU_URL = 'https://github.com/dejavu-fonts/dejavu-fonts'
DEJAVU_TARBALL_SHA256 = 'fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7'
DEJAVU_LICENSE = 'Bitstream Vera / DejaVu (permissive, redistribution + embedding allowed)'


def unicodes():
    out = []
    for lo, hi in UNICODE_RANGES:
        out.extend(range(lo, hi + 1))
    return out


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else None
    if not src_dir or not os.path.isdir(src_dir):
        print('usage: build-font-pack.py <dir containing Liberation*.ttf>')
        return 2
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib', 'permit', 'fonts')
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    wanted = unicodes()
    manifest = {
        'packVersion': PACK_VERSION,
        'upstream': {
            'project': 'Liberation Fonts',
            'url': UPSTREAM_URL,
            'release': UPSTREAM_RELEASE,
            'tarballSha256': UPSTREAM_TARBALL_SHA256,
            'license': LICENSE,
        },
        'metricCompatibility': {
            'SolarPro Sans': 'Arial / Helvetica (Liberation Sans — identical advance widths)',
            'SolarPro Mono': 'Courier New (Liberation Mono — identical advance widths)',
        },
        'unicodeRanges': [f'U+{lo:04X}-{hi:04X}' for lo, hi in UNICODE_RANGES],
        'faces': [],
    }

    for out_name, src_name, family, weight, style in FACES:
        src = os.path.join(src_dir, src_name)
        if not os.path.isfile(src):
            print(f'MISSING SOURCE: {src}')
            return 1
        raw = open(src, 'rb').read()
        src_sha = hashlib.sha256(raw).hexdigest()

        font = TTFont(src)
        covered_before = set()
        for t in font['cmap'].tables:
            covered_before |= set(t.cmap.keys())

        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.desubroutinize = True
        opts.layout_features = ['*']
        opts.notdef_outline = True
        opts.recalc_bounds = True
        # byte-reproducible: without this fontTools stamps head.modified with the
        # build time and two identical inputs produce two different SHA-256s.
        opts.recalc_timestamp = False
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=wanted)
        sub.subset(font)

        buf = io.BytesIO()
        font.flavor = 'woff2'
        font.save(buf)
        data = buf.getvalue()
        out_path = os.path.join(out_dir, out_name + '.woff2')
        open(out_path, 'wb').write(data)

        covered_after = set()
        for t in TTFont(io.BytesIO(data)).getBestCmap().items():
            covered_after.add(t[0])

        manifest['faces'].append({
            'file': out_name + '.woff2',
            'family': family,
            'weight': weight,
            'style': style,
            'source': src_name,
            'sourceSha256': src_sha,
            'sourceBytes': len(raw),
            'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data),
            'glyphCoverage': len(covered_after),
        })
        print(f'{out_name}.woff2  {len(raw):>8} -> {len(data):>7} bytes  '
              f'({len(covered_after)} codepoints)  sha256 {hashlib.sha256(data).hexdigest()[:16]}')

    # ── the symbol face: ONLY what Liberation lacks ────────────────────────
    ref = TTFont(os.path.join(src_dir, 'LiberationSans-Regular.ttf'))
    lib_have = set(ref.getBestCmap().keys())
    sym_src_dir = sys.argv[2] if len(sys.argv) > 2 else None
    if sym_src_dir and os.path.isdir(sym_src_dir):
        out_name, src_name, family, weight, style = SYMBOL_FACE
        src = os.path.join(sym_src_dir, src_name)
        raw = open(src, 'rb').read()
        src_sha = hashlib.sha256(raw).hexdigest()
        dv = TTFont(src)
        dv_have = set(dv.getBestCmap().keys())
        sym_wanted = sorted(
            cp for lo, hi in SYMBOL_BLOCKS for cp in range(lo, hi + 1)
            if cp not in lib_have and cp in dv_have
        )
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.desubroutinize = True
        opts.notdef_outline = True
        opts.recalc_bounds = True
        opts.recalc_timestamp = False
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=sym_wanted)
        sub.subset(dv)
        buf = io.BytesIO()
        dv.flavor = 'woff2'
        dv.save(buf)
        data = buf.getvalue()
        open(os.path.join(out_dir, out_name + '.woff2'), 'wb').write(data)
        manifest['symbolFace'] = {
            'file': out_name + '.woff2',
            'family': family, 'weight': weight, 'style': style,
            'source': src_name, 'sourceSha256': src_sha, 'sourceBytes': len(raw),
            'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
            'codepointCount': len(sym_wanted),
            'rationale': 'codepoints Liberation does not carry; subset so it can never win a Latin glyph',
        }
        manifest['upstreamSymbols'] = {
            'project': 'DejaVu Fonts', 'url': DEJAVU_URL, 'release': DEJAVU_RELEASE,
            'tarballSha256': DEJAVU_TARBALL_SHA256, 'license': DEJAVU_LICENSE,
        }
        manifest['faces'].append(manifest['symbolFace'])
        print(f'{out_name}.woff2  {len(raw):>8} -> {len(data):>7} bytes  '
              f'({len(sym_wanted)} codepoints Liberation lacks)  sha256 {hashlib.sha256(data).hexdigest()[:16]}')

    # what the declared ranges asked for that NEITHER family carries
    sym_have = set()
    if 'symbolFace' in manifest:
        sym_have = set(TTFont(os.path.join(out_dir, manifest['symbolFace']['file'])).getBestCmap().keys())
    missing = sorted(cp for cp in wanted if cp not in lib_have and cp not in sym_have)
    manifest['uncoveredCodepoints'] = [f'U+{cp:04X}' for cp in missing]

    mpath = os.path.join(out_dir, 'font-pack.manifest.json')
    open(mpath, 'w', encoding='utf-8').write(json.dumps(manifest, indent=2) + '\n')

    # ── the bundled data module ────────────────────────────────────────────
    # The base64 is emitted as TypeScript rather than read from disk at runtime
    # so the bytes travel INSIDE the JS bundle. A serverless function has no
    # guarantee that lib/permit/fonts/*.woff2 was traced into its deployment,
    # and "CI and production must use the same font bytes" cannot rest on a file
    # that might not be there. Imported, it either compiles or it does not.
    import base64
    lines = [
        '// GENERATED BY scripts/build-font-pack.py — DO NOT EDIT BY HAND.',
        '//',
        '// The canonical embedded font pack, base64 WOFF2, bundled as source so the',
        '// exact same bytes render in CI, locally and on the serverless production',
        '// path. Regenerate with:',
        '//   python -m pip install "fonttools[woff]"',
        '//   python scripts/build-font-pack.py <liberation-ttf-dir> <dejavu-ttf-dir>',
        '//',
        f'// Pack {PACK_VERSION} · Liberation Fonts {UPSTREAM_RELEASE} (SIL OFL 1.1)',
        f'// · DejaVu {DEJAVU_RELEASE} for the symbols Liberation lacks.',
        '',
        'export interface EmbeddedFace {',
        '  readonly file: string;',
        '  readonly family: string;',
        '  readonly weight: string;',
        '  readonly style: string;',
        '  readonly sha256: string;',
        '  readonly bytes: number;',
        '  readonly base64: string;',
        '}',
        '',
        f"export const FONT_PACK_VERSION = '{PACK_VERSION}';",
        '',
        'export const EMBEDDED_FACES: readonly EmbeddedFace[] = [',
    ]
    for f in manifest['faces']:
        b64 = base64.b64encode(open(os.path.join(out_dir, f['file']), 'rb').read()).decode('ascii')
        lines.append('  {')
        lines.append(f"    file: '{f['file']}',")
        lines.append(f"    family: '{f['family']}',")
        lines.append(f"    weight: '{f['weight']}',")
        lines.append(f"    style: '{f['style']}',")
        lines.append(f"    sha256: '{f['sha256']}',")
        lines.append(f"    bytes: {f['bytes']},")
        lines.append(f"    base64: '{b64}',")
        lines.append('  },')
    lines.append('];')
    lines.append('')
    tpath = os.path.join(out_dir, 'fontPackData.ts')
    open(tpath, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print(f'bundled data module -> {tpath} ({os.path.getsize(tpath)} bytes)')
    total = sum(f['bytes'] for f in manifest['faces'])
    print(f'\npack {PACK_VERSION}: {len(manifest["faces"])} faces, {total} bytes '
          f'({total * 4 // 3} base64), manifest -> {mpath}')
    print(f'requested-but-uncovered codepoints: {len(missing)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
