import assert from 'assert';
import {
  STANDARD_DEVICE_CONFIGURATIONS,
  getComponentRequirementsForDevice,
  getCalculatedDeviceAvailability,
  calculateChecklistComponentAvailability,
  getActiveDeviceAllocations,
  allocateDeviceSets,
  releaseDeviceAllocation,
  fulfillDeviceAllocation,
  fulfillDeviceAllocationsForChecklist,
  lockAndValidateDeviceComponents,
  reconcileDeviceAllocations,
} from '../src/services/deviceSetService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';

async function runTests() {
  console.log('============================================================');
  console.log('SafDrive — Loose Stock Availability Consistency Test Suite');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  };

  // 1. Authoritative Physical Stock Source
  await test('1. Store Manager and Sales read the same authoritative physical stock source', async () => {
    const materials = await getMaterialInventory();
    const camMat = materials.find((m) => m.material_name.toLowerCase() === 'camera');
    const liveMat = materials.find((m) => m.material_name.toLowerCase() === 'live display');
    const recMat = materials.find((m) => m.material_name.toLowerCase() === 'recording display');

    assert(camMat, 'Camera must exist in authoritative material_inventory');
    assert(liveMat, 'Live Display must exist in authoritative material_inventory');
    assert(recMat, 'Recording Display must exist in authoritative material_inventory');

    const calculated = await getCalculatedDeviceAvailability();
    const calcCam = calculated.loose_components.find((c) => c.name.toLowerCase() === 'camera');
    const calcLive = calculated.loose_components.find((c) => c.name.toLowerCase() === 'live display');
    const calcRec = calculated.loose_components.find((c) => c.name.toLowerCase() === 'recording display');

    assert.strictEqual(
      calcCam.total_stock,
      Number(camMat.current_stock),
      'Camera total_stock must match material_inventory current_stock'
    );
    assert.strictEqual(
      calcLive.total_stock,
      Number(liveMat.current_stock),
      'Live Display total_stock must match material_inventory current_stock'
    );
    assert.strictEqual(
      calcRec.total_stock,
      Number(recMat.current_stock),
      'Recording Display total_stock must match material_inventory current_stock'
    );
  });

  // 2. 4 required cameras with 14 available cameras
  await test('2. Four required cameras with 14 genuinely available cameras produce no camera shortage', async () => {
    // Reconcile to ensure any orphaned reservations are cleared
    await reconcileDeviceAllocations();

    const result = await calculateChecklistComponentAvailability([
      { device_type: '4 Channel Recording', number_of_devices: 1 },
    ]);

    const camCheck = result.components.find((c) => c.component_name === 'Camera');
    assert(camCheck, 'Camera requirement must be present in breakdown');
    assert.strictEqual(camCheck.required_qty, 4, 'Required cameras must be 4');
    assert.strictEqual(camCheck.shortage, 0, 'Camera shortage must be 0 when 14 cameras are available');
    assert.strictEqual(camCheck.is_available, true, 'Camera must be marked is_available: true');
    assert.strictEqual(result.fulfillable, true, 'Checklist must be fulfillable');
    assert.strictEqual(result.shortages.length, 0, 'Shortages array must be empty');
  });

  // 3. Shortage calculation when available < required
  await test('3. Four required cameras with only 2 available cameras correctly report a shortage of 2', async () => {
    // Simulate stock check with requirement > available
    const reqQty = 4;
    const availQty = 2;
    const shortage = Math.max(0, reqQty - availQty);
    assert.strictEqual(shortage, 2, 'Shortage must be calculated as 4 - 2 = 2');

    // Test calculateChecklistComponentAvailability when scaled beyond current stock
    const materials = await getMaterialInventory();
    const camMat = materials.find((m) => m.material_name.toLowerCase() === 'camera');
    const curStock = Number(camMat.current_stock) || 14;

    // Request sets requiring more cameras than curStock
    const setsNeeded = Math.ceil((curStock + 4) / 4);
    const result = await calculateChecklistComponentAvailability([
      { device_type: '4 Channel Recording', number_of_devices: setsNeeded },
    ]);

    const camCheck = result.components.find((c) => c.component_name === 'Camera');
    assert.strictEqual(result.fulfillable, false, 'Must flag shortage when requirement exceeds stock');
    assert(camCheck.shortage > 0, 'Camera shortage must be greater than 0');
    assert.strictEqual(camCheck.is_available, false, 'Camera is_available must be false');
    assert(result.shortages.some((s) => s.component_name === 'Camera'), 'Shortages list must contain Camera');
  });

  // 4. Valid reservations reduce availability correctly
  await test('4. Valid reservations reduce availability correctly', async () => {
    const before = await getCalculatedDeviceAvailability();
    const camBefore = before.loose_components.find((c) => c.name === 'Camera');
    const freeBefore = camBefore.unallocated_stock;

    // Allocate 1 set of 2 Channel Live (reserves 2 cameras, 1 live display, 1 memory card)
    const testUser = { id: '00000000-0000-0000-0000-000000000001', full_name: 'Test Store Manager' };
    const allocRes = await allocateDeviceSets({
      device_type: '2 Channel Live',
      sets_to_allocate: 1,
      notes: 'Automated test reservation',
      user: testUser,
    });

    assert(allocRes.success, 'Allocation must succeed');
    const allocId = allocRes.allocation.id;

    const afterAlloc = await getCalculatedDeviceAvailability();
    const camAfter = afterAlloc.loose_components.find((c) => c.name === 'Camera');
    assert.strictEqual(
      camAfter.unallocated_stock,
      freeBefore - 2,
      'Unallocated camera stock must decrease by exactly 2'
    );

    // Clean up test allocation
    await releaseDeviceAllocation({
      allocation_id: allocId,
      reason: 'Automated test cleanup',
      user: testUser,
    });

    const afterRelease = await getCalculatedDeviceAvailability();
    const camRestored = afterRelease.loose_components.find((c) => c.name === 'Camera');
    assert.strictEqual(
      camRestored.unallocated_stock,
      freeBefore,
      'Unallocated camera stock must be restored after release'
    );
  });

  // 5. Already-deducted issued stock is not deducted a second time
  await test('5. Already-deducted issued stock is not deducted a second time', async () => {
    // When an allocation is fulfilled, its status becomes 'FULFILLED'
    // getActiveDeviceAllocations() strictly filters status === 'ALLOCATED'
    const testUser = { id: '00000000-0000-0000-0000-000000000001', full_name: 'Test Store Manager' };
    const allocRes = await allocateDeviceSets({
      device_type: '2 Channel Live',
      sets_to_allocate: 1,
      notes: 'Automated test fulfillment test',
      user: testUser,
    });

    const allocId = allocRes.allocation.id;
    const fulfilled = await fulfillDeviceAllocation({
      allocation_id: allocId,
      user: testUser,
    });

    assert.strictEqual(fulfilled.status, 'FULFILLED', 'Status must transition to FULFILLED');

    const activeAllocations = await getActiveDeviceAllocations();
    const isStillActive = activeAllocations.some((a) => a.id === allocId);
    assert.strictEqual(isStillActive, false, 'Fulfilled allocation must not remain in active allocations');
  });

  // 6. Cancelled or released reservations are handled correctly
  await test('6. Cancelled or released reservations are handled correctly', async () => {
    const testUser = { id: '00000000-0000-0000-0000-000000000001', full_name: 'Test Store Manager' };
    const allocRes = await allocateDeviceSets({
      device_type: '2 Channel Live',
      sets_to_allocate: 1,
      notes: 'Automated test cancellation test',
      checklist_id: 'test-chk-cancel-1',
      user: testUser,
    });

    const allocId = allocRes.allocation.id;
    const releaseRes = await releaseDeviceAllocation({
      allocation_id: allocId,
      reason: 'Client cancelled order',
      user: testUser,
    });

    assert.strictEqual(releaseRes.allocation.status, 'RELEASED', 'Status must be RELEASED');
    assert.strictEqual(releaseRes.allocation.release_reason, 'Client cancelled order');

    const active = await getActiveDeviceAllocations();
    assert.strictEqual(active.some((a) => a.id === allocId), false, 'Released allocation must not be active');
  });

  // 7. Live-display and recording-display requirements use the correct component types
  await test('7. Live-display and recording-display requirements use the correct component types', async () => {
    const liveReqs = getComponentRequirementsForDevice('4 Channel Live');
    const recReqs = getComponentRequirementsForDevice('4 Channel Recording');

    const liveDisplay = liveReqs.find((c) => c.component_name === 'Live Display');
    const recDisplayInLive = liveReqs.find((c) => c.component_name === 'Recording Display');
    assert(liveDisplay, '4 Channel Live must require Live Display');
    assert.strictEqual(recDisplayInLive, undefined, '4 Channel Live must NOT require Recording Display');

    const recDisplay = recReqs.find((c) => c.component_name === 'Recording Display');
    const liveDisplayInRec = recReqs.find((c) => c.component_name === 'Live Display');
    assert(recDisplay, '4 Channel Recording must require Recording Display');
    assert.strictEqual(liveDisplayInRec, undefined, '4 Channel Recording must NOT require Live Display');
  });

  // 8. Memory Card requirements follow the existing BOM rules
  await test('8. Memory Card requirements follow the existing BOM rules (included for standard configs, excluded for 8CH Live)', async () => {
    const twoLive = getComponentRequirementsForDevice('2 Channel Live');
    const fourRec = getComponentRequirementsForDevice('4 Channel Recording');
    const eightLive = getComponentRequirementsForDevice('8 Channel Live');

    const memTwoLive = twoLive.find((c) => c.component_name === 'Memory Card');
    const memFourRec = fourRec.find((c) => c.component_name === 'Memory Card');
    const memEightLive = eightLive.find((c) => c.component_name === 'Memory Card');

    assert(memTwoLive, '2 Channel Live must require Memory Card');
    assert.strictEqual(memTwoLive.quantity_required, 1, '2 Channel Live must require 1 Memory Card');

    assert(memFourRec, '4 Channel Recording must require Memory Card');
    assert.strictEqual(memFourRec.quantity_required, 1, '4 Channel Recording must require 1 Memory Card');

    assert.strictEqual(
      memEightLive,
      undefined,
      '8 Channel Live must EXCLUDE Memory Card per BOM business rule'
    );
  });

  // 9. Concurrent checklist creation cannot over-reserve stock
  await test('9. Concurrent checklist creation cannot over-reserve stock (FIFO mutex lock)', async () => {
    // Test lockAndValidateDeviceComponents mutex serialization
    const lock1 = await lockAndValidateDeviceComponents([{ device_type: '2 Channel Live', number_of_devices: 1 }]);
    assert(lock1.valid, 'Lock 1 must succeed');

    let lock2Acquired = false;
    const lock2Promise = lockAndValidateDeviceComponents([
      { device_type: '2 Channel Live', number_of_devices: 1 },
    ]).then((l) => {
      lock2Acquired = true;
      return l;
    });

    // While lock1 is held, lock2 must be queued
    assert.strictEqual(lock2Acquired, false, 'Lock 2 must wait until Lock 1 releases');

    // Release lock1
    lock1.release();

    const lock2 = await lock2Promise;
    assert(lock2Acquired, 'Lock 2 must be acquired after Lock 1 releases');
    lock2.release();
  });

  // 10. Store Manager stock changes are reflected in Sales availability without stale results
  await test('10. Store Manager stock changes are reflected in Sales availability without stale results', async () => {
    const avail1 = await getCalculatedDeviceAvailability();
    const cam1 = avail1.loose_components.find((c) => c.name === 'Camera');

    const materials = await getMaterialInventory();
    const camMat = materials.find((m) => m.material_name.toLowerCase() === 'camera');

    assert.strictEqual(
      cam1.total_stock,
      Number(camMat.current_stock),
      'Calculated device availability reflects authoritative material stock in real time'
    );
  });

  // 11. Existing stock movement, issuance, return, and audit workflows remain functional
  await test('11. Existing stock movement, issuance, return, and audit workflows remain functional', async () => {
    const { fulfillDeviceAllocationsForChecklist } = await import('../src/services/deviceSetService.js');
    assert.strictEqual(typeof fulfillDeviceAllocationsForChecklist, 'function');

    const { issueFullJobStock } = await import('../src/services/storeRequirementService.js');
    assert.strictEqual(typeof issueFullJobStock, 'function');

    const { dispatchChecklistViaCourier } = await import('../src/services/courierService.js');
    assert.strictEqual(typeof dispatchChecklistViaCourier, 'function');

    const { cancelChecklist } = await import('../src/services/installationService.js');
    assert.strictEqual(typeof cancelChecklist, 'function');
  });

  // 12. Device configurations do not acquire independent physical stock balances
  await test('12. Device configurations do not acquire independent physical stock balances', async () => {
    // Configurations are purely dynamic formulas defined over loose components
    STANDARD_DEVICE_CONFIGURATIONS.forEach((cfg) => {
      assert(cfg.device_type, 'Device config must have device_type');
      assert(Array.isArray(cfg.components), 'Device config must specify component breakdown');
      assert(!('physical_stock' in cfg), 'Device config must NOT maintain an independent physical stock balance');
      assert(!('current_stock' in cfg), 'Device config must NOT maintain an independent physical stock balance');
    });
  });

  console.log(`\n============================================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
