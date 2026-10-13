import {
  calculateBomRequirements,
  getAllBoms,
  updateDeviceBom,
  STANDARD_DEVICE_TYPES,
} from '../services/bomService.js';
import { checklistValidationSchema } from '../routes/installation.js';
import { generateInstallationChecklistPDF } from '../services/installationPdfGenerator.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING MULTIPLE DEVICE TYPES BOM VERIFICATION SUITE');
  console.log('========================================================\n');

  // 1. Verify standard device types
  console.log('[Test 1] Verify 7 exact standard device types');
  assert(STANDARD_DEVICE_TYPES.length === 7, 'Exact 7 device types configured');
  assert(STANDARD_DEVICE_TYPES.includes('2 Channel Live'), 'Includes 2 Channel Live');
  assert(STANDARD_DEVICE_TYPES.includes('2 Channel Recording'), 'Includes 2 Channel Recording');
  assert(STANDARD_DEVICE_TYPES.includes('4 Channel Live'), 'Includes 4 Channel Live');
  assert(STANDARD_DEVICE_TYPES.includes('4 Channel Recording'), 'Includes 4 Channel Recording');
  assert(STANDARD_DEVICE_TYPES.includes('6 Channel Live'), 'Includes 6 Channel Live');
  assert(STANDARD_DEVICE_TYPES.includes('6 Channel Recording'), 'Includes 6 Channel Recording');
  assert(STANDARD_DEVICE_TYPES.includes('8 Channel Live'), 'Includes 8 Channel Live');

  // 2. Multi-device calculation combining shared materials
  console.log('\n[Test 2] Multi-device BOM calculation combining shared materials');
  const multiConfig = [
    { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
    { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
  ];
  const calcResult = await calculateBomRequirements(multiConfig);
  assert(calcResult.configured === true, 'Calculation succeeded and configured');
  assert(calcResult.total_devices === 5, 'Total devices is 2 + 3 = 5');
  assert(calcResult.total_vehicles === 5, 'Total vehicles is 2 + 3 = 5');
  assert(Array.isArray(calcResult.items) && calcResult.items.length > 0, 'Combined items generated');
  
  // Check shared material: Memory Card (1 per device) -> Total 5
  const memItem = calcResult.items.find((i) => i.material_name.toLowerCase().includes('memory'));
  if (memItem) {
    assert(memItem.total_quantity === 5, `Shared material Memory Card combined quantity = 5 (got ${memItem.total_quantity})`);
    assert(Array.isArray(memItem.breakdown) && memItem.breakdown.length === 2, 'Memory Card has breakdown for both device types');
  } else {
    assert(false, 'Memory Card found in combined materials');
  }

  // Check shared material: Insulation Tape (2 per device) -> Total 10
  const tapeItem = calcResult.items.find((i) => i.material_name.toLowerCase().includes('tape'));
  if (tapeItem) {
    assert(tapeItem.total_quantity === 10, `Shared material Insulation Tape combined quantity = 10 (got ${tapeItem.total_quantity})`);
  } else {
    assert(false, 'Insulation Tape found in combined materials');
  }

  // 3. Automatic duplicate device-type combination
  console.log('\n[Test 3] Automatic duplicate device-type combination');
  const duplicateConfig = [
    { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
    { device_type: '2 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
  ];
  const dupResult = await calculateBomRequirements(duplicateConfig);
  assert(dupResult.configured === true, 'Duplicate calculation configured');
  assert(dupResult.total_devices === 5, 'Duplicate device quantities combined: 2 + 3 = 5');
  assert(dupResult.total_vehicles === 5, 'Duplicate vehicle quantities combined: 2 + 3 = 5');
  assert(dupResult.device_configurations.length === 1, 'Combined into a single normalized entry');

  // 4. Positive whole number validation
  console.log('\n[Test 4] Positive whole number validation (> 0)');
  const zeroQtyConfig = [
    { device_type: '2 Channel Live', number_of_devices: 0, number_of_vehicles: 1 },
  ];
  const zeroResult = await calculateBomRequirements(zeroQtyConfig);
  assert(zeroResult.configured === false, 'Zero quantity rejected as unconfigured/invalid');
  assert(zeroResult.warning && zeroResult.warning.includes('positive whole number'), 'Warning specifies positive whole number');

  const negativeQtyConfig = [
    { device_type: '2 Channel Live', number_of_devices: -2, number_of_vehicles: 1 },
  ];
  const negResult = await calculateBomRequirements(negativeQtyConfig);
  assert(negResult.configured === false, 'Negative quantity rejected');

  // 5. Unconfigured BOM warning (Requirement 9: show warning and do not display incomplete calculation as final)
  console.log('\n[Test 5] Unconfigured BOM warning & non-final calculation');
  const unconfiguredTestConfig = [
    { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
    { device_type: 'Unknown Device Type X', number_of_devices: 1, number_of_vehicles: 1 },
  ];
  const unconfResult = await calculateBomRequirements(unconfiguredTestConfig);
  assert(unconfResult.configured === false, 'Incomplete calculation flagged as configured=false');
  assert(unconfResult.warning && unconfResult.warning.includes('No Bill of Materials (BOM) is configured'), 'Warning issued for unconfigured device');
  assert(unconfResult.items.length === 0, 'Items list kept empty to not display incomplete calculation as final');

  // 6. Backward compatibility with single-device parameter call
  console.log('\n[Test 6] Backward compatibility with single-device parameters');
  const legacyCalc = await calculateBomRequirements('4 Channel Live', 3);
  assert(legacyCalc.configured === true, 'Legacy call configured');
  assert(legacyCalc.total_devices === 3, 'Legacy call total_devices = 3');
  assert(legacyCalc.items.length > 0, 'Legacy call returns items');

  // 7. Zod checklistValidationSchema verification
  console.log('\n[Test 7] Zod Checklist Validation Schema');
  const validMultiChecklist = {
    client_name: 'Test Fleet Logistics',
    client_mobile: '9876543210',
    client_location: 'Bangalore Depot',
    device_configurations: [
      { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
      { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
    ],
    confirmed_price: 50000,
    payment_method: 'UPI',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    expected_arrival_date: '2026-10-15',
    expected_arrival_time: '10:00',
    installation_or_service: 'Installation',
    service_engineer: 'Ramesh Kumar',
    service_assistant: 'Suresh Raina',
    installation_status: 'Assigned',
    payment_status: 'Pending',
    client_confirmation: 'Confirmed',
  };
  const parsedMulti = checklistValidationSchema.safeParse(validMultiChecklist);
  assert(parsedMulti.success === true, 'Zod parses valid multi-device checklist');

  // Legacy single device payload
  const validLegacyChecklist = {
    client_name: 'Legacy Fleet Logistics',
    client_mobile: '9876543210',
    client_location: 'Chennai Depot',
    device_type: '2 Channel Live',
    number_of_devices: 2,
    number_of_vehicles: 2,
    confirmed_price: 20000,
    payment_method: 'UPI',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    expected_arrival_date: '2026-10-15',
    expected_arrival_time: '10:00',
    installation_or_service: 'Installation',
    service_engineer: 'Ramesh Kumar',
    service_assistant: 'Suresh Raina',
    installation_status: 'Assigned',
    payment_status: 'Pending',
    client_confirmation: 'Confirmed',
  };
  const parsedLegacy = checklistValidationSchema.safeParse(validLegacyChecklist);
  assert(parsedLegacy.success === true, 'Zod parses legacy single-device checklist for backward compatibility');

  // 8. PDF Generation with Multi-Device table
  console.log('\n[Test 8] PDF Generation with Multi-Device table & BOM snapshot');
  const mockChecklistForPdf = {
    id: 'test-uuid-1',
    checklist_number: 'EE-INST-20261012-0099',
    client_name: 'Southern Freight Corp',
    client_mobile: '9876543210',
    client_location: 'Coimbatore Hub',
    device_type: '2 Channel Live (2), 4 Channel Live (3)',
    number_of_devices: 5,
    number_of_vehicles: 5,
    device_configurations: [
      { device_type: '2 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
      { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
    ],
    confirmed_price: 65000,
    payment_method: 'Bank Transfer',
    advance_received: true,
    advance_amount: 30000,
    pending_payment: true,
    pending_amount: 35000,
    installation_duration: '2 Days',
    vehicle_type: 'Lorry',
    expected_arrival_date: '2026-10-16',
    expected_arrival_time: '09:30',
    installation_or_service: 'Installation',
    service_engineer: 'Ramesh Kumar',
    service_assistant: 'Vijay Shankar',
    installation_status: 'Assigned',
    payment_status: 'Partially Paid',
    client_confirmation: 'Confirmed',
    bom_snapshot: calcResult,
    created_at: new Date().toISOString(),
  };

  const pdfBuffer = await generateInstallationChecklistPDF(mockChecklistForPdf);
  assert(Buffer.isBuffer(pdfBuffer), 'PDF generated as Node Buffer');
  assert(pdfBuffer.length > 5000, `PDF size is valid (${pdfBuffer.length} bytes)`);

  console.log('\n========================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
