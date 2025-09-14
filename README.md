# Zoho Analytics Bulk Data Replication

A comprehensive solution for replicating data from Zoho Analytics to Supabase using Bulk Export APIs. This tool provides both programmatic and web-based interfaces for efficient large-scale data migration.

## 🚀 Features

- **Bulk Export API Integration**: Uses Zoho Analytics Bulk Export APIs for efficient data extraction
- **Complete Data Replication**: Handles tables up to 1 million rows
- **Web Dashboard**: User-friendly interface for monitoring and controlling replication
- **Selective Replication**: Choose specific tables to replicate
- **Automatic Schema Creation**: Dynamically creates Supabase tables with proper data types
- **Batch Processing**: Processes data in configurable batches to avoid API limits
- **Error Handling**: Comprehensive error handling and retry mechanisms
- **Real-time Logging**: Monitor replication progress in real-time

## 📋 Prerequisites

- Node.js 16+ installed
- Zoho Analytics account with API access
- Supabase project with database access
- Valid Zoho OAuth credentials

## 🛠️ Installation

1. **Clone/Navigate to the project directory:**
   ```bash
   cd zoho-bulk-replication
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   # Zoho Analytics Configuration
   ZOHO_CLIENT_ID=your_client_id_here
   ZOHO_CLIENT_SECRET=your_client_secret_here
   ZOHO_REFRESH_TOKEN=your_refresh_token_here
   ZOHO_ORG_ID=your_org_id_here
   ZOHO_WORKSPACE_ID=your_workspace_id_here

   # Supabase Configuration
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_ANON_KEY=your_supabase_anon_key_here

   # Server Configuration
   PORT=3001
   NODE_ENV=development
   ```

## 🚦 Usage

### Web Dashboard (Recommended)

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open your browser:**
   ```
   http://localhost:3001
   ```

3. **Use the dashboard to:**
   - Test connections to Zoho and Supabase
   - View configured tables
   - Start full or selective replication
   - Monitor progress in real-time

### Command Line Interface

1. **Test connections:**
   ```bash
   npm run replicate -- --test
   ```

2. **Full replication:**
   ```bash
   npm run replicate
   ```

3. **Replicate specific tables:**
   ```bash
   npm run replicate -- --tables invoices customers items
   ```

## 📊 Configured Tables

The system is pre-configured with 17 tables from your Zoho Analytics workspace:

### High Priority Tables
- `invoices` - Invoice data with line items
- `bills` - Bill/purchase data  
- `invoice_items` - Individual invoice line items
- `stock_in_flow` - Stock inbound movements
- `stock_out_flow` - Stock outbound movements

### Medium Priority Tables
- `credit_notes` - Credit note transactions
- `credit_note_items` - Credit note line items
- `fifo_mapping` - FIFO cost mapping
- `customers` - Customer master data
- `vendors` - Vendor master data
- `items` - Product/item master data
- `accrual_transactions` - Accrual and expense transactions

### Low Priority Tables
- `accounts` - Chart of accounts
- `sales_persons` - Sales person master data
- `branch` - Branch/location data
- `transfer_order` - Inventory transfer orders
- `transfer_order_items` - Transfer order line items

## 🔧 Configuration

### Table Configuration

Edit `config/tables.js` to modify table settings:

```javascript
{
  viewId: '101312000000002109',
  tableName: 'invoices',
  description: 'Invoice data with line items',
  estimatedRows: 50000,
  priority: 'high'
}
```

### Export Configuration

Modify export settings in `config/tables.js`:

```javascript
const EXPORT_CONFIG = {
  defaultFormat: 'csv',
  maxRetries: 3,
  retryDelay: 5000,
  batchSize: 5,
  timeout: 300000
};
```

## 🔄 API Endpoints

- `GET /` - Service information
- `GET /tables` - List configured tables
- `POST /test-connection` - Test Zoho and Supabase connections
- `POST /replicate` - Start full replication
- `POST /replicate/tables` - Replicate specific tables
- `GET /status` - Get service status

## 🗂️ Project Structure

```
zoho-bulk-replication/
├── src/
│   ├── server.js              # Express server and API endpoints
│   ├── bulk-replicator.js     # Main replication orchestrator
│   ├── zoho-bulk-client.js    # Zoho Analytics API client
│   └── supabase-bulk-client.js # Supabase database client
├── config/
│   └── tables.js              # Table configurations
├── public/
│   └── index.html             # Web dashboard
├── exports/                   # Temporary CSV export files
├── package.json
├── .env.example
└── README.md
```

## 📈 Performance Characteristics

- **Batch Size**: 5 tables processed simultaneously
- **Retry Logic**: 3 attempts with 5-second delays
- **Timeout**: 5 minutes per table export
- **Memory Efficient**: Streams large CSV files
- **API Respectful**: 10-second delays between batches

## ⚠️ Important Notes

### Zoho Analytics Limitations
- Tables with over 1 million rows require special handling
- Live connect workspace views are not supported
- API quota limits apply (monitor usage)

### Supabase Considerations
- Tables are recreated (existing data is cleared)
- Column names are cleaned for PostgreSQL compatibility
- Automatic data type inference from sample data
- 63-character limit on column names

## 🔍 Troubleshooting

### Common Issues

1. **Connection Failures**
   - Verify environment variables are correct
   - Check network connectivity
   - Ensure API credentials are valid

2. **Export Failures**
   - Check API quota limits
   - Verify view IDs exist in workspace
   - Monitor Zoho Analytics service status

3. **Import Failures**
   - Verify Supabase permissions
   - Check for data type mismatches
   - Monitor Supabase service limits

### Debug Mode

Enable detailed logging by setting:
```env
NODE_ENV=development
```

## 📝 Comparison: Data APIs vs Bulk APIs vs MCP Server

| Feature | Data APIs (Current) | Bulk APIs (This Solution) | MCP Server |
|---------|--------------------|-----------------------------|------------|
| **Best for** | Real-time dashboards | Complete data replication | AI analysis |
| **Row Limits** | 10,000 per call | Up to 1 million per table | Variable |
| **API Efficiency** | Multiple calls needed | Single call per table | AI-optimized |
| **Quota Usage** | High | Low | Medium |
| **Complexity** | High (pagination) | Low | Low (AI-handled) |
| **Data Freshness** | Real-time | Batch/scheduled | On-demand |
| **Use Case** | Live monitoring | Data warehousing | Conversational analysis |

## 🎯 When to Use This Solution

✅ **Use Bulk APIs when:**
- Replicating entire Zoho Analytics database
- Working with large datasets (>10K rows)
- Setting up data warehouses
- Performing one-time or scheduled migrations
- Need complete historical data

❌ **Don't use Bulk APIs when:**
- Need real-time data updates
- Working with small datasets (<1K rows)
- Building live dashboards
- Need AI-powered data analysis

## 🔐 Security

- Environment variables for sensitive credentials
- No credentials stored in code
- HTTPS for all API communications
- Token auto-refresh mechanism
- Input validation and sanitization

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs in the web dashboard
3. Verify your configuration
4. Contact your system administrator

---

**Happy Data Replicating! 🚀**