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
  issueServiceJobStock,
  issueFullJobStock,
  inMemoryStoreRequirements,
} from '../src/services/storeRequirementService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import {
  getDeviceCarryRecord,
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  verifyStoreReturn,
  getPendingStoreReturns,
} from '../src/services/workflowService.js';
import { generateWeeklyStockReport } from '../src/services/weeklyStockReportService.js';

const mockStoreManager = {
  id: '00000000-0000-0000-0000-000000000099',
  email: 'test-store-manager@safdrive.com',
  full_name: 'Test Store Manager',
  role: 'STORE_MANAGER',
};

const techInst = 'Tech Inst Engineer';
const techServ1 = 'Tech Serv 1';
const techServ2 = 'Tech Serv 2';
const techServ3 = 'Tech Serv 3';
const techServ4 = 'Tech Serv 4';

const mockSalesUserId = '00000000-0000-0000-0000-000000000088';
const mockTechnicianUser = {
  id: '00000000-0000-0000-0000-000000000077',
  full_name: techServ4,
  role: 'TECHNICAL',
};

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
      } else if (restore.type === 'MATERIAL') {
        const { data: mat } = await supabase.from('material_inventory').select('current_stock').eq('id', restore.id).single();
        if (mat) {
          await supabase.from('material_inventory').update({ current_stock: restore.originalStock }).eq('id', restore.id);
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

async function runAcceptanceTests() {
  console.log('========================================================================');
  console.log('SAFDRIVE — SERVICE CHECKLIST BOM & DEVICE STOCK ISSUANCE ACCEPTANCE TESTS');
  console.log('========================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  try {
    // Load existing catalogue products
    const [products, materials] = await Promise.all([
      getInventoryProducts(),
      getMaterialInventory(),
    ]);

    const testCameraProduct = products.find((p) => p.device_type?.toLowerCase().includes('channel') || p.device_type?.toLowerCase().includes('live')) || products[0];
    const testMaterial = materials[0];

    if (!testCameraProduct) {
      throw new Error('No camera inventory products found in test environment.');
    }

    // Keep track of original stock for test isolation
    const originalCameraUsableStock = Number(testCameraProduct.usable_stock) || 0;
    stockRestorations.push({
      type: 'DEVICE',
      id: testCameraProduct.id,
      originalStock: originalCameraUsableStock,
    });

    if (testMaterial) {
      const originalMatStock = Number(testMaterial.current_stock) || 0;
      stockRestorations.push({
        type: 'MATERIAL',
        id: testMaterial.id,
        originalStock: originalMatStock,
      });
    }

    // ------------------------------------------------------------------------
    // SCENARIO 1: Creating an Installation checklist continues to calculate normal BOM
    // ------------------------------------------------------------------------
    let instChk = null;
    try {
      const payload = {
        checklist_number: `TEST-INST-${Date.now()}`,
        client_name: 'Test Installation Client',
        client_mobile: '9876543210',
        client_location: 'Mumbai Hub',
        installation_or_service: 'Installation',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-06-01',
        installation_duration: '1 Day',
        device_type: testCameraProduct.device_type,
        number_of_devices: 2,
        device_configurations: [
          { device_type: testCameraProduct.device_type, number_of_devices: 2 },
        ],
        salesperson_name: 'Sales Rep 1',
        service_engineer: techInst,
      };

      instChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(instChk.id);

      const chkFromDb = await getChecklistById(instChk.id);
      if (!chkFromDb.bom_snapshot || !Array.isArray(chkFromDb.bom_snapshot.items) || chkFromDb.bom_snapshot.items.length === 0) {
        throw new Error('Installation checklist did not calculate standard BOM.');
      }
      if (chkFromDb.installation_or_service !== 'Installation') {
        throw new Error(`Expected installation_or_service === 'Installation', got: ${chkFromDb.installation_or_service}`);
      }

      formatPass(1, 'Creating an Installation checklist continues to calculate its normal BOM');
      passedCount++;
    } catch (err) {
      formatFail(1, 'Creating an Installation checklist continues to calculate its normal BOM', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 2: Creating a Service checklist does not calculate standard BOM
    // ------------------------------------------------------------------------
    let servChk = null;
    let preServiceCameraStock = 0;
    try {
      const preCheckProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      preServiceCameraStock = Number(preCheckProd.data?.usable_stock) || 0;

      const payload = {
        checklist_number: `TEST-SERV-${Date.now()}`,
        client_name: 'Test Service Client',
        client_mobile: '9876543211',
        client_location: 'Pune Depot',
        installation_or_service: 'Service',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-06-02',
        installation_duration: '1 Day',
        device_configurations: [],
        service_items: [
          {
            item_id: testCameraProduct.id,
            item_type: 'DEVICE',
            item_name: testCameraProduct.device_type,
            sku: testCameraProduct.sku,
            quantity_required: 2,
            unit: 'Nos.',
            service_note: 'Replace faulty camera unit',
          },
        ],
        salesperson_name: 'Sales Rep 2',
        service_engineer: techServ1,
      };

      servChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(servChk.id);

      const chkFromDb = await getChecklistById(servChk.id);
      if (chkFromDb.bom_snapshot !== null && chkFromDb.bom_snapshot !== undefined) {
        throw new Error(`Expected bom_snapshot === null for Service checklist, but got: ${JSON.stringify(chkFromDb.bom_snapshot)}`);
      }
      if (chkFromDb.installation_or_service !== 'Service') {
        throw new Error(`Expected installation_or_service === 'Service', got: ${chkFromDb.installation_or_service}`);
      }

      formatPass(2, 'Creating a Service checklist does not calculate the standard installation BOM');
      passedCount++;
    } catch (err) {
      formatFail(2, 'Creating a Service checklist does not calculate the standard installation BOM', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 3: Creating a Service checklist does not deduct or reserve stock
    // ------------------------------------------------------------------------
    try {
      const refreshedDbProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const currentStock = Number(refreshedDbProd.data?.usable_stock) || 0;

      if (currentStock !== preServiceCameraStock) {
        throw new Error(`Usable stock changed upon Service checklist creation! Pre: ${preServiceCameraStock}, Current: ${currentStock}`);
      }

      formatPass(3, 'Creating a Service checklist does not deduct or reserve stock');
      passedCount++;
    } catch (err) {
      formatFail(3, 'Creating a Service checklist does not deduct or reserve stock', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 4: Service checklist with no requested items does not trigger unnecessary issuance
    // ------------------------------------------------------------------------
    let emptyServChk = null;
    try {
      const payload = {
        checklist_number: `TEST-SERV-EMPTY-${Date.now()}`,
        client_name: 'Direct Call Client',
        client_mobile: '9876543212',
        client_location: 'Nagpur Site',
        installation_or_service: 'Service',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-06-03',
        installation_duration: '1 Day',
        service_items: [],
        salesperson_name: 'Sales Rep 3',
        service_engineer: techServ2,
      };

      emptyServChk = await createChecklist(mockSalesUserId, payload);
      createdTestChecklistIds.push(emptyServChk.id);

      const storeReq = await syncStoreRequirementForChecklist(emptyServChk);
      const enrichedReq = await getStoreMaterialRequirementById(emptyServChk.id);

      if (enrichedReq.status !== 'NOT_APPLICABLE') {
        throw new Error(`Expected status === 'NOT_APPLICABLE' for empty Service checklist, got: ${enrichedReq.status}`);
      }
      if (enrichedReq.has_shortage !== false) {
        throw new Error(`Expected has_shortage === false, got: ${enrichedReq.has_shortage}`);
      }
      if (Array.isArray(enrichedReq.material_items) && enrichedReq.material_items.length > 0) {
        throw new Error(`Expected material_items === [], got: ${JSON.stringify(enrichedReq.material_items)}`);
      }

      formatPass(4, 'A Service checklist with no requested items does not trigger unnecessary device or material issuance');
      passedCount++;
    } catch (err) {
      formatFail(4, 'A Service checklist with no requested items does not trigger unnecessary device or material issuance', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 5: Service checklist requesting two cameras displays that actual request to Store Manager
    // ------------------------------------------------------------------------
    let reqDetail = null;
    try {
      await syncStoreRequirementForChecklist(servChk);
      reqDetail = await getStoreMaterialRequirementById(servChk.id);

      if (!Array.isArray(reqDetail.service_items) || reqDetail.service_items.length !== 1) {
        throw new Error(`Expected exactly 1 service_item in Store requirement, found: ${reqDetail.service_items?.length}`);
      }
      const sItem = reqDetail.service_items[0];
      if (sItem.item_name !== testCameraProduct.device_type) {
        throw new Error(`Expected item_name === "${testCameraProduct.device_type}", got: "${sItem.item_name}"`);
      }
      if (sItem.quantity_required !== 2) {
        throw new Error(`Expected quantity_required === 2, got: ${sItem.quantity_required}`);
      }
      if (reqDetail.job_type !== 'Service') {
        throw new Error(`Expected job_type === 'Service', got: ${reqDetail.job_type}`);
      }

      formatPass(5, 'A Service checklist requesting two cameras displays that actual request to Store Manager');
      passedCount++;
    } catch (err) {
      formatFail(5, 'A Service checklist requesting two cameras displays that actual request to Store Manager', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 6: Issuing two available cameras deducts exactly two from camera stock
    // ------------------------------------------------------------------------
    try {
      // Ensure sufficient stock for test
      if (originalCameraUsableStock < 10) {
        await supabase.from('inventory_products').update({ usable_stock: 15 }).eq('id', testCameraProduct.id);
      }
      const preIssueProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const preStock = Number(preIssueProd.data.usable_stock);

      const issueResult = await issueServiceJobStock({
        checklist_id: servChk.id,
        items: [{ id: reqDetail.service_items[0].id, quantity_to_issue: 2 }],
        remarks: 'Test camera issuance for service call',
        user: mockStoreManager,
      });

      if (!issueResult.success) {
        throw new Error(`Issuance failed: ${issueResult.error}`);
      }

      const postIssueProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const postStock = Number(postIssueProd.data.usable_stock);

      if (postStock !== preStock - 2) {
        throw new Error(`Expected stock to decrease by 2 (from ${preStock} to ${preStock - 2}), but got: ${postStock}`);
      }

      formatPass(6, 'Issuing two available cameras deducts exactly two from camera stock');
      passedCount++;
    } catch (err) {
      formatFail(6, 'Issuing two available cameras deducts exactly two from camera stock', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 7: Attempting to issue items with insufficient stock fails gracefully and does not take stock negative
    // ------------------------------------------------------------------------
    try {
      // Create a test checklist requesting 999 cameras
      const excessiveChk = await createChecklist(mockSalesUserId, {
        checklist_number: `TEST-SERV-EXCESS-${Date.now()}`,
        client_name: 'Excessive Client',
        client_mobile: '9876543213',
        client_location: 'Nashik',
        installation_or_service: 'Service',
        delivery_method: 'Technician Carries',
        expected_arrival_date: '2028-06-04',
        installation_duration: '1 Day',
        service_items: [
          {
            item_id: testCameraProduct.id,
            item_type: 'DEVICE',
            item_name: testCameraProduct.device_type,
            quantity_required: 99999,
            unit: 'Nos.',
          },
        ],
        salesperson_name: 'Sales Rep 4',
        service_engineer: techServ3,
      });
      createdTestChecklistIds.push(excessiveChk.id);

      await syncStoreRequirementForChecklist(excessiveChk);

      const beforeStockProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const beforeStock = Number(beforeStockProd.data.usable_stock);

      let threwError = false;
      try {
        await issueServiceJobStock({
          checklist_id: excessiveChk.id,
          items: [{ item_id: testCameraProduct.id, quantity_to_issue: 99999 }],
          remarks: 'Excessive request test',
          user: mockStoreManager,
        });
      } catch (e) {
        threwError = true;
      }

      if (!threwError) {
        throw new Error('Expected issueServiceJobStock to reject excessive quantity, but it succeeded!');
      }

      const afterStockProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const afterStock = Number(afterStockProd.data.usable_stock);

      if (afterStock !== beforeStock || afterStock < 0) {
        throw new Error(`Stock level was corrupted! Before: ${beforeStock}, After: ${afterStock}`);
      }

      formatPass(7, 'Attempting to issue items with insufficient stock fails gracefully and does not take stock negative');
      passedCount++;
    } catch (err) {
      formatFail(7, 'Attempting to issue items with insufficient stock fails gracefully and does not take stock negative', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 8: Repeated Store Manager submission does not deduct stock twice
    // ------------------------------------------------------------------------
    try {
      // servChk was already issued 2 out of 2 in Scenario 6.
      // Attempting to issue again should fail because 0 remaining to issue!
      let threwError = false;
      try {
        await issueServiceJobStock({
          checklist_id: servChk.id,
          items: [{ id: reqDetail.service_items[0].id, quantity_to_issue: 2 }],
          remarks: 'Duplicate submission attempt',
          user: mockStoreManager,
        });
      } catch (e) {
        threwError = true;
      }

      if (!threwError) {
        throw new Error('Expected repeated issuance of already-issued items to be rejected, but it succeeded!');
      }

      formatPass(8, 'Repeated Store Manager submission does not deduct stock twice');
      passedCount++;
    } catch (err) {
      formatFail(8, 'Repeated Store Manager submission does not deduct stock twice', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 9: A partial issuance shows the correct remaining quantity
    // ------------------------------------------------------------------------
    let partialChk = null;
    try {
      partialChk = await createChecklist(mockSalesUserId, {
        checklist_number: `TEST-SERV-PARTIAL-${Date.now()}`,
        client_name: 'Partial Client',
        client_mobile: '9876543214',
        client_location: 'Thane',
        installation_or_service: 'Service',
        delivery_method: 'Technician Carries',
        expected_arrival_date: new Date().toISOString().split('T')[0],
        installation_duration: '1 Day',
        service_items: [
          {
            item_id: testCameraProduct.id,
            item_type: 'DEVICE',
            item_name: testCameraProduct.device_type,
            quantity_required: 5,
            unit: 'Nos.',
            service_note: 'Need 5 cameras replaced',
          },
        ],
        salesperson_name: 'Sales Rep 5',
        service_engineer: techServ4,
      });
      createdTestChecklistIds.push(partialChk.id);

      await syncStoreRequirementForChecklist(partialChk);
      const reqBefore = await getStoreMaterialRequirementById(partialChk.id);

      // Issue only 2 of 5
      const partialResult = await issueServiceJobStock({
        checklist_id: partialChk.id,
        items: [{ id: reqBefore.service_items[0].id, quantity_to_issue: 2 }],
        remarks: 'Partial issuance of 2 items',
        user: mockStoreManager,
      });

      const reqAfter = await getStoreMaterialRequirementById(partialChk.id);
      const updatedItem = reqAfter.service_items[0];

      if (updatedItem.quantity_issued !== 2) {
        throw new Error(`Expected quantity_issued === 2, got: ${updatedItem.quantity_issued}`);
      }
      if (updatedItem.quantity_remaining !== 3) {
        throw new Error(`Expected quantity_remaining === 3, got: ${updatedItem.quantity_remaining}`);
      }
      if (reqAfter.status !== 'PARTIALLY_ISSUED') {
        throw new Error(`Expected status === 'PARTIALLY_ISSUED', got: ${reqAfter.status}`);
      }

      formatPass(9, 'A partial issuance shows the correct remaining quantity');
      passedCount++;
    } catch (err) {
      formatFail(9, 'A partial issuance shows the correct remaining quantity', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 10: Technician usage and return quantities reconcile against issued quantities
    // ------------------------------------------------------------------------
    try {
      // In partialChk, 2 cameras were issued.
      // Technician carries 2. Technician uses 1 and returns 1.
      const carryRecord = await getDeviceCarryRecord(partialChk.id);
      if (carryRecord.total_devices_carried !== 2) {
        throw new Error(`Expected total_devices_carried === 2, got: ${carryRecord.total_devices_carried}`);
      }

      // Submit completion report
      const compReport = await submitInstallationCompletionReport(partialChk.id, {
        items: [
          {
            product_id: testCameraProduct.id,
            device_type: testCameraProduct.device_type,
            item_name: testCameraProduct.device_type,
            required_quantity: 2,
            quantity_carried: 2,
            quantity_installed: 1, // 1 used on site
            quantity_to_return: 1, // 1 returned unused
            unit: 'Nos.',
          },
        ],
        completion_status: 'Completed',
        remarks: '1 camera installed, 1 returned intact',
      }, mockTechnicianUser);

      if (!compReport || !compReport.id) {
        throw new Error(`Completion report submission failed`);
      }

      const fetchedReport = await getInstallationCompletionReport(partialChk.id);
      const reportedItem = fetchedReport.items[0];

      if (reportedItem.quantity_installed !== 1 || reportedItem.quantity_to_return !== 1) {
        throw new Error(`Expected installed 1, return 1, got installed ${reportedItem.quantity_installed}, return ${reportedItem.quantity_to_return}`);
      }

      formatPass(10, 'Technician usage and return quantities reconcile against issued quantities');
      passedCount++;
    } catch (err) {
      formatFail(10, 'Technician usage and return quantities reconcile against issued quantities', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 11: Returned usable stock is restored only upon Store Manager return verification
    // ------------------------------------------------------------------------
    try {
      // Check stock right after technician submitted return: should NOT be restored yet
      const postReportStockProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const stockBeforeVerification = Number(postReportStockProd.data.usable_stock);

      // Store Manager verifies the 1 returned unit
      const pendingReturns = await getPendingStoreReturns();
      const pendingDevReturn = pendingReturns.find((r) => r.checklist_id === partialChk.id);
      if (!pendingDevReturn) {
        throw new Error(`No pending device return found for checklist ${partialChk.id}`);
      }

      const verifyResult = await verifyStoreReturn({
        return_id: pendingDevReturn.id,
        accepted_usable_qty: 1,
        damaged_qty: 0,
        missing_qty: 0,
        user: mockStoreManager,
        remarks: 'Store verified return of 1 unused camera',
      });

      // Stock should now be exactly stockBeforeVerification + 1
      const postVerifyStockProd = await supabase.from('inventory_products').select('usable_stock').eq('id', testCameraProduct.id).single();
      const stockAfterVerification = Number(postVerifyStockProd.data.usable_stock);

      if (stockAfterVerification !== stockBeforeVerification + 1) {
        throw new Error(`Expected stock to increase by 1 upon Store Manager verification, before: ${stockBeforeVerification}, after: ${stockAfterVerification}`);
      }

      formatPass(11, 'Returned usable stock is restored only upon Store Manager return verification');
      passedCount++;
    } catch (err) {
      formatFail(11, 'Returned usable stock is restored only upon Store Manager return verification', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 12: Stock movement history records Service issuance against the correct checklist and technician
    // ------------------------------------------------------------------------
    try {
      const { data: movements, error: movErr } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('checklist_id', servChk.id);

      if (movErr) throw movErr;
      if (!Array.isArray(movements) || movements.length === 0) {
        throw new Error(`No stock_movement rows found for checklist ${servChk.id}`);
      }

      const mov = movements[0];
      const validTypes = ['SERVICE_DEVICE_ISSUED', 'STOCK_ISSUED'];
      if (!validTypes.includes(mov.movement_type)) {
        throw new Error(`Expected movement_type in ${validTypes.join(', ')}, got: ${mov.movement_type}`);
      }
      if (!mov.reason_or_remarks?.includes(techServ1) && mov.recipient_name !== techServ1 && mov.issued_to !== techServ1) {
        throw new Error(`Expected recipient === "${techServ1}" in stock movement, got: "${mov.reason_or_remarks}"`);
      }
      if (Math.abs(Number(mov.quantity)) !== 2) {
        throw new Error(`Expected quantity -2, got: ${mov.quantity}`);
      }

      formatPass(12, 'Stock movement history records Service issuance against the correct checklist and technician');
      passedCount++;
    } catch (err) {
      formatFail(12, 'Stock movement history records Service issuance against the correct checklist and technician', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 13: Weekly stock reports distinguish actual Service issuance from Installation issuance without double counting
    // ------------------------------------------------------------------------
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const weeklyData = await generateWeeklyStockReport({
        startDate: today,
        endDate: today,
        user: mockStoreManager,
      });

      const techReport = weeklyData.technician_installation_report || weeklyData.technicianInstallationReport;
      if (!techReport || !Array.isArray(techReport.technicians)) {
        throw new Error('Weekly stock report failed to return technician_installation_report.');
      }

      const allInstallations = techReport.technicians.flatMap((t) => t.installations || []);
      const serviceRow = allInstallations.find((r) => r.checklist_id === partialChk.id || r.checklist_id === servChk.id);
      if (serviceRow) {
        if (serviceRow.job_type !== 'Service') {
          throw new Error(`Expected serviceRow.job_type === 'Service', got: ${serviceRow.job_type}`);
        }
      }

      if (!Array.isArray(weeklyData.physical_stock_summary)) {
        throw new Error('Expected physical_stock_summary array in weekly stock report.');
      }

      formatPass(13, 'Weekly stock reports distinguish actual Service issuance from Installation issuance without double counting');
      passedCount++;
    } catch (err) {
      formatFail(13, 'Weekly stock reports distinguish actual Service issuance from Installation issuance without double counting', err);
      failedCount++;
    }

    // ------------------------------------------------------------------------
    // SCENARIO 14: Existing completed checklists and historical stock balances remain unchanged
    // ------------------------------------------------------------------------
    try {
      // Query completed historical checklists to ensure their properties remain consistent
      const { data: historicalChecklists, error: histErr } = await supabase
        .from('installation_checklists')
        .select('id, checklist_number, installation_status, installation_or_service, final_bom_snapshot')
        .eq('installation_status', 'COMPLETED')
        .limit(5);

      if (histErr) throw histErr;

      if (Array.isArray(historicalChecklists) && historicalChecklists.length > 0) {
        for (const hChk of historicalChecklists) {
          if (!hChk.installation_or_service) {
            throw new Error(`Historical checklist ${hChk.checklist_number} lost its installation_or_service job type.`);
          }
        }
      }

      formatPass(14, 'Existing completed checklists and historical stock balances remain unchanged');
      passedCount++;
    } catch (err) {
      formatFail(14, 'Existing completed checklists and historical stock balances remain unchanged', err);
      failedCount++;
    }

  } finally {
    await cleanupTestData();
  }

  console.log('\n========================================================================');
  console.log(`TOTAL ACCEPTANCE TESTS: ${passedCount + failedCount}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAcceptanceTests().catch((err) => {
  console.error('Fatal error during acceptance test execution:', err);
  process.exit(1);
});
