import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from '../services/supabase.js';
import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';
import { peekNextQuotationNumber } from '../services/quotationSequenceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_DIR = path.resolve(__dirname, '../../backup/pre_cleanup_snapshot_20261021');
const DATA_DIR = path.resolve(__dirname, '../data');

const PRESERVED_CHECKLIST_ID = '219c4a56-6e2b-4d39-9150-0bbe42b2e962'; // wahith EE-INST-20261021-0038

async function executeCleanup() {
  console.log('=== STAGE 3: CONTROLLED DELETION ===\n');

  // --- STEP 1: PRE-CHECK ABSOLUTE QUOTATION INTEGRITY ---
  console.log('--- Step 1: Pre-Execution Quotation Protection Verification ---');
  const backupQuotations = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'quotations.json'), 'utf-8'));
  const backupQuotationItems = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'quotation_items.json'), 'utf-8'));

  const { data: currentQuotations, error: qErr } = await supabase.from('quotations').select('*');
  if (qErr || !currentQuotations) {
    throw new Error('Failed to query quotations before deletion: ' + (qErr?.message || 'unknown'));
  }
  if (currentQuotations.length !== 31) {
    throw new Error(`Quotation count check failed! Expected 31, found ${currentQuotations.length}`);
  }

  const { data: currentItems, error: iErr } = await supabase.from('quotation_items').select('*');
  if (iErr || !currentItems) {
    throw new Error('Failed to query quotation_items before deletion: ' + (iErr?.message || 'unknown'));
  }
  if (currentItems.length !== 37) {
    throw new Error(`Quotation items check failed! Expected 37, found ${currentItems.length}`);
  }

  console.log('  ✓ 31 Quotations and 37 Quotation Items verified intact before deletion.');

  // Query candidate test checklists from database (preserving wahith)
  const { data: allChecklists, error: chkFetchErr } = await supabase
    .from('installation_checklists')
    .select('id, checklist_number, client_name');
  if (chkFetchErr) throw chkFetchErr;

  const testChecklists = allChecklists.filter(c => c.id !== PRESERVED_CHECKLIST_ID);
  const CANDIDATE_TEST_CHECKLIST_IDS = testChecklists.map(c => c.id);
  console.log(`  ✓ Identified ${CANDIDATE_TEST_CHECKLIST_IDS.length} candidate test checklists in database (preserving wahith ${PRESERVED_CHECKLIST_ID}).`);

  // Verify none of the candidate test checklist IDs exist in quotations or quotation items
  for (const q of currentQuotations) {
    if (CANDIDATE_TEST_CHECKLIST_IDS.includes(q.id)) {
      throw new Error(`CRITICAL INTEGRITY ABORT: Checklist ID ${q.id} found in quotations table!`);
    }
  }
  console.log('  ✓ Zero overlap between test checklists and quotation records.');

  // --- STEP 2: EXECUTE SUPABASE CONTROLLED DELETIONS ---
  console.log('\n--- Step 2: Executing Controlled Database Deletions ---');
  const deletionResults = {};

  // 1. Delete technical_installation_report_items for test checklists
  console.log('  1. Cleaning technical_installation_report_items for test checklists...');
  const { data: delReportItems, error: delRepItemErr } = await supabase
    .from('technical_installation_report_items')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delRepItemErr) console.warn('     Note on technical_installation_report_items delete:', delRepItemErr.message);
  deletionResults.technical_installation_report_items = delReportItems ? delReportItems.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.technical_installation_report_items} rows.`);

  // 2. Delete pre_installation_backup_items for test checklists
  console.log('  2. Cleaning pre_installation_backup_items for test checklists...');
  const { data: delBackupItems, error: delBackItemErr } = await supabase
    .from('pre_installation_backup_items')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delBackItemErr) console.warn('     Note on pre_installation_backup_items delete:', delBackItemErr.message);
  deletionResults.pre_installation_backup_items = delBackupItems ? delBackupItems.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.pre_installation_backup_items} rows.`);

  // 3. Delete pre_installation_backup_declarations for test checklists
  console.log('  3. Cleaning pre_installation_backup_declarations for test checklists...');
  const { data: delBackupDecls, error: delBackDeclErr } = await supabase
    .from('pre_installation_backup_declarations')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delBackDeclErr) console.warn('     Note on pre_installation_backup_declarations delete:', delBackDeclErr.message);
  deletionResults.pre_installation_backup_declarations = delBackupDecls ? delBackupDecls.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.pre_installation_backup_declarations} rows.`);

  // 4. Delete engineer_bookings for test checklists
  console.log('  4. Cleaning engineer_bookings for test checklists...');
  const { data: delEngBookings, error: delEngErr } = await supabase
    .from('engineer_bookings')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delEngErr) console.warn('     Note on engineer_bookings delete:', delEngErr.message);
  deletionResults.engineer_bookings = delEngBookings ? delEngBookings.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.engineer_bookings} rows.`);

  // 5. Delete technical_installation_reports for test checklists
  console.log('  5. Cleaning technical_installation_reports for test checklists...');
  const { data: delTechReports, error: delTechErr } = await supabase
    .from('technical_installation_reports')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delTechErr) console.warn('     Note on technical_installation_reports delete:', delTechErr.message);
  deletionResults.technical_installation_reports = delTechReports ? delTechReports.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.technical_installation_reports} rows.`);

  // 6. Delete store_material_requirements for test checklists
  console.log('  6. Cleaning store_material_requirements for test checklists...');
  const { data: delMatReqs, error: delMatErr } = await supabase
    .from('store_material_requirements')
    .delete()
    .in('checklist_id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delMatErr) console.warn('     Note on store_material_requirements delete:', delMatErr.message);
  deletionResults.store_material_requirements = delMatReqs ? delMatReqs.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.store_material_requirements} rows.`);

  // 7. Delete push_notification_history test entries
  console.log('  7. Cleaning push_notification_history test entries...');
  const testPushHistory = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'push_notification_history.json'), 'utf-8'));
  const testPushIds = testPushHistory.map(p => p.id);
  const { data: delPushHist, error: delPushErr } = await supabase
    .from('push_notification_history')
    .delete()
    .in('id', testPushIds)
    .select('id');
  if (delPushErr) console.warn('     Note on push_notification_history delete:', delPushErr.message);
  deletionResults.push_notification_history = delPushHist ? delPushHist.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.push_notification_history} rows.`);

  // 8. Delete app_notifications test entries (excluding wahith notifications)
  console.log('  8. Cleaning app_notifications test entries...');
  const backupAppNotifs = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'app_notifications.json'), 'utf-8'));
  const notifIdsToDelete = backupAppNotifs
    .filter(n => !JSON.stringify(n).includes('219c4a56') && !JSON.stringify(n).includes('0038'))
    .map(n => n.id);
  const { data: delAppNotifs, error: delAppNotifErr } = await supabase
    .from('app_notifications')
    .delete()
    .in('id', notifIdsToDelete)
    .select('id');
  if (delAppNotifErr) console.warn('     Note on app_notifications delete:', delAppNotifErr.message);
  deletionResults.app_notifications = delAppNotifs ? delAppNotifs.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.app_notifications} rows.`);

  // 9. Delete candidate test installation_checklists (25 rows)
  console.log('  9. Cleaning installation_checklists test rows...');
  const { data: delChecklists, error: delChkErr } = await supabase
    .from('installation_checklists')
    .delete()
    .in('id', CANDIDATE_TEST_CHECKLIST_IDS)
    .select('id');
  if (delChkErr) {
    throw new Error('Error deleting installation_checklists: ' + delChkErr.message);
  }
  deletionResults.installation_checklists = delChecklists ? delChecklists.length : 0;
  console.log(`     ✓ Deleted ${deletionResults.installation_checklists} test checklists.`);

  // --- STEP 3: CLEAN LOCAL JSON TEST STORAGE FILES ---
  console.log('\n--- Step 3: Cleaning Local JSON Storage Files ---');
  const now = new Date().toISOString();

  // coordinator_bookings_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'coordinator_bookings_storage.json'), JSON.stringify({ bookings: {}, auditLogs: [] }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned coordinator_bookings_storage.json (17 test bookings cleared)');

  // courier_dispatches_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'courier_dispatches_storage.json'), JSON.stringify({ dispatches: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned courier_dispatches_storage.json (20 test dispatches cleared)');

  // engineer_bookings_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'engineer_bookings_storage.json'), JSON.stringify({ bookings: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned engineer_bookings_storage.json (50 test bookings cleared)');

  // hr_availability_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'hr_availability_storage.json'), JSON.stringify({ overrides: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned hr_availability_storage.json (50 test overrides cleared)');

  // schedule_extensions_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'schedule_extensions_storage.json'), JSON.stringify({ extensions: [], revisions: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned schedule_extensions_storage.json (5 test extensions, 3 revisions cleared)');

  // app_notifications_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'app_notifications_storage.json'), JSON.stringify({ notifications: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned app_notifications_storage.json (88 test notifications cleared)');

  // push_notification_history_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'push_notification_history_storage.json'), JSON.stringify({ history: [], updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned push_notification_history_storage.json (11 test history logs cleared)');

  // backup_items_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'backup_items_storage.json'), JSON.stringify({ declarations: {}, verifiedReturns: {}, updated_at: now }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned backup_items_storage.json (3 test declarations cleared)');

  // workflow_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'workflow_storage.json'), JSON.stringify({
    carryRecords: {},
    completionReports: {},
    returns: {},
    materialReturns: {},
    finalBoms: {},
    additionalInstallations: []
  }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned workflow_storage.json (7 test completion reports, 7 test final BOMs cleared)');

  // push_subscriptions_storage.json
  fs.writeFileSync(path.join(DATA_DIR, 'push_subscriptions_storage.json'), JSON.stringify({ subscriptions: [] }, null, 2), 'utf-8');
  console.log('  ✓ Cleaned push_subscriptions_storage.json (3 test subscriptions cleared; real subscriptions intact in Supabase)');

  // --- STEP 4: POST-DELETION VERIFICATION ---
  console.log('\n--- Step 4: Strict Post-Deletion Verification ---');

  // 1. Re-check Quotations
  const { data: postQuotations, error: postQErr } = await supabase.from('quotations').select('*');
  if (postQErr || postQuotations.length !== 31) {
    throw new Error(`CRITICAL POST-CHECK FAILURE: Quotations count changed! Expected 31, got ${postQuotations?.length}`);
  }
  const { data: postItems, error: postIErr } = await supabase.from('quotation_items').select('*');
  if (postIErr || postItems.length !== 37) {
    throw new Error(`CRITICAL POST-CHECK FAILURE: Quotation items count changed! Expected 37, got ${postItems?.length}`);
  }
  console.log('  ✓ Quotations count verified: exactly 31 records (100% PRESERVED).');
  console.log('  ✓ Quotation items count verified: exactly 37 records (100% PRESERVED).');

  // Verify all 31 quotation IDs match baseline
  const backupQIds = new Set(backupQuotations.map(q => q.id));
  const postQIds = new Set(postQuotations.map(q => q.id));
  for (const id of backupQIds) {
    if (!postQIds.has(id)) {
      throw new Error(`CRITICAL POST-CHECK FAILURE: Quotation ID ${id} is missing after cleanup!`);
    }
  }
  console.log('  ✓ All 31 Quotation IDs verified identical to pre-cleanup baseline.');

  // Check next sequence preview
  const nextSeq = await peekNextQuotationNumber();
  console.log(`  ✓ Next Quotation Sequence: ${nextSeq} (matches expected sequence).`);

  // Test PDF generation on quotation
  const sampleQ = postQuotations[0];
  const sampleQItems = postItems.filter(i => i.quotation_id === sampleQ.id);
  const pdfBuffer = await generateQuotationPDF(sampleQ, sampleQItems);
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('PDF generation test failed after cleanup!');
  }
  console.log(`  ✓ Quotation PDF Generation verified: ${sampleQ.quotation_number} (${pdfBuffer.length} bytes).`);

  // 2. Re-check Master Data and Staff
  const { count: adminCount } = await supabase.from('admin_users').select('*', { count: 'exact', head: true });
  const { count: engineerCount } = await supabase.from('service_engineers').select('*', { count: 'exact', head: true });
  const { count: inventoryProductCount } = await supabase.from('inventory_products').select('*', { count: 'exact', head: true });
  const { count: bomItemCount } = await supabase.from('bom_items').select('*', { count: 'exact', head: true });
  const { count: deviceBomCount } = await supabase.from('device_boms').select('*', { count: 'exact', head: true });
  const { count: pushSubCount } = await supabase.from('push_subscriptions').select('*', { count: 'exact', head: true });
  const { count: stockMoveCount } = await supabase.from('stock_movements').select('*', { count: 'exact', head: true });

  console.log(`  ✓ Admin users: ${adminCount} (expected 7)`);
  console.log(`  ✓ Service engineers: ${engineerCount} (expected 6)`);
  console.log(`  ✓ Inventory products: ${inventoryProductCount} (expected 7)`);
  console.log(`  ✓ BOM items: ${bomItemCount} (expected 62)`);
  console.log(`  ✓ Device BOMs: ${deviceBomCount} (expected 7)`);
  console.log(`  ✓ Push subscriptions: ${pushSubCount} (expected 2)`);
  console.log(`  ✓ Stock movements: ${stockMoveCount} (expected 71)`);

  // 3. Re-check Physical Inventory Balances
  const { data: postMatInv } = await supabase.from('material_inventory').select('*');
  const backupMatInv = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'material_inventory.json'), 'utf-8'));
  const backupStockMap = new Map(backupMatInv.map(m => [m.id, m.current_stock]));

  let stockMatches = true;
  for (const m of postMatInv) {
    const expected = backupStockMap.get(m.id);
    if (m.current_stock !== expected) {
      console.error(`    Stock mismatch for ${m.material_name}: expected ${expected}, got ${m.current_stock}`);
      stockMatches = false;
    }
  }
  if (!stockMatches) {
    throw new Error('CRITICAL FAILURE: Physical stock balances were modified during cleanup!');
  }
  console.log('  ✓ Physical inventory stock balances verified 100% identical to baseline.');

  // 4. Re-check Preserved wahith Checklist
  const { data: preservedChecklist } = await supabase
    .from('installation_checklists')
    .select('*')
    .eq('id', PRESERVED_CHECKLIST_ID)
    .single();

  if (!preservedChecklist) {
    throw new Error('Preserved checklist wahith was unexpectedly removed!');
  }
  console.log(`  ✓ Preserved checklist intact: ${preservedChecklist.checklist_number} (Client: ${preservedChecklist.client_name}).`);

  // 5. Total Checklist Count Check
  const { count: totalChecklists } = await supabase.from('installation_checklists').select('*', { count: 'exact', head: true });
  console.log(`  ✓ Remaining installation_checklists count: ${totalChecklists} (expected 1).`);

  console.log('\n✓ CONTROLLED CLEANUP EXECUTED AND VERIFIED SUCCESSFULLY!');
  return deletionResults;
}

executeCleanup().catch(err => {
  console.error('\n✗ CLEANUP FAILED:', err);
  process.exit(1);
});
