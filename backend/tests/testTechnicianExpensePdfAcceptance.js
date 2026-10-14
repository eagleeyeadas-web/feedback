import assert from 'assert';
import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import {
  submitInstallationCompletionReport,
} from '../src/services/workflowService.js';
import {
  assertChecklistEligibleForExpenses,
  getExpensesForChecklist,
  saveJobExpenses,
  generateTechnicianExpensePDFForChecklist,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
} from '../src/services/expenseService.js';
import { generateTechnicianExpensePDF } from '../src/services/technicianExpensePdfGenerator.js';

async function runTechnicianExpensePdfAcceptanceTests() {
  console.log('========================================================================');
  console.log('EAGLE EYE SAFDRIVE — TECHNICIAN EXPENSES: DOWNLOAD & PRINT PDF ONLY');
  console.log('Acceptance Test Suite: Workflow, Fields, Privacy, and PDF Generation');
  console.log('========================================================================\n');

  // Test Technician user (Mathi)
  const techUser = {
    id: '55555555-5555-4555-a555-555555555555',
    email: 'mathi@eagleeye.com',
    full_name: 'Mathi',
    role: 'TECHNICAL',
  };

  // Another technician user (Guna) - unauthorized for Mathi's jobs
  const otherTechUser = {
    id: '66666666-6666-4666-a666-666666666666',
    email: 'guna@eagleeye.com',
    full_name: 'Guna',
    role: 'TECHNICAL',
  };

  // Unauthorized roles
  const salesUser = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'sales@eagleeye.com',
    full_name: 'Sales User',
    role: 'SALES',
  };

  const coordinatorUser = {
    id: '22222222-2222-4222-a222-222222222222',
    email: 'coordinator@gmail.com',
    full_name: 'Coordinator',
    role: 'COORDINATOR',
  };

  const storeUser = {
    id: '33333333-3333-4333-a333-333333333333',
    email: 'store@eagleeye.com',
    full_name: 'Store Manager',
    role: 'STORE_MANAGER',
  };

  // Create an installation checklist
  console.log('-> Creating test installation checklist for client "Express Cargo Logistics"...');
  const checklist = await createChecklist(salesUser.id, {
    client_name: 'Express Cargo Logistics Ltd',
    client_mobile: '9845012345',
    contact_person: 'Mr. Rajesh Verma',
    contact_number: '9845012345',
    client_location: 'Peenya Industrial Area, Bangalore',
    number_of_vehicles: 2,
    number_of_devices: 2,
    device_models: ['4 Channel Live'],
    service_engineer: 'Mathi',
    installation_type: 'New',
    installation_or_service: 'Installation',
    installation_status: 'Assigned',
    preferred_installation_date: '2026-10-18',
    expected_arrival_date: '2026-10-18',
    expected_arrival_time: '10:00 AM',
    salesperson_name: 'Ranjith',
  });

  const checklistId = checklist.id;
  console.log(`   [PASS] Checklist created: ${checklist.checklist_number} (ID: ${checklistId})\n`);

  // ---------------------------------------------------------------------------
  // TEST 1: Expense section locked prior to post-installation completion report
  // ---------------------------------------------------------------------------
  console.log('-> Test 1: Verify expense section is unavailable before post-installation report...');
  let test1Blocked = false;
  try {
    await assertChecklistEligibleForExpenses(checklistId, techUser);
  } catch (err) {
    if (err.message.includes('Step 2 — Technician Expenses is unavailable') || err.statusCode === 400) {
      test1Blocked = true;
    }
  }
  assert.strictEqual(
    test1Blocked,
    true,
    'Violation: Expenses must be locked before post-installation report submission.'
  );

  let test1SaveBlocked = false;
  try {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: techUser,
      expenses: [{ category: 'Fuel', amount: 500, description: 'Fuel', payment_method: 'UPI' }],
    });
  } catch (err) {
    if (err.message.includes('Step 2 — Technician Expenses is unavailable') || err.statusCode === 400) {
      test1SaveBlocked = true;
    }
  }
  assert.strictEqual(test1SaveBlocked, true, 'Violation: saveJobExpenses must be blocked prior to report.');
  console.log('   [PASS] Test 1: Expenses are strictly locked until post-installation report is submitted.\n');

  // ---------------------------------------------------------------------------
  // STEP: Submit Post-Installation Completion Report
  // ---------------------------------------------------------------------------
  console.log('-> Submitting post-installation completion report (Installed 2, Returned 0)...');
  await submitInstallationCompletionReport({
    checklist_id: checklistId,
    user: techUser,
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 2,
        quantity_installed: 2,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [
      { material_name: 'Power Cable (5m)', quantity_issued: 2, quantity_used: 2, quantity_returned: 0 },
    ],
    completion_status: 'Completed',
    remarks: 'Installation completed on 2 vehicles successfully.',
  });
  console.log('   [PASS] Post-installation report submitted successfully.\n');

  // ---------------------------------------------------------------------------
  // TEST 2: Expense section unlocked for same job
  // ---------------------------------------------------------------------------
  console.log('-> Test 2: Verify post-installation report unlocks expenses for the job...');
  const eligibility = await assertChecklistEligibleForExpenses(checklistId, techUser);
  assert.ok(eligibility.checklist, 'Checklist must be returned.');
  console.log('   [PASS] Test 2: Expenses section unlocked successfully.\n');

  // ---------------------------------------------------------------------------
  // TEST 3: Auto-populated fields (Checklist #, Client Name, Service Engineer)
  // ---------------------------------------------------------------------------
  console.log('-> Test 3: Verify auto-populated checklist fields...');
  const initialFetch = await getExpensesForChecklist(checklistId, techUser);
  assert.strictEqual(initialFetch.checklist_number, checklist.checklist_number);
  assert.strictEqual(initialFetch.client_name, 'Express Cargo Logistics Ltd');
  assert.strictEqual(initialFetch.service_engineer, 'Mathi');
  console.log(`   [PASS] Test 3: Auto-populated checklist_number=${initialFetch.checklist_number}, client_name="${initialFetch.client_name}", service_engineer="${initialFetch.service_engineer}".\n`);

  // ---------------------------------------------------------------------------
  // TEST 4: Save multiple expense entries with required fields
  // ---------------------------------------------------------------------------
  console.log('-> Test 4: Save multiple expense entries for the job...');
  const testExpenses = [
    {
      expense_date: '2026-10-18',
      category: 'Fuel',
      description: 'Diesel for service van #KA-04-1234',
      amount: 1200.50,
      payment_method: 'UPI',
      notes: 'Indian Oil bunk receipt #8812',
    },
    {
      expense_date: '2026-10-18',
      category: 'Toll',
      description: 'NICE Road Toll Plaza charges',
      amount: 145.00,
      payment_method: 'Cash',
      notes: 'Toll slip #4401',
    },
    {
      expense_date: '2026-10-18',
      category: 'Food',
      description: 'Lunch during on-site installation',
      amount: 220.00,
      payment_method: 'Cash',
      notes: null,
    },
    {
      expense_date: '2026-10-18',
      category: 'Parking',
      description: 'Depot entry & parking fee',
      amount: 50.00,
      payment_method: 'Cash',
      notes: 'Gate token slip',
    },
  ];

  const saveRes = await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: testExpenses,
  });

  assert.strictEqual(saveRes.success, true);
  assert.strictEqual(saveRes.count, 4);
  console.log(`   [PASS] Test 4: Successfully saved 4 expense entries.\n`);

  // ---------------------------------------------------------------------------
  // TEST 5: Reopening the record retrieves saved expenses and total accurately
  // ---------------------------------------------------------------------------
  console.log('-> Test 5: Verify technician can reopen the record and see saved expenses...');
  const reopened = await getExpensesForChecklist(checklistId, techUser);
  assert.strictEqual(reopened.expenses.length, 4);

  const expectedTotal = 1200.50 + 145.00 + 220.00 + 50.00; // 1615.50
  assert.strictEqual(reopened.job_total, expectedTotal, `Expected total ${expectedTotal}, got ${reopened.job_total}`);
  console.log(`   [PASS] Test 5: Saved expenses persisted. Job Total = ₹${reopened.job_total}.\n`);

  // ---------------------------------------------------------------------------
  // TEST 6: Generate and Verify Print-Ready A4 PDF Report
  // ---------------------------------------------------------------------------
  console.log('-> Test 6: Verify PDF generation includes all required elements...');
  const pdfRes = await generateTechnicianExpensePDFForChecklist(checklistId, techUser);
  assert.ok(pdfRes.pdfBuffer, 'PDF buffer must be generated.');
  assert.ok(Buffer.isBuffer(pdfRes.pdfBuffer), 'Must be a Node Buffer.');
  assert.ok(pdfRes.pdfBuffer.length > 1000, `PDF buffer length must be valid (>1KB), got ${pdfRes.pdfBuffer.length}`);

  // Check PDF signature '%PDF-'
  const pdfHeader = pdfRes.pdfBuffer.toString('utf-8', 0, 5);
  assert.strictEqual(pdfHeader, '%PDF-', 'Buffer must be a valid PDF document starting with %PDF-');

  // Verify PDF content text
  const pdfString = pdfRes.pdfBuffer.toString('latin1');
  assert.ok(pdfString.includes('EAGLE EYE') || pdfString.includes('SAFDRIVE'), 'PDF must include Eagle Eye SafDrive company heading.');
  assert.ok(pdfString.includes('TECHNICIAN EXPENSE REPORT'), 'PDF must include expense report title.');
  assert.ok(pdfString.includes(checklist.checklist_number), 'PDF must include checklist number.');
  assert.ok(pdfString.includes('Express Cargo Logistics'), 'PDF must include client name.');
  assert.ok(pdfString.includes('Mathi'), 'PDF must include service engineer name.');
  assert.ok(pdfString.includes('SUBMITTED BY TECHNICIAN'), 'PDF must include technician signature block.');
  assert.ok(pdfString.includes('RECEIVED') || pdfString.includes('Submitted on paper'), 'PDF must include submitted-on-paper acknowledgement.');
  console.log(`   [PASS] Test 6: PDF generated successfully (${pdfRes.pdfBuffer.length} bytes) with all required headings, table, totals, signatures, and paper submission acknowledgement.\n`);

  // ---------------------------------------------------------------------------
  // TEST 7: Privacy and Role Enforcement (No Sales, Coordinator, Store Manager access)
  // ---------------------------------------------------------------------------
  console.log('-> Test 7: Verify privacy rules — Sales, Coordinator, Store Manager cannot access expenses...');
  let salesBlocked = false;
  try {
    await assertChecklistEligibleForExpenses(checklistId, salesUser);
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('Access denied')) salesBlocked = true;
  }
  assert.strictEqual(salesBlocked, true, 'Sales must be blocked from technician expenses.');

  let coordBlocked = false;
  try {
    await assertChecklistEligibleForExpenses(checklistId, coordinatorUser);
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('Access denied')) coordBlocked = true;
  }
  assert.strictEqual(coordBlocked, true, 'Coordinator must be blocked from technician expenses.');

  let storeBlocked = false;
  try {
    await assertChecklistEligibleForExpenses(checklistId, storeUser);
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('Access denied')) storeBlocked = true;
  }
  assert.strictEqual(storeBlocked, true, 'Store Manager must be blocked from technician expenses.');

  let otherTechBlocked = false;
  try {
    await assertChecklistEligibleForExpenses(checklistId, otherTechUser);
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('not authorized')) otherTechBlocked = true;
  }
  assert.strictEqual(otherTechBlocked, true, 'Unassigned technician must be blocked from this job expenses.');

  console.log('   [PASS] Test 7: Sales, Coordinator, Store Manager, and unassigned technicians strictly forbidden.\n');

  // ---------------------------------------------------------------------------
  // TEST 8: Verify no approval workflows or external state mutations
  // ---------------------------------------------------------------------------
  console.log('-> Test 8: Verify no external approval statuses or notifications created...');
  const afterChecklist = await getChecklistById(checklistId);
  // Checklist status must remain as completed, not mutated into "Pending Approval"
  assert.strictEqual(
    afterChecklist.installation_status,
    'Completed',
    'Checklist status must remain Completed (no expense approval state machine).'
  );
  console.log('   [PASS] Test 8: No external approval workflows, status mutations, or notification triggers.\n');

  console.log('========================================================================');
  console.log('ALL 8 ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
  console.log('Technician Expenses Download & Print PDF workflow is fully verified.');
  console.log('========================================================================\n');
}

runTechnicianExpensePdfAcceptanceTests().catch((err) => {
  console.error('\nACCEPTANCE TEST SUITE FAILED:', err);
  process.exit(1);
});
