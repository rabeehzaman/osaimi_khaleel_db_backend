// Enhanced column name cleaning that handles duplicates
function cleanColumnNameWithDuplicateHandling(columnNames) {
  const cleanedNames = [];
  const seenNames = new Set();
  
  columnNames.forEach(columnName => {
    let cleanName = columnName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
    
    // Handle duplicates by adding a suffix
    let finalName = cleanName;
    let counter = 1;
    while (seenNames.has(finalName)) {
      finalName = `${cleanName}_${counter}`;
      counter++;
    }
    
    seenNames.add(finalName);
    cleanedNames.push(finalName);
  });
  
  return cleanedNames;
}

const headers = [
  "Account ID",
  "Account Name", 
  "Account Type",
  "Created Time",
  "Last Modified Time",
  "Account Base Type",
  "Parent Account ID",
  "Account Code",
  "Account Type Balance sheet",
  "Account Group",
  "Balance sheet base type",
  "Balance Sheet Account Type",
  "Balance Sheet Account Name",
  "P&L Base Type",
  "Account Type P&L",
  "Cash Flow - Type",
  "Base Type P&L",
  "P&L Gross Type",
  "P&L Operating Profit Type",
  "Cash Flow Type"
];

console.log("Fixed column names:");
const cleaned = cleanColumnNameWithDuplicateHandling(headers);
headers.forEach((header, index) => {
  console.log(`"${header}" -> "${cleaned[index]}"`);
});

// Generate CREATE TABLE statement
console.log("\nCREATE TABLE statement:");
const columns = cleaned.map(name => `${name} TEXT`).join(', ');
console.log(`CREATE TABLE accounts (id SERIAL PRIMARY KEY, ${columns}, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);