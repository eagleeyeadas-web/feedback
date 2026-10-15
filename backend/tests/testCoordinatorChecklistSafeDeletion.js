import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  createChecklist,
  getChecklistById,
  checkChecklistDeletionEligibility,
  safeDeleteChecklist,
  previewChecklistsDeletion,
  safeDeleteAllEligibleChecklists,
  cancelChecklist,
  inMemoryChecklistExtraConfigs,
  inMemoryChecklistBomSnapshots,
} from '../src/services/installationService.js';
import {
  reserveEngineerAtomic,
  checkEngineerAvailability,
} from '../src/services/engineerBookingService.js';
import { inMemoryCompletionReports, inMemoryCarryRecords } from '../src/services/workflowService.js';
import { inMemoryStoreRequirements } from '../src/services/storeRequirementService.js';
import { inMemoryStockMovements } from '../src/services/stockMovementService.js';
import { inMemoryJobExpenses } from '../src/services/expenseService.js';
import { inMemoryExtensions } from '../src/services/scheduleExtensionService.js';
import { inMemoryBookings } from '../src/services/coordinatorBookingService.js';

import coordinatorRoutes from '../src/routes/coordinator.js';
import installationRoutes from '../src/routes/installation.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — COORDINATOR SAFE CHECKLIST DELETION TEST SUITE   ');
  console.log('  Testing: Eligibility, Dependency Guards, Role Security, Delete All    ');
  console.log('========================================================================\n');

  // Clear in-memory maps from previous tests to guarantee clean isolated state
  inMemoryCompletionReports.clear();
  inMemoryCarryRecords.clear();
  inMemoryStoreRequirements.clear();
  inMemoryStockMovements.length = 0;
  inMemoryJobExpenses.clear();
  inMemoryExtensions.clear();
  inMemoryBookings.clear();

  // Test Profiles
  const userSales = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'sales@gmail.com',
    role: 'SALES',
  };

  const userTech = {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'tech@gmail.com',
    role: 'TECHNICAL',
  };

  const userStore = {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'store@gmail.com',
    role: 'STORE_MANAGER',
  };

  const userCoordinator = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'coordinator@gmail.com',
    role: 'COORDINATOR',
  };

  const userAdmin = {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'admin@gmail.com',
    role: 'ADMIN',
  };

  // Express Test Server
  const testApp = express();
  testApp.use(express.json());

  let activeSimulatedUser = userCoordinator;
  testApp.use((req, res, next) => {
    req.user = activeSimulatedUser;
    req.profile = activeSimulatedUser;
    req.adminUser = activeSimulatedUser;
    next();
  });

  testApp.use('/api/admin/coordinator', coordinatorRoutes);
  testApp.use('/api/admin/installations', installationRoutes);

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(method, routePath, body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${routePath}`, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  // Unique future date generator to avoid any conflicts with existing bookings
  const uniqueOffset = Math.floor(Math.random() * 500) + 200;
  const getUniqueDate = (dayOffset = 0) => {
    const base = new Date('2028-06-01T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + uniqueOffset + dayOffset);
    return base.toISOString().split('T')[0];
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: Role Authorization Safeguards (Backend Least-Privilege Enforced)
    // --------------------------------------------------------------------------
    console.log('-> Test 1: Role Authorization Safeguards on Deletion Endpoints...');

    // A. Sales user blocked from coordinator deletion preview
    activeSimulatedUser = userSales;
    let res = await api('GET', '/api/admin/coordinator/checklists/deletion-preview');
    assert.strictEqual(res.status, 403, 'Sales user must be blocked with 403 from coordinator deletion preview');

    // B. Tech user blocked from coordinator delete-all
    activeSimulatedUser = userTech;
    res = await api('POST', '/api/admin/coordinator/checklists/delete-all', { confirmedCount: 1 });
    assert.strictEqual(res.status, 403, 'Tech user must be blocked with 403 from coordinator delete-all');

    // C. Store Manager blocked from coordinator single delete
    activeSimulatedUser = userStore;
    res = await api('DELETE', '/api/admin/coordinator/checklists/fake-id');
    assert.strictEqual(res.status, 403, 'Store Manager must be blocked with 403 from coordinator single delete');

    // D. Sales user blocked from DELETE /api/admin/installations/:id
    activeSimulatedUser = userSales;
    res = await api('DELETE', '/api/admin/installations/fake-id');
    assert.strictEqual(res.status, 403, 'Sales user must be blocked with 403 from DELETE /installations/:id');

    // E. Coordinator user allowed to access deletion preview (200 OK)
    activeSimulatedUser = userCoordinator;
    res = await api('GET', '/api/admin/coordinator/checklists/deletion-preview');
    assert.strictEqual(res.status, 200, 'Coordinator must be allowed to access deletion preview');

    console.log('   ✓ Passed: Unauthorized roles (Sales, Tech, Store) strictly blocked (403). Coordinators authorized.\n');

    // --------------------------------------------------------------------------
    // Test 2: Safe Deletion of Unprocessed Draft Checklist
    // --------------------------------------------------------------------------
    console.log('-> Test 2: Safe Permanent Deletion of Eligible Unprocessed Draft...');
    const dateDraft = getUniqueDate(1);
    const draftChecklist = await createChecklist(userSales.id, {
      client_name: 'Alpha Safe Draft Logistics',
      client_mobile: '9888811111',
      client_location: 'Warehouse District B',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 15000,
      expected_arrival_date: dateDraft,
      installation_duration: '1 Day',
      service_engineer: 'Mathi',
      installation_status: 'Assigned',
    });

    assert(draftChecklist && draftChecklist.id, 'Draft checklist must be created');

    // Check eligibility
    const eligibility = await checkChecklistDeletionEligibility(draftChecklist.id);
    assert.strictEqual(eligibility.isEligible, true, 'Fresh draft checklist must be eligible for deletion');
    assert.strictEqual(eligibility.reasons.length, 0, 'No protection reasons should exist for fresh draft');

    // Check that Mathi was reserved for dateDraft
    let avail = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: dateDraft,
      endDate: dateDraft,
    });
    assert.strictEqual(avail.available, false, 'Engineer should be booked before deletion');

    // Execute safe delete via API as Coordinator
    activeSimulatedUser = userCoordinator;
    res = await api('DELETE', `/api/admin/coordinator/checklists/${draftChecklist.id}`);
    assert.strictEqual(res.status, 200, 'Coordinator deleting eligible draft must succeed (200 OK)');
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.deletedId, draftChecklist.id);

    // Verify engineer reservation was released
    avail = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: dateDraft,
      endDate: dateDraft,
    });
    assert.strictEqual(avail.available, true, 'Engineer reservation must be released upon draft deletion');

    // Verify checklist is deleted from DB
    await assert.rejects(
      async () => await getChecklistById(draftChecklist.id, { enrich: false }),
      /not found/i,
      'Deleted checklist must no longer exist in database'
    );

    console.log('   ✓ Passed: Eligible draft safely deleted, engineer booking released, record removed.\n');

    // --------------------------------------------------------------------------
    // Test 3: Dependency Guard — In-Progress and Completed Jobs Protected
    // --------------------------------------------------------------------------
    console.log('-> Test 3: Dependency Guard — Protecting In-Progress and Completed Jobs...');
    const completedJob = await createChecklist(userSales.id, {
      client_name: 'Beta Completed Transport',
      client_mobile: '9888822222',
      client_location: 'Harbor Gate 4',
      device_type: '4 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 2,
      confirmed_price: 45000,
      expected_arrival_date: getUniqueDate(10),
      installation_duration: '1 Day',
      service_engineer: 'Guna',
      installation_status: 'Completed',
    });

    const inProgressJob = await createChecklist(userSales.id, {
      client_name: 'Gamma InProgress Freight',
      client_mobile: '9888833333',
      client_location: 'Central Depot',
      device_type: '2 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 20000,
      expected_arrival_date: getUniqueDate(12),
      installation_duration: '1 Day',
      service_engineer: 'Sakthivel',
      installation_status: 'In Progress',
    });

    // Attempting to delete completed job must fail with 409
    res = await api('DELETE', `/api/admin/coordinator/checklists/${completedJob.id}`);
    assert.strictEqual(res.status, 409, 'Completed job must return 409 Conflict');
    assert(res.data.reasons && res.data.reasons.length > 0, 'Reasons must explain status protection');
    assert(res.data.reasons.some((r) => r.includes('Completed')), 'Reason must cite Completed status');

    // Attempting to delete in-progress job must fail with 409
    res = await api('DELETE', `/api/admin/coordinator/checklists/${inProgressJob.id}`);
    assert.strictEqual(res.status, 409, 'In Progress job must return 409 Conflict');
    assert(res.data.reasons.some((r) => r.includes('In Progress')), 'Reason must cite In Progress status');

    console.log('   ✓ Passed: Operational jobs (Completed, In Progress) protected against deletion (409).\n');

    // --------------------------------------------------------------------------
    // Test 4: Dependency Guard — Protecting Checklist with Completion Report
    // --------------------------------------------------------------------------
    console.log('-> Test 4: Dependency Guard — Protecting Checklist with Completion Report...');
    const reportJob = await createChecklist(userSales.id, {
      client_name: 'Delta Report Express',
      client_mobile: '9888844444',
      client_location: 'North Bypass',
      device_type: '4 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 30000,
      expected_arrival_date: getUniqueDate(15),
      installation_duration: '1 Day',
      service_engineer: 'Kamalesh',
      installation_status: 'Assigned',
    });

    // Simulate completion report submitted in memory store
    inMemoryCompletionReports.set(reportJob.id, {
      id: `rep-${reportJob.id}`,
      checklist_id: reportJob.id,
      completion_status: 'FULL_INSTALLATION_COMPLETED',
      technician_name: 'Kamalesh',
      reconciliation_status: 'FULL_INSTALLATION_COMPLETED',
    });

    res = await api('DELETE', `/api/admin/coordinator/checklists/${reportJob.id}`);
    assert.strictEqual(res.status, 409, 'Checklist with completion report must return 409 Conflict');
    assert(res.data.reasons.some((r) => r.includes('completion report')), 'Reason must cite completion report');

    console.log('   ✓ Passed: Operational completion reports protected against deletion.\n');

    // --------------------------------------------------------------------------
    // Test 5: Dependency Guard — Protecting Checklist with Issued Store Stock
    // --------------------------------------------------------------------------
    console.log('-> Test 5: Dependency Guard — Protecting Checklist with Issued Store Stock...');
    const stockIssuedJob = await createChecklist(userSales.id, {
      client_name: 'Epsilon Stock Issued Ltd',
      client_mobile: '9888855555',
      client_location: 'Ring Road Pier',
      device_type: '2 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 2,
      confirmed_price: 35000,
      expected_arrival_date: getUniqueDate(18),
      installation_duration: '1 Day',
      service_engineer: 'Mathi',
      installation_status: 'Assigned',
    });

    // Simulate Store Manager stock issuance in memory store requirement
    inMemoryStoreRequirements.set(stockIssuedJob.id, {
      id: `req-${stockIssuedJob.id}`,
      checklist_id: stockIssuedJob.id,
      status: 'ISSUED',
      material_issuance_status: 'ISSUED',
      devices_issuance_status: 'ISSUED',
      devices_issued: 2,
      materials_issued: 5,
    });

    res = await api('DELETE', `/api/admin/coordinator/checklists/${stockIssuedJob.id}`);
    assert.strictEqual(res.status, 409, 'Checklist with issued stock must return 409 Conflict');
    assert(res.data.reasons.some((r) => r.includes('issued')), 'Reason must cite stock issuance');

    console.log('   ✓ Passed: Inventory issuances and Store requirements protected against deletion.\n');

    // --------------------------------------------------------------------------
    // Test 6: Dependency Guard — Protecting Checklist with Carry Records & Stock Movements
    // --------------------------------------------------------------------------
    console.log('-> Test 6: Dependency Guard — Protecting Carry Records & Stock Ledger Movements...');
    const carryJob = await createChecklist(userSales.id, {
      client_name: 'Zeta Carry Fleet',
      client_mobile: '9888866666',
      client_location: 'South Terminal',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      expected_arrival_date: getUniqueDate(22),
      installation_duration: '1 Day',
      service_engineer: 'Guna',
      installation_status: 'Assigned',
    });

    // Attach carry record and stock movement
    inMemoryCarryRecords.set(carryJob.id, {
      id: `carry-${carryJob.id}`,
      checklist_id: carryJob.id,
      items: [{ item_name: '4 Channel Live', quantity_carried: 1 }],
    });
    inMemoryStockMovements.push({
      id: `mov-${carryJob.id}`,
      checklist_id: carryJob.id,
      movement_type: 'ISSUE_TO_JOB',
      quantity: 1,
      item_name: '4 Channel Live',
    });

    res = await api('DELETE', `/api/admin/coordinator/checklists/${carryJob.id}`);
    assert.strictEqual(res.status, 409, 'Checklist with carry and movement records must return 409 Conflict');
    assert(res.data.reasons.some((r) => r.includes('carry record') || r.includes('stock movement')));

    console.log('   ✓ Passed: Carry records and stock movements protected against deletion.\n');

    // --------------------------------------------------------------------------
    // Test 7: Dependency Guard — Protecting Checklist with Job Expenses & Bookings
    // --------------------------------------------------------------------------
    console.log('-> Test 7: Dependency Guard — Protecting Job Expenses & Arranged Travel/Hotel...');
    const expenseJob = await createChecklist(userSales.id, {
      client_name: 'Eta Expense Logistics',
      client_mobile: '9888877777',
      client_location: 'Outer Highway',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 18000,
      expected_arrival_date: getUniqueDate(25),
      installation_duration: '1 Day',
      service_engineer: 'Sakthivel',
      installation_status: 'Assigned',
    });

    // Attach technician expense claim
    inMemoryJobExpenses.set(`exp-${expenseJob.id}`, {
      id: `exp-${expenseJob.id}`,
      checklist_id: expenseJob.id,
      amount: 450,
      status: 'Recorded',
      category: 'Food',
    });

    // Attach arranged coordinator booking
    inMemoryBookings.set(expenseJob.id, {
      checklist_id: expenseJob.id,
      booking_status: 'IN_PROGRESS',
      travel_required: true,
      ticket_reference: 'BUS-TN-9921',
    });

    res = await api('DELETE', `/api/admin/coordinator/checklists/${expenseJob.id}`);
    assert.strictEqual(res.status, 409, 'Checklist with expenses & travel tickets must return 409 Conflict');
    assert(res.data.reasons.some((r) => r.includes('expense') || r.includes('Travel')));

    console.log('   ✓ Passed: Expenses and travel tickets protected against deletion.\n');

    // --------------------------------------------------------------------------
    // Test 8: Cancellation / Archival Fallback Workflow
    // --------------------------------------------------------------------------
    console.log('-> Test 8: Cancellation / Archival Fallback when Deletion is Unsafe...');
    // expenseJob cannot be permanently deleted, but CAN be cancelled
    res = await api('POST', `/api/admin/coordinator/checklists/${expenseJob.id}/cancel`, {
      reason: 'Client rescheduled indefinitely',
    });
    assert.strictEqual(res.status, 200, 'Cancelling checklist must succeed (200 OK)');
    assert.strictEqual(res.data.success, true);

    // Verify updated status in database
    const cancelledRecord = await getChecklistById(expenseJob.id, { enrich: false });
    assert.strictEqual(cancelledRecord.installation_status, 'Cancelled');
    assert(cancelledRecord.remarks.includes('Client rescheduled indefinitely'));

    // Verify expenses and bookings are preserved intact
    const preservedExpense = inMemoryJobExpenses.get(`exp-${expenseJob.id}`);
    assert(preservedExpense, 'Expense record must remain intact after cancellation');
    const preservedBooking = inMemoryBookings.get(expenseJob.id);
    assert(preservedBooking, 'Booking record must remain intact after cancellation');

    console.log('   ✓ Passed: Cancellation preserves business records, expenses, and travel logistics.\n');

    // --------------------------------------------------------------------------
    // Test 9: "Delete All" Preview & Confirmation Safeguards
    // --------------------------------------------------------------------------
    console.log('-> Test 9: Delete All Preview, Safeguards & Count Confirmation...');

    // Create 2 fresh eligible drafts
    const eligible1 = await createChecklist(userSales.id, {
      client_name: 'Batch Eligible 1',
      client_mobile: '9888888801',
      client_location: 'East Wharf',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 15000,
      expected_arrival_date: getUniqueDate(30),
      installation_duration: '1 Day',
      service_engineer: 'Mathi',
      installation_status: 'Assigned',
    });

    const eligible2 = await createChecklist(userSales.id, {
      client_name: 'Batch Eligible 2',
      client_mobile: '9888888802',
      client_location: 'East Wharf',
      device_type: '2 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 18000,
      expected_arrival_date: getUniqueDate(32),
      installation_duration: '1 Day',
      service_engineer: 'Guna',
      installation_status: 'Assigned',
    });

    // Call deletion preview API
    res = await api('GET', '/api/admin/coordinator/checklists/deletion-preview');
    assert.strictEqual(res.status, 200);
    const preview = res.data;
    assert(preview.eligibleCount >= 2, `Eligible count must be at least 2 (found ${preview.eligibleCount})`);
    assert(preview.protectedCount >= 3, `Protected count must be at least 3 (found ${preview.protectedCount})`);
    assert(preview.explanation && preview.explanation.includes('Active assignments'));

    // A. Calling delete-all without confirmedCount -> 400 Bad Request
    res = await api('POST', '/api/admin/coordinator/checklists/delete-all', {});
    assert.strictEqual(res.status, 400, 'Must require confirmedCount parameter');

    // B. Calling delete-all with mismatched count -> 400 Bad Request
    res = await api('POST', '/api/admin/coordinator/checklists/delete-all', {
      confirmedCount: preview.eligibleCount + 99,
    });
    assert.strictEqual(res.status, 400, 'Must reject mismatched count');
    assert(res.data.error.includes('mismatch'));

    // C. Calling delete-all with exact confirmedCount -> Safely deletes ONLY eligible drafts
    res = await api('POST', '/api/admin/coordinator/checklists/delete-all', {
      confirmedCount: preview.eligibleCount,
    });
    assert.strictEqual(res.status, 200, 'Delete all with confirmed count must succeed');
    assert.strictEqual(res.data.deletedCount, preview.eligibleCount);
    assert.strictEqual(res.data.skippedCount, preview.protectedCount);
    assert.strictEqual(res.data.failedCount, 0);

    // Verify eligible1 and eligible2 are gone
    await assert.rejects(
      async () => await getChecklistById(eligible1.id, { enrich: false }),
      /not found/i
    );
    await assert.rejects(
      async () => await getChecklistById(eligible2.id, { enrich: false }),
      /not found/i
    );

    // Verify protected completedJob and inProgressJob STILL exist
    const survivingCompleted = await getChecklistById(completedJob.id, { enrich: false });
    assert(survivingCompleted && survivingCompleted.id === completedJob.id, 'Completed job must NOT be deleted');
    const survivingInProgress = await getChecklistById(inProgressJob.id, { enrich: false });
    assert(survivingInProgress && survivingInProgress.id === inProgressJob.id, 'In Progress job must NOT be deleted');

    console.log('   ✓ Passed: Delete All strictly verifies eligible count, deletes only drafts, preserves protected data.\n');

    // --------------------------------------------------------------------------
    // Test 10: Idempotency & Clean Error Handling on Duplicate Requests
    // --------------------------------------------------------------------------
    console.log('-> Test 10: Idempotency & Duplicate Request Handling...');
    // Attempting to delete already deleted eligible1
    res = await api('DELETE', `/api/admin/coordinator/checklists/${eligible1.id}`);
    assert(res.status === 404 || res.status === 500, 'Deleting non-existent checklist returns error status');

    console.log('   ✓ Passed: Duplicate/non-existent deletions fail cleanly without corrupting state.\n');

    // Clean up test server
    server.close();

    console.log('========================================================================');
    console.log('  ALL 10 SAFE CHECKLIST DELETION ACCEPTANCE CRITERIA PASSED 100%!       ');
    console.log('========================================================================\n');
  } catch (err) {
    server.close();
    console.error('TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runTestSuite();
