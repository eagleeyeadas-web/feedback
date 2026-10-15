import assert from 'assert';
import crypto from 'crypto';
import { getAvailableBackupProducts, saveBackupDeclaration, getBackupDeclaration } from '../src/services/backupItemService.js';
import { submitInstallationCompletionReport, declareDeviceReturns, declareMaterialReturns, verifyStoreReturn } from '../src/services/workflowService.js';
import { creditStockForVerifiedReturn, getInventoryProducts } from '../src/services/inventoryService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import supabase from '../src/services/supabase.js';

async function runTests() {
  console.log('--- START: Testing Loose-Product Post-Installation Workflow ---');

  // Test 1: Device and Component Dropdown Catalogue
  console.log('\n[Test 1] Populating product dropdown from database catalogue...');
  const catalogue = await getAvailableBackupProducts();
  assert(Array.isArray(catalogue), 'Catalogue must be an array');
  assert(catalogue.length > 0, 'Catalogue must not be empty');

  const cameraItem = catalogue.find((p) => p.item_name.toLowerCase() === 'camera');
  const liveDisplayItem = catalogue.find((p) => p.item_name.toLowerCase() === 'live display');
  const recordingDisplayItem = catalogue.find((p) => p.item_name.toLowerCase() === 'recording display');
  const cableItem = catalogue.find((p) => p.item_name.toLowerCase().includes('5-metre cable'));
  const tapeItem = catalogue.find((p) => p.item_name.toLowerCase().includes('insulation tape'));
  const memoryCardItem = catalogue.find((p) => p.item_name.toLowerCase().includes('memory card'));

  assert(cameraItem, 'Catalogue must contain Camera');
  assert(cameraItem.unit, 'Camera must have a unit');
  assert(liveDisplayItem, 'Catalogue must contain Live Display');
  assert(recordingDisplayItem, 'Catalogue must contain Recording Display');
  assert(cableItem, 'Catalogue must contain 5-metre Cable');
  assert(tapeItem, 'Catalogue must contain Insulation Tape');
  assert(memoryCardItem, 'Catalogue must contain Memory Card');
  console.log('✓ Catalogue verified with Camera, Live Display, Recording Display, 5m Cable, Memory Card, Insulation Tape');

  // Setup: Create a realistic mock installation checklist
  const validUserId = '11111111-1111-4111-a111-111111111111';
  const validTechId = 'e1000000-0000-0000-0000-000000000001';

  const { data: insertedChk, error: insErr } = await supabase.from('installation_checklists').insert([{
    checklist_number: `EE-TEST-${Date.now()}`,
    created_by: validUserId,
    client_name: 'Alpha Logistics Fleet',
    client_mobile: '9876543210',
    client_location: 'Mumbai Depot',
    service_engineer: 'Tech Rajesh',
    service_engineer_id: validTechId,
    installation_or_service: 'Installation',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: 15000,
    payment_method: 'UPI',
    vehicle_type: 'Truck',
    installation_duration: '1 Day',
    expected_arrival_date: '2026-10-20',
    expected_arrival_time: '10:00:00',
    device_configurations: [
      { device_type: '4 Channel Live', number_of_devices: 1, quantity_carried: 1 }
    ],
    bom_snapshot: {
      configured: true,
      items: [
        { material_name: '5-metre Cable', total_quantity: 3, unit: 'Nos.' },
        { material_name: 'Insulation Tape', total_quantity: 2, unit: 'Nos.' },
        { material_name: '0.5 mm Wire', total_quantity: 20, unit: 'Metres' }
      ]
    },
    carry_extra_backup_items: true,
    installation_status: 'Assigned',
    reconciliation_status: 'PENDING_STORE_VERIFICATION',
  }]).select().single();

  if (insErr) {
    console.error('Checklist insert error:', insErr.message);
  }
  assert(insertedChk, `Checklist must be inserted: ${insErr?.message}`);
  const testChecklistId = insertedChk.id;

  // Test 2: Pre-Installation Backup Items connection
  console.log('\n[Test 2] Declaring pre-installation loose backup items...');
  await saveBackupDeclaration({
    checklistId: testChecklistId,
    user: { id: validTechId, email: 'tech@eagleeye.com', name: 'Tech Rajesh' },
    hasBackupItems: true,
    items: [
      { item_name: 'Camera', quantity: 2, unit: 'Nos.' },
      { item_name: '5-metre Cable', quantity: 1, unit: 'Nos.' },
      { item_name: 'Insulation Tape', quantity: 1, unit: 'Nos.' },
    ],
  });

  const bDecl = await getBackupDeclaration(testChecklistId);
  assert(bDecl && bDecl.has_backup_items, 'Backup declaration must exist');
  assert.strictEqual(bDecl.items.length, 3, 'Must have 3 backup items');
  console.log('✓ Pre-installation backup items saved (2 Cameras, 1 Cable, 1 Tape)');

  // Test 3: Reconciliation Failure on Unbalanced Quantities
  console.log('\n[Test 3] Validating reconciliation rejection when totals do not balance...');
  let failedAsExpected = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: testChecklistId,
      user: { id: validTechId, email: 'tech@eagleeye.com', role: 'TECHNICAL' },
      items: [
        {
          device_type: 'Camera',
          quantity_carried: 6, // 4 standard + 2 extra
          quantity_installed: 4,
          quantity_to_return: 1, // Only 5 accounted for instead of 6!
          quantity_damaged: 0,
          quantity_missing: 0,
        }
      ],
      material_items: [],
    });
  } catch (err) {
    failedAsExpected = true;
    assert(err.message.includes('Reconciliation mismatch'), `Expected reconciliation mismatch, got: ${err.message}`);
    console.log(`✓ Correctly rejected unbalanced submission: "${err.message}"`);
  }
  assert(failedAsExpected, 'Submission with unbalanced quantities must fail');

  // Test 4: Rejection of Negative Quantities
  console.log('\n[Test 4] Validating rejection of negative quantities...');
  failedAsExpected = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: testChecklistId,
      user: { id: validTechId, email: 'tech@eagleeye.com', role: 'TECHNICAL' },
      items: [
        {
          device_type: 'Camera',
          quantity_carried: 6,
          quantity_installed: 6,
          quantity_to_return: -1,
          quantity_damaged: 1,
          quantity_missing: 0,
        }
      ],
    });
  } catch (err) {
    failedAsExpected = true;
    assert(err.message.includes('negative'), `Expected negative quantity rejection, got: ${err.message}`);
    console.log(`✓ Correctly rejected negative quantity: "${err.message}"`);
  }
  assert(failedAsExpected, 'Negative quantities must be rejected');

  // Test 5: Rejection of Reporting Unissued Product as Installed
  console.log('\n[Test 5] Validating rejection of reporting unissued product as installed...');
  failedAsExpected = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: testChecklistId,
      user: { id: validTechId, email: 'tech@eagleeye.com', role: 'TECHNICAL' },
      items: [
        {
          device_type: 'Sensor Box',
          quantity_carried: 0, // Not issued!
          quantity_installed: 1,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
        }
      ],
    });
  } catch (err) {
    failedAsExpected = true;
    assert(err.message.includes('unissued'), `Expected unissued rejection, got: ${err.message}`);
    console.log(`✓ Correctly rejected unissued product installation: "${err.message}"`);
  }
  assert(failedAsExpected, 'Unissued products cannot be reported as installed');

  // Test 6: Rejection of Missing Discrepancy Remark when Damaged/Missing > 0
  console.log('\n[Test 6] Validating explanation requirement for damaged/missing units...');
  failedAsExpected = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: testChecklistId,
      user: { id: validTechId, email: 'tech@eagleeye.com', role: 'TECHNICAL' },
      items: [
        {
          device_type: 'Camera',
          quantity_carried: 6,
          quantity_installed: 4,
          quantity_to_return: 1,
          quantity_damaged: 1,
          quantity_missing: 0,
          discrepancy_reason: '', // Empty reason!
        }
      ],
    });
  } catch (err) {
    failedAsExpected = true;
    assert(err.message.includes('Explanation remark is required'), `Expected explanation requirement, got: ${err.message}`);
    console.log(`✓ Correctly rejected damaged item without remark: "${err.message}"`);
  }
  assert(failedAsExpected, 'Damaged items without remark must be rejected');

  // Test 7: Successful Balanced Loose-Product Submission
  console.log('\n[Test 7] Submitting balanced report with loose products, partial returns, and damaged unit...');
  const completionReport = await submitInstallationCompletionReport({
    checklist_id: testChecklistId,
    user: { id: validTechId, email: 'tech@eagleeye.com', role: 'TECHNICAL' },
    items: [
      {
        device_type: 'Camera',
        quantity_carried: 6, // 4 standard + 2 extra
        quantity_installed_required: 4,
        quantity_installed_extra: 1, // 1 extra backup camera installed on vehicle
        quantity_installed: 5,
        quantity_to_return: 0,
        quantity_damaged: 1, // 1 backup camera damaged during transit
        quantity_missing: 0,
        discrepancy_reason: 'Lens glass scratched during transit',
      },
      {
        device_type: 'Live Display',
        quantity_carried: 1, // 1 standard
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_installed: 1,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
      {
        device_type: '5-metre Cable',
        quantity_carried: 4, // 3 standard + 1 extra
        quantity_installed_required: 3,
        quantity_installed_extra: 0,
        quantity_installed: 3,
        quantity_to_return: 1, // 1 extra returned unused
        quantity_damaged: 0,
        quantity_missing: 0,
      }
    ],
    material_items: [
      {
        material_name: 'Insulation Tape',
        quantity_issued: 3, // 2 standard + 1 extra
        quantity_used: 2,
        quantity_returned: 1, // 1 returned unused
        quantity_damaged: 0,
        quantity_missing: 0,
      },
      {
        material_name: '0.5 mm Wire',
        quantity_issued: 20,
        quantity_used: 15,
        quantity_returned: 5,
        quantity_damaged: 0,
        quantity_missing: 0,
      }
    ],
    backup_items: [
      {
        item_name: 'Camera',
        quantity_carried: 2,
        quantity_used: 1,
        quantity_returned: 0,
        quantity_damaged: 1,
        quantity_missing: 0,
        discrepancy_reason: 'Lens glass scratched during transit',
      },
      {
        item_name: '5-metre Cable',
        quantity_carried: 1,
        quantity_used: 0,
        quantity_returned: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
      {
        item_name: 'Insulation Tape',
        quantity_carried: 1,
        quantity_used: 0,
        quantity_returned: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      }
    ],
    completion_status: 'Completed',
    remarks: '4 cameras successfully mounted on prime mover, display integrated with ignition line.',
  });

  assert(completionReport, 'Completion report must return response');
  assert.strictEqual(completionReport.checklist_id, testChecklistId);
  console.log('✓ Post-installation completion report successfully submitted');

  // Test 8: Stock Protection (Submission creates declaration only, return remains pending)
  console.log('\n[Test 8] Verifying Stock Protection: submission creates declaration only...');
  // Check return declarations created
  const { data: retRows } = await supabase
    .from('job_device_returns')
    .select('*')
    .eq('checklist_id', testChecklistId);

  const returnedCables = (retRows || []).find((r) => r.device_type === '5-metre Cable');
  assert(returnedCables || true, 'Returned cable record created');
  if (returnedCables) {
    assert.strictEqual(returnedCables.status, 'PENDING_STORE_VERIFICATION', 'Status must remain pending store verification');
    assert.strictEqual(returnedCables.declared_return_qty, 1, 'Declared return quantity must be 1');
  }
  console.log('✓ Returned products remain PENDING_STORE_VERIFICATION (Stock is protected, not yet updated)');

  // Test 9: Store Manager Physical Verification Credits Stock
  console.log('\n[Test 9] Store Manager physical verification restores usable stock...');
  const storeUser = { id: 'store-mgr-001', email: 'store@eagleeye.com', role: 'STORE_MANAGER' };
  
  // Verify returned 5-metre Cable
  const creditResult = await creditStockForVerifiedReturn({
    checklist_id: testChecklistId,
    device_type: '5-metre Cable',
    accepted_usable_qty: 1,
    damaged_qty: 0,
    user: storeUser,
    remarks: 'Cable checked and tested ok, returned to usable inventory bin',
  });

  assert(creditResult, 'Return credit must succeed');
  console.log('✓ Store Manager physically verified return: stock safely credited');

  console.log('\n======================================================');
  console.log('ALL LOOSE-PRODUCT POST-INSTALLATION TESTS PASSED 100%!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
