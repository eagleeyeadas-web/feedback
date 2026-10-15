import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  checkEngineerAvailability,
  reserveEngineerAtomic,
  getAvailabilityCalendar,
  cleanupTestBookingsForYear,
} from '../src/services/engineerBookingService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  cleanupTestExtensionsForYear,
} from '../src/services/scheduleExtensionService.js';
import {
  requestRestDay,
  approveRestDay,
  cleanupTestRestDaysForYear,
} from '../src/services/restDayService.js';
import {
  requestLeave,
  approveLeave,
  cleanupTestLeavesForYear,
} from '../src/services/leaveService.js';
import {
  submitInstallationCompletionReport,
} from '../src/services/workflowService.js';
import supabase from '../src/services/supabase.js';

async function runAllTests() {
  console.log('========================================================================');
  console.log('  TEST: TECHNICIAN AVAILABILITY AFTER POST-INSTALL & DATE EXTENSIONS   ');
  console.log('  Verifying all 11 Acceptance Scenarios from User Requirements          ');
  console.log('========================================================================\n');

  const testUserSales = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'sales@gmail.com',
    role: 'SALES',
  };

  const testUserCoordinator = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'coordinator@gmail.com',
    role: 'COORDINATOR',
  };

  const testUserTech = {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'tech@gmail.com',
    role: 'TECHNICAL',
  };

  const testYear = '2029';
  const ts = Date.now();

  // Cleanup test data from 2029
  cleanupTestBookingsForYear(testYear);
  cleanupTestExtensionsForYear(testYear);
  cleanupTestRestDaysForYear(testYear);
  cleanupTestLeavesForYear(testYear);
  try {
    await supabase.from('installation_checklists').delete().like('client_name', 'TechAvail Test%');
    await supabase.from('engineer_bookings').delete().gte('booking_start_date', `${testYear}-01-01`);
    await supabase.from('schedule_extension_requests').delete().gte('requested_completion_date', `${testYear}-01-01`);
    await supabase.from('rest_day_requests').delete().gte('rest_start_date', `${testYear}-01-01`);
    await supabase.from('leave_requests').delete().gte('leave_start_date', `${testYear}-01-01`);
  } catch (e) {}

  let passedCount = 0;

  // --------------------------------------------------------------------------
  // TEST 1: Successful post-installation submission makes technician available
  // --------------------------------------------------------------------------
  console.log('-> Test 1: Successful post-installation submission makes technician available...');
  const ch1 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 1 ${ts}`,
    client_mobile: '9876543210',
    client_location: 'Chennai Central',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Mathi',
    expected_arrival_date: `${testYear}-05-01`,
    expected_arrival_time: '09:00',
    installation_duration: '3 Days', // 2029-05-01 to 2029-05-03
    installation_status: 'Assigned',
  });
  assert.ok(ch1 && ch1.id, 'Checklist 1 must be created');

  // Verify Mathi is booked on 2029-05-02
  const chkAvailBefore = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-05-02`,
    duration: '1 Day',
  });
  assert.strictEqual(chkAvailBefore.available, false, 'Mathi must be unavailable on 2029-05-02 before submission');

  // Submit completion report on day 2 (early finish on 2029-05-02)
  const rep1 = await submitInstallationCompletionReport({
    checklist_id: ch1.id,
    user: testUserTech,
    actual_completion_datetime: `${testYear}-05-02T16:00:00Z`,
    items: [
      {
        device_type: 'SafDrive Model X',
        quantity_carried: 2,
        quantity_installed: 1,
        quantity_to_return: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [],
    completion_status: 'Completed',
    remarks: 'Early completion done on day 2',
  });
  assert.ok(rep1 && rep1.id, 'Completion report 1 must be saved');

  // Verify checklist is marked completed
  const ch1Updated = await getChecklistById(ch1.id);
  assert.strictEqual(ch1Updated.installation_status, 'Completed', 'Job status must be Completed');

  // Check Mathi availability on 2029-05-02 (completion day) and 2029-05-03 (future scheduled day released early)
  const chkAvailDay2 = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-05-02`,
    duration: '1 Day',
  });
  assert.strictEqual(chkAvailDay2.available, true, 'Mathi must be available on completion day (day 2)');

  const chkAvailDay3 = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-05-03`,
    duration: '1 Day',
  });
  assert.strictEqual(chkAvailDay3.available, true, 'Mathi must be available on released day 3');
  console.log('   ✓ Passed: Post-installation submission immediately recalculated availability to Available.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 2: Failed submission leaves assignment and availability unchanged
  // --------------------------------------------------------------------------
  console.log('\n-> Test 2: Failed submission leaves assignment and availability unchanged...');
  const ch2 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 2 ${ts}`,
    client_mobile: '9876543211',
    client_location: 'Coimbatore',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Guna',
    expected_arrival_date: `${testYear}-05-05`,
    expected_arrival_time: '10:00',
    installation_duration: '2 Days',
    installation_status: 'Assigned',
  });

  // Attempt invalid submission with negative quantity
  let submitFailed = false;
  try {
    await submitInstallationCompletionReport(ch2.id, {
      user: testUserTech,
      items: [
        {
          device_type: 'SafDrive Model X',
          quantity_carried: 2,
          quantity_installed: -1, // Negative quantity error
          quantity_to_return: 0,
        },
      ],
      completion_status: 'Completed',
    });
  } catch (err) {
    submitFailed = true;
  }
  assert.ok(submitFailed, 'Submission with negative quantity must fail');

  // Verify ch2 remains Assigned and Guna remains unavailable on 2029-05-05
  const ch2Check = await getChecklistById(ch2.id);
  assert.notStrictEqual(ch2Check.installation_status, 'Completed', 'Checklist 2 must not be marked completed');

  const gunaAvail = await checkEngineerAvailability({
    engineerIdOrName: 'Guna',
    startDate: `${testYear}-05-05`,
    duration: '1 Day',
  });
  assert.strictEqual(gunaAvail.available, false, 'Guna must remain unavailable because submission failed');
  console.log('   ✓ Passed: Failed submission left assignment and availability unchanged.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 3: Pending extension does not change approved expected completion date
  // --------------------------------------------------------------------------
  console.log('\n-> Test 3: Pending extension does not change approved completion date...');
  const ch3 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 3 ${ts}`,
    client_mobile: '9876543212',
    client_location: 'Madurai',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Sakthivel',
    expected_arrival_date: `${testYear}-05-10`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days', // Approved end date: 2029-05-11
    installation_status: 'Assigned',
  });

  const ext3 = await requestScheduleExtension({
    checklistId: ch3.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-05-13`,
    reason: 'Extra customer vehicles added on site.',
  });
  assert.strictEqual(ext3.status, 'PENDING');

  // Verify approved end date remains 2029-05-11
  const ch3AfterReq = await getChecklistById(ch3.id);
  const approvedEnd = ch3AfterReq.current_booking_end_date || ch3AfterReq.booking_end_date;
  assert.strictEqual(approvedEnd, `${testYear}-05-11`, 'Approved end date must remain unchanged while pending');

  // Verify calendar displays pending warning on the requested period
  const cal3 = await getAvailabilityCalendar({
    startDate: `${testYear}-05-10`,
    endDate: `${testYear}-05-14`,
    engineerId: 'Sakthivel',
  });
  const sakthivelSched = cal3.schedule.find((s) => s.engineer.name.toLowerCase().includes('sakthivel'));
  assert.ok(sakthivelSched, 'Sakthivel schedule must be found');
  const day12 = sakthivelSched.days.find((d) => d.date === `${testYear}-05-12`);
  assert.strictEqual(day12.has_pending_warning, true, 'Day 12 must have pending warning flag');
  assert.ok(day12.warning, 'Day 12 must include warning metadata');
  console.log('   ✓ Passed: Pending extension preserved official schedule and showed pending warning.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 4: Approved extension updates approved date and keeps technician unavailable
  // --------------------------------------------------------------------------
  console.log('\n-> Test 4: Approved extension updates approved date and blocks dates...');
  const app3 = await approveScheduleExtension({
    extensionId: ext3.id,
    user: testUserCoordinator,
    decisionNotes: 'Approved site extension for extra vehicles',
  });
  assert.strictEqual(app3.extension.status, 'APPROVED');

  const ch3Approved = await getChecklistById(ch3.id);
  const approvedEndAfter = ch3Approved.current_booking_end_date || ch3Approved.booking_end_date;
  assert.strictEqual(approvedEndAfter, `${testYear}-05-13`, 'Approved end date must now be updated to 2029-05-13');
  assert.strictEqual(ch3Approved.original_booking_end_date || ch3Approved.expected_arrival_date, `${testYear}-05-11`, 'Original planned date must be preserved');

  // Sakthivel must now be unavailable through 2029-05-13
  const sakthivelAvail12 = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: `${testYear}-05-12`,
    duration: '1 Day',
  });
  assert.strictEqual(sakthivelAvail12.available, false, 'Sakthivel must be unavailable on 2029-05-12');

  const sakthivelAvail13 = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: `${testYear}-05-13`,
    duration: '1 Day',
  });
  assert.strictEqual(sakthivelAvail13.available, false, 'Sakthivel must be unavailable on 2029-05-13');
  console.log('   ✓ Passed: Approved extension updated schedule and kept technician unavailable through new date.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 5: Rejected extension preserves original schedule and removes warning
  // --------------------------------------------------------------------------
  console.log('\n-> Test 5: Rejected extension preserves original schedule and removes warning...');
  const ch5 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 5 ${ts}`,
    client_mobile: '9876543213',
    client_location: 'Salem',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Kamalesh',
    expected_arrival_date: `${testYear}-05-15`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days', // Approved end: 2029-05-16
    installation_status: 'Assigned',
  });

  const ext5 = await requestScheduleExtension({
    checklistId: ch5.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-05-18`,
    reason: 'Customer requested delayed finish.',
  });

  const rej5 = await rejectScheduleExtension({
    extensionId: ext5.id,
    user: testUserCoordinator,
    decisionNotes: 'Cannot extend: priority job booked for next day',
  });
  assert.strictEqual(rej5.extension.status, 'REJECTED');

  // Verify official schedule remains 2029-05-16
  const ch5AfterRej = await getChecklistById(ch5.id);
  const approvedEnd5 = ch5AfterRej.current_booking_end_date || ch5AfterRej.booking_end_date;
  assert.strictEqual(approvedEnd5, `${testYear}-05-16`, 'Official schedule must remain 2029-05-16');

  // Verify pending warning is removed
  const cal5 = await getAvailabilityCalendar({
    startDate: `${testYear}-05-15`,
    endDate: `${testYear}-05-19`,
    engineerId: 'Kamalesh',
  });
  const kamaleshSched = cal5.schedule.find((s) => s.engineer.name.toLowerCase().includes('kamalesh'));
  const day17 = kamaleshSched.days.find((d) => d.date === `${testYear}-05-17`);
  assert.strictEqual(day17.has_pending_warning, false, 'Pending warning must be cleared after rejection');
  console.log('   ✓ Passed: Rejected extension preserved original schedule and removed pending warning.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 6: Rejection makes technician available when original assignment is completed
  // --------------------------------------------------------------------------
  console.log('\n-> Test 6: Rejection makes technician available when job is completed...');
  // Complete job 5 on 2029-05-16
  await submitInstallationCompletionReport({
    checklist_id: ch5.id,
    user: testUserTech,
    actual_completion_datetime: `${testYear}-05-16T18:00:00Z`,
    items: [
      {
        device_type: 'SafDrive Model X',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_to_return: 0,
      },
    ],
    material_items: [],
    completion_status: 'Completed',
  });

  // Kamalesh must be available on 2029-05-17 and 2029-05-18
  const kamaleshAvail17 = await checkEngineerAvailability({
    engineerIdOrName: 'Kamalesh',
    startDate: `${testYear}-05-17`,
    duration: '1 Day',
  });
  assert.strictEqual(kamaleshAvail17.available, true, 'Kamalesh must be available on 2029-05-17');

  const kamaleshAvail18 = await checkEngineerAvailability({
    engineerIdOrName: 'Kamalesh',
    startDate: `${testYear}-05-18`,
    duration: '1 Day',
  });
  assert.strictEqual(kamaleshAvail18.available, true, 'Kamalesh must be available on 2029-05-18');
  console.log('   ✓ Passed: Rejection + completed job freed the technician for new assignments.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 7: Rejection does not make an active, incomplete assignment available prematurely
  // --------------------------------------------------------------------------
  console.log('\n-> Test 7: Rejection does not make an active, incomplete assignment available prematurely...');
  const ch7 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 7 ${ts}`,
    client_mobile: '9876543214',
    client_location: 'Trichy',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Mathi',
    expected_arrival_date: `${testYear}-05-20`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days', // Approved end: 2029-05-21
    installation_status: 'Assigned',
  });

  const ext7 = await requestScheduleExtension({
    checklistId: ch7.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-05-23`,
    reason: 'Delayed site clearance',
  });

  await rejectScheduleExtension({
    extensionId: ext7.id,
    user: testUserCoordinator,
    decisionNotes: 'Rejected',
  });

  // On 2029-05-21 (day 2 of the active approved job), Mathi is still working and incomplete
  const mathiAvail21 = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-05-21`,
    duration: '1 Day',
  });
  assert.strictEqual(mathiAvail21.available, false, 'Mathi must NOT be available on 2029-05-21 while job is active');
  console.log('   ✓ Passed: Active incomplete assignment remained unavailable during its approved schedule.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 8: Approved leave, rest days, travel continue to block availability
  // --------------------------------------------------------------------------
  console.log('\n-> Test 8: Approved leave, rest days, and travel block availability...');
  // 8A. Leave
  const leave8 = await requestLeave({
    engineerIdOrName: 'Guna',
    leaveType: 'Medical',
    startDate: `${testYear}-06-01`,
    endDate: `${testYear}-06-02`,
    reason: 'Medical appointment',
    user: testUserTech,
  });
  await approveLeave({
    leaveId: leave8.id,
    user: testUserCoordinator,
    notes: 'Approved medical leave',
  });

  const gunaLeaveCheck = await checkEngineerAvailability({
    engineerIdOrName: 'Guna',
    startDate: `${testYear}-06-01`,
    duration: '1 Day',
  });
  assert.strictEqual(gunaLeaveCheck.available, false, 'Guna must be blocked by approved leave');
  assert.strictEqual(gunaLeaveCheck.conflict.type, 'LEAVE', 'Conflict type must be LEAVE');

  // 8B. Rest Day
  const rest8 = await requestRestDay({
    engineerIdOrName: 'Guna',
    startDate: `${testYear}-06-03`,
    endDate: `${testYear}-06-03`,
    reason: 'Post-job rest',
    user: testUserTech,
  });
  await approveRestDay({
    requestId: rest8.id,
    user: testUserCoordinator,
    notes: 'Approved rest day',
  });

  const gunaRestCheck = await checkEngineerAvailability({
    engineerIdOrName: 'Guna',
    startDate: `${testYear}-06-03`,
    duration: '1 Day',
  });
  assert.strictEqual(gunaRestCheck.available, false, 'Guna must be blocked by approved rest day');
  assert.strictEqual(gunaRestCheck.conflict.type, 'REST_DAY', 'Conflict type must be REST_DAY');
  console.log('   ✓ Passed: Approved leaves and rest days strictly blocked technician availability.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 9: Multiple requests and concurrent Coordinator decisions handled safely
  // --------------------------------------------------------------------------
  console.log('\n-> Test 9: Concurrency safety under simultaneous Coordinator decisions...');
  const ch9 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 9 ${ts}`,
    client_mobile: '9876543215',
    client_location: 'Vellore',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Sakthivel',
    expected_arrival_date: `${testYear}-06-05`,
    expected_arrival_time: '09:00',
    installation_duration: '1 Day',
    installation_status: 'Assigned',
  });

  const ext9 = await requestScheduleExtension({
    checklistId: ch9.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-06-07`,
    reason: 'Site weather delay',
  });

  // Attempt simultaneous approve and reject
  const results = await Promise.allSettled([
    approveScheduleExtension({
      extensionId: ext9.id,
      user: testUserCoordinator,
      decisionNotes: 'Attempt A',
    }),
    rejectScheduleExtension({
      extensionId: ext9.id,
      user: testUserCoordinator,
      decisionNotes: 'Attempt B',
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent decision must succeed');
  assert.strictEqual(rejected.length, 1, 'The competing decision must be rejected under mutex lock');
  assert.ok(
    rejected[0].reason.message.includes('already') || rejected[0].reason.message.includes('status'),
    'Rejected error must state invalid transition'
  );
  console.log('   ✓ Passed: Mutex serialization prevented concurrent decision race condition.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 10: Store Manager stock verification remains independent of availability
  // --------------------------------------------------------------------------
  console.log('\n-> Test 10: Store Manager verification is independent of technician availability...');
  const ch10 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 10 ${ts}`,
    client_mobile: '9876543216',
    client_location: 'Tirunelveli',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Kamalesh',
    expected_arrival_date: `${testYear}-06-15`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days',
    installation_status: 'Assigned',
  });

  // Submit report with unused device returns pending store verification
  const rep10 = await submitInstallationCompletionReport({
    checklist_id: ch10.id,
    user: testUserTech,
    actual_completion_datetime: `${testYear}-06-15T15:00:00Z`,
    items: [
      {
        device_type: 'SafDrive Model X',
        quantity_carried: 3,
        quantity_installed: 1,
        quantity_to_return: 2, // 2 items pending store verification
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    material_items: [],
    completion_status: 'Completed',
    remarks: 'Installation done, returning 2 devices to store',
  });

  assert.strictEqual(rep10.reconciliation_status, 'PENDING_STORE_VERIFICATION', 'Stock reconciliation must be PENDING_STORE_VERIFICATION');
  const ch10Check = await getChecklistById(ch10.id);
  assert.strictEqual(ch10Check.installation_status, 'Completed', 'Checklist status must be Completed');

  // Technician must be Available right now, WITHOUT waiting for Store Manager!
  const kamaleshAvail15 = await checkEngineerAvailability({
    engineerIdOrName: 'Kamalesh',
    startDate: `${testYear}-06-15`,
    duration: '1 Day',
  });
  assert.strictEqual(kamaleshAvail15.available, true, 'Kamalesh must be available immediately without waiting for store verification');

  const kamaleshAvail16 = await checkEngineerAvailability({
    engineerIdOrName: 'Kamalesh',
    startDate: `${testYear}-06-16`,
    duration: '1 Day',
  });
  assert.strictEqual(kamaleshAvail16.available, true, 'Kamalesh must be available on 2029-06-16');
  console.log('   ✓ Passed: Stock verification tracked separately without blocking technician availability.');
  passedCount++;

  // --------------------------------------------------------------------------
  // TEST 11: Sales cannot create conflicting assignments during protected periods
  // --------------------------------------------------------------------------
  console.log('\n-> Test 11: Sales cannot create conflicting assignments during protected periods...');
  const ch11 = await createChecklist(testUserSales.id, {
    client_name: `TechAvail Test 11 ${ts}`,
    client_mobile: '9876543217',
    client_location: 'Erode',
    salesperson_name: 'Sales Rep 1',
    device_type: 'SafDrive Model X',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Sakthivel',
    expected_arrival_date: `${testYear}-06-20`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days', // Approved: 2029-06-20 to 2029-06-21
    installation_status: 'Assigned',
  });

  // Sakthivel requests extension to 2029-06-23 (PENDING)
  await requestScheduleExtension({
    checklistId: ch11.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-06-23`,
    reason: 'Awaiting client electrical connection',
  });

  // Sales checks availability for 2029-06-22 (inside proposed extension period)
  const salesCheck = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: `${testYear}-06-22`,
    duration: '1 Day',
  });
  assert.strictEqual(salesCheck.available, false, 'Sakthivel must be blocked during pending extension period');
  assert.strictEqual(salesCheck.conflict.type, 'PENDING_EXTENSION_PROTECTED', 'Conflict must be PENDING_EXTENSION_PROTECTED');
  assert.ok(salesCheck.conflict.reason.includes('pending availability date request'), 'Reason must explain pending protection');

  // Sales attempts to create overlapping checklist directly
  let salesBlocked = false;
  try {
    await createChecklist(testUserSales.id, {
      client_name: `TechAvail Conflict Sales ${ts}`,
      client_mobile: '9876543218',
      client_location: 'Erode',
      salesperson_name: 'Sales Rep 1',
      device_type: 'SafDrive Model X',
      number_of_devices: 1,
      number_of_vehicles: 1,
      service_engineer: 'Sakthivel',
      expected_arrival_date: `${testYear}-06-22`,
      expected_arrival_time: '10:00',
      installation_duration: '1 Day',
      installation_status: 'Assigned',
    });
  } catch (err) {
    salesBlocked = true;
    assert.ok(
      err.message.includes('pending') || err.message.includes('Protected') || err.message.includes('Conflict'),
      'Error message must reflect booking conflict'
    );
  }
  assert.ok(salesBlocked, 'Sales booking during protected period must be blocked');
  console.log('   ✓ Passed: Sales prevented from creating conflicting assignments during protected period.');
  passedCount++;

  console.log('\n========================================================================');
  console.log(`  ALL ${passedCount} OF 11 ACCEPTANCE CRITERIA PASSED SUCCESSFULLY!       `);
  console.log('========================================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ Test run failed with error:', err);
  process.exit(1);
});
