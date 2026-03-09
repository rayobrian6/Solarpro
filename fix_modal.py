with open('components/onboarding/BillUploadModal.tsx', 'r') as f:
    content = f.read()

old = """      // Build placeholder email (API requires valid email format)
      const emailSlug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\\.+/g, '.').replace(/^\\.|\\.$/, '');
      const placeholderEmail = `${emailSlug}@pending.solarpro`;
      const safeAddress = clientAddress.length >= 5 ? clientAddress : `${clientAddress || 'Unknown'}, USA`;"""

new = """      // Build placeholder email (API requires valid email format)
      const emailSlug = (clientName.toLowerCase()
        .replace(/[^a-z0-9]/g, '.')
        .replace(/\\.+/g, '.')
        .replace(/^\\.|\\.$/, '')
        .substring(0, 30)) || 'customer';
      const placeholderEmail = `${emailSlug}@pending.solarpro`;

      // Address must be >= 5 chars for API validation
      const safeAddress = (clientAddress && clientAddress.trim().length >= 5)
        ? clientAddress.trim()
        : result.locationData
          ? `${result.locationData.city}, ${result.locationData.stateCode} ${result.locationData.zip || '00000'}`
          : 'Address Pending, USA';"""

if old in content:
    content = content.replace(old, new)
    with open('components/onboarding/BillUploadModal.tsx', 'w') as f:
        f.write(content)
    print('SUCCESS: replacement made')
else:
    print('NOT FOUND - trying alternate search')
    # Find the lines
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'emailSlug' in line or 'placeholderEmail' in line or 'safeAddress' in line:
            print(f'Line {i}: {repr(line)}')