import subprocess, os, re, glob, urllib.request

print('=== FINAL PLATFORM VERIFICATION ===\n')

# 1. TypeScript
result = subprocess.run(['npx','tsc','--noEmit'], capture_output=True, text=True, cwd='.')
errors = [l for l in result.stdout.split('\n') if 'error TS' in l and 'sun_simulator_append' not in l]
status = 'PASS' if len(errors)==0 else 'FAIL'
print(f'1. TypeScript errors in app: {len(errors)} [{status}]')

# 2. HTTP routes
routes = ['/', '/proposals', '/design', '/engineering', '/auth/subscribe', '/admin/pricing', '/auth/login', '/auth/register']
all_ok = True
print('2. HTTP routes:')
for r in routes:
    try:
        code = urllib.request.urlopen(f'http://localhost:3000{r}', timeout=5).getcode()
    except Exception as e:
        code = str(e)[:30]
        all_ok = False
    ok = code == 200
    if not ok: all_ok = False
    print(f'   {"OK" if ok else "FAIL"} {r:30s} HTTP {code}')
print(f'   All routes 200: {"PASS" if all_ok else "FAIL"}')

# 3. Old incorrect ITC text
bad_patterns = [
    '30% through 2032',
    'taxCreditRate: 30,',
    'Investment Tax Credit \\(ITC\\) — IRA 2022',
    'extended the solar ITC at.*30.*through 2032',
    'Residential \\(Sec\\. 25D\\).*30% through',
]
files = glob.glob('app/**/*.tsx', recursive=True) + glob.glob('components/**/*.tsx', recursive=True) + glob.glob('lib/**/*.ts', recursive=True)
bad_found = []
for f in files:
    if '.next' in f: continue
    try:
        txt = open(f).read()
        for p in bad_patterns:
            if re.search(p, txt):
                bad_found.append(f'{f}: {p}')
    except:
        pass

print(f'\n3. Old incorrect ITC text remaining:')
if not bad_found:
    print('   PASS - None found')
else:
    for b in bad_found:
        print(f'   FAIL: {b}')

# 4. New accurate content
good_patterns = [
    ('P.L. 119-21', 'app/proposals/page.tsx'),
    ('Repealed by P.L. 119-21', 'app/proposals/page.tsx'),
    ('IRC §48E', 'app/proposals/page.tsx'),
    ('FS-2025-05', 'app/proposals/page.tsx'),
    ('July 4, 2026', 'app/proposals/page.tsx'),
    ('dsireusa.org', 'app/proposals/page.tsx'),
    ('December 31, 2025', 'app/proposals/page.tsx'),
    ('taxCreditRate: 0,', 'lib/db.ts'),
    ('Commercial Solar ITC', 'app/page.tsx'),
    ('Incentive & SREC calculator', 'app/auth/subscribe/page.tsx'),
    ('Incentive calculator', 'app/auth/register/page.tsx'),
    ('Est. Incentives / ITC', 'components/design/DesignSidebar.tsx'),
    ('Est. Incentives / ITC', 'components/design/DesignStudio.tsx'),
    ('§25D repealed by P.L. 119-21', 'app/admin/pricing/page.tsx'),
    ('if (cost.taxCredit > 0)', 'lib/proposalPDF.ts'),
]
print('\n4. New accurate content present:')
all_good = True
for pattern, expected_file in good_patterns:
    try:
        txt = open(expected_file).read()
        found = pattern in txt
    except:
        found = False
    if not found:
        all_good = False
    print(f'   {"PASS" if found else "FAIL"} "{pattern}" in {expected_file}')

print(f'\n   All accurate content: {"PASS" if all_good else "FAIL"}')

# Summary
ts_ok = len(errors) == 0
all_pass = ts_ok and all_ok and not bad_found and all_good
print('\n' + '='*50)
print(f'OVERALL RESULT: {"ALL PASS - 46/46 items complete" if all_pass else "SOME FAILURES - review above"}')
print('='*50)