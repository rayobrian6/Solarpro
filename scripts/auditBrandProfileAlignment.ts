#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════
// scripts/auditBrandProfileAlignment.ts
// v47.398.1 — Reports disagreements between BrandProfile.supportedInverterModels
//             and getEquipmentByEcosystem() results, for every brand.
//
// Non-blocking. Emits warnings, never throws.
// Used to drive Phase 2 tagging fixes.
// ═══════════════════════════════════════════════════════════════════════

import { BRAND_PROFILES } from '../lib/system/brandProfiles';
import {
  STRING_INVERTERS,
  MICROINVERTERS,
  OPTIMIZERS,
  getEquipmentByEcosystem,
} from '../lib/equipment-db';

interface Mismatch {
  brand: string;
  profileHas: string[];           // IDs in profile, not in ecosystem
  ecosystemHas: string[];         // IDs in ecosystem, not in profile
  missingFromDb: string[];        // IDs in profile, not in equipment-db
}

function main(): void {
  const allDbIds = new Set<string>([
    ...STRING_INVERTERS.map(x => x.id),
    ...MICROINVERTERS.map(x => x.id),
    ...OPTIMIZERS.map(x => x.id),
  ]);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Brand Profile ⇄ Ecosystem Alignment Audit — v47.398.1');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total BrandProfiles:         ${BRAND_PROFILES.length}`);
  console.log(`Total inverter DB rows:       ${allDbIds.size}\n`);

  const mismatches: Mismatch[] = [];

  for (const profile of BRAND_PROFILES) {
    const brandKey = profile.id.toLowerCase();

    // Profile-declared inverter IDs
    const profileIds = new Set(
      (profile.supportedInverterModels || []).map(m => m.equipmentDbId)
    );

    // Ecosystem-tagged inverter IDs for this brand
    const eco = getEquipmentByEcosystem(brandKey);
    const ecoIds = new Set<string>([
      ...eco.stringInverters.map(x => x.id),
      ...eco.microinverters.map(x => x.id),
      ...eco.optimizers.map(x => x.id),
    ]);

    // Also check by manufacturer name (some brands have different profile id vs ecosystem tag)
    const mfrKey = (profile.manufacturer || '').toLowerCase();
    if (mfrKey && mfrKey !== brandKey) {
      const ecoByMfr = getEquipmentByEcosystem(mfrKey);
      for (const x of ecoByMfr.stringInverters) ecoIds.add(x.id);
      for (const x of ecoByMfr.microinverters) ecoIds.add(x.id);
      for (const x of ecoByMfr.optimizers) ecoIds.add(x.id);
    }

    const profileOnly = [...profileIds].filter(id => !ecoIds.has(id));
    const ecoOnly = [...ecoIds].filter(id => !profileIds.has(id));
    const missingFromDb = [...profileIds].filter(id => !allDbIds.has(id));

    if (profileOnly.length > 0 || ecoOnly.length > 0 || missingFromDb.length > 0) {
      mismatches.push({
        brand: profile.id,
        profileHas: profileOnly,
        ecosystemHas: ecoOnly,
        missingFromDb,
      });
    }
  }

  // Report
  if (mismatches.length === 0) {
    console.log('✓ All BrandProfiles and ecosystem tags are perfectly aligned.\n');
    process.exit(0);
  }

  console.log(`⚠ Found ${mismatches.length} brand(s) with mismatches:\n`);

  for (const m of mismatches) {
    console.log(`── ${m.brand.toUpperCase()} ──`);
    if (m.missingFromDb.length > 0) {
      console.log(`  ✗ Profile references ${m.missingFromDb.length} ID(s) NOT in equipment-db:`);
      for (const id of m.missingFromDb) console.log(`      • ${id}`);
    }
    if (m.profileHas.length > 0) {
      console.log(`  ⚠ In profile but MISSING ecosystemBrand tag (${m.profileHas.length}):`);
      for (const id of m.profileHas) console.log(`      • ${id}`);
    }
    if (m.ecosystemHas.length > 0) {
      console.log(`  ℹ Tagged in ecosystem but NOT in profile (${m.ecosystemHas.length}):`);
      for (const id of m.ecosystemHas) console.log(`      • ${id}`);
    }
    console.log('');
  }

  // Also list brands from BRAND_PROFILES that the ecosystem picker will NOT show
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  BrandProfile → EcosystemPicker visibility');
  console.log('──────────────────────────────────────────────────────────────');
  for (const profile of BRAND_PROFILES) {
    const eco = getEquipmentByEcosystem(profile.id.toLowerCase());
    const mfrEco = profile.manufacturer
      ? getEquipmentByEcosystem(profile.manufacturer.toLowerCase())
      : null;
    const totalTagged =
      eco.stringInverters.length + eco.microinverters.length + eco.optimizers.length +
      (mfrEco
        ? mfrEco.stringInverters.length + mfrEco.microinverters.length + mfrEco.optimizers.length
        : 0);
    const visible = totalTagged > 0 ? '✓' : '✗';
    const count = (profile.supportedInverterModels || []).length;
    console.log(
      `  ${visible}  ${profile.id.padEnd(16)} profile: ${String(count).padStart(2)} inverters · ecosystem-tagged: ${totalTagged}`
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Result: ${mismatches.length === 0 ? 'ALIGNED' : 'NEEDS SYNC'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Exit 0 — advisory, never blocks
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('Audit crashed:', err);
  process.exit(1);
}