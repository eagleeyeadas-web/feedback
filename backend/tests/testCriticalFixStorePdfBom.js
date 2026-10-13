import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  calculateBomRequirements,
  parseDeviceConfigurations,
  getBomByDeviceType,
  getAllBoms,
} from '../src/services/bomService.js';
import {
  syncStoreRequirementForChecklist,
  getStoreMaterialRequirementById,
  getStoreMaterialRequirements,
} from '../src/services/storeRequirementService.js';
import { generateStoreManagerRequirementPDF } from '../src/services/storeManagerPdfGenerator.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';

async function runCriticalFixTests() {
  console.log('================================================================');
  console.log('🧪 CRITICAL FIX: STORE MANAGER PDF BOM CALCULATION TEST SUITE');
  console.log('================================================================\n');

  // ------------------------------------------------------------------------
  // Test 1: Robust parsing of composite / summary device strings
  // ------------------------------------------------------------------------
  console.log('👉 [Test 1] Testing parseDeviceConfigurations with various string formats...');

  const parsed1 = parseDeviceConfigurations('4 Channel Live (2), 8 Channel Live (1)');
  assert.strictEqual(parsed1.length, 2, 'Must parse exactly 2 device types');
  assert.strictEqual(parsed1[0].device_type, '4 Channel Live');
  assert.strictEqual(parsed1[0].number_of_devices, 2);
  assert.strictEqual(parsed1[1].device_type, '8 Channel Live');
  assert.strictEqual(parsed1[1].number_of_devices, 1);
  console.log('   ✅ Successfully parsed "4 Channel Live (2), 8 Channel Live (1)"');

  const parsed2 = parseDeviceConfigurations([{ device_type: '4 Channel Live (2), 8 Channel Live (1)', number_of_devices: 3 }]);
  assert.strictEqual(parsed2.length, 2, 'Must unpack single array element with composite string');
  assert.strictEqual(parsed2[0].number_of_devices, 2);
  assert.strictEqual(parsed2[1].number_of_devices, 1);
  console.log('   ✅ Successfully unpacked composite string inside array of configurations');

  const parsed3 = parseDeviceConfigurations({ device_type: '4 Channel Live', number_of_devices: 2 });
  assert.strictEqual(parsed3.length, 1);
  assert.strictEqual(parsed3[0].device_type, '4 Channel Live');
  assert.strictEqual(parsed3[0].number_of_devices, 2);
  console.log('   ✅ Successfully handled single device object');

  // ------------------------------------------------------------------------
  // Test 2: Calculate BOM for 4 Channel Live × 2 and 8 Channel Live × 1
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 2] Calculating BOM for 4 Channel Live (2) and 8 Channel Live (1)...');

  const calc = await calculateBomRequirements('4 Channel Live (2), 8 Channel Live (1)');
  assert.strictEqual(calc.configured, true, 'BOM calculation must be configured and successful');
  assert.strictEqual(calc.total_devices, 3, 'Total devices must be 3');
  assert.strictEqual(calc.items.length, 9, 'Must contain exactly 9 combined material requirements');

  const itemMap = new Map(calc.items.map((it) => [it.material_name, it]));

  // Verify exact quantities from requirement specification:
  // Insulation Tape: 2 * 2 + 2 * 1 = 6 Nos.
  assert.strictEqual(itemMap.get('Insulation Tape')?.total_quantity, 6, 'Insulation Tape must be 6');
  // Cable Tie – 200 mm: 1 * 2 + 1 * 1 = 3 Packets
  assert.strictEqual(itemMap.get('Cable Tie – 200 mm')?.total_quantity, 3, 'Cable Tie – 200 mm must be 3');
  // Cable Tie – 300 mm: 1 * 2 + 1 * 1 = 3 Packets
  assert.strictEqual(itemMap.get('Cable Tie – 300 mm')?.total_quantity, 3, 'Cable Tie – 300 mm must be 3');
  // Long Screw: 12 * 2 + 12 * 1 = 36 Nos.
  assert.strictEqual(itemMap.get('Long Screw')?.total_quantity, 36, 'Long Screw must be 36');
  // Small Screw: 12 * 2 + 12 * 1 = 36 Nos.
  assert.strictEqual(itemMap.get('Small Screw')?.total_quantity, 36, 'Small Screw must be 36');
  // Memory Card: 1 * 2 + 0 * 1 = 2 Nos. (8 Channel Live excluded!)
  assert.strictEqual(itemMap.get('Memory Card')?.total_quantity, 2, 'Memory Card must be exactly 2 (not 3!)');
  // 0.5 mm Wire: 20 * 2 + 20 * 1 = 60 Metres
  assert.strictEqual(itemMap.get('0.5 mm Wire')?.total_quantity, 60, '0.5 mm Wire must be 60');
  // 5-metre Cable: 3 * 2 + 3 * 1 = 9 Nos.
  assert.strictEqual(itemMap.get('5-metre Cable')?.total_quantity, 9, '5-metre Cable must be 9');
  // 15-metre Cable: 1 * 2 + 1 * 1 = 3 Nos.
  assert.strictEqual(itemMap.get('15-metre Cable')?.total_quantity, 3, '15-metre Cable must be 3');

  console.log('   ✅ All 9 material requirements match calculated values precisely!');
  console.log('   ✅ Confirmed: Memory Card is 2 (8 Channel Live contributed 0 Memory Cards).');

  // ------------------------------------------------------------------------
  // Test 3: Sync Store Requirement for Checklist with Summary String
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 3] Syncing Store Requirement from checklist with summary device_type string...');

  const initialInventory = await getMaterialInventory();
  const initialTapeStock = initialInventory.find((m) => m.material_name === 'Insulation Tape')?.current_stock;

  const mockChecklist = {
    id: 'test-chk-4ch-8ch-' + Date.now(),
    checklist_number: 'EE-TEST-4CH8CH',
    client_name: 'Alpha Logistics Tech',
    client_mobile: '9840998877',
    client_location: 'Guindy Industrial Estate, Chennai',
    google_maps_location: 'https://maps.google.com/?q=13.0067,80.2025',
    installation_or_service: 'Installation',
    device_type: '4 Channel Live (2), 8 Channel Live (1)',
    number_of_devices: 3,
    number_of_vehicles: 3,
    salesperson_name: 'Ranjith',
    service_engineer: 'Naveen Kumar',
    service_assistant: 'Praveen',
    expected_arrival_date: '2026-10-30',
    expected_arrival_time: '09:30 AM',
    installation_duration: '1 Day',
    confirmed_price: 75000,
    payment_method: 'UPI',
    created_at: new Date().toISOString(),
  };

  const syncedReq = await syncStoreRequirementForChecklist(mockChecklist);
  assert.ok(syncedReq, 'Requirement must be synced successfully');
  assert.strictEqual(syncedReq.material_items?.length, 9, 'Material items in requirement must be 9');
  assert.strictEqual(syncedReq.device_items?.length, 2, 'Device items in requirement must be 2');

  // Stock check: Creating/syncing must NEVER deduct inventory stock
  const postSyncInventory = await getMaterialInventory();
  const postSyncTapeStock = postSyncInventory.find((m) => m.material_name === 'Insulation Tape')?.current_stock;
  assert.strictEqual(
    postSyncTapeStock,
    initialTapeStock,
    'Stock must NOT be deducted when calculating or syncing BOM'
  );
  console.log('   ✅ Confirmed: Stock balances remain unchanged until material issuance.');

  // ------------------------------------------------------------------------
  // Test 4: Generate Store Manager PDF & verify NO BOM WARNING
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 4] Generating Store Manager PDF for the synced job...');

  const pdfBuffer = await generateStoreManagerRequirementPDF(syncedReq);
  assert.ok(pdfBuffer, 'PDF buffer must be generated');
  assert.ok(pdfBuffer.length > 5000, `PDF size must be > 5KB, got ${pdfBuffer.length} bytes`);

  const pdfText = pdfBuffer.toString('latin1');

  // Assert NO BOM warning is NOT present
  assert.strictEqual(
    pdfText.includes('NO BOM MATERIALS CONFIGURED FOR SELECTED DEVICES'),
    false,
    'PDF must NOT contain "NO BOM MATERIALS CONFIGURED FOR SELECTED DEVICES" warning!'
  );
  console.log('   ✅ Confirmed: "NO BOM MATERIALS CONFIGURED FOR SELECTED DEVICES" warning is completely GONE!');

  // Assert BOM table materials are present in PDF
  assert.ok(pdfText.includes('Insulation Tape'), 'Insulation Tape must be in PDF');
  assert.ok(pdfText.includes('Cable Tie'), 'Cable Tie must be in PDF');
  assert.ok(pdfText.includes('Long Screw'), 'Long Screw must be in PDF');
  assert.ok(pdfText.includes('Small Screw'), 'Small Screw must be in PDF');
  assert.ok(pdfText.includes('Memory Card'), 'Memory Card must be in PDF');
  assert.ok(pdfText.includes('0.5 mm Wire'), '0.5 mm Wire must be in PDF');
  assert.ok(pdfText.includes('5-metre Cable'), '5-metre Cable must be in PDF');
  assert.ok(pdfText.includes('15-metre Cable'), '15-metre Cable must be in PDF');
  console.log('   ✅ Confirmed: All required fitting materials are displayed in the PDF BOM table!');

  // Assert zero billing info
  assert.strictEqual(pdfText.includes('75000') || pdfText.includes('75,000'), false, 'Price must NOT appear');
  assert.strictEqual(pdfText.includes('UPI'), false, 'Payment method must NOT appear');
  console.log('   ✅ Confirmed: Billing & pricing strictly excluded from Store Manager PDF.');

  // ------------------------------------------------------------------------
  // Test 5: PDF self-healing from bare checklist object
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 5] Generating Store Manager PDF directly from bare checklist object without pre-saved BOM...');

  const bareChecklistData = {
    checklist_number: 'EE-BARE-999',
    client_name: 'Bare Metal Transport',
    client_mobile: '9123456789',
    client_location: 'Madhavaram, Chennai',
    job_type: 'Installation',
    device_type: '4 Channel Live (2), 8 Channel Live (1)',
    number_of_devices: 3,
    salesperson_name: 'Abinaya',
    service_engineer: 'Naveen Kumar',
  };

  const directPdf = await generateStoreManagerRequirementPDF(bareChecklistData);
  const directPdfText = directPdf.toString('latin1');
  assert.strictEqual(
    directPdfText.includes('NO BOM MATERIALS CONFIGURED FOR SELECTED DEVICES'),
    false,
    'Direct PDF generation must self-heal and calculate BOM automatically!'
  );
  assert.ok(directPdfText.includes('Insulation Tape'), 'Direct PDF must contain BOM table');
  console.log('   ✅ Confirmed: Bare checklist without pre-saved BOM self-heals in PDF generator!');

  // ------------------------------------------------------------------------
  // Test 6: Re-fetch requirement detail (Idempotence & Refreshing)
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 6] Testing requirement retrieval & refreshing...');

  const fetchedReq = await getStoreMaterialRequirementById(mockChecklist.id);
  assert.ok(fetchedReq, 'Fetched requirement must exist');
  assert.strictEqual(fetchedReq.material_items?.length, 9, 'Refetched requirement retains 9 BOM items');
  console.log('   ✅ Confirmed: Refreshing does not lose BOM information.');

  console.log('\n================================================================');
  console.log('🎉 ALL 6 CRITICAL FIX ACCEPTANCE TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runCriticalFixTests().catch((err) => {
  console.error('❌ Critical Fix test failed:', err);
  process.exit(1);
});
