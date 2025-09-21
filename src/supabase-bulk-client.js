const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { Pool } = require('pg');

class SupabaseBulkClient {
  constructor(config) {
    // Use service role key for administrative operations (table creation, bulk inserts)
    this.supabase = createClient(config.url, config.serviceRoleKey || config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    
    // Also keep anon client for regular operations if needed
    this.anonClient = createClient(config.url, config.anonKey);
    
    // Extract PostgreSQL connection details from Supabase URL
    this.config = config;
    this.pgPool = null;
    // Setup PostgreSQL connection asynchronously
    this.setupPostgreSQLConnection().catch(error => {
      console.log(`⚠️  PostgreSQL setup failed: ${error.message}`);
      this.pgPool = null;
    });
  }
  
  // Setup direct PostgreSQL connection for COPY operations
  async setupPostgreSQLConnection() {
    try {
      // Disable TLS rejection for Railway environment
      if (process.env.RAILWAY_ENVIRONMENT) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      }
      
      // Parse Supabase URL to get PostgreSQL connection details
      const supabaseUrl = new URL(this.config.url);
      const projectRef = supabaseUrl.hostname.split('.')[0];
      
      // Extract password from service role key or use environment variable
      const pgPassword = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD;
      
      if (pgPassword) {
        // Use pooler connection for Railway to avoid IPv6 issues
        const pgHost = process.env.RAILWAY_ENVIRONMENT
          ? `aws-1-eu-central-1.pooler.supabase.com`  // Use pooler for Railway (EU Central)
          : `db.${projectRef}.supabase.co`;           // Direct for local
        const pgPort = process.env.RAILWAY_ENVIRONMENT ? 6543 : 5432;
        const pgDatabase = process.env.RAILWAY_ENVIRONMENT ? 'postgres' : 'postgres';
        const pgUser = process.env.RAILWAY_ENVIRONMENT ? `postgres.${projectRef}` : 'postgres';
        
        console.log(`🔧 Setting up PostgreSQL connection via ${process.env.RAILWAY_ENVIRONMENT ? 'pooler' : 'direct connection'}`);
        console.log(`🌐 Using connection: ${pgHost}:${pgPort}`);
        console.log(`👤 User: ${pgUser}`);

        // Disable TLS rejection for Railway environment
        if (process.env.RAILWAY_ENVIRONMENT) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        }

        this.pgPool = new Pool({
          host: pgHost,
          port: pgPort,
          database: pgDatabase,
          user: pgUser,
          password: pgPassword,
          ssl: process.env.RAILWAY_ENVIRONMENT ? {
            rejectUnauthorized: false
          } : {
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            ca: false
          },
          max: 1,
          min: 0,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 30000,
          allowExitOnIdle: true
        });
        
        console.log(`✅ PostgreSQL connection configured for db.${projectRef}.supabase.co`);
      } else {
        console.log(`⚠️  PostgreSQL direct connection not available (missing SUPABASE_DB_PASSWORD)`);
        this.pgPool = null;
      }
    } catch (error) {
      console.log(`⚠️  Could not setup PostgreSQL connection: ${error.message}`);
      this.pgPool = null;
    }
  }

  // Parse CSV data into structured format with proper handling of quoted fields containing commas
  parseCSVData(csvData) {
    return new Promise((resolve, reject) => {
      try {
        const lines = csvData.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          resolve({ headers: [], data: [] });
          return;
        }
        
        // Parse header line manually to handle quoted fields
        const headerLine = lines[0];
        const headerMatches = headerLine.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
        const headers = headerMatches.map(match => 
          match.replace(/^,/, '').replace(/^"|"$/g, '').trim()
        );
        
        console.log(`📋 Headers: ${headers.length} columns`);
        console.log(`📄 Total lines: ${lines.length - 1}`);
        
        const results = [];
        
        // Parse data lines with proper CSV handling for quoted fields
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const matches = line.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
          
          if (matches && matches.length === headers.length) {
            const values = matches.map(match => 
              match.replace(/^,/, '').replace(/^"|"$/g, '').trim()
            );
            
            const row = {};
            headers.forEach((header, index) => {
              let value = values[index];
              
              // Handle empty values
              if (value === '' || value === null || value === undefined) {
                value = null;
              } else if (typeof value === 'string') {
                value = value.trim();
                // Remove carriage returns that might cause issues
                value = value.replace(/\r/g, '');
              }
              
              row[header] = value;
            });
            results.push(row);
          } else {
            console.warn(`⚠️  Line ${i + 1}: Column mismatch - expected ${headers.length}, got ${matches ? matches.length : 0}`);
          }
        }
        
        console.log(`✅ Successfully parsed ${results.length} rows`);
        resolve({ headers, data: results });
        
      } catch (error) {
        console.error('❌ CSV parsing failed:', error.message);
        reject(error);
      }
    });
  }

  // Clean column names for Supabase compatibility
  cleanColumnName(columnName, fallbackIndex = null) {
    // Handle empty or null column names
    if (!columnName || typeof columnName !== 'string' || !columnName.trim()) {
      return fallbackIndex !== null ? `col_${fallbackIndex}_empty` : 'unnamed_column';
    }

    // Check for non-Latin characters (Arabic, Chinese, etc.)
    const hasNonLatin = /[^\x00-\x7F]/.test(columnName);

    if (hasNonLatin && fallbackIndex !== null) {
      // For non-Latin text, create a stable hash-based name
      const crypto = require('crypto');
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

  // Clean headers and handle duplicates with position-based naming
  cleanHeaders(headers) {
    const cleanedHeaders = [];
    const seenNames = new Set();
    const headerMapping = {};

    console.log(`📋 Processing ${headers.length} column headers for language-safe naming`);

    headers.forEach((header, index) => {
      // Use position-aware cleaning that handles non-Latin characters
      let cleanName = this.cleanColumnName(header, index);

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

  // Clean and parse date/time values
  cleanDateTimeValue(value, columnName) {
    if (typeof value !== 'string' || !value.trim()) {
      return value;
    }

    // Check if this looks like a date/time field based on column name
    const isDateTimeField = /^(.*_date|.*_time|date|time|created|modified|updated|transaction_date)$/.test(columnName);
    
    if (!isDateTimeField) {
      return value;
    }

    try {
      const trimmedValue = value.trim();
      
      // Handle various Zoho date formats
      let parsedDate = null;
      
      // Format 1: "03 Aug 2024" or "25 Mar 2025"
      const ddMmmYyyyPattern = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;
      const ddMmmYyyyMatch = trimmedValue.match(ddMmmYyyyPattern);
      if (ddMmmYyyyMatch) {
        const [, day, month, year] = ddMmmYyyyMatch;
        const monthMap = {
          'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
          'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
          'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        if (monthMap[month]) {
          parsedDate = new Date(`${year}-${monthMap[month]}-${day.padStart(2, '0')}`);
        }
      }
      
      // Format 2: "2024-08-03 16:47:43" (ISO-like with time)
      else if (trimmedValue.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/)) {
        parsedDate = new Date(trimmedValue);
      }
      
      // Format 3: "2024-08-03" (ISO date only)
      else if (trimmedValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
        parsedDate = new Date(trimmedValue);
      }
      
      // Format 4: Try direct parsing for other formats
      else {
        parsedDate = new Date(trimmedValue);
      }
      
      // Check if the parsed date is valid
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        // Return in PostgreSQL-compatible format
        if (columnName.includes('_time') || trimmedValue.includes(':')) {
          // Include time for timestamp fields
          return parsedDate.toISOString().replace('T', ' ').substring(0, 19);
        } else {
          // Date only for date fields
          return parsedDate.toISOString().substring(0, 10);
        }
      }
      
      // If parsing failed, return null to avoid PostgreSQL errors
      console.warn(`⚠️  Could not parse date value "${trimmedValue}" in column "${columnName}". Setting to NULL.`);
      return null;
      
    } catch (error) {
      console.warn(`⚠️  Date parsing error for "${value}" in column "${columnName}": ${error.message}. Setting to NULL.`);
      return null;
    }
  }

  // Clean and parse numeric values with improved error handling
  cleanNumericValue(value, columnName) {
    if (typeof value !== 'string' || !value.trim()) {
      return value;
    }

    const trimmedValue = value.trim();
    
    try {
      // Pattern 1: SAR currency values with commas and decimals
      // Examples: "SAR 1,234.56", "1,234.56", "SAR1234", "1234.56K", "25%"
      if (trimmedValue.match(/^[SAR\s]*[\d,]+\.?\d*[K%]*$/)) {
        let cleaned = trimmedValue.replace(/[SAR\s,K%]/g, '');
        if (!isNaN(cleaned) && cleaned !== '') {
          return parseFloat(cleaned);
        }
      }
      
      // Pattern 1b: Handle quoted SAR values specifically (like "SAR 3,661.60")
      if (trimmedValue.match(/^SAR\s+[\d,]+\.?\d*$/)) {
        let cleaned = trimmedValue.replace(/SAR\s+/, '').replace(/,/g, '');
        if (!isNaN(cleaned) && cleaned !== '') {
          return parseFloat(cleaned);
        }
      }
      
      // Pattern 2: Pure numeric values (integers or decimals)
      // Examples: "1234", "1234.56", "-1234.56"
      else if (trimmedValue.match(/^-?[\d]+\.?\d*$/)) {
        const num = parseFloat(trimmedValue);
        if (!isNaN(num)) {
          return num;
        }
      }
      
      // Pattern 3: Numbers with various separators and formatting
      // Examples: "1,234", "1.234.567,89" (European), "1 234,56" (French)
      else if (trimmedValue.match(/^-?[\d,.\s]+$/)) {
        // Try to intelligently parse different number formats
        let cleaned = trimmedValue;
        
        // If has comma and period, assume comma is thousands separator
        if (cleaned.includes(',') && cleaned.includes('.')) {
          // Last period is likely decimal separator
          const lastPeriodIndex = cleaned.lastIndexOf('.');
          const lastCommaIndex = cleaned.lastIndexOf(',');
          
          if (lastPeriodIndex > lastCommaIndex) {
            // Format: 1,234.56 (US format)
            cleaned = cleaned.replace(/,/g, '');
          } else {
            // Format: 1.234,56 (European format)
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
          }
        }
        // If only comma, could be thousands or decimal separator
        else if (cleaned.includes(',') && !cleaned.includes('.')) {
          const commaIndex = cleaned.indexOf(',');
          const afterComma = cleaned.substring(commaIndex + 1);
          
          // If after comma has 1-2 digits, likely decimal separator
          if (afterComma.length <= 2 && afterComma.match(/^\d+$/)) {
            cleaned = cleaned.replace(',', '.');
          } else {
            // Likely thousands separator
            cleaned = cleaned.replace(/,/g, '');
          }
        }
        
        // Clean up spaces
        cleaned = cleaned.replace(/\s/g, '');
        
        const num = parseFloat(cleaned);
        if (!isNaN(num)) {
          return num;
        }
      }
      
      // If it's a numeric field but contains non-numeric text, set to null
      const isNumericField = /^(.*_id|.*_amount|.*_bcy|total|sub_total|quantity|balance|age_in_days|price|cost|rate|discount)$/.test(columnName);
      
      if (isNumericField && trimmedValue !== '' && trimmedValue !== '-') {
        console.warn(`⚠️  Could not parse numeric value "${trimmedValue}" in column "${columnName}". Setting to NULL.`);
        return null;
      }
      
      // For non-numeric fields, return as-is
      return value;
      
    } catch (error) {
      console.warn(`⚠️  Numeric parsing error for "${value}" in column "${columnName}": ${error.message}. Setting to NULL.`);
      return null;
    }
  }

  // Verify table exists with retry mechanism and improved error handling
  async verifyTableExistsWithRetry(tableName, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔍 Verifying table ${tableName} exists (attempt ${attempt}/${maxRetries})...`);
        
        const { data: tableCheck, error: checkError } = await this.supabase
          .from(tableName)
          .select('*')
          .limit(0);
        
        if (checkError) {
          if (checkError.code === '42P01' || checkError.message.includes('does not exist')) {
            console.error(`❌ Table ${tableName} does not exist (attempt ${attempt}/${maxRetries})`);
            
            if (attempt < maxRetries) {
              console.log(`⏳ Waiting 2 seconds before retry...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            } else {
              return {
                success: false,
                error: `Table verification failed: relation "public.${tableName}" does not exist`
              };
            }
          } else {
            // Other types of errors
            console.error(`❌ Table verification failed with error:`, checkError);
            return {
              success: false,
              error: `Table verification failed: ${checkError.message || checkError.code}`
            };
          }
        } else {
          console.log(`✅ Table ${tableName} exists and is accessible`);
          return { success: true };
        }
        
      } catch (verifyError) {
        console.error(`❌ Table verification exception (attempt ${attempt}/${maxRetries}):`, verifyError);
        
        if (attempt < maxRetries) {
          console.log(`⏳ Waiting 2 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          return {
            success: false,
            error: `Table verification exception: ${verifyError.message}`
          };
        }
      }
    }
    
    return {
      success: false,
      error: `Table verification failed after ${maxRetries} attempts`
    };
  }

  // Generate CREATE TABLE statement
  generateCreateTableSQL(tableName, headers, sampleData = []) {
    const cleanTableName = this.cleanColumnName(tableName);
    const { cleanedHeaders, headerMapping } = this.cleanHeaders(headers);
    
    const columns = headers.map(header => {
      const cleaned = headerMapping[header];
      
      // Force all columns to TEXT to avoid data type issues with mixed formats
      // This prevents issues with SAR currency values and other formatted data
      let dataType = 'TEXT';
      
      return `"${cleaned}" ${dataType}`;
    });

    return `
CREATE TABLE IF NOT EXISTS "${cleanTableName}" (
  id SERIAL PRIMARY KEY,
  ${columns.join(',\n  ')},
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on created_at for better query performance
CREATE INDEX IF NOT EXISTS "${cleanTableName}_created_at_idx" ON "${cleanTableName}" (created_at);
    `.trim();
  }

  // Ensure the exec_sql function exists
  async ensureExecSqlFunction() {
    try {
      const createFunctionSQL = `
        CREATE OR REPLACE FUNCTION exec_sql(sql_text TEXT)
        RETURNS TEXT
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          EXECUTE sql_text;
          RETURN 'SUCCESS';
        EXCEPTION
          WHEN OTHERS THEN
            RETURN 'ERROR: ' || SQLERRM;
        END;
        $$;
      `;
      
      // Try to create the function using a direct SQL execution approach
      const { data, error } = await this.supabase.rpc('exec_sql', { sql_text: createFunctionSQL });
      
      if (error && !error.message.includes('does not exist')) {
        console.log('exec_sql function may need to be created manually');
      }
      
      return true;
    } catch (error) {
      console.log('Will create tables using manual approach');
      return false;
    }
  }

  // Create table in Supabase using service role key
  async createTable(tableName, headers, sampleData = []) {
    try {
      console.log(`🏗️  Creating table: ${tableName}`);
      
      const cleanTableName = this.cleanColumnName(tableName);
      const sql = this.generateCreateTableSQL(tableName, headers, sampleData);
      
      console.log(`Creating table ${cleanTableName} with SQL...`);
      
      // Try using RPC function first with retry mechanism
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`🔧 Attempting table creation via RPC (attempt ${attempt}/3)...`);
          const { data, error } = await this.supabase.rpc('exec_sql', { sql_text: sql });
          
          if (error) {
            if (error.message.includes('does not exist')) {
              console.log('exec_sql function not found, creating table with direct approach...');
              return await this.createTableDirect(cleanTableName, headers, sampleData);
            }
            
            if (attempt < 3) {
              console.log(`⏳ RPC attempt ${attempt} failed, retrying in 2 seconds...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
            throw error;
          }
          
          if (data && data.includes('ERROR:')) {
            console.error(`SQL execution error: ${data}`);
            if (attempt < 3) {
              console.log(`⏳ SQL error on attempt ${attempt}, retrying in 2 seconds...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
            throw new Error(data);
          }
          
          console.log(`✅ Table ${cleanTableName} created successfully via RPC`);
          return { success: true, method: 'rpc' };
        } catch (rpcError) {
          if (attempt === 3) {
            console.log(`RPC table creation failed after 3 attempts, trying direct approach: ${rpcError.message}`);
            return await this.createTableDirect(cleanTableName, headers, sampleData);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Exception creating table ${tableName}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Create table using direct column-by-column approach
  async createTableDirect(cleanTableName, headers, sampleData = []) {
    try {
      console.log(`Creating table ${cleanTableName} using direct method...`);
      
      // For now, we'll create a simple table structure that we know will work
      // This is a workaround since direct SQL execution is limited
      
      // First, try to create with a simple structure and let PostgreSQL auto-handle types
      const basicColumns = {};
      headers.forEach(header => {
        const cleanHeader = this.cleanColumnName(header);
        basicColumns[cleanHeader] = 'sample_value'; // This will create text columns
      });
      
      // Try a simple insert/upsert to let Supabase auto-create the table structure
      const testData = { ...basicColumns, _table_created: true };
      
      const { data, error } = await this.supabase
        .from(cleanTableName)
        .insert(testData)
        .select();
      
      if (error) {
        console.log(`Table ${cleanTableName} doesn't exist. Manual creation required.`);
        return { 
          success: false, 
          error: `Table creation required. Please create table '${cleanTableName}' manually in Supabase dashboard.`,
          sql: this.generateCreateTableSQL(cleanTableName, headers, sampleData)
        };
      }
      
      // Clean up the test record
      await this.supabase
        .from(cleanTableName)
        .delete()
        .eq('_table_created', true);
      
      console.log(`✅ Table ${cleanTableName} created successfully via direct method`);
      return { success: true, method: 'direct' };
    } catch (error) {
      console.error(`❌ Direct table creation failed:`, error);
      return { success: false, error: error.message };
    }
  }

  // Insert data in batches with enhanced error handling and raw mode option
  async insertDataInBatches(tableName, data, batchSize = 50, rawMode = false) {
    const cleanTableName = this.cleanColumnName(tableName);
    
    try {
      console.log(`📥 Inserting ${data.length} records into ${cleanTableName} in batches of ${batchSize}`);
      console.log(`🔧 Raw mode: ${rawMode ? 'ENABLED (no data transformations)' : 'DISABLED (with transformations)'}`);
      
      // Generate header mapping (same as table creation)
      const headers = data.length > 0 ? Object.keys(data[0]) : [];
      const { cleanedHeaders, headerMapping } = this.cleanHeaders(headers);
      
      // Log header mapping for debugging schema cache issues
      console.log(`📋 Header mapping for ${cleanTableName}:`);
      Object.entries(headerMapping).forEach(([original, cleaned]) => {
        if (original !== cleaned) {
          console.log(`   "${original}" → "${cleaned}"`);
        }
      });
      
      let totalInserted = 0;
      const errors = [];
      
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        
        // Clean the data for this batch using the same header mapping
        const cleanBatch = batch.map(row => {
          const cleanRow = {};
          Object.keys(row).forEach(key => {
            const cleanKey = headerMapping[key] || this.cleanColumnName(key);
            let value = row[key];
            
            // Handle empty strings and null values
            if (value === '' || value === null || value === undefined) {
              value = null;
            } else if (typeof value === 'string') {
              value = value.trim();
              // Remove carriage returns that might cause issues
              value = value.replace(/\r/g, '');
              
              // Apply transformations only if not in raw mode
              if (!rawMode) {
                // Clean and parse date/time values first
                try {
                  value = this.cleanDateTimeValue(value, cleanKey);
                } catch (dateError) {
                  console.warn(`⚠️  Date parsing failed for "${value}" in ${cleanKey}, keeping as text:`, dateError.message);
                }
                
                // Clean numeric values - remove commas, currency symbols, and formatting
                if (typeof value === 'string') {
                  try {
                    value = this.cleanNumericValue(value, cleanKey);
                  } catch (numError) {
                    console.warn(`⚠️  Numeric parsing failed for "${value}" in ${cleanKey}, keeping as text:`, numError.message);
                  }
                }
              }
            }
            
            cleanRow[cleanKey] = value;
          });
          return cleanRow;
        });
        
        console.log(`📦 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(data.length / batchSize)} (${batch.length} records)`);
        console.log(`🔍 Sample data being inserted:`, JSON.stringify(cleanBatch[0], null, 2));
        
        const { data: insertedData, error } = await this.supabase
          .from(cleanTableName)
          .insert(cleanBatch);
        
        if (error) {
          console.error(`❌ Batch insert error:`, JSON.stringify(error, null, 2));
          console.error(`❌ Failed data sample:`, JSON.stringify(cleanBatch[0], null, 2));
          console.error(`❌ Expected columns:`, Object.keys(cleanBatch[0]).join(', '));
          
          // Enhanced error analysis
          if (error.message && error.message.includes('schema cache')) {
            console.error(`🔍 SCHEMA CACHE ERROR DETECTED:`);
            console.error(`   This suggests a mismatch between table creation and data insertion.`);
            console.error(`   Table: ${cleanTableName}`);
            console.error(`   Headers: ${JSON.stringify(headerMapping, null, 2)}`);
          }
          
          // Check if it's a table not found error
          if (error.message && error.message.includes('does not exist')) {
            console.error(`❌ Table ${cleanTableName} does not exist. Please create it manually in Supabase first.`);
            console.error(`📋 Suggested SQL: CREATE TABLE ${cleanTableName} (...)`);
            
            // For table not found, don't continue with other batches
            errors.push({
              batch: Math.floor(i / batchSize) + 1,
              error: error.message || error.code || 'Unknown error',
              details: error,
              fatal: true
            });
            break;
          }
          
          // For data-related errors, try to continue with other batches
          errors.push({
            batch: Math.floor(i / batchSize) + 1,
            error: error.message || error.code || 'Unknown error',
            details: error,
            fatal: false,
            sampleData: cleanBatch[0]
          });
          
          console.log(`⚠️  Batch ${Math.floor(i / batchSize) + 1} failed, continuing with next batch...`);
        } else {
          totalInserted += batch.length;
          console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} inserted successfully`);
        }
        
        // Small delay to avoid overwhelming Supabase
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Determine success based on whether we have any fatal errors and if we inserted some data
      const fatalErrors = errors.filter(err => err.fatal);
      const hasPartialSuccess = totalInserted > 0;
      const successRate = totalInserted / data.length;
      
      return {
        success: fatalErrors.length === 0 && hasPartialSuccess,
        totalRecords: data.length,
        inserted: totalInserted,
        failed: data.length - totalInserted,
        successRate: Math.round(successRate * 100),
        errors: errors,
        partialSuccess: hasPartialSuccess && errors.length > 0
      };
    } catch (error) {
      console.error(`❌ Exception during batch insert:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Full replication process for a single table with enhanced error handling and view preservation
  async replicateTable(csvData, tableName, options = {}) {
    const { rawMode = false, preserveViews = false } = options;
    
    try {
      console.log(`🔄 Starting replication for table: ${tableName}`);
      console.log(`🔧 Raw mode: ${rawMode ? 'ENABLED' : 'DISABLED'}`);
      
      // Parse CSV data
      const { headers, data } = await this.parseCSVData(csvData);
      console.log(`📊 Parsed ${data.length} records with ${headers.length} columns`);
      console.log(`📋 CSV Headers: ${headers.join(', ')}`);
      
      if (data.length === 0) {
        return {
          success: true,
          message: 'No data to replicate',
          tableName,
          records: 0
        };
      }
      
      // Handle table preparation based on view preservation setting
      const cleanTableName = this.cleanColumnName(tableName);
      
      if (preserveViews) {
        console.log(`🛡️  Using view-preserving strategy for ${cleanTableName} (API method)`);
        
        // Check if table exists and truncate instead of dropping
        try {
          const { data: tableCheck, error: checkError } = await this.supabase
            .from(cleanTableName)
            .select('*')
            .limit(0);
          
          if (!checkError) {
            console.log(`🔄 Truncating existing table ${cleanTableName} (preserves views)`);
            await this.supabase.rpc('exec_sql', { 
              sql_text: `TRUNCATE TABLE "${cleanTableName}";` 
            });
          } else {
            console.log(`📋 Table ${cleanTableName} doesn't exist, will create new one`);
          }
        } catch (truncateError) {
          console.log(`⚠️  Could not truncate table (may not exist): ${truncateError.message}`);
        }
      } else {
        console.log(`🗑️  Dropping existing table ${cleanTableName} for fresh schema (destructive mode)`);
        
        try {
          const dropResult = await this.supabase.rpc('exec_sql', { 
            sql_text: `DROP TABLE IF EXISTS "${cleanTableName}" CASCADE;` 
          });
          console.log(`✅ Table ${cleanTableName} dropped successfully`);
        } catch (dropError) {
          console.log(`⚠️  Could not drop table (may not exist): ${dropError.message}`);
        }
      }
      
      // Create fresh table with correct schema
      console.log(`🏗️  Creating table ${cleanTableName} with headers:`, headers);
      const tableResult = await this.createTable(tableName, headers, data.slice(0, 10));
      if (!tableResult.success) {
        console.error(`❌ Table creation failed for ${tableName}:`, tableResult.error);
        
        // If table creation fails, try with manual SQL generation
        console.log(`🔧 Attempting manual table creation...`);
        try {
          const sql = this.generateCreateTableSQL(tableName, headers, data.slice(0, 10));
          console.log(`📄 Generated SQL for ${tableName}:`);
          console.log(sql);
          
          const { data: sqlResult, error: sqlError } = await this.supabase.rpc('exec_sql', { sql_text: sql });
          if (sqlError || (sqlResult && sqlResult.includes('ERROR:'))) {
            throw new Error(sqlError?.message || sqlResult);
          }
          console.log(`✅ Manual table creation succeeded for ${tableName}`);
        } catch (manualError) {
          return {
            success: false,
            error: `Failed to create table manually: ${manualError.message}`,
            tableName,
            sql: this.generateCreateTableSQL(tableName, headers, data.slice(0, 10))
          };
        }
      }
      
      // Verify table exists before inserting with retry mechanism
      const verificationResult = await this.verifyTableExistsWithRetry(cleanTableName, 5);
      if (!verificationResult.success) {
        return {
          success: false,
          error: verificationResult.error,
          tableName,
          headers: headers,
          cleanTableName: cleanTableName
        };
      }
      
      // Insert new data with raw mode option (ultra-small batches for production reliability)
      const insertResult = await this.insertDataInBatches(tableName, data, 25, rawMode);
      
      // Enhanced result reporting
      const result = {
        success: insertResult.success,
        tableName,
        records: insertResult.totalRecords,
        inserted: insertResult.inserted,
        failed: insertResult.failed || 0,
        successRate: insertResult.successRate || 0,
        partialSuccess: insertResult.partialSuccess || false,
        errors: insertResult.errors || [],
        tableCreated: tableResult.success,
        tableCreationMethod: tableResult.method || 'manual',
        rawMode: rawMode
      };

      // Log detailed summary
      if (result.success) {
        console.log(`✅ ${tableName} replication completed successfully: ${result.inserted}/${result.records} records (${result.successRate}%)`);
      } else if (result.partialSuccess) {
        console.log(`⚠️  ${tableName} replication partially successful: ${result.inserted}/${result.records} records (${result.successRate}%)`);
        console.log(`   Errors: ${result.errors.length} batches failed`);
        
        // Log first few errors for debugging
        result.errors.slice(0, 3).forEach(error => {
          console.log(`   • Batch ${error.batch}: ${error.error}`);
          if (error.sampleData) {
            console.log(`     Sample: ${JSON.stringify(error.sampleData, null, 2).substring(0, 200)}`);
          }
        });
      } else {
        console.log(`❌ ${tableName} replication failed: ${result.errors.length} errors`);
        
        // Log all errors for completely failed tables
        result.errors.forEach(error => {
          console.log(`   • Batch ${error.batch}: ${error.error}`);
        });
      }

      return result;
    } catch (error) {
      console.error(`❌ Replication failed for ${tableName}:`, error);
      return {
        success: false,
        tableName,
        error: error.message,
        stack: error.stack
      };
    }
  }

  // Batch replicate multiple tables with enhanced options
  async replicateTables(tableDataMap, options = {}) {
    const { 
      rawMode = process.env.RAW_TEXT_IMPORT === 'true',
      failedTablesOnly = false,
      retryCount = 1 
    } = options;
    
    console.log(`🚀 Starting batch replication of ${Object.keys(tableDataMap).length} tables`);
    console.log(`🔧 Raw mode: ${rawMode ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🔄 Retry count: ${retryCount}`);
    
    const results = {
      success: [],
      failed: [],
      totalRecords: 0,
      startTime: new Date(),
      options: { rawMode, failedTablesOnly, retryCount }
    };
    
    // List of known problematic tables that should use raw mode
    const problematicTables = ['invoices', 'credit_notes', 'credit_note_items', 'branch', 'transfer_order_items'];
    
    for (const [tableName, csvData] of Object.entries(tableDataMap)) {
      let attempts = 0;
      let lastResult = null;
      
      // Determine if this specific table should use raw mode
      const useRawMode = rawMode || problematicTables.includes(tableName);
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔄 Processing table: ${tableName}`);
      console.log(`🔧 Using raw mode: ${useRawMode}`);
      
      while (attempts < retryCount) {
        attempts++;
        console.log(`📥 Attempt ${attempts}/${retryCount} for ${tableName}`);
        
        const tableOptions = { rawMode: useRawMode };
        lastResult = await this.replicateTableEnhanced(csvData, tableName, tableOptions);
        
        // If successful or partially successful, break out of retry loop
        if (lastResult.success || lastResult.partialSuccess) {
          break;
        }
        
        // If failed and we have more attempts, wait before retry
        if (attempts < retryCount) {
          console.log(`⏳ Waiting 5 seconds before retry ${attempts + 1}...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Categorize results
      if (lastResult.success || lastResult.partialSuccess) {
        results.success.push(lastResult);
        results.totalRecords += lastResult.inserted || 0;
      } else {
        results.failed.push(lastResult);
      }
      
      // Small delay between tables
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    results.endTime = new Date();
    results.duration = results.endTime - results.startTime;
    
    console.log(`\n🏁 Batch replication completed:`);
    console.log(`✅ Successful: ${results.success.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`📊 Total records: ${results.totalRecords}`);
    console.log(`⏱️  Duration: ${Math.round(results.duration / 1000)} seconds`);
    
    // Detailed breakdown
    if (results.success.length > 0) {
      console.log(`\n📈 Success Details:`);
      results.success.forEach(result => {
        const status = result.partialSuccess ? '⚠️  Partial' : '✅ Full';
        console.log(`   ${status}: ${result.tableName} - ${result.inserted}/${result.records} records (${result.successRate}%)`);
      });
    }
    
    if (results.failed.length > 0) {
      console.log(`\n❌ Failure Details:`);
      results.failed.forEach(result => {
        console.log(`   ❌ ${result.tableName}: ${result.error}`);
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach(err => {
            console.log(`      Batch ${err.batch}: ${err.error}`);
          });
        }
      });
    }
    
    return results;
  }

  // COPY-based CSV import with view preservation (10x faster than API method)
  async importCSVWithCOPY(csvData, tableName, options = {}) {
    const { rawMode = true, preserveViews = true } = options;
    
    if (!this.pgPool) {
      throw new Error('PostgreSQL connection required for COPY method. Check SUPABASE_DB_PASSWORD environment variable.');
    }
    
    // Wait for connection to be ready if still setting up
    let retries = 0;
    while (!this.pgPool && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }
    
    try {
      console.log(`🚀 Starting COPY-based import for table: ${tableName}`);
      console.log(`🔧 Using native PostgreSQL COPY command (10x faster than API)`);
      
      // Test connection first
      const testClient = await this.pgPool.connect();
      await testClient.query('SELECT 1');
      testClient.release();
      console.log('✅ PostgreSQL connection verified');
      
      // Parse CSV to get headers and validate data
      const { headers, data } = await this.parseCSVData(csvData);
      console.log(`📊 Parsed ${data.length} records with ${headers.length} columns`);
      
      if (data.length === 0) {
        return {
          success: true,
          message: 'No data to import',
          tableName,
          records: 0,
          method: 'copy'
        };
      }
      
      const cleanTableName = this.cleanColumnName(tableName);
      const { cleanedHeaders, headerMapping } = this.cleanHeaders(headers);
      
      console.log(`📋 Cleaned headers: ${cleanedHeaders.join(', ')}`);
      
      // Get PostgreSQL client
      const client = await this.pgPool.connect();
      
      try {
        if (preserveViews) {
          // PRESERVE VIEWS STRATEGY: Check if table exists and handle schema evolution
          console.log(`🛡️  Using view-preserving strategy for ${cleanTableName}`);
          
          const { rows: tableExists } = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' 
              AND table_name = $1
            );
          `, [cleanTableName]);
          
          if (tableExists[0].exists) {
            console.log(`📋 Table ${cleanTableName} exists - checking schema compatibility`);
            
            // Get existing columns
            const { rows: existingColumns } = await client.query(`
              SELECT column_name 
              FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = $1 
              AND column_name NOT IN ('id', 'created_at', 'updated_at')
              ORDER BY ordinal_position;
            `, [cleanTableName]);
            
            const existingColumnNames = existingColumns.map(row => row.column_name);
            const newColumnNames = cleanedHeaders;
            
            // Add missing columns
            const missingColumns = newColumnNames.filter(col => !existingColumnNames.includes(col));
            if (missingColumns.length > 0) {
              console.log(`📝 Adding ${missingColumns.length} new columns: ${missingColumns.join(', ')}`);
              for (const column of missingColumns) {
                await client.query(`ALTER TABLE "${cleanTableName}" ADD COLUMN "${column}" TEXT;`);
              }
            }
            
            // TRUNCATE instead of DROP (preserves views, indexes, constraints)
            console.log(`🔄 Truncating table ${cleanTableName} (preserves views and indexes)`);
            await client.query(`TRUNCATE TABLE "${cleanTableName}";`);
            
          } else {
            // Create new table
            console.log(`🏗️  Creating new table ${cleanTableName} with COPY-optimized schema`);
            const columns = cleanedHeaders.map(header => `"${header}" TEXT`);
            const createTableSQL = `
              CREATE TABLE "${cleanTableName}" (
                id SERIAL PRIMARY KEY,
                ${columns.join(',\n                ')},
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
              );
              
              CREATE INDEX "${cleanTableName}_created_at_idx" ON "${cleanTableName}" (created_at);
            `;
            await client.query(createTableSQL);
          }
        } else {
          // DESTRUCTIVE STRATEGY: Drop and recreate (original behavior)
          console.log(`🗑️  Dropping existing table ${cleanTableName} (destructive mode)`);
          await client.query(`DROP TABLE IF EXISTS "${cleanTableName}" CASCADE;`);
          
          // Create table with TEXT columns (raw mode)
          const columns = cleanedHeaders.map(header => `"${header}" TEXT`);
          const createTableSQL = `
            CREATE TABLE "${cleanTableName}" (
              id SERIAL PRIMARY KEY,
              ${columns.join(',\n              ')},
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE INDEX "${cleanTableName}_created_at_idx" ON "${cleanTableName}" (created_at);
          `;
          
          console.log(`🏗️  Creating table ${cleanTableName} with COPY-optimized schema`);
          await client.query(createTableSQL);
        }
        
        // Prepare CSV data for COPY command
        console.log(`📝 Preparing CSV data for COPY command`);
        
        // Create header line with cleaned column names
        const csvHeaderLine = cleanedHeaders.join(',');
        
        // Create data lines with proper escaping
        const csvDataLines = data.map(row => {
          return cleanedHeaders.map(cleanHeader => {
            // Find original header that maps to this clean header
            const originalHeader = Object.keys(headerMapping).find(orig => headerMapping[orig] === cleanHeader);
            let value = row[originalHeader];
            
            // Handle null/empty values
            if (value === null || value === undefined || value === '') {
              return '';
            }
            
            // Convert to string and escape for CSV
            value = String(value).trim();
            
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
              value = '"' + value.replace(/"/g, '""') + '"';
            }
            
            return value;
          }).join(',');
        });
        
        // Combine header and data
        const fullCSVData = [csvHeaderLine, ...csvDataLines].join('\n');
        
        console.log(`📦 Prepared ${csvDataLines.length} data lines for COPY`);
        console.log(`🔍 Sample CSV line: ${csvDataLines[0]?.substring(0, 100)}...`);
        
        // Execute COPY command
        console.log(`⚡ Executing COPY command for ${data.length} records...`);
        const startTime = Date.now();
        
        // Use COPY FROM STDIN with CSV format
        const copySQL = `COPY "${cleanTableName}" (${cleanedHeaders.map(h => `"${h}"`).join(', ')}) FROM STDIN WITH (FORMAT csv, HEADER true)`;
        
        const copyFrom = require('pg-copy-streams').from;
        const { Readable } = require('stream');
        
        // Create a readable stream from our CSV data
        const csvStream = new Readable();
        csvStream.push(fullCSVData);
        csvStream.push(null); // End the stream
        
        // Pipe CSV data to PostgreSQL
        const copyStream = client.query(copyFrom(copySQL));
        
        await new Promise((resolve, reject) => {
          csvStream.pipe(copyStream)
            .on('error', reject)
            .on('finish', resolve);
        });
        
        const duration = Date.now() - startTime;
        
        // Verify import
        const { rows } = await client.query(`SELECT COUNT(*) as count FROM "${cleanTableName}"`);
        const importedCount = parseInt(rows[0].count);
        
        console.log(`✅ COPY import completed successfully!`);
        console.log(`📊 Records imported: ${importedCount}/${data.length}`);
        console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s (${Math.round(data.length / (duration / 1000))} records/sec)`);
        
        const success = importedCount === data.length;
        
        return {
          success,
          tableName,
          records: data.length,
          inserted: importedCount,
          failed: data.length - importedCount,
          successRate: Math.round((importedCount / data.length) * 100),
          duration: Math.round(duration / 1000),
          method: 'copy',
          recordsPerSecond: Math.round(data.length / (duration / 1000))
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`❌ COPY import failed for ${tableName}:`, error);
      throw error;
    }
  }

  // COPY-only replication method with view preservation
  async replicateTableEnhanced(csvData, tableName, options = {}) {
    const { rawMode = true, preserveViews = true } = options;
    
    try {
      console.log(`🔄 Starting COPY-only replication for table: ${tableName}`);
      
      // Always use COPY method - no fallbacks
      return await this.importCSVWithCOPY(csvData, tableName, { ...options, preserveViews });
      
    } catch (error) {
      console.error(`❌ COPY replication failed for ${tableName}:`, error);
      throw error;
    }
  }
}

module.exports = SupabaseBulkClient;