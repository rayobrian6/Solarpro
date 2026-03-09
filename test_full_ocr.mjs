import { inflateSync } from 'zlib';
import { readFileSync } from 'fs';

function extractTextFromContentStream(content) {
  let text = '';
  const tjPattern = /\(([^)]*)\)\s*Tj/g;
  let m;
  while ((m = tjPattern.exec(content)) !== null) {
    text += m[1] + ' ';
  }
  const tjArrayPattern = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrayPattern.exec(content)) !== null) {
    const inner = m[1];
    const strPattern = /\(([^)]*)\)/g;
    let sm;
    while ((sm = strPattern.exec(inner)) !== null) {
      text += sm[1];
    }
    text += ' ';
  }
  return text;
}

function extractPdfTextPure(buffer) {
  let allText = '';
  let searchPos = 0;
  while (searchPos < buffer.length) {
    const streamKeyword = buffer.indexOf(Buffer.from('stream'), searchPos);
    if (streamKeyword === -1) break;
    let dataStart = streamKeyword + 6;
    if (buffer[dataStart] === 13) dataStart++;
    if (buffer[dataStart] === 10) dataStart++;
    const endStream = buffer.indexOf(Buffer.from('endstream'), dataStart);
    if (endStream === -1) break;
    const streamData = buffer.slice(dataStart, endStream);
    try {
      const decompressed = inflateSync(streamData);
      const text = decompressed.toString('latin1');
      const extracted = extractTextFromContentStream(text);
      if (extracted.trim()) allText += extracted + ' ';
    } catch { }
    searchPos = endStream + 9;
  }
  return allText.trim();
}

const buffer = readFileSync('2026_01_20_15594002.pdf');
const text = extractPdfTextPure(buffer);

// ---- Run all extractors ----

// Customer name
function extractCustomerName(text) {
  const namePatterns = [
    /customer\s+name\s+([A-Z][A-Z\s]+?)(?:\s+Account|\s+Billing|\s+Service|\s*$)/i,
    /(?:account\s+(?:name|holder)|customer\s+name|service\s+(?:for|to))[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\s{2,}|\n|$)/,
    /(?:bill(?:ed)?\s+to|invoice\s+to)[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\n|$)/,
    /(?:name)[:\s]+([A-Z][a-zA-Z\s,]{2,40})(?:\n|$)/,
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m) { const n = m[1].trim(); if (n.length > 2 && n.length < 60) return n; }
  }
  return undefined;
}

// kWh
function extractKwh(text) {
  const monthlyPatterns = [
    /energy\s+([0-9,]+)\s*kwh\s*@/i,
    /([1-9][0-9,]{2,})\s*kwh\s+\d+\s*days/i,
    /kwh\s+usage[^0-9]*(?:\d+\s+)?([0-9,]{3,})/i,
    /multiplier\s+kwh\s+usage[^0-9]*\d+\s+([0-9,]+)/i,
    /(?:total\s+)?(?:energy\s+)?(?:usage|used|consumption|kwh\s+used)[:\s]+([0-9,]+)\s*kwh/i,
    /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
    /([0-9,]+)\s*kw[h-]?\s*@/i,
  ];
  for (const p of monthlyPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 100000) return val;
    }
  }
  return undefined;
}

// Address
function extractServiceAddress(text) {
  const addrPatterns = [
    /(?:service\s+address|premises|property\s+address)[:\s]+([0-9]+[^,\n]+,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/i,
    /(?:service\s+address|premises)[:\s]+([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Hwy|Pkwy)[.,\s]+[A-Za-z\s]+,\s*[A-Z]{2})/i,
    /([0-9]+\s+[A-Z][A-Z\s]+(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|HWY)\s+[A-Z][A-Z\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/,
    /(?:service\s+address)[:\s]+([0-9]+\s+[A-Z][A-Z\s,]+?)(?:\s+Service\s+Location|\s+Rate\s+Schedule|\s+Meter\s+No|\s{3,}|$)/i,
    /^([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b[^,\n]*,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/im,
  ];
  for (const p of addrPatterns) {
    const m = text.match(p);
    if (m) { const a = m[1].trim(); if (a.length > 10 && a.length < 150) return a; }
  }
  return undefined;
}

// Utility
const UTILITY_PATTERNS = [
  [/pacific\s+gas\s+(?:and|&)\s+electric|pg&e|pge/i, 'PG&E'],
  [/ameren/i, 'Ameren'],
  [/comed\b|commonwealth\s+edison/i, 'ComEd'],
  [/southwestern\s+electric\s+cooperative/i, 'Southwestern Electric Cooperative'],
  [/southwestern\s+public\s+service|sps\b/i, 'Southwestern Public Service'],
];
function extractUtilityName(text) {
  for (const [p, name] of UTILITY_PATTERNS) {
    if (p.test(text)) return name;
  }
  const g = text.match(/([A-Z][a-zA-Z\s]{2,30}(?:Electric(?:ity)?|Power|Energy|Light(?:ing)?|Gas|Utilities?|Cooperative|Coop\b))/);
  if (g) { const n = g[1].trim(); if (n.length > 4 && n.length < 60) return n; }
  return undefined;
}

// Rate
function extractRate(text) {
  const ratePatterns = [
    /(?:energy\s+)?(?:charge|rate|price)[:\s]+\$?([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /\$([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /kwh\s+@\s+\$?([0-9]+\.[0-9]{3,5})/i,
    /(?:unit\s+)?(?:rate|price)[:\s]+([0-9]+\.[0-9]{3,5})/i,
  ];
  for (const p of ratePatterns) {
    const m = text.match(p);
    if (m) {
      let rate = parseFloat(m[1]);
      if (rate > 1) rate = rate / 100;
      if (rate > 0.01 && rate < 1.5) return Math.round(rate * 10000) / 10000;
    }
  }
  return undefined;
}

// Total
function extractTotalAmount(text) {
  const totalPatterns = [
    /(?:total\s+)?(?:amount\s+)?(?:due|owed|billed)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /(?:current\s+)?(?:charges?|bill)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /total[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /\$([0-9,]+\.[0-9]{2})\s+(?:total|due|owed)/i,
  ];
  for (const p of totalPatterns) {
    const m = text.match(p);
    if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > 0 && v < 100000) return v; }
  }
  return undefined;
}

// Account number
function extractAccountNumber(text) {
  const acctPatterns = [
    /(?:account\s+(?:number|no\.?|#))[:\s]+([0-9\-\s]{6,20})/i,
    /(?:acct\.?\s*(?:no\.?|#)?)[:\s]+([0-9\-\s]{6,20})/i,
    /(?:account)[:\s]+([0-9]{6,20})/i,
    /account\s+#\s*([0-9]{6,20})/i,
  ];
  for (const p of acctPatterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return undefined;
}

console.log('=== FULL EXTRACTION RESULTS ===');
console.log('Customer Name:', extractCustomerName(text));
console.log('Monthly kWh:', extractKwh(text));
console.log('Annual kWh (estimated):', (extractKwh(text) || 0) * 12);
console.log('Service Address:', extractServiceAddress(text));
console.log('Utility Provider:', extractUtilityName(text));
console.log('Rate ($/kWh):', extractRate(text));
console.log('Total Amount:', extractTotalAmount(text));
console.log('Account Number:', extractAccountNumber(text));