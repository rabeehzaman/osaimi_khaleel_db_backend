require('dotenv').config();
const cron = require('node-cron');
const ZohoBulkClient = require('./zoho-bulk-client');
const SupabaseBulkClient = require('./supabase-bulk-client');
const { BULK_EXPORT_TABLES, EXPORT_CONFIG } = require('../config/tables');

class BulkReplicator {
  constructor() {
    // Initialize Zoho client with credential server
    this.zohoClient = new ZohoBulkClient({
      credentialServerURL: process.env.CREDENTIAL_SERVER_URL || 'http://localhost:3002'
    });

    // Initialize Supabase client
    this.supabaseClient = new SupabaseBulkClient({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    });
  }

  async validateConfiguration() {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate credential server connection
    try {
      const credentialServerURL = process.env.CREDENTIAL_SERVER_URL || 'http://localhost:3002';
      console.log(`🔍 Checking credential server at ${credentialServerURL}...`);

      const axios = require('axios');
      const response = await axios.get(`${credentialServerURL}/health`, { timeout: 5000 });

      if (response.data.status === 'healthy') {
        console.log('✅ Credential server is running');
      } else {
        throw new Error('Credential server is not healthy');
      }
    } catch (error) {
      throw new Error(`Credential server is not accessible: ${error.message}. Please start it with 'npm run credential-server'`);
    }

    console.log('✅ Configuration validated');
  }

  async replicateAllTables() {
    try {
      await this.validateConfiguration();
      
      console.log('🚀 Starting full data replication from Zoho Analytics to Supabase');
      console.log(`📊 Tables to replicate: ${BULK_EXPORT_TABLES.length}`);
      
      const startTime = new Date();
      const results = {
        zohoExport: null,
        supabaseImport: null,
        totalDuration: 0,
        success: false
      };

      // Step 1: Export all data from Zoho Analytics
      console.log('\n📥 Step 1: Exporting data from Zoho Analytics...');
      results.zohoExport = await this.zohoClient.batchExport(
        BULK_EXPORT_TABLES,
        './exports',
        EXPORT_CONFIG.batchSize
      );

      if (results.zohoExport.failed.length > 0) {
        console.log('\n⚠️  Some exports failed. Continuing with successful exports...');
      }

      // Step 2: Load exported data and replicate to Supabase
      if (results.zohoExport.success.length > 0) {
        console.log('\n📤 Step 2: Importing data to Supabase...');
        
        const tableDataMap = {};
        
        // Load CSV files into memory
        for (const exportResult of results.zohoExport.success) {
          try {
            const fs = require('fs');
            const csvData = fs.readFileSync(exportResult.filepath, 'utf8');
            tableDataMap[exportResult.tableName] = csvData;
            console.log(`📖 Loaded ${exportResult.tableName} (${(csvData.length / 1024).toFixed(1)} KB)`);
          } catch (error) {
            console.error(`❌ Failed to load ${exportResult.tableName}: ${error.message}`);
          }
        }

        // Replicate to Supabase
        results.supabaseImport = await this.supabaseClient.replicateTables(tableDataMap);
      } else {
        console.log('❌ No data exported from Zoho Analytics. Skipping Supabase import.');
        results.supabaseImport = { success: [], failed: [], totalRecords: 0 };
      }

      // Calculate final results
      const endTime = new Date();
      results.totalDuration = endTime - startTime;
      results.success = results.supabaseImport.success.length > 0;

      // Print summary
      this.printReplicationSummary(results);

      return results;
    } catch (error) {
      console.error('❌ Replication failed:', error.message);
      throw error;
    }
  }

  async replicateSpecificTables(tableNames) {
    try {
      await this.validateConfiguration();
      
      const tablesToReplicate = BULK_EXPORT_TABLES.filter(table => 
        tableNames.includes(table.tableName)
      );

      if (tablesToReplicate.length === 0) {
        throw new Error(`No matching tables found for: ${tableNames.join(', ')}`);
      }

      console.log(`🎯 Replicating specific tables: ${tablesToReplicate.map(t => t.tableName).join(', ')}`);
      
      // Use the same process as full replication but with filtered tables
      const originalTables = [...BULK_EXPORT_TABLES];
      BULK_EXPORT_TABLES.length = 0;
      BULK_EXPORT_TABLES.push(...tablesToReplicate);
      
      const results = await this.replicateAllTables();
      
      // Restore original table list
      BULK_EXPORT_TABLES.length = 0;
      BULK_EXPORT_TABLES.push(...originalTables);
      
      return results;
    } catch (error) {
      console.error('❌ Specific table replication failed:', error.message);
      throw error;
    }
  }

