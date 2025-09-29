require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { BULK_EXPORT_TABLES } = require('../config/tables');

class DatabaseConfigManager {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      // Check if there are any configurations in the database
      const { data: existingConfigs, error: fetchError } = await this.supabase
        .from('table_configurations')
        .select('*')
        .eq('enabled', true);

      if (fetchError) {
        console.error('❌ Error fetching existing configurations:', fetchError);
        return false;
      }

      // If no configurations exist, migrate from file config
      if (!existingConfigs || existingConfigs.length === 0) {
        console.log('📦 No configurations found in database. Migrating from file config...');
        await this.migrateFromFileConfig();
      }

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize DatabaseConfigManager:', error);
      return false;
    }
  }

  async migrateFromFileConfig() {
    try {
      // Insert default configurations from file
      const configsToInsert = BULK_EXPORT_TABLES.map(table => ({
        view_id: table.viewId,
        table_name: table.tableName,
        description: table.description,
        estimated_rows: table.estimatedRows || 1000,
        priority: table.priority || 'normal',
        enabled: true
      }));

      const { data, error } = await this.supabase
        .from('table_configurations')
        .insert(configsToInsert)
        .select();

      if (error) {
        console.error('❌ Error migrating configurations:', error);
        return false;
      }

      console.log(`✅ Migrated ${data.length} table configurations to database`);
      return true;
    } catch (error) {
      console.error('❌ Failed to migrate configurations:', error);
      return false;
    }
  }

  async getAllConfigurations() {
    try {
      await this.initialize();

      const { data, error } = await this.supabase
        .from('table_configurations')
        .select('*')
        .eq('enabled', true)
        .order('priority', { ascending: false })
        .order('table_name', { ascending: true });

      if (error) {
        console.error('❌ Error fetching configurations:', error);
        // Fallback to file config
        return BULK_EXPORT_TABLES;
      }

      // Transform database format to application format
      return data.map(config => ({
        viewId: config.view_id,
        tableName: config.table_name,
        description: config.description,
        estimatedRows: config.estimated_rows,
        priority: config.priority
      }));
    } catch (error) {
      console.error('❌ Failed to get configurations:', error);
      // Fallback to file config
      return BULK_EXPORT_TABLES;
    }
  }

  async addConfiguration(table) {
    try {
      await this.initialize();

      const { data, error } = await this.supabase
        .from('table_configurations')
        .upsert({
          view_id: table.viewId,
          table_name: table.tableName,
          description: table.description || `Table ${table.tableName}`,
          estimated_rows: table.estimatedRows || 1000,
          priority: table.priority || 'normal',
          enabled: true,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'view_id'
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Error adding configuration:', error);
        return null;
      }

      return {
        viewId: data.view_id,
        tableName: data.table_name,
        description: data.description,
        estimatedRows: data.estimated_rows,
        priority: data.priority
      };
    } catch (error) {
      console.error('❌ Failed to add configuration:', error);
      return null;
    }
  }

  async removeConfiguration(viewId) {
    try {
      await this.initialize();

      // Soft delete by setting enabled to false
      const { data, error } = await this.supabase
        .from('table_configurations')
        .update({
          enabled: false,
          updated_at: new Date().toISOString()
        })
        .eq('view_id', viewId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error removing configuration:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Failed to remove configuration:', error);
      return false;
    }
  }

  async bulkAddConfigurations(tables) {
    try {
      await this.initialize();

      const configurationsToInsert = tables.map(table => ({
        view_id: table.viewId,
        table_name: table.tableName,
        description: table.description || `Table ${table.tableName}`,
        estimated_rows: table.estimatedRows || 1000,
        priority: table.priority || 'normal',
        enabled: true,
        updated_at: new Date().toISOString()
      }));

      const { data, error } = await this.supabase
        .from('table_configurations')
        .upsert(configurationsToInsert, {
          onConflict: 'view_id'
        })
        .select();

      if (error) {
        console.error('❌ Error bulk adding configurations:', error);
        return [];
      }

      return data.map(config => ({
        viewId: config.view_id,
        tableName: config.table_name,
        description: config.description,
        estimatedRows: config.estimated_rows,
        priority: config.priority
      }));
    } catch (error) {
      console.error('❌ Failed to bulk add configurations:', error);
      return [];
    }
  }

  async bulkRemoveConfigurations(viewIds) {
    try {
      await this.initialize();

      const { error } = await this.supabase
        .from('table_configurations')
        .update({
          enabled: false,
          updated_at: new Date().toISOString()
        })
        .in('view_id', viewIds);

      if (error) {
        console.error('❌ Error bulk removing configurations:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Failed to bulk remove configurations:', error);
      return false;
    }
  }

  async isTableConfigured(viewId) {
    try {
      await this.initialize();

      const { data, error } = await this.supabase
        .from('table_configurations')
        .select('view_id')
        .eq('view_id', viewId)
        .eq('enabled', true)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('❌ Error checking configuration:', error);
        return false;
      }

      return !!data;
    } catch (error) {
      console.error('❌ Failed to check configuration:', error);
      return false;
    }
  }

  async getConfigurationCount() {
    try {
      await this.initialize();

      const { count, error } = await this.supabase
        .from('table_configurations')
        .select('*', { count: 'exact', head: true })
        .eq('enabled', true);

      if (error) {
        console.error('❌ Error getting configuration count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('❌ Failed to get configuration count:', error);
      return 0;
    }
  }
}

module.exports = DatabaseConfigManager;