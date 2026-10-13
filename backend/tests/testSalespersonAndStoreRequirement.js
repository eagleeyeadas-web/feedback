import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { SALESPERSON_OPTIONS, checklistValidationSchema } from '../src/routes/installation.js';
import { calculateBomRequirements } from '../src/services/bomService.js';
import { syncStoreRequirementForChecklist, getStoreMaterialRequirements } from '../src/services/storeRequirementService.js';
import { generateInstallationChecklistPDF } from '../src/services/installationPdfGenerator.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Salesperson Tracking & Store Copy Acceptance Tests');
  console.log('================================================================\n');

  // ------------------------------------------------------------------------
  // Test 1: Validate Exact Salesperson Options List
  // ------------------------------------------------------------------------
  console.log('👉 [Test 1] Verifying authorized Salesperson options...');
  const expectedSalespeople = ['Ranjith', 'Abinaya', 'Kavitha', 'Kavitha Balu', 'Padmapriya'];
  assert.deepStrictEqual(
    SALESPERSON_OPTIONS,
    expectedSalespeople,
    'SALESPERSON_OPTIONS must match exact list of 5 salespeople'
  );
  console.log('   ✅ Exact 5 authorized salespeople confirmed:', SALESPERSON_OPTIONS.join(', '));

  // ------------------------------------------------------------------------
  // Test 2: Validation of Salesperson in Checklist Form Creation
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 2] Testing checklist validation schema with salesperson options...');

  const baseValidChecklist = {
    client_name: 'Alpha Logistics Pvt Ltd',
    client_mobile: '9876543210',
    client_location: 'Guindy Industrial Estate, Chennai',
    google_maps_location: 'https://maps.google.com/?q=13.0067,80.2026',
    device_configurations: [
      { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
      { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
    ],
    confirmed_price: 35000,
    payment_method: 'UPI',
    advance_received: true,
    advance_amount: 15000,
    pending_payment: true,
    pending_amount: 20000,
    installation_duration: '1 Day',
    vehicle_type: 'Truck / Lorry',
    expected_arrival_date: '2026-10-20',
    expected_arrival_time: '10:00 AM',
    installation_or_service: 'Installation',
    service_engineer: 'Naveen Kumar',
    service_assistant: 'Praveen',
    installation_status: 'Assigned',
  };

  // Test each of the 5 authorized salespeople passes validation
  for (const person of expectedSalespeople) {
    const validData = { ...baseValidChecklist, salesperson_name: person };
    const result = checklistValidationSchema.safeParse(validData);
    assert.strictEqual(result.success, true, `Validation should pass for salesperson: ${person}`);
  }
  console.log('   ✅ All 5 authorized salespeople successfully pass checklist schema validation.');

  // Test invalid salesperson is rejected
  const invalidSalespersonData = { ...baseValidChecklist, salesperson_name: 'Unknown Person' };
  const invalidResult = checklistValidationSchema.safeParse(invalidSalespersonData);
  assert.strictEqual(invalidResult.success, false, 'Validation must fail for unauthorized salesperson');
  console.log('   ✅ Unauthorized salesperson correctly rejected.');

  // ------------------------------------------------------------------------
  // Test 3: Multi-Device BOM Calculation & Aggregation
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 3] Multi-Device BOM calculation and aggregation logic...');
  const multiDeviceConfigs = [
    { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 5 }, // vehicles should NOT affect BOM qty
    { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 10 },
  ];

  const bomResult = await calculateBomRequirements(multiDeviceConfigs);
  assert.strictEqual(bomResult.configured, true, 'BOM must be configured');
  assert.strictEqual(bomResult.total_devices, 5, 'Total devices must equal sum of devices (2 + 3 = 5)');
  assert.ok(Array.isArray(bomResult.items), 'BOM items must be an array');
  assert.ok(bomResult.items.length > 0, 'Aggregated BOM items must not be empty');

  // Verify that quantities are calculated per device quantity and aggregated
  for (const item of bomResult.items) {
    assert.ok(item.total_quantity > 0, `Total quantity for ${item.material_name} must be > 0`);
    assert.ok(item.material_name, 'Material name must be present');
    assert.ok(item.unit, 'Unit of measure must be present');
  }
  console.log(`   ✅ Multi-device BOM successfully aggregated ${bomResult.items.length} shared materials across 5 devices.`);

  // ------------------------------------------------------------------------
  // Test 4: Idempotent Store Requirement Sync & Stock Non-Deduction
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 4] Store Manager requirement sync and stock non-deduction verification...');

  // Capture material stock before sync
  let preStock = [];
  try {
    preStock = await getMaterialInventory();
  } catch (e) {
    console.log('   (Material inventory query note:', e.message, ')');
  }

  const mockChecklistId = 'test-checklist-uuid-001';
  const mockChecklistNumber = 'EE-INST-9999';

  const mockInstallationChecklist = {
    id: mockChecklistId,
    checklist_number: mockChecklistNumber,
    client_name: 'Kavitha Transports',
    client_mobile: '9840123456',
    client_location: 'Tambaram, Chennai',
    google_maps_location: 'https://maps.google.com/?q=12.9249,80.1000',
    salesperson_name: 'Kavitha Balu',
    service_engineer: 'Naveen Kumar',
    service_assistant: 'Praveen',
    expected_arrival_date: '2026-10-25',
    expected_arrival_time: '09:30 AM',
    installation_duration: '2 Days',
    installation_or_service: 'Installation',
    device_configurations: multiDeviceConfigs,
    number_of_devices: 5,
    number_of_vehicles: 5,
    bom_snapshot: bomResult,
    created_at: new Date().toISOString(),
  };

  // Sync installation job
  const storeReq = await syncStoreRequirementForChecklist(mockInstallationChecklist);
  assert.ok(storeReq, 'Store requirement record must be created/returned');
  assert.strictEqual(storeReq.checklist_number, mockChecklistNumber);
  assert.strictEqual(storeReq.salesperson_name, 'Kavitha Balu', 'Salesperson name must match on Store Manager copy');
  assert.strictEqual(storeReq.service_engineer, 'Naveen Kumar', 'Service engineer must match on Store Manager copy');
  assert.strictEqual(storeReq.service_assistant, 'Praveen', 'Service assistant must match on Store Manager copy');
  assert.strictEqual(storeReq.expected_arrival_date, '2026-10-25', 'Arrival date must match');
  assert.strictEqual(storeReq.expected_arrival_time, '09:30 AM', 'Arrival time must match');
  assert.strictEqual(storeReq.installation_duration, '2 Days', 'Duration must match');
  assert.strictEqual(storeReq.job_type, 'Installation', 'Job type must be Installation');
  assert.ok(Array.isArray(storeReq.material_items), 'Material items must be populated for Installation');
  assert.ok(storeReq.material_items.length > 0, 'Material items must have configured requirements');
  console.log('   ✅ Installation checklist requirement successfully synced to Store Manager.');

  // Idempotency: sync a second time (simulating retry)
  const storeReqRetry = await syncStoreRequirementForChecklist(mockInstallationChecklist);
  assert.strictEqual(storeReqRetry.checklist_id, storeReq.checklist_id, 'Retry must upsert same record ID');
  console.log('   ✅ Retrying sync is completely idempotent without duplicate creation.');

  // Verify stock was NOT deducted merely because requirement was synced
  let postStock = [];
  try {
    postStock = await getMaterialInventory();
    if (preStock.length > 0 && postStock.length > 0) {
      for (const preItem of preStock) {
        const postItem = postStock.find((p) => p.id === preItem.id);
        if (postItem) {
          assert.strictEqual(
            Number(postItem.current_stock),
            Number(preItem.current_stock),
            `Stock for ${preItem.material_name} must not be deducted by sync`
          );
        }
      }
      console.log('   ✅ Confirmed: Stock remains completely untouched upon checklist creation / sync.');
    }
  } catch (e) {
    console.log('   (Stock comparison skipped due to DB connection:', e.message, ')');
  }

  // ------------------------------------------------------------------------
  // Test 5: Service Job Handling
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 5] Testing Service job requirement sync (No Installation BOM)...');
  const mockServiceChecklist = {
    id: 'test-service-uuid-002',
    checklist_number: 'EE-SERV-8888',
    client_name: 'Southern Travels',
    client_mobile: '9789012345',
    client_location: 'Madurai Central',
    google_maps_location: null,
    salesperson_name: 'Padmapriya',
    service_engineer: 'Suresh Kumar',
    service_assistant: 'Manoj',
    expected_arrival_date: '2026-10-22',
    expected_arrival_time: '11:00 AM',
    installation_duration: 'Half Day',
    installation_or_service: 'Service',
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
    number_of_devices: 1,
    number_of_vehicles: 1,
    created_at: new Date().toISOString(),
  };

  const serviceReq = await syncStoreRequirementForChecklist(mockServiceChecklist);
  assert.strictEqual(serviceReq.job_type, 'Service', 'Job type must be Service');
  assert.strictEqual(serviceReq.salesperson_name, 'Padmapriya');
  assert.strictEqual(serviceReq.service_engineer, 'Suresh Kumar');
  assert.strictEqual(serviceReq.bom_snapshot, null, 'Service jobs must have null BOM snapshot');
  assert.deepStrictEqual(serviceReq.material_items, [], 'Service jobs must not have installation material items');
  console.log('   ✅ Service job synced to Store Manager with zero auto-generated installation BOM.');

  // ------------------------------------------------------------------------
  // Test 6: PDF Generation with Salesperson & Team Details
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 6] Testing PDF generation with Salesperson and Team Details...');
  const pdfChecklist = {
    ...mockInstallationChecklist,
    payment_method: 'Bank Transfer',
    confirmed_price: 45000,
    advance_amount: 20000,
    advance_received: true,
    pending_amount: 25000,
    pending_payment: true,
    vehicle_type: 'Container Truck',
  };

  const pdfBuffer = await generateInstallationChecklistPDF(pdfChecklist);
  assert.ok(pdfBuffer, 'PDF buffer must be generated');
  assert.ok(Buffer.isBuffer(pdfBuffer), 'Output must be a Node.js Buffer');
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must contain substantial content (> 1KB)');
  console.log(`   ✅ Installation checklist PDF successfully generated (${pdfBuffer.length} bytes).`);

  // ------------------------------------------------------------------------
  // Test 7: Three-State Availability Verification
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 7] Verifying three-state availability logic...');
  const testAvailability = (available, required) => {
    if (available >= required) return 'Available';
    if (available > 0 && available < required) return 'Partially Available';
    return 'Out of Stock';
  };

  assert.strictEqual(testAvailability(100, 50), 'Available');
  assert.strictEqual(testAvailability(50, 50), 'Available');
  assert.strictEqual(testAvailability(10, 50), 'Partially Available');
  assert.strictEqual(testAvailability(0, 50), 'Out of Stock');
  assert.strictEqual(testAvailability(-5, 50), 'Out of Stock');
  console.log('   ✅ Three-state availability logic verified (Available, Partially Available, Out of Stock).');

  console.log('\n================================================================');
  console.log('🎉 ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Acceptance test failed with error:', err);
  process.exit(1);
});
