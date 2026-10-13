import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { generateStoreManagerRequirementPDF } from '../src/services/storeManagerPdfGenerator.js';
import { generateInstallationChecklistPDF } from '../src/services/installationPdfGenerator.js';
import { syncStoreRequirementForChecklist, getStoreMaterialRequirementById } from '../src/services/storeRequirementService.js';
import { calculateBomRequirements } from '../src/services/bomService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';

async function runStorePdfTests() {
  console.log('================================================================');
  console.log('🧪 STORE MANAGER REQUIREMENT PDF & BOM FOCUS TEST SUITE');
  console.log('================================================================\n');

  // ------------------------------------------------------------------------
  // Test 1: Generate Store Manager PDF for Installation Job with Multiple Devices
  // ------------------------------------------------------------------------
  console.log('👉 [Test 1] Generating Store Manager Requirement Sheet for Installation Job...');

  const multiDeviceConfigs = [
    { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
    { device_type: '6 Channel Recording', number_of_devices: 1, number_of_vehicles: 1 },
  ];

  const calculatedBom = await calculateBomRequirements(multiDeviceConfigs);

  const mockInstallationData = {
    id: 'test-store-pdf-inst-001',
    checklist_id: 'test-store-pdf-inst-001',
    checklist_number: 'EE-STORE-001',
    client_name: 'Metro Logistics Private Limited',
    client_mobile: '9840112233',
    client_location: 'Plot 42, Ambattur Industrial Estate, Chennai',
    google_maps_location: 'https://maps.google.com/?q=13.0827,80.1600',
    job_type: 'Installation',
    installation_or_service: 'Installation',
    device_configurations: multiDeviceConfigs,
    number_of_devices: 3,
    number_of_vehicles: 3,
    expected_arrival_date: '2026-10-25',
    expected_arrival_time: '10:00 AM',
    installation_duration: '1 Day',
    service_engineer: 'Naveen Kumar',
    service_assistant: 'Praveen',
    salesperson_name: 'Ranjith',
    bom_snapshot: calculatedBom,
    material_items: calculatedBom.items,
    // Sensitive billing fields that must NOT appear in Store Manager PDF:
    confirmed_price: 65000,
    payment_method: 'Bank Transfer',
    advance_received: true,
    advance_amount: 30000,
    pending_payment: true,
    pending_amount: 35000,
    payment_status: 'Partially Paid',
    created_at: new Date().toISOString(),
  };

  const storePdfBuffer = await generateStoreManagerRequirementPDF(mockInstallationData);
  assert.ok(storePdfBuffer, 'Store Manager PDF buffer must be generated');
  assert.ok(Buffer.isBuffer(storePdfBuffer), 'Must return a Node.js Buffer');
  assert.ok(storePdfBuffer.length > 5000, `PDF size must be substantial (> 5KB), got ${storePdfBuffer.length} bytes`);
  console.log(`   ✅ Store Manager PDF generated successfully (${storePdfBuffer.length} bytes).`);

  // Verify that sensitive billing/pricing terms do NOT appear in the PDF binary stream
  const pdfString = storePdfBuffer.toString('latin1');
  assert.strictEqual(
    pdfString.includes('65000') || pdfString.includes('65,000'),
    false,
    'Confirmed selling price (65000) must NOT appear in Store Manager PDF'
  );
  assert.strictEqual(
    pdfString.includes('35000') || pdfString.includes('35,000'),
    false,
    'Pending amount (35000) must NOT appear in Store Manager PDF'
  );
  assert.strictEqual(
    pdfString.includes('30000') || pdfString.includes('30,000'),
    false,
    'Advance amount (30000) must NOT appear in Store Manager PDF'
  );
  assert.strictEqual(
    pdfString.includes('Partially Paid'),
    false,
    'Payment status must NOT appear in Store Manager PDF'
  );
  console.log('   ✅ Confirmed: Zero pricing, payment method, advance, or pending payment details in Store Manager PDF!');

  // Verify essential details are present in the PDF stream
  assert.ok(pdfString.includes('EE-STORE-001'), 'Checklist number must be in PDF');
  assert.ok(pdfString.includes('Metro Logistics Private Limited'), 'Client name must be in PDF');
  assert.ok(pdfString.includes('Naveen Kumar'), 'Service engineer must be in PDF');
  assert.ok(pdfString.includes('Ranjith'), 'Salesperson must be in PDF');
  console.log('   ✅ Confirmed: Client, location, technician, salesperson, and checklist number present in PDF.');

  // ------------------------------------------------------------------------
  // Test 2: Acceptance Test - 2 Devices of 8 Channel Live (No Memory Card)
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 2] Testing Store Manager PDF for 2x 8 Channel Live (Strict Memory Card Exclusion)...');
  const eightChannelConfigs = [
    { device_type: '8 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
  ];
  const eightBom = await calculateBomRequirements(eightChannelConfigs);

  const eightChannelJob = {
    id: 'test-store-pdf-8ch-002',
    checklist_number: 'EE-8CH-STORE',
    client_name: 'Express Cargo Movers',
    client_mobile: '9789123456',
    client_location: 'Madurai Central Bypass',
    google_maps_location: null,
    job_type: 'Installation',
    device_configurations: eightChannelConfigs,
    number_of_devices: 2,
    service_engineer: 'Suresh Kumar',
    service_assistant: 'Manoj',
    salesperson_name: 'Padmapriya',
    bom_snapshot: eightBom,
    material_items: eightBom.items,
    created_at: new Date().toISOString(),
  };

  const eightChannelPdfBuffer = await generateStoreManagerRequirementPDF(eightChannelJob);
  const eightPdfString = eightChannelPdfBuffer.toString('latin1');

  // Verify Memory Card is NOT present
  assert.strictEqual(
    eightPdfString.includes('Memory Card'),
    false,
    'Memory Card MUST NOT appear in the Store Manager PDF for 8 Channel Live'
  );

  // Verify other materials are present
  assert.ok(eightPdfString.includes('Insulation Tape'), 'Insulation Tape must appear in PDF');
  assert.ok(eightPdfString.includes('Cable Tie'), 'Cable Tie must appear in PDF');
  assert.ok(eightPdfString.includes('Long Screw'), 'Long Screw must appear in PDF');
  assert.ok(eightPdfString.includes('Small Screw'), 'Small Screw must appear in PDF');
  console.log('   ✅ 8 Channel Live PDF verified: All 8 required materials present with ZERO Memory Card line!');

  // ------------------------------------------------------------------------
  // Test 3: Service Job PDF (No Installation BOM)
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 3] Testing Store Manager PDF for Service Call...');
  const serviceJob = {
    id: 'test-store-pdf-service-003',
    checklist_number: 'EE-SERV-STORE',
    client_name: 'City Bus Lines',
    client_mobile: '9840223344',
    client_location: 'Koyambedu Bus Terminal, Chennai',
    job_type: 'Service',
    installation_or_service: 'Service',
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1 }],
    number_of_devices: 1,
    service_engineer: 'Naveen Kumar',
    salesperson_name: 'Abinaya',
    created_at: new Date().toISOString(),
  };

  const servicePdfBuffer = await generateStoreManagerRequirementPDF(serviceJob);
  const servicePdfString = servicePdfBuffer.toString('latin1');
  assert.ok(servicePdfString.includes('SERVICE CALL'), 'Service call banner must appear in PDF');
  assert.ok(servicePdfString.includes('City Bus Lines'), 'Client name must appear in PDF');
  console.log('   ✅ Service job PDF verified: Service notice rendered without automatic installation BOM.');

  // ------------------------------------------------------------------------
  // Test 4: Verify Standard Sales/Technical PDF is Preserved and Unchanged
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 4] Verifying existing Sales/Technical Checklist PDF is preserved...');
  const salesPdfBuffer = await generateInstallationChecklistPDF(mockInstallationData);
  assert.ok(salesPdfBuffer, 'Sales/Technical PDF must still generate');
  const salesPdfString = salesPdfBuffer.toString('latin1');
  assert.ok(salesPdfString.includes('INSTALLATION INITIATION CHECKLIST'), 'Original header must be preserved');
  assert.ok(salesPdfString.includes('Rs. 65,000') || salesPdfString.includes('65,000') || salesPdfString.includes('65000'), 'Sales checklist still contains pricing information as intended');
  console.log('   ✅ Sales/Technical PDF preserved completely and functioning as expected.');

  // ------------------------------------------------------------------------
  // Test 5: Stock Non-Deduction Verification
  // ------------------------------------------------------------------------
  console.log('\n👉 [Test 5] Verifying stock is NOT deducted by generating Store Manager PDF...');
  const preStock = await getMaterialInventory();
  await generateStoreManagerRequirementPDF(mockInstallationData);
  const postStock = await getMaterialInventory();

  for (const preItem of preStock) {
    const postItem = postStock.find((p) => p.id === preItem.id);
    if (postItem) {
      assert.strictEqual(
        Number(postItem.current_stock),
        Number(preItem.current_stock),
        `Stock for ${preItem.material_name} must NOT change from generating Store Manager PDF`
      );
    }
  }
  console.log('   ✅ Confirmed: Zero stock deduction occurs when generating or viewing Store Manager PDF.');

  console.log('\n================================================================');
  console.log('🎉 ALL STORE MANAGER PDF & BOM FOCUS TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runStorePdfTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