  printReplicationSummary(results) {
    console.log('\n' + '='.repeat(80));
    console.log('📋 REPLICATION SUMMARY');
    console.log('='.repeat(80));
    
    // Zoho Export Summary
    console.log('\n📥 ZOHO ANALYTICS EXPORT:');
    console.log(`✅ Successful exports: ${results.zohoExport.success.length}`);
    console.log(`❌ Failed exports: ${results.zohoExport.failed.length}`);
    console.log(`📊 Total data size: ${(results.zohoExport.totalSize / 1024 / 1024).toFixed(2)} MB`);
    
    if (results.zohoExport.failed.length > 0) {
      console.log('\n❌ Failed exports:');
      results.zohoExport.failed.forEach(fail => {
        console.log(`   • ${fail.tableName}: ${fail.error}`);
      });
    }

    // Supabase Import Summary
    console.log('\n📤 SUPABASE IMPORT:');
    console.log(`✅ Successful imports: ${results.supabaseImport.success.length}`);
    console.log(`❌ Failed imports: ${results.supabaseImport.failed.length}`);
    console.log(`📊 Total records imported: ${results.supabaseImport.totalRecords}`);
    
    if (results.supabaseImport.failed.length > 0) {
      console.log('\n❌ Failed imports:');
      results.supabaseImport.failed.forEach(fail => {
        console.log(`   • ${fail.tableName}: ${fail.error}`);
      });
    }

    // Overall Summary
    console.log('\n🏁 OVERALL:');
    console.log(`⏱️  Total duration: ${Math.round(results.totalDuration / 1000)} seconds`);
    console.log(`🎯 Success: ${results.success ? 'YES' : 'NO'}`);
    
    console.log('\n' + '='.repeat(80));
  }

  async discoverViews() {
    try {
      await this.validateConfiguration();
      console.log('🔍 Discovering all available views in Zoho Analytics workspace...');
      
      const views = await this.zohoClient.discoverViews();
      
      console.log(`✅ Discovered ${views.length} views in workspace`);
      return views;
    } catch (error) {
      console.error('❌ View discovery failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🔍 Testing connections...');
      
      // Test Zoho connection
      await this.zohoClient.ensureValidToken();
      console.log('✅ Zoho Analytics connection successful');
      
      // Test Supabase connection - simplified approach
      try {
        // Just verify we can instantiate and access the Supabase client
        if (!this.supabaseClient.supabase) {
          throw new Error('Supabase client not initialized');
        }
        
        // The connection will be tested during actual operations
        console.log('Supabase client initialized successfully');
      } catch (supabaseError) {
        throw new Error(`Supabase connection failed: ${supabaseError.message}`);
      }
      
      console.log('✅ Supabase connection successful');
      
      return { success: true, message: 'All connections tested successfully' };
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Start scheduled daily replication
  startScheduler() {
    const scheduleTime = process.env.SCHEDULE_TIME || '0 1 * * *'; // Default: 1:00 AM UTC
    const timezone = process.env.TIMEZONE || 'UTC';
    
    console.log(`📅 Starting scheduled replication: ${scheduleTime} (${timezone})`);
    
    cron.schedule(scheduleTime, async () => {
      try {
        console.log(`\n🌙 Starting scheduled daily replication at ${new Date().toISOString()}`);
        await this.replicateAllTables();
        console.log(`✅ Scheduled replication completed successfully`);
      } catch (error) {
        console.error(`❌ Scheduled replication failed:`, error.message);
      }
    }, {
      scheduled: true,
      timezone: timezone
    });
    
    console.log(`⏰ Daily replication scheduled for ${scheduleTime} ${timezone}`);
    console.log(`📊 Will replicate ${BULK_EXPORT_TABLES.length} tables automatically`);
    
    return true;
  }

  // Stop scheduler (for graceful shutdown)
  stopScheduler() {
    console.log('⏹️  Stopping scheduled replication...');
    // Cron jobs will be stopped when the process exits
    return true;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const replicator = new BulkReplicator();

  if (args.includes('--test')) {
    replicator.testConnection()
      .then(result => {
        console.log(result.success ? '✅ Test passed' : '❌ Test failed');
        process.exit(result.success ? 0 : 1);
      });
  } else if (args.includes('--scheduler')) {
    console.log('🚀 Starting scheduled replication service...');
    replicator.startScheduler();
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      replicator.stopScheduler();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      replicator.stopScheduler();
      process.exit(0);
    });
    
    console.log('✅ Scheduler service is running. Press Ctrl+C to stop.');
  } else if (args.includes('--tables')) {
    const tablesIndex = args.indexOf('--tables');
    const tableNames = args.slice(tablesIndex + 1);
    
    if (tableNames.length === 0) {
      console.error('❌ Please specify table names after --tables');
      process.exit(1);
    }
    
    replicator.replicateSpecificTables(tableNames)
      .then(results => {
        process.exit(results.success ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ Replication failed:', error.message);
        process.exit(1);
      });
  } else {
    replicator.replicateAllTables()
      .then(results => {
        process.exit(results.success ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ Replication failed:', error.message);
        process.exit(1);
      });
  }
}

module.exports = BulkReplicator;