require('dotenv').config();
const axios = require('axios');

async function testZohoDirectAPI() {
  console.log('🧪 Testing direct Zoho Analytics API access...');

  const credentials = {
    clientId: process.env.ZOHO_CLIENT_ID || '1000.QRJAMJ4E3OKAD16L7AFNZ2XANJ9CII',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || 'bcd11b81e92bb245e0336564cd69b79ad7d73e32ed',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN || '1000.886b58603a287ccf6ff5e20eb00ddfd2.0ff4c41fa9d3c30f5715fe713da64bec',
    orgId: process.env.ZOHO_ORG_ID || '891944057',
    workspaceId: process.env.ZOHO_WORKSPACE_ID || '3097791000000168005',
    region: process.env.ZOHO_REGION || 'com'
  };

  console.log('📋 Configuration:');
  console.log(`   Org ID: ${credentials.orgId}`);
  console.log(`   Workspace ID: ${credentials.workspaceId}`);
  console.log(`   Region: ${credentials.region}`);
  console.log(`   Client ID: ${credentials.clientId}`);

  try {
    // Step 1: Get access token
    console.log('\n🔑 Step 1: Getting access token...');
    const tokenURL = `https://accounts.zoho.${credentials.region}/oauth/v2/token`;

    const tokenResponse = await axios.post(tokenURL, null, {
      params: {
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!tokenResponse.data.access_token) {
      throw new Error('Failed to get access token');
    }

    const accessToken = tokenResponse.data.access_token;
    console.log('✅ Access token obtained successfully');

    // Step 2: Test API connectivity - get workspace info
    console.log('\n📊 Step 2: Testing workspace access...');
    const baseURL = `https://analyticsapi.zoho.${credentials.region}/restapi/v2`;

    try {
      const workspaceResponse = await axios.get(
        `${baseURL}/workspaces/${credentials.workspaceId}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'ZANALYTICS-ORGID': credentials.orgId,
            'Accept': 'application/json'
          }
        }
      );

      console.log('✅ Workspace access successful');
      console.log(`   Workspace Name: ${workspaceResponse.data.workspaceName || 'N/A'}`);
      console.log(`   Status: ${workspaceResponse.data.status || 'N/A'}`);
    } catch (workspaceError) {
      console.log('⚠️  Workspace access failed, but continuing...');
      console.log(`   Error: ${workspaceError.response?.data?.message || workspaceError.message}`);
    }

    // Step 3: Get views/tables in workspace
    console.log('\n📋 Step 3: Getting views/tables in workspace...');
    const viewsResponse = await axios.get(
      `${baseURL}/workspaces/${credentials.workspaceId}/views`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'ZANALYTICS-ORGID': credentials.orgId,
          'Accept': 'application/json'
        }
      }
    );

    console.log('✅ Views request successful');
    console.log('\n🔍 Raw API Response:');
    console.log(JSON.stringify(viewsResponse.data, null, 2));

    const views = viewsResponse.data.views || [];
    console.log(`\n📊 Found ${views.length} views/tables:`);

    if (views.length > 0) {
      console.log('\n='.repeat(80));
      views.forEach((view, idx) => {
        console.log(`${idx + 1}. ${view.viewName}`);
        console.log(`   View ID: ${view.viewId}`);
        console.log(`   Type: ${view.viewType || 'TABLE'}`);
        if (view.description) {
          console.log(`   Description: ${view.description}`);
        }
        console.log('');
      });
      console.log('='.repeat(80));

      // Generate table configuration
      console.log('\n📝 Sample configuration for config/tables.js:\n');
      console.log('const BULK_EXPORT_TABLES = [');
      console.log('  // Current working table:');
      console.log('  {');
      console.log('    viewId: "3097791000000168099",');
      console.log('    tableName: "customers",');
      console.log('    description: "Customer contact data from Zoho Books",');
      console.log('    estimatedRows: 1000,');
      console.log('    priority: "high"');
      console.log('  },');
      console.log('  // Additional discovered tables:');

      views.slice(0, 5).forEach(view => {
        const tableName = view.viewName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        console.log('  {');
        console.log(`    viewId: "${view.viewId}",`);
        console.log(`    tableName: "${tableName}",`);
        console.log(`    description: "${view.viewName}",`);
        console.log('    estimatedRows: 1000,');
        console.log('    priority: "medium"');
        console.log('  },');
      });

      console.log('  // ... add more tables as needed');
      console.log('];');

    } else {
      console.log('\n⚠️  No views found. This could mean:');
      console.log('   - The workspace is empty');
      console.log('   - Insufficient permissions');
      console.log('   - Incorrect workspace ID');
      console.log('   - Data is still syncing from Zoho Books');
    }

  } catch (error) {
    console.error('\n❌ API Test Failed:');
    console.error('   Status:', error.response?.status);
    console.error('   Error:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      console.error('\n🔐 Authentication Error - Check:');
      console.error('   - Client ID and Secret are correct');
      console.error('   - Refresh token is valid and not expired');
      console.error('   - OAuth scope includes ZohoAnalytics.metadata.read');
    } else if (error.response?.status === 404) {
      console.error('\n📍 Not Found Error - Check:');
      console.error('   - Workspace ID is correct');
      console.error('   - Organization ID is correct');
      console.error('   - You have access to this workspace');
    }
  }
}

testZohoDirectAPI();