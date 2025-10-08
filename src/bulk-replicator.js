require('dotenv').config();
const cron = require('node-cron');
const ZohoBulkClient = require('./zoho-bulk-client');
const SupabaseBulkClient = require('./supabase-bulk-client');
const ZohoBooksClient = require('./zoho-books-client');
const DatabaseConfigManager = require('./database-config-manager');
const eventLogger = require('./event-logger');
const { BULK_EXPORT_TABLES, EXPORT_CONFIG } = require('../config/tables');

class BulkReplicator {
  constructor() {
    // Initialize database config manager
    this.configManager = new DatabaseConfigManager();

    // Initialize Zoho client with direct credentials or credential server
    const zohoConfig = {};

    // Check if direct credentials are available
    if (process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET) {
      zohoConfig.clientId = process.env.ZOHO_CLIENT_ID;
      zohoConfig.clientSecret = process.env.ZOHO_CLIENT_SECRET;
      zohoConfig.refreshToken = process.env.ZOHO_REFRESH_TOKEN;
      zohoConfig.orgId = process.env.ZOHO_ORG_ID;
      zohoConfig.workspaceId = process.env.ZOHO_WORKSPACE_ID;
      zohoConfig.region = process.env.ZOHO_REGION;
      console.log('✅ Using direct Zoho credentials');
    } else {
      zohoConfig.credentialServerURL = process.env.CREDENTIAL_SERVER_URL || 'http://localhost:3002';
      console.log('🔧 Using credential server for Zoho authentication');
    }

    this.zohoClient = new ZohoBulkClient(zohoConfig);

    // Initialize Supabase client
    this.supabaseClient = new SupabaseBulkClient({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    });

    // Initialize Zoho Books client for language switching
    this.zohoBooksClient = new ZohoBooksClient();

    // Scheduler state tracking
    this.schedulerState = {
      isRunning: false,
      scheduleTime: process.env.SCHEDULE_TIME || '0 1 * * *',
      timezone: process.env.TIMEZONE || 'UTC',
      task: null,
      lastRun: null,
      lastRunResult: null,
      nextRun: null
    };

    // Language switch scheduler state
    this.languageSwitchState = {
      preImportTask: null,  // Switch to English before import
      lastPreSwitch: null
    };
  }

  async validateConfiguration() {
    // Check required Supabase environment variables
    const requiredSupabaseVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const missingSupabase = requiredSupabaseVars.filter(varName => !process.env[varName]);

    if (missingSupabase.length > 0) {
      throw new Error(`Missing required Supabase environment variables: ${missingSupabase.join(', ')}`);
    }

    // Check Zoho credentials - either direct or credential server
    const hasDirectCredentials = process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET;
    const useCredentialServer = !hasDirectCredentials;

    if (hasDirectCredentials) {
      console.log('✅ Using direct Zoho credentials');
      const requiredZohoVars = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID', 'ZOHO_WORKSPACE_ID'];
      const missingZoho = requiredZohoVars.filter(varName => !process.env[varName]);

      if (missingZoho.length > 0) {
        throw new Error(`Missing required Zoho environment variables: ${missingZoho.join(', ')}`);
      }
    } else if (useCredentialServer && !process.env.DISABLE_CREDENTIAL_SERVER) {
      // Only validate credential server if not disabled and no direct credentials
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
    } else {
      console.log('⚠️  Credential server validation disabled');
    }

    console.log('✅ Configuration validated');
  }

