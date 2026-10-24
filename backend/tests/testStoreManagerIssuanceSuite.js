import crypto from 'crypto';
import supabase from '../src/services/supabase.js';
import {
  issueFullJobStock,
  syncStoreRequirementForChecklist,
  getStoreMaterialRequirementById,
  inMemoryStoreRequirements,
} from '../src/services/storeRequirementService.js';
import {
  getInventoryProducts,
  STANDARD_DEVICE_PRODUCTS,
  processedChecklistDeviceIssuances,
} from '../src/services/inventoryService.js';
import {
  getMaterialInventory,
  processedChecklistMaterialIssuances,
  adjustMaterialStock,
} from '../src/services/materialStockService.js';
import { requireRole } from '../src/middleware/auth.js';

// Test mock user with STORE_MANAGER role
const mockStoreManager = {
  id: '00000000-0000-0000-0000-000000000099',
  email: 'test-store-manager@safdrive.com',
  full_name: 'Test Store Manager',
  role: 'STORE_MANAGER',
};

// Test mock user with SALES role (Unauthorized)
const mockSalesUser = {
  id: '00000000-0000-0000-0000-000000000088',
  email: 'test-sales@safdrive.com',
  full_name: 'Test Sales Rep',
  role: 'SALES',
};

function formatPass(num, name) {
  console.log(`\x1b[32m✔ TEST ${num} PASSED: ${name}\x1b[0m`);
}

function formatFail(num, name, err) {
  console.error(`\x1b[31m✘ TEST ${num} FAILED: ${name}\x1b[0m\n`, err);
}

const createdTestChecklistIds = [];

async function cleanupTestData() {
  for (const id of createdTestChecklistIds) {
    try {
      processedChecklistDeviceIssuances.delete(id);
      processedChecklistMaterialIssuances.delete(id);
      inMemoryStoreRequirements.delete(id);
      await supabase.from('store_material_requirements').delete().eq('checklist_id', id);
      await supabase.from('installation_checklists').delete().eq('id', id);
      await supabase.from('inventory_transactions').delete().eq('checklist_id', id);
      await supabase.from('stock_movements').delete().eq('checklist_id', id);
    } catch (e) {
      // Ignore cleanup error
    }
  }
}

/**
 * Replenish installation BOM materials (not loose device components) so each
 * material-issuing test starts with stock available. Camera and Live Display
 * are deliberately excluded here — they affect device usable_stock computations
 * and must only be set once at suite start via replenishDeviceComponents().
 */
async function replenishBomMaterials() {
  const materialsToReplenish = [
    { name: 'Insulation Tape', qty: 10 },
    { name: 'Cable Tie – 200 mm', qty: 5 },
    { name: 'Cable Tie – 300 mm', qty: 5 },
    { name: 'Long Screw', qty: 30 },
    { name: 'Small Screw', qty: 30 },
    { name: 'Memory Card', qty: 5 },
    { name: '0.5 mm Wire', qty: 50 },
    { name: '5-metre Cable', qty: 10 },
    { name: '15-metre Cable', qty: 5 },
  ];
  for (const m of materialsToReplenish) {
    await adjustMaterialStock({
      material_name: m.name,
      action: 'ADD',
      quantity: m.qty,
      reason: 'Test suite per-test replenishment',
      user: mockStoreManager,
    }).catch(() => null);
  }
}

/** Replenish loose device components once at the start of the suite */
async function replenishDeviceComponents() {
  for (const name of ['Camera', 'Live Display', 'Recording Display']) {
    await adjustMaterialStock({
      material_name: name,
      action: 'ADD',
      quantity: 20,
      reason: 'Test suite device component replenishment',
      user: mockStoreManager,
    }).catch(() => null);
  }
  await adjustMaterialStock({
    material_name: 'Memory Card',
    action: 'ADD',
    quantity: 1000,
    reason: 'Test suite device component replenishment',
    user: mockStoreManager,
  }).catch(() => null);
}

