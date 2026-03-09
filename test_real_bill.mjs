import { createRequire } from 'module';
import { inflateSync } from 'zlib';
import { readFileSync } from 'fs';

function extractTextFromContentStream(content) {
  let text = '';
  // Match Tj operator: (text) Tj
  const tjPattern = /\(([^)]*)\)\s*Tj/g;
  let m;
  while ((m = tjPattern.exec(content)) !== null) {
    text += m[1] + ' ';
  }
  // Match TJ operator: [(text) ...] TJ
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
    } catch { /* skip non-compressed streams */ }
    searchPos = endStream + 9;
  }
  return allText.trim();
}

const buffer = readFileSync('2026_01_20_15594002.pdf');
const text = extractPdfTextPure(buffer);
console.log('=== EXTRACTED TEXT ===');
console.log(text);
console.log('\n=== LENGTH:', text.length, '===');

// Now test the key patterns against real text
console.log('\n=== PATTERN TESTS ON REAL TEXT ===');

// kWh
const kwhMatch = text.match(/energy\s+([0-9,]+)\s*kwh\s*@/i);
console.log('kWh (energy @ pattern):', kwhMatch ? kwhMatch[1] : 'NO MATCH');

const kwhMatch2 = text.match(/([1-9][0-9,]{2,})\s*kwh\s+\d+\s*days/i);
console.log('kWh (N kWh N days):', kwhMatch2 ? kwhMatch2[1] : 'NO MATCH');

// Address
const addrMatch = text.match(/([0-9]+\s+[A-Z][A-Z\s]+(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|HWY)\s+[A-Z][A-Z\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/);
console.log('Address (mailing block):', addrMatch ? addrMatch[1] : 'NO MATCH');

const addrMatch2 = text.match(/(?:service\s+address)[:\s]+([0-9]+\s+[A-Z][A-Z\s,]+?)(?:\s+Service\s+Location|\s+Rate\s+Schedule|\s+Meter\s+No|\s{3,}|$)/i);
console.log('Address (service addr):', addrMatch2 ? addrMatch2[1] : 'NO MATCH');

// Utility
const utilMatch = text.match(/southwestern\s+electric\s+cooperative/i);
console.log('Utility:', utilMatch ? 'Southwestern Electric Cooperative' : 'NO MATCH');

// Rate
const rateMatch = text.match(/kwh\s+@\s+\$?([0-9]+\.[0-9]{3,5})/i);
console.log('Rate:', rateMatch ? '$' + rateMatch[1] + '/kWh' : 'NO MATCH');

// Total
const totalMatch = text.match(/(?:total\s+)?(?:amount\s+)?(?:due|owed|billed)[:\s]+\$([0-9,]+\.[0-9]{2})/i);
console.log('Total:', totalMatch ? '$' + totalMatch[1] : 'NO MATCH');