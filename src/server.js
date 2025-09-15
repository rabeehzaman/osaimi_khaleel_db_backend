require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const BulkReplicator = require('./bulk-replicator');
const { BULK_EXPORT_TABLES } = require('../config/tables');

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
try {
  replicator = new BulkReplicator();
} catch (error) {
  console.error('❌ Failed to initialize BulkReplicator:', error.message);
}

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
app.get('/tables', (req, res) => {
  res.json({
    success: true,
    total: BULK_EXPORT_TABLES.length,
    tables: BULK_EXPORT_TABLES.map(table => ({
      tableName: table.tableName,
      viewId: table.viewId,
      description: table.description,
      estimatedRows: table.estimatedRows,
      priority: table.priority
    }))
  });
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

// Get replication status (simple health check)
app.get('/status', (req, res) => {
  const status = {
    service: 'Zoho Bulk Replication',
    status: replicator ? 'ready' : 'not_initialized',
    configuredTables: BULK_EXPORT_TABLES.length,
    environment: {
      zohoConfigured: !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
      supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    },
    timestamp: new Date().toISOString()
  };

  res.json(status);
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Zoho Bulk Replication Server running on port ${PORT}`);
  console.log(`📊 Configured tables: ${BULK_EXPORT_TABLES.length}`);
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

module.exports = app;