// Re-import bills table from CSV to get all 1,784 records
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
  
  // Parse header line manually to handle quoted fields
  const headerLine = lines[0];
  const headerMatches = headerLine.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
  const headers = headerMatches.map(match => 
    match.replace(/^,/, '').replace(/^"|"$/g, '')
  );
  
  const { cleanedHeaders, headerMapping } = cleanHeaders(headers);
  console.log(`📋 Headers: ${headers.length} columns`);
  
  const rows = [];
  
  // Parse data lines with proper CSV handling
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
    
    if (matches && matches.length === headers.length) {
      const values = matches.map(match => 
        match.replace(/^,/, '').replace(/^"|"$/g, '').trim()
      );
      
      const row = {};
      headers.forEach((header, index) => {
        const cleanKey = headerMapping[header];
        let value = values[index];
        
        // Handle empty values
        if (value === '' || value === null || value === undefined) {
          value = null;
        } else if (typeof value === 'string') {
          value = value.trim();
          // Remove carriage returns that might cause issues
          value = value.replace(/\r/g, '');
        }
        
        row[cleanKey] = value;
      });
      rows.push(row);
    } else {
      console.warn(`⚠️  Line ${i + 1}: Column mismatch - expected ${headers.length}, got ${matches ? matches.length : 0}`);
    }
  }
  
  return { rows, headerMapping, totalColumns: headers.length };
}

async function reimportBills() {
  try {
    console.log('🚀 RE-IMPORTING BILLS FROM CSV');
    console.log('='.repeat(50));
    console.log(`🕐 Started at: ${new Date().toISOString()}\n`);
    
    // 1. Read and parse CSV
    console.log('📄 Reading bills CSV...');
    const csvPath = './exports/bills_2025-07-25.csv';
    const content = fs.readFileSync(csvPath, 'utf8');
    const { rows, headerMapping } = parseCSV(content);
    
    console.log(`✅ Parsed ${rows.length} rows from CSV`);
    
    // 2. Create fresh table schema
    console.log('\n🔧 Creating fresh table schema...');
    const columns = Object.values(headerMapping).map(col => `${col} TEXT`).join(', ');
    
    const createSQL = `
      DROP TABLE IF EXISTS bills CASCADE;
      CREATE TABLE bills (
        id SERIAL PRIMARY KEY,
        ${columns},
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS bills_created_at_idx ON bills (created_at);
      CREATE INDEX IF NOT EXISTS bills_bill_date_idx ON bills (bill_date);
      CREATE INDEX IF NOT EXISTS bills_vendor_id_idx ON bills (vendor_id);
    `;
    
    const { error: createError } = await supabase.rpc('exec_sql', { sql_text: createSQL });
    
    if (createError) {
      console.error('❌ Failed to create table:', createError.message);
      return;
    }
    
    console.log('✅ Table created successfully');
    
    // 3. Import data in optimized batches
    console.log('\n📥 Importing data in batches...');
    const batchSize = 500; // Smaller batches for reliability
    let totalInserted = 0;
    const totalBatches = Math.ceil(rows.length / batchSize);
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      process.stdout.write(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} records)... `);
      
      const { data, error } = await supabase
        .from('bills')
        .insert(batch);
      
      if (error) {
        console.error(`\n❌ Batch ${batchNum} failed:`, error.message);
        console.error('Sample row:', JSON.stringify(batch[0], null, 2));
        break;
      }
      
      totalInserted += batch.length;
      console.log(`✅`);
      
      // Progress update every 10 batches
      if (batchNum % 10 === 0) {
        const progress = ((totalInserted / rows.length) * 100).toFixed(1);
        console.log(`   📊 Progress: ${totalInserted.toLocaleString()}/${rows.length.toLocaleString()} (${progress}%)`);
      }
    }
    
    // 4. Verify import
    console.log('\n🔍 Verifying import...');
    const { count, error: countError } = await supabase
      .from('bills')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ Verification failed:', countError.message);
    } else {
      console.log(`✅ Verification: ${count} bills in database`);
    }
    
    // 5. Check high-value bills specifically
    const { count: highValueCount, error: highValueError } = await supabase
      .from('bills')
      .select('*', { count: 'exact', head: true })
      .like('balance_bcy', '%,%');
    
    if (!highValueError) {
      console.log(`💰 High-value bills (with commas): ${highValueCount}`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ CSV rows parsed: ${rows.length}`);
    console.log(`✅ Database rows: ${count || 'Error checking'}`);
    console.log(`✅ High-value bills: ${highValueCount || 'Error checking'}`);
    console.log(`🕐 Completed at: ${new Date().toISOString()}`);
    
    return {
      success: true,
      csvRows: rows.length,
      dbRows: count,
      highValueBills: highValueCount
    };
    
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    return { success: false, error: error.message };
  }
}

if (require.main === module) {
  reimportBills()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 BILLS RE-IMPORT COMPLETED SUCCESSFULLY!');
        process.exit(0);
      } else {
        console.log('\n💥 BILLS RE-IMPORT FAILED:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Import crashed:', error.message);
      process.exit(1);
    });
}