const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');

async function createCustomerAgingView() {
  const supabaseUrl = new URL(process.env.SUPABASE_URL);
  const projectRef = supabaseUrl.hostname.split('.')[0];
  const pgPassword = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD;
  
  if (!pgPassword) {
    console.error('❌ Database password not found. Please check SUPABASE_DB_PASSWORD or DATABASE_PASSWORD environment variable');
    return;
  }
  
  const pool = new Pool({
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: pgPassword,
    ssl: { rejectUnauthorized: false, checkServerIdentity: () => undefined, ca: false }
  });
  
  try {
    console.log('🔗 Connecting to Supabase...');
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    
    console.log('📋 Reading customer aging view SQL...');
    const sql = fs.readFileSync('create_customer_aging_view.sql', 'utf8');
    
    console.log('🚀 Executing customer aging view creation...');
    await client.query(sql);
    console.log('✅ Customer aging view created successfully');
    
    client.release();
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

createCustomerAgingView();