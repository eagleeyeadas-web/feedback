import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  getInventoryProducts,
  addNewDeviceProduct,
  receiveNewStock,
  setDeviceOpeningStock,
  adjustStock,
  loadInventoryStorage,
} from '../src/services/inventoryService.js';
import {
  getMaterialInventory,
  setMaterialOpeningStock,
  loadMaterialFallbackStorage,
} from '../src/services/materialStockService.js';

async function runDevicePersistenceTests() {
  console.log('========================================================================');
  console.log('EAGLE EYE SAFDRIVE — DEVICE PERSISTENCE & ADD DEVICE TEST');
  console.log('Testing: Device addition, opening stock, and persistence across restarts');
  console.log('========================================================================\n');

  const testUser = {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'store@eagleeye.com',
    full_name: 'Store Manager',
    role: 'STORE_MANAGER',
  };

  const storagePath = path.resolve(__dirname, '../src/data/inventory_storage.json');
  console.log('-> Storage file path:', storagePath);

  // 1. Test adding a new custom device model
  console.log('\n-> Step 1: Testing addNewDeviceProduct...');
  const newDeviceType = `12 Channel Live Test ${Date.now()}`;
  const newDevice = await addNewDeviceProduct({
    device_type: newDeviceType,
    device_name: `${newDeviceType} Enterprise MDVR`,
    sku: `EE-12CH-${Date.now().toString().slice(-4)}`,
    opening_quantity: 15,
    min_stock_level: 5,
    user: testUser,
  });

  assert.strictEqual(newDevice.device_type, newDeviceType);
  assert.strictEqual(newDevice.usable_stock, 15);
  assert.strictEqual(newDevice.opening_quantity, 15);
  assert.strictEqual(newDevice.opening_stock_set, true);
  console.log(`   [PASS] Added new device "${newDeviceType}" with opening stock = 15 Nos.`);

  // Verify file was written to disk
  assert.ok(fs.existsSync(storagePath), 'inventory_storage.json must exist on disk');
  const diskData1 = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
  assert.ok(diskData1.deviceProducts[newDeviceType], 'New device must be stored in inventory_storage.json');
  console.log('   [PASS] Verified persisted to inventory_storage.json on disk.');

  // 2. Receive additional stock for this newly created device
  console.log('\n-> Step 2: Receiving stock for the new device model...');
  const recvRes = await receiveNewStock({
    device_type: newDeviceType,
    quantity: 10,
    user: testUser,
    supplier: 'Apex Technologies',
    purchase_ref: 'PO-TEST-1234',
    remarks: 'Incoming shipment batch A',
  });

  assert.strictEqual(recvRes.usable_stock, 25, 'Stock should be 15 + 10 = 25 Nos.');
  console.log(`   [PASS] Received 10 units. Usable stock is now ${recvRes.usable_stock} Nos.`);

  // 3. Set Opening Stock for standard device (e.g. 2 Channel Live)
  console.log('\n-> Step 3: Setting opening stock for standard 2 Channel Live...');
  const openRes = await setDeviceOpeningStock({
    device_type: '2 Channel Live',
    opening_quantity: 40,
    reason: 'Initial warehouse audit baseline',
    user: testUser,
  });
  assert.strictEqual(openRes.usable_stock, 40);
  assert.strictEqual(openRes.opening_quantity, 40);
  console.log(`   [PASS] 2 Channel Live opening stock set to ${openRes.usable_stock} Nos.`);

  // 4. Set material opening stock
  console.log('\n-> Step 4: Setting material opening stock for Insulation Tape...');
  const matRes = await setMaterialOpeningStock({
    material_name: 'Insulation Tape',
    opening_stock: 125,
    reason: 'Monthly physical inventory audit',
    user: testUser,
  });
  assert.strictEqual(matRes.current_stock, 125);
  console.log(`   [PASS] Insulation Tape opening stock set to ${matRes.current_stock} Nos.`);

  // 5. SIMULATE SERVER REBOOT / RESTART
  console.log('\n-> Step 5: Simulating backend restart (Reloading storage from disk)...');
  // Re-read file and load
  loadInventoryStorage();
  loadMaterialFallbackStorage();

  const productsAfterReboot = await getInventoryProducts();
  const rebootedDevice = productsAfterReboot.find((p) => p.device_type === newDeviceType);
  assert.ok(rebootedDevice, 'Custom added device must exist after reboot!');
  assert.strictEqual(
    Number(rebootedDevice.usable_stock),
    25,
    `Usable stock must remain 25 Nos. after reboot! Got ${rebootedDevice.usable_stock}`
  );
  assert.strictEqual(
    Number(rebootedDevice.opening_quantity),
    15,
    `Opening quantity must remain 15 Nos. after reboot! Got ${rebootedDevice.opening_quantity}`
  );

  const rebooted2Ch = productsAfterReboot.find((p) => p.device_type === '2 Channel Live');
  assert.strictEqual(
    Number(rebooted2Ch.usable_stock),
    40,
    `2 Channel Live stock must remain 40 Nos. after reboot! Got ${rebooted2Ch.usable_stock}`
  );
  assert.strictEqual(
    rebooted2Ch.opening_stock_set,
    true,
    '2 Channel Live opening_stock_set must remain true after reboot!'
  );

  const materialsAfterReboot = await getMaterialInventory();
  const rebootedTape = materialsAfterReboot.find((m) => m.material_name === 'Insulation Tape');
  assert.strictEqual(
    Number(rebootedTape.current_stock),
    125,
    `Insulation Tape stock must remain 125 Nos. after reboot! Got ${rebootedTape.current_stock}`
  );

  console.log('   [PASS] SIMULATED REBOOT VERIFICATION COMPLETE:');
  console.log(`          - Custom Device "${newDeviceType}": 25 Nos. (Preserved!)`);
  console.log('          - 2 Channel Live: 40 Nos. (Preserved!)');
  console.log('          - Insulation Tape: 125 Nos. (Preserved!)');

  console.log('\n========================================================================');
  console.log('ALL PERSISTENCE & ADD DEVICE TESTS PASSED CLEANLY!');
  console.log('========================================================================\n');
}

runDevicePersistenceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTEST FAILED:', err);
    process.exit(1);
  });
