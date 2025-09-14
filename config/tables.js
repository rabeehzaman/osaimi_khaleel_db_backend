// Zoho Analytics table configurations for bulk export
const BULK_EXPORT_TABLES = [
  // Test table for UltraThink organization
  {
    viewId: '3097791000000168099',
    tableName: 'customers',
    description: 'Customer contact data from Zoho Books',
    estimatedRows: 1000,
    priority: 'high'
  }
];

// Export configuration
const EXPORT_CONFIG = {
  defaultFormat: 'csv',
  maxRetries: 3,
  retryDelay: 5000,
  batchSize: 1, // Small batch for testing
  timeout: 300000
};

module.exports = {
  BULK_EXPORT_TABLES,
  EXPORT_CONFIG
};