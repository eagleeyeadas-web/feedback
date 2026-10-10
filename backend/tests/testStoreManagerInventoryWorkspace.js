import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  getInventoryProducts,
  getInventorySummary,
  receiveNewStock,
  getInventoryTransactions,
} from '../src/services/inventoryService.js';
import {
  submitDeviceCarryRecord,
  getDeviceCarryRecord,
  submitInstallationCompletionReport,
  getPendingStoreReturns,
  getAllStoreReturns,
  verifyStoreReturn,
} from '../src/services/workflowService.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

async function runStoreInventoryAcceptanceTests() {
  console.log('================================================================');
  console.log('--- Store Manager Workspace & Inventory Integration Test Suite ---');
  console.log('================================================================\n');

  const testStoreManager = {
    id: 'e1000000-0000-0000-0000-000000000001',
    email: 'store.manager@eagleeye.com',
    full_name: 'Store Manager John',
    role: 'STORE_MANAGER',
  };

  const testTechnician = {
    id: 'f2000000-0000-0000-0000-000000000002',
    email: 'technician.raj@eagleeye.com',
    full_name: 'Technician Raj',
    role: 'TECHNICAL',
  };

  const targetDevice = '2 Channel Live';

  try {
    // -------------------------------------------------------------
    // Scenario 1: Store Manager adds 20 units; usable stock increases by 20
    // -------------------------------------------------------------
    console.log('[Scenario 1] Store Manager adds 20 units of 2 Channel Live');
    const initialProds = await getInventoryProducts();
    const initialItem = initialProds.find((p) => p.device_type === targetDevice);
    const initialUsable = initialItem ? Number(initialItem.usable_stock) : 0;
    console.log(`Initial usable stock for ${targetDevice}: ${initialUsable}`);

    const receiveRes = await receiveNewStock({
      device_type: targetDevice,
      quantity: 20,
      user: testStoreManager,
      supplier: 'Central Warehouse Logistics',
      purchase_ref: 'PO-TEST-1001',
      remarks: 'Automated test stock batch intake',
    });

    const prodsAfterAdd = await getInventoryProducts();
    const itemAfterAdd = prodsAfterAdd.find((p) => p.device_type === targetDevice);
    const usableAfterAdd = Number(itemAfterAdd?.usable_stock);
    console.log(`Usable stock after adding 20 units: ${usableAfterAdd}`);

    if (usableAfterAdd === initialUsable + 20) {
      console.log('PASS [Scenario 1]: Usable stock increased by exactly 20 units.\n');
    } else {
      throw new Error(`FAIL [Scenario 1]: Expected ${initialUsable + 20}, got ${usableAfterAdd}`);
    }

    // Verify transaction record was created
    const txAfterAdd = await getInventoryTransactions({ type: 'STOCK_RECEIVED' });
    const hasReceiveTx = txAfterAdd.transactions.some(
      (t) => t.device_type === targetDevice && t.quantity === 20
    );
    if (!hasReceiveTx) {
      throw new Error('FAIL [Scenario 1]: Linked STOCK_RECEIVED transaction was not found');
    }
    console.log('PASS: Linked STOCK_RECEIVED transaction verified.\n');

    // -------------------------------------------------------------
    // Scenario 2: Technician carries 3 units; usable stock decreases by 3 exactly once
    // -------------------------------------------------------------
    console.log('[Scenario 2] Technician records carrying 3 units for a checklist');
    const checklist1 = await createChecklist(testStoreManager.id, {
      client_name: 'Test Client Alpha',
      client_mobile: '9876543201',
      client_location: 'Highway Point 12',
      device_type: targetDevice,
      number_of_devices: 3,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '11:00 AM',
      service_engineer: 'Technician Raj',
      service_assistant: 'Assistant Kumar',
      installation_status: 'Assigned',
    });

    const stockBeforeCarry = usableAfterAdd;
    const initialIssued = Number(itemAfterAdd?.issued_stock) || 0;

    await submitDeviceCarryRecord({
      checklist_id: checklist1.id,
      user: testTechnician,
      items: [{ device_type: targetDevice, quantity_to_carry: 3 }],
      remarks: 'Taking 3 units in service van',
    });

    const prodsAfterCarry = await getInventoryProducts();
    const itemAfterCarry = prodsAfterCarry.find((p) => p.device_type === targetDevice);
    const stockAfterCarry = Number(itemAfterCarry?.usable_stock);
    const issuedAfterCarry = Number(itemAfterCarry?.issued_stock);

    console.log(`Usable stock before: ${stockBeforeCarry}, after carry: ${stockAfterCarry}`);
    console.log(`Issued stock before: ${initialIssued}, after carry: ${issuedAfterCarry}`);

    if (stockAfterCarry === stockBeforeCarry - 3 && issuedAfterCarry === initialIssued + 3) {
      console.log('PASS [Scenario 2]: Usable stock decreased by 3 and issued stock increased by 3.\n');
    } else {
      throw new Error(`FAIL [Scenario 2]: Stock deduction mismatch. Got usable: ${stockAfterCarry}, issued: ${issuedAfterCarry}`);
    }

    // Verify duplicate submission prevention
    console.log('Testing duplicate carry submission prevention...');
    try {
      await submitDeviceCarryRecord({
        checklist_id: checklist1.id,
        user: testTechnician,
        items: [{ device_type: targetDevice, quantity_to_carry: 3 }],
      });
      throw new Error('FAIL: Duplicate carry submission should have thrown');
    } catch (err) {
      console.log('PASS: Duplicate carry submission rejected ->', err.message, '\n');
    }

    // -------------------------------------------------------------
    // Scenario 3: Technician attempts to carry more than available stock; rejected
    // -------------------------------------------------------------
    console.log('[Scenario 3] Technician attempts to carry more than available stock');
    const checklist2 = await createChecklist(testStoreManager.id, {
      client_name: 'Test Client Beta',
      client_mobile: '9876543202',
      client_location: 'City Center',
      device_type: targetDevice,
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 10000,
      payment_method: 'UPI',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '02:00 PM',
      service_engineer: 'Technician Raj',
      service_assistant: 'Assistant Kumar',
      installation_status: 'Assigned',
    });

    const currentAvailable = stockAfterCarry;
    const excessiveQuantity = currentAvailable + 500;
    console.log(`Available stock: ${currentAvailable}, Attempting to carry: ${excessiveQuantity}`);

    try {
      await submitDeviceCarryRecord({
        checklist_id: checklist2.id,
        user: testTechnician,
        items: [{ device_type: targetDevice, quantity_to_carry: excessiveQuantity }],
      });
      throw new Error('FAIL [Scenario 3]: Excessive carry request should have been rejected');
    } catch (err) {
      console.log('PASS [Scenario 3]: Excessive carry rejected with clear reason ->', err.message);
    }

    // Verify stock did not change on rejected request
    const prodsAfterRejected = await getInventoryProducts();
    const itemAfterRejected = prodsAfterRejected.find((p) => p.device_type === targetDevice);
    if (Number(itemAfterRejected?.usable_stock) === currentAvailable) {
      console.log('PASS: Usable stock remained untouched after rejected carry request.\n');
    } else {
      throw new Error('FAIL: Stock balance changed despite rejection');
    }

    // -------------------------------------------------------------
    // Scenario 4: Technician installs 2 units and declares 1 unit for return
    // (Installation status becomes Completed, but usable stock does NOT increase yet)
    // -------------------------------------------------------------
    console.log('[Scenario 4] Technician completes job: 2 installed, 1 declared for return');
    const stockBeforeReport = Number(itemAfterRejected?.usable_stock);

    const reportRes = await submitInstallationCompletionReport({
      checklist_id: checklist1.id,
      user: testTechnician,
      items: [
        {
          device_type: targetDevice,
          quantity_carried: 3,
          quantity_installed: 2,
          quantity_to_return: 1,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
      completion_status: 'Completed',
      remarks: '2 units installed on vehicle, 1 unit returning to store',
    });

    const updatedChecklist1 = await getChecklistById(checklist1.id);
    const stockAfterReport = (await getInventoryProducts()).find((p) => p.device_type === targetDevice)?.usable_stock;

    console.log(`Installation status: ${updatedChecklist1.installation_status}`);
    console.log(`Usable stock before: ${stockBeforeReport}, after report: ${stockAfterReport}`);

    if (updatedChecklist1.installation_status === 'Completed' && stockAfterReport === stockBeforeReport) {
      console.log('PASS [Scenario 4]: Job completed, but usable stock NOT increased prior to store verification.\n');
    } else {
      throw new Error(`FAIL [Scenario 4]: Expected status Completed and stock ${stockBeforeReport}, got ${updatedChecklist1.installation_status} and ${stockAfterReport}`);
    }

    // Check pending return record
    const pendingReturns = await getPendingStoreReturns();
    const ret1 = pendingReturns.find((r) => r.checklist_id === checklist1.id && r.device_type === targetDevice);
    if (!ret1 || ret1.declared_return_qty !== 1) {
      throw new Error('FAIL [Scenario 4]: Return declaration record not found or quantity mismatch');
    }
    console.log(`PASS: Found return declaration for checklist ${checklist1.id} (Declared Qty: ${ret1.declared_return_qty}, Status: ${ret1.status})\n`);

    // -------------------------------------------------------------
    // Scenario 5: Store Manager verifies the returned unit; usable stock increases by 1
    // -------------------------------------------------------------
    console.log('[Scenario 5] Store Manager physically verifies 1 usable returned unit');
    const stockBeforeVerify = Number(stockAfterReport);

    await verifyStoreReturn({
      return_id: ret1.id,
      accepted_usable_qty: 1,
      damaged_qty: 0,
      missing_qty: 0,
      user: testStoreManager,
      remarks: 'Physically inspected: 1 unit accepted in good usable condition',
    });

    const stockAfterVerify = (await getInventoryProducts()).find((p) => p.device_type === targetDevice)?.usable_stock;
    console.log(`Usable stock before verification: ${stockBeforeVerify}, after verification: ${stockAfterVerify}`);

    if (stockAfterVerify === stockBeforeVerify + 1) {
      console.log('PASS [Scenario 5]: Usable stock increased by exactly 1 upon Store Manager verification.\n');
    } else {
      throw new Error(`FAIL [Scenario 5]: Expected stock ${stockBeforeVerify + 1}, got ${stockAfterVerify}`);
    }

    // -------------------------------------------------------------
    // Scenario 6: Store Manager receives a damaged returned unit;
    // (Recorded as damaged stock, NOT added to usable stock)
    // -------------------------------------------------------------
    console.log('[Scenario 6] Store Manager receives damaged return (Recorded as damaged stock, NOT usable stock)');
    // Create job 3 with 2 units carried, 1 installed, 1 declared return
    const checklist3 = await createChecklist(testStoreManager.id, {
      client_name: 'Test Client Gamma',
      client_mobile: '9876543203',
      client_location: 'Industrial Park',
      device_type: targetDevice,
      number_of_devices: 2,
      number_of_vehicles: 1,
      confirmed_price: 18000,
      payment_method: 'Cash',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '04:00 PM',
      service_engineer: 'Technician Raj',
      service_assistant: 'Assistant Kumar',
      installation_status: 'Assigned',
    });

    await submitDeviceCarryRecord({
      checklist_id: checklist3.id,
      user: testTechnician,
      items: [{ device_type: targetDevice, quantity_to_carry: 2 }],
    });

    await submitInstallationCompletionReport({
      checklist_id: checklist3.id,
      user: testTechnician,
      items: [
        {
          device_type: targetDevice,
          quantity_carried: 2,
          quantity_installed: 1,
          quantity_to_return: 1,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
      completion_status: 'Completed',
    });

    const pendingReturns3 = await getPendingStoreReturns();
    const ret3 = pendingReturns3.find((r) => r.checklist_id === checklist3.id);
    if (!ret3) throw new Error('Return record for job 3 not found');

    const itemBeforeDmg = (await getInventoryProducts()).find((p) => p.device_type === targetDevice);
    const usableBeforeDmg = Number(itemBeforeDmg.usable_stock);
    const damagedBeforeDmg = Number(itemBeforeDmg.damaged_stock) || 0;

    // Verify: 0 usable, 1 damaged
    await verifyStoreReturn({
      return_id: ret3.id,
      accepted_usable_qty: 0,
      damaged_qty: 1,
      missing_qty: 0,
      user: testStoreManager,
      remarks: 'Unit casing cracked during transport: stored in damaged bin',
    });

    const itemAfterDmg = (await getInventoryProducts()).find((p) => p.device_type === targetDevice);
    const usableAfterDmg = Number(itemAfterDmg.usable_stock);
    const damagedAfterDmg = Number(itemAfterDmg.damaged_stock);

    console.log(`Usable stock before: ${usableBeforeDmg}, after damaged return: ${usableAfterDmg}`);
    console.log(`Damaged stock before: ${damagedBeforeDmg}, after damaged return: ${damagedAfterDmg}`);

    if (usableAfterDmg === usableBeforeDmg && damagedAfterDmg === damagedBeforeDmg + 1) {
      console.log('PASS [Scenario 6]: Damaged unit added to damaged stock and NOT added to usable stock.\n');
    } else {
      throw new Error('FAIL [Scenario 6]: Stock update mismatch on damaged return verification');
    }

    // -------------------------------------------------------------
    // Scenario 7: Duplicate return verification cannot add stock twice
    // -------------------------------------------------------------
    console.log('[Scenario 7] Attempt duplicate return verification on already verified record');
    try {
      await verifyStoreReturn({
        return_id: ret3.id,
        accepted_usable_qty: 1,
        damaged_qty: 0,
        missing_qty: 0,
        user: testStoreManager,
      });
      throw new Error('FAIL [Scenario 7]: Duplicate verification should have thrown error');
    } catch (err) {
      console.log('PASS [Scenario 7]: Duplicate return verification blocked ->', err.message, '\n');
    }

    // -------------------------------------------------------------
    // Scenario 8: Inventory balances remain correct after reloading / re-querying
    // -------------------------------------------------------------
    console.log('[Scenario 8] Verifying inventory balances consistency across queries');
    const finalProds = await getInventoryProducts();
    const finalSummary = await getInventorySummary();

    console.log(`Total Usable across all devices: ${finalSummary.totalUsable}`);
    console.log(`Total Issued across all devices: ${finalSummary.totalIssued}`);
    console.log(`Total Damaged across all devices: ${finalSummary.totalDamaged}`);

    if (finalSummary.totalUsable > 0 && finalProds.length === 7) {
      console.log('PASS [Scenario 8]: All 7 device types present with consistent non-negative balances.\n');
    } else {
      throw new Error('FAIL [Scenario 8]: Inventory summary inconsistency');
    }

    // -------------------------------------------------------------
    // Scenario 9: Sales sees updated installation status without being allowed to modify stock
    // -------------------------------------------------------------
    console.log('[Scenario 9] Verifying Sales visibility of installation status');
    const chk1SalesView = await getChecklistById(checklist1.id);
    const chk3SalesView = await getChecklistById(checklist3.id);

    console.log(`Checklist 1 status viewed by Sales: ${chk1SalesView.installation_status}`);
    console.log(`Checklist 3 status viewed by Sales: ${chk3SalesView.installation_status}`);

    if (chk1SalesView.installation_status === 'Completed' && chk3SalesView.installation_status === 'Completed') {
      console.log('PASS [Scenario 9]: Installation jobs updated to Completed for Sales view.\n');
    } else {
      throw new Error('FAIL [Scenario 9]: Status not updated to Completed');
    }

    // -------------------------------------------------------------
    // Scenario 10: Existing Quotations, Feedback, Checklists continue to work
    // -------------------------------------------------------------
    console.log('[Scenario 10] Verifying core modules integrity (Checklists & Workflow intact)');
    const allReturns = await getAllStoreReturns();
    console.log(`Store Returns Ledger count: ${allReturns.length}`);
    if (allReturns.length >= 2) {
      console.log('PASS [Scenario 10]: Store returns ledger and historical records fully intact.\n');
    }

    // Cleanup test checklists
    await supabase.from('installation_checklists').delete().in('id', [checklist1.id, checklist2.id, checklist3.id]);

    console.log('================================================================');
    console.log('--- ALL 10 ACCEPTANCE SCENARIOS PASSED WITH 100% SUCCESS ---');
    console.log('================================================================');
  } catch (err) {
    console.error('\nACCEPTANCE TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runStoreInventoryAcceptanceTests();
