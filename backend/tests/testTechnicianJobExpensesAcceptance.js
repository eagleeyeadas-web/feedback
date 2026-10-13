import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  submitDeviceCarryRecord,
  startInstallationJob,
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  getPendingStoreReturns,
  verifyStoreReturn,
} from '../src/services/workflowService.js';
import {
  assertChecklistEligibleForExpenses,
  getExpensesForChecklist,
  saveJobExpenses,
  uploadExpenseReceipt,
  getTechnicianCurrentMonthTotal,
} from '../src/services/expenseService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';

async function runTechnicianJobExpensesAcceptanceTests() {
  console.log('========================================================================');
  console.log('EAGLE EYE SAFDRIVE — TECHNICIAN EXPENSES ACCEPTANCE TEST SUITE');
  console.log('Testing: Step 2 — Technician Expenses After Post-Installation Report');
  console.log('========================================================================\n');

  const techUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'karthik.tech@eagleeye.com',
    full_name: 'Karthik Raja',
    role: 'TECHNICAL',
  };

  const storeUser = {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'store@eagleeye.com',
    role: 'STORE_MANAGER',
  };

  // ---------------------------------------------------------------------------
  // STEP 0: Create fresh test installation checklist
  // ---------------------------------------------------------------------------
  console.log('-> Creating test installation checklist...');
  const checklist = await createChecklist(techUser.id, {
    client_name: 'Apollo Logistics Pvt Ltd',
    client_mobile: '9840123456',
    client_location: 'Guindy Industrial Estate, Chennai',
    device_type: '4 Channel Live',
    number_of_devices: 2,
    number_of_vehicles: 1,
    confirmed_price: 32000,
    payment_method: 'UPI',
    installation_or_service: 'Installation',
    expected_arrival_date: '2026-10-15',
    expected_arrival_time: '09:30 AM',
    service_engineer: 'Karthik Raja',
    service_assistant: 'Suresh Kumar',
    installation_status: 'Assigned',
  });

  const checklistId = checklist.id;
  console.log(`   [PASS] Checklist created: ${checklist.checklist_number} (ID: ${checklistId})\n`);

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 1: Expense form is unavailable before post-installation report
  // ---------------------------------------------------------------------------
  console.log('-> Test 1: Verify expense form is unavailable before post-installation submission...');
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
    'Violation of Test 1: Expense eligibility check must reject when post-installation report is missing.'
  );

  let test1SaveBlocked = false;
  try {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: techUser,
      expenses: [
        {
          category: 'Travel',
          amount: 350,
          payment_method: 'UPI',
          description: 'Auto fare to depot',
        },
      ],
    });
  } catch (err) {
    if (err.message.includes('Step 2 — Technician Expenses is unavailable') || err.statusCode === 400) {
      test1SaveBlocked = true;
    }
  }
  assert.strictEqual(
    test1SaveBlocked,
    true,
    'Violation of Test 1: Expense saving must be blocked before post-installation report is submitted.'
  );
  console.log('   [PASS] Test 1: Expenses are strictly locked before post-installation report submission.\n');

  // ---------------------------------------------------------------------------
  // STEP: Submit Post-Installation Completion Report
  // ---------------------------------------------------------------------------
  console.log('-> Submitting post-installation completion report...');
  // Total carried = 2 (number_of_devices: 2 from checklist). Reconciled: 1 installed, 1 to return.
  await submitInstallationCompletionReport({
    checklist_id: checklistId,
    user: techUser,
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 2,
        quantity_installed: 1,
        quantity_to_return: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [
      { material_name: 'Camera Cable (10m)', quantity_issued: 2, quantity_used: 1, quantity_returned: 1 },
    ],
    completion_status: 'Completed',
    remarks: 'Installation successful: 1 device installed, 1 device returned to store.',
  });
  console.log('   [PASS] Post-installation completion report submitted successfully.\n');

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 2: Submitting post-installation report unlocks expenses for same job
  // ---------------------------------------------------------------------------
  console.log('-> Test 2: Verify post-installation report submission unlocks expenses for this job...');
  const eligibility = await assertChecklistEligibleForExpenses(checklistId, techUser);
  assert.ok(eligibility.checklist, 'Checklist object must be returned upon unlock.');
  assert.ok(eligibility.completionReport, 'Completion report must be present.');
  console.log('   [PASS] Test 2: Step 2 — Technician Expenses unlocked for the job.\n');

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 3: Job number and client details populate correctly
  // ---------------------------------------------------------------------------
  console.log('-> Test 3: Verify job number and client details populate correctly...');
  const expenseData = await getExpensesForChecklist(checklistId, techUser);
  assert.strictEqual(
    expenseData.checklist_number,
    checklist.checklist_number,
    'Checklist number must populate automatically from the job.'
  );
  assert.strictEqual(
    expenseData.client_name,
    checklist.client_name,
    'Client name must populate automatically from the job.'
  );
  assert.strictEqual(
    expenseData.report_submitted,
    true,
    'report_submitted must reflect true.'
  );
  console.log(`   [PASS] Test 3: Auto-populated checklist_number=${expenseData.checklist_number}, client_name="${expenseData.client_name}".\n`);

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 4: Technician can add multiple expenses to the job with validation
  // ---------------------------------------------------------------------------
  console.log('-> Test 4: Verify adding multiple expenses and input validations...');
  // 4A: Validation - Amount <= 0 rejection
  let zeroAmountRejected = false;
  try {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: techUser,
      expenses: [
        { category: 'Food', amount: 0, payment_method: 'Cash', description: 'Zero amount item' },
      ],
    });
  } catch (err) {
    if (err.message.includes('greater than ₹0') || err.statusCode === 400) {
      zeroAmountRejected = true;
    }
  }
  assert.strictEqual(zeroAmountRejected, true, 'Violation of Test 4: Amount <= 0 must be rejected.');

  // 4B: Validation - Invalid category rejection
  let invalidCategoryRejected = false;
  try {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: techUser,
      expenses: [
        { category: 'NonExistentCategory', amount: 150, payment_method: 'Cash', description: 'Item' },
      ],
    });
  } catch (err) {
    if (err.message.includes('Invalid category') || err.statusCode === 400) {
      invalidCategoryRejected = true;
    }
  }
  assert.strictEqual(invalidCategoryRejected, true, 'Violation of Test 4: Invalid category must be rejected.');

  // 4C: Add multiple valid expenses
  const multipleExpenses = [
    {
      expense_date: '2026-10-15',
      category: 'Fuel',
      description: 'Petrol for service bike',
      amount: 450,
      payment_method: 'UPI',
      notes: 'Bunk at Guindy highway',
    },
    {
      expense_date: '2026-10-15',
      category: 'Food',
      description: 'Lunch for installation team (2 persons)',
      amount: 320,
      payment_method: 'Cash',
      notes: 'Meals near client warehouse',
    },
    {
      expense_date: '2026-10-15',
      category: 'Toll',
      description: 'OMR Express toll tollgate',
      amount: 85,
      payment_method: 'UPI',
    },
    {
      expense_date: '2026-10-15',
      category: 'Parking',
      description: 'Client tech park basement entry fee',
      amount: 40,
      payment_method: 'Cash',
    },
  ];

  const saveRes = await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: multipleExpenses,
    is_draft: false,
  });

  assert.strictEqual(saveRes.success, true, 'Expense recording must return success: true');
  assert.strictEqual(saveRes.count, 4, 'Must have recorded 4 entries');
  assert.strictEqual(saveRes.status, 'Recorded', 'Status must be Recorded');

  const afterMultiple = await getExpensesForChecklist(checklistId, techUser);
  const expectedSum = 450 + 320 + 85 + 40; // 895
  assert.strictEqual(
    afterMultiple.job_total,
    expectedSum,
    `Job total must equal ${expectedSum}, got ${afterMultiple.job_total}`
  );
  console.log(`   [PASS] Test 4: Successfully recorded 4 valid expenses. Job Total = ₹${afterMultiple.job_total}.\n`);

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 5: Idempotency prevents duplicates on retries
  // ---------------------------------------------------------------------------
  console.log('-> Test 5: Verify idempotency prevents duplicate expenses on network retry...');
  const idempotencyKey = `retry-token-${Date.now()}-abc`;
  const singleExpense = [
    {
      expense_date: '2026-10-15',
      category: 'Accommodation',
      description: 'Night lodge room for outstation visit',
      amount: 1200,
      payment_method: 'Company Payment',
    },
  ];

  // First request
  const attempt1 = await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: singleExpense,
    is_draft: false,
    idempotency_key: idempotencyKey,
  });
  assert.strictEqual(attempt1.success, true);

  // Network retry with identical idempotency key
  const attempt2 = await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: singleExpense,
    is_draft: false,
    idempotency_key: idempotencyKey,
  });
  assert.strictEqual(attempt2.idempotent_replay, true, 'Second call must be identified as idempotent replay');

  const afterRetry = await getExpensesForChecklist(checklistId, techUser);
  const expectedWithAccommodation = expectedSum + 1200; // 2095
  assert.strictEqual(
    afterRetry.job_total,
    expectedWithAccommodation,
    `Job total must not duplicate the 1200 accommodation expense! Expected ${expectedWithAccommodation}, got ${afterRetry.job_total}`
  );
  console.log('   [PASS] Test 5: Idempotency key protected against duplicate records on network retry.\n');

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 6: Technician can reopen job later to enter expenses & Drafts excluded from totals
  // ---------------------------------------------------------------------------
  console.log('-> Test 6: Verify reopening job, saving draft, and draft exclusion from totals...');
  // Save a draft expense of ₹600
  const draftExpense = [
    {
      expense_date: '2026-10-16',
      category: 'Travel',
      description: 'Return train ticket - tentative',
      amount: 600,
      payment_method: 'Personal Card',
    },
  ];

  const draftRes = await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: draftExpense,
    is_draft: true,
  });
  assert.strictEqual(draftRes.status, 'Draft', 'Status must be Draft');

  const withDraftSummary = await getExpensesForChecklist(checklistId, techUser);
  assert.strictEqual(withDraftSummary.draft_count >= 1, true, 'Draft count must be at least 1');
  assert.strictEqual(withDraftSummary.draft_total >= 600, true, 'Draft total must include draft amount');
  assert.strictEqual(
    withDraftSummary.job_total,
    expectedWithAccommodation,
    'Draft amount must NOT be included in job_total!'
  );
  console.log(`   [PASS] Test 6: Draft saved. Job Total remains ₹${withDraftSummary.job_total} (Drafts ₹${withDraftSummary.draft_total} strictly excluded).\n`);

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 7: Store return verification continues working independently
  // ---------------------------------------------------------------------------
  console.log('-> Test 7: Verify store return verification continues working independently...');
  const pendingReturns = await getPendingStoreReturns();
  const returnForThisJob = pendingReturns.find((r) => r.checklist_id === checklistId);
  assert.ok(
    returnForThisJob,
    'Store return record must exist for returned devices independently of expenses'
  );
  assert.strictEqual(
    returnForThisJob.status,
    'PENDING_STORE_VERIFICATION',
    'Store return must remain PENDING_STORE_VERIFICATION and not be marked verified merely because expenses were submitted'
  );

  // Store Manager verifies return
  const verifyRes = await verifyStoreReturn({
    return_id: returnForThisJob.id,
    user: storeUser,
    accepted_usable_qty: 1,
    damaged_qty: 0,
    missing_qty: 0,
    remarks: 'Verified 1 returned 4 Channel Live device in good condition',
  });
  assert.strictEqual(verifyRes.status, 'VERIFIED_AND_RECONCILED', 'Store Manager verification must succeed');
  console.log('   [PASS] Test 7: Device returns and store verification operate independently without disruption.\n');

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 8: Expenses do NOT alter inventory, BOM, or stock records
  // ---------------------------------------------------------------------------
  console.log('-> Test 8: Verify expenses do NOT mutate inventory balances or stock records...');
  const preProducts = await getInventoryProducts();
  const preMaterials = await getMaterialInventory();

  // Record another expense
  await saveJobExpenses({
    checklist_id: checklistId,
    user: techUser,
    expenses: [
      {
        expense_date: '2026-10-16',
        category: 'Other Travel Expense',
        description: 'Auto rickshaw connector',
        amount: 150,
        payment_method: 'Cash',
      },
    ],
    is_draft: false,
  });

  const postProducts = await getInventoryProducts();
  const postMaterials = await getMaterialInventory();

  // Compare each inventory item
  for (let i = 0; i < preProducts.length; i++) {
    const pre = preProducts[i];
    const post = postProducts.find((p) => p.id === pre.id);
    assert.strictEqual(
      Number(post?.usable_stock || 0),
      Number(pre.usable_stock || 0),
      `Inventory altered for product ${pre.name}! Expenses must never mutate stock.`
    );
  }
  for (let i = 0; i < preMaterials.length; i++) {
    const pre = preMaterials[i];
    const post = postMaterials.find((m) => m.id === pre.id);
    assert.strictEqual(
      Number(post?.current_stock || 0),
      Number(pre.current_stock || 0),
      `Material inventory altered for ${pre.material_name}! Expenses must never mutate stock.`
    );
  }
  console.log('   [PASS] Test 8: Zero inventory or material stock balance changes observed.\n');

  // ---------------------------------------------------------------------------
  // ACCEPTANCE TEST 9: Receipt upload validation
  // ---------------------------------------------------------------------------
  console.log('-> Test 9: Verify receipt upload validation (formats & size limits)...');
  // 9A: Valid image upload
  const dummyJpg = Buffer.from('fake-jpeg-image-data-test-safdrive');
  const validUpload = await uploadExpenseReceipt({
    buffer: dummyJpg,
    originalname: 'toll_receipt.jpg',
    mimetype: 'image/jpeg',
    checklist_id: checklistId,
  });
  assert.ok(validUpload.receipt_url, 'Must return receipt_url for valid JPG');
  assert.strictEqual(validUpload.receipt_filename, 'toll_receipt.jpg');

  // 9B: Valid PDF upload
  const dummyPdf = Buffer.from('%PDF-1.4 fake pdf test safdrive');
  const validPdfUpload = await uploadExpenseReceipt({
    buffer: dummyPdf,
    originalname: 'hotel_invoice.pdf',
    mimetype: 'application/pdf',
    checklist_id: checklistId,
  });
  assert.ok(validPdfUpload.receipt_url, 'Must return receipt_url for valid PDF');

  // 9C: Invalid format rejection
  let invalidMimeRejected = false;
  try {
    await uploadExpenseReceipt({
      buffer: Buffer.from('executable binary code'),
      originalname: 'virus.exe',
      mimetype: 'application/octet-stream',
      checklist_id: checklistId,
    });
  } catch (err) {
    if (err.message.includes('Invalid file format') || err.statusCode === 400) {
      invalidMimeRejected = true;
    }
  }
  assert.strictEqual(invalidMimeRejected, true, 'Violation of Test 9: Invalid MIME must be rejected.');

  // 9D: File size > 10MB rejection
  let oversizedRejected = false;
  try {
    const hugeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
    await uploadExpenseReceipt({
      buffer: hugeBuffer,
      originalname: 'huge_file.pdf',
      mimetype: 'application/pdf',
      checklist_id: checklistId,
    });
  } catch (err) {
    if (err.message.includes('exceeds the 10MB') || err.statusCode === 400) {
      oversizedRejected = true;
    }
  }
  assert.strictEqual(oversizedRejected, true, 'Violation of Test 9: Files > 10MB must be rejected.');
  console.log('   [PASS] Test 9: Receipt formats and size limits strictly enforced.\n');

  console.log('========================================================================');
  console.log('ALL 9 ACCEPTANCE CRITERIA PASSED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

runTechnicianJobExpensesAcceptanceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nACCEPTANCE TEST SUITE FAILED:', err);
    process.exit(1);
  });
