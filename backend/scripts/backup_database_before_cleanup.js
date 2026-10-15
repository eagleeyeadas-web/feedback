import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from '../src/services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, `../backups/pre_cleanup_backup_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`[BACKUP] Starting comprehensive database and data backup to: ${backupDir}`);

  const tables = [
    'quotations',
    'quotation_items',
    'quotation_sequence',
    'admin_users',
    'feedback',
    'installation_checklists',
    'installation_checklist_sequence',
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

  const dbSnapshot = {};
  const backupSummary = {
    timestamp: new Date().toISOString(),
    backupDir,
    tables: {},
    localFiles: {}
  };

  for (const table of tables) {
    try {
      const { data, count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact' });

      if (error) {
        console.warn(`[BACKUP] Error fetching table ${table}:`, error.message);
        backupSummary.tables[table] = { status: 'ERROR', error: error.message };
      } else {
        const rows = data || [];
        dbSnapshot[table] = rows;
        backupSummary.tables[table] = { status: 'OK', count: count || rows.length };
        fs.writeFileSync(
          path.join(backupDir, `table_${table}.json`),
          JSON.stringify(rows, null, 2)
        );
        console.log(`[BACKUP] Saved table ${table.padEnd(35)} : ${rows.length} rows`);
      }
    } catch (err) {
      console.warn(`[BACKUP] Exception fetching table ${table}:`, err.message);
      backupSummary.tables[table] = { status: 'EXCEPTION', error: err.message };
    }
  }

  // Backup all local data files in backend/src/data/
  const dataDir = path.resolve(__dirname, '../src/data');
  const localBackupDir = path.join(backupDir, 'local_data');
  fs.mkdirSync(localBackupDir, { recursive: true });

  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const srcPath = path.join(dataDir, f);
        const dstPath = path.join(localBackupDir, f);
        fs.copyFileSync(srcPath, dstPath);
        backupSummary.localFiles[f] = { sizeBytes: fs.statSync(srcPath).size };
        console.log(`[BACKUP] Saved local file: ${f}`);
      }
    }
  }

  // Backup quotation_sequence.json if present
  const seqFile = path.resolve(__dirname, '../assets/quotation_sequence.json');
  if (fs.existsSync(seqFile)) {
    fs.copyFileSync(seqFile, path.join(backupDir, 'quotation_sequence.json'));
    backupSummary.localFiles['assets/quotation_sequence.json'] = { sizeBytes: fs.statSync(seqFile).size };
    console.log(`[BACKUP] Saved assets/quotation_sequence.json`);
  }

  // Write full summary metadata
  fs.writeFileSync(
    path.join(backupDir, 'backup_summary.json'),
    JSON.stringify(backupSummary, null, 2)
  );

  console.log(`\n[BACKUP SUCCESS] Pre-cleanup backup fully written to: ${backupDir}`);
  return backupDir;
}

runBackup().catch((err) => {
  console.error('[BACKUP FAILED]', err);
  process.exit(1);
});
