require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const BulkReplicator = require('./bulk-replicator');
const { BULK_EXPORT_TABLES } = require('../config/tables');
const ZohoTablesFetcher = require('./fetch-zoho-tables');
const DatabaseConfigManager = require('./database-config-manager');
const eventLogger = require('./event-logger');
const fs = require('fs').promises;
const fsSync = require('fs');

// Initialize database config manager
const configManager = new DatabaseConfigManager();

// Runtime table configuration (will be loaded from database)
let runtimeTableConfig = [];

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3333'],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Global replicator instance
let replicator;

// Initialize configuration and replicator
async function initializeServices() {
  try {
    // Load configurations from database
    await configManager.initialize();
    runtimeTableConfig = await configManager.getAllConfigurations();
    console.log(`✅ Loaded ${runtimeTableConfig.length} table configurations from database`);

    // Initialize replicator
    replicator = new BulkReplicator();
    console.log('✅ BulkReplicator initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error.message);
  }
}

// Initialize services on startup - wrapped in async IIFE
(async () => {
  await initializeServices();
  // Start server after initialization completes
  startServer();
})().catch(error => {
  console.error('⚠️  Warning: Failed to initialize services:', error.message);
  // Continue running with fallback configuration
  runtimeTableConfig = [...BULK_EXPORT_TABLES];
  // Start server even if initialization fails
  startServer();
});

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Zoho Bulk Replication Service',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      '/tables': 'GET - List all configured tables',
      '/discover-views': 'GET - Discover all available views in Zoho workspace',
      '/test-connection': 'POST - Test Zoho and Supabase connections',
      '/replicate': 'POST - Start full replication',
      '/replicate/tables': 'POST - Replicate specific tables',
      '/status': 'GET - Get replication status'
    },
    timestamp: new Date().toISOString()
  });
});

