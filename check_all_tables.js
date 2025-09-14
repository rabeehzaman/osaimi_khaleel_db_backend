// Check status of all tables
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const tables = [
  'accounts', 'accrual_transactions', 'bills', 'branch', 'credit_note_items',
  'credit_notes', 'customers', 'fifo_mapping', 'invoice_items', 'invoices',
  'items', 'sales_persons', 'stock_in_flow', 'stock_out_flow', 'transfer_order',
  'transfer_order_items', 'vendors', 'warehouses'
];

async function checkTable(tableName) {
  try {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      return { tableName, status: 'ERROR', count: 0, error: error.message };
    }
    
    return { tableName, status: 'OK', count, error: null };
  } catch (err) {
    return { tableName, status: 'ERROR', count: 0, error: err.message };
  }
}

async function main() {
  console.log('🔍 Checking all 18 tables...\n');
  
  const results = [];
  let totalRecords = 0;
  
  for (const table of tables) {
    const result = await checkTable(table);
    results.push(result);
    
    if (result.status === 'OK') {
      totalRecords += result.count;
      console.log(`✅ ${table.padEnd(20)} ${result.count.toLocaleString().padStart(8)} records`);
    } else {
      console.log(`❌ ${table.padEnd(20)} ERROR: ${result.error}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.status === 'OK');
  const failed = results.filter(r => r.status === 'ERROR');
  
  console.log(`✅ Successful tables: ${successful.length}/18`);
  console.log(`❌ Failed tables: ${failed.length}/18`);
  console.log(`📊 Total records imported: ${totalRecords.toLocaleString()}`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed tables:');
    failed.forEach(f => console.log(`   - ${f.tableName}: ${f.error}`));
  }
  
  console.log('\n🎉 Import process analysis completed!');
}

if (require.main === module) {
  main().catch(console.error);
}