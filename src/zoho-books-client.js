const axios = require('axios');

class ZohoBooksClient {
  constructor() {
    // Load configuration from environment variables
    this.config = {
      clientId: process.env.ZOHO_BOOKS_CLIENT_ID,
      clientSecret: process.env.ZOHO_BOOKS_CLIENT_SECRET,
      organizationId: process.env.ZOHO_BOOKS_ORGANIZATION_ID,
      refreshToken: process.env.ZOHO_BOOKS_REFRESH_TOKEN
    };

    // Validate configuration
    const missingConfig = [];
    if (!this.config.clientId) missingConfig.push('ZOHO_BOOKS_CLIENT_ID');
    if (!this.config.clientSecret) missingConfig.push('ZOHO_BOOKS_CLIENT_SECRET');
    if (!this.config.organizationId) missingConfig.push('ZOHO_BOOKS_ORGANIZATION_ID');
    if (!this.config.refreshToken) missingConfig.push('ZOHO_BOOKS_REFRESH_TOKEN');

    if (missingConfig.length > 0) {
      console.warn(`⚠️  Zoho Books Client: Missing environment variables: ${missingConfig.join(', ')}`);
      console.warn('   Language switching will be disabled.');
      this.enabled = false;
    } else {
      this.enabled = true;
    }

    // API URLs
    this.zohoAccountsUrl = 'https://accounts.zoho.com';
    this.zohoBooksApiUrl = 'https://www.zohoapis.com/books/v3';

    // Token management
    this.accessToken = null;
    this.tokenExpiresAt = null;

    // Language switch tracking
    this.lastLanguageSwitch = null;
    this.originalLanguage = null;
  }

  // Check if the client is enabled
  isEnabled() {
    return this.enabled;
  }

  // Get access token using refresh token
  async getAccessToken() {
    if (!this.enabled) {
      throw new Error('Zoho Books client is not enabled. Check environment configuration.');
    }

    // Return existing token if still valid (with 5 minute buffer)
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 300000) {
      return this.accessToken;
    }

    try {
      console.log('🔄 Refreshing Zoho Books access token...');

      const response = await axios.post(`${this.zohoAccountsUrl}/oauth/v2/token`, null, {
        params: {
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.config.refreshToken
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);

      console.log('✅ Zoho Books access token refreshed successfully');
      return this.accessToken;

    } catch (error) {
      console.error('❌ Failed to refresh Zoho Books access token:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get current organization details including language
  async getOrganizationDetails() {
    if (!this.enabled) {
      console.log('⚠️  Zoho Books client is disabled');
      return null;
    }

    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get(
        `${this.zohoBooksApiUrl}/organizations/${this.config.organizationId}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`
          },
          params: {
            organization_id: this.config.organizationId
          }
        }
      );

      return response.data.organization;

    } catch (error) {
      console.error('❌ Failed to get organization details:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get current language
  async getCurrentLanguage() {
    try {
      const org = await this.getOrganizationDetails();
      return org?.language_code || null;
    } catch (error) {
      console.error('❌ Failed to get current language:', error.message);
      return null;
    }
  }

  // Switch organization language
  async switchLanguage(targetLanguage) {
    if (!this.enabled) {
      console.log('⚠️  Zoho Books language switching is disabled (missing configuration)');
      return { success: false, message: 'Zoho Books client is disabled' };
    }

    try {
      console.log(`🌐 Switching Zoho Books language to: ${targetLanguage}`);

      // Get current language first (for backup)
      if (!this.originalLanguage) {
        const currentLang = await this.getCurrentLanguage();
        console.log(`   Current language: ${currentLang}`);

        // Store original language only if we're switching away from it
        if (currentLang && currentLang !== targetLanguage) {
          this.originalLanguage = currentLang;
        }
      }

      // Get access token
      const accessToken = await this.getAccessToken();

      // Switch language
      const response = await axios.put(
        `${this.zohoBooksApiUrl}/organizations/${this.config.organizationId}`,
        { language_code: targetLanguage },
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
          },
          params: {
            organization_id: this.config.organizationId
          }
        }
      );

      if (response.data.code === 0) {
        console.log(`✅ Language switched successfully to: ${targetLanguage}`);
        console.log(`   Response: ${response.data.message}`);

        // Track the switch
        this.lastLanguageSwitch = {
          from: this.originalLanguage,
          to: targetLanguage,
          timestamp: new Date(),
          success: true
        };

        return {
          success: true,
          message: response.data.message,
          previousLanguage: this.originalLanguage,
          newLanguage: targetLanguage
        };
      } else {
        console.log(`⚠️  Unexpected response code: ${response.data.code}`);
        return {
          success: false,
          message: response.data.message || 'Unknown error',
          code: response.data.code
        };
      }

    } catch (error) {
      console.error('❌ Failed to switch language:', error.response?.data || error.message);

      // Track failed attempt
      this.lastLanguageSwitch = {
        to: targetLanguage,
        timestamp: new Date(),
        success: false,
        error: error.message
      };

      return {
        success: false,
        message: error.response?.data?.message || error.message,
        error: true
      };
    }
  }

  // Switch to English (for pre-import)
  async switchToEnglish() {
    console.log('🔤 Preparing Zoho Books for import (switching to English)...');
    return await this.switchLanguage('en');
  }

  // Switch to Arabic (for post-import restoration)
  async switchToArabic() {
    console.log('🔤 Restoring Zoho Books language (switching to Arabic)...');
    return await this.switchLanguage('ar');
  }

  // Restore original language
  async restoreOriginalLanguage() {
    if (!this.originalLanguage) {
      console.log('ℹ️  No original language stored, skipping restoration');
      return { success: true, message: 'No restoration needed' };
    }

    console.log(`🔄 Restoring original language: ${this.originalLanguage}`);
    const result = await this.switchLanguage(this.originalLanguage);

    if (result.success) {
      this.originalLanguage = null; // Clear after successful restoration
    }

    return result;
  }

  // Get language switch status
  getStatus() {
    return {
      enabled: this.enabled,
      organizationId: this.config.organizationId,
      hasRefreshToken: !!this.config.refreshToken,
      lastSwitch: this.lastLanguageSwitch,
      originalLanguage: this.originalLanguage,
      tokenValid: this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt
    };
  }

  // Test connection and get current status
  async testConnection() {
    if (!this.enabled) {
      return {
        connected: false,
        message: 'Zoho Books client is disabled (missing configuration)',
        enabled: false
      };
    }

    try {
      const org = await this.getOrganizationDetails();

      return {
        connected: true,
        enabled: true,
        organization: {
          name: org.name,
          language: org.language_code,
          currency: org.currency_code,
          timezone: org.time_zone
        }
      };
    } catch (error) {
      return {
        connected: false,
        enabled: true,
        message: error.message,
        error: true
      };
    }
  }
}

module.exports = ZohoBooksClient;