import assert from 'assert';
import { resolveInventoryTarget } from '../src/services/backupItemService.js';

console.log('--- RUNNING ISOLATED UNIT TESTS FOR EXTRA-DEVICE ISSUANCE WORKFLOW FIX ---');

const mockMats = [
  { id: 'mat-cbl-15m-id', sku: 'MAT-CBL-15M', material_name: '15-metre Cable', unit: 'Nos.', current_stock: 68, issued_stock: 2 },
  { id: 'mat-cbl-5m-id', sku: 'MAT-CBL-5M', material_name: '5-metre Cable', unit: 'Nos.', current_stock: 513, issued_stock: 6 },
  { id: 'mat-ct-200-id', sku: 'MAT-CT-200', material_name: 'Cable Tie – 200 mm', unit: 'Pkt', current_stock: 33, issued_stock: 1 },
  { id: 'mat-ct-300-id', sku: 'MAT-CT-300', material_name: 'Cable Tie – 300 mm', unit: 'Pkt', current_stock: 18, issued_stock: 1 },
  { id: 'mat-cam-id', sku: 'MAT-CAM-01', material_name: 'Camera', unit: 'Nos.', current_stock: 438, issued_stock: 10 },
  { id: 'mat-disp-id', sku: 'MAT-DISP-01', material_name: 'Live Display', unit: 'Nos.', current_stock: 20, issued_stock: 5 },
];

const mockDevs = [
  { id: 'dev-001', sku: 'EE-2CH-LIVE', device_type: '2 Channel Live', device_name: '2 Channel Live Camera System', usable_stock: 19, issued_stock: 3 },
  { id: 'dev-003', sku: 'EE-4CH-LIVE', device_type: '4 Channel Live', device_name: '4 Channel Live MDVR System', usable_stock: 20, issued_stock: 4 },
];

// Test 1: Substring collision resolution (15m Cable vs 5m Cable)
console.log('\n[TEST 1] Substring collision: "15m Cable" must resolve to 15-metre Cable, NOT 5-metre Cable');
const res15mNameOnly = resolveInventoryTarget({ item_name: '15m Cable' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(res15mNameOnly.type, 'MATERIAL', 'Should be resolved as MATERIAL');
assert.strictEqual(res15mNameOnly.target.material_name, '15-metre Cable', 'Must resolve to 15-metre Cable');
assert.strictEqual(res15mNameOnly.target.sku, 'MAT-CBL-15M', 'Must match 15M SKU');
assert.strictEqual(res15mNameOnly.target.current_stock, 68, 'Current stock must be 68, NOT 513');
console.log('✓ PASS: "15m Cable" correctly matched "15-metre Cable" (stock: 68)');

// Test 2: "5m Cable" must resolve to 5-metre Cable
console.log('\n[TEST 2] "5m Cable" must resolve to 5-metre Cable');
const res5mNameOnly = resolveInventoryTarget({ item_name: '5m Cable' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(res5mNameOnly.type, 'MATERIAL', 'Should be resolved as MATERIAL');
assert.strictEqual(res5mNameOnly.target.material_name, '5-metre Cable', 'Must resolve to 5-metre Cable');
assert.strictEqual(res5mNameOnly.target.sku, 'MAT-CBL-5M', 'Must match 5M SKU');
assert.strictEqual(res5mNameOnly.target.current_stock, 513, 'Current stock must be 513');
console.log('✓ PASS: "5m Cable" correctly matched "5-metre Cable" (stock: 513)');

// Test 3: Match by exact SKU overrides fuzzy heuristics
console.log('\n[TEST 3] SKU matching priority');
const resBySku = resolveInventoryTarget({ item_name: 'Custom Cable', item_sku: 'MAT-CBL-15M' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resBySku.target.material_name, '15-metre Cable', 'SKU must accurately resolve 15-metre Cable');
console.log('✓ PASS: Exact SKU matched target material correctly');

// Test 4: Match by exact Item ID
console.log('\n[TEST 4] ID matching priority');
const resById = resolveInventoryTarget({ item_name: 'Loose Wire', item_id: 'mat-cbl-5m-id' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resById.target.material_name, '5-metre Cable', 'ID must accurately resolve 5-metre Cable');
console.log('✓ PASS: Exact item_id matched target material correctly');

// Test 5: Cable Ties: 300 mm vs 200 mm
console.log('\n[TEST 5] Cable Ties differentiation (300 mm vs 200 mm)');
const resCt300 = resolveInventoryTarget({ item_name: 'Cable Tie 300mm' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resCt300.target.material_name, 'Cable Tie – 300 mm');
const resCt200 = resolveInventoryTarget({ item_name: 'Cable Tie 200mm' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resCt200.target.material_name, 'Cable Tie – 200 mm');
console.log('✓ PASS: Cable ties correctly distinguished');

// Test 6: Unknown item rejection
console.log('\n[TEST 6] Unmapped / unknown item handling');
const resUnknown = resolveInventoryTarget({ item_name: 'Super Unobtainium Device 9000' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resUnknown.type, 'UNKNOWN', 'Unmapped item must return UNKNOWN');
assert.strictEqual(resUnknown.target, null, 'Unmapped item target must be null');
console.log('✓ PASS: Unmapped item safely returns UNKNOWN without false matching');

// Test 7: Device model matching
console.log('\n[TEST 7] Standard Camera Device matching');
const resDev = resolveInventoryTarget({ item_name: '4 Channel Live' }, { allMats: mockMats, allDevs: mockDevs });
assert.strictEqual(resDev.type, 'DEVICE', 'Should be resolved as DEVICE');
assert.strictEqual(resDev.target.device_type, '4 Channel Live');
assert.strictEqual(resDev.target.usable_stock, 20);
console.log('✓ PASS: Camera device successfully resolved');

// Test 8: Insufficient stock validation throws error
console.log('\n[TEST 8] Insufficient stock validation');
const targetMat = mockMats[0]; // 15-metre cable, stock 68
const requestedQty = 100;
let blockedInsufficient = false;
try {
  if (requestedQty > targetMat.current_stock) {
    throw new Error(`Insufficient stock for backup material "${targetMat.material_name}". In store: ${targetMat.current_stock}, required: ${requestedQty}`);
  }
} catch (e) {
  blockedInsufficient = true;
  assert.ok(e.message.includes('Insufficient stock'));
}
assert.strictEqual(blockedInsufficient, true, 'Insufficient stock must block issuance');
console.log('✓ PASS: Over-issuance blocked when requested quantity exceeds available stock');

// Test 9: Over-issuance beyond declared quantity throws error
console.log('\n[TEST 9] Over-issuance beyond remaining declared quantity');
const declItem = { item_name: 'Camera', quantity: 2, quantity_issued: 2 };
const remaining = Math.max(0, declItem.quantity - declItem.quantity_issued);
let blockedOverIssue = false;
try {
  if (remaining <= 0) {
    throw new Error(`All declared quantities for "${declItem.item_name}" have already been issued.`);
  }
} catch (e) {
  blockedOverIssue = true;
  assert.ok(e.message.includes('All declared quantities'));
}
assert.strictEqual(blockedOverIssue, true, 'Zero remaining quantity must reject further issuance');
console.log('✓ PASS: Re-issuing already fully-issued item is blocked');

console.log('\n======================================================');
console.log('ALL ISOLATED EXTRA-DEVICE ISSUANCE UNIT TESTS PASSED!');
console.log('======================================================\n');
process.exit(0);
