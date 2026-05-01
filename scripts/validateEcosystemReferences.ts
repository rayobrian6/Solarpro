#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════
// scripts/validateEcosystemReferences.ts
// v47.398 — Validate that every compatibleWith[] ID reference in the
//           equipment DB points to an existing equipment row.
//
// USAGE
//   npx tsx scripts/validateEcosystemReferences.ts
//
// EXIT CODES
//   0 = all references valid (or only orphan warnings)
//   1 = unexpected error (e.g., DB module failed to import)
//
// IMPORTANT
//   This script emits WARNINGS for orphan references but does NOT fail
//   the build. Ecosystem metadata is advisory — missing references
//   should be fixed but should never break pipeline builds.
// ═══════════════════════════════════════════════════════════════════════

import {
  SOLAR_PANELS,
  STRING_INVERTERS,
  MICROINVERTERS,
  OPTIMIZERS,
  RACKING_SYSTEMS,
  BATTERIES,
  GENERATORS,
  ATS_UNITS,
  BACKUP_INTERFACES,
  MONITORING_GATEWAYS,
  EV_CHARGERS,
} from '../lib/equipment-db';

interface EquipmentRow {
  id: string;
  manufacturer: string;
  model: string;
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
}

function main(): void {
  const allRows: EquipmentRow[] = [
    ...(SOLAR_PANELS as any[]),
    ...(STRING_INVERTERS as any[]),
    ...(MICROINVERTERS as any[]),
    ...(OPTIMIZERS as any[]),
    ...(RACKING_SYSTEMS as any[]),
    ...(BATTERIES as any[]),
    ...(GENERATORS as any[]),
    ...(ATS_UNITS as any[]),
    ...(BACKUP_INTERFACES as any[]),
    ...(MONITORING_GATEWAYS as any[]),
    ...(EV_CHARGERS as any[]),
  ];

  const knownIds = new Set(allRows.map((r) => r.id));
  const taggedRows = allRows.filter((r) => r.ecosystemBrand);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Ecosystem Reference Validator — v47.398');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total equipment rows:     ${allRows.length}`);
  console.log(`Rows with ecosystem tag:  ${taggedRows.length}`);
  console.log(
    `Rows with compatibleWith: ${
      taggedRows.filter((r) => r.compatibleWith && r.compatibleWith.length > 0).length
    }\n`
  );

  // Brand coverage summary
  const byBrand: Record<string, number> = {};
  for (const r of taggedRows) {
    const b = (r.ecosystemBrand || '').toLowerCase();
    byBrand[b] = (byBrand[b] || 0) + 1;
  }
  console.log('Brand coverage:');
  for (const [b, c] of Object.entries(byBrand).sort()) {
    console.log(`  • ${b.padEnd(14)} ${c} items`);
  }
  console.log('');

  // Orphan check
  const orphans: Array<{ sourceId: string; badRef: string }> = [];
  for (const r of taggedRows) {
    if (!r.compatibleWith) continue;
    for (const ref of r.compatibleWith) {
      if (!knownIds.has(ref)) {
        orphans.push({ sourceId: r.id, badRef: ref });
      }
    }
  }

  if (orphans.length === 0) {
    console.log('✓ All compatibleWith[] references are valid.\n');
  } else {
    console.log(`⚠ Found ${orphans.length} orphan reference(s):\n`);
    for (const o of orphans) {
      console.log(`  ✗ ${o.sourceId.padEnd(40)} → missing: ${o.badRef}`);
    }
    console.log('');
    console.log('These references should be fixed, but do NOT block the build.');
    console.log('Ecosystem metadata is advisory only.\n');
  }

  // Bi-directional check (informational only)
  const bidiWarnings: Array<{ from: string; to: string }> = [];
  for (const r of taggedRows) {
    if (!r.compatibleWith) continue;
    for (const ref of r.compatibleWith) {
      const target = allRows.find((x) => x.id === ref);
      if (!target || !target.compatibleWith) continue;
      if (!target.compatibleWith.includes(r.id)) {
        bidiWarnings.push({ from: r.id, to: ref });
      }
    }
  }

  if (bidiWarnings.length > 0) {
    console.log(
      `ℹ Informational: ${bidiWarnings.length} reference(s) are one-directional:`
    );
    for (const w of bidiWarnings.slice(0, 10)) {
      console.log(`    ${w.from} → ${w.to}  (but ${w.to} does not list ${w.from})`);
    }
    if (bidiWarnings.length > 10) {
      console.log(`    … and ${bidiWarnings.length - 10} more.`);
    }
    console.log(
      '\n  This is often expected (e.g., a gateway references its inverters but'
    );
    console.log(
      '  inverters may not need to reference gateways). No action required.\n'
    );
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(
    `  Result: ${orphans.length === 0 ? 'PASS' : 'PASS with warnings'}`
  );
  console.log('═══════════════════════════════════════════════════════════════');

  // Exit 0 even with orphan warnings — these are advisory, not blocking.
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('Validator crashed:', err);
  process.exit(1);
}