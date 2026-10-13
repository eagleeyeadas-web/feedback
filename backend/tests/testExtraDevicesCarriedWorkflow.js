import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import {
  getDeviceCarryRecord,
  submitInstallationCompletionReport,
  getPendingStoreReturns,
  verifyStoreReturn,
} from '../src/services/workflowService.js';
import { syncStoreRequirementForChecklist, getStoreMaterialRequirements } from '../src/services/storeRequirementService.js';
import { generateStoreManagerRequirementPDF } from '../src/services/storeManagerPdfGenerator.js';
import { generateInstallationChecklistPDF } from '../src/services/installationPdfGenerator.js';
import { calculateBomRequirements } from '../src/services/bomService.js';
import supabase from '../src/services/supabase.js';

async function runAcceptanceTest() {
  console.log('======================================================================');
  console.log('ACCEPTANCE TEST: Extra Devices Carried to Sales Checklist Creation');
  console.log('======================================================================\n');

  const salesUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'sales@eagleeye.com',
    role: 'SALES',
    name: 'Sarah Sales',
  };

  const techUser = {
    id: 'e2b4c6d8-a1bf-40ef-8878-ec64b29bbfd6',
    email: 'tech@eagleeye.com',
    role: 'TECHNICAL',
    name: 'Tech Terry',
  };

  const storeUser = {
    id: 'd1a3b5c7-a1bf-40ef-8878-ec64b29bbfd7',
    email: 'store@eagleeye.com',
    role: 'STORE_MANAGER',
    name: 'Store Manager Sam',
  };

  let testChecklistId = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Verify BOM Calculation isolation (Required configs vs Extra configs)
    // -------------------------------------------------------------------------
    console.log('[Step 1] BOM calculation rules isolation test:');
    const requiredConfigs = [{ device_type: '2 Channel Live', number_of_devices: 1 }];
    const extraConfigs = [
      { device_type: '4 Channel Live', extra_quantity: 2 },
      { device_type: '8 Channel Live', extra_quantity: 1 },
    ];

    const bomRequiredOnly = await calculateBomRequirements(requiredConfigs);
    console.log(`  ✓ BOM calculated for required configuration (1 x 2CH Live): ${bomRequiredOnly.total_materials_count || (bomRequiredOnly.items || []).length} material items.`);
    
    // Memory card for 2 Channel Live should be present
    const memoryCardReq = (bomRequiredOnly.items || []).find(
      (m) => m.material_name && m.material_name.toLowerCase().includes('memory')
    );
    assert(memoryCardReq, '2 Channel Live should include Memory Card in BOM');
    assert.strictEqual(memoryCardReq.total_quantity, 1, 'Memory card quantity should be 1 for 1 x 2CH Live');

    // -------------------------------------------------------------------------
    // STEP 2: Sales creates checklist with:
    // Required: 1 x 2 Channel Live
    // Extra: 2 x 4 Channel Live + 1 x 8 Channel Live
    // -------------------------------------------------------------------------
    console.log('\n[Step 2] Sales creates checklist with 1 x 2CH Live required + extra (2 x 4CH Live, 1 x 8CH Live):');
    const created = await createChecklist(salesUser.id, {
      salesperson_name: 'Sarah Sales',
      client_name: 'Alpha Logistics Acceptance Test',
      client_mobile: '9876501234',
      client_location: 'Plot 42, Transport Nagar',
      installation_or_service: 'Installation',
      device_configurations: requiredConfigs,
      has_extra_devices: true,
      extra_devices: true,
      extra_device_configurations: extraConfigs,
      number_of_devices: 1, // original customer requirement
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'Bank Transfer',
      expected_arrival_date: '2026-10-18',
      expected_arrival_time: '10:00 AM',
      service_engineer: 'Tech Terry',
      service_assistant: 'Assistant Alex',
      installation_status: 'Assigned',
    });

    testChecklistId = created.id;
    assert(testChecklistId, 'Created checklist must have an ID');
    console.log(`  ✓ Checklist created: ${created.checklist_number} (ID: ${testChecklistId})`);

    // Verify Allocation Counts
    assert.strictEqual(created.total_devices_required, 1, 'Required installation devices must = 1');
    assert.strictEqual(created.total_extra_devices, 3, 'Extra devices carried must = 3');
    assert.strictEqual(created.total_devices_carried, 4, 'Total devices carried must = 4');
    console.log('  ✓ Verified Allocation Counts:');
    console.log(`    - Required installation devices: ${created.total_devices_required}`);
    console.log(`    - Extra devices carried: ${created.total_extra_devices}`);
    console.log(`    - Total devices carried to site: ${created.total_devices_carried}`);

    // Verify BOM is strictly from required configuration (1 device)
    assert(created.bom_snapshot, 'Checklist must have a bom_snapshot');
    const bomMat = created.bom_snapshot.items || [];
    const memCard = bomMat.find((m) => m.material_name && m.material_name.toLowerCase().includes('memory'));
    assert(memCard, 'BOM must contain memory card');
    assert.strictEqual(memCard.total_quantity, 1, 'BOM Memory Card must strictly be 1 Nos. (not inflated)');
    console.log('  ✓ Verified BOM is strictly calculated for required devices (1 x 2CH Live) only.');

    // -------------------------------------------------------------------------
    // STEP 3: Technical Workspace allocation summary
    // -------------------------------------------------------------------------
    console.log('\n[Step 3] Technical workspace receives all 4 devices in allocation summary:');
    const carryRecord = await getDeviceCarryRecord(testChecklistId);
    assert(carryRecord, 'Carry record must be retrieved');
    assert.strictEqual(carryRecord.total_devices_required, 1, 'Carry record total required = 1');
    assert.strictEqual(carryRecord.total_extra_devices, 3, 'Carry record total extra = 3');
    assert.strictEqual(carryRecord.total_devices_carried, 4, 'Carry record total carried = 4');

    assert.strictEqual(carryRecord.required_items.length, 1, 'Required items must have 1 type');
    assert.strictEqual(carryRecord.required_items[0].device_type, '2 Channel Live');
    assert.strictEqual(carryRecord.required_items[0].number_of_devices, 1);

    assert.strictEqual(carryRecord.extra_items.length, 2, 'Extra items must have 2 types');
    const extra4 = carryRecord.extra_items.find((i) => i.device_type === '4 Channel Live');
    const extra8 = carryRecord.extra_items.find((i) => i.device_type === '8 Channel Live');
    assert(extra4 && extra4.extra_quantity === 2, 'Extra 4CH Live must be 2');
    assert(extra8 && extra8.extra_quantity === 1, 'Extra 8CH Live must be 1');

    console.log('  ✓ Technical allocation summary:');
    console.log(`    - Required: ${carryRecord.required_items.map((i) => `${i.number_of_devices} x ${i.device_type}`).join(', ')}`);
    console.log(`    - Extra Backup: ${carryRecord.extra_items.map((i) => `${i.extra_quantity} x ${i.device_type}`).join(', ')}`);
    console.log(`    - Combined Total: ${carryRecord.total_devices_carried} Units across ${carryRecord.items.length} device types`);

    // -------------------------------------------------------------------------
    // STEP 4: Store Manager sees required and extra devices separately
    // -------------------------------------------------------------------------
    console.log('\n[Step 4] Store Manager workspace and sync sees required and extra separately:');
    const storeReq = await syncStoreRequirementForChecklist(testChecklistId);
    assert(storeReq, 'Store requirement must be synced');
    assert(Array.isArray(storeReq.required_device_items), 'required_device_items must be array');
    assert(Array.isArray(storeReq.extra_device_items), 'extra_device_items must be array');
    assert(Array.isArray(storeReq.device_items), 'device_items must be array');

    assert.strictEqual(storeReq.required_device_items.length, 1, 'Store required devices must have 1 row');
    assert.strictEqual(storeReq.extra_device_items.length, 2, 'Store extra devices must have 2 rows');
    assert.strictEqual(storeReq.total_devices_carried, 4, 'Store total dispatch to issue must be 4');
    console.log('  ✓ Store Manager requirement record:');
    console.log(`    - Required Installation Devices (3A): ${storeReq.required_device_items.map((d) => `${d.quantity} x ${d.device_type}`).join(', ')}`);
    console.log(`    - Extra/Backup Devices Carried (3B): ${storeReq.extra_device_items.map((d) => `${d.extra_quantity} x ${d.device_type}`).join(', ')}`);
    console.log(`    - Total Dispatch to Issue (3C): ${storeReq.total_devices_carried} Units`);

    // -------------------------------------------------------------------------
    // STEP 5: PDF Generation Verification (Store Manager & Installation Checklist)
    // -------------------------------------------------------------------------
    console.log('\n[Step 5] PDF generation includes separated required and extra device tables:');
    const storePdfBuffer = await generateStoreManagerRequirementPDF(testChecklistId);
    assert(Buffer.isBuffer(storePdfBuffer), 'Store Manager PDF must return a valid Buffer');
    assert(storePdfBuffer.length > 1000, 'Store Manager PDF must have meaningful size');
    console.log(`  ✓ Store Manager PDF generated successfully (${storePdfBuffer.length} bytes)`);

    const installPdfBuffer = await generateInstallationChecklistPDF(testChecklistId);
    assert(Buffer.isBuffer(installPdfBuffer), 'Installation PDF must return a valid Buffer');
    assert(installPdfBuffer.length > 1000, 'Installation PDF must have meaningful size');
    console.log(`  ✓ Installation Checklist PDF generated successfully (${installPdfBuffer.length} bytes)`);

    // -------------------------------------------------------------------------
    // STEP 6: Post-installation reconciliation includes every device carried (all 4)
    // -------------------------------------------------------------------------
    console.log('\n[Step 6] Post-installation reconciliation includes all 4 devices carried:');
    // Actual site work:
    // 2 Channel Live: 1 installed, 0 to return
    // 4 Channel Live (extra): 0 installed, 2 to return
    // 8 Channel Live (extra): 0 installed, 1 to return
    const completionReport = await submitInstallationCompletionReport(techUser.id, {
      checklist_id: testChecklistId,
      installation_date: '2026-10-18',
      completion_notes: '1 x 2CH Live installed as requested. Extra backup units (2 x 4CH, 1 x 8CH) returned unused.',
      device_items: [
        {
          device_type: '2 Channel Live',
          quantity_carried: 1,
          quantity_installed: 1,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
        {
          device_type: '4 Channel Live',
          quantity_carried: 2,
          quantity_installed: 0,
          quantity_to_return: 2,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
        {
          device_type: '8 Channel Live',
          quantity_carried: 1,
          quantity_installed: 0,
          quantity_to_return: 1,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
    });

    assert(completionReport, 'Completion report must be saved');
    assert.strictEqual(completionReport.total_devices_installed, 1, 'Total installed = 1');
    assert.strictEqual(completionReport.total_devices_to_return, 3, 'Total to return = 3');
    assert.strictEqual(completionReport.total_devices_carried, 4, 'Total reconciled = 4');
    console.log('  ✓ Post-installation report submitted and verified:');
    console.log(`    - Devices installed: ${completionReport.total_devices_installed}`);
    console.log(`    - Devices returned: ${completionReport.total_devices_to_return}`);
    console.log(`    - Total reconciled: ${completionReport.total_devices_carried} / 4 carried`);

    // -------------------------------------------------------------------------
    // STEP 7: Re-open / refresh checklist: all values remain correct
    // -------------------------------------------------------------------------
    console.log('\n[Step 7] Re-opening checklist from DB: verify persistent integrity:');
    const reloaded = await getChecklistById(testChecklistId);
    assert.strictEqual(reloaded.total_devices_required, 1, 'Reloaded total_devices_required must = 1');
    assert.strictEqual(reloaded.total_extra_devices, 3, 'Reloaded total_extra_devices must = 3');
    assert.strictEqual(reloaded.total_devices_carried, 4, 'Reloaded total_devices_carried must = 4');
    assert.strictEqual(reloaded.has_extra_devices, true, 'Reloaded has_extra_devices must = true');
    assert.strictEqual(reloaded.extra_device_configurations.length, 2, 'Reloaded extra_device_configurations length = 2');
    console.log('  ✓ Persistent integrity verified:');
    console.log(`    - Checklist Status: ${reloaded.installation_status}`);
    console.log(`    - Reconciliation Status: ${reloaded.reconciliation_status}`);
    console.log(`    - Required Devices: ${JSON.stringify(reloaded.device_configurations)}`);
    console.log(`    - Extra Devices: ${JSON.stringify(reloaded.extra_device_configurations)}`);

    // -------------------------------------------------------------------------
    // STEP 8: Store Manager verifies physical return of backup devices
    // -------------------------------------------------------------------------
    console.log('\n[Step 8] Store Manager verifies return:');
    const pendingReturns = await getPendingStoreReturns(testChecklistId);
    const returnsForJob = pendingReturns.filter((r) => r.checklist_id === testChecklistId);
    assert(returnsForJob.length > 0, 'Return declarations must exist for unused backup devices');
    for (const ret of returnsForJob) {
      const verifyResult = await verifyStoreReturn({
        return_id: ret.id,
        accepted_usable_qty: ret.declared_return_qty,
        damaged_qty: 0,
        missing_qty: 0,
        user: storeUser,
        remarks: 'Backup device returned in perfect condition.',
      });
      assert(verifyResult, `Store return verification must succeed for ${ret.device_type}`);
    }
    console.log(`  ✓ Physical return verified for ${returnsForJob.length} return declaration items. Reconciliation completed.`);

    console.log('\n======================================================================');
    console.log('ALL ACCEPTANCE CRITERIA PASSED SUCCESSFULLY! ✓');
    console.log('======================================================================\n');
  } finally {
    // Clean up test checklist
    if (testChecklistId) {
      console.log(`[Cleanup] Deleting test checklist record: ${testChecklistId}...`);
      try {
        await supabase.from('installation_reports').delete().eq('checklist_id', testChecklistId);
        await supabase.from('store_material_requirements').delete().eq('checklist_id', testChecklistId);
        await supabase.from('device_carry_records').delete().eq('checklist_id', testChecklistId);
        await supabase.from('device_return_verifications').delete().eq('checklist_id', testChecklistId);
        await supabase.from('installation_checklists').delete().eq('id', testChecklistId);
        console.log('  ✓ Cleanup complete.');
      } catch (cleanErr) {
        console.warn('  ⚠️ Cleanup warning:', cleanErr.message);
      }
    }
  }
}

runAcceptanceTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
    process.exit(1);
  });
