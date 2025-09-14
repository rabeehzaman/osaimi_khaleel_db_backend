# Zoho Credential Management Setup Guide

## Overview

This application now uses a localhost credential management server to handle Zoho credentials centrally. This allows for easy organization switching and better security.

## Architecture

```
Main App (Port 3001) ←→ Credential Server (Port 3002) ←→ Zoho APIs
```

The credential server:
- Stores multiple organization credentials
- Handles token refresh automatically
- Provides proxy endpoints for Zoho APIs
- Allows switching between organizations

## Getting Started

### 1. Start Both Servers

**Option A: Start both servers together**
```bash
npm run start-all
```

**Option B: Start servers separately**
```bash
# Terminal 1: Credential server
npm run credential-server

# Terminal 2: Main application
npm start
```

**Option C: Development mode (with auto-reload)**
```bash
npm run dev-all
```

### 2. Add New Organization Credentials

Use the credential server API to add new organizations:

```bash
curl -X POST http://localhost:3002/api/organizations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ultrathink_org",
    "name": "UltraThink Organization",
    "clientId": "your_new_client_id",
    "clientSecret": "your_new_client_secret",
    "refreshToken": "your_new_refresh_token",
    "orgId": "your_new_org_id",
    "workspaceId": "your_new_workspace_id",
    "region": "com"
  }'
```

### 3. Switch Between Organizations

```bash
curl -X POST http://localhost:3002/api/organization/switch \
  -H "Content-Type: application/json" \
  -d '{"organizationId": "ultrathink_org"}'
```

### 4. Check Current Status

```bash
# Current organization
curl http://localhost:3002/api/organization

# All organizations
curl http://localhost:3002/api/organizations

# Current token status
curl http://localhost:3002/api/token
```

## Managing Organizations

### Configuration File

Organizations are stored in `config/credentials.json`:

```json
{
  "organizations": {
    "current_org": {
      "name": "Current Organization (SA)",
      "clientId": "...",
      "clientSecret": "...",
      "refreshToken": "...",
      "orgId": "...",
      "workspaceId": "...",
      "region": "sa"
    },
    "ultrathink_org": {
      "name": "UltraThink Organization",
      "clientId": "...",
      "clientSecret": "...",
      "refreshToken": "...",
      "orgId": "...",
      "workspaceId": "...",
      "region": "com"
    }
  },
  "activeOrg": "current_org"
}
```

### Regions

Supported regions:
- `sa` - Saudi Arabia (zoho.sa)
- `com` - US (zoho.com)
- `eu` - Europe (zoho.eu)
- `in` - India (zoho.in)

## Security Notes

- The credential server only accepts connections from localhost
- Credentials are stored locally in `config/credentials.json`
- Add `config/credentials.json` to `.gitignore` to prevent committing credentials
- Token refresh is handled automatically
- All API requests are proxied through the credential server

## API Endpoints

### Credential Server (Port 3002)

- `GET /health` - Health check
- `GET /api/organization` - Get current organization info
- `GET /api/organizations` - List all organizations
- `POST /api/organizations` - Add new organization
- `POST /api/organization/switch` - Switch active organization
- `GET /api/token` - Get current access token
- `POST /api/refresh` - Force token refresh
- `GET /api/proxy/*` - Proxy requests to Zoho APIs

### Main Application (Port 3001)

- All existing endpoints work the same
- No changes required for existing functionality

## Troubleshooting

### Connection Issues

1. **Credential server not running:**
   ```bash
   npm run credential-server
   ```

2. **Main app can't connect to credential server:**
   - Check `CREDENTIAL_SERVER_URL` in `.env`
   - Ensure credential server is running on port 3002

3. **Zoho API errors:**
   - Verify credentials in `config/credentials.json`
   - Check organization is active: `curl http://localhost:3002/api/organization`
   - Force token refresh: `curl -X POST http://localhost:3002/api/refresh`

### Testing

```bash
# Test credential server
curl http://localhost:3002/health

# Test token retrieval
curl http://localhost:3002/api/token

# Test main application
npm test
```

## Migration from Direct Credentials

The application maintains backward compatibility. If you want to use direct credentials (old method), pass them to the ZohoBulkClient constructor:

```javascript
const client = new ZohoBulkClient({
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
  // ... other credentials
});
```

However, the recommended approach is to use the credential server for better organization management.

## Benefits

✅ **Easy organization switching** - Change active org without modifying code
✅ **Centralized credential management** - One place for all credentials
✅ **Better security** - Credentials isolated from main application
✅ **Multiple app support** - Multiple applications can use same credential server
✅ **Automatic token refresh** - No manual token management needed
✅ **Development flexibility** - Easy testing with different organizations