import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import supabase from '../src/services/supabase.js';
import {
  getResetPreview,
  executeCompleteOperationalReset,
} from '../src/services/operationalResetService.js';
import {
  getInventoryProducts,
  adjustStock,
  setDeviceOpeningStock,
} from '../src/services/inventoryService.js';
import {
  getMaterialInventory,
  adjustMaterialStock,
  setMaterialOpeningStock,
} from '../src/services/materialStockService.js';
import {
  getHighestSequenceValue,
  peekNextQuotationNumber,
} from '../src/services/quotationSequenceService.js';

async function runResetIntegrityTests() {
  console.log('========================================================================');
  console.log('   EAGLE EYE SAFDRIVE — OPERATIONAL RESET INTEGRITY TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(msg) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  }

  function fail(msg, err) {
    failed++;
    console.error(`❌ [FAIL] ${msg}:`, err?.message || err);
  }

  // ------------------------------------------------------------------
  // 1. PRE-RESET QUOTATION SNAPSHOT
  // ------------------------------------------------------------------
  let preQuotes = [];
  try {
    console.log('-> 1. Snapshotting Existing Quotations & Sequence...');
    const { data, count, error } = await supabase
      .from('quotations')
      .select('id, quotation_number, customer_name, net_amount', { count: 'exact' });

    assert(!error, `Failed to load quotations: ${error?.message}`);
    assert(Array.isArray(data) && data.length > 0, 'Must have existing quotations to safeguard');
    preQuotes = data;

    const nextSeq = await peekNextQuotationNumber();
    assert(nextSeq.startsWith('CQS/'), 'Next quotation sequence must be formatted as CQS/XXXXX');

    pass(`Snapshotted ${preQuotes.length} existing quotations (Highest: ${nextSeq})`);
  } catch (err) {
    fail('Quotation snapshot failed', err);
  }

  // ------------------------------------------------------------------
  // 2. PREVIEW AUDIT VERIFICATION
  // ------------------------------------------------------------------
  try {
    console.log('-> 2. Verifying Reset Preview Mechanism...');
    const preview = await getResetPreview();

    assert(preview.protected_quotations.total_quotations === preQuotes.length, 'Preview quotation count must match DB');
    assert(preview.protected_master_data.device_products_catalogue === 7, '7 master device products must be detected');
    assert(preview.protected_master_data.materials_catalogue === 15, '15 master materials must be detected');
    assert(preview.protected_master_data.service_engineers === 6, '6 service engineers must be detected');
    assert(preview.configurable_opening_balances.devices.length === 7, 'Configurable device opening balances present');
    assert(preview.configurable_opening_balances.materials.length === 15, 'Configurable material opening balances present');

    pass('Reset preview accurately categorizes protected vs operational data');
  } catch (err) {
    fail('Reset preview verification failed', err);
  }

  // ------------------------------------------------------------------
  // 3. EXECUTE OPERATIONAL RESET (SAFEGUARDING QUOTATIONS)
  // ------------------------------------------------------------------
  let resetResult;
  try {
    console.log('-> 3. Executing Complete Operational Data Reset (0 baseline)...');
    resetResult = await executeCompleteOperationalReset({
      openingBalances: {}, // Clean 0 baseline for fresh start
      executedBy: 'INTEGRITY_TEST_SUITE',
      confirmReset: true,
    });

    assert(resetResult.success === true, 'Reset execution must report success');
    assert.strictEqual(resetResult.quotation_protection.status, 'VERIFIED_100_PERCENT_INTACT');
    assert.strictEqual(resetResult.operational_checklists_remaining, 0, 'Zero checklists must remain');

    pass('Complete operational reset executed successfully with 0 remaining checklists');
  } catch (err) {
    fail('Operational reset execution failed', err);
  }

  // ------------------------------------------------------------------
  // 4. VERIFY QUOTATIONS UNTOUCHED & 100% PRESERVED
  // ------------------------------------------------------------------
  try {
    console.log('-> 4. Verifying Every Quotation Is 100% Preserved...');
    const { data: postQuotes, count: postCount } = await supabase
      .from('quotations')
      .select('id, quotation_number, customer_name, net_amount', { count: 'exact' });

    assert.strictEqual(postCount, preQuotes.length, 'Post-reset quotation count must exactly equal pre-reset count');

    const preMap = new Map(preQuotes.map((q) => [q.id, q]));
    for (const pq of postQuotes) {
      const orig = preMap.get(pq.id);
      assert(orig, `Quotation ${pq.id} was not in original snapshot`);
      assert.strictEqual(pq.quotation_number, orig.quotation_number, `Quotation number changed for ${pq.id}`);
      assert.strictEqual(pq.customer_name, orig.customer_name, `Customer name changed for ${pq.id}`);
      assert.strictEqual(Number(pq.net_amount), Number(orig.net_amount), `Net amount changed for ${pq.id}`);
    }

    const nextSeqAfter = await peekNextQuotationNumber();
    assert.strictEqual(nextSeqAfter, 'CQS/00279', 'Next quotation number sequence must remain CQS/00279');

    pass(`All ${postQuotes.length} quotations verified intact with identical numbers, customers, and totals`);
  } catch (err) {
    fail('Quotation preservation verification failed', err);
  }

  // ------------------------------------------------------------------
  // 5. VERIFY OPERATIONAL TABLES ARE CLEARED
  // ------------------------------------------------------------------
  try {
    console.log('-> 5. Verifying Operational Tables Are Completely Clean...');
    const tablesToCheck = [
      'installation_checklists',
      'technical_installation_reports',
      'technical_installation_report_items',
      'engineer_bookings',
      'store_material_requirements',
      'courier_dispatches',
      'technician_availability_overrides',
      'job_device_carry_records',
      'pre_installation_backup_declarations',
      'app_notifications',
      'push_notification_history',
    ];

    for (const t of tablesToCheck) {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
      assert.strictEqual(count, 0, `Table ${t} must have 0 records, found ${count}`);
    }

    pass('All operational checklists, bookings, reports, dispatches, and notifications confirmed at 0 records');
  } catch (err) {
    fail('Operational cleanup verification failed', err);
  }

  // ------------------------------------------------------------------
  // 6. VERIFY INVENTORY BALANCES & OPENING MOVEMENTS
  // ------------------------------------------------------------------
  try {
    console.log('-> 6. Verifying Inventory Initialized to Configured Starting Balance (0)...');
    const products = await getInventoryProducts();
    assert(products.length === 7, 'Must have 7 device products');
    for (const p of products) {
      assert.strictEqual(Number(p.usable_stock), 0, `Product ${p.sku} usable_stock must be 0`);
      assert.strictEqual(Number(p.issued_stock), 0, `Product ${p.sku} issued_stock must be 0`);
      assert.strictEqual(Number(p.reserved_stock), 0, `Product ${p.sku} reserved_stock must be 0`);
    }

    const materials = await getMaterialInventory({ includeInactive: true });
    assert(materials.length === 15, `Must have 15 materials, found ${materials.length}`);
    for (const m of materials) {
      assert.strictEqual(Number(m.current_stock), 0, `Material ${m.material_name} current_stock must be 0`);
      assert.strictEqual(Number(m.issued_stock), 0, `Material ${m.material_name} issued_stock must be 0`);
    }

    // Verify stock_movements contains opening stock records (7 devices + 15 materials = 22)
    const { data: movements, count: movCount } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact' });

    assert(movements && movements.length >= 22, `Expected at least 22 opening movements, found ${movements?.length}`);
    const openingMovements = movements.filter((m) => m.movement_type === 'OPENING_STOCK');
    assert(openingMovements.length >= 22, `Expected at least 22 OPENING_STOCK records, found ${openingMovements.length}`);
    for (const m of openingMovements) {
      assert.strictEqual(m.movement_type, 'OPENING_STOCK', 'Movement must be OPENING_STOCK');
      assert.strictEqual(Number(m.balance_after), 0, 'Movement balance_after must be 0');
      assert.strictEqual(m.reason_or_remarks, 'Initial inventory reset for fresh testing');
    }

    pass('Inventory balances and auditable OPENING_STOCK ledger movements verified');
  } catch (err) {
    fail('Inventory baseline verification failed', err);
  }

  // ------------------------------------------------------------------
  // 7. VERIFY STOCK ADJUSTMENT & ISSUANCE WORKFLOW AFTER RESET
  // ------------------------------------------------------------------
  try {
    console.log('-> 7. Verifying Store Manager Can Adjust Stock & Record Physical Count...');
    // Set opening stock for 2 Channel Live to 25 Nos.
    const adjResult = await setDeviceOpeningStock({
      device_type: '2 Channel Live',
      opening_quantity: 25,
      reason: 'Physical stock count verified in warehouse',
      user: { id: 'admin-test', full_name: 'Store Manager', email: 'store@eagleeyesafdrive.com' },
    });

    assert(adjResult.success === true, 'setDeviceOpeningStock must succeed');
    assert.strictEqual(Number(adjResult.usable_stock), 25, 'Usable stock must be updated to 25');

    // Verify adjustMaterialStock also functions normally
    const matResult = await adjustMaterialStock({
      material_name: 'Insulation Tape',
      quantity: 50,
      action: 'SET',
      reason: 'Initial physical tape count',
      user: { id: 'admin-test', full_name: 'Store Manager' },
    });

    assert(matResult.success === true, 'adjustMaterialStock must succeed');
    assert.strictEqual(Number(matResult.current_stock), 50, 'Insulation Tape stock must be 50');

    // Restore test stock adjustments back to 0 so fresh testing begins cleanly
    await setDeviceOpeningStock({
      device_type: '2 Channel Live',
      opening_quantity: 0,
      reason: 'Initial inventory reset for fresh testing',
      user: { id: 'admin-test', full_name: 'System Administrator' },
    });
    await adjustMaterialStock({
      material_name: 'Insulation Tape',
      quantity: 0,
      action: 'SET',
      reason: 'Initial inventory reset for fresh testing',
      user: { id: 'admin-test', full_name: 'System Administrator' },
    });

    pass('Store Manager stock adjustments and physical counts operate correctly post-reset');
  } catch (err) {
    fail('Post-reset stock adjustment verification failed', err);
  }

  console.log('\n========================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runResetIntegrityTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
