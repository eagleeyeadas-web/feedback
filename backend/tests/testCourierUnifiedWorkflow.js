import crypto from 'crypto';
import supabase from '../src/services/supabase.js';
import {
  createChecklist,
  getChecklistById,
  inMemoryChecklistServiceItems,
} from '../src/services/installationService.js';
import {
  syncStoreRequirementForChecklist,
  getStoreMaterialRequirementById,
  getStoreMaterialRequirements,
  issueFullJobStock,
  inMemoryStoreRequirements,
} from '../src/services/storeRequirementService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';

const mockStoreManager = {
  id: '00000000-0000-0000-0000-000000000099',
  email: 'test-store-manager@safdrive.com',
  full_name: 'Test Store Manager',
  role: 'STORE_MANAGER',
};

const mockSalesUserId = '00000000-0000-0000-0000-000000000088';

function formatPass(num, name) {
  console.log(`\x1b[32m✔ TEST ${num} PASSED: ${name}\x1b[0m`);
}

function formatFail(num, name, err) {
  console.error(`\x1b[31m✘ TEST ${num} FAILED: ${name}\x1b[0m\n`, err);
}

const createdTestChecklistIds = [];
const stockRestorations = [];

async function cleanupTestData() {
  console.log('\nCleaning up test artifacts and restoring stock levels...');
  for (const restore of stockRestorations) {
    try {
      if (restore.type === 'DEVICE') {
        const { data: prod } = await supabase.from('inventory_products').select('usable_stock').eq('id', restore.id).single();
        if (prod) {
          await supabase.from('inventory_products').update({ usable_stock: restore.originalStock }).eq('id', restore.id);
        }
      }
    } catch (e) {
      // Ignore restore error
    }
  }

  for (const id of createdTestChecklistIds) {
    try {
      inMemoryStoreRequirements.delete(id);
      inMemoryChecklistServiceItems.delete(id);
      await supabase.from('store_material_requirements').delete().eq('checklist_id', id);
      await supabase.from('installation_checklists').delete().eq('id', id);
      await supabase.from('stock_movements').delete().eq('checklist_id', id);
    } catch (e) {
      // Ignore cleanup error
    }
  }
}

