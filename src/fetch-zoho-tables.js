const axios = require('axios');

class ZohoTablesFetcher {
  constructor(zohoClient) {
    this.zohoClient = zohoClient;
  }

  async fetchAvailableTables() {
    try {
      // Ensure we have org info first
      if (!this.zohoClient.workspaceId || !this.zohoClient.orgId) {
        try {
          await this.zohoClient.getCurrentOrgInfo();
        } catch (error) {
          console.error('Failed to get org info, will use hardcoded values');
          // Use hardcoded values for testing
          // These are from the configured table view ID: 3097791000000168099
          this.zohoClient.workspaceId = this.zohoClient.workspaceId || '3097791000000009003';
          this.zohoClient.orgId = this.zohoClient.orgId || '60001280952';
        }
      }

      // Ensure token is valid
      await this.zohoClient.ensureValidToken();
      const accessToken = this.zohoClient.tokens?.access_token;

      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      // Get workspace and org IDs
      const workspaceId = this.zohoClient.workspaceId || process.env.ZOHO_WORKSPACE_ID;
      const orgId = this.zohoClient.orgId || process.env.ZOHO_ORG_ID;

      if (!workspaceId || !orgId) {
        throw new Error('Missing Zoho workspace or organization ID');
      }

      console.log('🔍 Fetching available tables from Zoho Analytics...');

      // Fetch views (tables) from Zoho Analytics
      const response = await axios.get(
        `https://analyticsapi.zoho.com/restapi/v2/workspaces/${workspaceId}/views`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'ZANALYTICS-ORGID': orgId
          }
        }
      );

      if (response.data && response.data.data && response.data.data.views) {
        const views = response.data.data.views;

        // Filter and format the views
        const tables = views.map(view => ({
          viewId: view.viewId,
          tableName: view.viewName,
          viewType: view.viewType,
          description: view.viewDesc || 'No description',
          folderId: view.folderId,
          folderName: view.folderName,
          isShared: view.isShared || false,
          createdTime: view.createdTime,
          modifiedTime: view.modifiedTime
        }));

        // Filter to only show tables (not charts, dashboards, etc.)
        const dataTables = tables.filter(t => t.viewType === 'Table');

        console.log(`✅ Found ${dataTables.length} tables in Zoho Analytics`);

        return {
          success: true,
          tables: dataTables,
          total: dataTables.length
        };
      }

      return {
        success: false,
        error: 'No views found',
        tables: []
      };

    } catch (error) {
      console.error('❌ Failed to fetch Zoho tables:', error.message);

      // If it's an auth error, provide more context
      if (error.response && error.response.status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please check your Zoho credentials.',
          tables: []
        };
      }

      return {
        success: false,
        error: error.message,
        tables: []
      };
    }
  }

  async fetchTableDetails(viewId) {
    try {
      // Ensure token is valid
      await this.zohoClient.ensureValidToken();
      const accessToken = this.zohoClient.tokens?.access_token;

      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      const workspaceId = this.zohoClient.workspaceId || process.env.ZOHO_WORKSPACE_ID;
      const orgId = this.zohoClient.orgId || process.env.ZOHO_ORG_ID;

      const response = await axios.get(
        `https://analyticsapi.zoho.com/restapi/v2/workspaces/${workspaceId}/views/${viewId}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'ZANALYTICS-ORGID': orgId
          }
        }
      );

      if (response.data && response.data.data && response.data.data.views) {
        const view = response.data.data.views[0];

        // Get column information
        const columnsResponse = await axios.get(
          `https://analyticsapi.zoho.com/restapi/v2/workspaces/${workspaceId}/views/${viewId}/columns`,
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'ZANALYTICS-ORGID': orgId
            }
          }
        );

        const columns = columnsResponse.data?.data?.columns || [];

        return {
          success: true,
          details: {
            viewId: view.viewId,
            tableName: view.viewName,
            description: view.viewDesc,
            columns: columns.map(col => ({
              columnName: col.columnName,
              dataType: col.dataType,
              maxLength: col.maxLength,
              isPrimaryKey: col.isPrimaryKey || false,
              isNullable: col.isNullable !== false
            })),
            recordCount: view.recordCount || 0,
            createdTime: view.createdTime,
            modifiedTime: view.modifiedTime
          }
        };
      }

      return {
        success: false,
        error: 'Table not found'
      };

    } catch (error) {
      console.error(`❌ Failed to fetch details for table ${viewId}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ZohoTablesFetcher;