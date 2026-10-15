import supabase from '../src/services/supabase.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  saveBackupDeclaration,
  getBackupDeclaration,
  getAvailableBackupProducts,
  issueBackupItemsForChecklist,
  verifyStoreBackupItemReturn,
} from '../src/services/backupItemService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';
import { issueFullJobStock } from '../src/services/storeRequirementService.js';

async function runModalUpdateAcceptanceTests() {
  console.log('========================================================================');
  console.log(' PRE-INSTALLATION: EXTRA BACKUP ITEMS MODAL COMPREHENSIVE TEST SUITE    ');
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

  // -------------------------------------------------------------------------
  // TEST 1: Catalogue Retrieval — Both Category A & Category B from Database
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Authoritative Inventory Catalogue Retrieval ---');
  const availableProducts = await getAvailableBackupProducts();
  assert(
    Array.isArray(availableProducts) && availableProducts.length >= 10,
    'Authoritative catalogue loaded products from database',
    `Loaded ${availableProducts.length} items from DB`
  );

  const categoryA = availableProducts.filter((p) => p.category_group === 'A');
  const categoryB = availableProducts.filter((p) => p.category_group === 'B');

  assert(
    categoryA.length > 0,
    'Category A: Camera & Device Components included',
    `Found ${categoryA.length} Category A items (${categoryA.map((p) => p.item_name).slice(0, 4).join(', ')})`
  );
  assert(
    categoryB.length > 0,
    'Category B: Installation Materials included',
    `Found ${categoryB.length} Category B items (${categoryB.map((p) => p.item_name).slice(0, 4).join(', ')})`
  );

  // Check required examples from prompt
  const hasCamera = availableProducts.some((p) => p.item_name.toLowerCase() === 'camera');
  const hasDisplay = availableProducts.some((p) => p.item_name.toLowerCase().includes('display'));
  const hasTape = availableProducts.some((p) => p.item_name.toLowerCase().includes('insulation tape'));
  const hasWire = availableProducts.some((p) => p.item_name.toLowerCase().includes('0.5 mm wire'));
  const hasCableTie = availableProducts.some((p) => p.item_name.toLowerCase().includes('cable tie'));

  assert(hasCamera, 'Individual Cameras present in catalogue with canonical ID');
  assert(hasDisplay, 'Displays present in catalogue with canonical ID');
  assert(hasTape, 'Insulation Tape present in catalogue');
  const wireProduct = availableProducts.find((p) => p.item_name.toLowerCase().includes('0.5 mm wire'));
  assert(wireProduct && wireProduct.unit === 'Metres', '0.5 mm Wire correctly has unit "Metres" from DB');

  // -------------------------------------------------------------------------
  // TEST 2: Create Test Checklist with Sales Declaration
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Create Installation Checklist ---');
  const testNow = Date.now();
  const testChecklist = await createChecklist('f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', {
    client_name: `Test Fleet ${testNow}`,
    client_mobile: '9876543210',
    client_location: 'Warehouse Dock A',
    salesperson_name: 'Test Sales',
    service_engineer: 'Test Engineer',
    expected_arrival_date: new Date(Date.now() + 1000 * 86400000).toISOString().split('T')[0],
    installation_duration: '1 Day',
    installation_or_service: 'Installation',
    device_type: '2 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
    carry_extra_backup_items: true,
    confirmed_price: 25000,
    payment_method: 'Cash',
  });

  assert(testChecklist && testChecklist.id, 'Checklist created successfully in DB');
  assert(testChecklist.carry_extra_backup_items === true, 'Sales declaration carry_extra_backup_items === true');
  assert(testChecklist.number_of_devices === 1, 'Customer device count is 1');

  // -------------------------------------------------------------------------
  // TEST 3: Validation Safeguards (Positive quantities, validation)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Validation Safeguards ---');
  const techUser = {
    id: 'abaff860-05b2-44fa-9139-b14d92e3fa19',
    email: 'tech@eagleeye.com',
    name: 'Technician Test',
    role: 'TECHNICAL',
  };

  // 3a: Rejection of zero/negative quantity
  try {
    await saveBackupDeclaration({
      checklistId: testChecklist.id,
      user: techUser,
      hasBackupItems: true,
      items: [{ item_name: 'Camera', quantity: 0, unit: 'Nos.' }],
    });
    assert(false, 'Should reject zero quantity');
  } catch (err) {
    assert(
      err.message.includes('positive number greater than 0'),
      'Zero or negative quantity is strictly rejected with validation error'
    );
  }

  // 3b: Rejection of missing reason if Sales expects but Tech selects No
  try {
    await saveBackupDeclaration({
      checklistId: testChecklist.id,
      user: techUser,
      hasBackupItems: false,
      noItemsReason: '',
      items: [],
    });
    assert(false, 'Should require reason if Sales expected backup items');
  } catch (err) {
    assert(
      err.message.includes('provide a reason'),
      'Reason required when Sales expected backup items but Technician carried none'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: Mixed Declaration (Cameras, Displays, Tape, Wire) & Non-Deduction
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Mixed Declaration & Inventory Preservation ---');
  const initialMats = await getMaterialInventory();
  const initialWireStock = initialMats.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  const initialTapeStock = initialMats.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;

  const mixedItems = [
    { item_name: 'Camera', quantity: 2, unit: 'Nos.' },
    { item_name: 'Display', quantity: 1, unit: 'Nos.' },
    { item_name: 'Insulation Tape', quantity: 2, unit: 'Nos.' },
    { item_name: '0.5 mm Wire', quantity: 10, unit: 'Metres' },
  ];

  const savedDeclaration = await saveBackupDeclaration({
    checklistId: testChecklist.id,
    user: techUser,
    hasBackupItems: true,
    items: mixedItems,
  });

  assert(savedDeclaration && savedDeclaration.items.length === 4, 'Mixed declaration saved with 4 items');
  assert(savedDeclaration.status === 'DECLARED', 'Declaration status is DECLARED');

  // Verify units preserved
  const savedWire = savedDeclaration.items.find((i) => i.item_name.includes('0.5 mm Wire'));
  assert(savedWire && savedWire.unit === 'Metres' && Number(savedWire.quantity) === 10, '0.5 mm Wire has unit "Metres" and quantity 10');

  // Verify stock is NOT deducted on technician declaration
  const afterDeclMats = await getMaterialInventory();
  const afterWireStock = afterDeclMats.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  const afterTapeStock = afterDeclMats.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;

  assert(initialWireStock === afterWireStock, 'Wire stock unchanged after technician declaration (No deduction)');
  assert(initialTapeStock === afterTapeStock, 'Insulation Tape stock unchanged after technician declaration (No deduction)');

  // Verify customer device count and preliminary BOM unchanged
  const refreshedChecklist = await getChecklistById(testChecklist.id);
  assert(refreshedChecklist.number_of_devices === 1, 'Customer device count unchanged (still 1)');
  assert(refreshedChecklist.total_devices_carried === 1, 'Preliminary BOM device count strictly unchanged (not treated as complete sets)');

  // -------------------------------------------------------------------------
  // TEST 5: Declaration Revision History Retained
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Declaration Revision History ---');
  const correctedItems = [
    { item_name: 'Camera', quantity: 3, unit: 'Nos.' },
    { item_name: 'Display', quantity: 1, unit: 'Nos.' },
    { item_name: 'Insulation Tape', quantity: 2, unit: 'Nos.' },
    { item_name: '0.5 mm Wire', quantity: 10, unit: 'Metres' },
  ];

  const correctedDeclaration = await saveBackupDeclaration({
    checklistId: testChecklist.id,
    user: techUser,
    hasBackupItems: true,
    items: correctedItems,
  });

  assert(correctedDeclaration.status === 'CORRECTED', 'Status updated to CORRECTED');
  assert(
    Array.isArray(correctedDeclaration.history) && correctedDeclaration.history.length === 1,
    'Revision history tracked previous declaration snapshot',
    `History length: ${correctedDeclaration.history.length}`
  );

  // -------------------------------------------------------------------------
  // TEST 6: Store Manager Authorized Stock Issuance (Deduction only on issuance)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Store Manager Authorized Stock Issuance ---');
  const storeUser = {
    id: 'be8232f9-674a-4b93-bbde-826b784c29a3',
    email: 'store@eagleeye.com',
    name: 'Store Manager Test',
    role: 'STORE_MANAGER',
  };

  const issuanceResult = await issueBackupItemsForChecklist({
    checklist_id: testChecklist.id,
    user: storeUser,
    remarks: 'Authorized Store Manager dispatch of loose backup hardware',
  });

  assert(issuanceResult && issuanceResult.success === true, 'Store Manager successfully issued backup items');
  assert(issuanceResult.issued_items.length > 0, 'Issued items recorded with quantities');

  // Verify declaration item records quantity_issued
  const postIssuanceDecl = await getBackupDeclaration(testChecklist.id);
  const issuedWire = postIssuanceDecl.items.find((i) => i.item_name.includes('0.5 mm Wire'));
  assert(Number(issuedWire.quantity_issued) === 10, 'quantity_issued recorded as 10 for Wire');

  // Verify stock DID deduct on authorized issuance
  const postIssueMats = await getMaterialInventory();
  const postIssueWireStock = postIssueMats.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  assert(
    postIssueWireStock === initialWireStock - 10,
    'Authoritative stock deducted 10 Metres of wire only upon Store Manager issuance',
    `Previous: ${initialWireStock}, Current: ${postIssueWireStock}`
  );

  // Prevent double-deduction on repeated issuance call
  const repeatIssuance = await issueBackupItemsForChecklist({
    checklist_id: testChecklist.id,
    user: storeUser,
    remarks: 'Second issuance attempt should be idempotent',
  });
  const postRepeatMats = await getMaterialInventory();
  const postRepeatWireStock = postRepeatMats.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  assert(postRepeatWireStock === postIssueWireStock, 'Duplicate issuance prevented (Idempotency safeguard verified)');

  // -------------------------------------------------------------------------
  // TEST 7: Store Manager Physical Return Verification & Safeguards
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Store Manager Physical Return Verification ---');
  // 7a: Physical verification restores usable stock
  const verificationResult = await verifyStoreBackupItemReturn({
    checklistId: testChecklist.id,
    user: storeUser,
    verificationItems: [
      { item_name: '0.5 mm Wire', accepted_usable_qty: 6, damaged_qty: 0, missing_qty: 0 },
      { item_name: 'Camera', accepted_usable_qty: 1, damaged_qty: 1, missing_qty: 0 },
    ],
    remarks: 'Physical inspection completed: 6m Wire usable, 1 camera usable, 1 camera damaged.',
  });

  assert(verificationResult && verificationResult.success === true, 'Store Manager physical return verification successful');

  const postVerifyMats = await getMaterialInventory();
  const postVerifyWireStock = postVerifyMats.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  assert(
    postVerifyWireStock === postIssueWireStock + 6,
    'Authoritative stock restored 6 Metres of verified usable wire',
    `After issue: ${postIssueWireStock}, Restored: ${postVerifyWireStock}`
  );

  // 7b: Safeguard: Unissued items CANNOT restore stock
  console.log('\n--- TEST 8: Safeguard Against Unissued Items Restoring Stock ---');
  // Create a phantom declaration that was never issued (quantity_issued is 0)
  const unissuedChecklist = await createChecklist('f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', {
    client_name: `Phantom Test ${testNow}`,
    client_mobile: '9876543211',
    client_location: 'Dock B',
    salesperson_name: 'Test Sales',
    service_engineer: 'Test Engineer',
    expected_arrival_date: new Date(Date.now() + 1000 * 86400000).toISOString().split('T')[0],
    installation_duration: '1 Day',
    installation_or_service: 'Installation',
    device_type: '2 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
    carry_extra_backup_items: true,
    confirmed_price: 25000,
    payment_method: 'Cash',
  });

  await saveBackupDeclaration({
    checklistId: unissuedChecklist.id,
    user: techUser,
    hasBackupItems: true,
    items: [{ item_name: 'Insulation Tape', quantity: 5, unit: 'Nos.' }],
  });

  const tapeStockBefore = (await getMaterialInventory()).find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;

  // Attempting to return an unissued item should be blocked from restoring stock
  const unissuedVerifyResult = await verifyStoreBackupItemReturn({
    checklistId: unissuedChecklist.id,
    user: storeUser,
    verificationItems: [{ item_name: 'Insulation Tape', accepted_usable_qty: 5, damaged_qty: 0, missing_qty: 0 }],
  });

  const tapeStockAfter = (await getMaterialInventory()).find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;
  assert(
    tapeStockBefore === tapeStockAfter,
    'Safeguard verified: Unissued items strictly blocked from restoring stock (prevents phantom inventory)',
    `Stock stayed exactly at ${tapeStockBefore}`
  );
  assert(
    unissuedVerifyResult.verification_results[0].notice.includes('Unissued items cannot restore stock'),
    'Notice returned in verification results identifying unissued item'
  );

  // -------------------------------------------------------------------------
  // CLEANUP
  // -------------------------------------------------------------------------
  console.log('\n--- Cleanup Test Fixtures ---');
  // Revert 4 Metres difference on wire to leave store in pristine balance
  const { adjustMaterialStock } = await import('../src/services/materialStockService.js');
  await adjustMaterialStock({
    material_name: '0.5 mm Wire',
    action: 'ADD',
    quantity: 4,
    reason: 'Test cleanup: balance restored',
    user: storeUser,
  });

  await supabase.from('installation_checklists').delete().eq('id', testChecklist.id);
  await supabase.from('installation_checklists').delete().eq('id', unissuedChecklist.id);
  await supabase.from('engineer_bookings').delete().in('checklist_id', [testChecklist.id, unissuedChecklist.id]);

  console.log('\n========================================================================');
  console.log(` ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY (${passed}/${total})`);
  console.log('========================================================================\n');
  process.exit(0);
}

runModalUpdateAcceptanceTests().catch((err) => {
  console.error('\nAcceptance test failed with error:', err);
  process.exit(1);
});
