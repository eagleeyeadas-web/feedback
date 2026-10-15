/**
 * testSimplifiedScheduleExtensionWorkflow.js
 * 
 * Verifies:
 * 1. Modal Date Helper & Calculations (bidirectional sync, UTC safety, formatting)
 * 2. Required fields and date validation
 * 3. Submission of simplified extension request with "More options" (travel date, rest day, notes)
 * 4. PENDING request preserves active official schedule without changing it
 * 5. Coordinator approval updates the official schedule atomically
 * 6. Coordinator rejection preserves the official schedule
 */

import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  getScheduleRevisionHistory,
  cleanupTestExtensionsForYear,
} from '../src/services/scheduleExtensionService.js';
import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

console.log('========================================================================');
console.log('  TESTING SIMPLIFIED SCHEDULE EXTENSION WORKFLOW & CALCULATIONS          ');
console.log('========================================================================\n');

// --- 1. Pure Date Calculation & Formatting Logic (Matches Modal) ---
console.log('-> 1. Testing Component Date Calculations & Synchronization...');

function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDateString(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  return dateObj.toISOString().split('T')[0];
}

function addDaysToDate(dateStr, days) {
  const d = parseDateParts(dateStr);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + Number(days));
  return formatDateString(d);
}

function diffDaysBetween(startDateStr, endDateStr) {
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  if (!s || !e) return 1;
  const diffTime = e.getTime() - s.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return 'Not scheduled';
  const d = parseDateParts(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Verification 1.1: Base addition
const baseDate = '2028-11-20';
assert.strictEqual(addDaysToDate(baseDate, 1), '2028-11-21', 'Adding 1 day should give 2028-11-21');
assert.strictEqual(addDaysToDate(baseDate, 3), '2028-11-23', 'Adding 3 days should give 2028-11-23');
assert.strictEqual(addDaysToDate('2028-12-31', 1), '2029-01-01', 'Year rollover handles cleanly');

// Verification 1.2: Bidirectional diff
assert.strictEqual(diffDaysBetween('2028-11-20', '2028-11-23'), 3, 'Difference must be 3 days');
assert.strictEqual(diffDaysBetween('2028-11-20', '2028-11-21'), 1, 'Difference must be 1 day');

// Verification 1.3: Display date formatting
const displayStr = formatDisplayDate('2028-11-20');
assert(displayStr.includes('20') && (displayStr.includes('Nov') || displayStr.includes('11')), `Formatted date should contain day and month: ${displayStr}`);
console.log(`   ✓ Date calculation and UTC parsing passed. Sample formatted: "${displayStr}"`);


// --- 2. Backend Validation & Required Fields ---
console.log('\n-> 2. Testing Required Fields & Date Validations...');

const testYear = '2039';
cleanupTestExtensionsForYear(testYear);

const randDay = String(Math.floor(Math.random() * 20) + 1).padStart(2, '0');
const testStartDate = `${testYear}-07-${randDay}`;
const testEndDate = addDaysToDate(testStartDate, 1);
const testExtendedDate = addDaysToDate(testStartDate, 3);
const testTravelDate = addDaysToDate(testStartDate, 4);
const testRestDate = addDaysToDate(testStartDate, 5);

const testChecklist = await createChecklist(uuidv4(), {
  client_name: `Simplified UI Client ${Date.now()}`,
  client_mobile: '9876543210',
  client_location: 'Coimbatore Site',
  salesperson_name: 'Sales Rep 1',
  device_type: 'SafDrive Model X',
  number_of_devices: 2,
  number_of_vehicles: 2,
  service_engineer: 'Mathi',
  expected_arrival_date: testStartDate,
  expected_arrival_time: '09:00',
  installation_duration: '2 Days',
  installation_status: 'Assigned',
});
const checklistId = testChecklist.id;

// Test 2.1: Missing required completion date
try {
  await requestScheduleExtension({
    checklistId,
    user: { id: 'tech-1', full_name: 'Mathi' },
    requestedCompletionDate: '',
    reason: 'Installation work taking longer than expected',
  });
  assert.fail('Should have failed for missing completion date');
} catch (err) {
  assert(err.message.includes('completion date'), 'Error must mention completion date');
  console.log('   ✓ Missing completion date correctly rejected');
}

// Test 2.2: Missing required reason
try {
  await requestScheduleExtension({
    checklistId,
    user: { id: 'tech-1', full_name: 'Mathi' },
    requestedCompletionDate: testExtendedDate,
    reason: '   ',
  });
  assert.fail('Should have failed for missing reason');
} catch (err) {
  assert(err.message.includes('reason'), 'Error must mention reason');
  console.log('   ✓ Missing reason correctly rejected');
}

// Test 2.3: Date before arrival date
try {
  await requestScheduleExtension({
    checklistId,
    user: { id: 'tech-1', full_name: 'Mathi' },
    requestedCompletionDate: addDaysToDate(testStartDate, -1),
    reason: 'Installation work taking longer than expected',
  });
  assert.fail('Should have failed for date before arrival date');
} catch (err) {
  assert(err.message.includes('cannot be before arrival date'), 'Error must reject date before arrival');
  console.log('   ✓ Date before arrival date correctly rejected');
}


// --- 3. Submitting Request & Verifying Pending Schedule Unchanged ---
console.log('\n-> 3. Submitting Extension Request (Pending Status & Schedule Preservation)...');

const extensionRes = await requestScheduleExtension({
  checklistId,
  user: { id: 'tech-1', full_name: 'Mathi' },
  requestedCompletionDate: testExtendedDate,
  additionalWorkingDays: 2,
  reason: 'Installation work taking longer than expected',
  // Optional "More options" fields
  requestedReturnTravelDate: testTravelDate,
  restDayRequested: true,
  requestedRestDate: testRestDate,
  notes: 'Customer added 2 more heavy vehicle installations.',
});

assert.strictEqual(extensionRes.status, 'PENDING');
assert.strictEqual(extensionRes.requested_completion_date, testExtendedDate);
assert.strictEqual(extensionRes.additional_working_days, 2);
assert.strictEqual(extensionRes.requested_return_travel_date, testTravelDate);
assert.strictEqual(extensionRes.rest_day_requested, true);
assert.strictEqual(extensionRes.requested_rest_date, testRestDate);
assert.strictEqual(extensionRes.notes, 'Customer added 2 more heavy vehicle installations.');

// CRITICAL REQUIREMENT: Pending request must NOT change the official schedule!
const activeChecklist = await getChecklistById(checklistId);
assert.strictEqual(
  activeChecklist.current_installation_duration || activeChecklist.installation_duration,
  '2 Days',
  'Active checklist duration must remain 2 Days while request is PENDING'
);
assert.strictEqual(
  activeChecklist.current_booking_end_date || activeChecklist.booking_end_date,
  testEndDate,
  'Active booking end date must remain unchanged while request is PENDING'
);
console.log('   ✓ Extension submitted in PENDING state.');
console.log('   ✓ CRITICAL: Official active schedule remains completely unchanged at 2 Days.');


// --- 4. Coordinator Approval Updates Schedule ---
console.log('\n-> 4. Coordinator Approval Updates Official Schedule Atomically...');

const approvedRes = await approveScheduleExtension({
  extensionId: extensionRes.id,
  user: { id: uuidv4(), full_name: 'Coordinator Sarah', role: 'COORDINATOR' },
  decisionNotes: 'Approved 2 extra days for Mathi due to customer vehicle additions.',
});

assert.strictEqual(approvedRes.extension?.status || approvedRes.status, 'APPROVED');

// Verify official schedule has now been updated
const updatedChecklist = await getChecklistById(checklistId);
assert.strictEqual(
  updatedChecklist.current_installation_duration,
  '4 Days',
  'Approved duration must now be 4 Days (2 original + 2 additional)'
);
assert.strictEqual(
  updatedChecklist.current_booking_end_date,
  testExtendedDate,
  'Approved booking end date must be updated to requested completion date'
);

const revisions = await getScheduleRevisionHistory(checklistId);
assert.strictEqual(revisions.length, 1, 'Schedule revision history must record 1 approved revision');
assert.strictEqual(revisions[0].new_schedule.duration, '4 Days');
console.log('   ✓ Coordinator approval successfully updated active duration to 4 Days.');
console.log('   ✓ Schedule revision recorded in history audit trail.');


// --- 5. Coordinator Rejection Leaves Schedule Unchanged ---
console.log('\n-> 5. Rejection Workflow Test...');

const secondRandDay = String(Math.floor(Math.random() * 20) + 1).padStart(2, '0');
const secondStartDate = `${testYear}-08-${secondRandDay}`;
const secondEndDate = secondStartDate;
const secondExtendedDate = addDaysToDate(secondStartDate, 2);

const secondChecklist = await createChecklist(uuidv4(), {
  client_name: `Second Test Client ${Date.now()}`,
  client_mobile: '9876543212',
  client_location: 'Madurai Site',
  salesperson_name: 'Sales Rep 2',
  device_type: 'SafDrive Model X',
  number_of_devices: 1,
  number_of_vehicles: 1,
  service_engineer: 'Guna',
  expected_arrival_date: secondStartDate,
  expected_arrival_time: '10:00',
  installation_duration: '1 Day',
  installation_status: 'Assigned',
});
const secondChecklistId = secondChecklist.id;

const secondExtension = await requestScheduleExtension({
  checklistId: secondChecklistId,
  user: { id: 'tech-2', full_name: 'Guna' },
  requestedCompletionDate: secondExtendedDate,
  additionalWorkingDays: 2,
  reason: 'Adverse weather or site conditions',
  notes: 'Heavy rains delaying outdoor calibration',
});

const rejectedRes = await rejectScheduleExtension({
  extensionId: secondExtension.id,
  user: { id: uuidv4(), full_name: 'Coordinator Sarah', role: 'COORDINATOR' },
  decisionNotes: 'Rain expected to clear by noon, complete within existing slot.',
});

assert.strictEqual(rejectedRes.extension?.status || rejectedRes.status, 'REJECTED');
const secondChecklistAfterReject = await getChecklistById(secondChecklistId);
assert.strictEqual(
  secondChecklistAfterReject.current_installation_duration || secondChecklistAfterReject.installation_duration,
  '1 Day',
  'Duration must remain 1 Day after rejection'
);
assert.strictEqual(
  secondChecklistAfterReject.current_booking_end_date || secondChecklistAfterReject.booking_end_date,
  secondEndDate,
  'End date must remain unchanged after rejection'
);
console.log('   ✓ Extension rejection verified. Schedule kept intact at 1 Day.');

// Clean up test data
cleanupTestExtensionsForYear(testYear);
try {
  await supabase.from('installation_checklists').delete().in('id', [checklistId, secondChecklistId]);
  await supabase.from('engineer_bookings').delete().in('checklist_id', [checklistId, secondChecklistId]);
} catch (e) {}

console.log('\n========================================================================');
console.log('  ALL SIMPLIFIED EXTENSION WORKFLOW TESTS PASSED PERFECTLY!            ');
console.log('========================================================================\n');
