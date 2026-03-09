// Test the bill OCR patterns against the actual extracted text from the bill

// Simulate the extracted text from the bill (from the summary)
const billText = `SOUTHWESTERN ELECTRIC COOPERATIVE INC
MARSHA A CARPENTER
1016 FRANKLIN ST POCAHONTAS IL 62275-3123

Service Address: 1016 FRANKLIN ST, HOME Service Location: 28080900
Rate Schedule: Residential

Account Number: 28080900

Billing Period: January 1, 2026 to January 31, 2026
31 days

This Month
4,993 kWh 31 days

Energy 4,993 kWh @ 0.03770 $188.24

Customer Charge $25.00
Distribution Charge $45.00
Transmission Charge $30.00
A charge used to recover the Cooperative's costs for maintaining the distribution system.

Total Due $554.00
`;

// Test kWh patterns
const monthlyPatterns = [
  // "Energy 4,993 kWh @ 0.03770" — energy line item (most specific, check first)
  /energy\s+([0-9,]+)\s*kwh\s*@/i,
  // "4,993 kWh 31 days" — usage followed by billing days (This Month block)
  /([1-9][0-9,]{2,})\s*kwh\s+\d+\s*days/i,
  // "kWh Usage ... 1 4,993" — meter reading table
  /kwh\s+usage[^0-9]*(?:\d+\s+)?([0-9,]{3,})/i,
  // Multiplier table
  /multiplier\s+kwh\s+usage[^0-9]*\d+\s+([0-9,]+)/i,
  /(?:total\s+)?(?:energy\s+)?(?:usage|used|consumption|kwh\s+used)[:\s]+([0-9,]+)\s*kwh/i,
  /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
  /(?:electric\s+)?(?:usage|consumption)[:\s]+([0-9,]+)\s*(?:kwh|kw-?h)/i,
  /([0-9,]+)\s*kw[h-]?\s*@/i,
  /(?:current\s+)?(?:month(?:ly)?\s+)?usage[:\s]+([0-9,]+)/i,
  /(?:billing\s+)?(?:period\s+)?usage[:\s]+([0-9,]+)\s*kwh/i,
];

console.log('=== kWh Pattern Tests ===');
for (const pattern of monthlyPatterns) {
  const match = billText.match(pattern);
  if (match) {
    const val = parseFloat(match[1].replace(/,/g, ''));
    console.log(`MATCH: ${pattern} => "${match[1]}" => ${val}`);
    if (val > 0 && val < 100000) {
      console.log(`  ✓ Would use: ${val} kWh`);
      break;
    }
  }
}

// Test address patterns
console.log('\n=== Address Pattern Tests ===');
const addrPatterns = [
  // Full address with zip
  /(?:service\s+address|premises|property\s+address)[:\s]+([0-9]+[^,\n]+,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/i,
  // Address with state but no zip
  /(?:service\s+address|premises)[:\s]+([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Hwy|Pkwy)[.,\s]+[A-Za-z\s]+,\s*[A-Z]{2})/i,
  // Mailing block: "1016 FRANKLIN ST POCAHONTAS IL 62275-3123" (all caps, no comma)
  /([0-9]+\s+[A-Z][A-Z\s]+(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|HWY)\s+[A-Z][A-Z\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/,
  // Service address stopping at "Service Location", "Rate Schedule", "Meter"
  /(?:service\s+address)[:\s]+([0-9]+\s+[A-Z][A-Z\s,]+?)(?:\s+Service\s+Location|\s+Rate\s+Schedule|\s+Meter\s+No|\s{3,}|$)/i,
  // Address at start of line
  /^([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b[^,\n]*,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/im,
];

for (const pattern of addrPatterns) {
  const match = billText.match(pattern);
  if (match) {
    const addr = match[1].trim();
    console.log(`MATCH: ${pattern}`);
    console.log(`  => "${addr}" (len=${addr.length})`);
    if (addr.length > 10 && addr.length < 150) {
      console.log(`  ✓ Would use this address`);
      break;
    }
  } else {
    console.log(`NO MATCH: ${pattern}`);
  }
}

// Test utility patterns
console.log('\n=== Utility Pattern Tests ===');
const UTILITY_PATTERNS = [
  [/pacific\s+gas\s+(?:and|&)\s+electric|pg&e|pge/i, 'PG&E'],
  [/southern\s+california\s+edison|sce\b/i, 'Southern California Edison'],
  [/ameren/i, 'Ameren'],
  [/comed\b|commonwealth\s+edison/i, 'ComEd'],
  [/southwestern\s+electric\s+cooperative/i, 'Southwestern Electric Cooperative'],
  [/southwestern\s+public\s+service|sps\b/i, 'Southwestern Public Service'],
];

let foundUtility = false;
for (const [pattern, name] of UTILITY_PATTERNS) {
  if (pattern.test(billText)) {
    console.log(`MATCH: ${pattern} => "${name}"`);
    foundUtility = true;
    break;
  }
}
if (!foundUtility) {
  console.log('No utility pattern matched!');
  // Test generic fallback
  const genericMatch = billText.match(/([A-Z][a-zA-Z\s]{2,30}(?:Electric(?:ity)?|Power|Energy|Light(?:ing)?|Gas|Utilities?|Cooperative|Coop\b))/);
  if (genericMatch) {
    console.log(`Generic fallback: "${genericMatch[1].trim()}"`);
  }
}

// Test rate patterns
console.log('\n=== Rate Pattern Tests ===');
const ratePatterns = [
  /(?:energy\s+)?(?:charge|rate|price)[:\s]+\$?([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
  /\$([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
  /([0-9]+\.[0-9]{2,4})\s*(?:¢|cents?)\s*(?:per\s+)?(?:\/\s*)?kwh/i,
  /kwh\s+@\s+\$?([0-9]+\.[0-9]{3,5})/i,
  /(?:unit\s+)?(?:rate|price)[:\s]+([0-9]+\.[0-9]{3,5})/i,
];

for (const pattern of ratePatterns) {
  const match = billText.match(pattern);
  if (match) {
    let rate = parseFloat(match[1]);
    if (rate > 1) rate = rate / 100;
    console.log(`MATCH: ${pattern} => "${match[1]}" => $${rate}/kWh`);
    if (rate > 0.01 && rate < 1.5) {
      console.log(`  ✓ Would use rate: $${rate}/kWh`);
      break;
    }
  }
}

// Test total amount
console.log('\n=== Total Amount Tests ===');
const totalPatterns = [
  /(?:total\s+)?(?:amount\s+)?(?:due|owed|billed)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
  /(?:current\s+)?(?:charges?|bill)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
  /total[:\s]+\$([0-9,]+\.[0-9]{2})/i,
  /\$([0-9,]+\.[0-9]{2})\s+(?:total|due|owed)/i,
];
for (const pattern of totalPatterns) {
  const match = billText.match(pattern);
  if (match) {
    const val = parseFloat(match[1].replace(/,/g, ''));
    console.log(`MATCH: ${pattern} => $${val}`);
    break;
  }
}