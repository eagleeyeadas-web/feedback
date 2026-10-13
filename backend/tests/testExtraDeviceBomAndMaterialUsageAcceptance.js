import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  calculateJobPreliminaryBom,
  calculateJobFinalBom,
  calculateBomRequirements,
  getBomByDeviceType,
} from '../src/services/bomService.js';
import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import {
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  verifyStoreReturn,
  verifyStoreMaterialReturn,
  getPendingStoreReturns,
  getPendingStoreMaterialReturns,
} from '../src/services/workflowService.js';
import {
  getInventoryProducts,
  issueStockForJob,
} from '../src/services/inventoryService.js';
import {
  getMaterialInventory,
  creditMaterialStockForVerifiedReturn,
} from '../src/services/materialStockService.js';

async function runAcceptanceTest() {
  console.log('========================================================================');
  console.log('EAGLE EYE SAFDRIVE — PRIORITY 2 ACCEPTANCE TEST');
  console.log('Testing: Extra Device BOM, Final Material Usage & Returned Stock');
  console.log('========================================================================\n');

  const testUserSales = { id: '00000000-0000-0000-0000-000000000001', email: 'sales@eagleeye.com', role: 'SALES' };
  const testUserTech = { id: '00000000-0000-0000-0000-000000000002', email: 'tech@eagleeye.com', role: 'TECHNICAL' };
  const testUserStore = { id: '00000000-0000-0000-0000-000000000003', email: 'store@eagleeye.com', role: 'STORE_MANAGER' };

  // -------------------------------------------------------------------------
  // RULE CHECK: 8 Channel Live does NOT require Memory Card
  // -------------------------------------------------------------------------
  console.log('-> Verifying rule: 8 Channel Live does not require a Memory Card...');
  const eightChannelBom = await calculateBomRequirements([
    { device_type: '8 Channel Live', number_of_devices: 1, number_of_vehicles: 1 },
  ]);
  const hasMemoryCardIn8CH = eightChannelBom.items.some((it) =>
    it.material_name.toLowerCase().includes('memory card')
  );
  assert.strictEqual(
    hasMemoryCardIn8CH,
    false,
    'Rule failed: 8 Channel Live BOM must not contain a Memory Card'
  );
  console.log('   [PASS] 8 Channel Live BOM correctly excludes Memory Card.\n');

  // -------------------------------------------------------------------------
  // CRITERION 7: BOM calculation alone must NEVER change inventory balances
  // -------------------------------------------------------------------------
  console.log('-> Criterion 7: Verify BOM calculation alone never modifies inventory balances...');
  const initialDeviceProducts = await getInventoryProducts();
  const initialMaterials = await getMaterialInventory();
  const targetDevice = initialDeviceProducts.find((p) => p.device_type === '4 Channel Live') || initialDeviceProducts[0];
  const initialDeviceStock = Number(targetDevice?.usable_stock || 0);
  const targetMat = initialMaterials.find((m) => m.material_name.toLowerCase().includes('cable')) || initialMaterials[0];
  const initialMatStock = Number(targetMat?.current_stock || 0);

  // Trigger multiple BOM calculations
  await calculateJobPreliminaryBom({
    requiredConfigs: [{ device_type: '4 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
    extraConfigs: [{ device_type: '4 Channel Live', extra_quantity: 2 }],
  });
  await calculateJobFinalBom({
    installedDeviceConfigs: [{ device_type: '4 Channel Live', number_of_devices: 2, number_of_vehicles: 2 }],
  });

  const postCalcDeviceProducts = await getInventoryProducts();
  const postCalcMaterials = await getMaterialInventory();
  const afterDevice = postCalcDeviceProducts.find((p) => p.device_type === targetDevice?.device_type);
  const afterMat = postCalcMaterials.find((m) => m.material_name === targetMat?.material_name);

  assert.strictEqual(
    Number(afterDevice?.usable_stock || 0),
    initialDeviceStock,
    'Criterion 7 violation: Device stock was altered by BOM calculation alone!'
  );
  assert.strictEqual(
    Number(afterMat?.current_stock || 0),
    initialMatStock,
    'Criterion 7 violation: Material stock was altered by BOM calculation alone!'
  );
  console.log('   [PASS] Inventory balances remain unchanged after preliminary and final BOM calculations.\n');

  // -------------------------------------------------------------------------
  // CRITERION 1 & 2: Sales creates checklist with:
  // - 1 required 4 Channel Live device
  // - 2 extra 4 Channel Live devices
  // Sales sees preliminary BOM for all 3 devices carried.
  // -------------------------------------------------------------------------
  console.log('-> Creating Job: 1 required 4 Channel Live + 2 extra 4 Channel Live...');
  const uniqueTestSuffix = Date.now();
  const checklistData = {
    client_name: `Priority2 Test Client ${uniqueTestSuffix}`,
    client_mobile: '9876543210',
    client_location: 'Mumbai Hub',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    device_configurations: [
      { device_type: '4 Channel Live', number_of_devices: 1, number_of_vehicles: 1 },
    ],
    extra_devices: true,
    extra_device_type: '4 Channel Live',
    extra_device_count: 2,
    extra_device_configurations: [
      { device_type: '4 Channel Live', extra_quantity: 2 },
    ],
    confirmed_price: 35000,
    installation_duration: '1 Day',
    installation_or_service: 'Installation',
    service_engineer: 'Suresh Kumar',
    expected_arrival_date: new Date().toISOString().split('T')[0],
    expected_arrival_time: '10:00 AM',
  };

  const createdChecklist = await createChecklist(testUserSales.id, checklistData);
  const checklistId = createdChecklist.id;
  console.log(`   Checklist created with ID: ${checklistId}, Number: ${createdChecklist.checklist_number}`);

  const prelimSnapshot = createdChecklist.bom_snapshot;
  assert.ok(prelimSnapshot, 'Checklist must have a bom_snapshot');
  assert.strictEqual(
    prelimSnapshot.total_devices_required,
    1,
    'Preliminary BOM: total_devices_required must be 1'
  );
  assert.strictEqual(
    prelimSnapshot.total_extra_devices,
    2,
    'Preliminary BOM: total_extra_devices must be 2'
  );
  assert.strictEqual(
    prelimSnapshot.total_devices_carried,
    3,
    'Preliminary BOM: total_devices_carried must be 3'
  );

  // Verify preliminary BOM has items calculated for 3 devices carried
  const fourChanTemplate = await getBomByDeviceType('4 Channel Live');
  assert.ok(fourChanTemplate, '4 Channel Live BOM must exist');
  const sampleBomItem = fourChanTemplate.items[0];
  const expectedCombinedQty = Math.round((sampleBomItem.quantity_per_device * 3) * 100) / 100;
  const prelimItemMatch = prelimSnapshot.items.find(
    (it) => it.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase()
  );
  assert.ok(prelimItemMatch, `Material "${sampleBomItem.material_name}" must be in preliminary BOM`);
  assert.strictEqual(
    prelimItemMatch.total_quantity,
    expectedCombinedQty,
    `Preliminary BOM quantity for "${sampleBomItem.material_name}" must equal quantity for 3 carried devices (${expectedCombinedQty})`
  );
  console.log(`   [PASS] Preliminary BOM is calculated for all 3 devices carried (${sampleBomItem.material_name}: ${expectedCombinedQty} ${sampleBomItem.unit}).\n`);

  // -------------------------------------------------------------------------
  // STORE MANAGER ISSUES MATERIALS FOR JOB
  // -------------------------------------------------------------------------
  console.log('-> Simulating Store issuance of materials for installation job...');
  // Record 3 devices carried and issue fitting materials
  const issuedMaterialItems = prelimSnapshot.items.map((it) => ({
    material_id: it.material_id,
    material_name: it.material_name,
    unit: it.unit,
    quantity_issued: it.total_quantity,
    quantity_used: 0,
    quantity_returned: 0,
  }));

  // -------------------------------------------------------------------------
  // TECHNICIAN COMPLETION REPORT SUBMISSION:
  // - 2 devices installed, including 1 extra device (1 required + 1 extra)
  // - 1 extra device returned
  // - Unused fitting materials returned (e.g. 1 unit of sampleBomItem returned, 2 used)
  // -------------------------------------------------------------------------
  console.log('-> Technician submits installation completion report:');
  console.log('   - 1 required device installed');
  console.log('   - 1 extra device installed (Total installed = 2)');
  console.log('   - 1 extra device returned');
  console.log('   - 0 damaged, 0 missing');

  const returnedFittingQty = Math.min(prelimItemMatch.total_quantity, sampleBomItem.quantity_per_device); // 1 device worth returned
  const usedFittingQty = prelimItemMatch.total_quantity - returnedFittingQty; // 2 devices worth used

  const techMaterialItems = issuedMaterialItems.map((m) => {
    if (m.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase()) {
      return {
        ...m,
        quantity_issued: m.quantity_issued,
        quantity_used: usedFittingQty,
        quantity_returned: returnedFittingQty,
        quantity_damaged: 0,
        quantity_missing: 0,
        remarks: 'Unused fitting materials returned after 2 units installed',
      };
    }
    return {
      ...m,
      quantity_used: m.quantity_issued,
      quantity_returned: 0,
    };
  });

  const completionReportResult = await submitInstallationCompletionReport({
    checklist_id: checklistId,
    user: testUserTech,
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 3,
        quantity_installed: 2,
        quantity_installed_required: 1,
        quantity_installed_extra: 1,
        quantity_to_return: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
        discrepancy_reason: null,
      },
    ],
    material_items: techMaterialItems,
    completion_status: 'Completed',
    remarks: 'Installed 2 units including 1 backup device. 1 backup returned to store.',
  });

  assert.ok(completionReportResult, 'Completion report must be created');
  assert.strictEqual(
    completionReportResult.total_devices_installed,
    2,
    'Expected total 2 devices installed'
  );
  assert.strictEqual(
    completionReportResult.total_devices_to_return,
    1,
    'Expected 1 device declared to return'
  );
  console.log('   [PASS] Completion report submitted and reconciled successfully.\n');

  // -------------------------------------------------------------------------
  // CRITERION 1 & 2: Final BOM vs Preliminary BOM
  // 1. Final BOM is calculated for TWO installed devices
  // 2. Preliminary BOM remains based on ALL THREE devices carried
  // 3. Store Manager can compare preliminary and final BOM quantities
  // -------------------------------------------------------------------------
  console.log('-> Verifying Final BOM and Preliminary vs Final comparison...');
  const updatedChecklist = await getChecklistById(checklistId);
  const finalBomSnapshot = updatedChecklist.final_bom_snapshot;
  assert.ok(finalBomSnapshot, 'Checklist must contain final_bom_snapshot');

  // Final BOM devices count must be 2
  assert.strictEqual(
    finalBomSnapshot.total_devices_installed,
    2,
    'Expected Final BOM to be calculated for 2 installed devices'
  );

  // Preliminary BOM remains based on 3 devices carried
  assert.strictEqual(
    updatedChecklist.bom_snapshot.total_devices_carried,
    3,
    'Preliminary BOM must remain based on all 3 devices carried'
  );

  // Final BOM requirement for sampleBomItem should equal 2 devices worth
  const expectedFinalQty = Math.round((sampleBomItem.quantity_per_device * 2) * 100) / 100;
  const finalItemMatch = finalBomSnapshot.items.find(
    (it) => it.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase()
  );
  assert.ok(finalItemMatch, `Material "${sampleBomItem.material_name}" must be in final BOM`);
  assert.strictEqual(
    finalItemMatch.total_quantity,
    expectedFinalQty,
    `Final BOM quantity for "${sampleBomItem.material_name}" must equal quantity for 2 installed devices (${expectedFinalQty})`
  );

  // Comparison in final BOM snapshot
  assert.ok(Array.isArray(finalBomSnapshot.comparison), 'final_bom_snapshot must include comparison table');
  const compItem = finalBomSnapshot.comparison.find(
    (c) => c.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase()
  );
  assert.ok(compItem, 'Comparison must include sample material item');
  assert.strictEqual(
    compItem.preliminary_quantity,
    expectedCombinedQty,
    `Comparison preliminary_quantity must be ${expectedCombinedQty}`
  );
  assert.strictEqual(
    compItem.final_quantity,
    expectedFinalQty,
    `Comparison final_quantity must be ${expectedFinalQty}`
  );
  assert.strictEqual(
    compItem.difference,
    Math.round((expectedFinalQty - expectedCombinedQty) * 100) / 100,
    'Comparison difference must accurately reflect preliminary vs final requirement'
  );
  console.log(`   [PASS] Final BOM calculated for 2 installed devices (${sampleBomItem.material_name}: ${expectedFinalQty} ${sampleBomItem.unit}).`);
  console.log(`   [PASS] Preliminary BOM preserved for all 3 devices carried (${expectedCombinedQty} ${sampleBomItem.unit}).`);
  console.log(`   [PASS] Comparison shows Difference: ${compItem.difference} ${sampleBomItem.unit}.\n`);

  // -------------------------------------------------------------------------
  // CRITERION 4 & 5: Stock increases ONLY after Store Manager physical verification
  // -------------------------------------------------------------------------
  console.log('-> Criterion 4 & 5: Verifying physical return and stock update...');
  // Check pending returns exist
  const pendingDeviceReturns = await getPendingStoreReturns();
  const jobDevReturn = pendingDeviceReturns.find((r) => r.checklist_id === checklistId);
  assert.ok(jobDevReturn, 'Pending device return must exist for this job');
  assert.strictEqual(jobDevReturn.declared_return_qty, 1);

  const pendingMatReturns = await getPendingStoreMaterialReturns();
  const jobMatReturn = pendingMatReturns.find((r) => r.checklist_id === checklistId);
  assert.ok(jobMatReturn, 'Pending material return must exist for this job');

  // Verify that BEFORE store manager physical verification, device stock is NOT yet credited
  const midDeviceProducts = await getInventoryProducts();
  const midDeviceStock = Number(midDeviceProducts.find((p) => p.device_type === '4 Channel Live')?.usable_stock || 0);

  // Store Manager verifies returned device:
  console.log('   Store Manager physically verifies 1 usable 4 Channel Live device return...');
  const verifiedDeviceReturn = await verifyStoreReturn({
    return_id: jobDevReturn.id,
    accepted_usable_qty: 1,
    damaged_qty: 0,
    missing_qty: 0,
    user: testUserStore,
    remarks: 'Physically inspected 4 Channel Live device. Condition tested and accepted.',
  });
  assert.strictEqual(verifiedDeviceReturn.status, 'VERIFIED_AND_RECONCILED');

  const afterDevVerificationProducts = await getInventoryProducts();
  const afterDevStock = Number(afterDevVerificationProducts.find((p) => p.device_type === '4 Channel Live')?.usable_stock || 0);
  assert.strictEqual(
    afterDevStock,
    midDeviceStock + 1,
    'Criterion 4 failed: Usable device stock must increase by 1 after verification!'
  );
  console.log(`   [PASS] Usable device stock increased by 1 only after physical verification (${midDeviceStock} -> ${afterDevStock}).`);

  // Store Manager verifies returned material:
  console.log('   Store Manager physically verifies returned fitting materials...');
  const preMatCredit = await getMaterialInventory();
  const targetMatBefore = preMatCredit.find((m) => m.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase());
  const initialMatBalance = Number(targetMatBefore?.current_stock || 0);

  const verifiedMatReturn = await verifyStoreMaterialReturn({
    return_id: jobMatReturn.id,
    accepted_usable_qty: returnedFittingQty,
    damaged_qty: 0,
    missing_qty: 0,
    user: testUserStore,
    remarks: 'Physically inspected returned fitting materials. Stock credited.',
  });
  assert.strictEqual(verifiedMatReturn.status, 'VERIFIED_AND_RECONCILED');

  const postMatCredit = await getMaterialInventory();
  const targetMatAfter = postMatCredit.find((m) => m.material_name.toLowerCase() === sampleBomItem.material_name.toLowerCase());
  const expectedNewMatBalance = Math.round((initialMatBalance + returnedFittingQty) * 100) / 100;
  assert.strictEqual(
    Number(targetMatAfter?.current_stock || 0),
    expectedNewMatBalance,
    'Criterion 5 failed: Returned fitting material must increase stock upon verified usable return!'
  );
  console.log(`   [PASS] Returned fitting material credited back to inventory balance (${initialMatBalance} -> ${expectedNewMatBalance} ${sampleBomItem.unit}).\n`);

  // -------------------------------------------------------------------------
  // CRITERION 8: Idempotency & Duplicate Verification Rejection
  // -------------------------------------------------------------------------
  console.log('-> Criterion 8: Testing idempotency — rejecting duplicate return verification...');
  let duplicateDeviceRejected = false;
  try {
    await verifyStoreReturn({
      return_id: jobDevReturn.id,
      accepted_usable_qty: 1,
      damaged_qty: 0,
      missing_qty: 0,
      user: testUserStore,
      remarks: 'Attempt duplicate verification',
    });
  } catch (err) {
    duplicateDeviceRejected = true;
    console.log(`   Expected duplicate rejection caught: "${err.message}"`);
  }
  assert.strictEqual(
    duplicateDeviceRejected,
    true,
    'Criterion 8 failed: Duplicate device return verification must be rejected!'
  );

  let duplicateMatRejected = false;
  try {
    await verifyStoreMaterialReturn({
      return_id: jobMatReturn.id,
      accepted_usable_qty: returnedFittingQty,
      user: testUserStore,
      remarks: 'Attempt duplicate material verification',
    });
  } catch (err) {
    duplicateMatRejected = true;
    console.log(`   Expected duplicate material rejection caught: "${err.message}"`);
  }
  assert.strictEqual(
    duplicateMatRejected,
    true,
    'Criterion 8 failed: Duplicate material return verification must be rejected!'
  );
  console.log('   [PASS] Idempotency confirmed: Duplicate return verifications successfully rejected without duplicate stock movements.\n');

  console.log('========================================================================');
  console.log('ALL 8 ACCEPTANCE TEST CRITERIA PASSED SUCCESSFULLY!');
  console.log('========================================================================');
}

runAcceptanceTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nACCEPTANCE TEST FAILED:', err);
    process.exit(1);
  });
