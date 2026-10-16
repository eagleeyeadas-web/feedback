import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from '../src/services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function executeCleanAdminPanel() {
  console.log('====================================================');
  console.log('   EAGLE EYE SAFDRIVE - CLEAN ADMIN PANEL RUNNER    ');
  console.log('====================================================');

  // STEP 1: SAFETY ASSERTIONS - QUOTATIONS & ADMIN ACCOUNTS
  console.log('\n[1/6] Verifying protected records before cleaning...');
  const { data: qBefore, count: qCountBefore, error: qErr } = await supabase
    .from('quotations')
    .select('id, quotation_number', { count: 'exact' });

  if (qErr || qCountBefore !== 28) {
    throw new Error(`CRITICAL ABORT: Expected 28 quotations, found ${qCountBefore}. Error: ${qErr?.message}`);
  }

  const { data: qiBefore, count: qiCountBefore, error: qiErr } = await supabase
    .from('quotation_items')
    .select('id', { count: 'exact' });

  if (qiErr || qiCountBefore !== 33) {
    throw new Error(`CRITICAL ABORT: Expected 33 quotation items, found ${qiCountBefore}. Error: ${qiErr?.message}`);
  }

  const { data: uBefore, count: uCountBefore, error: uErr } = await supabase
    .from('admin_users')
    .select('id, email', { count: 'exact' });

  if (uErr || uCountBefore !== 6) {
    throw new Error(`CRITICAL ABORT: Expected 6 admin users, found ${uCountBefore}. Error: ${uErr?.message}`);
  }

  console.log(`✓ Safety check passed: 28 quotations, 33 quotation items, 6 admin users strictly protected.`);

  // STEP 2: DELETE DUMMY & TEST OPERATIONAL DATA IN REVERSE DEPENDENCY ORDER
  console.log('\n[2/6] Deleting test records from operational tables...');

  const operationalTablesToDelete = [
    { name: 'technical_installation_report_items', key: 'id' },
    { name: 'technical_installation_reports', key: 'id' },
    { name: 'job_expenses', key: 'id' },
    { name: 'job_material_returns', key: 'id' },
    { name: 'job_device_returns', key: 'id' },
    { name: 'pre_installation_backup_items', key: 'id' },
    { name: 'pre_installation_backup_declarations', key: 'id' },
    { name: 'engineer_bookings', key: 'id' },
    { name: 'coordinator_bookings', key: 'id' },
    { name: 'coordinator_booking_audit_logs', key: 'id' },
    { name: 'job_device_carry_items', key: 'id' },
    { name: 'job_device_carry_records', key: 'id' },
    { name: 'store_material_requirements', key: 'id' },
    { name: 'schedule_extension_requests', key: 'id' },
    { name: 'rest_day_requests', key: 'id' },
    { name: 'leave_requests', key: 'id' },
    { name: 'app_notifications', key: 'id' },
    { name: 'installation_checklists', key: 'id' },
    { name: 'material_stock_transactions', key: 'id' },
    { name: 'stock_movements', key: 'id' },
    { name: 'retention_cleanup_logs', key: 'id' },
    { name: 'feedback', key: 'id' }
  ];

  const deletionReport = {};

  for (const { name, key } of operationalTablesToDelete) {
    try {
      // Check count before
      const { count: beforeCount } = await supabase
        .from(name)
        .select('*', { count: 'exact', head: true });

      if (beforeCount && beforeCount > 0) {
        // Delete all rows safely using not null filter
        const { error: delErr } = await supabase
          .from(name)
          .delete()
          .not(key, 'is', null);

        if (delErr) {
          console.error(`  ✗ Error cleaning ${name}:`, delErr.message);
          deletionReport[name] = { status: 'ERROR', error: delErr.message };
        } else {
          // Check count after
          const { count: afterCount } = await supabase
            .from(name)
            .select('*', { count: 'exact', head: true });

          console.log(`  ✓ Cleaned table ${name.padEnd(36)} : Removed ${beforeCount} records -> Now ${afterCount || 0} rows`);
          deletionReport[name] = { status: 'CLEANED', removed: beforeCount, remaining: afterCount || 0 };
        }
      } else {
        console.log(`  - Table ${name.padEnd(38)} : Already empty (0 rows)`);
        deletionReport[name] = { status: 'EMPTY', removed: 0, remaining: 0 };
      }
    } catch (err) {
      console.warn(`  ! Exception on table ${name}:`, err.message);
      deletionReport[name] = { status: 'EXCEPTION', error: err.message };
    }
  }

  // STEP 3: RESET INVENTORY DEVICE STOCK COUNTERS TO 0 (PRESERVE 7 PRODUCT DEFINITIONS)
  console.log('\n[3/6] Resetting inventory device products to zero stock (preserving catalog items)...');
  const { data: devProducts, error: devErr } = await supabase
    .from('inventory_products')
    .select('id, sku, device_name');

  if (devErr) {
    console.error('Error fetching inventory_products:', devErr.message);
  } else if (devProducts) {
    for (const prod of devProducts) {
      const { error: updErr } = await supabase
        .from('inventory_products')
        .update({
          opening_quantity: 0,
          opening_stock_set: false,
          usable_stock: 0,
          reserved_stock: 0,
          issued_stock: 0,
          returned_usable_stock: 0,
          damaged_stock: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', prod.id);

      if (updErr) {
        console.error(`Error resetting stock for ${prod.sku}:`, updErr.message);
      } else {
        console.log(`  ✓ Reset product stock: ${prod.sku.padEnd(16)} (${prod.device_name}) -> 0 stock`);
      }
    }
  }

  // STEP 4: RESET MATERIAL INVENTORY TO OPENING BASELINE (PRESERVE 13 MATERIALS)
  console.log('\n[4/6] Resetting material inventory to baseline opening stock (preserving 13 catalog materials)...');
  const baselineOpeningStock = {
    'MAT-INSU-TAPE': { opening: 100, opening_set: true },
    'MAT-CT-200MM': { opening: 50, opening_set: true },
    'MAT-CT-300MM': { opening: 40, opening_set: true },
    'MAT-SCREW-LONG': { opening: 500, opening_set: true },
    'MAT-SCREW-SMALL': { opening: 500, opening_set: true },
    'MAT-MEM-CARD': { opening: 100, opening_set: true },
    'MAT-WIRE-0.5MM': { opening: 1000, opening_set: true },
    'MAT-CBL-5M': { opening: 150, opening_set: true },
    'MAT-CBL-15M': { opening: 50, opening_set: true },
    'MAT-CAM-LOOSE': { opening: 50, opening_set: true },
    'MAT-DISP-LOOSE': { opening: 50, opening_set: true },
    'MAT-DISP-LIVE': { opening: 0, opening_set: false },
    'MAT-DISP-REC': { opening: 0, opening_set: false }
  };

  const { data: materials, error: matErr } = await supabase
    .from('material_inventory')
    .select('id, sku, material_name');

  if (matErr) {
    console.error('Error fetching material_inventory:', matErr.message);
  } else if (materials) {
    for (const m of materials) {
      const base = baselineOpeningStock[m.sku] || { opening: 0, opening_set: false };
      const { error: updErr } = await supabase
        .from('material_inventory')
        .update({
          opening_stock: base.opening,
          current_stock: base.opening,
          opening_stock_set: base.opening_set,
          issued_stock: 0,
          damaged_stock: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', m.id);

      if (updErr) {
        console.error(`Error resetting material stock for ${m.sku}:`, updErr.message);
      } else {
        console.log(`  ✓ Reset material: ${m.sku.padEnd(16)} (${m.material_name}) -> Current: ${base.opening}, Issued: 0`);
      }
    }
  }

  // STEP 5: RESET SEQUENCE & LOCAL DATA STORES
  console.log('\n[5/6] Resetting installation sequence and clearing local fallback stores...');

  // Reset checklist sequence counter
  try {
    await supabase
      .from('installation_checklist_sequence')
      .update({ last_value: 0, updated_at: new Date().toISOString() })
      .not('date_key', 'is', null);
    console.log('  ✓ Reset installation_checklist_sequence last_value to 0');
  } catch (seqErr) {
    console.warn('  ! Sequence reset note:', seqErr.message);
  }

  // Reset local files in backend/src/data/
  const dataDir = path.resolve(__dirname, '../src/data');

  // 1. workflow_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'workflow_storage.json'),
    JSON.stringify({
      carryRecords: {},
      completionReports: {},
      returns: {},
      materialReturns: {},
      finalBoms: {},
      additionalInstallations: {}
    }, null, 2)
  );
  console.log('  ✓ Reset workflow_storage.json');

  // 2. backup_items_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'backup_items_storage.json'),
    JSON.stringify({
      declarations: {},
      verifiedReturns: {},
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset backup_items_storage.json');

  // 3. engineer_bookings_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'engineer_bookings_storage.json'),
    JSON.stringify({
      bookings: {},
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset engineer_bookings_storage.json');

  // 4. coordinator_bookings_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'coordinator_bookings_storage.json'),
    JSON.stringify({
      bookings: [],
      auditLogs: []
    }, null, 2)
  );
  console.log('  ✓ Reset coordinator_bookings_storage.json');

  // 5. schedule_extensions_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'schedule_extensions_storage.json'),
    JSON.stringify({
      extensions: {},
      revisions: {},
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset schedule_extensions_storage.json');

  // 6. app_notifications_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'app_notifications_storage.json'),
    JSON.stringify({
      notifications: [],
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset app_notifications_storage.json');

  // 7. leave_requests_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'leave_requests_storage.json'),
    JSON.stringify({
      leaves: [],
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset leave_requests_storage.json');

  // 8. rest_days_storage.json
  fs.writeFileSync(
    path.join(dataDir, 'rest_days_storage.json'),
    JSON.stringify({
      rest_days: [],
      updated_at: new Date().toISOString()
    }, null, 2)
  );
  console.log('  ✓ Reset rest_days_storage.json');

  // 9. inventory_storage.json
  const standardDevices = [
    { id: 'dev-001', sku: 'EE-2CH-LIVE', device_name: '2 Channel Live Camera System', device_type: '2 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-002', sku: 'EE-2CH-REC', device_name: '2 Channel Recording System', device_type: '2 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-003', sku: 'EE-4CH-LIVE', device_name: '4 Channel Live MDVR System', device_type: '4 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-004', sku: 'EE-4CH-REC', device_name: '4 Channel Recording MDVR System', device_type: '4 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-005', sku: 'EE-6CH-LIVE', device_name: '6 Channel Live Telematics System', device_type: '6 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-006', sku: 'EE-6CH-REC', device_name: '6 Channel Recording Telematics System', device_type: '6 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
    { id: 'dev-007', sku: 'EE-8CH-LIVE', device_name: '8 Channel Live Enterprise System', device_type: '8 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true }
  ];

  const standardMaterials = [
    { id: 'mat-001', sku: 'MAT-INSU-TAPE', material_name: 'Insulation Tape', unit: 'Nos.', opening_stock: 100, current_stock: 100, opening_stock_set: true, min_stock_level: 20 },
    { id: 'mat-002', sku: 'MAT-CT-200MM', material_name: 'Cable Tie – 200 mm', unit: 'Packets', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
    { id: 'mat-003', sku: 'MAT-CT-300MM', material_name: 'Cable Tie – 300 mm', unit: 'Packets', opening_stock: 40, current_stock: 40, opening_stock_set: true, min_stock_level: 10 },
    { id: 'mat-004', sku: 'MAT-SCREW-LONG', material_name: 'Long Screw', unit: 'Nos.', opening_stock: 500, current_stock: 500, opening_stock_set: true, min_stock_level: 50 },
    { id: 'mat-005', sku: 'MAT-SCREW-SMALL', material_name: 'Small Screw', unit: 'Nos.', opening_stock: 500, current_stock: 500, opening_stock_set: true, min_stock_level: 50 },
    { id: 'mat-006', sku: 'MAT-MEM-CARD', material_name: 'Memory Card', unit: 'Nos.', opening_stock: 100, current_stock: 100, opening_stock_set: true, min_stock_level: 15 },
    { id: 'mat-007', sku: 'MAT-WIRE-0.5MM', material_name: '0.5 mm Wire', unit: 'Metres', opening_stock: 1000, current_stock: 1000, opening_stock_set: true, min_stock_level: 100 },
    { id: 'mat-008', sku: 'MAT-CBL-5M', material_name: '5-metre Cable', unit: 'Nos.', opening_stock: 150, current_stock: 150, opening_stock_set: true, min_stock_level: 25 },
    { id: 'mat-009', sku: 'MAT-CBL-15M', material_name: '15-metre Cable', unit: 'Nos.', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
    { id: 'mat-010', sku: 'MAT-CAM-LOOSE', material_name: 'Camera', unit: 'Nos.', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
    { id: 'mat-011', sku: 'MAT-DISP-LOOSE', material_name: 'Display', unit: 'Nos.', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
    { id: 'mat-012', sku: 'MAT-DISP-LIVE', material_name: 'Live Display', unit: 'Nos.', opening_stock: 0, current_stock: 0, opening_stock_set: false, min_stock_level: 5 },
    { id: 'mat-013', sku: 'MAT-DISP-REC', material_name: 'Recording Display', unit: 'Nos.', opening_stock: 0, current_stock: 0, opening_stock_set: false, min_stock_level: 5 }
  ];

  const devMap = {};
  for (const d of standardDevices) {
    devMap[d.device_type] = d;
  }
  const matMap = {};
  for (const m of standardMaterials) {
    matMap[m.material_name] = m;
  }

  fs.writeFileSync(
    path.join(dataDir, 'inventory_storage.json'),
    JSON.stringify({
      deviceProducts: devMap,
      deviceTransactions: [],
      processedCarryDeductions: [],
      processedChecklistDeviceIssuances: [],
      materialProducts: matMap,
      materialTransactions: [],
      processedChecklistMaterialIssuances: [],
      processedMaterialReturnCredits: [],
      stockMovements: [],
      deviceStockAllocations: {}
    }, null, 2)
  );
  console.log('  ✓ Reset inventory_storage.json to clean baseline');

  // STEP 6: POST-CLEANUP VERIFICATION OF PROTECTED RECORDS
  console.log('\n[6/6] Running final integrity verification...');

  const { count: qCountAfter } = await supabase
    .from('quotations')
    .select('*', { count: 'exact', head: true });

  const { count: qiCountAfter } = await supabase
    .from('quotation_items')
    .select('*', { count: 'exact', head: true });

  const { count: uCountAfter } = await supabase
    .from('admin_users')
    .select('*', { count: 'exact', head: true });

  const { count: bomCountAfter } = await supabase
    .from('bom_items')
    .select('*', { count: 'exact', head: true });

  const { count: engCountAfter } = await supabase
    .from('service_engineers')
    .select('*', { count: 'exact', head: true });

  const { count: chkCountAfter } = await supabase
    .from('installation_checklists')
    .select('*', { count: 'exact', head: true });

  console.log('\n====================================================');
  console.log('              FINAL VERIFICATION REPORT             ');
  console.log('====================================================');
  console.log(`Protected Quotations        : ${qCountAfter} / 28  -> ${qCountAfter === 28 ? 'PASSED (100% Intact)' : 'FAILED'}`);
  console.log(`Protected Quotation Items   : ${qiCountAfter} / 33  -> ${qiCountAfter === 33 ? 'PASSED (100% Intact)' : 'FAILED'}`);
  console.log(`Protected Admin Accounts    : ${uCountAfter} / 6   -> ${uCountAfter === 6 ? 'PASSED (100% Intact)' : 'FAILED'}`);
  console.log(`Protected BOM Items         : ${bomCountAfter} / 62  -> ${bomCountAfter === 62 ? 'PASSED (100% Intact)' : 'FAILED'}`);
  console.log(`Protected Service Engineers : ${engCountAfter} / 6   -> ${engCountAfter === 6 ? 'PASSED (100% Intact)' : 'FAILED'}`);
  console.log(`Cleaned Checklists          : ${chkCountAfter} / 0   -> ${chkCountAfter === 0 ? 'PASSED (Cleaned)' : 'FAILED'}`);
  console.log('====================================================');

  if (qCountAfter !== 28 || qiCountAfter !== 33 || uCountAfter !== 6 || chkCountAfter !== 0) {
    throw new Error('POST-CLEANUP VERIFICATION FAILED!');
  }

  console.log('\nCLEANUP PROCESS COMPLETED SUCCESSFULLY!');
}

executeCleanAdminPanel().catch((err) => {
  console.error('\n[CLEANUP FAILED]', err);
  process.exit(1);
});
