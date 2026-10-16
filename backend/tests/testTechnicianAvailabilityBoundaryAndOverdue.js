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
  getAvailabilityCalendar,
  calculateBookingEndDate,
  calculateEarliestAvailabilityDate,
  cleanupTestBookingsForYear,
} from '../src/services/engineerBookingService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  cleanupTestExtensionsForYear,
} from '../src/services/scheduleExtensionService.js';
import {
  submitInstallationCompletionReport,
} from '../src/services/workflowService.js';

async function runTests() {
  console.log('========================================================================');
  console.log('  TEST: TECHNICIAN AVAILABILITY DATE CALCULATION & OVERDUE RULES       ');
  console.log('  Verifying Inclusive End Date, Extension Workflow, and Overdue State   ');
  console.log('========================================================================\n');

  const testUserSales = { id: '00000000-0000-0000-0000-000000000001', email: 'sales@gmail.com', role: 'SALES' };
  const testUserCoordinator = { id: '00000000-0000-0000-0000-000000000004', email: 'coordinator@gmail.com', role: 'COORDINATOR' };
  const testUserTech = { id: '00000000-0000-0000-0000-000000000002', email: 'tech@gmail.com', role: 'TECHNICAL' };

  const testYear = '2031';
  cleanupTestBookingsForYear(testYear);
  cleanupTestExtensionsForYear(testYear);

  let passed = 0;

  // --------------------------------------------------------------------------
  // TEST 1: Inclusive Scheduled End Date & Next-Day Availability
  // Job: Start 16 Oct, End 18 Oct -> Working 16, 17, 18 Oct -> Available 19 Oct
  // --------------------------------------------------------------------------
  console.log('-> TEST 1: Inclusive Scheduled End Date & Next-Day Earliest Availability...');
  const ch1Start = `${testYear}-10-16`;
  const ch1Duration = '3 Days'; // End date = 2031-10-18
  const ch1ExpectedEnd = calculateBookingEndDate(ch1Start, ch1Duration);
  assert.strictEqual(ch1ExpectedEnd, `${testYear}-10-18`, 'Calculated end date must be 2031-10-18');

  const earliestAvail = calculateEarliestAvailabilityDate(ch1ExpectedEnd);
  assert.strictEqual(earliestAvail, `${testYear}-10-19`, 'Earliest availability date must strictly be the next calendar day: 2031-10-19');

  const ch1 = await createChecklist(testUserSales.id, {
    client_name: `Avail Test 1 ${Date.now()}`,
    client_mobile: '9840112345',
    client_location: 'Chennai Plant',
    salesperson_name: 'Sales Rep 1',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Mathi',
    expected_arrival_date: ch1Start,
    expected_arrival_time: '09:00',
    installation_duration: ch1Duration,
    installation_status: 'Assigned',
  });

  const ch1Data = await getChecklistById(ch1.id);
  const scheduledEnd = ch1Data.current_booking_end_date || ch1Data.booking_end_date;
  assert.strictEqual(scheduledEnd, `${testYear}-10-18`, 'Checklist booking end date must be 2031-10-18');

  // Verify availability on 16, 17, and 18 October is BLOCKED (Conflict)
  const mathiAvail16 = await checkEngineerAvailability({ engineerIdOrName: 'Mathi', startDate: `${testYear}-10-16`, duration: '1 Day' });
  assert.strictEqual(mathiAvail16.available, false, 'Technician must remain unavailable on 16 October');

  const mathiAvail17 = await checkEngineerAvailability({ engineerIdOrName: 'Mathi', startDate: `${testYear}-10-17`, duration: '1 Day' });
  assert.strictEqual(mathiAvail17.available, false, 'Technician must remain unavailable on 17 October');

  const mathiAvail18 = await checkEngineerAvailability({ engineerIdOrName: 'Mathi', startDate: `${testYear}-10-18`, duration: '1 Day' });
  assert.strictEqual(mathiAvail18.available, false, 'Technician must remain unavailable on 18 October (final working day)');

  // Verify technician is AVAILABLE starting 19 October
  const mathiAvail19 = await checkEngineerAvailability({ engineerIdOrName: 'Mathi', startDate: `${testYear}-10-19`, duration: '1 Day' });
  assert.strictEqual(mathiAvail19.available, true, 'Technician must be eligible to show Available starting 19 October');
  assert.strictEqual(mathiAvail19.conflict, null, 'No conflict on 19 October');

  // Verify Calendar View shows Assigned on 16, 17, 18 Oct and Available on 19 Oct
  const cal1 = await getAvailabilityCalendar({
    startDate: `${testYear}-10-16`,
    endDate: `${testYear}-10-20`,
    engineerId: 'Mathi',
  });
  const mathiSched = cal1.schedule.find((s) => s.engineer.name.toLowerCase().includes('mathi'));
  assert.ok(mathiSched, 'Mathi schedule found in calendar');

  const day16 = mathiSched.days.find((d) => d.date === `${testYear}-10-16`);
  const day17 = mathiSched.days.find((d) => d.date === `${testYear}-10-17`);
  const day18 = mathiSched.days.find((d) => d.date === `${testYear}-10-18`);
  const day19 = mathiSched.days.find((d) => d.date === `${testYear}-10-19`);

  assert.strictEqual(day16.status, 'ASSIGNED', 'Day 16 must show Assigned');
  assert.strictEqual(day16.is_available, false, 'Day 16 must not be available');
  assert.strictEqual(day17.status, 'ASSIGNED', 'Day 17 must show Assigned');
  assert.strictEqual(day17.is_available, false, 'Day 17 must not be available');
  assert.strictEqual(day18.status, 'ASSIGNED', 'Day 18 must show Assigned (final working day)');
  assert.strictEqual(day18.is_available, false, 'Day 18 must not be available');

  assert.strictEqual(day19.status, 'AVAILABLE', 'Day 19 must show Available');
  assert.strictEqual(day19.is_available, true, 'Day 19 must be available');
  console.log('   ✓ Verified: Mathi remains Assigned on 16, 17, 18 Oct, and Available starting 19 Oct.');
  passed++;

  // --------------------------------------------------------------------------
  // TEST 2: Extension Approved Through 19 October -> Earliest Availability is 20 October
  // --------------------------------------------------------------------------
  console.log('\n-> TEST 2: Extension Approved Through 19 October -> Availability Date becomes 20 October...');
  const extReq1 = await requestScheduleExtension({
    checklistId: ch1.id,
    user: testUserTech,
    additionalWorkingDays: 1,
    requestedCompletionDate: `${testYear}-10-19`,
    reason: 'Bracket welding delay on customer vehicles',
    notes: 'Need 1 extra day to complete site work.',
  });
  assert.strictEqual(extReq1.status, 'PENDING');
  assert.strictEqual(extReq1.requested_completion_date, `${testYear}-10-19`);

  // Protected period prevents booking Mathi on 19 October while pending
  const availPending19 = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-10-19`,
    duration: '1 Day',
  });
  assert.strictEqual(availPending19.available, false, 'Pending extension protected period must block booking on 19 Oct');

  // Approve extension
  const approved = await approveScheduleExtension({
    extensionId: extReq1.id,
    user: testUserCoordinator,
    decisionNotes: 'Approved site delay extension through 19 Oct',
  });
  assert.strictEqual(approved.success, true);
  assert.strictEqual(approved.extension.status, 'APPROVED');

  const ch1AfterExt = await getChecklistById(ch1.id);
  assert.strictEqual(ch1AfterExt.current_booking_end_date, `${testYear}-10-19`, 'Current booking end date must be updated to 2031-10-19');
  assert.strictEqual(ch1AfterExt.original_booking_end_date, `${testYear}-10-18`, 'Original end date must remain permanently 2031-10-18');

  // Mathi must now be UNAVAILABLE on 19 October
  const mathiAvail19AfterApprove = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-10-19`,
    duration: '1 Day',
  });
  assert.strictEqual(mathiAvail19AfterApprove.available, false, 'Mathi must be unavailable on 19 October after approval');

  // Mathi must now be AVAILABLE starting 20 October
  const mathiAvail20 = await checkEngineerAvailability({
    engineerIdOrName: 'Mathi',
    startDate: `${testYear}-10-20`,
    duration: '1 Day',
  });
  assert.strictEqual(mathiAvail20.available, true, 'Mathi must become available starting 20 October');

  // Verify Calendar View shows Assigned on 16, 17, 18, 19 Oct, and Available on 20 Oct
  const calAfterApprove = await getAvailabilityCalendar({
    startDate: `${testYear}-10-18`,
    endDate: `${testYear}-10-21`,
    engineerId: 'Mathi',
  });
  const mathiSchedApprove = calAfterApprove.schedule.find((s) => s.engineer.name.toLowerCase().includes('mathi'));
  const calDay19 = mathiSchedApprove.days.find((d) => d.date === `${testYear}-10-19`);
  const calDay20 = mathiSchedApprove.days.find((d) => d.date === `${testYear}-10-20`);

  assert.strictEqual(calDay19.status, 'ASSIGNED', 'Day 19 must show Assigned on installation');
  assert.strictEqual(calDay19.is_available, false, 'Day 19 must not be available');
  assert.strictEqual(calDay20.status, 'AVAILABLE', 'Day 20 must show Available');
  assert.strictEqual(calDay20.is_available, true, 'Day 20 must be available');

  console.log('   ✓ Verified: When extension through 19 Oct is approved, earliest availability becomes 20 Oct.');
  passed++;

  // --------------------------------------------------------------------------
  // TEST 3: Extension Rejection Preserves Original Schedule and Clears Warnings
  // --------------------------------------------------------------------------
  console.log('\n-> TEST 3: Extension Rejection Preserves Original Schedule...');
  const ch2 = await createChecklist(testUserSales.id, {
    client_name: `Avail Test 2 Reject ${Date.now()}`,
    client_mobile: '9840112346',
    client_location: 'Madurai',
    salesperson_name: 'Sales Rep 1',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Guna',
    expected_arrival_date: `${testYear}-11-01`,
    expected_arrival_time: '09:00',
    installation_duration: '2 Days', // Scheduled end: 2031-11-02
    installation_status: 'Assigned',
  });

  const extReq2 = await requestScheduleExtension({
    checklistId: ch2.id,
    user: testUserTech,
    additionalWorkingDays: 2,
    requestedCompletionDate: `${testYear}-11-04`,
    reason: 'Customer requested delayed wrap-up',
  });

  const rejRes = await rejectScheduleExtension({
    extensionId: extReq2.id,
    user: testUserCoordinator,
    decisionNotes: 'Rejected: Next client installation cannot be postponed',
  });
  assert.strictEqual(rejRes.extension.status, 'REJECTED');

  const ch2AfterRej = await getChecklistById(ch2.id);
  const endAfterRej = ch2AfterRej.current_booking_end_date || ch2AfterRej.booking_end_date;
  assert.strictEqual(endAfterRej, `${testYear}-11-02`, 'Scheduled end date must remain permanently 2031-11-02');

  // Complete job 2 on 2031-11-02
  await submitInstallationCompletionReport({
    checklist_id: ch2.id,
    user: testUserTech,
    actual_completion_datetime: `${testYear}-11-02T18:00:00Z`,
    items: [{ device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0 }],
    material_items: [],
    completion_status: 'Completed',
  });

  // On 2031-11-02, Guna was working on the job (not available for new assignment)
  const gunaAvail02 = await checkEngineerAvailability({ engineerIdOrName: 'Guna', startDate: `${testYear}-11-02`, duration: '1 Day' });
  assert.strictEqual(gunaAvail02.available, false, 'Guna was on job on 2031-11-02 and must not be double booked');

  // On 2031-11-03, Guna is AVAILABLE
  const gunaAvail03 = await checkEngineerAvailability({ engineerIdOrName: 'Guna', startDate: `${testYear}-11-03`, duration: '1 Day' });
  assert.strictEqual(gunaAvail03.available, true, 'Guna must be available on 2031-11-03 after completed job');
  console.log('   ✓ Verified: Rejection preserved original schedule, and completion released technician starting next calendar day.');
  passed++;

  // --------------------------------------------------------------------------
  // TEST 4: Incomplete / Overdue Job Keeps Technician Unavailable
  // --------------------------------------------------------------------------
  console.log('\n-> TEST 4: Incomplete / Overdue Job Keeps Technician Unavailable...');
  // Create a job whose scheduled end date was in the past (e.g. 2026-10-10 to 2026-10-12)
  // But is still active (installation_status: 'In Progress')
  const ch3 = await createChecklist(testUserSales.id, {
    client_name: `Avail Test 3 Overdue ${Date.now()}`,
    client_mobile: '9840112347',
    client_location: 'Salem Hub',
    salesperson_name: 'Sales Rep 1',
    device_type: '4 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    service_engineer: 'Sakthivel',
    expected_arrival_date: '2026-10-10',
    expected_arrival_time: '09:00',
    installation_duration: '3 Days', // Scheduled end: 2026-10-12
    installation_status: 'In Progress',
  });

  // Today is after 2026-10-12 (today is 2026-10-16 in metadata)
  // The job remains incomplete after 2026-10-12
  const sakthiAvail = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: '2026-10-16',
    duration: '1 Day',
  });

  assert.strictEqual(sakthiAvail.available, false, 'Technician with overdue incomplete installation must remain UNAVAILABLE');
  assert.ok(sakthiAvail.conflict, 'Conflict object must be returned');
  assert.strictEqual(sakthiAvail.conflict.status, 'OVERDUE', 'Conflict status must be OVERDUE');
  console.log('   ✓ Verified: Overdue job keeps technician unavailable with OVERDUE status.');

  // Verify calendar marks days after scheduled end as OVERDUE
  const calOverdue = await getAvailabilityCalendar({
    startDate: '2026-10-10',
    endDate: '2026-10-16',
    engineerId: 'Sakthivel',
  });
  const sakthiSched = calOverdue.schedule.find((s) => s.engineer.name.toLowerCase().includes('sakthivel'));
  assert.ok(sakthiSched, 'Sakthivel schedule found');

  const dayOct11 = sakthiSched.days.find((d) => d.date === '2026-10-11');
  const dayOct12 = sakthiSched.days.find((d) => d.date === '2026-10-12');
  const dayOct13 = sakthiSched.days.find((d) => d.date === '2026-10-13');
  const dayOct16 = sakthiSched.days.find((d) => d.date === '2026-10-16');

  assert.strictEqual(dayOct11.status, 'IN_PROGRESS', 'Day 11 must show On Installation/Service');
  assert.strictEqual(dayOct12.status, 'IN_PROGRESS', 'Day 12 must show On Installation/Service (final working day)');
  assert.strictEqual(dayOct13.status, 'OVERDUE', 'Day 13 must show Overdue (Incomplete)');
  assert.strictEqual(dayOct16.status, 'OVERDUE', 'Day 16 must show Overdue (Incomplete)');
  console.log('   ✓ Verified: Calendar marks days after scheduled end as OVERDUE (Incomplete).');
  passed++;

  // --------------------------------------------------------------------------
  // TEST 5: Completing Overdue Job Releases Technician Starting Next Day
  // --------------------------------------------------------------------------
  console.log('\n-> TEST 5: Completing Overdue Job Releases Technician Next Day...');
  await submitInstallationCompletionReport({
    checklist_id: ch3.id,
    user: testUserTech,
    actual_completion_datetime: '2026-10-16T18:00:00Z',
    items: [{ device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0 }],
    material_items: [],
    completion_status: 'Completed',
  });

  // On 2026-10-16, completed job does not allow double-booking on same day
  const sakthiAvail16 = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: '2026-10-16',
    duration: '1 Day',
  });
  assert.strictEqual(sakthiAvail16.available, false, 'Technician worked on 2026-10-16 and cannot be double booked');

  // On 2026-10-17, technician is RELEASED and AVAILABLE
  const sakthiAvail17 = await checkEngineerAvailability({
    engineerIdOrName: 'Sakthivel',
    startDate: '2026-10-17',
    duration: '1 Day',
  });
  assert.strictEqual(sakthiAvail17.available, true, 'Technician must be available starting 2026-10-17');
  console.log('   ✓ Verified: Completing the overdue job releases the technician starting next calendar day.');
  passed++;

  // Cleanup
  cleanupTestBookingsForYear(testYear);
  cleanupTestExtensionsForYear(testYear);

  console.log('\n========================================================================');
  console.log(`  ALL ${passed}/${passed} AVAILABILITY & BOUNDARY TESTS PASSED SUCCESSFULLY!`);
  console.log('========================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
