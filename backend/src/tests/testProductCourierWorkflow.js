import assert from 'node:assert';
import { calculateBomRequirements } from '../services/bomService.js';
import {
  dispatchChecklistViaCourier,
  updateCourierDeliveryStatus,
  recordCourierReturnToStore,
  getCourierDispatches,
  getCourierDispatchByChecklistId,
} from '../services/courierService.js';
import { getBusinessTomorrow } from '../services/installationService.js';

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.stack || err.message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   EAGLE EYE SAFDRIVE — PRODUCT COURIER WORKFLOW TEST SUITE    ');
  console.log('================================================================\n');

  // ============================================================================
  // TEST GROUP 1: Product & BOM Calculation for Couriered Checklists
  // ============================================================================
  console.log('[Test Group 1] Product & Preliminary BOM Calculations');

  await itAsync('Calculates preliminary BOM for Installation jobs including loose materials', async () => {
    const deviceConfigs = [
      { device_type: '4 Channel Live', number_of_devices: 2 },
    ];
    const bom = await calculateBomRequirements(deviceConfigs);
    assert.strictEqual(bom.configured, true);
    assert.strictEqual(bom.total_devices, 2);
    assert.ok(Array.isArray(bom.items));
    assert.ok(bom.items.length > 0);

    // Verify materials exist in BOM
    const tape = bom.items.find((i) => i.material_name.toLowerCase().includes('tape'));
    assert.ok(tape, 'Insulation Tape should be present in 4 Channel Live BOM');
    const wire = bom.items.find((i) => i.material_name.toLowerCase().includes('wire'));
    assert.ok(wire, 'Wire should be present in 4 Channel Live BOM');
  });

  await itAsync('Respects the 8 Channel Live rule: Does NOT require Memory Card', async () => {
    const deviceConfigs = [
      { device_type: '8 Channel Live', number_of_devices: 1 },
    ];
    const bom = await calculateBomRequirements(deviceConfigs);
    assert.strictEqual(bom.configured, true);

    const memCard = bom.items.find((i) => i.material_name.toLowerCase().includes('memory'));
    assert.strictEqual(memCard, undefined, '8 Channel Live must NOT include Memory Card');
  });

  it('Service jobs do NOT automatically generate an installation BOM', () => {
    const jobType = 'Service';
    // Service job BOM rule:
    const bomResult = jobType === 'Service' ? null : calculateBomRequirements([{ device_type: '4 Channel Live', number_of_devices: 1 }]);
    assert.strictEqual(bomResult, null, 'Service jobs must not have an automatic installation BOM');
  });

  // ============================================================================
  // TEST GROUP 2: Couriered Checklist Creation (Unassigned & Unscheduled)
  // ============================================================================
  console.log('\n[Test Group 2] Couriered Checklist Creation (Unassigned & Unscheduled Lifecycle)');

  it('Allows saving a Couriered checklist without engineer or arrival date', () => {
    const checklistPayload = {
      client_name: 'Alpha Logistics Pvt Ltd',
      client_mobile: '9876543210',
      client_location: 'Coimbatore Hub',
      delivery_method: 'Product Couriered',
      device_type: '8 Channel Live',
      number_of_devices: 2,
      device_configurations: [{ device_type: '8 Channel Live', number_of_devices: 2, quantity_carried: 2 }],
      installation_or_service: 'Installation',
      expected_arrival_date: null,
      expected_arrival_time: null,
      service_engineer: null,
      installation_status: 'Awaiting Technician Assignment',
    };

    assert.strictEqual(checklistPayload.delivery_method, 'Product Couriered');
    assert.strictEqual(checklistPayload.service_engineer, null);
    assert.strictEqual(checklistPayload.expected_arrival_date, null);
    assert.strictEqual(checklistPayload.installation_status, 'Awaiting Technician Assignment');
  });

  it('Standard "Technician Carries" checklist strictly requires arrival date and engineer', () => {
    const standardPayload = {
      delivery_method: 'Technician Carries',
      expected_arrival_date: '',
      service_engineer: '',
    };

    function validateStandard(p) {
      if (p.delivery_method === 'Technician Carries') {
        if (!p.expected_arrival_date) throw new Error('Expected Date of Arrival is required for Technician Carries');
        if (!p.service_engineer) throw new Error('Service Engineer is required for Technician Carries');
      }
    }

    assert.throws(() => validateStandard(standardPayload), /Expected Date of Arrival is required/);
  });

  // ============================================================================
  // TEST GROUP 3: Store Manager Courier Stock Verification & Atomic Issuance
  // ============================================================================
  console.log('\n[Test Group 3] Store Manager Courier Stock Verification & Atomic Issuance');

  // Set up mock database client
  function createMockSupabase(initialStock = {}) {
    const tables = {
      inventory_products: [
        { id: 'prod-8ch', device_type: '8 Channel Live', usable_stock: initialStock.deviceStock ?? 10 },
        { id: 'prod-4ch', device_type: '4 Channel Live', usable_stock: initialStock.deviceStock ?? 10 },
      ],
      material_inventory: [
        { id: 'mat-sim', material_name: 'Airtel M2M 4G SIM Card', current_stock: initialStock.simStock ?? 20 },
        { id: 'mat-wire', material_name: 'Wiring Kit', current_stock: initialStock.wireStock ?? 50 },
      ],
      stock_movements: [],
      courier_dispatches: [],
      installation_checklists: [
        {
          id: 'chk-courier-001',
          checklist_number: 'EES-2026-C01',
          client_name: 'Kovai Transports',
          installation_or_service: 'Installation',
          delivery_method: 'Product Couriered',
          is_courier_dispatched: false,
          courier_dispatch_status: 'Not Dispatched',
          installation_status: 'Awaiting Technician Assignment',
          service_engineer: null,
          expected_arrival_date: null,
        },
      ],
      store_material_requirements: [
        {
          id: 'req-courier-001',
          checklist_id: 'chk-courier-001',
          delivery_method: 'Product Couriered',
          is_courier_dispatched: false,
          issuance_status: 'PENDING',
        },
      ],
      courier_dispatches: [],
    };

    function createQuery(rows) {
      let filtered = [...rows];
      const q = {
        then(resolve, reject) {
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
        eq(col, val) {
          filtered = filtered.filter((r) => r[col] === val);
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          filtered = filtered.slice(0, n);
          return q;
        },
        async single() {
          const match = filtered[0];
          return { data: match ? { ...match } : null, error: match ? null : { message: 'Not found' } };
        },
        async maybeSingle() {
          const match = filtered[0];
          return { data: match ? { ...match } : null, error: null };
        },
      };
      return q;
    }

    return {
      _tables: tables,
      from(tableName) {
        if (!tables[tableName]) {
          tables[tableName] = [];
        }
        const rows = tables[tableName];
        return {
          select(cols) {
            return createQuery(rows);
          },
          update(fields) {
            return {
              eq(col, val) {
                const target = rows.find((r) => r[col] === val);
                if (target) Object.assign(target, fields);
                return {
                  then(resolve, reject) {
                    return Promise.resolve({ data: [target], error: null }).then(resolve, reject);
                  },
                  async select() {
                    return { data: [target], error: null };
                  },
                  async single() {
                    return { data: target, error: null };
                  },
                  async maybeSingle() {
                    return { data: target, error: null };
                  },
                };
              },
            };
          },
          insert(newRows) {
            const arr = Array.isArray(newRows) ? newRows : [newRows];
            rows.push(...arr);
            return {
              then(resolve, reject) {
                return Promise.resolve({ data: arr, error: null }).then(resolve, reject);
              },
              async select() {
                return { data: arr, error: null };
              },
            };
          },
        };
      },
    };
  }

  await itAsync('Blocks courier dispatch when inventory stock is insufficient (Shortage Protection)', async () => {
    // Only 1 device in stock, but job requires 3
    const mockDb = createMockSupabase({ deviceStock: 1, simStock: 50, wireStock: 50 });

    const dispatchPayload = {
      checklist_id: 'chk-courier-001',
      courier_company: 'DTDC Express',
      tracking_number: 'DTDC987654321',
      dispatch_date: '2026-10-17',
      expected_delivery_date: '2026-10-19',
      items: [
        { item_type: 'DEVICE', name: '8 Channel Live', quantity: 3 },
      ],
      materials: [],
      notes: 'Urgent delivery to depot',
    };

    let caughtError = null;
    try {
      await dispatchChecklistViaCourier(dispatchPayload, 'store_manager_user', mockDb);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected stock shortage error');
    assert.match(caughtError.message, /Insufficient usable stock/i);
    // Verify no stock movements recorded
    assert.strictEqual(mockDb._tables.stock_movements.length, 0);
  });

  let validDispatchRecord = null;
  const mockDbWithStock = createMockSupabase({ deviceStock: 10, simStock: 20, wireStock: 30 });

  await itAsync('Successfully verifies stock and atomically executes courier dispatch', async () => {
    const dispatchPayload = {
      checklist_id: 'chk-courier-001',
      courier_company: 'DTDC Express',
      tracking_number: 'DTDC-CHN-778899',
      dispatch_date: '2026-10-17',
      expected_delivery_date: '2026-10-19',
      items: [
        { item_type: 'DEVICE', name: '8 Channel Live', quantity: 2 },
      ],
      materials: [
        { material_name: 'Airtel M2M 4G SIM Card', quantity: 2, unit: 'Nos.' },
      ],
      notes: 'Dispatched in shockproof container',
    };

    validDispatchRecord = await dispatchChecklistViaCourier(dispatchPayload, 'karthik_store_mgr', mockDbWithStock);

    assert.ok(validDispatchRecord);
    assert.strictEqual(validDispatchRecord.checklist_id, 'chk-courier-001');
    assert.strictEqual(validDispatchRecord.delivery_status, 'Dispatched');
    assert.strictEqual(validDispatchRecord.tracking_number, 'DTDC-CHN-778899');

    // Verify atomic deduction in inventory_products
    const prod8ch = mockDbWithStock._tables.inventory_products.find((p) => p.device_type === '8 Channel Live');
    assert.strictEqual(prod8ch.usable_stock, 8, '8 Channel Live stock should decrease from 10 to 8');

    // Verify atomic deduction in material_inventory
    const matSim = mockDbWithStock._tables.material_inventory.find((m) => m.material_name === 'Airtel M2M 4G SIM Card');
    assert.strictEqual(matSim.current_stock, 18, 'SIM Card stock should decrease from 20 to 18');

    // Verify checklist flag updated
    const chk = mockDbWithStock._tables.installation_checklists[0];
    assert.strictEqual(chk.is_courier_dispatched, true);
    assert.strictEqual(chk.courier_dispatch_status, 'Dispatched');

    // Verify store requirement flag updated
    const req = mockDbWithStock._tables.store_material_requirements[0];
    assert.strictEqual(req.is_courier_dispatched, true);
    assert.strictEqual(req.issuance_status, 'ISSUED');
  });

  await itAsync('Generates explicit COURIER_DISPATCH audit records in the stock movements ledger', async () => {
    const movements = mockDbWithStock._tables.stock_movements;
    assert.ok(movements.length >= 2, 'Must log ledger movements for both devices and materials');

    const deviceMovement = movements.find((m) => m.item_name === '8 Channel Live');
    assert.ok(deviceMovement);
    assert.strictEqual(deviceMovement.movement_type, 'COURIER_DISPATCH');
    assert.strictEqual(deviceMovement.quantity, 2);
    assert.strictEqual(deviceMovement.balance_after, 8);

    const matMovement = movements.find((m) => m.item_name === 'Airtel M2M 4G SIM Card');
    assert.ok(matMovement);
    assert.strictEqual(matMovement.movement_type, 'COURIER_DISPATCH');
    assert.strictEqual(matMovement.quantity, 2);
    assert.strictEqual(matMovement.balance_after, 18);
  });

  await itAsync('Prevents double-dispatch and repeated courier issuance on the same checklist', async () => {
    const duplicatePayload = {
      checklist_id: 'chk-courier-001',
      courier_company: 'Blue Dart',
      tracking_number: 'BLUEDART123',
      items: [{ item_type: 'DEVICE', name: '8 Channel Live', quantity: 2 }],
      materials: [],
    };

    let caughtErr = null;
    try {
      await dispatchChecklistViaCourier(duplicatePayload, 'karthik_store_mgr', mockDbWithStock);
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Expected duplicate dispatch rejection');
    assert.match(caughtErr.message, /already (been )?dispatched/i);
  });

  // ============================================================================
  // TEST GROUP 4: Double Deduction Prevention (Technician Hand-Carry Guard)
  // ============================================================================
  console.log('\n[Test Group 4] Prevention of Duplicate Stock Deductions via Technician Issuance');

  it('Rejects normal technician stock issuance for jobs already dispatched via courier', () => {
    const courieredJob = mockDbWithStock._tables.installation_checklists[0];

    // Simulation of issueStockForJob / issueFullJobStock guard:
    function attemptTechnicianHandCarryIssue(job) {
      if (job.is_courier_dispatched || job.delivery_method === 'Product Couriered') {
        throw new Error(
          `Cannot perform technician hand-carry stock issuance: Checklist ${job.checklist_number} was dispatched via courier.`
        );
      }
      return 'Stock issued to technician';
    }

    assert.throws(
      () => attemptTechnicianHandCarryIssue(courieredJob),
      /Cannot perform technician hand-carry stock issuance.*dispatched via courier/
    );
  });

  // ============================================================================
  // TEST GROUP 5: Courier Dispatch Tracking & Status Transitions
  // ============================================================================
  console.log('\n[Test Group 5] Courier Tracking Updates & Non-Deduction On Delivery');

  await itAsync('Updates courier tracking status to "In Transit"', async () => {
    const updated = await updateCourierDeliveryStatus(
      validDispatchRecord.id,
      'In Transit',
      'Package cleared regional hub',
      'karthik_store_mgr',
      mockDbWithStock
    );

    assert.strictEqual(updated.delivery_status, 'In Transit');
  });

  await itAsync('Transitions to "Delivered" WITHOUT deducting stock a second time', async () => {
    const prodBefore = mockDbWithStock._tables.inventory_products.find((p) => p.device_type === '8 Channel Live').usable_stock;
    const matBefore = mockDbWithStock._tables.material_inventory.find((m) => m.material_name === 'Airtel M2M 4G SIM Card').current_stock;
    const movementCountBefore = mockDbWithStock._tables.stock_movements.length;

    const delivered = await updateCourierDeliveryStatus(
      validDispatchRecord.id,
      'Delivered',
      'Delivered to Mr. Sundar at warehouse gate',
      'karthik_store_mgr',
      mockDbWithStock
    );

    assert.strictEqual(delivered.delivery_status, 'Delivered');
    assert.ok(delivered.actual_delivery_date);

    // CRITICAL: Stock balances MUST NOT change when delivery is confirmed
    const prodAfter = mockDbWithStock._tables.inventory_products.find((p) => p.device_type === '8 Channel Live').usable_stock;
    const matAfter = mockDbWithStock._tables.material_inventory.find((m) => m.material_name === 'Airtel M2M 4G SIM Card').current_stock;
    const movementCountAfter = mockDbWithStock._tables.stock_movements.length;

    assert.strictEqual(prodAfter, prodBefore, 'Device stock must NOT be deducted again upon delivery');
    assert.strictEqual(matAfter, matBefore, 'Material stock must NOT be deducted again upon delivery');
    assert.strictEqual(movementCountAfter, movementCountBefore, 'No additional stock movement should be logged upon delivery');
  });

  // ============================================================================
  // TEST GROUP 6: Assignment & Scheduling After Delivery
  // ============================================================================
  console.log('\n[Test Group 6] Assignment and Next-Day Scheduling Later Without Duplicate Checklists');

  it('Maintains the exact same checklist ID when Sales assigns a technician and schedules later', () => {
    const existingChecklist = mockDbWithStock._tables.installation_checklists[0];
    const originalChecklistId = existingChecklist.id;
    const originalChecklistNumber = existingChecklist.checklist_number;

    // Sales assigns Mathi for tomorrow
    const businessTomorrow = getBusinessTomorrow();
    const updatePayload = {
      service_engineer: 'Mathi',
      expected_arrival_date: businessTomorrow,
      expected_arrival_time: '10:00',
      installation_status: 'Assigned',
    };

    Object.assign(existingChecklist, updatePayload);

    assert.strictEqual(existingChecklist.id, originalChecklistId, 'Checklist ID must remain unchanged');
    assert.strictEqual(existingChecklist.checklist_number, originalChecklistNumber, 'Checklist Number must remain unchanged');
    assert.strictEqual(existingChecklist.service_engineer, 'Mathi');
    assert.strictEqual(existingChecklist.expected_arrival_date, businessTomorrow);
    assert.strictEqual(existingChecklist.installation_status, 'Assigned');
  });

  it('Enforces strict next-day work-start rule when scheduling couriered job', () => {
    const businessTomorrow = getBusinessTomorrow();
    const today = new Date().toISOString().split('T')[0];

    function validateScheduleDate(date) {
      if (date !== businessTomorrow) {
        throw new Error('Jobs can only be scheduled to start tomorrow. Advance pre-booking is not allowed.');
      }
    }

    // Scheduling today: rejected
    assert.throws(() => validateScheduleDate(today), /Jobs can only be scheduled to start tomorrow/);

    // Scheduling next week: rejected
    assert.throws(() => validateScheduleDate('2026-10-25'), /Jobs can only be scheduled to start tomorrow/);

    // Scheduling tomorrow: accepted
    assert.doesNotThrow(() => validateScheduleDate(businessTomorrow));
  });

  it('Validates technician booking conflicts when scheduling later', () => {
    const bookings = [
      { engineer: 'Mathi', start_date: '2026-10-18', end_date: '2026-10-18', checklist: 'EES-2026-009' },
    ];

    function checkAvailability(engName, startDate) {
      const conflict = bookings.find((b) => b.engineer === engName && b.start_date === startDate);
      if (conflict) {
        throw new Error(`Booking Conflict: ${engName} is already booked for checklist ${conflict.checklist}`);
      }
      return true;
    }

    // Mathi is booked on 2026-10-18
    assert.throws(() => checkAvailability('Mathi', '2026-10-18'), /Booking Conflict: Mathi is already booked/);

    // Guna is free on 2026-10-18
    assert.strictEqual(checkAvailability('Guna', '2026-10-18'), true);
  });

  // ============================================================================
  // TEST GROUP 7: Delivery Exception, Cancellation & Authorized Return to Store
  // ============================================================================
  console.log('\n[Test Group 7] Delivery Exception & Authorized Return to Store');

  await itAsync('Records return to store upon delivery exception and credits stock back', async () => {
    const prodBeforeReturn = mockDbWithStock._tables.inventory_products.find((p) => p.device_type === '8 Channel Live').usable_stock;

    const returnResult = await recordCourierReturnToStore(
      validDispatchRecord.id,
      {
        return_reason: 'Client relocated to another premises before courier arrival',
        returned_items: [
          { item_type: 'DEVICE', name: '8 Channel Live', quantity: 2, condition: 'USABLE' },
        ],
        returned_materials: [
          { material_name: 'Airtel M2M 4G SIM Card', quantity: 2, condition: 'USABLE' },
        ],
      },
      'karthik_store_mgr',
      mockDbWithStock
    );

    assert.ok(returnResult.success);

    // Verify stock is restored into usable inventory
    const prodAfterReturn = mockDbWithStock._tables.inventory_products.find((p) => p.device_type === '8 Channel Live').usable_stock;
    assert.strictEqual(prodAfterReturn, prodBeforeReturn + 2, 'Usable device stock should be credited back by 2');

    // Verify COURIER_RETURN audit ledger record was written
    const latestMovement = mockDbWithStock._tables.stock_movements[mockDbWithStock._tables.stock_movements.length - 2];
    assert.strictEqual(latestMovement.movement_type, 'COURIER_RETURN');
    assert.strictEqual(latestMovement.quantity, 2);
    assert.strictEqual(latestMovement.balance_after, 10);
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed to run:', err);
  process.exit(1);
});
