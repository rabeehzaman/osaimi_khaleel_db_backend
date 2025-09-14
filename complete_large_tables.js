// Complete import of the two largest tables that were interrupted
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
  
  return { rows, headerMapping, totalColumns: headers.length };
}

async function completeTableImport(tableName) {
  try {
    console.log(`\n📄 Completing ${tableName} import...`);
    
    // First, clear any partial data
    console.log(`🗑️  Clearing partial data from ${tableName}...`);
    await supabase.from(tableName).delete().neq('id', 0);
    
    const csvPath = `./exports/${tableName}_2025-07-25.csv`;
    const content = fs.readFileSync(csvPath, 'utf8');
    const { rows } = parseCSV(content);
    
    console.log(`📊 Total records to import: ${rows.length}`);
    
    // Use smaller batch size for large tables
    const batchSize = 500;
    let totalInserted = 0;
    const totalBatches = Math.ceil(rows.length / batchSize);
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      process.stdout.write(`📥 Batch ${batchNum}/${totalBatches} (${batch.length} records)... `);
      
      const { data, error } = await supabase
        .from(tableName)
        .insert(batch);
      
      if (error) {
        console.error(`\n❌ Batch ${batchNum} failed:`, error.message);
        return { success: false, imported: totalInserted, total: rows.length };
      }
      
      totalInserted += batch.length;
      console.log(`✅`);
      
      // Progress indicator for every 20 batches
      if (batchNum % 20 === 0) {
        const progress = ((totalInserted / rows.length) * 100).toFixed(1);
        console.log(`   📊 Progress: ${totalInserted.toLocaleString()}/${rows.length.toLocaleString()} (${progress}%)`);
      }
    }
    
    console.log(`✅ ${tableName}: ${totalInserted} records imported successfully`);
    return { success: true, imported: totalInserted, total: rows.length };
    
  } catch (error) {
    console.error(`❌ Error importing ${tableName}:`, error.message);
    return { success: false, imported: 0, total: 0 };
  }
}

async function main() {
  console.log('🚀 COMPLETING LARGE TABLE IMPORTS');
  console.log('==================================');
  console.log(`🕐 Started at: ${new Date().toISOString()}\n`);
  
  const largeTables = ['fifo_mapping', 'accrual_transactions'];
  const results = [];
  
  for (const tableName of largeTables) {
    const result = await completeTableImport(tableName);
    results.push({ tableName, ...result });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 LARGE TABLE IMPORT RESULTS');
  console.log('='.repeat(60));
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.tableName}: ${result.imported.toLocaleString()}/${result.total.toLocaleString()} records`);
  });
  
  const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
  console.log(`\n📊 Total additional records imported: ${totalImported.toLocaleString()}`);
  console.log(`🕐 Completed at: ${new Date().toISOString()}`);
}

if (require.main === module) {
  main().catch(console.error);
}