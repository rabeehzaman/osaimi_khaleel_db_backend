require('dotenv').config();
const axios = require('axios');

async function discoverZohoTables() {
  const credentialServerURL = 'https://osaimikhaleeldbbackend-production.up.railway.app';
  
  try {
    // Discover views directly using the available endpoint
    console.log('🔍 Fetching available views/tables from Zoho...');
    const viewsResponse = await axios.get(`${credentialServerURL}/discover-views`);

    console.log('🔍 Raw response:', JSON.stringify(viewsResponse.data, null, 2));
    const views = viewsResponse.data.views || viewsResponse.data || [];
    
    console.log(`\n✅ Found ${views.length} views/tables in Zoho Analytics:\n`);
    console.log('=' .repeat(80));
    
    views.forEach((view, idx) => {
      const num = idx + 1;
      console.log(`${num}. ${view.viewName}`);
      console.log(`   View ID: ${view.viewId}`);
      console.log(`   Type: ${view.viewType || 'TABLE'}`);
      if (view.description) {
        console.log(`   Description: ${view.description}`);
      }
      console.log('');
    });

    console.log('='.repeat(80));
    console.log(`\nTotal: ${views.length} tables/views available`);
    
  } catch (error) {
    console.error('❌ Error details:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    console.error('   Response status:', error.response?.status);
    console.error('   Response data:', error.response?.data);
    console.error('   Full error:', error);
  }
}

discoverZohoTables();
