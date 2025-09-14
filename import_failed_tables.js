// Import only the 4 failed tables
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

function cleanHeaders(headers) {
  const cleanedHeaders = [];
  const seenNames = new Set();
  const headerMapping = {};
  
  headers.forEach(header => {
    let cleanName = cleanColumnName(header);
    
    let finalName = cleanName;
    let counter = 1;
    while (seenNames.has(finalName)) {
      finalName = `${cleanName}_${counter}`;
      counter++;
    }
    
    seenNames.add(finalName);
    cleanedHeaders.push(finalName);
    headerMapping[header] = finalName;
  });
  
  return { cleanedHeaders, headerMapping };
}

function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const { cleanedHeaders, headerMapping } = cleanHeaders(headers);
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        const cleanKey = headerMapping[header];
        let value = values[index];
        
        if (value === '' || value === null || value === undefined) {
          value = null;
        } else if (typeof value === 'string') {
          value = value.trim();
        }
        
        row[cleanKey] = value;
      });
      rows.push(row);
    }
  }
  
  return rows;
}

async function importTable(tableName) {
  try {
    console.log(`\n📄 Importing ${tableName}...`);
    
    const csvPath = `./exports/${tableName}_2025-07-25.csv`;
    if (!fs.existsSync(csvPath)) {
      console.log(`❌ CSV file not found: ${csvPath}`);
      return false;
    }
    
    const content = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(content);
    
    console.log(`📊 Parsed ${rows.length} rows from CSV`);
    
    // Import in batches
    const batchSize = 500; // Smaller batches for better error handling
    let totalInserted = 0;
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      console.log(`📥 Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(rows.length/batchSize)} (${batch.length} records)...`);
      
      const { data, error } = await supabase
        .from(tableName)
        .insert(batch);
      
      if (error) {
        console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
        console.error(`Error details:`, error);
        return false;
      }
      
      totalInserted += batch.length;
      console.log(`✅ Batch ${Math.floor(i/batchSize) + 1} inserted successfully`);
    }
    
    console.log(`✅ ${tableName}: ${totalInserted} records imported successfully`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error importing ${tableName}:`, error.message);
    return false;
  }
}

async function main() {
  const failedTables = [
    'credit_notes',
    'credit_note_items', 
    'items',
    'accrual_transactions'
  ];
  
  console.log('🚀 Starting import of failed tables...');
  
  const results = {};
  
  for (const table of failedTables) {
    const success = await importTable(table);
    results[table] = success;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(60));
  
  const successful = Object.entries(results).filter(([_, success]) => success);
  const failed = Object.entries(results).filter(([_, success]) => !success);
  
  console.log(`✅ Successful: ${successful.length}`);
  successful.forEach(([table]) => console.log(`   - ${table}`));
  
  console.log(`❌ Failed: ${failed.length}`);
  failed.forEach(([table]) => console.log(`   - ${table}`));
}

if (require.main === module) {
  main().catch(console.error);
}