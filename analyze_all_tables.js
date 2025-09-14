// Analyze all CSV files for column name conflicts and generate table creation scripts
const fs = require('fs');
const path = require('path');

function cleanColumnName(columnName) {
  return columnName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 63); // PostgreSQL column name limit
}

function cleanHeaders(headers) {
  const cleanedHeaders = [];
  const seenNames = new Set();
  const headerMapping = {};
  
  headers.forEach(header => {
    let cleanName = cleanColumnName(header);
    
    // Handle duplicates by adding a suffix
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

function analyzeCsv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const { cleanedHeaders, headerMapping } = cleanHeaders(headers);
    
    // Check for conflicts
    const conflicts = [];
    const originalClean = headers.map(h => cleanColumnName(h));
    const duplicates = originalClean.filter((item, index) => originalClean.indexOf(item) !== index);
    
    if (duplicates.length > 0) {
      const uniqueDuplicates = [...new Set(duplicates)];
      uniqueDuplicates.forEach(dup => {
        const originals = headers.filter(h => cleanColumnName(h) === dup);
        conflicts.push({ cleanName: dup, originals });
      });
    }
    
    return {
      fileName: path.basename(filePath),
      tableName: path.basename(filePath, '.csv').replace('_2025-07-25', ''),
      totalColumns: headers.length,
      headers,
      cleanedHeaders,
      conflicts,
      headerMapping
    };
  } catch (error) {
    return { fileName: path.basename(filePath), error: error.message };
  }
}

// Analyze all CSV files
const exportsDir = './exports';
const csvFiles = fs.readdirSync(exportsDir).filter(f => f.endsWith('.csv'));

console.log('='.repeat(80));
console.log('CSV ANALYSIS REPORT');
console.log('='.repeat(80));

const results = csvFiles.map(file => analyzeCsv(path.join(exportsDir, file)));

// Summary
console.log('\n📊 SUMMARY:');
console.log(`Total tables: ${results.length}`);
console.log(`Tables with conflicts: ${results.filter(r => r.conflicts && r.conflicts.length > 0).length}`);
console.log(`Tables with errors: ${results.filter(r => r.error).length}`);

// Detailed analysis
console.log('\n📋 DETAILED ANALYSIS:');
results.forEach(result => {
  if (result.error) {
    console.log(`\n❌ ${result.fileName}: ERROR - ${result.error}`);
    return;
  }
  
  console.log(`\n📄 ${result.tableName} (${result.totalColumns} columns)`);
  
  if (result.conflicts.length > 0) {
    console.log(`  ⚠️  CONFLICTS FOUND:`);
    result.conflicts.forEach(conflict => {
      console.log(`     "${conflict.cleanName}" <- ${conflict.originals.map(o => `"${o}"`).join(', ')}`);
    });
  } else {
    console.log(`  ✅ No conflicts`);
  }
});

// Generate SQL creation statements
console.log('\n' + '='.repeat(80));
console.log('SQL TABLE CREATION STATEMENTS');
console.log('='.repeat(80));

results.forEach(result => {
  if (result.error) return;
  
  const columns = result.cleanedHeaders.map(col => `${col} TEXT`).join(',\n    ');
  
  console.log(`\n-- ${result.tableName.toUpperCase()} TABLE`);
  console.log(`DROP TABLE IF EXISTS ${result.tableName};`);
  console.log(`CREATE TABLE ${result.tableName} (`);
  console.log(`    id SERIAL PRIMARY KEY,`);
  console.log(`    ${columns},`);
  console.log(`    created_at TIMESTAMP DEFAULT NOW(),`);
  console.log(`    updated_at TIMESTAMP DEFAULT NOW()`);
  console.log(`);`);
  console.log(`CREATE INDEX IF NOT EXISTS ${result.tableName}_created_at_idx ON ${result.tableName} (created_at);`);
});

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(80));