// Get all configured tables
app.get('/tables', async (req, res) => {
  try {
    // Refresh from database
    runtimeTableConfig = await configManager.getAllConfigurations();

    res.json({
      success: true,
      total: runtimeTableConfig.length,
      tables: runtimeTableConfig.map(table => ({
        tableName: table.tableName,
        viewId: table.viewId,
        description: table.description,
        estimatedRows: table.estimatedRows,
        priority: table.priority
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test connections
app.post('/test-connection', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized. Check environment configuration.'
    });
  }

  try {
    console.log('🔍 Testing connections via API...');
    const result = await replicator.testConnection();
    
    res.json({
      success: result.success,
      message: result.message || result.error,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start full replication
app.post('/replicate', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized. Check environment configuration.'
    });
  }

  try {
    console.log('🚀 Starting full replication via API...');
    
    // Set a longer timeout for replication
    req.setTimeout(30 * 60 * 1000); // 30 minutes
    res.setTimeout(30 * 60 * 1000);
    
    const results = await replicator.replicateAllTables();
    
    res.json({
      success: results.success,
      zohoExport: {
        successful: results.zohoExport.success.length,
        failed: results.zohoExport.failed.length,
        totalSize: results.zohoExport.totalSize,
        failures: results.zohoExport.failed
      },
      supabaseImport: {
        successful: results.supabaseImport.success.length,
        failed: results.supabaseImport.failed.length,
        totalRecords: results.supabaseImport.totalRecords,
        failures: results.supabaseImport.failed
      },
      duration: Math.round(results.totalDuration / 1000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Replication failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Replicate specific tables
app.post('/replicate/tables', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized. Check environment configuration.'
    });
  }

  const { tables } = req.body;
  
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Please provide an array of table names in the request body'
    });
  }

  try {
    console.log(`🎯 Starting selective replication for: ${tables.join(', ')}`);
    
    // Set a longer timeout for replication
    req.setTimeout(20 * 60 * 1000); // 20 minutes
    res.setTimeout(20 * 60 * 1000);
    
    const results = await replicator.replicateSpecificTables(tables);
    
    res.json({
      success: results.success,
      requestedTables: tables,
      zohoExport: {
        successful: results.zohoExport.success.length,
        failed: results.zohoExport.failed.length,
        totalSize: results.zohoExport.totalSize,
        failures: results.zohoExport.failed
      },
      supabaseImport: {
        successful: results.supabaseImport.success.length,
        failed: results.supabaseImport.failed.length,
        totalRecords: results.supabaseImport.totalRecords,
        failures: results.supabaseImport.failed
      },
      duration: Math.round(results.totalDuration / 1000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Selective replication failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestedTables: tables,
      timestamp: new Date().toISOString()
    });
  }
});

// Proxy requests to Zoho Analytics API
app.all('/api/proxy/*', async (req, res) => {
  try {
    console.log(`🔄 Proxying ${req.method} request to Zoho Analytics API...`);

    // Extract the path after /api/proxy/
    const apiPath = req.path.replace('/api/proxy/', '');

    // Get Zoho credentials and endpoints
    const region = process.env.ZOHO_REGION || 'com';
    const baseURL = `https://analyticsapi.zoho.${region}/restapi/v2`;
    const fullUrl = `${baseURL}/${apiPath}`;

    console.log(`📡 Forwarding to: ${fullUrl}`);

    // Get access token using the same method as ZohoBulkClient
    const zohoClient = replicator.zohoClient;
    await zohoClient.ensureValidToken();

    const config = {
      method: req.method.toLowerCase(),
      url: fullUrl,
      headers: {
        'Authorization': `Zoho-oauthtoken ${zohoClient.tokens.access_token}`,
        'ZANALYTICS-ORGID': zohoClient.orgId,
        'Accept': req.headers.accept || 'application/json'
      },
      params: req.query,
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    };

    if (req.method !== 'GET' && req.body) {
      config.data = req.body;
    }

    const axios = require('axios');
    const response = await axios(config);

    console.log(`✅ Proxy request successful: ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('❌ Proxy request failed:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message,
      proxyError: true,
      timestamp: new Date().toISOString()
    });
  }
});

// Discover all available views in Zoho workspace
app.get('/discover-views', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized. Check environment configuration.'
    });
  }

  try {
    console.log('🔍 Discovering all available views in Zoho workspace...');
    const views = await replicator.discoverViews();

    res.json({
      success: true,
      totalViews: views.length,
      views: views,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Discover only tables (viewType="Table") from Zoho workspace
app.get('/discover-tables', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized. Check environment configuration.'
    });
  }

  try {
    console.log('🔍 Discovering available tables in Zoho workspace...');
    const allViews = await replicator.discoverViews();

    // Filter to only include actual tables (not views, dashboards, etc.)
    const tables = allViews.filter(view => view.viewType === 'Table');

    res.json({
      success: true,
      totalTables: tables.length,
      totalViews: allViews.length,
      tables: tables,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Configure selected tables for replication
app.post('/api/configure-tables', async (req, res) => {
  try {
    const { selectedTables } = req.body;

    if (!selectedTables || !Array.isArray(selectedTables) || selectedTables.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of selected table configurations'
      });
    }

    console.log(`📝 Configuring ${selectedTables.length} tables for replication...`);

    // Get currently configured tables from database
    runtimeTableConfig = await configManager.getAllConfigurations();
    const currentViewIds = runtimeTableConfig.map(table => table.viewId);

    // Filter out tables that are already configured
    const newTables = selectedTables.filter(table => !currentViewIds.includes(table.viewId));

    if (newTables.length === 0) {
      return res.json({
        success: true,
        message: 'All selected tables are already configured',
        addedCount: 0,
        skippedCount: selectedTables.length
      });
    }

    // Add new tables to database
    const addedTables = await configManager.bulkAddConfigurations(newTables);

    // Update runtime configuration
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Also update the original BULK_EXPORT_TABLES array so the replicator can see the changes
    BULK_EXPORT_TABLES.length = 0;
    BULK_EXPORT_TABLES.push(...runtimeTableConfig);

    res.json({
      success: true,
      message: `Successfully configured ${addedTables.length} new tables`,
      addedCount: addedTables.length,
      skippedCount: selectedTables.length - newTables.length,
      totalConfigured: runtimeTableConfig.length,
      addedTables: addedTables.map(table => table.tableName),
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Database configuration updated: ${addedTables.length} new tables added`);
  } catch (error) {
    console.error('❌ Failed to configure tables:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Remove tables from replication configuration
app.delete('/api/configure-tables/:viewId', async (req, res) => {
  try {
    const { viewId } = req.params;

    if (!viewId) {
      return res.status(400).json({
        success: false,
        error: 'View ID is required'
      });
    }

    // Get current configurations from database
    runtimeTableConfig = await configManager.getAllConfigurations();
    const tableIndex = runtimeTableConfig.findIndex(table => table.viewId === viewId);

    if (tableIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Table not found in configuration'
      });
    }

    // Don't allow removal of the last table
    const configCount = await configManager.getConfigurationCount();
    if (configCount <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove the last configured table. At least one table must remain configured.'
      });
    }

    const removedTable = runtimeTableConfig[tableIndex];

    // Remove from database
    const removed = await configManager.removeConfiguration(viewId);
    if (!removed) {
      throw new Error('Failed to remove table from database');
    }

    // Update runtime configuration
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Update BULK_EXPORT_TABLES for backward compatibility
    BULK_EXPORT_TABLES.length = 0;
    BULK_EXPORT_TABLES.push(...runtimeTableConfig);

    console.log(`✅ Table removed from configuration: ${removedTable.tableName}`);

    res.json({
      success: true,
      message: `Successfully removed ${removedTable.tableName} from configuration`,
      removedTable: {
        tableName: removedTable.tableName,
        viewId: removedTable.viewId,
        description: removedTable.description
      },
      totalConfigured: runtimeTableConfig.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to remove table:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Bulk remove multiple tables
app.post('/api/remove-tables', async (req, res) => {
  try {
    const { viewIds } = req.body;

    if (!viewIds || !Array.isArray(viewIds) || viewIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of view IDs to remove'
      });
    }

    // Get current configurations
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Don't allow removing all tables
    const configCount = await configManager.getConfigurationCount();
    if (viewIds.length >= configCount) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove all tables. At least one table must remain configured.'
      });
    }

    const removedTables = [];
    const notFoundTables = [];

    // Process each viewId
    for (const viewId of viewIds) {
      const tableIndex = runtimeTableConfig.findIndex(table => table.viewId === viewId);

      if (tableIndex !== -1) {
        const removedTable = runtimeTableConfig[tableIndex];
        removedTables.push({
          tableName: removedTable.tableName,
          viewId: removedTable.viewId,
          description: removedTable.description
        });
      } else {
        notFoundTables.push(viewId);
      }
    }

    // Remove from database
    if (removedTables.length > 0) {
      const removedViewIds = removedTables.map(t => t.viewId);
      await configManager.bulkRemoveConfigurations(removedViewIds);
    }

    // Update runtime configuration
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Update BULK_EXPORT_TABLES for backward compatibility
    BULK_EXPORT_TABLES.length = 0;
    BULK_EXPORT_TABLES.push(...runtimeTableConfig);

    console.log(`✅ Removed ${removedTables.length} tables from configuration`);

    res.json({
      success: true,
      message: `Successfully removed ${removedTables.length} tables from configuration`,
      removedTables,
      notFoundTables,
      totalConfigured: runtimeTableConfig.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to remove tables:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Scheduler Management Endpoints

// Get detailed scheduler status
app.get('/scheduler/status', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    const status = replicator.getSchedulerStatus();
    res.json({
      success: true,
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start the scheduler
app.post('/scheduler/start', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    const started = replicator.startScheduler();
    const status = replicator.getSchedulerStatus();

    res.json({
      success: true,
      message: started ? 'Scheduler started successfully' : 'Scheduler was already running',
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Stop the scheduler
app.post('/scheduler/stop', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    replicator.stopScheduler();
    const status = replicator.getSchedulerStatus();

    res.json({
      success: true,
      message: 'Scheduler stopped successfully',
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Trigger immediate replication
app.post('/scheduler/trigger', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    console.log('🚀 Manual replication triggered via API...');

    // Set a longer timeout for manual replication
    req.setTimeout(30 * 60 * 1000); // 30 minutes
    res.setTimeout(30 * 60 * 1000);

    const result = await replicator.triggerReplication();

    res.json({
      success: result.success,
      message: result.success ? 'Manual replication completed successfully' : 'Manual replication failed',
      replication: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Update scheduler configuration
app.put('/scheduler/config', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    const { scheduleTime, timezone } = req.body;

    if (!scheduleTime && !timezone) {
      return res.status(400).json({
        success: false,
        error: 'Please provide scheduleTime or timezone to update'
      });
    }

    replicator.updateSchedulerConfig(scheduleTime, timezone);
    const status = replicator.getSchedulerStatus();

    res.json({
      success: true,
      message: 'Scheduler configuration updated successfully',
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Zoho Books Language Management Endpoints

// Get current Zoho Books language
app.get('/api/zoho-books/language', async (req, res) => {
  if (!replicator || !replicator.zohoBooksClient) {
    return res.status(500).json({
      success: false,
      error: 'Zoho Books client not initialized'
    });
  }

  try {
    const language = await replicator.zohoBooksClient.getCurrentLanguage();
    const status = replicator.zohoBooksClient.getStatus();

    res.json({
      success: true,
      language: language,
      status: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Manually switch Zoho Books language
app.post('/api/zoho-books/language', async (req, res) => {
  if (!replicator || !replicator.zohoBooksClient) {
    return res.status(500).json({
      success: false,
      error: 'Zoho Books client not initialized'
    });
  }

  const { language } = req.body;

  if (!language || !['en', 'ar'].includes(language)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid language code (en or ar)'
    });
  }

  try {
    console.log(`🌐 Manual language switch requested: ${language}`);
    const result = await replicator.zohoBooksClient.switchLanguage(language);

    res.json({
      success: result.success,
      message: result.message,
      previousLanguage: result.previousLanguage,
      newLanguage: result.newLanguage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test Zoho Books connection
app.get('/api/zoho-books/test', async (req, res) => {
  if (!replicator || !replicator.zohoBooksClient) {
    return res.status(500).json({
      success: false,
      error: 'Zoho Books client not initialized'
    });
  }

  try {
    const result = await replicator.zohoBooksClient.testConnection();

    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get language switch schedule status
app.get('/api/zoho-books/schedule', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  const schedulerStatus = replicator.getSchedulerStatus();

  res.json({
    success: true,
    languageSwitching: schedulerStatus.languageSwitching,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to check Zoho client configuration
app.get('/debug/zoho-config', (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  const zohoClient = replicator.zohoClient;
  res.json({
    success: true,
    config: {
      useCredentialServer: zohoClient.useCredentialServer,
      hasClientId: !!zohoClient.clientId,
      hasClientSecret: !!zohoClient.clientSecret,
      hasRefreshToken: !!zohoClient.refreshToken,
      orgId: zohoClient.orgId,
      workspaceId: zohoClient.workspaceId,
      region: zohoClient.baseURL?.includes('.com') ? 'com' : 'other',
      credentialServerURL: zohoClient.credentialServerURL,
      hasAccessToken: !!zohoClient.tokens?.access_token,
      tokenExpiry: zohoClient.tokens?.expires_at
    },
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to test token refresh
app.get('/debug/test-token', async (req, res) => {
  if (!replicator) {
    return res.status(500).json({
      success: false,
      error: 'Replicator not initialized'
    });
  }

  try {
    const zohoClient = replicator.zohoClient;
    console.log('🧪 Testing token refresh manually...');

    const beforeState = {
      hasAccessToken: !!zohoClient.tokens?.access_token,
      tokenExpiry: zohoClient.tokens?.expires_at
    };

    await zohoClient.ensureValidToken();

    const afterState = {
      hasAccessToken: !!zohoClient.tokens?.access_token,
      tokenExpiry: zohoClient.tokens?.expires_at
    };

    res.json({
      success: true,
      beforeState,
      afterState,
      tokenWasRefreshed: afterState.hasAccessToken && !beforeState.hasAccessToken,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Table Management Endpoints

// Get available Zoho Analytics tables (not yet configured)
app.get('/api/zoho-tables/available', async (req, res) => {
  if (!replicator || !replicator.zohoClient) {
    return res.status(500).json({
      success: false,
      error: 'Zoho client not initialized'
    });
  }

  try {
    const tablesFetcher = new ZohoTablesFetcher(replicator.zohoClient);
    const result = await tablesFetcher.fetchAvailableTables();

    if (result.success) {
      // Filter out tables that are already configured
      const configuredViewIds = runtimeTableConfig.map(t => t.viewId);
      const availableTables = result.tables.filter(t => !configuredViewIds.includes(t.viewId));

      res.json({
        success: true,
        tables: availableTables,
        total: availableTables.length,
        configured: runtimeTableConfig.length,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get configured tables
app.get('/api/tables/configured', (req, res) => {
  res.json({
    success: true,
    tables: runtimeTableConfig,
    total: runtimeTableConfig.length,
    timestamp: new Date().toISOString()
  });
});

// Add table to schedule
app.post('/api/tables/add', async (req, res) => {
  const { viewId, tableName, description } = req.body;

  if (!viewId || !tableName) {
    return res.status(400).json({
      success: false,
      error: 'viewId and tableName are required'
    });
  }

  // Check if table already exists in database
  const exists = await configManager.isTableConfigured(viewId);
  if (exists) {
    return res.status(400).json({
      success: false,
      error: 'Table is already configured'
    });
  }

  try {
    // Add to database
    const newTable = {
      viewId,
      tableName,
      description: description || `Table ${tableName}`,
      estimatedRows: 1000,
      priority: 'normal'
    };

    const addedTable = await configManager.addConfiguration(newTable);
    if (!addedTable) {
      throw new Error('Failed to add table to database');
    }

    // Update runtime configuration
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Update BULK_EXPORT_TABLES for backward compatibility
    BULK_EXPORT_TABLES.length = 0;
    BULK_EXPORT_TABLES.push(...runtimeTableConfig);

    console.log(`✅ Added table to configuration: ${tableName} (${viewId})`);

    res.json({
      success: true,
      message: `Table ${tableName} added to schedule`,
      table: addedTable,
      totalConfigured: runtimeTableConfig.length,
      timestamp: new Date().toISOString()
    });

    // Restart scheduler if running
    if (replicator && replicator.isSchedulerRunning) {
      replicator.stopScheduler();
      replicator.startScheduler();
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Remove table from schedule
app.post('/api/tables/remove', async (req, res) => {
  const { viewId } = req.body;

  if (!viewId) {
    return res.status(400).json({
      success: false,
      error: 'viewId is required'
    });
  }

  // Get current configurations from database
  runtimeTableConfig = await configManager.getAllConfigurations();

  // Find table
  const tableIndex = runtimeTableConfig.findIndex(t => t.viewId === viewId);
  if (tableIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Table not found in configuration'
    });
  }

  // Don't allow removing the last table
  const configCount = await configManager.getConfigurationCount();
  if (configCount <= 1) {
    return res.status(400).json({
      success: false,
      error: 'Cannot remove the last table. At least one table must remain configured.'
    });
  }

  try {
    const removedTable = runtimeTableConfig[tableIndex];

    // Remove from database
    const removed = await configManager.removeConfiguration(viewId);
    if (!removed) {
      throw new Error('Failed to remove table from database');
    }

    // Update runtime configuration
    runtimeTableConfig = await configManager.getAllConfigurations();

    // Update BULK_EXPORT_TABLES for backward compatibility
    BULK_EXPORT_TABLES.length = 0;
    BULK_EXPORT_TABLES.push(...runtimeTableConfig);

    console.log(`✅ Removed table from configuration: ${removedTable.tableName}`);

    res.json({
      success: true,
      message: `Table ${removedTable.tableName} removed from schedule`,
      removedTable,
      totalConfigured: runtimeTableConfig.length,
      timestamp: new Date().toISOString()
    });

    // Restart scheduler if running
    if (replicator && replicator.isSchedulerRunning) {
      replicator.stopScheduler();
      replicator.startScheduler();
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get table details from Zoho
app.get('/api/zoho-tables/details/:viewId', async (req, res) => {
  const { viewId } = req.params;

  if (!replicator || !replicator.zohoClient) {
    return res.status(500).json({
      success: false,
      error: 'Zoho client not initialized'
    });
  }

  try {
    const tablesFetcher = new ZohoTablesFetcher(replicator.zohoClient);
    const result = await tablesFetcher.fetchTableDetails(viewId);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get replication status (simple health check)
app.get('/status', (req, res) => {
  const status = {
    service: 'Zoho Bulk Replication',
    status: replicator ? 'ready' : 'not_initialized',
    configuredTables: runtimeTableConfig.length,
    environment: {
      zohoConfigured: !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
      supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    },
    scheduler: replicator ? replicator.getSchedulerStatus() : null,
    timestamp: new Date().toISOString()
  };

  res.json(status);
});

// Server-Sent Events (SSE) endpoint for real-time logs
app.get('/api/logs/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Disable response buffering
  res.flushHeaders();

  // Register this client with the event logger
  eventLogger.registerSSEClient(res);

  // Handle client disconnect
  req.on('close', () => {
    eventLogger.unregisterSSEClient(res);
    res.end();
  });
});

// Get recent logs (REST endpoint)
app.get('/api/logs/recent', (req, res) => {
  const count = parseInt(req.query.count) || 100;
  const logs = eventLogger.getRecentLogs(count);

  res.json({
    success: true,
    logs,
    count: logs.length,
    stats: eventLogger.getStats(),
    timestamp: new Date().toISOString()
  });
});

// Clear logs
app.post('/api/logs/clear', (req, res) => {
  eventLogger.clearLogs();

  res.json({
    success: true,
    message: 'Logs cleared successfully',
    timestamp: new Date().toISOString()
  });
});

// Get log statistics
app.get('/api/logs/stats', (req, res) => {
  res.json({
    success: true,
    stats: eventLogger.getStats(),
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /',
      'GET /tables',
      'GET /discover-views',
      'POST /test-connection',
      'POST /replicate',
      'POST /replicate/tables',
      'GET /status'
    ],
    timestamp: new Date().toISOString()
  });
});

// Start server function
function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Zoho Bulk Replication Server running on port ${PORT}`);
    console.log(`📊 Configured tables: ${runtimeTableConfig.length}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Access the service at: http://localhost:${PORT}`);

    if (!replicator) {
      console.log('⚠️  Warning: Replicator not initialized. Check your environment variables.');
    } else {
      console.log('✅ Replicator initialized successfully');

      // Start the scheduled replication service
      try {
        replicator.startScheduler();
        console.log('📅 Automatic daily replication scheduler started');
      } catch (error) {
        console.error('❌ Failed to start scheduler:', error.message);
      }
    }

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      if (replicator) {
        replicator.stopScheduler();
      }
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      if (replicator) {
        replicator.stopScheduler();
      }
      process.exit(0);
    });
  });
}

module.exports = app;