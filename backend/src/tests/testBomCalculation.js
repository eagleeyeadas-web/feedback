import {
  calculateBomRequirements,
  getAllBoms,
  getBomByDeviceType,
  updateDeviceBom,
  resetBomToTemplate,
  STANDARD_DEVICE_TYPES,
  INITIAL_BOM_TEMPLATE,
} from '../services/bomService.js';

import {
  getMaterialInventory,
  adjustMaterialStock,
  issueMaterialsForChecklist,
  getMaterialTransactions,
} from '../services/materialStockService.js';

async function runTests() {
  console.log('--- STARTING BOM SYSTEM VERIFICATION TESTS ---');

  // Test 1: Verify all 7 standard device types are present
  console.log('\n[Test 1] Verify all 7 standard device types are initialized');
  const allBoms = await getAllBoms();
  console.log(`Total BOM configurations found: ${allBoms.length}`);
  if (allBoms.length !== 7) {
    throw new Error(`Expected 7 device BOMs, found ${allBoms.length}`);
  }
  for (const type of STANDARD_DEVICE_TYPES) {
    const bom = allBoms.find((b) => b.device_type === type);
    if (!bom || !bom.is_configured) {
      throw new Error(`Device type "${type}" should be configured`);
    }
    if (bom.items.length !== 9) {
      throw new Error(`Device type "${type}" should have 9 materials, found ${bom.items.length}`);
    }
  }
  console.log('✓ Test 1 Passed: All 7 standard device types configured with 9 materials.');

  // Test 2: Live BOM calculation for 5 devices of '2 Channel Live'
  console.log('\n[Test 2] Test Live BOM calculation formula (Configured Qty * Number of Devices)');
  const calc5 = await calculateBomRequirements('2 Channel Live', 5);
  if (!calc5.configured) {
    throw new Error('Expected calculation to be configured');
  }
  if (calc5.number_of_devices !== 5) {
    throw new Error(`Expected number_of_devices 5, got ${calc5.number_of_devices}`);
  }

  const expectedValues = {
    'Insulation Tape': { perDevice: 2, total: 10, unit: 'Nos.' },
    'Cable Tie – 200 mm': { perDevice: 1, total: 5, unit: 'Packet' },
    'Cable Tie – 300 mm': { perDevice: 1, total: 5, unit: 'Packet' },
    'Screw (Long)': { perDevice: 12, total: 60, unit: 'Nos.' },
    'Screw (Small)': { perDevice: 12, total: 60, unit: 'Nos.' },
    'Memory Card': { perDevice: 1, total: 5, unit: 'No.' },
    '0.5 mm wire': { perDevice: 20, total: 100, unit: 'Metres' },
    '5-metre Cable': { perDevice: 3, total: 15, unit: 'Nos.' },
    '15-metre Cable': { perDevice: 1, total: 5, unit: 'No.' },
  };

  for (const item of calc5.items) {
    const expected = expectedValues[item.material_name];
    if (!expected) {
      throw new Error(`Unexpected material "${item.material_name}"`);
    }
    if (item.quantity_per_device !== expected.perDevice) {
      throw new Error(`Expected ${expected.perDevice} per device for ${item.material_name}, got ${item.quantity_per_device}`);
    }
    if (item.total_quantity !== expected.total) {
      throw new Error(`Expected total ${expected.total} for ${item.material_name}, got ${item.total_quantity}`);
    }
    if (item.unit !== expected.unit) {
      throw new Error(`Expected unit ${expected.unit} for ${item.material_name}, got ${item.unit}`);
    }
  }
  console.log('✓ Test 2 Passed: Exactly matches configured formula for all 9 items.');

  // Test 3: Validation: zero, negative, invalid device quantities
  console.log('\n[Test 3] Validate invalid device quantities (0, -3, NaN)');
  const calcZero = await calculateBomRequirements('2 Channel Live', 0);
  if (calcZero.configured) throw new Error('0 quantity should not be configured');

  const calcNeg = await calculateBomRequirements('2 Channel Live', -5);
  if (calcNeg.configured) throw new Error('Negative quantity should not be configured');

  const calcInvalid = await calculateBomRequirements('2 Channel Live', 'abc');
  if (calcInvalid.configured) throw new Error('Invalid string quantity should not be configured');
  console.log('✓ Test 3 Passed: Non-positive or invalid quantities cleanly rejected with warnings.');

  // Test 4: Unconfigured device type
  console.log('\n[Test 4] Unconfigured device type handling');
  const calcUnconf = await calculateBomRequirements('16 Channel Experimental System', 3);
  if (calcUnconf.configured) throw new Error('Unconfigured device should not be configured');
  if (!calcUnconf.warning || !calcUnconf.warning.includes('No Bill of Materials (BOM) is configured')) {
    throw new Error('Should display clear warning for unconfigured device type');
  }
  console.log('✓ Test 4 Passed: Unconfigured device type returns clear warning instead of pretending requirement is 0.');

  // Test 5: Store Manager updates BOM configuration and increments version
  console.log('\n[Test 5] Store Manager BOM edit & version increment');
  const testUser = { id: 'usr-store-01', email: 'store@gmail.com', role: 'STORE_MANAGER' };
  const customItems = [
    { material_name: 'Insulation Tape', quantity_per_device: 3, unit: 'Nos.', sort_order: 1 },
    { material_name: 'Heavy Duty Cable Tie', quantity_per_device: 2, unit: 'Packet', sort_order: 2 },
  ];

  const updatedBom = await updateDeviceBom('4 Channel Live', {
    items: customItems,
    notes: 'Updated for heavy fleet installation requirements',
    user: testUser,
  });

  if (updatedBom.version !== 2) {
    throw new Error(`Expected version to increment to 2, got ${updatedBom.version}`);
  }
  if (updatedBom.items.length !== 2) {
    throw new Error(`Expected 2 items, got ${updatedBom.items.length}`);
  }

  // Verify calculation reflects new version
  const calcNew = await calculateBomRequirements('4 Channel Live', 2);
  if (calcNew.bom_version !== 2) {
    throw new Error(`Expected calc to use version 2, got ${calcNew.bom_version}`);
  }
  const tapeItem = calcNew.items.find((i) => i.material_name === 'Insulation Tape');
  if (tapeItem.total_quantity !== 6) { // 3 * 2 = 6
    throw new Error(`Expected 6 units of Insulation Tape, got ${tapeItem.total_quantity}`);
  }
  console.log('✓ Test 5 Passed: Version incremented to v2 and live calculations immediately reflect update.');

  // Test 6: Reset to default template
  console.log('\n[Test 6] Reset BOM to standard template');
  const resetBom = await resetBomToTemplate('4 Channel Live', testUser);
  if (resetBom.items.length !== 9) {
    throw new Error(`Expected 9 items after reset, got ${resetBom.items.length}`);
  }
  console.log('✓ Test 6 Passed: Reset to standard template successful.');

  // Test 7: Material Inventory & Atomic Stock Issuance with negative stock prevention
  console.log('\n[Test 7] Material Inventory & Atomic Stock Issuance');
  const initialMats = await getMaterialInventory();
  console.log(`Found ${initialMats.length} materials in inventory.`);

  // Attempt to issue with excessive requirement (exceeding stock)
  let deficitBlocked = false;
  try {
    await issueMaterialsForChecklist({
      checklist_id: 'chk-test-deficit-01',
      items: [{ material_name: 'Insulation Tape', total_quantity: 99999, unit: 'Nos.' }],
      remarks: 'Should fail due to shortage',
      user: testUser,
    });
  } catch (err) {
    deficitBlocked = true;
    if (!err.message.includes('Insufficient stock')) {
      throw new Error(`Expected Insufficient stock error, got: ${err.message}`);
    }
  }

  if (!deficitBlocked) {
    throw new Error('Issuance exceeding available stock should have been blocked');
  }
  console.log('✓ Test 7.1 Passed: Negative stock strictly prevented.');

  // Successful atomic issuance
  const validIssuance = await issueMaterialsForChecklist({
    checklist_id: 'chk-test-success-01',
    items: [
      { material_name: 'Insulation Tape', total_quantity: 4, unit: 'Nos.' },
      { material_name: '5-metre Cable', total_quantity: 2, unit: 'Nos.' },
    ],
    remarks: 'Authorized store dispatch test',
    user: testUser,
  });

  if (!validIssuance.success || validIssuance.material_issuance_status !== 'ISSUED') {
    throw new Error('Valid issuance failed');
  }
  console.log('✓ Test 7.2 Passed: Atomic deduction executed and status set to ISSUED.');

  // Test 8: Prevent duplicate deductions
  let duplicateBlocked = false;
  try {
    await issueMaterialsForChecklist({
      checklist_id: 'chk-test-success-01',
      items: [{ material_name: 'Insulation Tape', total_quantity: 1, unit: 'Nos.' }],
      remarks: 'Should fail duplicate check',
      user: testUser,
    });
  } catch (err) {
    duplicateBlocked = true;
    if (!err.message.includes('already been issued')) {
      throw new Error(`Expected duplicate issuance error, got: ${err.message}`);
    }
  }

  if (!duplicateBlocked) {
    throw new Error('Duplicate issuance for same checklist was not blocked');
  }
  console.log('✓ Test 8 Passed: Duplicate stock issuance for same checklist blocked.');

  console.log('\n======================================================');
  console.log('🎉 ALL 8 BOM & MATERIAL VERIFICATION TESTS PASSED!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
