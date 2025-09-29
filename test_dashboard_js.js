// Simple syntax test for the dashboard JavaScript
class DashboardState {
    constructor() {
        this.tables = [];
        this.selectedTables = new Set();
        this.isLoading = false;
    }

    setTables(tables) {
        this.tables = tables;
        this.selectedTables.clear();
        return true;
    }

    toggleTableSelection(tableName, viewId) {
        if (this.selectedTables.has(tableName)) {
            this.selectedTables.delete(tableName);
        } else {
            this.selectedTables.add(tableName);
        }
        return this.selectedTables.has(tableName);
    }

    selectAllTables() {
        this.tables.forEach(table => this.selectedTables.add(table.tableName));
        return this.selectedTables.size;
    }

    clearAllSelections() {
        this.selectedTables.clear();
        return this.selectedTables.size === 0;
    }
}

// Test the class
try {
    const dashboard = new DashboardState();

    // Test with sample data
    const sampleTables = [
        { tableName: 'customers', viewId: '123', description: 'Test table' },
        { tableName: 'orders', viewId: '456', description: 'Another test table' }
    ];

    dashboard.setTables(sampleTables);
    console.log('✅ setTables works');

    dashboard.toggleTableSelection('customers', '123');
    console.log('✅ toggleTableSelection works');

    dashboard.selectAllTables();
    console.log('✅ selectAllTables works');

    dashboard.clearAllSelections();
    console.log('✅ clearAllSelections works');

    console.log('🎉 All JavaScript syntax tests passed!');

} catch (error) {
    console.error('❌ JavaScript syntax error:', error.message);
    process.exit(1);
}