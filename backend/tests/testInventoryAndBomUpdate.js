import {
  getMaterialInventory,
  setMaterialOpeningStock,
  adjustMaterialStock,
  issueMaterialsForChecklist,
  getMaterialTransactions,
  STANDARD_MATERIALS,
} from '../src/services/materialStockService.js';

import {
  getInventoryProducts,
  getInventorySummary,
  setDeviceOpeningStock,
  receiveNewStock,
  adjustStock,
  issueDevicesForChecklist,
  getInventoryTransactions,
  STANDARD_DEVICE_PRODUCTS,
} from '../src/services/inventoryService.js';

import {
  getAllBoms,
  getBomByDeviceType,
  calculateBomRequirements,
  updateDeviceBom,
  resetBomToTemplate,
  areUnitsCompatible,
  INITIAL_BOM_TEMPLATE,
} from '../src/services/bomService.js';

import {
  syncStoreRequirementForChecklist,
  getStoreMaterialRequirements,
  issueFullJobStock,
} from '../src/services/storeRequirementService.js';

async function runTests() {
  console.log('============================================================');
  console.log('🧪 Testing SafDrive Inventory and Installation BOM System');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // TEST 1: Material Inventory has exact 9 items with confirmed opening stock
  console.log('--- Test 1: Material Inventory & Opening Stock ---');
  const materials = await getMaterialInventory();
  assert(materials.length === 9, `Material inventory has 9 products (got ${materials.length})`);

  const expectedMaterials = [
    { name: 'Insulation Tape', stock: 100, unit: 'Nos.' },
    { name: 'Cable Tie – 200 mm', stock: 50, unit: 'Packets' },
    { name: 'Cable Tie – 300 mm', stock: 40, unit: 'Packets' },
    { name: 'Long Screw', stock: 500, unit: 'Nos.' },
    { name: 'Small Screw', stock: 500, unit: 'Nos.' },
    { name: 'Memory Card', stock: 100, unit: 'Nos.' },
    { name: '0.5 mm Wire', stock: 1000, unit: 'Metres' },
    { name: '5-metre Cable', stock: 150, unit: 'Nos.' },
    { name: '15-metre Cable', stock: 50, unit: 'Nos.' },
  ];

  for (const exp of expectedMaterials) {
    const found = materials.find((m) => m.material_name === exp.name);
    assert(found !== undefined, `Found material "${exp.name}"`);
    if (found) {
      assert(Number(found.current_stock) === exp.stock, `"${exp.name}" stock is ${exp.stock} ${exp.unit} (got ${found.current_stock})`);
      assert(found.unit === exp.unit, `"${exp.name}" unit is "${exp.unit}" (got "${found.unit}")`);
    }
  }

  // TEST 2: Camera Devices in Inventory
  console.log('\n--- Test 2: Camera Devices in Inventory ---');
  const devices = await getInventoryProducts();
  assert(devices.length === 7, `7 Camera device products created (got ${devices.length})`);

  const expectedDevices = [
    '2 Channel Live',
    '2 Channel Recording',
    '4 Channel Live',
    '4 Channel Recording',
    '6 Channel Live',
    '6 Channel Recording',
    '8 Channel Live',
  ];

  for (const expDev of expectedDevices) {
    const found = devices.find((d) => d.device_type === expDev);
    assert(found !== undefined, `Found device model "${expDev}"`);
    if (found) {
      assert(found.sku !== undefined && found.sku.length > 0, `"${expDev}" has SKU: ${found.sku}`);
      assert(found.unit === 'Nos.', `"${expDev}" unit is "Nos."`);
      // Initial opening quantity is NOT assumed
      assert(found.opening_stock_set !== undefined, `"${expDev}" has opening_stock_set tracking`);
    }
  }

  // TEST 3: Store Manager sets opening stock for a camera device
  console.log('\n--- Test 3: Set Camera Device Opening Stock ---');
  const openResult = await setDeviceOpeningStock({
    device_type: '2 Channel Live',
    opening_quantity: 25,
    reason: 'Verified physical inventory audit',
    user: { id: 'usr-store-1', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
  });
  assert(openResult.usable_stock === 25, '2 Channel Live usable stock updated to 25 Nos.');
  assert(openResult.opening_quantity === 25, '2 Channel Live opening quantity set to 25 Nos.');

  const devMovements = await getInventoryTransactions({ device_type: '2 Channel Live' });
  const openTx = devMovements.transactions.find((t) => t.transaction_type === 'OPENING_STOCK');
  assert(openTx !== undefined, 'Recorded OPENING_STOCK audit transaction');
  if (openTx) {
    assert(openTx.previous_balance !== undefined && openTx.new_balance === 25, 'Transaction tracked previous and new balance transition');
  }

  // TEST 4: Configurable BOM Calculation with multiple device types
  console.log('\n--- Test 4: BOM Calculation for Multiple Camera Devices ---');
  // Scenario: 2 Channel Live — 2 devices, 4 Channel Recording — 1 device (Total: 3 devices)
  const calcResult = await calculateBomRequirements([
    { device_type: '2 Channel Live', number_of_devices: 2 },
    { device_type: '4 Channel Recording', number_of_devices: 1 },
  ]);

  assert(calcResult.configured === true, 'BOM calculated successfully');
  assert(calcResult.total_devices === 3, `Total devices is 3 (got ${calcResult.total_devices})`);
  assert(calcResult.items.length === 9, `All 9 materials calculated (got ${calcResult.items.length})`);

  // Verify expected quantities for 3 devices:
  // Insulation Tape: 2 * 3 = 6
  // Cable Tie 200mm: 1 * 3 = 3
  // Cable Tie 300mm: 1 * 3 = 3
  // Long Screw: 12 * 3 = 36
  // Small Screw: 12 * 3 = 36
  // Memory Card: 1 * 3 = 3
  // 0.5 mm Wire: 20 * 3 = 60
  // 5m Cable: 3 * 3 = 9
  // 15m Cable: 1 * 3 = 3
  const expectedBomItems = {
    'Insulation Tape': 6,
    'Cable Tie – 200 mm': 3,
    'Cable Tie – 300 mm': 3,
    'Long Screw': 36,
    'Small Screw': 36,
    'Memory Card': 3,
    '0.5 mm Wire': 60,
    '5-metre Cable': 9,
    '15-metre Cable': 3,
  };

  for (const [matName, expectedQty] of Object.entries(expectedBomItems)) {
    const item = calcResult.items.find((i) => i.material_name === matName);
    assert(item !== undefined, `BOM includes "${matName}"`);
    if (item) {
      assert(item.total_quantity === expectedQty, `"${matName}" requires ${expectedQty} ${item.unit} (got ${item.total_quantity})`);
      assert(item.material_id !== undefined && item.material_id !== null, `"${matName}" has linked material_id: ${item.material_id}`);
    }
  }

  // TEST 5: Stock Availability & Separate Camera Device / Material Shortage Tracking
  console.log('\n--- Test 5: Stock Availability & Shortage Tracking ---');
  // Set 4 Channel Recording stock to 0 so it triggers device shortage
  await adjustStock({
    device_type: '4 Channel Recording',
    action: 'SET',
    quantity: 0,
    reason: 'Zero out for shortage test',
    user: { id: 'usr-store-1', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
  });

  const testChecklist = {
    id: `chk-test-${Date.now()}`,
    checklist_number: 'TEST-CHK-001',
    client_name: 'Acme Fleet Logistics',
    client_mobile: '9876543210',
    client_location: 'Mumbai Central',
    installation_or_service: 'Installation',
    device_configurations: [
      { device_type: '2 Channel Live', number_of_devices: 2 },
      { device_type: '4 Channel Recording', number_of_devices: 1 },
    ],
    bom_snapshot: calcResult,
  };

  const reqRecord = await syncStoreRequirementForChecklist(testChecklist);
  assert(reqRecord.job_type === 'Installation', 'Job type is Installation');
  assert(Array.isArray(reqRecord.device_items), 'Device items tracked separately');
  assert(Array.isArray(reqRecord.material_items), 'Material items tracked separately');

  const dev4Ch = reqRecord.device_items.find((d) => d.device_type === '4 Channel Recording');
  assert(dev4Ch !== undefined, 'Found 4 Channel Recording in device items');
  if (dev4Ch) {
    assert(dev4Ch.shortage === 1, `4 Channel Recording shortage flagged (got ${dev4Ch.shortage})`);
  }
  assert(reqRecord.has_shortage === true, 'Checklist has shortage flagged');

  // Verify that submitting the checklist DID NOT deduct stock automatically!
  const matAfterSync = await getMaterialInventory();
  const tapeAfterSync = matAfterSync.find((m) => m.material_name === 'Insulation Tape');
  assert(Number(tapeAfterSync.current_stock) === 100, 'Insulation Tape stock NOT deducted on checklist submission (still 100 Nos.)');

  // TEST 6: Atomic Issuance & Negative Stock Prevention
  console.log('\n--- Test 6: Atomic Issuance & Negative Stock Prevention ---');
  // Attempting to issue full job when 4 Channel Recording has shortage should throw Error and prevent deductions
  let issueErrorThrown = false;
  try {
    await issueFullJobStock({
      checklist_id: testChecklist.id,
      issue_devices: true,
      issue_materials: true,
      user: { id: 'usr-store-1', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
    });
  } catch (err) {
    issueErrorThrown = true;
    assert(err.message.includes('Insufficient') || err.message.includes('prevented'), `Negative stock error caught: "${err.message}"`);
  }
  assert(issueErrorThrown === true, 'Atomic issuance prevented when stock is insufficient');

  // Now replenish 4 Channel Recording and issue successfully
  await receiveNewStock({
    device_type: '4 Channel Recording',
    quantity: 10,
    remarks: 'Received fresh batch',
    user: { id: 'usr-store-1', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
  });

  // Re-sync requirement to update available stock
  await syncStoreRequirementForChecklist(testChecklist);

  const issueSuccess = await issueFullJobStock({
    checklist_id: testChecklist.id,
    issue_devices: true,
    issue_materials: true,
    remarks: 'Authorized store issuance',
    user: { id: 'usr-store-1', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
  });
  assert(issueSuccess.success === true, 'Job successfully issued after replenishment');

  // Check that stock was deducted accurately:
  // Insulation Tape was 100 - 6 = 94
  const matAfterIssue = await getMaterialInventory();
  const tapeAfterIssue = matAfterIssue.find((m) => m.material_name === 'Insulation Tape');
  assert(Number(tapeAfterIssue.current_stock) === 94, `Insulation Tape stock accurately deducted to 94 Nos. (got ${tapeAfterIssue.current_stock})`);

  // TEST 7: Service Jobs
  console.log('\n--- Test 7: Service Jobs Logic ---');
  const serviceChecklist = {
    id: `chk-srv-${Date.now()}`,
    checklist_number: 'TEST-SRV-001',
    client_name: 'Omega Logistics',
    client_mobile: '9123456789',
    client_location: 'Pune Station',
    installation_or_service: 'Service',
    device_type: '2 Channel Live',
    number_of_devices: 1,
  };

  const srvRecord = await syncStoreRequirementForChecklist(serviceChecklist);
  assert(srvRecord.job_type === 'Service', 'Service job recorded');
  assert(srvRecord.bom_snapshot === null, 'No BOM snapshot calculated for Service job');
  assert(srvRecord.material_items.length === 0, 'No material items automatically added for Service job');
  assert(srvRecord.material_issuance_status === 'NOT_APPLICABLE', 'Material issuance status is NOT_APPLICABLE');

  // TEST 8: Unit Compatibility Validation
  console.log('\n--- Test 8: Unit Compatibility & Lock ---');
  assert(areUnitsCompatible('Packets', 'Packet') === true, 'Packets <-> Packet are compatible');
  assert(areUnitsCompatible('Nos.', 'No.') === true, 'Nos. <-> No. are compatible');
  assert(areUnitsCompatible('Packets', 'Pieces') === false, 'Packets <-> Pieces are NOT compatible (cannot convert)');
  assert(areUnitsCompatible('Metres', 'Pieces') === false, 'Metres <-> Pieces are NOT compatible (cannot convert)');

  console.log('\n============================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
