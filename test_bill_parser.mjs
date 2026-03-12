/**
 * Test the bill parser with the fixed cases from v46.2-v46.4
 * Run: npx tsx test_bill_parser.mjs
 */

import { parseBill } from './lib/billParser.ts';

// Realistic test cases with 6+ months to pass the source selection threshold
const testCases = [
  // v46.2 fix: year-as-kWh false match - "Jan 2025 362" should give jan: 362, not jan: 2025
  {
    name: 'Year-as-kWh (Jan 2025 362 -> should extract 362, not 2025)',
    text: `
      Jan 2025 362 kWh
      Feb 2025 450 kWh
      Mar 2025 380 kWh
      Apr 2025 420 kWh
      May 2025 500 kWh
      Jun 2025 550 kWh
    `,
    check: (result) => {
      const janVal = result.monthlyArray[0];
      const febVal = result.monthlyArray[1];
      // jan should be 362, not 2025
      return janVal === 362 && janVal !== 2025 && febVal === 450;
    }
  },
  
  // v46.2 fix: date-as-kWh false match - "Jan 15, 2025" should NOT extract 15 as kWh
  {
    name: 'Date-as-kWh (Jan 15, 2025 -> should skip 15)',
    text: `
      Billing Period: Jan 15, 2025 to Feb 14, 2025
      Jan 362 kWh
      Feb 450 kWh
      Mar 380 kWh
      Apr 420 kWh
      May 500 kWh
      Jun 550 kWh
    `,
    check: (result) => {
      const janVal = result.monthlyArray[0];
      // jan should be 362 (from "Jan 362 kWh"), not 15 (from date)
      return janVal === 362 && janVal !== 15;
    }
  },
  
  // v46.4 fix: comma-kWh - "1,234 kWh" should extract 1234
  {
    name: 'Comma-kWh (1,234 kWh -> should extract 1234)',
    text: `
      Jan 1,234 kWh
      Feb 2,456 kWh
      Mar 1,890 kWh
      Apr 1,567 kWh
      May 2,100 kWh
      Jun 2,345 kWh
    `,
    check: (result) => {
      const janVal = result.monthlyArray[0];
      const febVal = result.monthlyArray[1];
      return janVal === 1234 && febVal === 2456;
    }
  },
  
  // v46.2 fix: currentMonthKwh from "Energy Charge 362 kWh"
  {
    name: 'currentMonthKwh (Energy Charge 362 kWh -> should extract 362)',
    text: `Energy Charge 362 kWh $45.23`,
    check: (result) => result.currentMonthKwh === 362
  },

  // Combined test: realistic CMP-style bill with year numbers
  {
    name: 'CMP-style bill with year numbers in monthly data',
    text: `
      Central Maine Power
      Your Monthly Usage
      Jan 2025  555 kWh
      Feb 2025  609 kWh  
      Mar 2025  736 kWh
      Apr 2025  642 kWh
      May 2025  498 kWh
      Jun 2025  403 kWh
      Jul 2025  387 kWh
      Energy Charge  362 kWh  $45.23
    `,
    check: (result) => {
      // Monthly values should be correct (not the year numbers)
      const janVal = result.monthlyArray[0]; // should be 555, not 2025
      const febVal = result.monthlyArray[1]; // should be 609
      const currentMonth = result.currentMonthKwh; // should be 362
      const utility = result.utility?.value;
      return janVal === 555 && febVal === 609 && currentMonth === 362 && utility === 'Central Maine Power';
    }
  },
];

console.log('Bill Parser Test Cases (from v46.2-v46.4 fixes):\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = parseBill(tc.text);
  const ok = tc.check(result);
  
  if (ok) {
    console.log(`✅ PASS: ${tc.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${tc.name}`);
    console.log(`   monthlyArray: ${JSON.stringify(result.monthlyArray)}`);
    console.log(`   currentMonthKwh: ${result.currentMonthKwh}`);
    console.log(`   utility: ${result.utility?.value}`);
    for (const line of result.debugLog) {
      console.log(`   ${line}`);
    }
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);