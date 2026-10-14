import supabase from '../src/services/supabase.js';
import { recordStockMovement, getStockMovements } from '../src/services/stockMovementService.js';
import { executeInventoryCleanup, getCleanupLogs } from '../src/services/inventoryCleanupService.js';
import { verifyStoreReturn } from '../src/services/workflowService.js';

async function runTests() {
  console.log('========================================================');
  console.log(' Eagle Eye SafDrive: Inventory & Retention Test Suite');
  console.log('========================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // --- Test 1: Record and Persist Stock Movements in Supabase ---
  console.log('\n--- 1. Testing Stock Movements Persistence in Supabase ---');
  const testMovKey = `TEST-MOV-${Date.now()}`;
  const movement = await recordStockMovement({
    item_name: '4 Channel Live MDVR System',
    sku: 'EE-4CH-LIVE',
    category: 'Camera Device',
    movement_type: 'STOCK_RECEIVED',
    quantity: 10,
    unit: 'Nos.',
    balance_before: 5,
    balance_after: 15,
    reason_or_remarks: 'Acceptance test movement',
    idempotency_key: testMovKey,
  });

  assert(movement && movement.id, 'Movement record generated with unique ID');

  // Verify persistence in Supabase PostgreSQL
  const { data: dbMov, error: dbMovErr } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('idempotency_key', testMovKey)
    .single();

  assert(!dbMovErr && dbMov, 'Movement persisted in PostgreSQL database');
  assert(Number(dbMov.quantity) === 10, 'Correct movement quantity recorded in database');
  assert(Number(dbMov.balance_after) === 15, 'Correct balance transition recorded');

  // Test retrieval via getStockMovements API
  const movementsList = await getStockMovements({ limit: 10, search: testMovKey });
  assert(movementsList.movements.some((m) => m.idempotency_key === testMovKey), 'Movement visible via getStockMovements API (survives reload/query)');


  // --- Test 2: Persist Device Returns and Verification ---
  console.log('\n--- 2. Testing Device Returns Persistence & Verification ---');
  // First ensure test checklist exists or use existing checklist
  const { data: checklists } = await supabase.from('installation_checklists').select('id').limit(5);
  let testChecklistId = checklists && checklists[0] ? checklists[0].id : null;

  if (!testChecklistId) {
    const { data: newChk } = await supabase.from('installation_checklists').insert([{
      checklist_number: `EE-TEST-${Date.now()}`,
      client_name: 'Test Fleet Logistics',
      client_mobile: '9876543210',
      client_location: 'Mumbai Depot',
      installation_or_service: 'Installation',
      device_type: '4 Channel Live',
      reconciliation_status: 'PENDING_STORE_VERIFICATION',
    }]).select().single();
    testChecklistId = newChk.id;
  }

  // Insert declared return in job_device_returns
  const { data: declaredReturn, error: retErr } = await supabase.from('job_device_returns').insert([{
    checklist_id: testChecklistId,
    device_type: '4 Channel Live',
    declared_return_qty: 2,
    status: 'PENDING_STORE_VERIFICATION',
    verification_remarks: 'Technician return declaration',
  }]).select().single();

  assert(!retErr && declaredReturn, 'Device return declaration created in Supabase with status PENDING_STORE_VERIFICATION');

  // Verify return as Store Manager
  const verifiedReturn = await verifyStoreReturn({
    return_id: declaredReturn.id,
    accepted_usable_qty: 2,
    damaged_qty: 0,
    missing_qty: 0,
    user: { id: null, full_name: 'Test Store Manager', email: 'store@eagleeye.com', role: 'STORE_MANAGER' },
    remarks: 'Verified 2 usable units in good condition',
  });

  assert(verifiedReturn.status === 'VERIFIED_AND_RECONCILED', 'Return status changed to VERIFIED_AND_RECONCILED');

  const { data: dbVerified } = await supabase
    .from('job_device_returns')
    .select('*')
    .eq('id', declaredReturn.id)
    .single();

  assert(dbVerified && dbVerified.status === 'VERIFIED_AND_RECONCILED', 'Verified status and timestamps saved in PostgreSQL database');
  assert(Number(dbVerified.accepted_usable_qty) === 2, 'Accepted usable quantity persisted');


  // --- Test 3: 20-Day Retention Policy & Protections ---
  console.log('\n--- 3. Testing 20-Day Automatic History Retention & Protection Rules ---');
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Timestamps:
  const t5DaysOld = new Date(now - 5 * DAY_MS).toISOString();
  const t20DaysExact = new Date(now - 20 * DAY_MS).toISOString();
  const t25DaysOld = new Date(now - 25 * DAY_MS).toISOString();

  // Record 1: Recent movement (5 days old) -> MUST REMAIN
  const { data: mov5d } = await supabase.from('stock_movements').insert([{
    item_name: 'Recent 5D Item',
    category: 'Camera Device',
    movement_type: 'STOCK_RECEIVED',
    quantity: 5,
    created_at: t5DaysOld,
  }]).select().single();

  // Record 2: Movement strictly older than 20 days (25 days old) -> MUST BE DELETED
  const { data: mov25d } = await supabase.from('stock_movements').insert([{
    item_name: 'Old 25D Item',
    category: 'Camera Device',
    movement_type: 'STOCK_RECEIVED',
    quantity: 25,
    created_at: t25DaysOld,
  }]).select().single();

  // Use existing checklists for clean vs discrepancy tests
  const cleanChecklistId = checklists.length > 1 ? checklists[1].id : testChecklistId;

  // Record 3: Verified return strictly older than 20 days (25 days old) on clean checklist -> MUST BE DELETED
  const { data: ret25dVerified } = await supabase.from('job_device_returns').insert([{
    checklist_id: cleanChecklistId,
    device_type: '4 Channel Live',
    declared_return_qty: 1,
    accepted_usable_qty: 1,
    damaged_qty: 0,
    status: 'VERIFIED_AND_RECONCILED',
    created_at: t25DaysOld,
  }]).select().single();

  // Record 4: PENDING return strictly older than 20 days (25 days old) -> MUST BE PROTECTED / NEVER DELETED!
  const { data: ret25dPending } = await supabase.from('job_device_returns').insert([{
    checklist_id: testChecklistId,
    device_type: '4 Channel Live',
    declared_return_qty: 3,
    status: 'PENDING_STORE_VERIFICATION',
    created_at: t25DaysOld,
  }]).select().single();

  // Record 5: Movement older than 20 days but tied to open discrepancy -> MUST BE PROTECTED!
  const { data: openDiscrepancy } = await supabase.from('inventory_discrepancies').insert([{
    checklist_id: testChecklistId,
    device_type: '4 Channel Live',
    declared_qty: 5,
    verified_qty: 0,
    discrepancy_qty: 5,
    discrepancy_type: 'MISSING_STOCK',
    status: 'OPEN',
  }]).select().single();

  const { data: movProtectedByDiscrepancy } = await supabase.from('stock_movements').insert([{
    item_name: 'Protected Discrepancy Movement',
    category: 'Camera Device',
    movement_type: 'STOCK_ISSUED',
    quantity: 5,
    checklist_id: testChecklistId,
    created_at: t25DaysOld,
  }]).select().single();

  // Fetch initial stock balance of 4 Channel Live to verify balances are untouched
  const { data: prodBefore } = await supabase
    .from('inventory_products')
    .select('usable_stock')
    .eq('device_type', '4 Channel Live')
    .single();
  const initialStock = prodBefore ? prodBefore.usable_stock : 0;

  // Execute 20-Day Cleanup
  console.log('Executing 20-day cleanup...');
  const cleanupRes = await executeInventoryCleanup({ executed_by: 'ACCEPTANCE_TEST' });
  assert(cleanupRes.success === true, 'Cleanup completed with success: true');
  assert(cleanupRes.movements_deleted >= 1, 'Older movement (>20 days) was deleted');
  assert(cleanupRes.device_returns_deleted >= 1, 'Older verified return (>20 days) was deleted');

  // Verify Retention Decisions:
  // 1. Recent record (5 days old) remains
  const { data: checkMov5d } = await supabase.from('stock_movements').select('id').eq('id', mov5d.id).maybeSingle();
  assert(checkMov5d !== null, 'Records newer than 20 days are strictly retained');

  // 2. Old record (25 days old) was deleted
  const { data: checkMov25d } = await supabase.from('stock_movements').select('id').eq('id', mov25d.id).maybeSingle();
  assert(checkMov25d === null, 'Eligible movements older than 20 days are cleanly deleted');

  // 3. Old verified return was deleted
  const { data: checkRet25dVer } = await supabase.from('job_device_returns').select('id').eq('id', ret25dVerified.id).maybeSingle();
  assert(checkRet25dVer === null, 'Completed/verified returns older than 20 days are deleted');

  // 4. Old PENDING return MUST REMAIN
  const { data: checkRet25dPend } = await supabase.from('job_device_returns').select('id').eq('id', ret25dPending.id).maybeSingle();
  assert(checkRet25dPend !== null, 'CRITICAL RULE: Pending returns awaiting store verification are NEVER deleted even if >20 days old');

  // 5. Old movement tied to open discrepancy MUST REMAIN
  const { data: checkMovProtected } = await supabase.from('stock_movements').select('id').eq('id', movProtectedByDiscrepancy.id).maybeSingle();
  assert(checkMovProtected !== null, 'CRITICAL RULE: Movements tied to open discrepancies/unresolved transactions are protected');

  // 6. Current inventory balance MUST REMAIN UNCHANGED
  const { data: prodAfter } = await supabase
    .from('inventory_products')
    .select('usable_stock')
    .eq('device_type', '4 Channel Live')
    .single();
  assert(prodAfter && prodAfter.usable_stock === initialStock, 'CRITICAL RULE: Authoritative current stock balances are never modified by history cleanup');

  // 7. Cleanup log exists
  const logs = await getCleanupLogs(5);
  assert(logs.length > 0 && logs[0].status === 'SUCCESS', 'Cleanup run logged into retention_cleanup_logs table');

  // Cleanup test artifacts
  await supabase.from('job_device_returns').delete().eq('id', ret25dPending.id);
  await supabase.from('inventory_discrepancies').delete().eq('id', openDiscrepancy.id);
  await supabase.from('stock_movements').delete().eq('id', movProtectedByDiscrepancy.id);
  await supabase.from('stock_movements').delete().eq('id', mov5d.id);

  console.log(`\n========================================================`);
  console.log(` ALL TESTS PASSED (${passed}/${total})`);
  console.log(`========================================================\n`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
