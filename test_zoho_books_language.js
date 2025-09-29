const axios = require('axios');

// Zoho Books credentials - NEW OAuth App
const ZOHO_BOOKS_CONFIG = {
  CLIENT_ID: '1000.NJOIYE8QAXW55YNC7VGW38DXOWDOMN',
  CLIENT_SECRET: '107ff632fda232f5d57155979cb380b56cbf3255b9',
  ORGANIZATION_ID: '896180965',
  REFRESH_TOKEN: '1000.41dee3b9168ea3ac699d7bad2ef75321.b7fab4c8f1333b93cf4320a8bdaeb6c3'
};

// Zoho API URLs
const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.com';
const ZOHO_BOOKS_API_URL = 'https://www.zohoapis.com/books/v3';

let accessToken = null;

// Get access token using refresh token
async function getAccessToken() {
  try {
    console.log('🔄 Getting access token using refresh token...');

    const response = await axios.post(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, null, {
      params: {
        grant_type: 'refresh_token',
        client_id: ZOHO_BOOKS_CONFIG.CLIENT_ID,
        client_secret: ZOHO_BOOKS_CONFIG.CLIENT_SECRET,
        refresh_token: ZOHO_BOOKS_CONFIG.REFRESH_TOKEN
      }
    });

    accessToken = response.data.access_token;
    console.log('✅ Access token obtained successfully');
    console.log(`   Token expires in: ${response.data.expires_in} seconds`);

    return accessToken;
  } catch (error) {
    console.error('❌ Failed to get access token:', error.response?.data || error.message);
    throw error;
  }
}

// Get current organization details including language
async function getOrganizationDetails() {
  try {
    console.log('\n📊 Getting organization details...');

    const response = await axios.get(`${ZOHO_BOOKS_API_URL}/organizations/${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      },
      params: {
        organization_id: ZOHO_BOOKS_CONFIG.ORGANIZATION_ID
      }
    });

    const org = response.data.organization;
    console.log('✅ Organization details retrieved:');
    console.log(`   Name: ${org.name}`);
    console.log(`   Language Code: ${org.language_code}`);
    console.log(`   Currency: ${org.currency_code}`);
    console.log(`   Time Zone: ${org.time_zone}`);
    console.log(`   Fiscal Year Start: ${org.fiscal_year_start_month}`);

    return org;
  } catch (error) {
    console.error('❌ Failed to get organization details:', error.response?.data || error.message);
    throw error;
  }
}

// Switch organization language
async function switchOrganizationLanguage(targetLanguage) {
  try {
    console.log(`\n🔄 Attempting to switch language to: ${targetLanguage}`);

    const updateData = {
      language_code: targetLanguage
    };

    console.log(`   Request body: ${JSON.stringify(updateData)}`);

    const response = await axios.put(
      `${ZOHO_BOOKS_API_URL}/organizations/${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`,
      updateData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          organization_id: ZOHO_BOOKS_CONFIG.ORGANIZATION_ID
        }
      }
    );

    if (response.data.code === 0) {
      console.log(`✅ Language switch successful!`);
      console.log(`   Response: ${response.data.message}`);

      // Return the updated organization data if available
      if (response.data.organization) {
        console.log(`   New language: ${response.data.organization.language_code}`);
      }

      return response.data;
    } else {
      console.log(`⚠️ API returned code ${response.data.code}: ${response.data.message}`);
      return response.data;
    }
  } catch (error) {
    console.error('❌ Failed to switch language:', error.response?.data || error.message);

    // Log detailed error information
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Headers:', error.response.headers);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }

    throw error;
  }
}

// Test the language switching functionality
async function testLanguageSwitching() {
  try {
    console.log('🚀 Starting Zoho Books Language Switch Test');
    console.log('=' .repeat(50));

    // Step 1: Get access token
    await getAccessToken();

    // Step 2: Get current organization details
    const initialOrg = await getOrganizationDetails();
    const originalLanguage = initialOrg.language_code;

    console.log(`\n📌 Original language: ${originalLanguage}`);

    // Step 3: Determine target language for test
    const testLanguage = originalLanguage === 'en' ? 'ar' : 'en';
    console.log(`📌 Will test switching to: ${testLanguage}`);

    // Step 4: Switch to test language
    console.log('\n' + '=' .repeat(50));
    console.log('TEST 1: Switch to test language');
    console.log('=' .repeat(50));

    await switchOrganizationLanguage(testLanguage);

    // Step 5: Verify the change
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    const afterSwitch = await getOrganizationDetails();

    if (afterSwitch.language_code === testLanguage) {
      console.log(`✅ Language successfully changed to ${testLanguage}`);
    } else {
      console.log(`⚠️ Language is still ${afterSwitch.language_code}, expected ${testLanguage}`);
    }

    // Step 6: Switch back to original language
    console.log('\n' + '=' .repeat(50));
    console.log('TEST 2: Switch back to original language');
    console.log('=' .repeat(50));

    await switchOrganizationLanguage(originalLanguage);

    // Step 7: Verify restoration
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    const afterRestore = await getOrganizationDetails();

    if (afterRestore.language_code === originalLanguage) {
      console.log(`✅ Language successfully restored to ${originalLanguage}`);
    } else {
      console.log(`⚠️ Language is ${afterRestore.language_code}, expected ${originalLanguage}`);
    }

    // Summary
    console.log('\n' + '=' .repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(50));
    console.log(`Original Language: ${originalLanguage}`);
    console.log(`Test Switch To: ${testLanguage} - ${afterSwitch.language_code === testLanguage ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Restore To Original: ${originalLanguage} - ${afterRestore.language_code === originalLanguage ? '✅ SUCCESS' : '❌ FAILED'}`);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

// Run the test
console.log('🔧 Zoho Books Language Switching Test');
console.log('Using Organization ID:', ZOHO_BOOKS_CONFIG.ORGANIZATION_ID);
console.log('');

testLanguageSwitching()
  .then(() => {
    console.log('\n✅ All tests completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  });