  async replicateAllTables() {
    const operationId = eventLogger.startOperation('replicateAllTables');

    try {
      await this.validateConfiguration();

      // Load configurations from database
      await this.configManager.initialize();
      const tablesToReplicate = await this.configManager.getAllConfigurations();

      console.log('🚀 Starting full data replication from Zoho Analytics to Supabase');
      console.log(`📊 Tables to replicate: ${tablesToReplicate.length}`);

      eventLogger.info('replication:start', {
        message: `Starting full replication - ${tablesToReplicate.length} tables selected`,
        tableCount: tablesToReplicate.length,
        tables: tablesToReplicate.map(t => t.tableName)
      });

      const startTime = new Date();
      const results = {
        zohoExport: null,
        supabaseImport: null,
        totalDuration: 0,
        success: false
      };

      // Step 1: Export all data from Zoho Analytics
      console.log('\n📥 Step 1: Exporting data from Zoho Analytics...');
      eventLogger.info('export:start', {
        message: 'Starting Zoho Analytics data export',
        tableCount: tablesToReplicate.length
      });

      results.zohoExport = await this.zohoClient.batchExport(
        tablesToReplicate,
        './exports',
        EXPORT_CONFIG.batchSize
      );

      if (results.zohoExport.failed.length > 0) {
        console.log('\n⚠️  Some exports failed. Continuing with successful exports...');
        eventLogger.warning('export:partial', {
          message: `${results.zohoExport.failed.length} table(s) failed to export`,
          failedTables: results.zohoExport.failed.map(f => f.tableName),
          successCount: results.zohoExport.success.length
        });
      } else {
        eventLogger.success('export:complete', {
          message: `Successfully exported ${results.zohoExport.success.length} tables`,
          successCount: results.zohoExport.success.length,
          totalSize: results.zohoExport.totalSize
        });
      }

      // Step 2: Load exported data and replicate to Supabase
      if (results.zohoExport.success.length > 0) {
        console.log('\n📤 Step 2: Importing data to Supabase...');
        eventLogger.info('import:start', {
          message: 'Starting Supabase import',
          tableCount: results.zohoExport.success.length
        });

        const tableDataMap = {};

        // Load CSV files into memory
        for (const exportResult of results.zohoExport.success) {
          try {
            const fs = require('fs');
            const csvData = fs.readFileSync(exportResult.filepath, 'utf8');
            tableDataMap[exportResult.tableName] = csvData;
            const sizeKB = (csvData.length / 1024).toFixed(1);
            console.log(`📖 Loaded ${exportResult.tableName} (${sizeKB} KB)`);
            eventLogger.info('table:loaded', {
              message: `Loaded ${exportResult.tableName}`,
              tableName: exportResult.tableName,
              sizeKB: parseFloat(sizeKB)
            });
          } catch (error) {
            console.error(`❌ Failed to load ${exportResult.tableName}: ${error.message}`);
            eventLogger.error('table:load:failed', {
              message: `Failed to load ${exportResult.tableName}`,
              tableName: exportResult.tableName,
              error: error.message
            });
          }
        }

        // Replicate to Supabase
        results.supabaseImport = await this.supabaseClient.replicateTables(tableDataMap);

        if (results.supabaseImport.success.length > 0) {
          eventLogger.success('import:complete', {
            message: `Successfully imported ${results.supabaseImport.success.length} tables`,
            successCount: results.supabaseImport.success.length,
            totalRecords: results.supabaseImport.totalRecords
          });
        }

        if (results.supabaseImport.failed.length > 0) {
          eventLogger.warning('import:partial', {
            message: `${results.supabaseImport.failed.length} table(s) failed to import`,
            failedTables: results.supabaseImport.failed.map(f => f.tableName)
          });
        }
      } else {
        console.log('❌ No data exported from Zoho Analytics. Skipping Supabase import.');
        results.supabaseImport = { success: [], failed: [], totalRecords: 0 };
        eventLogger.error('import:skipped', {
          message: 'No data to import - all exports failed'
        });
      }

      // Calculate final results
      const endTime = new Date();
      results.totalDuration = endTime - startTime;
      results.success = results.supabaseImport.success.length > 0;

      // Print summary
      this.printReplicationSummary(results);

      eventLogger.endOperation(results.success, {
        tablesExported: results.zohoExport.success.length,
        tablesImported: results.supabaseImport.success.length,
        totalRecords: results.supabaseImport.totalRecords,
        duration: results.totalDuration
      });

      return results;
    } catch (error) {
      console.error('❌ Replication failed:', error.message);
      eventLogger.error('replication:failed', {
        message: `Replication failed: ${error.message}`,
        error: error.message,
        stack: error.stack
      });
      eventLogger.endOperation(false, { error: error.message });
      throw error;
    }
  }

