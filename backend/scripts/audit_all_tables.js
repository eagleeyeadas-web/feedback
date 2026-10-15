import dotenv from 'dotenv';
dotenv.config();

import supabase from '../src/services/supabase.js';

async function main() {
  const tableNames = [
    'feedback',
    'admin_users',
    'quotations',
    'quotation_items',
    'quotation_sequence',
    'installation_checklist_sequence',
    'installation_checklists',
    'customers',
    'inventory_products',
    'inventory_transactions',
    'job_device_issues',
    'technical_installation_reports',
    'technical_installation_report_items',
    'job_device_returns',
    'inventory_discrepancies',
    'audit_logs',
    'job_device_carry_records',
    'job_device_carry_items',
    'service_engineers',
    'engineer_bookings',
    'system_cleanup_state',
    'store_material_requirements',
    'material_inventory',
    'device_boms',
    'bom_items',
    'material_stock_transactions',
    'job_material_returns',
    'job_expenses',
    'coordinator_bookings',
    'coordinator_booking_audit_logs',
    'pre_installation_backup_declarations',
    'pre_installation_backup_items',
    'stock_movements',
    'retention_cleanup_logs',
    'schedule_extension_requests',
    'rest_day_requests',
    'leave_requests',
    'app_notifications',
    'device_allocations',
    'additional_customer_installations'
  ];

  console.log('=== COMPREHENSIVE SUPABASE TABLE AUDIT ===');
  const existingTables = [];
  const missingTables = [];

  for (const t of tableNames) {
    try {
      const { data, count, error } = await supabase
        .from(t)
        .select('*', { count: 'exact', head: true });

      if (error) {
        missingTables.push({ table: t, error: error.message });
      } else {
        existingTables.push({ table: t, count: count || 0 });
      }
    } catch (err) {
      missingTables.push({ table: t, error: err.message });
    }
  }

  console.log('\n--- EXISTING TABLES & ROW COUNTS ---');
  for (const { table, count } of existingTables) {
    console.log(`${table.padEnd(38)} : ${count} rows`);
  }

  console.log('\n--- TABLES NOT IN DB SCHEMA ---');
  for (const { table, error } of missingTables) {
    console.log(`${table.padEnd(38)} : ${error}`);
  }
}

main().catch(console.error);
