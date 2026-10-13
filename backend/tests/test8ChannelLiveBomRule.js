import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  calculateBomRequirements,
  getBomByDeviceType,
  getAllBoms,
  STANDARD_DEVICE_TYPES,
} from '../src/services/bomService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import { syncStoreRequirementForChecklist } from '../src/services/storeRequirementService.js';

async function run8ChannelBomTests() {
  console.log('================================================================');
  console.log('🧪 8 CHANNEL LIVE BOM RULE VERIFICATION & ACCEPTANCE TEST');
  console.log('================================================================\n');

  // ------------------------------------------------------------------------
  // Acceptance Test: Select 2 devices of 8 Channel Live
  // ------------------------------------------------------------------------
  console.log('👉 [Acceptance Test] Calculate BOM for 2 devices of 8 Channel Live...');
  const acceptCalc = await calculateBomRequirements([
    { device_type: '8 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
  ]);

  assert.strictEqual(acceptCalc.configured, true, 'Calculation must be marked configured');
  assert.strictEqual(acceptCalc.total_devices, 2, 'Total devices must be 2');

  const items = acceptCalc.items;
  console.log(`   Found ${items.length} materials in calculated BOM.`);

  // Assert Memory Card is completely excluded
  const memCard = items.find((i) => i.material_name.toLowerCase().includes('memory card'));
  assert.strictEqual(memCard, undefined, 'Memory Card MUST NOT appear in the BOM required-material list for 8 Channel Live');

  // Verify the exact expected materials from prompt:
  // 4 insulation tapes
  const tape = items.find((i) => i.material_name.toLowerCase().includes('insulation tape'));
  assert.ok(tape, 'Insulation Tape must be present');
  assert.strictEqual(tape.total_quantity, 4, `Insulation Tape quantity must be 4, got ${tape.total_quantity}`);

  // 2 packets of each cable-tie type (200 mm & 300 mm)
  const tie200 = items.find((i) => i.material_name.toLowerCase().includes('200 mm'));
  assert.ok(tie200, 'Cable Tie – 200 mm must be present');
  assert.strictEqual(tie200.total_quantity, 2, `Cable Tie – 200 mm quantity must be 2, got ${tie200.total_quantity}`);

  const tie300 = items.find((i) => i.material_name.toLowerCase().includes('300 mm'));
  assert.ok(tie300, 'Cable Tie – 300 mm must be present');
  assert.strictEqual(tie300.total_quantity, 2, `Cable Tie – 300 mm quantity must be 2, got ${tie300.total_quantity}`);

  // 24 long screws
  const screwLong = items.find((i) => i.material_name.toLowerCase().includes('long screw'));
  assert.ok(screwLong, 'Long Screw must be present');
  assert.strictEqual(screwLong.total_quantity, 24, `Long Screw quantity must be 24, got ${screwLong.total_quantity}`);

  // 24 small screws
  const screwSmall = items.find((i) => i.material_name.toLowerCase().includes('small screw'));
  assert.ok(screwSmall, 'Small Screw must be present');
  assert.strictEqual(screwSmall.total_quantity, 24, `Small Screw quantity must be 24, got ${screwSmall.total_quantity}`);

  // 40 metres of wire
  const wire = items.find((i) => i.material_name.toLowerCase().includes('wire'));
  assert.ok(wire, '0.5 mm Wire must be present');
  assert.strictEqual(wire.total_quantity, 40, `0.5 mm Wire quantity must be 40, got ${wire.total_quantity}`);

  // 6 five-metre cables
  const cable5m = items.find((i) => i.material_name.toLowerCase().includes('5-metre'));
  assert.ok(cable5m, '5-metre Cable must be present');
  assert.strictEqual(cable5m.total_quantity, 6, `5-metre Cable quantity must be 6, got ${cable5m.total_quantity}`);

  // 2 fifteen-metre cables
  const cable15m = items.find((i) => i.material_name.toLowerCase().includes('15-metre'));
  assert.ok(cable15m, '15-metre Cable must be present');
  assert.strictEqual(cable15m.total_quantity, 2, `15-metre Cable quantity must be 2, got ${cable15m.total_quantity}`);

  // Total distinct materials must be exactly 8 (9 standard minus Memory Card)
  assert.strictEqual(items.length, 8, `Expected exactly 8 distinct materials for 8 Channel Live, found ${items.length}`);
  console.log('   ✅ Acceptance Test Passed: 2x 8 Channel Live produced exact required quantities with NO Memory Card line!');

  // ------------------------------------------------------------------------
  // Rule 2 & 4: Multi-device calculation with 8 Channel Live + another device
  // ------------------------------------------------------------------------
  console.log('\n👉 [Rule 2 & 4] Multi-device job: 2x 8 Channel Live + 3x 4 Channel Live...');
  const mixedCalc = await calculateBomRequirements([
    { device_type: '8 Channel Live', number_of_devices: 2, number_of_vehicles: 2 },
    { device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 },
  ]);

  assert.strictEqual(mixedCalc.configured, true);
  assert.strictEqual(mixedCalc.total_devices, 5);

  const mixedMemCard = mixedCalc.items.find((i) => i.material_name.toLowerCase().includes('memory card'));
  assert.ok(mixedMemCard, 'Memory Card must be present because 4 Channel Live is in the job');
  // 4 Channel Live requires 1 memory card per device * 3 devices = 3
  // 8 Channel Live requires 0 memory cards
  assert.strictEqual(mixedMemCard.total_quantity, 3, `Memory Card total quantity must be 3 (from 4 Channel Live only), got ${mixedMemCard.total_quantity}`);
  assert.ok(Array.isArray(mixedMemCard.breakdown), 'Breakdown must be present');
  // Breakdown should only contain 4 Channel Live (or 8 Channel Live must not have contributed)
  const breakdown8Ch = mixedMemCard.breakdown.find((b) => b.device_type === '8 Channel Live');
  assert.strictEqual(breakdown8Ch, undefined, '8 Channel Live must NOT appear in Memory Card breakdown');
  console.log('   ✅ Rule 2 & 4 Passed: Memory Card included ONLY for 4 Channel Live (quantity: 3).');

  // ------------------------------------------------------------------------
  // Rule 7: Memory Card remains in inventory
  // ------------------------------------------------------------------------
  console.log('\n👉 [Rule 7] Verify Memory Card remains an active stock item in inventory...');
  const inventory = await getMaterialInventory();
  const invMemCard = inventory.find((m) => m.material_name.toLowerCase().includes('memory card'));
  assert.ok(invMemCard, 'Memory Card must still exist in inventory');
  assert.ok(Number(invMemCard.current_stock) >= 0, 'Memory Card must have valid stock');
  console.log(`   ✅ Rule 7 Passed: Memory Card is in inventory (Current Stock: ${invMemCard.current_stock} ${invMemCard.unit}).`);

  // ------------------------------------------------------------------------
  // Store Manager Sync Copy Check
  // ------------------------------------------------------------------------
  console.log('\n👉 [Store Manager Check] Verify Store Manager requirements for 8 Channel Live...');
  const storeReq = await syncStoreRequirementForChecklist({
    id: 'test-8ch-checklist-001',
    checklist_number: 'EE-8CH-TEST',
    client_name: 'Metro Fleet',
    client_mobile: '9840999999',
    client_location: 'Chennai Port',
    installation_or_service: 'Installation',
    device_configurations: [{ device_type: '8 Channel Live', number_of_devices: 2 }],
    number_of_devices: 2,
    salesperson_name: 'Ranjith',
    service_engineer: 'Naveen Kumar',
    created_at: new Date().toISOString(),
  });

  assert.ok(storeReq, 'Store requirement record created');
  const storeMemCard = (storeReq.material_items || []).find((m) => m.material_name.toLowerCase().includes('memory card'));
  assert.strictEqual(storeMemCard, undefined, 'Store Manager material requirement must NOT contain Memory Card for 8 Channel Live');
  console.log('   ✅ Store Manager requirement verified: zero Memory Card required.');

  // ------------------------------------------------------------------------
  // Device BOM config check: getBomByDeviceType('8 Channel Live')
  // ------------------------------------------------------------------------
  console.log('\n👉 [Config Check] Verify getBomByDeviceType for 8 Channel Live vs 2 Channel Live...');
  const eightBom = await getBomByDeviceType('8 Channel Live');
  assert.ok(eightBom);
  const eightItems = eightBom.items || [];
  const eightMem = eightItems.find((i) => i.material_name.toLowerCase().includes('memory card'));
  assert.strictEqual(eightMem, undefined, '8 Channel Live BOM config must have no Memory Card item');

  const twoBom = await getBomByDeviceType('2 Channel Live');
  assert.ok(twoBom);
  const twoItems = twoBom.items || [];
  const twoMem = twoItems.find((i) => i.material_name.toLowerCase().includes('memory card'));
  assert.ok(twoMem, '2 Channel Live BOM config MUST have Memory Card item');
  console.log('   ✅ Config check passed: 8 Channel Live excludes Memory Card; 2 Channel Live retains Memory Card.');

  console.log('\n================================================================');
  console.log('🎉 ALL 8 CHANNEL LIVE BOM RULE ACCEPTANCE TESTS PASSED!');
  console.log('================================================================\n');
}

run8ChannelBomTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
