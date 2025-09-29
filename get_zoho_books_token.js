const express = require('express');
const axios = require('axios');

// Zoho Books OAuth Configuration
const ZOHO_BOOKS_CONFIG = {
  CLIENT_ID: '1000.1ACKGV3P1C4B5IL4JF4G2D9516UY4A',
  CLIENT_SECRET: '6dd8f88d06ec2a607b50e866e31df5d99a5e467626',
  REDIRECT_URI: 'https://transfer-order-osaimi-production.up.railway.app/auth/callback',
  ORGANIZATION_ID: '896180965'
};

// Zoho OAuth URLs
const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.com';

// Store tokens temporarily
let tokens = {
  access_token: null,
  refresh_token: null,
  expires_in: null
};

const app = express();

// Homepage with instructions
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Zoho Books OAuth Token Generator</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          .button {
            display: inline-block;
            padding: 12px 24px;
            background: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
          }
          .button:hover { background: #45a049; }
          .warning {
            background: #fff3cd;
            border: 1px solid #ffeeba;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .scope-info {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          code {
            background: #f8f9fa;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 Zoho Books OAuth Token Generator</h1>

          <div class="scope-info">
            <strong>ℹ️ Scope Information:</strong><br>
            This will request access to Zoho Books with the following permissions:
            <ul>
              <li><code>ZohoBooks.settings.UPDATE</code> - Required to change organization language</li>
              <li><code>ZohoBooks.settings.READ</code> - Required to read organization settings</li>
              <li><code>ZohoBooks.fullaccess.all</code> - Full access to Zoho Books (alternative)</li>
            </ul>
          </div>

          <div class="warning">
            <strong>⚠️ Important:</strong><br>
            • Make sure you're logged into the correct Zoho account<br>
            • This account must have admin access to Zoho Books<br>
            • Organization ID: <code>${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}</code>
          </div>

          <h2>Steps:</h2>
          <ol>
            <li>Click the button below to authenticate with Zoho</li>
            <li>Log in with your Zoho account (if not already logged in)</li>
            <li>Grant the requested permissions</li>
            <li>You'll be redirected back here with your tokens</li>
          </ol>

          <a href="/auth" class="button">🚀 Start OAuth Flow</a>
        </div>
      </body>
    </html>
  `);
});

// Start OAuth flow
app.get('/auth', (req, res) => {
  // Request both settings permissions and full access as fallback
  const scope = 'ZohoBooks.settings.UPDATE,ZohoBooks.settings.READ,ZohoBooks.fullaccess.all';

  const authUrl = `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?` +
    `scope=${encodeURIComponent(scope)}&` +
    `client_id=${ZOHO_BOOKS_CONFIG.CLIENT_ID}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(ZOHO_BOOKS_CONFIG.REDIRECT_URI)}&` +
    `access_type=offline&` +
    `prompt=consent`; // Force consent to ensure refresh token

  console.log('\n📍 Redirecting to Zoho OAuth...');
  console.log('   Scope:', scope);

  res.redirect(authUrl);
});

// Handle OAuth callback
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body style="font-family: Arial; padding: 40px;">
          <h1>❌ OAuth Error</h1>
          <p>Error: ${error}</p>
          <p><a href="/">Try again</a></p>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.send('Error: No authorization code received');
  }

  try {
    console.log('\n🔄 Exchanging code for tokens...');

    const tokenResponse = await axios.post(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, null, {
      params: {
        grant_type: 'authorization_code',
        client_id: ZOHO_BOOKS_CONFIG.CLIENT_ID,
        client_secret: ZOHO_BOOKS_CONFIG.CLIENT_SECRET,
        redirect_uri: ZOHO_BOOKS_CONFIG.REDIRECT_URI,
        code: code
      }
    });

    tokens = tokenResponse.data;

    console.log('✅ Tokens received successfully!');
    console.log('   Access Token:', tokens.access_token ? '✓' : '✗');
    console.log('   Refresh Token:', tokens.refresh_token ? '✓' : '✗');
    console.log('   Expires in:', tokens.expires_in, 'seconds');

    // Test the token by getting organization details
    let orgDetails = null;
    try {
      const testResponse = await axios.get(
        `https://www.zohoapis.com/books/v3/organizations/${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokens.access_token}`
          },
          params: {
            organization_id: ZOHO_BOOKS_CONFIG.ORGANIZATION_ID
          }
        }
      );

      orgDetails = testResponse.data.organization;
      console.log('✅ Token verified! Organization:', orgDetails.name);
      console.log('   Current Language:', orgDetails.language_code);
    } catch (testError) {
      console.log('⚠️  Could not verify token with Zoho Books API');
    }

    // Send success response with tokens
    res.send(`
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 900px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #4CAF50; }
            .token-box {
              background: #f8f9fa;
              border: 1px solid #dee2e6;
              padding: 15px;
              border-radius: 5px;
              margin: 15px 0;
              word-break: break-all;
              font-family: monospace;
              font-size: 12px;
            }
            .copy-btn {
              background: #007bff;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              margin-top: 10px;
            }
            .copy-btn:hover { background: #0056b3; }
            .env-section {
              background: #e8f5e9;
              border: 1px solid #c8e6c9;
              padding: 20px;
              border-radius: 5px;
              margin-top: 30px;
            }
            .warning {
              background: #fff3cd;
              border: 1px solid #ffeeba;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            .org-info {
              background: #d4edda;
              border: 1px solid #c3e6cb;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
          </style>
          <script>
            function copyToClipboard(text, button) {
              navigator.clipboard.writeText(text).then(() => {
                button.textContent = '✓ Copied!';
                setTimeout(() => {
                  button.textContent = 'Copy';
                }, 2000);
              });
            }
          </script>
        </head>
        <body>
          <div class="container">
            <h1>✅ OAuth Authentication Successful!</h1>

            ${orgDetails ? `
            <div class="org-info">
              <strong>📊 Organization Details:</strong><br>
              • Name: <strong>${orgDetails.name}</strong><br>
              • Current Language: <strong>${orgDetails.language_code}</strong><br>
              • Currency: ${orgDetails.currency_code}<br>
              • Organization ID: ${orgDetails.organization_id}
            </div>
            ` : ''}

            <div class="warning">
              <strong>⚠️ Important:</strong> Save these tokens immediately! The refresh token won't be shown again.
            </div>

            <h2>Your Tokens:</h2>

            <h3>Access Token (expires in ${tokens.expires_in} seconds):</h3>
            <div class="token-box">${tokens.access_token}</div>
            <button class="copy-btn" onclick="copyToClipboard('${tokens.access_token}', this)">Copy</button>

            <h3>Refresh Token (SAVE THIS!):</h3>
            <div class="token-box">${tokens.refresh_token || 'Not provided - check OAuth app settings'}</div>
            ${tokens.refresh_token ?
              `<button class="copy-btn" onclick="copyToClipboard('${tokens.refresh_token}', this)">Copy</button>` :
              '<p style="color: red;">⚠️ No refresh token received. You may need to revoke access and try again.</p>'
            }

            <div class="env-section">
              <h3>🔧 Add to your .env file:</h3>
              <div class="token-box">
# Zoho Books API (for language switching)
ZOHO_BOOKS_CLIENT_ID=${ZOHO_BOOKS_CONFIG.CLIENT_ID}
ZOHO_BOOKS_CLIENT_SECRET=${ZOHO_BOOKS_CONFIG.CLIENT_SECRET}
ZOHO_BOOKS_ORGANIZATION_ID=${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}
ZOHO_BOOKS_REFRESH_TOKEN=${tokens.refresh_token || 'YOUR_REFRESH_TOKEN_HERE'}
              </div>
              <button class="copy-btn" onclick="copyToClipboard(\`# Zoho Books API (for language switching)
ZOHO_BOOKS_CLIENT_ID=${ZOHO_BOOKS_CONFIG.CLIENT_ID}
ZOHO_BOOKS_CLIENT_SECRET=${ZOHO_BOOKS_CONFIG.CLIENT_SECRET}
ZOHO_BOOKS_ORGANIZATION_ID=${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}
ZOHO_BOOKS_REFRESH_TOKEN=${tokens.refresh_token || 'YOUR_REFRESH_TOKEN_HERE'}\`, this)">Copy .env variables</button>
            </div>

            <div style="margin-top: 30px;">
              <p><strong>Next Steps:</strong></p>
              <ol>
                <li>Copy the refresh token above</li>
                <li>Add the environment variables to your .env file</li>
                <li>Test the language switching functionality</li>
              </ol>
              <p style="margin-top: 20px;">
                <a href="/">← Start Over</a> |
                <a href="#" onclick="window.close()">Close Window</a>
              </p>
            </div>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Token exchange failed:', error.response?.data || error.message);

    res.send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body style="font-family: Arial; padding: 40px;">
          <h1>❌ Token Exchange Failed</h1>
          <pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>
          <p><a href="/">Try again</a></p>
        </body>
      </html>
    `);
  }
});

// Start server
const PORT = 4500;
app.listen(PORT, () => {
  console.log('🚀 Zoho Books OAuth Token Generator');
  console.log('=' .repeat(50));
  console.log(`📍 Server running at: http://localhost:${PORT}`);
  console.log(`📍 Redirect URI: ${ZOHO_BOOKS_CONFIG.REDIRECT_URI}`);
  console.log('');
  console.log('📋 Configuration:');
  console.log(`   Client ID: ${ZOHO_BOOKS_CONFIG.CLIENT_ID}`);
  console.log(`   Organization ID: ${ZOHO_BOOKS_CONFIG.ORGANIZATION_ID}`);
  console.log('');
  console.log('');
  console.log('👉 Open this URL in your browser:');
  console.log(`   http://localhost:${PORT}`);
});