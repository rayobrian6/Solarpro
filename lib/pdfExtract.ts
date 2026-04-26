/**
 * lib/pdfExtract.ts
 * Pure Node.js PDF text extractor — zero external dependencies.
 * Uses only built-in zlib to decompress PDF FlateDecode streams,
 * then extracts text from PDF content stream operators (Tj, TJ, ', ").
 * Works on Vercel serverless (no canvas, no DOMMatrix, no workers needed).
 */

import { inflateSync } from 'zlib';

/**
 * Extract all text from a PDF buffer using pure Node.js.
 * Handles FlateDecode compressed streams (most modern PDFs).
 * Returns empty string if PDF has no extractable text (e.g. scanned image PDFs).
 */
export function extractPdfTextPure(buffer: Buffer): string {
  let allText = '';

  let searchPos = 0;

  while (searchPos < buffer.length) {
    // Find next 'stream' keyword
    const streamKeyword = buffer.indexOf(Buffer.from('stream'), searchPos);
    if (streamKeyword === -1) break;

    // Skip past 'stream\r\n' or 'stream\n'
    let dataStart = streamKeyword + 6;
    if (buffer[dataStart] === 13) dataStart++; // \r
    if (buffer[dataStart] === 10) dataStart++; // \n

    // Find matching 'endstream'
    const endStream = buffer.indexOf(Buffer.from('endstream'), dataStart);
    if (endStream === -1) break;

    const streamData = buffer.slice(dataStart, endStream);

    // Try FlateDecode decompression
    try {
      const decompressed = inflateSync(streamData);
      const text = decompressed.toString('latin1');
      const extracted = extractTextFromContentStream(text);
      if (extracted) allText += extracted + ' ';
    } catch {
      // Not zlib compressed — try raw content stream
      try {
        const text = streamData.toString('latin1');
        const extracted = extractTextFromContentStream(text);
        if (extracted) allText += extracted + ' ';
      } catch {
        // Skip this stream
      }
    }

    searchPos = endStream + 9;
  }

  return allText.trim();
}

/**
 * Extract text from a PDF content stream using PDF operators:
 * (text) Tj  — show text string
 * [(text)] TJ — show text array
 * (text) '   — move to next line and show text
 * (text) "   — set word/char spacing and show text
 */
function extractTextFromContentStream(stream: string): string {
  let text = '';

  // Match (text) Tj/TJ/'/"  — single string operators
  const tjRegex = /\(([^)\\]{0,500}(?:\\.[^)\\]{0,500})*)\)\s*T[jJ'"]/g;
  let match: RegExpExecArray | null;

  while ((match = tjRegex.exec(stream)) !== null) {
    const raw = match[1];
    const decoded = decodePdfString(raw);
    if (decoded.trim()) text += decoded + ' ';
  }

  // Match [(text1)(text2)...] TJ — array operator
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(stream)) !== null) {
    const arrayContent = match[1];
    // Extract all strings from the array
    const strRegex = /\(([^)\\]{0,500}(?:\\.[^)\\]{0,500})*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRegex.exec(arrayContent)) !== null) {
      const decoded = decodePdfString(strMatch[1]);
      if (decoded.trim()) text += decoded;
    }
    if (text && !text.endsWith(' ')) text += ' ';
  }

  return text.trim();
}

/**
 * Decode PDF string escape sequences
 */
function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}