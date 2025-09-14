const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ZohoBulkClient {
  constructor(config = {}) {
    // Use credential server URL from config or environment
    this.credentialServerURL = config.credentialServerURL || process.env.CREDENTIAL_SERVER_URL || 'http://localhost:3002';

    // For backward compatibility, still accept direct credentials
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.orgId = config.orgId;
    this.workspaceId = config.workspaceId;
    this.baseURL = 'https://analyticsapi.zoho.sa/restapi/v2';
    this.tokenURL = 'https://accounts.zoho.sa/oauth/v2/token';

    // Use credential server by default if available
    this.useCredentialServer = !config.clientId; // Use server if no direct credentials provided

    this.tokens = {
      access_token: null,
      expires_at: 0
    };

    // Current organization info from credential server
    this.currentOrg = null;
  }

  async getTokenFromServer() {
    try {
      const response = await axios.get(`${this.credentialServerURL}/api/token`);

      if (response.data.success) {
        this.tokens.access_token = response.data.access_token;
        this.tokens.expires_at = response.data.expires_at;
        this.orgId = response.data.orgId;
        console.log('✅ Token retrieved from credential server');
        return true;
      } else {
        throw new Error(response.data.error || 'Failed to get token');
      }
    } catch (error) {
      console.error('❌ Failed to get token from credential server:', error.response?.data || error.message);
      throw error;
    }
  }

  async getCurrentOrgInfo() {
    try {
      const response = await axios.get(`${this.credentialServerURL}/api/organization`);
      this.currentOrg = response.data;
      this.workspaceId = response.data.workspaceId;
      this.orgId = response.data.orgId;
      return this.currentOrg;
    } catch (error) {
      console.error('❌ Failed to get organization info:', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken() {
    if (this.useCredentialServer) {
      try {
        console.log('🔄 Refreshing token via credential server...');
        const response = await axios.post(`${this.credentialServerURL}/api/refresh`);
        if (response.data.success) {
          console.log('✅ Token refreshed via credential server');
          return await this.getTokenFromServer();
        }
        throw new Error(response.data.error);
      } catch (error) {
        console.error('❌ Failed to refresh via credential server:', error.response?.data || error.message);
        throw error;
      }
    } else {
      // Fallback to direct token refresh for backward compatibility
      try {
        console.log('🔄 Refreshing Zoho access token directly...');

        const response = await axios.post(this.tokenURL, null, {
          params: {
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        if (response.data.access_token) {
          this.tokens.access_token = response.data.access_token;
          this.tokens.expires_at = Date.now() + (response.data.expires_in * 1000);
          console.log('✅ Access token refreshed successfully');
          return true;
        } else {
          throw new Error('No access token in response');
        }
      } catch (error) {
        console.error('❌ Failed to refresh access token:', error.response?.data || error.message);
        throw error;
      }
    }
  }

  async ensureValidToken() {
    if (this.useCredentialServer) {
      // Get current organization info if not already available
      if (!this.currentOrg) {
        await this.getCurrentOrgInfo();
      }

      // Get token from credential server (it handles refresh automatically)
      await this.getTokenFromServer();
    } else {
      // Refresh if token expires in the next 5 minutes
      if (Date.now() + 5 * 60 * 1000 >= this.tokens.expires_at) {
        await this.refreshAccessToken();
      }
    }
  }

  async exportTableData(viewId, tableName, format = 'csv') {
    await this.ensureValidToken();

    try {
      console.log(`📥 Exporting ${tableName} (view: ${viewId}) in ${format} format with hidden columns...`);

      if (this.useCredentialServer) {
        // Use the proxy endpoint
        console.log(`🔄 Using credential server proxy for data export...`);

        const queryParams = {
          ZOHO_OUTPUT_FORMAT: format.toUpperCase()
        };

        const response = await axios.get(
          `${this.credentialServerURL}/api/proxy/workspaces/${this.workspaceId}/views/${viewId}/data`,
          {
            headers: {
              'Accept': format === 'csv' ? 'text/csv' : 'application/json'
            },
            params: queryParams,
            timeout: 300000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );

        if (response.status === 200) {
          console.log(`✅ Successfully exported ${tableName} - Size: ${response.data.length} characters`);
          return {
            success: true,
            data: response.data,
            tableName,
            format,
            size: response.data.length
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        // Direct API call (backward compatibility)
        const config = {
          responseFormat: format
        };

        const queryParams = {
          ZOHO_OUTPUT_FORMAT: format.toUpperCase()
        };

        const response = await axios.get(
          `${this.baseURL}/workspaces/${this.workspaceId}/views/${viewId}/data`,
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${this.tokens.access_token}`,
              'ZANALYTICS-ORGID': this.orgId,
              'Accept': format === 'csv' ? 'text/csv' : 'application/json'
            },
            params: queryParams,
            timeout: 300000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );

        if (response.status === 200) {
          console.log(`✅ Successfully exported ${tableName} - Size: ${response.data.length} characters`);
          return {
            success: true,
            data: response.data,
            tableName,
            format,
            size: response.data.length
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to export ${tableName}:`, error.response?.data || error.message);
      
      // Handle specific error cases
      if (error.response?.status === 400) {
        const errorData = error.response.data;
        if (typeof errorData === 'string' && errorData.includes('EXCEEDING_USR_PLN_APIUNITS')) {
          throw new Error('API quota exceeded - please try again later');
        }
      }
      
      throw error;
    }
  }

  async getWorkspaceViews() {
    await this.ensureValidToken();

    try {
      console.log(`📋 Fetching views for workspace ${this.workspaceId}...`);

      if (this.useCredentialServer) {
        // Use the proxy endpoint
        const response = await axios.get(
          `${this.credentialServerURL}/api/proxy/workspaces/${this.workspaceId}/views`,
          {
            headers: {
              'Accept': 'application/json'
            }
          }
        );

        if (response.status === 200) {
          console.log('🔍 Raw Zoho API response via proxy:', JSON.stringify(response.data, null, 2));
          return {
            success: true,
            views: response.data.views || []
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        // Direct API call (backward compatibility)
        const response = await axios.get(
          `${this.baseURL}/workspaces/${this.workspaceId}/views`,
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${this.tokens.access_token}`,
              'ZANALYTICS-ORGID': this.orgId,
              'Accept': 'application/json'
            }
          }
        );

        if (response.status === 200) {
          console.log('🔍 Raw Zoho API response:', JSON.stringify(response.data, null, 2));
          return {
            success: true,
            views: response.data.views || []
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to get workspace views:', error.response?.data || error.message);
      throw error;
    }
  }

  async discoverViews() {
    try {
      const result = await this.getWorkspaceViews();
      
      if (!result.success) {
        throw new Error('Failed to fetch workspace views');
      }

      // Process and format the views for easier consumption
      const formattedViews = result.views.map(view => ({
        viewId: view.viewId,
        viewName: view.viewName,
        viewType: view.viewType,
        tableName: this.sanitizeTableName(view.viewName),
        description: view.description || view.viewName,
        isConfigured: this.isViewConfigured(view.viewId)
      }));

      // Sort by view name for easier browsing
      formattedViews.sort((a, b) => a.viewName.localeCompare(b.viewName));

      console.log(`📊 Found ${formattedViews.length} views in workspace`);
      return formattedViews;
    } catch (error) {
      console.error('❌ Failed to discover views:', error.message);
      throw error;
    }
  }

  sanitizeTableName(viewName) {
    // Convert view name to a valid table name
    return viewName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  isViewConfigured(viewId) {
    // Check if this view is already configured in our tables.js
    const { BULK_EXPORT_TABLES } = require('../config/tables');
    return BULK_EXPORT_TABLES.some(table => table.viewId === viewId);
  }

  async exportToFile(viewId, tableName, outputDir = './exports') {
    try {
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Export data
      const result = await this.exportTableData(viewId, tableName, 'csv');
      
      if (result.success) {
        // Save to file
        const filename = `${tableName}_${new Date().toISOString().split('T')[0]}.csv`;
        const filepath = path.join(outputDir, filename);
        
        fs.writeFileSync(filepath, result.data);
        
        console.log(`💾 Saved ${tableName} to ${filepath}`);
        
        return {
          success: true,
          tableName,
          filepath,
          size: result.size,
          filename
        };
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        tableName,
        error: error.message
      };
    }
  }

  async batchExport(tables, outputDir = './exports', batchSize = 3) {
    console.log(`🚀 Starting batch export of ${tables.length} tables...`);
    
    const results = {
      success: [],
      failed: [],
      totalSize: 0,
      startTime: new Date(),
      endTime: null
    };

    // Process tables in batches to avoid overwhelming the API
    for (let i = 0; i < tables.length; i += batchSize) {
      const batch = tables.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tables.length / batchSize)}`);
      
      // Process batch in parallel
      const batchPromises = batch.map(table => 
        this.exportToFile(table.viewId, table.tableName, outputDir)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      batchResults.forEach((result, index) => {
        const table = batch[index];
        
        if (result.status === 'fulfilled' && result.value.success) {
          results.success.push(result.value);
          results.totalSize += result.value.size || 0;
        } else {
          const error = result.status === 'rejected' ? result.reason.message : result.value.error;
          results.failed.push({
            tableName: table.tableName,
            error
          });
        }
      });
      
      // Add delay between batches to be respectful to the API
      if (i + batchSize < tables.length) {
        console.log('⏳ Waiting 10 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    results.endTime = new Date();
    results.duration = results.endTime - results.startTime;
    
    console.log(`\n🏁 Batch export completed:`);
    console.log(`✅ Successful: ${results.success.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`📊 Total size: ${(results.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`⏱️  Duration: ${Math.round(results.duration / 1000)} seconds`);
    
    return results;
  }
}

module.exports = ZohoBulkClient;