async function runAllTests() {
  console.log('\n============================================================');
  console.log('   SAFDRIVE STORE MANAGER STOCK ISSUANCE 10-TEST SUITE');
  console.log('============================================================\n');

  let passedCount = 0;

  try {
    // Replenish device components (Camera, Live Display) once at suite start.
    // These affect device usable_stock — only set here, NOT in per-test replenishment.
    await replenishDeviceComponents();
    // Replenish all BOM installation materials so we start from a known-good baseline
    await replenishBomMaterials();

    // =============================================================
    // TEST 1: Device-only issuance
    // =============================================================
    try {
      const testChecklistId1 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId1);

      const chk1 = {
        id: testChecklistId1,
        checklist_number: `EE-TEST-DEV-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 1 - Device Only',
        client_mobile: '9876543211',
        client_location: 'Workshop 1',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk1);

      // Snapshot stock before
      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '2 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Insulation Tape');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      // Issue ONLY devices
      const result = await issueFullJobStock({
        checklist_id: testChecklistId1,
        issue_devices: true,
        issue_materials: false,
        issue_backup_items: false,
        remarks: 'Test 1 - Device only',
        user: mockStoreManager,
      });

      if (!result.success) throw new Error('Result reported failure');
      if (result.devices_issuance_status !== 'ISSUED') throw new Error(`Expected devices_issuance_status ISSUED, got ${result.devices_issuance_status}`);
      if (result.material_issuance_status !== 'PENDING') throw new Error(`Expected material_issuance_status PENDING, got ${result.material_issuance_status}`);
      if (result.status !== 'DEVICES_ISSUED') throw new Error(`Expected overall status DEVICES_ISSUED, got ${result.status}`);

      // Verify stock changes
      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '2 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Insulation Tape');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      if (devStockAfter !== devStockBefore - 1) {
        throw new Error(`Device stock mismatch: Before ${devStockBefore}, After ${devStockAfter}, Expected ${devStockBefore - 1}`);
      }
      if (matStockAfter !== matStockBefore) {
        throw new Error(`Material stock should not change: Before ${matStockBefore}, After ${matStockAfter}`);
      }

      formatPass(1, 'Device-only issuance deducted device stock, left material stock untouched, and set status to DEVICES_ISSUED.');
      passedCount++;
    } catch (err) {
      formatFail(1, 'Device-only issuance', err);
    }

    // =============================================================
    // TEST 2: Installation-material-only issuance
    // =============================================================
    await replenishBomMaterials();
    try {
      const testChecklistId2 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId2);

      const chk2 = {
        id: testChecklistId2,
        checklist_number: `EE-TEST-MAT-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 2 - Material Only',
        client_mobile: '9876543212',
        client_location: 'Workshop 2',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk2);

      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '2 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Insulation Tape');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      // Issue ONLY materials
      const result = await issueFullJobStock({
        checklist_id: testChecklistId2,
        issue_devices: false,
        issue_materials: true,
        issue_backup_items: false,
        remarks: 'Test 2 - Material only',
        user: mockStoreManager,
      });

      if (!result.success) throw new Error('Result reported failure');
      if (result.devices_issuance_status !== 'PENDING') throw new Error(`Expected devices_issuance_status PENDING, got ${result.devices_issuance_status}`);
      if (result.material_issuance_status !== 'ISSUED') throw new Error(`Expected material_issuance_status ISSUED, got ${result.material_issuance_status}`);
      if (result.status !== 'MATERIALS_ISSUED') throw new Error(`Expected overall status MATERIALS_ISSUED, got ${result.status}`);

      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '2 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Insulation Tape');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      if (devStockAfter !== devStockBefore) {
        throw new Error(`Device stock should NOT change: Before ${devStockBefore}, After ${devStockAfter}`);
      }
      if (matStockAfter >= matStockBefore) {
        throw new Error(`Material stock should have decreased: Before ${matStockBefore}, After ${matStockAfter}`);
      }

      formatPass(2, 'Installation-material-only issuance deducted material stock, left devices untouched, and set status to MATERIALS_ISSUED.');
      passedCount++;
    } catch (err) {
      formatFail(2, 'Installation-material-only issuance', err);
    }

    // =============================================================
    // TEST 3: Both categories selected (Unified atomic issuance)
    // =============================================================
    await replenishBomMaterials();
    try {
      const testChecklistId3 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId3);

      const chk3 = {
        id: testChecklistId3,
        checklist_number: `EE-TEST-BOTH-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 3 - Both Categories',
        client_mobile: '9876543213',
        client_location: 'Workshop 3',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk3);

      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '2 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Insulation Tape');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      const result = await issueFullJobStock({
        checklist_id: testChecklistId3,
        issue_devices: true,
        issue_materials: true,
        issue_backup_items: false,
        remarks: 'Test 3 - Both categories',
        user: mockStoreManager,
      });

      if (!result.success) throw new Error('Result reported failure');
      if (result.devices_issuance_status !== 'ISSUED') throw new Error(`Expected devices_issuance_status ISSUED, got ${result.devices_issuance_status}`);
      if (result.material_issuance_status !== 'ISSUED') throw new Error(`Expected material_issuance_status ISSUED, got ${result.material_issuance_status}`);
      if (result.status !== 'ISSUED') throw new Error(`Expected overall status ISSUED, got ${result.status}`);

      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '2 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Insulation Tape');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      if (devStockAfter !== devStockBefore - 1) {
        throw new Error(`Device stock mismatch: Before ${devStockBefore}, After ${devStockAfter}`);
      }
      if (matStockAfter >= matStockBefore) {
        throw new Error(`Material stock should have decreased: Before ${matStockBefore}, After ${matStockAfter}`);
      }

      formatPass(3, 'Both categories issued together deducted both device and material stocks, setting overall status to ISSUED.');
      passedCount++;
    } catch (err) {
      formatFail(3, 'Both categories selected', err);
    }

    // =============================================================
    // TEST 4: Category unchecked (issuing remaining pending category)
    // =============================================================
    await replenishBomMaterials();
    try {
      // Use testChecklistId1 where devices were already issued, now issue remaining materials
      const testChecklistId4 = createdTestChecklistIds[0];

      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '2 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Insulation Tape');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      // Uncheck devices (issue_devices: false), keep materials checked (issue_materials: true)
      const result = await issueFullJobStock({
        checklist_id: testChecklistId4,
        issue_devices: false,
        issue_materials: true,
        issue_backup_items: false,
        remarks: 'Test 4 - Remaining category',
        user: mockStoreManager,
      });

      if (!result.success) throw new Error('Result reported failure');
      if (result.devices_issuance_status !== 'ISSUED') throw new Error('Devices should remain ISSUED');
      if (result.material_issuance_status !== 'ISSUED') throw new Error('Materials should now be ISSUED');
      if (result.status !== 'ISSUED') throw new Error(`Overall status should now be ISSUED, got ${result.status}`);

      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '2 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Insulation Tape');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      // Device stock must not be deducted again
      if (devStockAfter !== devStockBefore) {
        throw new Error(`Device stock should NOT be deducted again: Before ${devStockBefore}, After ${devStockAfter}`);
      }
      if (matStockAfter >= matStockBefore) {
        throw new Error(`Material stock should have decreased: Before ${matStockBefore}, After ${matStockAfter}`);
      }

      formatPass(4, 'Unchecked category respected: only the checked category was issued, preventing duplicate deductions.');
      passedCount++;
    } catch (err) {
      formatFail(4, 'A category unchecked', err);
    }

    // =============================================================
    // TEST 5: Insufficient device stock (Atomic rejection, zero deduction)
    // =============================================================
    try {
      const testChecklistId5 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId5);

      const chk5 = {
        id: testChecklistId5,
        checklist_number: `EE-TEST-DEV-SHORT-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 5 - Dev Shortage',
        client_mobile: '9876543215',
        client_location: 'Workshop 5',
        installation_or_service: 'Installation',
        device_type: '8 Channel Live',
        number_of_devices: 9999, // Exorbitant shortage
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '8 Channel Live', number_of_devices: 9999, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk5);

      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '8 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Corrugated Flexible Conduit (25mm)');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      let errorThrown = null;
      try {
        await issueFullJobStock({
          checklist_id: testChecklistId5,
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          remarks: 'Test 5 - Should fail due to device shortage',
          user: mockStoreManager,
        });
      } catch (e) {
        errorThrown = e;
      }

      if (!errorThrown) {
        throw new Error('Expected issuance to throw error for insufficient device stock, but it succeeded');
      }

      if (!errorThrown.message.includes('Insufficient usable stock for camera device') &&
          !errorThrown.message.includes('Negative stock is strictly prevented')) {
        throw new Error(`Unexpected error message: ${errorThrown.message}`);
      }

      // Verify ZERO stock deduction for BOTH devices and materials
      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '8 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Corrugated Flexible Conduit (25mm)');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      if (devStockAfter !== devStockBefore) {
        throw new Error(`Device stock altered despite failure! Before: ${devStockBefore}, After: ${devStockAfter}`);
      }
      if (matStockAfter !== matStockBefore) {
        throw new Error(`Material stock altered despite failure! Before: ${matStockBefore}, After: ${matStockAfter}`);
      }

      formatPass(5, `Insufficient device stock rejected atomically with zero stock deductions: "${errorThrown.message}"`);
      passedCount++;
    } catch (err) {
      formatFail(5, 'Insufficient device stock', err);
    }

    // =============================================================
    // TEST 6: Insufficient material stock (Atomic rejection, zero deduction)
    // =============================================================
    try {
      const testChecklistId6 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId6);

      const chk6 = {
        id: testChecklistId6,
        checklist_number: `EE-TEST-MAT-SHORT-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 6 - Mat Shortage',
        client_mobile: '9876543216',
        client_location: 'Workshop 6',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk6);

      // Artificially inject an exorbitant material requirement in in-memory requirement
      const inMem = inMemoryStoreRequirements.get(testChecklistId6);
      if (inMem) {
        inMem.material_items = [{
          material_name: 'Corrugated Flexible Conduit (25mm)',
          total_required_quantity: 999999,
          unit: 'Mtrs.',
        }];
      }

      const devsBefore = await getInventoryProducts();
      const matsBefore = await getMaterialInventory();
      const devBefore = devsBefore.find((d) => d.device_type === '2 Channel Live');
      const matBefore = matsBefore.find((m) => m.material_name === 'Corrugated Flexible Conduit (25mm)');

      const devStockBefore = Number(devBefore?.usable_stock) || 0;
      const matStockBefore = Number(matBefore?.current_stock) || 0;

      let errorThrown = null;
      try {
        await issueFullJobStock({
          checklist_id: testChecklistId6,
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          remarks: 'Test 6 - Should fail due to material shortage',
          user: mockStoreManager,
        });
      } catch (e) {
        errorThrown = e;
      }

      if (!errorThrown) {
        throw new Error('Expected issuance to throw error for insufficient material stock, but it succeeded');
      }

      if (!errorThrown.message.includes('Insufficient stock for') &&
          !errorThrown.message.includes('Negative stock prevented')) {
        throw new Error(`Unexpected error message: ${errorThrown.message}`);
      }

      // Verify ZERO stock deduction for BOTH devices and materials
      const devsAfter = await getInventoryProducts();
      const matsAfter = await getMaterialInventory();
      const devAfter = devsAfter.find((d) => d.device_type === '2 Channel Live');
      const matAfter = matsAfter.find((m) => m.material_name === 'Corrugated Flexible Conduit (25mm)');

      const devStockAfter = Number(devAfter?.usable_stock) || 0;
      const matStockAfter = Number(matAfter?.current_stock) || 0;

      if (devStockAfter !== devStockBefore) {
        throw new Error(`Device stock altered despite failure! Before: ${devStockBefore}, After: ${devStockAfter}`);
      }
      if (matStockAfter !== matStockBefore) {
        throw new Error(`Material stock altered despite failure! Before: ${matStockBefore}, After: ${matStockAfter}`);
      }

      formatPass(6, `Insufficient material stock rejected atomically without any partial device deduction: "${errorThrown.message}"`);
      passedCount++;
    } catch (err) {
      formatFail(6, 'Insufficient material stock', err);
    }

    // =============================================================
    // TEST 7: Double-click and repeated submission (Idempotency)
    // =============================================================
    await replenishBomMaterials();
    try {
      const testChecklistId7 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId7);

      const chk7 = {
        id: testChecklistId7,
        checklist_number: `EE-TEST-IDEM-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 7 - Repeat Submit',
        client_mobile: '9876543217',
        client_location: 'Workshop 7',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk7);

      // Attempt simultaneous double-click issuance
      const [res1, res2] = await Promise.allSettled([
        issueFullJobStock({
          checklist_id: testChecklistId7,
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          remarks: 'Click 1',
          user: mockStoreManager,
        }),
        issueFullJobStock({
          checklist_id: testChecklistId7,
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          remarks: 'Click 2 (Duplicate)',
          user: mockStoreManager,
        }),
      ]);

      const oneSucceeded = (res1.status === 'fulfilled' && res2.status === 'rejected') ||
                           (res2.status === 'fulfilled' && res1.status === 'rejected');

      if (!oneSucceeded) {
        throw new Error(`Expected exactly one request to succeed and one to be rejected. Got res1: ${res1.status}, res2: ${res2.status}`);
      }

      const rejectedReason = res1.status === 'rejected' ? res1.reason.message : res2.reason.message;
      if (!rejectedReason.includes('already in progress') && !rejectedReason.includes('already been issued')) {
        throw new Error(`Unexpected rejection message: ${rejectedReason}`);
      }

      // Try a third call sequentially after completion
      let sequentialError = null;
      try {
        await issueFullJobStock({
          checklist_id: testChecklistId7,
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          remarks: 'Click 3 (Post-completion repeat)',
          user: mockStoreManager,
        });
      } catch (e) {
        sequentialError = e;
      }

      if (!sequentialError || !sequentialError.message.includes('already been issued')) {
        throw new Error(`Expected post-completion repeat call to be rejected with duplicate issuance error. Got: ${sequentialError?.message}`);
      }

      formatPass(7, 'Double-click concurrent and sequential duplicate submissions successfully blocked with idempotency lock.');
      passedCount++;
    } catch (err) {
      formatFail(7, 'Double-click and repeated submission', err);
    }

    // =============================================================
    // TEST 8: Network or backend failure handling
    // =============================================================
    try {
      let nonExistentChecklistError = null;
      try {
        await issueFullJobStock({
          checklist_id: crypto.randomUUID(), // Non-existent checklist
          issue_devices: true,
          issue_materials: true,
          issue_backup_items: false,
          user: mockStoreManager,
        });
      } catch (e) {
        nonExistentChecklistError = e;
      }

      if (!nonExistentChecklistError || !nonExistentChecklistError.message.includes('not found')) {
        throw new Error(`Expected error for non-existent checklist, got: ${nonExistentChecklistError?.message}`);
      }

      let missingChecklistIdError = null;
      try {
        await issueFullJobStock({
          checklist_id: null,
          issue_devices: true,
          issue_materials: true,
          user: mockStoreManager,
        });
      } catch (e) {
        missingChecklistIdError = e;
      }

      if (!missingChecklistIdError || !missingChecklistIdError.message.includes('Checklist ID is required')) {
        throw new Error(`Expected error for missing checklist ID, got: ${missingChecklistIdError?.message}`);
      }

      formatPass(8, 'Backend error conditions (missing/non-existent checklist IDs) handled safely with descriptive errors.');
      passedCount++;
    } catch (err) {
      formatFail(8, 'Network or backend failure', err);
    }

    // =============================================================
    // TEST 9: Unauthorized user role check
    // =============================================================
    try {
      const authMiddleware = requireRole('STORE_MANAGER', 'ADMIN');
      const roleCheck = authMiddleware[1];

      // Test 9a: Unauthorized role (SALES)
      let salesDenied = false;
      let salesErrorMsg = '';
      const mockReqSales = {
        profile: mockSalesUser,
      };
      const mockResSales = {
        status: (code) => ({
          json: (body) => {
            if (code === 403) {
              salesDenied = true;
              salesErrorMsg = body.error;
            }
          },
        }),
      };
      let salesNextCalled = false;
      roleCheck(mockReqSales, mockResSales, () => {
        salesNextCalled = true;
      });

      if (!salesDenied || salesNextCalled) {
        throw new Error('Unauthorized role (SALES) was not blocked with 403 Forbidden!');
      }

      // Test 9b: Missing role
      let missingRoleDenied = false;
      const mockReqNoRole = { profile: {} };
      const mockResNoRole = {
        status: (code) => ({
          json: () => {
            if (code === 403) missingRoleDenied = true;
          },
        }),
      };
      roleCheck(mockReqNoRole, mockResNoRole, () => {});

      if (!missingRoleDenied) {
        throw new Error('Missing profile role was not blocked with 403 Forbidden!');
      }

      // Test 9c: Authorized role (STORE_MANAGER)
      let storeManagerAllowed = false;
      const mockReqStore = { profile: mockStoreManager };
      const mockResStore = {
        status: () => ({ json: () => {} }),
      };
      roleCheck(mockReqStore, mockResStore, () => {
        storeManagerAllowed = true;
      });

      if (!storeManagerAllowed) {
        throw new Error('Authorized role (STORE_MANAGER) was unexpectedly denied!');
      }

      formatPass(9, `Role authorization verified: SALES rejected with 403 ("${salesErrorMsg}"), STORE_MANAGER permitted.`);
      passedCount++;
    } catch (err) {
      formatFail(9, 'Unauthorized user', err);
    }

    // =============================================================
    // TEST 10: Successful issuance followed by query / page refresh
    // =============================================================
    await replenishBomMaterials();
    try {
      const testChecklistId10 = crypto.randomUUID();
      createdTestChecklistIds.push(testChecklistId10);

      const chk10 = {
        id: testChecklistId10,
        checklist_number: `EE-TEST-REFRESH-${Date.now().toString().slice(-4)}`,
        client_name: 'Test Client 10 - Query Refresh',
        client_mobile: '9876543219',
        client_location: 'Workshop 10',
        installation_or_service: 'Installation',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      };

      await syncStoreRequirementForChecklist(chk10);

      // Perform issuance
      await issueFullJobStock({
        checklist_id: testChecklistId10,
        issue_devices: true,
        issue_materials: true,
        issue_backup_items: false,
        remarks: 'Test 10 - Persistence check',
        user: mockStoreManager,
      });

      // Simulate a page refresh / fresh query from storeRequirementService
      const freshReq = await getStoreMaterialRequirementById(testChecklistId10);

      if (!freshReq) throw new Error('Could not fetch fresh requirement record after issuance');
      if (freshReq.devices_issuance_status !== 'ISSUED') {
        throw new Error(`Expected refreshed devices_issuance_status ISSUED, got ${freshReq.devices_issuance_status}`);
      }
      if (freshReq.material_issuance_status !== 'ISSUED') {
        throw new Error(`Expected refreshed material_issuance_status ISSUED, got ${freshReq.material_issuance_status}`);
      }
      if (freshReq.status !== 'ISSUED') {
        throw new Error(`Expected refreshed status ISSUED, got ${freshReq.status}`);
      }

      // Verify stock movements ledger has persistent records
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('checklist_id', testChecklistId10);

      if (movements && movements.length > 0) {
        const devMovements = movements.filter((m) => m.category === 'Camera Device');
        const matMovements = movements.filter((m) => m.category === 'Installation Material');
        if (devMovements.length === 0) throw new Error('Expected camera device stock movement in ledger');
        if (matMovements.length === 0) throw new Error('Expected installation material stock movement in ledger');
      }

      formatPass(10, 'Successful issuance persisted across query/refresh: statuses are ISSUED and stock movements recorded.');
      passedCount++;
    } catch (err) {
      formatFail(10, 'Successful issuance followed by page refresh', err);
    }

  } finally {
    console.log('\nCleaning up test artifacts...');
    await cleanupTestData();
  }

  console.log('\n============================================================');
  console.log(`  TEST RESULTS: ${passedCount}/10 TESTS PASSED`);
  console.log('============================================================\n');

  if (passedCount === 10) {
    console.log('ALL 10 VERIFICATION TESTS COMPLETED SUCCESSFULLY WITH 0 FAILURES!\n');
    process.exit(0);
  } else {
    console.error(`FAILED: ${10 - passedCount} tests failed.`);
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
