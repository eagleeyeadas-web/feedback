import supabase from '../src/services/supabase.js';
import { createChecklist } from '../src/services/installationService.js';
import { calculateJobPreliminaryBom } from '../src/services/bomService.js';
import {
  saveBackupDeclaration,
  getBackupDeclaration,
  issueBackupItemsForChecklist,
  verifyStoreBackupItemReturn,
} from '../src/services/backupItemService.js';
import {
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
} from '../src/services/workflowService.js';
import { getMaterialInventory, adjustMaterialStock } from '../src/services/materialStockService.js';
import { getInventoryProducts, adjustStock } from '../src/services/inventoryService.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log(' SAFDRIVE: SEPARATE EXTRA BACKUP RETURNS FROM REQUIRED DEVICES SUITE   ');
  console.log(' Testing All 8 Mandatory Verification Scenarios                         ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ↳ ${details}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       ↳ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  const techUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'tech@eagleeye.com',
    name: 'Technician Test',
    role: 'TECHNICAL',
  };

  const storeUser = {
    id: 'be8232f9-674a-4b93-bbde-826b784c29a3',
    email: 'store@eagleeye.com',
    name: 'Store Manager Test',
    role: 'STORE_MANAGER',
  };

  // Helper to create test checklists
  async function makeChecklist({ name, deviceType = '4 Channel Live', numVehicles = 1, carryExtra = false }) {
    const randomDays = 600 + Math.floor(Math.random() * 8000);
    const date = new Date(Date.now() + randomDays * 86400000).toISOString().split('T')[0];
    return await createChecklist(techUser.id, {
      client_name: `${name} ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Site Yard A',
      salesperson_name: 'Sales Rep',
      service_engineer: 'Tech Lead',
      expected_arrival_date: date,
      installation_duration: '1 Day',
      installation_or_service: 'Installation',
      device_type: deviceType,
      number_of_devices: numVehicles,
      number_of_vehicles: numVehicles,
      device_configurations: [{ device_type: deviceType, number_of_devices: numVehicles, number_of_vehicles: numVehicles }],
      carry_extra_backup_items: carryExtra,
      confirmed_price: 25000,
      payment_method: 'Cash',
    });
  }

  // =========================================================================
  // SCENARIO 1: Required devices with no extra backup items
  // =========================================================================
  console.log('--- SCENARIO 1: Required devices with NO extra backup items ---');
  const chk1 = await makeChecklist({ name: 'Fleet S1 NoExtras', numVehicles: 2, carryExtra: false });
  assert(chk1 && chk1.id, 'Scenario 1 checklist created');

  // Technician declared no extra backup items
  await saveBackupDeclaration({
    checklistId: chk1.id,
    user: techUser,
    hasBackupItems: false,
    noItemsReason: 'Standard required installation devices only, no extras needed',
  });

  const decl1 = await getBackupDeclaration(chk1.id);
  assert(decl1.has_backup_items === false, 'Backup declaration confirms has_backup_items === false');
  assert(decl1.items.length === 0, 'No extra backup items in declaration');

  // Technician reports completion: 2 required devices installed, 0 extras carried/returned
  const rep1 = await submitInstallationCompletionReport({
    checklist_id: chk1.id,
    user: techUser,
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 2,
        quantity_installed: 2,
        quantity_installed_required: 2,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [],
    backup_items: [],
    completion_status: 'Completed',
    remarks: 'Installation of required devices completed with no extra backups carried.',
  });

  assert(rep1 && rep1.id, 'Completion report submitted successfully');
  assert(rep1.devices_installed_qty === 2, 'Required devices installed = 2');
  assert(rep1.devices_installed_required_qty === 2, 'Required devices installed required = 2');
  assert(rep1.extra_devices_carried_qty === 0, 'Extra devices carried = 0 (not asking for extra returns)');
  assert(rep1.extra_devices_installed_qty === 0, 'Extra devices installed = 0');
  assert(rep1.extra_devices_unused_qty === 0, 'Extra devices unused = 0');

  // =========================================================================
  // SCENARIO 2: Required devices plus extra backup items
  // Example from prompt:
  // 4 cameras required for installation, 3 additional backup cameras carried:
  // - Required: 4 cameras -> tracked in installation section
  // - Extra backup carried: 3 cameras
  // - Extra backup used: 1 camera
  // - Extra backup returned: 2 cameras
  // - Extra backup damaged: 0, missing: 0
  // Equation: Extra Carried (3) = Used (1) + Returned (2) + Damaged (0) + Missing (0)
  // 4 required cameras MUST NOT be included in this equation!
  // =========================================================================
  console.log('\n--- SCENARIO 2: Required devices plus extra backup items (Prompt Example) ---');
  const chk2 = await makeChecklist({ name: 'Fleet S2 PromptExample', numVehicles: 1, carryExtra: true });

  // Pre-Installation declaration: 3 extra cameras carried
  await saveBackupDeclaration({
    checklistId: chk2.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Camera', quantity: 3, unit: 'Nos.', category: 'Device Component' },
    ],
  });

  const decl2 = await getBackupDeclaration(chk2.id);
  assert(decl2.has_backup_items === true, 'Pre-installation declaration has_backup_items === true');
  assert(decl2.items.length === 1 && decl2.items[0].quantity === 3, 'Extra backup cameras carried = 3');

  // Submit Post-Installation report:
  // Required devices: 4 cameras (1 unit of 4 Channel Live)
  // Extra backup: carried 3, used 1, returned 2, damaged 0, missing 0
  const rep2 = await submitInstallationCompletionReport({
    checklist_id: chk2.id,
    user: techUser,
    items: [
      {
        device_type: 'Camera',
        quantity_carried: 4,
        quantity_installed: 4,
        quantity_installed_required: 4,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [],
    backup_items: [
      {
        item_name: 'Camera',
        quantity_carried: 3,
        quantity_used: 1,
        quantity_returned: 2,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    completion_status: 'Completed',
    remarks: '4 required cameras installed on customer vehicle. 1 extra backup camera used, 2 extra returned.',
  });

  assert(rep2 && rep2.id, 'Scenario 2 report submitted successfully');
  assert(rep2.devices_installed_qty === 4, 'Customer-required cameras installed = 4');
  assert(rep2.extra_devices_carried_qty === 3, 'Extra backup carried = 3 (separate from required 4 cameras)');
  assert(rep2.extra_devices_installed_qty === 1, 'Extra backup used = 1');
  assert(rep2.extra_devices_unused_qty === 2, 'Extra backup returned = 2');
  assert(rep2.extra_devices_damaged_qty === 0 && rep2.extra_devices_missing_qty === 0, 'Extra damaged & missing = 0');

  // Verify DB state for backup items
  const reconciledDecl2 = await getBackupDeclaration(chk2.id);
  const reconCam2 = reconciledDecl2.items.find((it) => it.item_name === 'Camera');
  assert(
    reconCam2 && reconCam2.quantity_used === 1 && reconCam2.quantity_returned === 2,
    'pre_installation_backup_items updated: quantity_used=1, quantity_returned=2'
  );

  // =========================================================================
  // SCENARIO 3: Extra items used completely
  // Extra carried: 2, Extra used: 2, Extra returned: 0, Extra damaged: 0, Extra missing: 0
  // =========================================================================
  console.log('\n--- SCENARIO 3: Extra items used completely ---');
  const chk3 = await makeChecklist({ name: 'Fleet S3 UsedCompletely', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chk3.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Camera', quantity: 2, unit: 'Nos.', category: 'Device Component' },
    ],
  });

  const rep3 = await submitInstallationCompletionReport({
    checklist_id: chk3.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [],
    backup_items: [
      { item_name: 'Camera', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    completion_status: 'Completed',
    remarks: 'Both extra cameras used completely on site.',
  });

  assert(rep3.extra_devices_carried_qty === 2, 'Extra carried = 2');
  assert(rep3.extra_devices_installed_qty === 2, 'Extra installed/used = 2');
  assert(rep3.extra_devices_unused_qty === 0, 'Extra unused/returned = 0');

  // =========================================================================
  // SCENARIO 4: Extra items returned completely unused
  // Extra carried: 3, Extra used: 0, Extra returned: 3, Extra damaged: 0, Extra missing: 0
  // =========================================================================
  console.log('\n--- SCENARIO 4: Extra items returned completely unused ---');
  const chk4 = await makeChecklist({ name: 'Fleet S4 AllReturned', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chk4.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Live Display', quantity: 3, unit: 'Nos.', category: 'Device Component' },
    ],
  });

  const rep4 = await submitInstallationCompletionReport({
    checklist_id: chk4.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [],
    backup_items: [
      { item_name: 'Live Display', quantity_carried: 3, quantity_used: 0, quantity_returned: 3, quantity_damaged: 0, quantity_missing: 0 },
    ],
    completion_status: 'Completed',
    remarks: 'All 3 backup displays returned unused.',
  });

  assert(rep4.extra_devices_carried_qty === 3, 'Extra carried = 3');
  assert(rep4.extra_devices_installed_qty === 0, 'Extra used = 0');
  assert(rep4.extra_devices_unused_qty === 3, 'Extra returned unused = 3');

  // =========================================================================
  // SCENARIO 5: Extra items partly used and partly returned
  // Extra carried: 5 (5m Cable), Extra used: 2, Extra returned: 3
  // =========================================================================
  console.log('\n--- SCENARIO 5: Extra items partly used and partly returned ---');
  const chk5 = await makeChecklist({ name: 'Fleet S5 PartUsedPartReturned', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chk5.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: '5-metre Cable', quantity: 5, unit: 'Nos.', category: 'Installation Material' },
    ],
  });

  const rep5 = await submitInstallationCompletionReport({
    checklist_id: chk5.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [],
    backup_items: [
      { item_name: '5-metre Cable', quantity_carried: 5, quantity_used: 2, quantity_returned: 3, quantity_damaged: 0, quantity_missing: 0 },
    ],
    completion_status: 'Completed',
    remarks: '2 cables used, 3 cables returned.',
  });

  const reconDecl5 = await getBackupDeclaration(chk5.id);
  const cable5 = reconDecl5.items.find((it) => it.item_name.includes('Cable'));
  assert(cable5 && cable5.quantity_used === 2 && cable5.quantity_returned === 3, 'Partly used (2) and partly returned (3) persisted cleanly');

  // =========================================================================
  // SCENARIO 6: Extra items damaged or missing
  // Extra carried: 4 Displays.
  // 6A: Missing explanation remark -> must fail validation!
  // 6B: With explanation remark -> succeeds, extra_devices_damaged_qty=1, extra_devices_missing_qty=1
  // =========================================================================
  console.log('\n--- SCENARIO 6: Extra items damaged or missing ---');
  const chk6 = await makeChecklist({ name: 'Fleet S6 DamagedMissing', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chk6.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Display', quantity: 4, unit: 'Nos.', category: 'Device Component' },
    ],
  });

  // 6A: Submit damaged without discrepancy reason -> must throw error
  let threwWithoutRemark = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: chk6.id,
      user: techUser,
      items: [
        { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
      ],
      material_items: [],
      backup_items: [
        { item_name: 'Display', quantity_carried: 4, quantity_used: 1, quantity_returned: 1, quantity_damaged: 1, quantity_missing: 1, discrepancy_reason: '' },
      ],
      completion_status: 'Site Work Completed',
    });
  } catch (err) {
    threwWithoutRemark = true;
    assert(err.message.includes('Discrepancy remark is required'), 'Validation correctly rejects damaged/missing without discrepancy reason');
  }
  assert(threwWithoutRemark, 'Backend enforced required discrepancy explanation for damaged/missing backup items');

  // 6B: Submit with required discrepancy explanation
  const rep6 = await submitInstallationCompletionReport({
    checklist_id: chk6.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [],
    backup_items: [
      {
        item_name: 'Display',
        quantity_carried: 4,
        quantity_used: 1,
        quantity_returned: 1,
        quantity_damaged: 1,
        quantity_missing: 1,
        discrepancy_reason: '1 screen cracked in transport, 1 missing from site box',
      },
    ],
    completion_status: 'Completed',
    remarks: 'Installation complete with 1 transit damaged display and 1 missing display.',
  });

  assert(rep6.extra_devices_carried_qty === 4, 'Extra carried = 4');
  assert(rep6.extra_devices_installed_qty === 1, 'Extra used = 1');
  assert(rep6.extra_devices_unused_qty === 1, 'Extra returned = 1');
  assert(rep6.extra_devices_damaged_qty === 1, 'Extra damaged = 1');
  assert(rep6.extra_devices_missing_qty === 1, 'Extra missing = 1');

  // Verify non-negative validation
  let threwNegative = false;
  try {
    await submitInstallationCompletionReport({
      checklist_id: chk6.id,
      user: techUser,
      items: [
        { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
      ],
      material_items: [],
      backup_items: [
        { item_name: 'Display', quantity_carried: 4, quantity_used: -1, quantity_returned: 5, quantity_damaged: 0, quantity_missing: 0 },
      ],
    });
  } catch (err) {
    threwNegative = true;
    assert(err.message.includes('cannot be negative'), 'Negative quantity correctly rejected by backup validator');
  }
  assert(threwNegative, 'Validator rejects negative backup values');

  // =========================================================================
  // SCENARIO 7: Standard installation materials mixed with extra materials
  // Standard BOM: 20m 0.5 mm Wire issued. Technician uses 18m, returns 2m.
  // Extra backup: 10m 0.5 mm Wire declared. Technician uses 4m, returns 6m.
  // Standard and extra materials must NEVER be mixed or subtracted from total issuance!
  // =========================================================================
  console.log('\n--- SCENARIO 7: Standard installation materials mixed with extra materials ---');
  const chk7 = await makeChecklist({ name: 'Fleet S7 MaterialsSeparation', numVehicles: 1, carryExtra: true });

  // Standard preliminary BOM
  const prelimBom7 = await calculateJobPreliminaryBom([
    { device_type: '4 Channel Live', number_of_devices: 1, number_of_vehicles: 1 },
  ]);

  // Pre-Installation Form declares extra backup material (10m wire)
  await saveBackupDeclaration({
    checklistId: chk7.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: '0.5 mm Wire', quantity: 10, unit: 'Metres', category: 'Installation Material' },
    ],
  });

  // Post-Installation Form separates standard materials from extra materials:
  const rep7 = await submitInstallationCompletionReport({
    checklist_id: chk7.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [
      {
        material_name: '0.5 mm Wire',
        unit: 'Metres',
        quantity_issued: 20,
        quantity_used: 18,
        quantity_returned: 2,
        quantity_damaged: 0,
        quantity_missing: 0,
        remarks: 'Standard BOM consumption: 18m used, 2m returned to spool',
      },
    ],
    backup_items: [
      {
        item_name: '0.5 mm Wire',
        unit: 'Metres',
        quantity_carried: 10,
        quantity_used: 4,
        quantity_returned: 6,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    completion_status: 'Completed',
    remarks: 'Standard wiring and extra wire tracked distinctly.',
  });

  assert(rep7 && rep7.id, 'Scenario 7 report submitted successfully');
  assert(rep7.material_items.length === 1, 'Standard material items preserved distinctly in material_items');
  assert(rep7.material_items[0].quantity_used === 18, 'Standard wire used = 18m');
  assert(rep7.material_items[0].quantity_returned === 2, 'Standard wire returned = 2m');

  assert(rep7.backup_items.length === 1, 'Extra backup wire preserved distinctly in backup_items');
  assert(rep7.backup_items[0].quantity_used === 4, 'Extra backup wire used = 4m');
  assert(rep7.backup_items[0].quantity_returned === 6, 'Extra backup wire returned = 6m');

  // Verify getInstallationCompletionReport returns both separately
  const fetchedRep7 = await getInstallationCompletionReport(chk7.id);
  assert(fetchedRep7.material_items[0].quantity_used === 18, 'fetched report standard material quantity_used = 18');
  assert(fetchedRep7.backup_items[0].quantity_used === 4, 'fetched report extra backup quantity_used = 4');

  // =========================================================================
  // SCENARIO 8: Post-Installation Form submission and Store Manager return verification
  // Verify inventory stock behavior:
  // 1. Stock does NOT increase upon technician submission alone
  // 2. Store Manager physically inspects and verifies return
  // 3. Only accepted usable stock is restored to warehouse inventory
  // 4. Damaged/missing items are NOT restored to usable stock
  // 5. Duplicate verification is strictly prevented
  // =========================================================================
  console.log('\n--- SCENARIO 8: Post-Installation Form submission & Store Manager return verification ---');
  const chk8 = await makeChecklist({ name: 'Fleet S8 StoreVerification', numVehicles: 1, carryExtra: true });

  // Baseline inventory check
  const [initialProducts, initialMaterials] = await Promise.all([
    getInventoryProducts().catch(() => []),
    getMaterialInventory().catch(() => []),
  ]);

  const camProdBefore = initialProducts.find((p) => p.device_type === '4 Channel Live' || p.item_name === 'Camera');
  const wireMatBefore = initialMaterials.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'));
  const initialWireStock = Number(wireMatBefore?.current_stock) || 0;

  // Pre-Installation Form declaration: 10m extra wire
  await saveBackupDeclaration({
    checklistId: chk8.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: '0.5 mm Wire', quantity: 10, unit: 'Metres', category: 'Installation Material' },
    ],
  });

  // Store Manager authorizes and issues declared backup items
  await issueBackupItemsForChecklist({
    checklist_id: chk8.id,
    user: storeUser,
    remarks: 'Issued 10m backup wire for job',
  });

  const materialsAfterIssue = await getMaterialInventory();
  const wireMatAfterIssue = materialsAfterIssue.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'));
  const stockAfterIssue = Number(wireMatAfterIssue?.current_stock) || 0;
  assert(stockAfterIssue === initialWireStock - 10, 'Warehouse stock reduced by exactly 10m upon Store Manager issuance');

  // Technician completes post-installation report:
  // Declares 4m used, 5m returned usable, 1m damaged during pulling
  await submitInstallationCompletionReport({
    checklist_id: chk8.id,
    user: techUser,
    items: [
      { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
    material_items: [],
    backup_items: [
      {
        item_name: '0.5 mm Wire',
        quantity_carried: 10,
        quantity_used: 4,
        quantity_returned: 5,
        quantity_damaged: 1,
        quantity_missing: 0,
        discrepancy_reason: '1m wire snapped and damaged during conduit pulling',
      },
    ],
    completion_status: 'Completed',
    remarks: 'Work completed. 5m usable wire brought back, 1m wire scrap/damaged.',
  });

  // Verify stock DID NOT change upon technician report submission alone
  const materialsAfterTechReport = await getMaterialInventory();
  const wireMatAfterTechReport = materialsAfterTechReport.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'));
  assert(
    Number(wireMatAfterTechReport?.current_stock) === stockAfterIssue,
    'Warehouse stock DID NOT change upon technician report submission alone (Store protection confirmed)'
  );

  // Store Manager physically inspects and verifies the return:
  // Accepts 5m usable, acknowledges 1m damaged
  const storeVerificationResult = await verifyStoreBackupItemReturn({
    checklistId: chk8.id,
    user: storeUser,
    verificationItems: [
      { item_name: '0.5 mm Wire', accepted_usable_qty: 5, damaged_qty: 1, missing_qty: 0 },
    ],
    remarks: 'Physically inspected spool: accepted 5m usable wire back into inventory. 1m damaged discarded.',
  });

  assert(storeVerificationResult && storeVerificationResult.success, 'Store Manager verification succeeded');

  // Verify usable inventory stock increased by exactly accepted usable qty (5m)
  const materialsAfterStoreVerification = await getMaterialInventory();
  const wireMatAfterStoreVerification = materialsAfterStoreVerification.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'));
  const finalWireStock = Number(wireMatAfterStoreVerification?.current_stock) || 0;
  assert(
    finalWireStock === stockAfterIssue + 5,
    'Warehouse inventory restored by EXACTLY 5m accepted usable wire (Damaged 1m not restored)'
  );

  // Attempt duplicate store verification: MUST be rejected
  let threwDuplicateVerification = false;
  try {
    await verifyStoreBackupItemReturn({
      checklistId: chk8.id,
      user: storeUser,
      verificationItems: [
        { item_name: '0.5 mm Wire', accepted_usable_qty: 5, damaged_qty: 1, missing_qty: 0 },
      ],
      remarks: 'Attempting duplicate verification',
    });
  } catch (err) {
    threwDuplicateVerification = true;
    assert(err.message.includes('already been physically verified'), 'Duplicate return verification blocked with clear error');
  }
  assert(threwDuplicateVerification, 'Duplicate verification prevention active and working');

  // Verify inventory stock remained unchanged after duplicate attempt
  const materialsAfterDuplicateAttempt = await getMaterialInventory();
  const wireMatAfterDuplicate = materialsAfterDuplicateAttempt.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'));
  assert(
    Number(wireMatAfterDuplicate?.current_stock) === finalWireStock,
    'No duplicate stock addition occurred on repeated verification attempt'
  );

  console.log('\n========================================================================');
  console.log(` SUMMARY: All ${passed}/${total} Acceptance Tests PASSED!`);
  console.log('========================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\nTest Suite Failed:', err);
  process.exit(1);
});
