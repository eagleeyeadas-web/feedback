/**
 * Test Suite: Post-Installation Form Screw Items Removal
 * 
 * Verifies:
 * 1. Pre-Installation Form (TechnicianBackupDeclarationModal.jsx) keeps "Long Screw" and "Small Screw" available.
 * 2. Post-Installation Form (InstallationCompletionModal.jsx) excludes "Long Screw" and "Small Screw" from
 *    material selection, usage, and returns.
 * 3. Backend submission calculations (submitInstallationCompletionReport) strip screws from material items and returns.
 * 4. declareMaterialReturns skips screws and creates no return records for them.
 * 5. Reopening/refreshing completion reports (getInstallationCompletionReport) never resurfaces screws.
 * 6. enrichChecklistsWithWorkflowStatus ensures actual_materials_used and actual_materials_returned never include screws.
 * 7. getAllStoreMaterialReturns excludes screws from store return verification.
 * 8. reconcileBackupItems handles pre-installation declared screws gracefully without mismatch errors.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isScrewMaterial,
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  declareMaterialReturns,
  getAllStoreMaterialReturns,
  enrichChecklistsWithWorkflowStatus,
} from '../src/services/workflowService.js';
import { reconcileBackupItems, saveBackupDeclaration, getBackupDeclaration } from '../src/services/backupItemService.js';
import supabase from '../src/services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('========================================================================');
  console.log(' STARTING POST-INSTALLATION SCREWS REMOVAL AUTOMATED TEST SUITE');
  console.log('========================================================================\n');

  // ---------------------------------------------------------------------------
  // TEST 1: isScrewMaterial helper accuracy
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: isScrewMaterial Helper Detection ---');
  assert.strictEqual(isScrewMaterial('Long Screw'), true, 'Long Screw must be recognized');
  assert.strictEqual(isScrewMaterial('Small Screw'), true, 'Small Screw must be recognized');
  assert.strictEqual(isScrewMaterial('long screw'), true, 'long screw lowercase recognized');
  assert.strictEqual(isScrewMaterial('small screw'), true, 'small screw lowercase recognized');
  assert.strictEqual(isScrewMaterial('Screw (Long)'), true, 'Legacy Screw (Long) recognized');
  assert.strictEqual(isScrewMaterial('Screw (Small)'), true, 'Legacy Screw (Small) recognized');
  assert.strictEqual(isScrewMaterial({ item_name: 'Long Screw' }), true, 'Object item_name recognized');
  assert.strictEqual(isScrewMaterial({ material_name: 'Small Screw' }), true, 'Object material_name recognized');
  assert.strictEqual(isScrewMaterial({ sku: 'MAT-SCREW-LONG' }), true, 'Object sku recognized');
  assert.strictEqual(isScrewMaterial({ sku: 'MAT-SCREW-SMALL' }), true, 'Object sku recognized');

  // Non-screw materials must NOT match
  assert.strictEqual(isScrewMaterial('Camera'), false, 'Camera is not a screw');
  assert.strictEqual(isScrewMaterial('Live Display'), false, 'Live Display is not a screw');
  assert.strictEqual(isScrewMaterial('Insulation Tape'), false, 'Insulation Tape is not a screw');
  assert.strictEqual(isScrewMaterial('Cable Tie 200mm'), false, 'Cable Tie 200mm is not a screw');
  assert.strictEqual(isScrewMaterial('0.5 mm Wire'), false, '0.5 mm Wire is not a screw');
  assert.strictEqual(isScrewMaterial('Memory Card'), false, 'Memory Card is not a screw');
  assert.strictEqual(isScrewMaterial(null), false, 'null is not a screw');
  console.log('[PASS] isScrewMaterial accurately identifies screws and preserves all other materials\n');

  // ---------------------------------------------------------------------------
  // TEST 2: Pre-Installation modal keeps screws available
  // ---------------------------------------------------------------------------
  console.log('--- TEST 2: Pre-Installation Extra Items Declaration Form Intact ---');
  const preModalPath = path.join(__dirname, '../../frontend/src/components/workspaces/TechnicianBackupDeclarationModal.jsx');
  assert.ok(fs.existsSync(preModalPath), 'TechnicianBackupDeclarationModal.jsx exists');
  const preModalContent = fs.readFileSync(preModalPath, 'utf-8');

  assert.ok(
    preModalContent.includes("'Long Screw'") || preModalContent.includes('"Long Screw"'),
    'Long Screw must remain in STANDARD_INSTALLATION_MATERIALS in TechnicianBackupDeclarationModal.jsx'
  );
  assert.ok(
    preModalContent.includes("'Small Screw'") || preModalContent.includes('"Small Screw"'),
    'Small Screw must remain in STANDARD_INSTALLATION_MATERIALS in TechnicianBackupDeclarationModal.jsx'
  );
  console.log('[PASS] Long Screw and Small Screw remain in Pre-Installation Extra Items Declaration form\n');

  // ---------------------------------------------------------------------------
  // TEST 3: Post-Installation Form (frontend source) excludes screws
  // ---------------------------------------------------------------------------
  console.log('--- TEST 3: Post-Installation Form Code Excludes Screws ---');
  const postModalPath = path.join(__dirname, '../../frontend/src/components/workspaces/InstallationCompletionModal.jsx');
  assert.ok(fs.existsSync(postModalPath), 'InstallationCompletionModal.jsx exists');
  const postModalContent = fs.readFileSync(postModalPath, 'utf-8');

  // 3A: Preliminary BOM ingestion excludes screws
  assert.ok(
    postModalContent.includes('isScrewMaterial'),
    'InstallationCompletionModal.jsx imports and uses isScrewMaterial'
  );
  assert.ok(
    postModalContent.includes('isScrewMaterial(name)'),
    'prelimMaterials filters out screws in 3B'
  );
  assert.ok(
    postModalContent.includes('isScrewMaterial(productName)'),
    'productName filters out screws in 3D consolidation'
  );
  assert.ok(
    postModalContent.includes('!isScrewMaterial(p.item_name)'),
    'handleAddRow and renderProductRow filter screws from product dropdowns'
  );
  assert.ok(
    !postModalContent.includes('screws, wire, and other installation materials'),
    'UI subtext does not mention screws in Section 2 fitting materials header'
  );
  console.log('[PASS] Post-Installation Form frontend source code strictly excludes screws from selection and rows\n');

  // ---------------------------------------------------------------------------
  // TEST 4: Backend submitInstallationCompletionReport strips screws from submission
  // ---------------------------------------------------------------------------
  console.log('--- TEST 4: Backend Completion Report Submission Calculations ---');
  const testChecklistId = crypto.randomUUID();
  const testUser = { id: crypto.randomUUID(), email: 'tech@eagleeye.com', role: 'TECHNICAL' };

  // Create mock checklist in supabase or fallback
  const mockChecklist = {
    id: testChecklistId,
    checklist_number: `CHK-${Date.now()}`,
    created_by: '11111111-1111-4111-a111-111111111111',
    client_name: 'Test Screw Customer',
    client_mobile: '9876543210',
    client_location: 'Mumbai Depot',
    service_engineer: 'Tech Rajesh',
    service_engineer_id: 'e1000000-0000-0000-0000-000000000001',
    installation_or_service: 'Installation',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: 15000,
    payment_method: 'UPI',
    vehicle_type: 'Truck',
    installation_duration: '1 Day',
    expected_arrival_date: '2026-10-21',
    expected_arrival_time: '10:00:00',
    installation_status: 'Assigned',
    reconciliation_status: 'SALES_ALLOCATED',
    device_configurations: [
      { device_type: '4 Channel Live', number_of_devices: 1, quantity_carried: 1 }
    ],
    bom_snapshot: {
      items: [
        { material_name: 'Insulation Tape', quantity: 2, unit: 'Nos.' },
        { material_name: 'Long Screw', quantity: 12, unit: 'Nos.' },
        { material_name: 'Small Screw', quantity: 12, unit: 'Nos.' },
        { material_name: 'Cable Tie 200mm', quantity: 1, unit: 'Packets' },
      ],
    },
  };

  const { error: insErr } = await supabase.from('installation_checklists').insert([mockChecklist]);
  if (insErr) {
    console.warn('Checklist insert warning:', insErr.message);
  }

  // Attempt submitting completion report with screws included in payload
  const reportPayload = {
    checklist_id: testChecklistId,
    user: testUser,
    items: [
      {
        device_type: 'Camera',
        quantity_carried: 4,
        quantity_installed: 4,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [
      {
        material_name: 'Insulation Tape',
        unit: 'Nos.',
        quantity_issued: 2,
        quantity_used: 1,
        quantity_returned: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
      {
        material_name: 'Long Screw',
        unit: 'Nos.',
        quantity_issued: 12,
        quantity_used: 10,
        quantity_returned: 2,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
      {
        material_name: 'Small Screw',
        unit: 'Nos.',
        quantity_issued: 12,
        quantity_used: 12,
        quantity_returned: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    backup_items: [
      {
        item_name: 'Long Screw',
        quantity_carried: 5,
        quantity_used: 5,
        quantity_returned: 0,
      },
    ],
    completion_status: 'Completed',
    remarks: 'Installation completed successfully',
  };

  const submitResult = await submitInstallationCompletionReport(reportPayload);
  assert.ok(submitResult, 'Completion report submitted successfully');

  // Verify material_items in saved report do NOT have screws
  const savedReportMaterials = submitResult.material_items || [];
  const hasScrewInSavedReport = savedReportMaterials.some((m) => isScrewMaterial(m.material_name));
  assert.strictEqual(hasScrewInSavedReport, false, 'Saved completion report must NOT contain screws');

  // Insulation Tape must still be present
  const tapeItem = savedReportMaterials.find((m) => m.material_name === 'Insulation Tape');
  assert.ok(tapeItem, 'Valid non-screw material (Insulation Tape) is preserved');
  assert.strictEqual(tapeItem.quantity_used, 1, 'Insulation Tape quantity used is 1');
  assert.strictEqual(tapeItem.quantity_returned, 1, 'Insulation Tape quantity returned is 1');

  // Verify declareMaterialReturns only returned non-screw items
  const returnedMaterials = submitResult.materials_returned || [];
  const hasScrewInReturns = returnedMaterials.some((m) => isScrewMaterial(m.material_name));
  assert.strictEqual(hasScrewInReturns, false, 'Materials returned must NOT contain screws');
  console.log('[PASS] submitInstallationCompletionReport automatically purges screws from submission and returns\n');

  // ---------------------------------------------------------------------------
  // TEST 5: getInstallationCompletionReport sanitizes on fetch (reopen/refresh)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 5: Reopening/Refreshing Checklist Never Resurfaces Screws ---');
  const fetchedReport = await getInstallationCompletionReport(testChecklistId);
  assert.ok(fetchedReport, 'Fetched completion report exists');

  const fetchedMaterials = fetchedReport.material_items || [];
  const hasScrewInFetched = fetchedMaterials.some((m) => isScrewMaterial(m.material_name));
  assert.strictEqual(hasScrewInFetched, false, 'Reopened/refreshed report must NOT contain screws');
  console.log('[PASS] Reopening or refreshing completion report guarantees screws never reappear\n');

  // ---------------------------------------------------------------------------
  // TEST 6: enrichChecklistsWithWorkflowStatus excludes screws from status
  // ---------------------------------------------------------------------------
  console.log('--- TEST 6: enrichChecklistsWithWorkflowStatus Exclusion ---');
  const enriched = await enrichChecklistsWithWorkflowStatus([mockChecklist]);
  assert.strictEqual(enriched.length, 1, 'Enriched array has 1 item');
  const enrichedItem = enriched[0];

  const actualUsed = enrichedItem.actual_materials_used || [];
  const actualRet = enrichedItem.actual_materials_returned || [];
  assert.strictEqual(actualUsed.some((m) => isScrewMaterial(m.material_name)), false, 'actual_materials_used has no screws');
  assert.strictEqual(actualRet.some((m) => isScrewMaterial(m.material_name)), false, 'actual_materials_returned has no screws');
  console.log('[PASS] enrichChecklistsWithWorkflowStatus strips screws from used and returned arrays\n');

  // ---------------------------------------------------------------------------
  // TEST 7: getAllStoreMaterialReturns excludes screws from store manager returns
  // ---------------------------------------------------------------------------
  console.log('--- TEST 7: Store Manager Return Verification Excludes Screws ---');
  const allStoreReturns = await getAllStoreMaterialReturns();
  const screwInStoreReturns = allStoreReturns.some((r) => isScrewMaterial(r.material_name));
  assert.strictEqual(screwInStoreReturns, false, 'Store manager returns list must NOT contain screws');
  console.log('[PASS] Store Manager returns list contains zero screw items\n');

  // ---------------------------------------------------------------------------
  // TEST 8: reconcileBackupItems handles declared screws without mismatch error
  // ---------------------------------------------------------------------------
  console.log('--- TEST 8: Pre-Installation Declared Screws Reconciliation ---');
  const backupChkId = crypto.randomUUID();
  
  // Save pre-installation declaration with Long Screw, Small Screw, and Memory Card
  await saveBackupDeclaration({
    checklistId: backupChkId,
    hasBackupItems: true,
    user: testUser,
    items: [
      { item_name: 'Long Screw', quantity: 20, unit: 'Nos.' },
      { item_name: 'Small Screw', quantity: 20, unit: 'Nos.' },
      { item_name: 'Memory Card', quantity: 2, unit: 'Nos.' },
    ],
  });

  const savedDecl = await getBackupDeclaration(backupChkId);
  assert.ok(savedDecl && savedDecl.items.length === 3, 'Pre-installation declaration saved with screws and memory card');
  assert.ok(savedDecl.items.some((i) => i.item_name === 'Long Screw'), 'Pre-installation declaration has Long Screw');

  // Reconcile backup items where technician only entered Memory Card (since screws are absent from post-installation form)
  const reconResult = await reconcileBackupItems({
    checklistId: backupChkId,
    user: testUser,
    items: [
      {
        item_name: 'Memory Card',
        quantity_used: 1,
        quantity_returned: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
  });

  assert.strictEqual(reconResult.reconciled, true, 'Reconciliation succeeds without throwing mismatch error for screws');
  const screwRecon = reconResult.items.find((i) => i.item_name === 'Long Screw');
  assert.ok(screwRecon, 'Screw item was reconciled');
  assert.strictEqual(screwRecon.quantity_returned, 0, 'Screws are not requested as returned');
  console.log('[PASS] reconcileBackupItems reconciles pre-declared screws without errors or return demands\n');

  // Clean up test checklist
  try {
    await supabase.from('installation_checklists').delete().eq('id', testChecklistId);
    await supabase.from('technical_installation_reports').delete().eq('checklist_id', testChecklistId);
    await supabase.from('pre_installation_backup_declarations').delete().eq('checklist_id', backupChkId);
    await supabase.from('pre_installation_backup_items').delete().eq('checklist_id', backupChkId);
  } catch (e) {
    // Non-blocking cleanup
  }

  console.log('========================================================================');
  console.log(' ALL POST-INSTALLATION SCREWS REMOVAL TESTS PASSED (8/8)');
  console.log('========================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
