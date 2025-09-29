const axios = require('axios');
const readline = require('readline');

// Zoho Books OAuth Configuration
const ZOHO_BOOKS_CONFIG = {
  CLIENT_ID: '1000.NJOIYE8QAXW55YNC7VGW38DXOWDOMN',
  CLIENT_SECRET: '107ff632fda232f5d57155979cb380b56cbf3255b9',
  REDIRECT_URI: 'http://localhost:3000/auth/callback',
  ORGANIZATION_ID: '896180965'
};

// Zoho OAuth URLs
const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.com';
const ZOHO_BOOKS_API_URL = 'https://www.zohoapis.com/books/v3';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function getZohoBooksToken() {
  console.log('🚀 Zoho Books OAuth Token Generator (Simple Mode)');
  console.log('=' .repeat(60));
  console.log('');
  console.log('📋 Configuration:');
  console.log(`   Client ID: ${ZOHO_BOOKS_CONFIG.CLIENT_ID}`);
  console.log(`   Organization ID: ${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`);
  console.log(`   Redirect URI: ${ZOHO_BOOKS_CONFIG.REDIRECT_URI}`);
  console.log('');

  // Step 1: Generate OAuth URL
  const scope = 'ZohoBooks.settings.UPDATE,ZohoBooks.settings.READ,ZohoBooks.fullaccess.all';

  const authUrl = `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?` +
    `scope=${encodeURIComponent(scope)}&` +
    `client_id=${ZOHO_BOOKS_CONFIG.CLIENT_ID}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(ZOHO_BOOKS_CONFIG.REDIRECT_URI)}&` +
    `access_type=offline&` +
    `prompt=consent`; // Force consent to ensure refresh token

  console.log('=' .repeat(60));
  console.log('📌 STEP 1: Authorization');
  console.log('=' .repeat(60));
  console.log('');
  console.log('1. Open this URL in your browser:');
  console.log('');
  console.log('   ' + authUrl);
  console.log('');
  console.log('2. Log in to Zoho (if needed) and authorize the app');
  console.log('');
  console.log('3. After authorization, you will be redirected to:');
  console.log(`   ${ZOHO_BOOKS_CONFIG.REDIRECT_URI}?code=XXXXX`);
  console.log('');
  console.log('4. Copy the CODE value from the URL (everything after "code=")');
  console.log('');
  console.log('   Example: If the URL is:');
  console.log('   https://transfer-order-osaimi-production.up.railway.app/auth/callback?code=1000.abc123xyz456');
  console.log('   Then copy: 1000.abc123xyz456');
  console.log('');
  console.log('=' .repeat(60));
  console.log('');

  // Step 2: Get authorization code from user
  const code = await askQuestion('📝 Paste the authorization code here and press Enter: ');

  if (!code || code.trim() === '') {
    console.log('❌ No code provided. Exiting...');
    rl.close();
    return;
  }

  console.log('');
  console.log('🔄 Exchanging code for tokens...');
  console.log('');

  try {
    // Step 3: Exchange code for tokens
    const tokenResponse = await axios.post(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, null, {
      params: {
        grant_type: 'authorization_code',
        client_id: ZOHO_BOOKS_CONFIG.CLIENT_ID,
        client_secret: ZOHO_BOOKS_CONFIG.CLIENT_SECRET,
        redirect_uri: ZOHO_BOOKS_CONFIG.REDIRECT_URI,
        code: code.trim()
      }
    });

    const tokens = tokenResponse.data;

    console.log('✅ Tokens received successfully!');
    console.log('');
    console.log('=' .repeat(60));
    console.log('📊 TOKEN DETAILS');
    console.log('=' .repeat(60));
    console.log('');
    console.log('Access Token (expires in ' + tokens.expires_in + ' seconds):');
    console.log(tokens.access_token);
    console.log('');

    if (tokens.refresh_token) {
      console.log('🔑 Refresh Token (SAVE THIS - IT WON\'T BE SHOWN AGAIN!):');
      console.log('');
      console.log('   ' + tokens.refresh_token);
      console.log('');
    } else {
      console.log('⚠️  No refresh token received!');
      console.log('   This might happen if:');
      console.log('   - The app was already authorized (try revoking access first)');
      console.log('   - The scope doesn\'t include offline access');
      console.log('');
    }

    // Step 4: Test the token
    console.log('=' .repeat(60));
    console.log('🧪 Testing Token with Zoho Books API');
    console.log('=' .repeat(60));
    console.log('');

    try {
      const testResponse = await axios.get(
        `${ZOHO_BOOKS_API_URL}/organizations/${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokens.access_token}`
          },
          params: {
            organization_id: ZOHO_BOOKS_CONFIG.ORGANIZATION_ID
          }
        }
      );

      const org = testResponse.data.organization;
      console.log('✅ Token verified successfully!');
      console.log('');
      console.log('📚 Organization Details:');
      console.log(`   Name: ${org.name}`);
      console.log(`   Language Code: ${org.language_code}`);
      console.log(`   Currency: ${org.currency_code}`);
      console.log(`   Time Zone: ${org.time_zone}`);
      console.log('');

    } catch (testError) {
      console.log('⚠️  Could not verify token with Zoho Books API');
      console.log('   Error:', testError.response?.data?.message || testError.message);
      console.log('');
      console.log('   This might mean:');
      console.log('   - The token doesn\'t have Zoho Books access');
      console.log('   - The organization ID is incorrect');
      console.log('   - You need to use Zoho Books specific OAuth app');
      console.log('');
    }

    // Step 5: Show .env configuration
    console.log('=' .repeat(60));
    console.log('🔧 Add to your .env file:');
    console.log('=' .repeat(60));
    console.log('');
    console.log('# Zoho Books API (for language switching)');
    console.log(`ZOHO_BOOKS_CLIENT_ID=${ZOHO_BOOKS_CONFIG.CLIENT_ID}`);
    console.log(`ZOHO_BOOKS_CLIENT_SECRET=${ZOHO_BOOKS_CONFIG.CLIENT_SECRET}`);
    console.log(`ZOHO_BOOKS_ORGANIZATION_ID=${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`);
    console.log(`ZOHO_BOOKS_REFRESH_TOKEN=${tokens.refresh_token || 'YOUR_REFRESH_TOKEN_HERE'}`);
    console.log('');

    if (tokens.refresh_token) {
      console.log('✅ Success! You now have all the credentials needed.');
      console.log('');
      console.log('Next steps:');
      console.log('1. Add the above environment variables to your .env file');
      console.log('2. Test the language switching functionality');
      console.log('3. Implement the scheduled language switching');
    }

  } catch (error) {
    console.log('');
    console.log('❌ Token exchange failed!');
    console.log('');

    if (error.response?.data) {
      console.log('Error details:');
      console.log(JSON.stringify(error.response.data, null, 2));
      console.log('');

      if (error.response.data.error === 'invalid_code') {
        console.log('📝 The authorization code is invalid. This could mean:');
        console.log('   - The code was already used (codes are single-use)');
        console.log('   - The code has expired (they expire quickly)');
        console.log('   - The code was copied incorrectly');
        console.log('');
        console.log('👉 Please try again with a fresh authorization code.');
      }
    } else {
      console.log('Error:', error.message);
    }
  }

  rl.close();
}

// Run the script
getZohoBooksToken().catch(error => {
  console.error('Unexpected error:', error);
  rl.close();
  process.exit(1);
});