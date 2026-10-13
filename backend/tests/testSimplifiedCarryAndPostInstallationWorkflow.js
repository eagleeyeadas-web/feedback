import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import {
  getDeviceCarryRecord,
  submitInstallationCompletionReport,
  getPendingStoreReturns,
  verifyStoreReturn,
  enrichChecklistsWithWorkflowStatus,
} from '../src/services/workflowService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';
import supabase from '../src/services/supabase.js';

async function runAcceptanceTests() {
  console.log('======================================================================');
  console.log('ACCEPTANCE TESTS: Simplified Device Carrying & Post-Installation');
  console.log('======================================================================\n');

  const salesUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'sales@eagleeye.com',
    role: 'SALES',
    name: 'Sales Rep Sarah',
  };

  const techUser = {
    id: 'e2b4c6d8-a1bf-40ef-8878-ec64b29bbfd6',
    email: 'tech@eagleeye.com',
    role: 'TECHNICAL',
    name: 'Tech Terry',
  };

  const storeUser = {
    id: 'd1a3b5c7-a1bf-40ef-8878-ec64b29bbfd7',
    email: 'store@eagleeye.com',
    role: 'STORE_MANAGER',
    name: 'Store Manager Sam',
  };

  let checklistId = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Sales creates a job with 2 x 4 Channel Live and 1 x 8 Channel Live
    // -------------------------------------------------------------------------
    console.log('[Test 1] Sales creates installation job with 2 x 4CH Live and 1 x 8CH Live');
    const createdChecklist = await createChecklist(salesUser.id, {
      salesperson_name: 'Sarah Sales',
      client_name: 'Acme Fleet Services Ltd',
      client_mobile: '9876543210',
      client_location: 'Industrial Area, Phase 2',
      google_maps_location: 'https://maps.google.com/?q=28.5355,77.3910',
      installation_or_service: 'Installation',
      device_configurations: [
        { device_type: '4 Channel Live', quantity_carried: 2 },
        { device_type: '8 Channel Live', quantity_carried: 1 },
      ],
      number_of_devices: 3,
      number_of_vehicles: 2,
      confirmed_price: 32000,
      payment_method: 'Bank Transfer',
      expected_arrival_date: '2026-10-15',
      expected_arrival_time: '11:00 AM',
      service_engineer: 'Tech Terry',
      service_assistant: 'Assistant Alex',
      installation_status: 'Assigned',
    });

    checklistId = createdChecklist.id;
    assert(checklistId, 'Checklist ID must be returned');
    assert.strictEqual(createdChecklist.number_of_devices, 3, 'Total devices must be 3');
    assert.strictEqual(createdChecklist.carry_status, 'RECORDED', 'Carry status must be RECORDED upon creation');
    console.log(`  ✓ Checklist created: ${createdChecklist.checklist_number} (ID: ${checklistId})`);
    console.log(`  ✓ Devices carried: 2 x 4CH Live, 1 x 8CH Live (Total: ${createdChecklist.number_of_devices})\n`);

    // -------------------------------------------------------------------------
    // TEST 2: The Technical team sees all 3 devices without entering quantities
    // -------------------------------------------------------------------------
    console.log('[Test 2] Technical workspace receives read-only Sales device allocation');
    const carryRecord = await getDeviceCarryRecord(checklistId);
    assert(carryRecord, 'Carry record must be retrieved for Technical workspace');
    assert(Array.isArray(carryRecord.items), 'Carry record items must be an array');
    assert.strictEqual(carryRecord.items.length, 2, 'Must have 2 device types');

    const fourCh = carryRecord.items.find((i) => i.device_type === '4 Channel Live');
    const eightCh = carryRecord.items.find((i) => i.device_type === '8 Channel Live');
    assert(fourCh && (fourCh.quantity_carried === 2 || fourCh.quantity_declared_to_carry === 2), '4CH Live must be 2');
    assert(eightCh && (eightCh.quantity_carried === 1 || eightCh.quantity_declared_to_carry === 1), '8CH Live must be 1');
    assert.strictEqual(carryRecord.total_devices_carried, 3, 'Total devices carried must be 3');
    console.log('  ✓ Technical team views read-only Sales allocation without pre-installation data entry:');
    carryRecord.items.forEach((item) => {
      console.log(`    - ${item.device_type}: ${item.quantity_carried || item.quantity_declared_to_carry} units carried`);
    });
    console.log(`  ✓ Total devices carried: ${carryRecord.total_devices_carried}\n`);

    // -------------------------------------------------------------------------
    // TEST 3 & 4: Strict Reconciliation Validation
    // -------------------------------------------------------------------------
    console.log('[Test 4A] Validation prevents submission when quantities do not reconcile');
    let validationFailedAsExpected = false;
    try {
      await submitInstallationCompletionReport({
        checklist_id: checklistId,
        user: techUser,
        items: [
          {
            device_type: '4 Channel Live',
            quantity_carried: 2,
            quantity_installed: 2,
            quantity_to_return: 0,
            quantity_damaged: 0,
            quantity_missing: 0,
          },
          {
            device_type: '8 Channel Live',
            quantity_carried: 1,
            quantity_installed: 0,
            quantity_to_return: 0, // 1 carried, 0 accounted for -> Unbalanced!
            quantity_damaged: 0,
            quantity_missing: 0,
          },
        ],
        remarks: 'Trying to submit unbalanced report',
      });
    } catch (err) {
      validationFailedAsExpected = true;
      console.log(`  ✓ Rejected unbalanced report with error: "${err.message}"`);
    }
    assert(validationFailedAsExpected, 'Submission MUST fail when quantities do not reconcile');

    console.log('\n[Test 3 & 4B] Technician records 2 devices installed and 1 device returned');
    const validReport = await submitInstallationCompletionReport({
      checklist_id: checklistId,
      user: techUser,
      items: [
        {
          device_type: '4 Channel Live',
          quantity_carried: 2,
          quantity_installed: 2,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
          remarks: 'Both units mounted on commercial trucks',
        },
        {
          device_type: '8 Channel Live',
          quantity_carried: 1,
          quantity_installed: 0,
          quantity_to_return: 1,
          quantity_damaged: 0,
          quantity_missing: 0,
          remarks: 'Customer deferred 8-channel installation; unit returned unopened',
        },
      ],
      remarks: 'Installation successful for 2 x 4CH Live; 1 x 8CH Live returned to store',
    });

    assert(validReport, 'Valid report must succeed');
    assert.strictEqual(validReport.summary?.devices_installed_qty, 2, 'Installed qty must be 2');
    assert.strictEqual(validReport.summary?.devices_unused_qty, 1, 'Returned qty must be 1');
    console.log('  ✓ Report successfully validated against 3 devices carried:');
    console.log(`    - Devices Installed: ${validReport.summary?.devices_installed_qty}`);
    console.log(`    - Devices Returned: ${validReport.summary?.devices_unused_qty}`);
    console.log(`    - Devices Damaged / Missing: 0`);
    console.log(`    - Checklist Status: ${validReport.installation_status}`);
    console.log(`    - Store Return Reconciliation Status: ${validReport.reconciliation_status}\n`);

    // -------------------------------------------------------------------------
    // TEST 5: Store Manager sees returned device awaiting physical verification
    // -------------------------------------------------------------------------
    console.log('[Test 5] Store Manager sees returned device awaiting physical verification');
    const pendingReturns = await getPendingStoreReturns();
    const jobReturn = pendingReturns.find((r) => r.checklist_id === checklistId);
    assert(jobReturn, 'Return record must exist for this checklist');
    assert.strictEqual(jobReturn.device_type, '8 Channel Live', 'Returned device must be 8 Channel Live');
    assert.strictEqual(jobReturn.declared_return_qty, 1, 'Declared return quantity must be 1');
    assert.strictEqual(jobReturn.status, 'PENDING_STORE_VERIFICATION', 'Status must be PENDING_STORE_VERIFICATION');
    console.log(`  ✓ Store Manager sees return ID: ${jobReturn.id}`);
    console.log(`    - Device Type: ${jobReturn.device_type}`);
    console.log(`    - Declared Return Qty: ${jobReturn.declared_return_qty} Nos.`);
    console.log(`    - Return Status: ${jobReturn.status}\n`);

    // -------------------------------------------------------------------------
    // TEST 6: Usable inventory increases ONLY after Store Manager verification
    // -------------------------------------------------------------------------
    console.log('[Test 6] Usable inventory increases ONLY after Store Manager physical verification');
    // Get initial inventory for 8 Channel Live
    const initialInv = await getInventoryProducts();
    const initial8Ch = initialInv.find((p) => p.device_type === '8 Channel Live');
    const initialUsableStock = Number(initial8Ch?.usable_stock) || 0;
    console.log(`  ✓ Initial Usable Stock for 8 Channel Live: ${initialUsableStock} units`);

    // Store Manager physically inspects and verifies return
    const verificationResult = await verifyStoreReturn({
      return_id: jobReturn.id,
      accepted_usable_qty: 1,
      damaged_qty: 0,
      missing_qty: 0,
      user: storeUser,
      remarks: 'Inspected box seals and tested working. Added to usable inventory.',
    });

    assert(verificationResult, 'Verification must succeed');
    console.log(`  ✓ Store Manager verified return: status -> ${verificationResult.return?.status || 'VERIFIED_AND_RECONCILED'}`);

    // Verify inventory increase
    const updatedInv = await getInventoryProducts();
    const updated8Ch = updatedInv.find((p) => p.device_type === '8 Channel Live');
    const updatedUsableStock = Number(updated8Ch?.usable_stock) || 0;
    console.log(`  ✓ Updated Usable Stock for 8 Channel Live: ${updatedUsableStock} units`);
    assert.strictEqual(updatedUsableStock, initialUsableStock + 1, 'Usable stock must increase by exactly 1');
    console.log('  ✓ Usable stock credited by +1 unit only after Store Manager physical verification.\n');

    // -------------------------------------------------------------------------
    // TEST 7: The same return cannot be added to stock twice
    // -------------------------------------------------------------------------
    console.log('[Test 7] Prevent duplicate return verification and duplicate stock credit');
    let duplicatePrevented = false;
    try {
      await verifyStoreReturn({
        return_id: jobReturn.id,
        accepted_usable_qty: 1,
        damaged_qty: 0,
        missing_qty: 0,
        user: storeUser,
        remarks: 'Attempting duplicate verification',
      });
    } catch (err) {
      duplicatePrevented = true;
      console.log(`  ✓ Duplicate verification prevented with error: "${err.message}"`);
    }
    assert(duplicatePrevented, 'Duplicate return verification MUST be rejected');

    // Confirm inventory was NOT credited twice
    const finalInv = await getInventoryProducts();
    const final8Ch = finalInv.find((p) => p.device_type === '8 Channel Live');
    assert.strictEqual(Number(final8Ch?.usable_stock), updatedUsableStock, 'Inventory must not increase on duplicate verification attempt');
    console.log('  ✓ Stock count remains stable; duplicate credit prevented.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Refreshing preserves Sales allocation and technician report
    // -------------------------------------------------------------------------
    console.log('[Test 8] Re-fetching checklist preserves Sales allocation and technician report');
    const rawChecklist = await getChecklistById(checklistId);
    assert(rawChecklist, 'Checklist must be retrieved on reload');
    const [refreshedChecklist] = await enrichChecklistsWithWorkflowStatus([rawChecklist]);
    assert(refreshedChecklist, 'Enriched checklist must exist');
    assert.strictEqual(refreshedChecklist.installation_status, 'Completed', 'Installation status must remain Completed');
    assert.strictEqual(refreshedChecklist.number_of_devices, 3, 'Total devices carried must remain 3');
    assert(Array.isArray(refreshedChecklist.device_configurations), 'Device configurations must be array');
    assert.strictEqual(refreshedChecklist.device_configurations.length, 2, '2 device configurations must be preserved');
    assert.strictEqual(refreshedChecklist.reconciliation_status, 'FULLY_RECONCILED', 'Checklist status must be FULLY_RECONCILED');
    console.log(`  ✓ Re-fetched checklist ${refreshedChecklist.checklist_number}:`);
    console.log(`    - Installation Status: ${refreshedChecklist.installation_status}`);
    console.log(`    - Total Devices Carried: ${refreshedChecklist.number_of_devices}`);
    console.log(`    - Reconciliation Status: ${refreshedChecklist.reconciliation_status}`);
    console.log('  ✓ All historical allocation and completion report data preserved.\n');

    console.log('======================================================================');
    console.log('🎉 ALL 8 ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================================');
  } catch (err) {
    console.error('❌ Acceptance test failed:', err);
    process.exit(1);
  } finally {
    // Clean up test checklist
    if (checklistId) {
      try {
        await supabase.from('job_device_returns').delete().eq('checklist_id', checklistId);
        await supabase.from('job_completion_reports').delete().eq('checklist_id', checklistId);
        await supabase.from('installation_checklists').delete().eq('id', checklistId);
        console.log(`[Clean up] Removed test checklist ${checklistId}`);
      } catch (e) {
        console.warn('Cleanup error:', e.message);
      }
    }
  }
}

runAcceptanceTests();
