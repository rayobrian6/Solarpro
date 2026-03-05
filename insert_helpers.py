#!/usr/bin/env python3
import re

# Read the file
with open('lib/db.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the line with "// ─── Solar Panels" and insert before it
helper_code = '''
const DB_FILE = path.join(process.cwd(), 'data', 'solarpro.db');
const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load data from file if exists
function loadFromFile<T>(key: string, defaultValue: T): T {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      return data[key] || defaultValue;
    }
  } catch (e) {
    console.error('Error loading from file:', e);
  }
  return defaultValue;
}

// Save data to file
function saveToFile(key: string, data: any) {
  try {
    let allData: any = {};
    if (fs.existsSync(DB_FILE)) {
      allData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
    allData[key] = data;
    fs.writeFileSync(DB_FILE, JSON.stringify(allData, null, 2));
  } catch (e) {
    console.error('Error saving to file:', e);
  }
}
'''

# Insert before the Solar Panels comment
content = content.replace(
    "// ─── Solar Panels (Real Market Data 2024) ────────────────────────────────────",
    helper_code + "\n// ─── Solar Panels (Real Market Data 2024) ────────────────────────────────────"
)

# Write the file
with open('lib/db.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Helper functions inserted")