// Deep investigation of empty error {} pattern causing batch failures
const fs = require('fs');
const SupabaseBulkClient = require('./src/supabase-bulk-client');
require('dotenv').config();

async function investigateEmptyErrors() {
  console.log('🔍 DEEP INVESTIGATION: Empty Error {} Pattern');
  console.log('='.repeat(60));
  
  // Force raw mode
  process.env.RAW_TEXT_IMPORT = 'true';
  
  const client = new SupabaseBulkClient({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY
  });
  
  // Test the bills table that showed 44% success rate
  console.log('📄 Testing bills table that failed at batch 1...');
  
  try {
    const csvData = fs.readFileSync('./exports/bills_2025-07-25.csv', 'utf8');
    const { headers, data } = await client.parseCSVData(csvData);
    
    console.log(`📊 Total records: ${data.length}`);
    console.log(`📋 Headers: ${headers.length} columns`);
    
    // Test different batch sizes to isolate the issue
    const testConfigs = [
      { batchSize: 1, description: 'Single record batches' },
      { batchSize: 10, description: 'Small batches (10 records)' },
      { batchSize: 100, description: 'Medium batches (100 records)' },
      { batchSize: 500, description: 'Large batches (500 records)' },
      { batchSize: 1000, description: 'Original batch size (1000 records)' }
    ];
    
    for (const config of testConfigs) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`🧪 Testing: ${config.description}`);
      
      try {
        // Test just the first few batches to identify the problematic batch
        const result = await testBatchInsertion(client, 'bills_test', data, headers, config.batchSize, 3);
        
        console.log(`📊 Result: ${result.successful}/${result.total} batches successful`);
        console.log(`📈 Records: ${result.totalInserted}/${result.totalAttempted} inserted`);
        
        if (result.errors.length > 0) {
          console.log(`❌ Errors found:`);
          result.errors.forEach(error => {
            console.log(`   • Batch ${error.batch}: ${error.error || 'Empty error {}'}`);
            if (error.sampleData) {
              console.log(`     Sample data: ${JSON.stringify(error.sampleData, null, 2).substring(0, 300)}...`);
            }
          });
        }
        
        // If we found a working batch size, note it
        if (result.successful === result.total) {
          console.log(`✅ WORKING CONFIGURATION: ${config.description}`);
        }
        
      } catch (error) {
        console.error(`❌ Test failed:`, error.message);
      }
    }
    
    // Test specific problematic records
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🔍 ANALYZING FIRST 10 RECORDS (likely problematic batch)`);
    
    const firstTenRecords = data.slice(0, 10);
    firstTenRecords.forEach((record, index) => {
      console.log(`\n📋 Record ${index + 1}:`);
      
      // Check for potential issues
      const issues = [];
      Object.entries(record).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          if (value.includes('\n')) issues.push(`${key}: contains newlines`);
          if (value.includes('\r')) issues.push(`${key}: contains carriage returns`);
          if (value.includes('"')) issues.push(`${key}: contains quotes`);
          if (value.includes(',') && !key.includes('bcy')) issues.push(`${key}: contains commas`);
          if (value.length > 1000) issues.push(`${key}: very long (${value.length} chars)`);
          if (value.includes('\\')) issues.push(`${key}: contains backslashes`);
        }
      });
      
      if (issues.length > 0) {
        console.log(`   ⚠️  Potential issues: ${issues.join(', ')}`);
      } else {
        console.log(`   ✅ No obvious issues detected`);
      }
      
      // Show a few key fields
      console.log(`   📝 Key fields: bill_id=${record['Bill ID']}, total=${record['Total (BCY)']}, balance=${record['Balance (BCY)']}`);
    });
    
  } catch (error) {
    console.error('❌ Investigation failed:', error.message);
  }
}

async function testBatchInsertion(client, tableName, data, headers, batchSize, maxBatches = null) {
  const cleanTableName = client.cleanColumnName(tableName);
  
  // Drop and recreate table
  try {
    await client.supabase.rpc('exec_sql', { 
      sql_text: `DROP TABLE IF EXISTS "${cleanTableName}" CASCADE;` 
    });
  } catch (e) {
    // Ignore drop errors
  }
  
  // Create table
  const sql = client.generateCreateTableSQL(tableName, headers);
  await client.supabase.rpc('exec_sql', { sql_text: sql });
  
  // Test insertion with specific batch size
  const { cleanedHeaders, headerMapping } = client.cleanHeaders(headers);
  
  const result = {
    total: 0,
    successful: 0,
    totalAttempted: 0,
    totalInserted: 0,
    errors: []
  };
  
  const batches = Math.ceil(data.length / batchSize);
  const maxBatchesToTest = maxBatches || batches;
  
  for (let i = 0; i < Math.min(maxBatchesToTest, batches); i++) {
    const startIdx = i * batchSize;
    const endIdx = Math.min(startIdx + batchSize, data.length);
    const batch = data.slice(startIdx, endIdx);
    
    result.total++;
    result.totalAttempted += batch.length;
    
    // Clean the batch data (use raw mode)
    const cleanBatch = batch.map(row => {
      const cleanRow = {};
      Object.keys(row).forEach(key => {
        const cleanKey = headerMapping[key] || client.cleanColumnName(key);
        let value = row[key];
        
        // Raw mode - minimal cleaning
        if (value === '' || value === null || value === undefined) {
          value = null;
        } else if (typeof value === 'string') {
          value = value.trim().replace(/\r/g, '');
        }
        
        cleanRow[cleanKey] = value;
      });
      return cleanRow;
    });
    
    try {
      const { data: insertedData, error } = await client.supabase
        .from(cleanTableName)
        .insert(cleanBatch);
      
      if (error) {
        result.errors.push({
          batch: i + 1,
          error: error.message || JSON.stringify(error) || 'Empty error {}',
          sampleData: cleanBatch[0],
          batchSize: batch.length
        });
      } else {
        result.successful++;
        result.totalInserted += batch.length;
      }
    } catch (insertError) {
      result.errors.push({
        batch: i + 1,
        error: insertError.message,
        sampleData: cleanBatch[0],
        batchSize: batch.length
      });
    }
  }
  
  return result;
}

if (require.main === module) {
  investigateEmptyErrors()
    .then(() => {
      console.log('\n🏁 Investigation completed');
    })
    .catch(error => {
      console.error('💥 Investigation crashed:', error);
      process.exit(1);
    });
}