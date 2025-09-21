// Import crypto for testing
const crypto = require('crypto');

// Mock the cleanColumnName and cleanHeaders functions from the class
function cleanColumnName(columnName, fallbackIndex = null) {
  // Handle empty or null column names
  if (!columnName || typeof columnName !== 'string' || !columnName.trim()) {
    return fallbackIndex !== null ? `col_${fallbackIndex}_empty` : 'unnamed_column';
  }

  // Check for non-Latin characters (Arabic, Chinese, etc.)
  const hasNonLatin = /[^\x00-\x7F]/.test(columnName);

  if (hasNonLatin && fallbackIndex !== null) {
    // For non-Latin text, create a stable hash-based name
    const hash = crypto.createHash('md5')
      .update(columnName)
      .digest('hex')
      .substring(0, 8);
    return `col_${fallbackIndex}_${hash}`;
  }

  // Standard cleaning for Latin characters
  let cleaned = columnName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 63); // PostgreSQL column name limit

  // If cleaning results in empty string, provide fallback
  if (!cleaned) {
    return fallbackIndex !== null ? `col_${fallbackIndex}_cleaned` : 'unnamed_column';
  }

  return cleaned;
}

function cleanHeaders(headers) {
  const cleanedHeaders = [];
  const seenNames = new Set();
  const headerMapping = {};

  console.log(`📋 Processing ${headers.length} column headers for language-safe naming`);

  headers.forEach((header, index) => {
    // Use position-aware cleaning that handles non-Latin characters
    let cleanName = cleanColumnName(header, index);

    // Log problematic headers for debugging
    const hasNonLatin = /[^\x00-\x7F]/.test(header || '');
    const isEmpty = !header || !header.trim();

    if (hasNonLatin || isEmpty) {
      console.log(`🔤 Column ${index}: "${header}" → "${cleanName}" (${hasNonLatin ? 'non-Latin' : 'empty'})`);
    }

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

  console.log(`✅ Generated stable column names: ${cleanedHeaders.join(', ')}`);

  return { cleanedHeaders, headerMapping };
}

// Test cases for multilingual column names
const testHeaders = [
  '',                    // Empty header
  'Customer ID',         // English
  'العملاء',              // Arabic
  'Customer Name',       // English
  'اسم العميل',          // Arabic
  '客户',                // Chinese
  null,                  // Null header
  'פריט',               // Hebrew
  'Status',              // English
  '状态'                 // Chinese status
];

console.log('🧪 Testing multilingual column name handling...\n');

console.log('📋 Original Headers:');
testHeaders.forEach((header, index) => {
  console.log(`  ${index}: "${header}"`);
});

console.log('\n🔧 Testing cleanColumnName function:');
testHeaders.forEach((header, index) => {
  const cleaned = cleanColumnName(header, index);
  console.log(`  ${index}: "${header}" → "${cleaned}"`);
});

console.log('\n🔄 Testing cleanHeaders function:');
const result = cleanHeaders(testHeaders);

console.log('\n📊 Results:');
console.log('Cleaned Headers:', result.cleanedHeaders);
console.log('Header Mapping:');
Object.entries(result.headerMapping).forEach(([original, cleaned]) => {
  console.log(`  "${original}" → "${cleaned}"`);
});

console.log('\n✅ Test completed! All column names should be valid PostgreSQL identifiers.');