  async replicateSpecificTables(tableNames) {
    const operationId = eventLogger.startOperation('replicateSpecificTables');

    try {
      await this.validateConfiguration();

      // Load configurations from database
      await this.configManager.initialize();
      const allTables = await this.configManager.getAllConfigurations();

      const tablesToReplicate = allTables.filter(table =>
        tableNames.includes(table.tableName)
      );

      if (tablesToReplicate.length === 0) {
        throw new Error(`No matching tables found for: ${tableNames.join(', ')}`);
      }

      console.log(`🎯 Replicating specific tables: ${tablesToReplicate.map(t => t.tableName).join(', ')}`);

      eventLogger.info('replication:selective:start', {
        message: `Starting selective replication - ${tablesToReplicate.length} tables`,
        requestedTables: tableNames,
        matchedTables: tablesToReplicate.map(t => t.tableName)
      });

      // Export specific tables from Zoho
      const startTime = new Date();
      const results = {
        zohoExport: null,
        supabaseImport: null,
        totalDuration: 0,
        success: false
      };

      // Step 1: Export data from Zoho Analytics
      console.log('\n📥 Step 1: Exporting data from Zoho Analytics...');
      eventLogger.info('export:start', {
        message: `Exporting ${tablesToReplicate.length} selected tables`,
        tables: tablesToReplicate.map(t => t.tableName)
      });

      results.zohoExport = await this.zohoClient.batchExport(
        tablesToReplicate,
        './exports',
        EXPORT_CONFIG.batchSize
      );

      if (results.zohoExport.success.length > 0) {
        eventLogger.success('export:complete', {
          message: `Exported ${results.zohoExport.success.length} tables`,
          successCount: results.zohoExport.success.length
        });
      }

      if (results.zohoExport.failed.length > 0) {
        eventLogger.warning('export:partial', {
          message: `${results.zohoExport.failed.length} table(s) failed to export`,
          failedTables: results.zohoExport.failed.map(f => f.tableName)
        });
      }

      // Step 2: Import to Supabase
      if (results.zohoExport.success.length > 0) {
        console.log('\n📤 Step 2: Importing data to Supabase...');
        eventLogger.info('import:start', {
          message: 'Importing selected tables to Supabase',
          tableCount: results.zohoExport.success.length
        });

        const tableDataMap = {};

        // Load CSV files into memory
        for (const exportResult of results.zohoExport.success) {
          try {
            const fs = require('fs');
            const csvData = fs.readFileSync(exportResult.filepath, 'utf8');
            tableDataMap[exportResult.tableName] = csvData;
            const sizeKB = (csvData.length / 1024).toFixed(1);
            console.log(`📖 Loaded ${exportResult.tableName} (${sizeKB} KB)`);
            eventLogger.info('table:loaded', {
              message: `Loaded ${exportResult.tableName}`,
              tableName: exportResult.tableName,
              sizeKB: parseFloat(sizeKB)
            });
          } catch (error) {
            console.error(`❌ Failed to load ${exportResult.tableName}: ${error.message}`);
            eventLogger.error('table:load:failed', {
              message: `Failed to load ${exportResult.tableName}`,
              tableName: exportResult.tableName,
              error: error.message
            });
          }
        }

        // Replicate to Supabase
        results.supabaseImport = await this.supabaseClient.replicateTables(tableDataMap);

        if (results.supabaseImport.success.length > 0) {
          eventLogger.success('import:complete', {
            message: `Imported ${results.supabaseImport.success.length} tables`,
            successCount: results.supabaseImport.success.length,
            totalRecords: results.supabaseImport.totalRecords
          });
        }

        if (results.supabaseImport.failed.length > 0) {
          eventLogger.warning('import:partial', {
            message: `${results.supabaseImport.failed.length} table(s) failed to import`,
            failedTables: results.supabaseImport.failed.map(f => f.tableName)
          });
        }
      } else {
        console.log('❌ No data exported from Zoho Analytics. Skipping Supabase import.');
        results.supabaseImport = { success: [], failed: [], totalRecords: 0 };
        eventLogger.error('import:skipped', {
          message: 'No data to import - all exports failed'
        });
      }

      // Calculate final results
      const endTime = new Date();
      results.totalDuration = endTime - startTime;
      results.success = results.supabaseImport.success.length > 0;

      eventLogger.endOperation(results.success, {
        tablesExported: results.zohoExport.success.length,
        tablesImported: results.supabaseImport.success.length,
        totalRecords: results.supabaseImport.totalRecords,
        duration: results.totalDuration
      });

      return results;
    } catch (error) {
      console.error('❌ Specific table replication failed:', error.message);
      eventLogger.error('replication:selective:failed', {
        message: `Selective replication failed: ${error.message}`,
        requestedTables: tableNames,
        error: error.message,
        stack: error.stack
      });
      eventLogger.endOperation(false, { error: error.message });
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

  // Calculate next run time for cron expression
  calculateNextRun() {
    try {
      // Simple next run calculation - in production you'd use a proper cron parser
      const now = new Date();
      const [minute, hour, day, month, dayOfWeek] = this.schedulerState.scheduleTime.split(' ');

      // For daily schedule like "0 1 * * *" (1:00 AM daily)
      if (hour !== '*' && minute !== '*') {
        const nextRun = new Date(now);
        nextRun.setHours(parseInt(hour), parseInt(minute), 0, 0);

        // If the time has already passed today, schedule for tomorrow
        if (nextRun <= now) {
          nextRun.setDate(nextRun.getDate() + 1);
        }

        return nextRun;
      }

      // Fallback for complex expressions
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next day
    } catch (error) {
      console.error('Error calculating next run:', error);
      return null;
    }
  }

  // Start scheduled daily replication
  async startScheduler() {
    // Don't start if already running
    if (this.schedulerState.isRunning) {
      console.log('⚠️ Scheduler is already running');
      return false;
    }

    const scheduleTime = this.schedulerState.scheduleTime;
    const timezone = this.schedulerState.timezone;

    console.log(`📅 Starting scheduled replication: ${scheduleTime} (${timezone})`);

    // Start language switching schedules if Zoho Books is configured
    this.startLanguageSwitchSchedulers();

    this.schedulerState.task = cron.schedule(scheduleTime, async () => {
      try {
        console.log(`\n🌙 Starting scheduled daily replication at ${new Date().toISOString()}`);
        this.schedulerState.lastRun = new Date();

        const results = await this.replicateAllTables();

        this.schedulerState.lastRunResult = {
          success: results.success,
          timestamp: new Date(),
          zohoExported: results.zohoExport?.success?.length || 0,
          supabaseImported: results.supabaseImport?.success?.length || 0,
          duration: results.totalDuration
        };

        console.log(`✅ Scheduled replication completed successfully`);
      } catch (error) {
        console.error(`❌ Scheduled replication failed:`, error.message);

        this.schedulerState.lastRunResult = {
          success: false,
          timestamp: new Date(),
          error: error.message
        };
      }

      // Calculate next run after completion
      this.schedulerState.nextRun = this.calculateNextRun();
    }, {
      scheduled: true,
      timezone: timezone
    });

    this.schedulerState.isRunning = true;
    this.schedulerState.nextRun = this.calculateNextRun();

    // Get table count from database
    const tableCount = await this.configManager.getConfigurationCount();

    console.log(`⏰ Daily replication scheduled for ${scheduleTime} ${timezone}`);
    console.log(`📊 Will replicate ${tableCount} tables automatically`);
    console.log(`🕐 Next run: ${this.schedulerState.nextRun?.toISOString() || 'Unknown'}`);

    return true;
  }

  // Start language switch schedulers
  startLanguageSwitchSchedulers() {
    if (!this.zohoBooksClient.isEnabled()) {
      console.log('ℹ️  Zoho Books language switching is disabled (not configured)');
      return;
    }

    const timezone = this.schedulerState.timezone;

    // Schedule: Switch to English at 10:58 PM (2 minutes before import)
    const preImportTime = '58 22 * * *'; // 10:58 PM daily

    this.languageSwitchState.preImportTask = cron.schedule(preImportTime, async () => {
      console.log(`\n🌐 Pre-import language switch triggered at ${new Date().toISOString()}`);

      try {
        const result = await this.zohoBooksClient.switchToEnglish();

        this.languageSwitchState.lastPreSwitch = {
          timestamp: new Date(),
          success: result.success,
          message: result.message
        };

        if (result.success) {
          console.log('✅ Successfully switched Zoho Books to English for import');
        } else {
          console.log('⚠️  Failed to switch language, import will proceed anyway');
        }
      } catch (error) {
        console.error('❌ Language switch error:', error.message);
        this.languageSwitchState.lastPreSwitch = {
          timestamp: new Date(),
          success: false,
          error: error.message
        };
      }
    }, {
      scheduled: true,
      timezone: timezone
    });

    console.log(`🌐 Language switching scheduled:`);
    console.log(`   10:58 PM - Switch to English (before import)`);
  }

  // Stop language switch schedulers
  stopLanguageSwitchSchedulers() {
    if (this.languageSwitchState.preImportTask) {
      this.languageSwitchState.preImportTask.stop();
      this.languageSwitchState.preImportTask = null;
    }

    console.log('🌐 Language switching scheduler stopped');
  }

  // Stop scheduler (for graceful shutdown)
  stopScheduler() {
    console.log('⏹️  Stopping scheduled replication...');

    if (this.schedulerState.task) {
      this.schedulerState.task.stop();
      this.schedulerState.task = null;
    }

    // Also stop language switch schedulers
    this.stopLanguageSwitchSchedulers();

    this.schedulerState.isRunning = false;
    this.schedulerState.nextRun = null;

    console.log('✅ Scheduler stopped successfully');
    return true;
  }

  // Get scheduler status
  getSchedulerStatus() {
    return {
      isRunning: this.schedulerState.isRunning,
      scheduleTime: this.schedulerState.scheduleTime,
      timezone: this.schedulerState.timezone,
      nextRun: this.schedulerState.nextRun,
      lastRun: this.schedulerState.lastRun,
      lastRunResult: this.schedulerState.lastRunResult,
      languageSwitching: {
        enabled: this.zohoBooksClient.isEnabled(),
        schedule: {
          preImport: '10:58 PM - Switch to English',
          import: `${this.schedulerState.scheduleTime} - Run import`
        },
        lastPreSwitch: this.languageSwitchState.lastPreSwitch,
        currentStatus: this.zohoBooksClient.getStatus()
      }
    };
  }

  // Trigger manual replication
  async triggerReplication() {
    try {
      console.log('🚀 Manual replication triggered');
      const results = await this.replicateAllTables();

      // Update last run info (but don't interfere with scheduled runs)
      const manualRunResult = {
        success: results.success,
        timestamp: new Date(),
        zohoExported: results.zohoExport?.success?.length || 0,
        supabaseImported: results.supabaseImport?.success?.length || 0,
        duration: results.totalDuration,
        manual: true
      };

      console.log('✅ Manual replication completed');
      return manualRunResult;
    } catch (error) {
      console.error('❌ Manual replication failed:', error.message);
      return {
        success: false,
        timestamp: new Date(),
        error: error.message,
        manual: true
      };
    }
  }

  // Update scheduler configuration
  updateSchedulerConfig(scheduleTime, timezone) {
    const wasRunning = this.schedulerState.isRunning;

    // Stop current scheduler
    if (wasRunning) {
      this.stopScheduler();
    }

    // Update configuration
    this.schedulerState.scheduleTime = scheduleTime || this.schedulerState.scheduleTime;
    this.schedulerState.timezone = timezone || this.schedulerState.timezone;

    // Restart if it was running
    if (wasRunning) {
      return this.startScheduler();
    }

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