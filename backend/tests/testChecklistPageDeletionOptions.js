import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import supabase from '../src/services/supabase.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import installationRoutes from '../src/routes/installation.js';
import coordinatorRoutes from '../src/routes/coordinator.js';

async function runChecklistPageDeletionTests() {
  console.log('========================================================================');
  console.log('  CHECKLIST PAGE INDIVIDUAL & BULK DELETE VERIFICATION SUITE           ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ↳ ${details}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       ↳ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // Users
  const userSales = { id: '00000000-0000-0000-0000-000000000001', email: 'sales@gmail.com', role: 'SALES' };
  const userTech = { id: '00000000-0000-0000-0000-000000000002', email: 'tech@gmail.com', role: 'TECHNICAL' };
  const userStore = { id: '00000000-0000-0000-0000-000000000003', email: 'store@gmail.com', role: 'STORE_MANAGER' };
  const userAdmin = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@gmail.com', role: 'ADMIN' };
  const userCoordinator = { id: '00000000-0000-0000-0000-000000000004', email: 'coordinator@gmail.com', role: 'COORDINATOR' };

  let simulatedUser = userAdmin;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = simulatedUser;
    req.profile = simulatedUser;
    req.adminUser = simulatedUser;
    next();
  });

  app.use('/api/admin/installations', installationRoutes);
  app.use('/api/admin/coordinator', coordinatorRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/admin/installations`;

  const createdChecklistIds = [];

  try {
    // -----------------------------------------------------------------------
    // TEST 1: Role-Based Authorization Safeguards
    // -----------------------------------------------------------------------
    console.log('--- TEST 1: Role-Based Authorization Enforcement ---');
    simulatedUser = userSales;

    const resSalesDel = await fetch(`${baseUrl}/dummy-id`, { method: 'DELETE' });
    assert(resSalesDel.status === 403, 'Unauthorized role (SALES) blocked from individual DELETE with HTTP 403');

    const resSalesBulk = await fetch(`${baseUrl}/delete-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedCount: 0 }),
    });
    assert(resSalesBulk.status === 403, 'Unauthorized role (SALES) blocked from Delete All with HTTP 403');

    const resSalesPrev = await fetch(`${baseUrl}/deletion-preview`);
    assert(resSalesPrev.status === 403, 'Unauthorized role (SALES) blocked from deletion preview with HTTP 403');

    simulatedUser = userTech;
    const resTechDel = await fetch(`${baseUrl}/dummy-id`, { method: 'DELETE' });
    assert(resTechDel.status === 403, 'Unauthorized role (TECHNICAL) blocked with HTTP 403');

    simulatedUser = userStore;
    const resStoreDel = await fetch(`${baseUrl}/dummy-id`, { method: 'DELETE' });
    assert(resStoreDel.status === 403, 'Unauthorized role (STORE_MANAGER) blocked with HTTP 403');

    // -----------------------------------------------------------------------
    // TEST 2: Record Initial Inventory and Quotation Balances
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 2: Baseline Inventory & Quotation Ledger ---');
    const initialMaterials = await getMaterialInventory();
    const initialTapeStock = initialMaterials.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;
    const initialWireStock = initialMaterials.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
    assert(typeof initialTapeStock === 'number', 'Baseline stock balances recorded for materials');

    // -----------------------------------------------------------------------
    // TEST 3: Create Test Fixtures (Eligible Drafts vs Protected Operational Jobs)
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 3: Create Isolated Test Checklists ---');
    const testNow = Date.now();

    const basePayload = {
      expected_arrival_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      installation_duration: '1 Day',
      installation_or_service: 'Installation',
      salesperson_name: 'Test Sales',
      service_engineer: 'Test Engineer',
      confirmed_price: 25000,
      payment_method: 'Cash',
      vehicle_type: 'Truck',
    };

    // 3a. Eligible Draft 1
    const draft1 = await createChecklist(userAdmin.id, {
      ...basePayload,
      client_name: `Draft Fleet Alpha ${testNow}`,
      client_mobile: '9876543201',
      client_location: 'Dock Alpha',
      installation_status: 'Assigned',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
    });
    createdChecklistIds.push(draft1.id);
    assert(draft1 && draft1.id, 'Created Eligible Draft Checklist 1', draft1.checklist_number);

    // 3b. Eligible Draft 2
    const draft2 = await createChecklist(userAdmin.id, {
      ...basePayload,
      client_name: `Draft Fleet Beta ${testNow}`,
      client_mobile: '9876543202',
      client_location: 'Dock Beta',
      installation_status: 'Assigned',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
    });
    createdChecklistIds.push(draft2.id);
    assert(draft2 && draft2.id, 'Created Eligible Draft Checklist 2', draft2.checklist_number);

    // 3c. Protected Job 1: In Progress status
    const inProgressJob = await createChecklist(userAdmin.id, {
      ...basePayload,
      client_name: `Active InProgress Logistics ${testNow}`,
      client_mobile: '9876543203',
      client_location: 'Highway Dock C',
      installation_status: 'In Progress',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
    });
    createdChecklistIds.push(inProgressJob.id);
    assert(inProgressJob && inProgressJob.id, 'Created Protected In-Progress Job', inProgressJob.checklist_number);

    // 3d. Protected Job 2: Completed status
    const completedJob = await createChecklist(userAdmin.id, {
      ...basePayload,
      client_name: `Completed Transports ${testNow}`,
      client_mobile: '9876543204',
      client_location: 'Dock Delta',
      installation_status: 'Completed',
      device_type: '2 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
    });
    createdChecklistIds.push(completedJob.id);
    assert(completedJob && completedJob.id, 'Created Protected Completed Job', completedJob.checklist_number);

    // 3e. Protected Job 3: Stock issued
    const issuedStockJob = await createChecklist(userAdmin.id, {
      ...basePayload,
      client_name: `Stock Issued Cargo ${testNow}`,
      client_mobile: '9876543205',
      client_location: 'Dock Epsilon',
      installation_status: 'Assigned',
      device_type: '4 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
    });
    // Mark material issuance flag
    await supabase
      .from('installation_checklists')
      .update({ material_issuance_status: 'ISSUED', material_issued_at: new Date().toISOString() })
      .eq('id', issuedStockJob.id);
    createdChecklistIds.push(issuedStockJob.id);
    assert(issuedStockJob && issuedStockJob.id, 'Created Protected Stock Issued Job', issuedStockJob.checklist_number);

    // -----------------------------------------------------------------------
    // TEST 4: Individual Checklist Eligibility Check & Protection Reasons
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 4: Single Checklist Deletion Eligibility Evaluation ---');
    simulatedUser = userAdmin;

    // Check eligible draft
    const resCheckDraft = await fetch(`${baseUrl}/${draft1.id}/deletion-check`);
    assert(resCheckDraft.status === 200, 'Eligibility check responded HTTP 200 for draft');
    const dataCheckDraft = await resCheckDraft.json();
    assert(dataCheckDraft.isEligible === true, 'Draft checklist is evaluated as eligible for permanent deletion');
    assert(dataCheckDraft.reasons.length === 0, 'No protection reasons returned for clean draft');

    // Check in-progress protected job
    const resCheckProg = await fetch(`${baseUrl}/${inProgressJob.id}/deletion-check`);
    const dataCheckProg = await resCheckProg.json();
    assert(dataCheckProg.isEligible === false, 'In-progress job is protected from deletion');
    assert(dataCheckProg.reasons.some((r) => r.includes('In Progress')), 'Reason accurately explains In-Progress status');

    // Check completed protected job
    const resCheckComp = await fetch(`${baseUrl}/${completedJob.id}/deletion-check`);
    const dataCheckComp = await resCheckComp.json();
    assert(dataCheckComp.isEligible === false, 'Completed job is protected from deletion');
    assert(dataCheckComp.reasons.some((r) => r.includes('Completed')), 'Reason accurately explains Completed status');

    // Check stock issued protected job
    const resCheckIssued = await fetch(`${baseUrl}/${issuedStockJob.id}/deletion-check`);
    const dataCheckIssued = await resCheckIssued.json();
    assert(dataCheckIssued.isEligible === false, 'Stock issued job is protected from deletion');
    assert(dataCheckIssued.reasons.some((r) => r.includes('issued')), 'Reason accurately explains issued materials');

    // Attempt individual DELETE on protected job -> MUST fail with HTTP 409
    const resDelBlocked = await fetch(`${baseUrl}/${completedJob.id}`, { method: 'DELETE' });
    assert(resDelBlocked.status === 409, 'Attempted DELETE on protected job strictly rejected with HTTP 409');
    const blockedJson = await resDelBlocked.json();
    assert(Array.isArray(blockedJson.reasons) && blockedJson.reasons.length > 0, 'HTTP 409 response contains detailed protection reasons');

    // -----------------------------------------------------------------------
    // TEST 5: Single Checklist Safe Deletion (Draft 1)
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 5: Delete Single Eligible Checklist ---');
    const resDelDraft1 = await fetch(`${baseUrl}/${draft1.id}`, { method: 'DELETE' });
    assert(resDelDraft1.status === 200, 'Single draft deletion returned HTTP 200');
    const jsonDelDraft1 = await resDelDraft1.json();
    assert(jsonDelDraft1.success === true, 'Response confirmed successful deletion', jsonDelDraft1.message);

    // Verify it is gone from database
    const verifyDraft1 = await getChecklistById(draft1.id).catch(() => null);
    assert(!verifyDraft1, 'Draft 1 successfully verified removed from installation_checklists table');

    // -----------------------------------------------------------------------
    // TEST 6: Bulk Deletion Preview
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 6: Bulk Deletion Preview ---');
    const resPreview = await fetch(`${baseUrl}/deletion-preview?search=${testNow}`);
    assert(resPreview.status === 200, 'Deletion preview returned HTTP 200');
    const previewData = await resPreview.json();

    assert(previewData.totalCount >= 4, `Preview evaluated all scoped test records (Found ${previewData.totalCount})`);
    assert(previewData.eligibleCount >= 1, `Eligible count includes Draft 2 (Found ${previewData.eligibleCount})`);
    assert(previewData.protectedCount >= 3, `Protected count includes InProgress, Completed, Issued jobs (Found ${previewData.protectedCount})`);

    const hasDraft2 = previewData.eligibleChecklists.some((c) => c.id === draft2.id);
    assert(hasDraft2, 'Draft 2 present in preview eligibleChecklists array');

    const hasProgInProtected = previewData.protectedChecklists.some((c) => c.id === inProgressJob.id);
    const hasCompInProtected = previewData.protectedChecklists.some((c) => c.id === completedJob.id);
    const hasIssuedInProtected = previewData.protectedChecklists.some((c) => c.id === issuedStockJob.id);
    assert(hasProgInProtected && hasCompInProtected && hasIssuedInProtected, 'All 3 protected jobs present in preview protectedChecklists array');

    // -----------------------------------------------------------------------
    // TEST 7: Delete All Safeguards (Count Mismatch & Idempotency)
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 7: Delete All Safeguards & Confirmation Validation ---');
    // 7a. Missing confirmedCount fails with HTTP 400
    const resNoCount = await fetch(`${baseUrl}/delete-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(resNoCount.status === 400, 'Delete All without confirmedCount strictly rejected with HTTP 400');

    // 7b. Count mismatch fails with HTTP 400
    const resBadCount = await fetch(`${baseUrl}/delete-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedCount: 999999, params: { search: `${testNow}` } }),
    });
    assert(resBadCount.status === 400, 'Delete All with count mismatch strictly rejected with HTTP 400');

    // 7c. Execute Delete All with matching confirmedCount
    const resBulkSuccess = await fetch(`${baseUrl}/delete-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedCount: previewData.eligibleCount, params: { search: `${testNow}` } }),
    });
    assert(resBulkSuccess.status === 200, 'Delete All with verified count succeeded with HTTP 200');
    const bulkResult = await resBulkSuccess.json();
    assert(bulkResult.deletedCount >= 1, `Deleted expected eligible count (${bulkResult.deletedCount} deleted)`);
    assert(bulkResult.skippedCount >= 3, `Strictly preserved protected jobs (${bulkResult.skippedCount} skipped)`);

    // Verify Draft 2 is now deleted
    const verifyDraft2 = await getChecklistById(draft2.id).catch(() => null);
    assert(!verifyDraft2, 'Draft 2 verified deleted from database');

    // Verify Protected jobs are 100% PRESERVED
    const verifyProg = await getChecklistById(inProgressJob.id);
    const verifyComp = await getChecklistById(completedJob.id);
    const verifyIssued = await getChecklistById(issuedStockJob.id);
    assert(verifyProg && verifyProg.id === inProgressJob.id, 'In-Progress job confirmed preserved in database');
    assert(verifyComp && verifyComp.id === completedJob.id, 'Completed job confirmed preserved in database');
    assert(verifyIssued && verifyIssued.id === issuedStockJob.id, 'Stock-issued job confirmed preserved in database');

    // -----------------------------------------------------------------------
    // TEST 8: Inventory & Data Integrity Verification
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 8: Data & Stock Integrity Verification ---');
    const postMaterials = await getMaterialInventory();
    const postTapeStock = postMaterials.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;
    const postWireStock = postMaterials.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;

    assert(postTapeStock === initialTapeStock, 'Store inventory Insulation Tape stock strictly unchanged', `Stock: ${postTapeStock}`);
    assert(postWireStock === initialWireStock, 'Store inventory 0.5 mm Wire stock strictly unchanged', `Stock: ${postWireStock}`);

    // -----------------------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------------------
    console.log('\n--- Cleaning up test fixtures ---');
    for (const id of createdChecklistIds) {
      await supabase.from('installation_checklists').delete().eq('id', id);
      await supabase.from('engineer_bookings').delete().eq('checklist_id', id);
      await supabase.from('store_material_requirements').delete().eq('checklist_id', id);
      await supabase.from('coordinator_bookings').delete().eq('checklist_id', id);
    }

    console.log('\n========================================================================');
    console.log(` ALL CHECKLIST DELETION SUITE TESTS PASSED (${passed}/${total})`);
    console.log('========================================================================\n');
  } finally {
    server.close();
  }
}

runChecklistPageDeletionTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
