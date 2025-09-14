const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ZohoCredentialServer {
  constructor() {
    this.app = express();
    this.port = process.env.CREDENTIAL_SERVER_PORT || 3002;
    this.credentialsFile = path.join(__dirname, '../config/credentials.json');
    this.credentials = this.loadCredentials();
    this.tokens = {};

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Only accept connections from localhost for security
    this.app.use(cors({
      origin: ['http://localhost:3001', 'http://localhost:3000', 'http://localhost:3333'],
      credentials: true
    }));

    this.app.use(express.json());

    // Security: Block external connections
    this.app.use((req, res, next) => {
      const clientIP = req.ip || req.connection.remoteAddress;
      if (!clientIP.includes('127.0.0.1') && !clientIP.includes('::1') && !clientIP.includes('localhost')) {
        return res.status(403).json({ error: 'Access denied: External connections not allowed' });
      }
      next();
    });
  }

  loadCredentials() {
    try {
      if (fs.existsSync(this.credentialsFile)) {
        const data = fs.readFileSync(this.credentialsFile, 'utf8');
        return JSON.parse(data);
      } else {
        console.log('📋 Creating default credentials file...');
        const defaultCredentials = {
          organizations: {},
          activeOrg: null
        };
        this.saveCredentials(defaultCredentials);
        return defaultCredentials;
      }
    } catch (error) {
      console.error('❌ Error loading credentials:', error.message);
      return { organizations: {}, activeOrg: null };
    }
  }

  saveCredentials(credentials = this.credentials) {
    try {
      fs.writeFileSync(this.credentialsFile, JSON.stringify(credentials, null, 2));
      this.credentials = credentials;
    } catch (error) {
      console.error('❌ Error saving credentials:', error.message);
    }
  }

  getZohoEndpoints(region) {
    const endpoints = {
      sa: {
        baseURL: 'https://analyticsapi.zoho.sa/restapi/v2',
        tokenURL: 'https://accounts.zoho.sa/oauth/v2/token'
      },
      com: {
        baseURL: 'https://analyticsapi.zoho.com/restapi/v2',
        tokenURL: 'https://accounts.zoho.com/oauth/v2/token'
      },
      eu: {
        baseURL: 'https://analyticsapi.zoho.eu/restapi/v2',
        tokenURL: 'https://accounts.zoho.eu/oauth/v2/token'
      },
      in: {
        baseURL: 'https://analyticsapi.zoho.in/restapi/v2',
        tokenURL: 'https://accounts.zoho.in/oauth/v2/token'
      }
    };
    return endpoints[region] || endpoints.com;
  }

  async refreshToken(orgId) {
    const org = this.credentials.organizations[orgId];
    if (!org) {
      throw new Error(`Organization ${orgId} not found`);
    }

    try {
      console.log(`🔄 Refreshing token for organization: ${org.name}`);

      const endpoints = this.getZohoEndpoints(org.region);

      const response = await axios.post(endpoints.tokenURL, null, {
        params: {
          grant_type: 'refresh_token',
          client_id: org.clientId,
          client_secret: org.clientSecret,
          refresh_token: org.refreshToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data.access_token) {
        this.tokens[orgId] = {
          access_token: response.data.access_token,
          expires_at: Date.now() + (response.data.expires_in * 1000),
          orgId: org.orgId,
          region: org.region
        };
        console.log(`✅ Token refreshed for ${org.name}`);
        return this.tokens[orgId];
      } else {
        throw new Error('No access token in response');
      }
    } catch (error) {
      console.error(`❌ Failed to refresh token for ${org.name}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async ensureValidToken(orgId) {
    const tokenInfo = this.tokens[orgId];

    // Refresh if token doesn't exist or expires in the next 5 minutes
    if (!tokenInfo || Date.now() + 5 * 60 * 1000 >= tokenInfo.expires_at) {
      await this.refreshToken(orgId);
    }

    return this.tokens[orgId];
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'Zoho Credential Server',
        port: this.port,
        timestamp: new Date().toISOString()
      });
    });

    // Get current active organization info
    this.app.get('/api/organization', (req, res) => {
      const activeOrg = this.credentials.activeOrg;
      if (!activeOrg || !this.credentials.organizations[activeOrg]) {
        return res.status(404).json({ error: 'No active organization set' });
      }

      const org = this.credentials.organizations[activeOrg];
      res.json({
        id: activeOrg,
        name: org.name,
        region: org.region,
        orgId: org.orgId,
        workspaceId: org.workspaceId,
        hasValidToken: Boolean(this.tokens[activeOrg])
      });
    });

    // List all organizations
    this.app.get('/api/organizations', (req, res) => {
      const orgs = Object.keys(this.credentials.organizations).map(id => ({
        id,
        name: this.credentials.organizations[id].name,
        region: this.credentials.organizations[id].region,
        active: id === this.credentials.activeOrg
      }));

      res.json({ organizations: orgs, total: orgs.length });
    });

    // Switch active organization
    this.app.post('/api/organization/switch', (req, res) => {
      const { organizationId } = req.body;

      if (!organizationId || !this.credentials.organizations[organizationId]) {
        return res.status(400).json({ error: 'Invalid organization ID' });
      }

      this.credentials.activeOrg = organizationId;
      this.saveCredentials();

      console.log(`🔄 Switched to organization: ${this.credentials.organizations[organizationId].name}`);

      res.json({
        success: true,
        activeOrg: organizationId,
        name: this.credentials.organizations[organizationId].name
      });
    });

    // Add new organization
    this.app.post('/api/organizations', (req, res) => {
      const { id, name, clientId, clientSecret, refreshToken, orgId, workspaceId, region = 'com' } = req.body;

      if (!id || !name || !clientId || !clientSecret || !refreshToken || !orgId || !workspaceId) {
        return res.status(400).json({
          error: 'Missing required fields: id, name, clientId, clientSecret, refreshToken, orgId, workspaceId'
        });
      }

      this.credentials.organizations[id] = {
        name,
        clientId,
        clientSecret,
        refreshToken,
        orgId,
        workspaceId,
        region
      };

      // Set as active if it's the first organization
      if (!this.credentials.activeOrg) {
        this.credentials.activeOrg = id;
      }

      this.saveCredentials();
      console.log(`✅ Added new organization: ${name}`);

      res.json({ success: true, message: `Organization ${name} added successfully` });
    });

    // Get current access token
    this.app.get('/api/token', async (req, res) => {
      try {
        const activeOrg = this.credentials.activeOrg;
        if (!activeOrg) {
          return res.status(404).json({ error: 'No active organization set' });
        }

        const tokenInfo = await this.ensureValidToken(activeOrg);
        res.json({
          success: true,
          access_token: tokenInfo.access_token,
          orgId: tokenInfo.orgId,
          region: tokenInfo.region,
          expires_at: tokenInfo.expires_at
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Force token refresh
    this.app.post('/api/refresh', async (req, res) => {
      try {
        const activeOrg = this.credentials.activeOrg;
        if (!activeOrg) {
          return res.status(404).json({ error: 'No active organization set' });
        }

        const tokenInfo = await this.refreshToken(activeOrg);
        res.json({
          success: true,
          message: 'Token refreshed successfully',
          expires_at: tokenInfo.expires_at
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // OAuth callback handler
    this.app.get('/callback', async (req, res) => {
      const { code, error } = req.query;

      if (error) {
        console.error('❌ OAuth authorization failed:', error);
        return res.status(400).send(`
          <html>
            <body>
              <h1>OAuth Authorization Failed</h1>
              <p>Error: ${error}</p>
              <p><a href="javascript:window.close()">Close this window</a></p>
            </body>
          </html>
        `);
      }

      if (!code) {
        return res.status(400).send(`
          <html>
            <body>
              <h1>OAuth Callback</h1>
              <p>No authorization code received</p>
              <p><a href="javascript:window.close()">Close this window</a></p>
            </body>
          </html>
        `);
      }

      try {
        console.log('🔄 Processing OAuth callback with authorization code...');

        // Find the organization that's expecting this callback
        // For now, we'll use a temporary storage or assume it's for the active org
        const activeOrg = this.credentials.activeOrg;
        if (!activeOrg) {
          throw new Error('No active organization to associate this token with');
        }

        const org = this.credentials.organizations[activeOrg];
        const endpoints = this.getZohoEndpoints(org.region);

        // Exchange authorization code for tokens
        const response = await axios.post(endpoints.tokenURL, null, {
          params: {
            grant_type: 'authorization_code',
            client_id: org.clientId,
            client_secret: org.clientSecret,
            redirect_uri: 'http://localhost:3002/callback',
            code: code
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        if (response.data.refresh_token) {
          // Update the organization with the refresh token
          this.credentials.organizations[activeOrg].refreshToken = response.data.refresh_token;
          this.saveCredentials();

          // Store the access token
          this.tokens[activeOrg] = {
            access_token: response.data.access_token,
            expires_at: Date.now() + (response.data.expires_in * 1000),
            orgId: org.orgId,
            region: org.region
          };

          console.log(`✅ OAuth tokens received and saved for ${org.name}`);

          res.send(`
            <html>
              <body>
                <h1>✅ OAuth Authorization Successful!</h1>
                <p>Tokens have been saved for organization: <strong>${org.name}</strong></p>
                <p>Refresh token: <code>${response.data.refresh_token}</code></p>
                <p>You can now close this window and use the application.</p>
                <p><a href="javascript:window.close()">Close this window</a></p>
              </body>
            </html>
          `);
        } else {
          throw new Error('No refresh token received from Zoho');
        }
      } catch (error) {
        console.error('❌ Failed to exchange authorization code:', error.response?.data || error.message);

        res.status(500).send(`
          <html>
            <body>
              <h1>❌ Token Exchange Failed</h1>
              <p>Error: ${error.message}</p>
              <p>Please try the authorization flow again.</p>
              <p><a href="javascript:window.close()">Close this window</a></p>
            </body>
          </html>
        `);
      }
    });

    // Generate OAuth authorization URL
    this.app.get('/api/oauth/authorize-url', (req, res) => {
      const { organizationId } = req.query;

      const orgId = organizationId || this.credentials.activeOrg;
      if (!orgId || !this.credentials.organizations[orgId]) {
        return res.status(400).json({ error: 'Invalid or missing organization ID' });
      }

      const org = this.credentials.organizations[orgId];
      const endpoints = this.getZohoEndpoints(org.region);

      const authUrl = `${endpoints.tokenURL.replace('/oauth/v2/token', '/oauth/v2/auth')}?` +
        `scope=ZohoAnalytics.data.read,ZohoAnalytics.metadata.read&` +
        `client_id=${org.clientId}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `redirect_uri=http://localhost:3002/callback`;

      res.json({
        authorizationUrl: authUrl,
        organization: org.name,
        instructions: 'Visit this URL in your browser to authorize the application'
      });
    });

    // Proxy requests to Zoho API
    this.app.all('/api/proxy/*', async (req, res) => {
      try {
        const activeOrg = this.credentials.activeOrg;
        if (!activeOrg) {
          return res.status(404).json({ error: 'No active organization set' });
        }

        const tokenInfo = await this.ensureValidToken(activeOrg);
        const org = this.credentials.organizations[activeOrg];
        const endpoints = this.getZohoEndpoints(org.region);

        // Extract the path after /api/proxy/
        const apiPath = req.path.replace('/api/proxy/', '');
        const fullUrl = `${endpoints.baseURL}/${apiPath}`;

        console.log(`🔄 Proxying ${req.method} request to: ${fullUrl}`);

        const config = {
          method: req.method.toLowerCase(),
          url: fullUrl,
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokenInfo.access_token}`,
            'ZANALYTICS-ORGID': org.orgId,
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

        const response = await axios(config);

        // Forward the response
        res.status(response.status).json(response.data);
      } catch (error) {
        console.error('❌ Proxy request failed:', error.response?.data || error.message);

        res.status(error.response?.status || 500).json({
          error: error.response?.data || error.message,
          proxyError: true
        });
      }
    });
  }

  start() {
    this.app.listen(this.port, 'localhost', () => {
      console.log(`🚀 Zoho Credential Server running on http://localhost:${this.port}`);
      console.log(`📋 Active Organization: ${this.credentials.activeOrg || 'None'}`);
      console.log(`🏢 Total Organizations: ${Object.keys(this.credentials.organizations).length}`);
    });
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new ZohoCredentialServer();
  server.start();
}

module.exports = ZohoCredentialServer;