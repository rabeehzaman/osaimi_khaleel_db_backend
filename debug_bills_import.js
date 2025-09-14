// Debug bills import to find where we lose data
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cleanColumnName(columnName) {
  return columnName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 63);
}

function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = [];
  const rows = [];
  
  // Parse header line manually to handle quoted fields
  const headerLine = lines[0];
  const headerMatches = headerLine.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
  headerMatches.forEach(match => {
    const cleaned = match.replace(/^,/, '').replace(/^"|"$/g, '');
    headers.push(cleaned);
  });
  
  console.log(`📋 Headers found: ${headers.length}`);
  console.log(`📄 Total lines: ${lines.length - 1}`);
  
  // Parse data lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    const matches = line.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
    
    if (matches) {
      matches.forEach(match => {
        const cleaned = match.replace(/^,/, '').replace(/^"|"$/g, '');
        values.push(cleaned);
      });
      
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          const cleanKey = cleanColumnName(header);
          row[cleanKey] = values[index] || null;
        });
        rows.push(row);
      } else {
        console.warn(`⚠️  Line ${i + 1}: Expected ${headers.length} columns, got ${values.length}`);
      }
    }
  }
  
  console.log(`✅ Successfully parsed ${rows.length} rows`);
  return { rows, headers };
}

async function debugBillsImport() {
  try {
    console.log('🔍 DEBUG: Bills Import Analysis');
    console.log('='.repeat(50));
    
    // Read and parse CSV
    const csvPath = './exports/bills_2025-07-25.csv';
    const content = fs.readFileSync(csvPath, 'utf8');
    const { rows, headers } = parseCSV(content);
    
    console.log(`📊 CSV Analysis:`);
    console.log(`   Total rows parsed: ${rows.length}`);
    console.log(`   Expected: 1781`);
    
    // Check for specific problematic patterns
    let rowsWithCommaAmounts = 0;
    let rowsWithZeroBalance = 0;
    let rowsWithEmptyBalance = 0;
    
    rows.forEach(row => {
      if (row.balance_bcy && row.balance_bcy.includes(',')) {
        rowsWithCommaAmounts++;
      }
      if (row.balance_bcy === 'SAR 0.00') {
        rowsWithZeroBalance++;
      }
      if (!row.balance_bcy || row.balance_bcy === '') {
        rowsWithEmptyBalance++;
      }
    });
    
    console.log(`   Rows with comma amounts: ${rowsWithCommaAmounts}`);
    console.log(`   Rows with zero balance: ${rowsWithZeroBalance}`);
    console.log(`   Rows with empty balance: ${rowsWithEmptyBalance}`);
    
    // Test small batch insertion
    console.log(`\n🧪 Testing small batch insertion...`);
    const testBatch = rows.slice(0, 10);
    
    console.log(`Sample row:`, JSON.stringify(testBatch[0], null, 2));
    
    // Try inserting to test table
    const { data, error } = await supabase
      .from('bills')
      .insert(testBatch.slice(0, 5))
      .select();
    
    if (error) {
      console.error(`❌ Test insertion failed:`, error);
    } else {
      console.log(`✅ Test insertion successful: ${data.length} rows`);
    }
    
    return { totalParsed: rows.length, rowsWithCommaAmounts };
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

if (require.main === module) {
  debugBillsImport().then(result => {
    console.log(`\n📋 Debug Summary:`);
    console.log(`   CSV parsing: ${result.totalParsed} rows`);
    console.log(`   High-value bills: ${result.rowsWithCommaAmounts} rows`);
    console.log(`   Missing bills: ${1781 - result.totalParsed} rows`);
  });
}