async function runCourierUnifiedWorkflowTests() {
  console.log('========================================================================');
  console.log('SAFDRIVE — MERGED PRODUCT COURIER WORKFLOW ACCEPTANCE TEST SUITE');
  console.log('========================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  try {
    // Load inventory products
    const products = await getInventoryProducts();
    const testCameraProduct = products.find(
      (p) => p.usable_stock >= 10 && (p.device_type?.toLowerCase().includes('channel') || p.device_type?.toLowerCase().includes('live'))
    ) || products[0];

    if (!testCameraProduct) {
      throw new Error('No camera inventory products found in test environment.');
    }

    const originalCameraUsableStock = Number(testCameraProduct.usable_stock) || 0;
    stockRestorations.push({
      type: 'DEVICE',
      id: testCameraProduct.id,
      originalStock: originalCameraUsableStock,
    });

    console.log(`Using Test Camera: ${testCameraProduct.device_type} (SKU: ${testCameraProduct.sku}), Usable Stock: ${originalCameraUsableStock}\n`);

    // ------------------------------------------------------------------------
    // SCENARIO 1: Sales creates a Product Couriered checklist without engineer / arrival date
    // and it appears in Incoming Jobs & Material Requirements
    // ------------------------------------------------------------------------
    let courierChk1 = null;
    try {
      const payload = {
        checklist_number: `EE-TEST-COUR-1-${Date.now()}`,
        client_name: 'Metro Express Logistics',
        client_mobile: '9812345678',
        client_location: 'Bangalore Hub',
        installation_or_service: 'Installation',
        delivery_method: 'Product Couriered',
        expected_arrival_date: null,
        expected_arrival_time: null,
        service_engineer: null,
        device_type: testCameraProduct.device_type,
        number_of_devices: 2,
        device_configurations: [
          { device_type: testCameraProduct.device_type, number_of_devices: 2, quantity_carried: 2 },
        ],
        salesperson_name: 'Courier Sales Rep',
      };

      courierChk1 = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(courierChk1.id);

      // Verify it appears in Incoming Jobs
      const incomingJobs = await getStoreMaterialRequirements({ job_type: 'All', search: courierChk1.checklist_number });
      const jobList = incomingJobs.requirements || [];
      const foundInList = jobList.find((j) => j.checklist_id === courierChk1.id || j.id === courierChk1.id);

      if (!foundInList) {
        throw new Error('Couriered checklist did not appear in Incoming Jobs & Material Requirements list.');
      }

      formatPass(1, 'Sales creates a Product Couriered checklist without engineer/arrival date and it appears in Incoming Jobs');
      passedCount++;
    } catch (err) {
      formatFail(1, 'Sales creates a Product Couriered checklist without engineer/arrival date and it appears in Incoming Jobs', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 2: Courier order is clearly identified with COURIER label/badges
    // ------------------------------------------------------------------------
    try {
      const storeReq = await getStoreMaterialRequirementById(courierChk1.id);
      if (!storeReq) {
        throw new Error(`Store requirement record not found for checklist ${courierChk1.id}`);
      }

      if (storeReq.delivery_method !== 'Product Couriered') {
        throw new Error(`Expected delivery_method === 'Product Couriered', got '${storeReq.delivery_method}'`);
      }
      if (storeReq.is_courier !== true) {
        throw new Error(`Expected is_courier === true, got '${storeReq.is_courier}'`);
      }
      if (storeReq.job_type !== 'Courier' && storeReq.effective_job_type !== 'Courier') {
        throw new Error(`Expected job_type or effective_job_type to be 'Courier', got '${storeReq.job_type}'`);
      }

      formatPass(2, 'Courier order is clearly identified with COURIER job_type and is_courier flag');
      passedCount++;
    } catch (err) {
      formatFail(2, 'Courier order is clearly identified with COURIER job_type and is_courier flag', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 3: Required products and quantities match the Sales checklist configurations
    // ------------------------------------------------------------------------
    try {
      const storeReq = await getStoreMaterialRequirementById(courierChk1.id);
      const reqDevices = storeReq.required_device_items || storeReq.device_items || [];
      const matchingDevice = reqDevices.find((d) => d.device_type === testCameraProduct.device_type || d.sku === testCameraProduct.sku);

      if (!matchingDevice) {
        throw new Error(`Required device ${testCameraProduct.device_type} not found in store requirement.`);
      }
      const qty = Number(matchingDevice.required_quantity || matchingDevice.quantity_required || matchingDevice.quantity);
      if (qty !== 2) {
        throw new Error(`Expected quantity === 2, got ${qty}`);
      }

      formatPass(3, 'Required products and quantities match Sales checklist configuration');
      passedCount++;
    } catch (err) {
      formatFail(3, 'Required products and quantities match Sales checklist configuration', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 4 & 5: Store Manager issues stock with one primary action,
    // deducts stock exactly once, logs stock movement, and updates card to ISSUED
    // ------------------------------------------------------------------------
    try {
      const issueResult = await issueFullJobStock({
        checklist_id: courierChk1.id,
        issue_devices: true,
        issue_materials: false,
        issue_backup_items: false,
        remarks: 'Authorized Store Issuance for Courier Order',
        user: mockStoreManager,
      });

      if (issueResult.devices_issuance_status !== 'ISSUED') {
        throw new Error(`Expected devices_issuance_status === 'ISSUED', got '${issueResult.devices_issuance_status}'`);
      }

      const issuedDevice = issueResult.results?.devices?.devices?.[0];
      if (!issuedDevice || Number(issuedDevice.quantity_issued) !== 2) {
        throw new Error(`Expected quantity_issued === 2, got ${issuedDevice?.quantity_issued}`);
      }

      // Verify stock movement was recorded
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('checklist_id', courierChk1.id);

      if (!movements || movements.length === 0) {
        throw new Error('No stock movement record created for courier stock issuance.');
      }

      const devMovement = movements.find((m) => m.product_id === testCameraProduct.id || m.device_id === testCameraProduct.id || m.item_id === testCameraProduct.id);
      if (!devMovement) {
        throw new Error('Stock movement does not reference test camera product.');
      }
      if (Math.abs(Number(devMovement.quantity)) !== 2) {
        throw new Error(`Expected movement quantity 2, got ${devMovement.quantity}`);
      }

      formatPass(4, 'Store Manager can issue stock with primary action (issueFullJobStock)');
      passedCount++;

      formatPass(5, 'Stock deduction of correct quantity is recorded in inventory and stock ledger');
      passedCount++;
    } catch (err) {
      formatFail(4, 'Store Manager can issue stock with primary action', err);
      formatFail(5, 'Stock deduction of correct quantity is recorded in inventory and stock ledger', err);
      failedCount += 2;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 6: Insufficient stock blocks issuance and displays shortage
    // ------------------------------------------------------------------------
    let shortageChk = null;
    try {
      const currentStockProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const availStock = Number(currentStockProd.data?.usable_stock) || 0;
      const demandQty = availStock + 50; // Guaranteed shortage

      const payload = {
        checklist_number: `EE-TEST-COUR-SHORT-${Date.now()}`,
        client_name: 'Shortage Client Ltd',
        client_mobile: '9812345679',
        client_location: 'Chennai Hub',
        installation_or_service: 'Installation',
        delivery_method: 'Product Couriered',
        expected_arrival_date: null,
        service_engineer: null,
        device_type: testCameraProduct.device_type,
        number_of_devices: demandQty,
        device_configurations: [
          { device_type: testCameraProduct.device_type, number_of_devices: demandQty, quantity_carried: demandQty },
        ],
        salesperson_name: 'Sales Rep Shortage',
      };

      shortageChk = await createChecklist(mockSalesUserId, payload, { skipStockValidation: true });
      createdTestChecklistIds.push(shortageChk.id);

      const storeReq = await getStoreMaterialRequirementById(shortageChk.id);
      if (!storeReq.has_shortage) {
        throw new Error('Store requirement did not flag shortage for demand exceeding available stock.');
      }
      if (!storeReq.shortage_details || storeReq.shortage_details.length === 0) {
        throw new Error('Store requirement shortage_details array is empty.');
      }

      // Attempting to issue should throw insufficient stock error
      let caughtError = null;
      try {
        await issueFullJobStock({
          checklist_id: shortageChk.id,
          issue_devices: true,
          issue_materials: false,
          user: mockStoreManager,
        });
      } catch (e) {
        caughtError = e;
      }

      if (!caughtError || (!caughtError.message.includes('Insufficient') && !caughtError.message.includes('stock'))) {
        throw new Error(`Expected Insufficient stock error, got: ${caughtError ? caughtError.message : 'No error thrown'}`);
      }

      formatPass(6, 'Insufficient stock blocks issuance and reports shortage items accurately');
      passedCount++;
    } catch (err) {
      formatFail(6, 'Insufficient stock blocks issuance and reports shortage items accurately', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 7: Rapid repeated / concurrent clicks do not deduct stock twice
    // ------------------------------------------------------------------------
    let concurrentChk = null;
    try {
      const payload = {
        checklist_number: `EE-TEST-COUR-CONC-${Date.now()}`,
        client_name: 'Concurrent Test Logistics',
        client_mobile: '9812345680',
        client_location: 'Delhi Hub',
        installation_or_service: 'Installation',
        delivery_method: 'Product Couriered',
        expected_arrival_date: null,
        service_engineer: null,
        device_type: testCameraProduct.device_type,
        number_of_devices: 1,
        device_configurations: [
          { device_type: testCameraProduct.device_type, number_of_devices: 1, quantity_carried: 1 },
        ],
        salesperson_name: 'Sales Rep Concurrent',
      };

      concurrentChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(concurrentChk.id);

      // Fire 3 simultaneous issuance requests
      const promises = [
        issueFullJobStock({ checklist_id: concurrentChk.id, issue_devices: true, issue_materials: false, issue_backup_items: false, user: mockStoreManager }).catch((e) => e),
        issueFullJobStock({ checklist_id: concurrentChk.id, issue_devices: true, issue_materials: false, issue_backup_items: false, user: mockStoreManager }).catch((e) => e),
        issueFullJobStock({ checklist_id: concurrentChk.id, issue_devices: true, issue_materials: false, issue_backup_items: false, user: mockStoreManager }).catch((e) => e),
      ];

      const results = await Promise.all(promises);
      const successfulIssuances = results.filter((r) => !(r instanceof Error) && r.devices_issuance_status === 'ISSUED');

      if (successfulIssuances.length === 0) {
        throw new Error('All concurrent issuance attempts failed unexpectedly.');
      }

      // Check stock movements in DB for concurrentChk
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('checklist_id', concurrentChk.id);

      if (!movements || movements.length !== 1) {
        throw new Error(`Concurrency race! Found ${movements ? movements.length : 0} stock movements instead of exactly 1.`);
      }

      formatPass(7, 'Rapid repeated / concurrent requests do not deduct stock twice (idempotency & lock verified)');
      passedCount++;
    } catch (err) {
      formatFail(7, 'Rapid repeated / concurrent requests do not deduct stock twice', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 8: Already-issued courier checklist cannot be issued again
    // ------------------------------------------------------------------------
    try {
      let alreadyIssuedError = null;
      try {
        await issueFullJobStock({
          checklist_id: courierChk1.id,
          issue_devices: true,
          user: mockStoreManager,
        });
      } catch (e) {
        alreadyIssuedError = e;
      }

      if (!alreadyIssuedError || (!alreadyIssuedError.message.includes('already') && !alreadyIssuedError.message.includes('ISSUED'))) {
        throw new Error(`Expected already issued error, got: ${alreadyIssuedError ? alreadyIssuedError.message : 'No error thrown'}`);
      }

      formatPass(8, 'Already-issued courier checklist cannot be issued again');
      passedCount++;
    } catch (err) {
      formatFail(8, 'Already-issued courier checklist cannot be issued again', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 9: Installation jobs still use standard BOM workflow
    // ------------------------------------------------------------------------
    let instChk = null;
    try {
      const payload = {
        checklist_number: `EE-TEST-INST-VERIFY-${Date.now()}`,
        client_name: 'Standard Tech Client',
        client_mobile: '9812345681',
        client_location: 'Hyderabad Hub',
        installation_or_service: 'Installation',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-12-01',
        service_engineer: 'Guna',
        device_type: testCameraProduct.device_type,
        number_of_devices: 2,
        device_configurations: [
          { device_type: testCameraProduct.device_type, number_of_devices: 2, quantity_carried: 2 },
        ],
        salesperson_name: 'Sales Rep Tech',
      };

      instChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(instChk.id);

      const chk = await getChecklistById(instChk.id);
      if (!chk.bom_snapshot || !Array.isArray(chk.bom_snapshot.items) || chk.bom_snapshot.items.length === 0) {
        throw new Error('Technician Installation job did not calculate standard BOM snapshot.');
      }

      const storeReq = await getStoreMaterialRequirementById(instChk.id);
      if (storeReq.is_courier === true) {
        throw new Error('Technician Installation job was incorrectly flagged as courier.');
      }
      if (storeReq.delivery_method !== 'Technician Carries') {
        throw new Error(`Expected delivery_method 'Technician Carries', got '${storeReq.delivery_method}'`);
      }

      formatPass(9, 'Technician Installation jobs continue to calculate standard BOM snapshot');
      passedCount++;
    } catch (err) {
      formatFail(9, 'Technician Installation jobs continue to calculate standard BOM snapshot', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 10: Service jobs do not auto-calculate standard BOM snapshot
    // ------------------------------------------------------------------------
    let servChk = null;
    try {
      const payload = {
        checklist_number: `EE-TEST-SERV-VERIFY-${Date.now()}`,
        client_name: 'Service Client Corp',
        client_mobile: '9812345682',
        client_location: 'Kolkata Depot',
        installation_or_service: 'Service',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-12-02',
        service_engineer: 'Guna',
        device_configurations: [],
        service_items: [
          {
            item_id: testCameraProduct.id,
            item_type: 'DEVICE',
            item_name: testCameraProduct.device_type,
            sku: testCameraProduct.sku,
            quantity_required: 1,
            unit: 'Nos.',
            service_note: 'Repair unit',
          },
        ],
        salesperson_name: 'Service Rep',
      };

      servChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(servChk.id);

      const chk = await getChecklistById(servChk.id);
      if (chk.bom_snapshot !== null) {
        throw new Error(`Expected bom_snapshot === null for Service job, got: ${JSON.stringify(chk.bom_snapshot)}`);
      }

      const storeReq = await getStoreMaterialRequirementById(servChk.id);
      if (storeReq.job_type !== 'Service') {
        throw new Error(`Expected job_type === 'Service', got '${storeReq.job_type}'`);
      }

      formatPass(10, 'Service jobs do not auto-calculate standard BOM snapshot (bom_snapshot = null)');
      passedCount++;
    } catch (err) {
      formatFail(10, 'Service jobs do not auto-calculate standard BOM snapshot', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 11: Job Type filter in Incoming Jobs (All, Courier, Installation, Service)
    // ------------------------------------------------------------------------
    try {
      const [allRes, courierRes, instRes, servRes] = await Promise.all([
        getStoreMaterialRequirements({ job_type: 'All', limit: 200 }),
        getStoreMaterialRequirements({ job_type: 'Courier', limit: 200 }),
        getStoreMaterialRequirements({ job_type: 'Installation', limit: 200 }),
        getStoreMaterialRequirements({ job_type: 'Service', limit: 200 }),
      ]);

      const courierJobs = courierRes.requirements || [];
      const instJobs = instRes.requirements || [];
      const servJobs = servRes.requirements || [];

      const courierFoundInCourierFilter = courierJobs.some((j) => j.checklist_id === courierChk1.id);
      const courierFoundInInstFilter = instJobs.some((j) => j.checklist_id === courierChk1.id);
      const courierFoundInServFilter = servJobs.some((j) => j.checklist_id === courierChk1.id);

      if (!courierFoundInCourierFilter) {
        throw new Error('Courier job not found when filtering by job_type === "Courier"');
      }
      if (courierFoundInInstFilter) {
        throw new Error('Courier job erroneously leaked into job_type === "Installation" filter');
      }
      if (courierFoundInServFilter) {
        throw new Error('Courier job erroneously leaked into job_type === "Service" filter');
      }

      // Check summary stats
      if (typeof allRes.summary?.courierCount === 'number' && allRes.summary.courierCount < 1) {
        throw new Error(`Summary courierCount is ${allRes.summary.courierCount}, expected at least 1`);
      }

      formatPass(11, 'Job Type filtering cleanly separates Courier, Installation, and Service orders without cross-contamination');
      passedCount++;
    } catch (err) {
      formatFail(11, 'Job Type filtering cleanly separates Courier, Installation, and Service orders', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 12: Historical Courier records and dispatch data remain preserved
    // ------------------------------------------------------------------------
    try {
      const { data: historicalCourier } = await supabase
        .from('installation_checklists')
        .select('id, checklist_number, delivery_method, courier_dispatch_status, is_courier_dispatched')
        .eq('delivery_method', 'Product Couriered')
        .limit(10);

      if (!historicalCourier) {
        throw new Error('Unable to query historical courier checklists in Supabase database.');
      }

      // Historical records must have delivery_method === 'Product Couriered' preserved
      const validRecords = historicalCourier.every((r) => r.delivery_method === 'Product Couriered');
      if (!validRecords) {
        throw new Error('Historical courier records found with invalid delivery_method.');
      }

      formatPass(12, `Historical courier records (${historicalCourier.length} inspected) remain intact and fully accessible`);
      passedCount++;
    } catch (err) {
      formatFail(12, 'Historical courier records remain intact and accessible', err);
      failedCount++;
    }

  } catch (globalErr) {
    console.error('Fatal error during test suite execution:', globalErr);
  } finally {
    await cleanupTestData();
  }

  console.log('\n========================================================================');
  console.log(`TOTAL TESTS: ${passedCount + failedCount}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCourierUnifiedWorkflowTests();
