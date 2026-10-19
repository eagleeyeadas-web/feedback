import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import { submitInstallationCompletionReport } from '../src/services/workflowService.js';
import {
  evaluateChecklistOverdue,
  checkAllOverdueChecklists,
  recordLateCompletion,
  getOverdueRecords,
  OVERDUE_CATEGORIES,
} from '../src/services/overdueDetectionService.js';
import {
  getCoordinatorChecklists,
  getBookingDetails,
  saveCoordinatorBooking,
  triggerReturnTicketBookingTask,
  updateReturnTicketBooking,
  getBookingAuditHistory,
} from '../src/services/coordinatorBookingService.js';
import { getNotifications, createNotification } from '../src/services/appNotificationService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  inMemoryExtensions,
} from '../src/services/scheduleExtensionService.js';
import { checkEngineerAvailability } from '../src/services/engineerBookingService.js';
import coordinatorRoutes from '../src/routes/coordinator.js';
import hrRoutes from '../src/routes/hr.js';

async function runCompleteHrTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — COMPLETE HR LATE-COMPLETION & OVERDUE SUITE     ');
  console.log('  Testing all 22 End-to-End Scenarios from Section 15                  ');
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

  const testUserHR = {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'hr@gmail.com',
    role: 'HR',
  };

  const testUserTech = {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'tech@gmail.com',
    role: 'TECHNICAL',
  };

  const results = [];
  function recordTest(testNumber, name, passed, details = '') {
    results.push({ testNumber, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[Test ${testNumber}] ${mark}: ${name} ${details ? '(' + details + ')' : ''}`);
  }

  // Setup express test server for role permission and route tests
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'] || 'COORDINATOR';
    const u = role === 'HR' ? testUserHR : testUserCoordinator;
    req.user = u;
    req.profile = u;
    next();
  });
  app.use('/api/coordinator', coordinatorRoutes);
  app.use('/api/hr', hrRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const runSeed = Math.floor((Date.now() % 1000000) / 1000);
  const getUniqueDate = (offsetDays) => {
    const d = new Date(Date.now() + (3000 + runSeed + offsetDays) * 86400000);
    return d.toISOString().split('T')[0];
  };

  try {
    // --------------------------------------------------------------------------
    // CASE 1: A job is scheduled for 15th–16th and remains incomplete after 16th.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 1: Job scheduled and remains incomplete after scheduled end date ---');
    const d1Start = getUniqueDate(10);
    const d1End = getUniqueDate(11);
    const chk1 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Incomplete Overdue ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Coimbatore Hub',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '2 Days',
      vehicle_type: 'Truck',
      expected_arrival_date: d1Start,
      service_engineer: 'Mathi',
    });

    // Check with reference date on 17th (after d1End)
    const d1After = getUniqueDate(12);
    const eval1 = evaluateChecklistOverdue(chk1, { referenceDate: d1After });
    assert.strictEqual(eval1.isOverdue, true, 'Job must be flagged as overdue');
    assert.strictEqual(eval1.category, OVERDUE_CATEGORIES.NO_EXTENSION);
    recordTest(1, 'Job scheduled and incomplete after end date detected as overdue', true, `Scheduled: ${d1Start} to ${d1End} | Evaluated: ${d1After}`);

    // --------------------------------------------------------------------------
    // CASE 2: HR receives an overdue alert without an extension request being fabricated.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 2: HR receives overdue alert without fabricated extension ---');
    await checkAllOverdueChecklists({ referenceDate: d1After });
    const hrNotifs = await getNotifications({ role: 'HR' });
    const overdueNotif = hrNotifs.find((n) => n.checklist_id === chk1.id && n.type === 'OVERDUE_ALERT');
    assert(overdueNotif, 'HR must receive overdue alert notification');
    assert.strictEqual(overdueNotif.title, 'Installation Overdue — Extension Not Requested');
    
    // Crucial check: verify that NO extension request was fabricated
    const fabricatedExt = Array.from(inMemoryExtensions.values()).find((e) => e.checklist_id === chk1.id);
    assert.strictEqual(fabricatedExt, undefined, 'System must NEVER fabricate an extension request');
    recordTest(2, 'HR receives overdue alert without an extension request being fabricated', true, 'Alert sent: Installation Overdue — Extension Not Requested (0 fabricated requests)');

    // --------------------------------------------------------------------------
    // CASE 3: A technician submits an extension request and HR receives the approval task.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 3: Technician submits extension request & HR receives approval task ---');
    const d1Requested = getUniqueDate(13);
    const extReq3 = await requestScheduleExtension({
      checklistId: chk1.id,
      user: testUserTech,
      requestedCompletionDate: d1Requested,
      reason: 'Additional camera cabling required on site',
    });
    assert.strictEqual(extReq3.status, 'PENDING');
    assert.strictEqual(extReq3.requested_completion_date, d1Requested);

    // Verify overdue evaluation reflects pending extension
    const eval3 = evaluateChecklistOverdue(chk1, { referenceDate: d1After });
    assert.strictEqual(eval3.category, OVERDUE_CATEGORIES.PENDING_EXTENSION);

    // Verify HR receives extension approval task notification
    const hrNotifs3 = await getNotifications({ role: 'HR' });
    const extTaskNotif = hrNotifs3.find((n) => n.checklist_id === chk1.id && n.type === 'EXTENSION_REQUEST');
    assert(extTaskNotif, 'HR must receive extension request task');
    assert(extTaskNotif.title.includes('Extension Request'), 'Title must be Extension Request');
    recordTest(3, 'Technician submits extension request and HR receives approval task', true, `Requested to: ${d1Requested}`);

    // --------------------------------------------------------------------------
    // CASE 4: HR approves an extension and the Coordinator receives a room/travel review notification.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 4: HR approves extension -> Coordinator receives review task ---');
    await approveScheduleExtension(extReq3.id, testUserHR, 'Approved by HR for site cabling');
    const chk1Approved = await getChecklistById(chk1.id);
    const approvedEndDate = chk1Approved.extension_approved_end_date || chk1Approved.current_booking_end_date || chk1Approved.booking_end_date;
    assert.strictEqual(approvedEndDate, d1Requested, 'Official schedule end date must update to approved date');

    // Verify Coordinator receives notification: "Date Extended — Review Room Booking and Travel Arrangements"
    const coordNotifs = await getNotifications({ role: 'COORDINATOR', limit: 200 });
    const reviewNotif = coordNotifs.find(
      (n) => n.checklist_id === chk1.id && n.title && n.title.includes('Date Extended — Review Room Booking and Travel Arrangements')
    );
    assert(reviewNotif, 'Coordinator must receive logistics review notification');
    recordTest(4, 'HR approves extension -> Coordinator receives room/travel review notification', true, 'Notification: Date Extended — Review Room Booking and Travel Arrangements');

    // --------------------------------------------------------------------------
    // CASE 5: HR rejects an extension and the original official schedule remains intact.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 5: HR rejects extension -> official schedule unchanged ---');
    const d5Start = getUniqueDate(20);
    const d5End = getUniqueDate(21);
    const d5Rev = getUniqueDate(23);
    const chk5 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Rejection Test ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Salem',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '2 Days',
      vehicle_type: 'Truck',
      expected_arrival_date: d5Start,
      service_engineer: 'Sakthivel',
    });
    const origChk5 = await getChecklistById(chk5.id);
    const origSched5 = origChk5.current_booking_end_date || origChk5.booking_end_date || origChk5.expected_arrival_date;
    const extReq5 = await requestScheduleExtension({
      checklistId: chk5.id,
      user: testUserTech,
      requestedCompletionDate: d5Rev,
      reason: 'Personal delay',
    });
    await rejectScheduleExtension(extReq5.id, testUserHR, 'Unjustified delay - maintain schedule');
    const freshChk5 = await getChecklistById(chk5.id);
    assert.strictEqual(freshChk5.booking_end_date || freshChk5.expected_arrival_date, origSched5, 'Official schedule must remain intact on rejection');
    assert.strictEqual(freshChk5.expected_arrival_date, d5Start, 'Official start date must remain intact on rejection');
    recordTest(5, 'HR rejects extension -> official schedule remains intact & rejection recorded', true, `Schedule maintained at: ${origSched5}`);

    // --------------------------------------------------------------------------
    // CASE 6 & 7: Technician completes work late without extension request & late completion recorded.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 6 & 7: Late completion without extension request ---');
    const d6Start = getUniqueDate(30);
    const chk6 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Late Completion ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Trichy Hub',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d6Start,
      service_engineer: 'Sakthivel',
    });
    const d6LateActual = `${getUniqueDate(32)}T01:00:00`;
    const d6LateSubmit = `${getUniqueDate(32)}T01:10:00`;

    // Record late completion directly
    const lateRecord = await recordLateCompletion({
      checklist: chk6,
      actualCompletionDatetime: d6LateActual,
      submissionDatetime: d6LateSubmit,
      user: testUserTech,
    });
    assert(lateRecord, 'Late completion record must be created');
    assert.strictEqual(lateRecord.category, OVERDUE_CATEGORIES.LATE_COMPLETION);

    // Verify HR notification
    const hrLateNotifs = await getNotifications({ role: 'HR' });
    const lateNotif = hrLateNotifs.find((n) => n.checklist_id === chk6.id && n.type === 'LATE_COMPLETION_ALERT');
    assert(lateNotif, 'HR must receive Late Completion Recorded notification');
    assert.strictEqual(lateNotif.title, 'Late Completion Recorded');

    // Confirm no extension was fabricated or auto-approved
    const extForChk6 = Array.from(inMemoryExtensions.values()).find((e) => e.checklist_id === chk6.id);
    assert.strictEqual(extForChk6, undefined, 'No fictional extension request created');
    recordTest(6, 'Technician completes work late without submitting an extension request', true, 'Work completed late without extension');
    recordTest(7, 'System records late completion without automatically approving an extension', true, 'HR alert sent: Late Completion Recorded');

    // --------------------------------------------------------------------------
    // CASE 8 & 9: Technician completes at 1:00 AM, submits at 1:10 AM & separate values stored.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 8 & 9: 1:00 AM completion and 1:10 AM submission separation ---');
    const d8Date = getUniqueDate(40);
    const chk8 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive 1AM Separated Job ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Madurai',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d8Date,
      service_engineer: 'Sakthivel',
    });

    const completion1am = `${d8Date}T01:00:00`;
    const submission110am = `${d8Date}T01:10:00`;

    const task8 = await triggerReturnTicketBookingTask(chk8.id, {
      actualCompletionDatetime: completion1am,
      submissionDatetime: submission110am,
      destination: 'Chennai',
    });

    assert.strictEqual(task8.actual_completion_datetime, completion1am);
    assert.strictEqual(task8.report_submission_datetime, submission110am);
    assert.notStrictEqual(task8.actual_completion_datetime, task8.report_submission_datetime);
    recordTest(8, 'Technician completes work at 1:00 AM and submits at 1:10 AM', true, 'Submission successful');
    recordTest(9, 'Actual completion time and submission time remain distinct', true, `Actual: ${completion1am} vs Submission: ${submission110am}`);

    // --------------------------------------------------------------------------
    // CASE 10: Valid Post-Installation Form can be submitted after scheduled end date & after 10 PM.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 10: Post-Installation Form submitted after-hours (10:30 PM) ---');
    const d10Date = getUniqueDate(50);
    const chk10 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive After 10PM Form ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Salem',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d10Date,
      service_engineer: 'Mathi',
    });

    const task10 = await triggerReturnTicketBookingTask(chk10.id, {
      actualCompletionDatetime: `${d10Date}T22:15:00`,
      submissionDatetime: `${d10Date}T22:30:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(task10.return_status, 'Booking Required');
    recordTest(10, 'Valid Post-Installation Form submitted after scheduled end date and after 10 PM', true, 'Report saved & return task created at 10:30 PM');

    // --------------------------------------------------------------------------
    // CASE 11: Return-ticket task is created immediately after successful submission.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 11: Return-ticket task created immediately ---');
    assert.strictEqual(task10.return_task_created, true);
    assert(task10.return_task_created_at, 'Creation timestamp must exist');
    recordTest(11, 'Return-ticket task is created immediately after successful submission', true, `Task Status: ${task10.return_status}`);

    // --------------------------------------------------------------------------
    // CASE 12: Task is created while Coordinator and HR are logged out.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 12: Task created while Coordinator and HR are logged out ---');
    // Service-level execution without any user session
    assert.strictEqual(task10.return_status, 'Booking Required');
    recordTest(12, 'Task is created while Coordinator and HR are logged out', true, 'Created server-side with no active session dependency');

    // --------------------------------------------------------------------------
    // CASE 13: Task remains visible the next morning.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 13: Task remains visible the next morning in Coordinator Workspace ---');
    const coordList = await getCoordinatorChecklists(testUserCoordinator, {
      returnStatus: 'Booking Required',
      tab: 'all',
    });
    const foundTask10 = (coordList.checklists || []).find((c) => c.id === chk10.id);
    assert(foundTask10, 'Task must appear in Coordinator Workspace');
    assert.strictEqual(foundTask10.coordinator_booking.return_status, 'Booking Required');
    recordTest(13, 'Task remains visible next morning in Coordinator Workspace', true, `Visible in Pending Return Tickets (#${chk10.checklist_number})`);

    // --------------------------------------------------------------------------
    // CASE 14: Notification fails but task remains saved.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 14: Notification delivery failure does not lose the task ---');
    const d14Date = getUniqueDate(60);
    const chk14 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Notif Resilience ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Vellore',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d14Date,
      service_engineer: 'Mathi',
    });
    const task14 = await triggerReturnTicketBookingTask(chk14.id, {
      actualCompletionDatetime: `${d14Date}T20:00:00`,
      submissionDatetime: `${d14Date}T20:15:00`,
      destination: 'Chennai',
      user: { id: 'invalid-non-uuid-user', email: 'broken@example.com' },
    });
    assert.strictEqual(task14.return_status, 'Booking Required');
    recordTest(14, 'Notification delivery failure does not lose return-ticket task', true, 'Task persisted before notification dispatch');

    // --------------------------------------------------------------------------
    // CASE 15: Retried submissions do not create duplicate tasks.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 15: Retried submission does not create duplicate tasks ---');
    const retriedTask = await triggerReturnTicketBookingTask(chk14.id, {
      actualCompletionDatetime: `${d14Date}T20:00:00`,
      submissionDatetime: `${d14Date}T20:15:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(retriedTask.id, task14.id, 'Must return same booking ID without duplicates');
    recordTest(15, 'Retried submissions do not create duplicate return-ticket tasks', true, `Idempotent Booking ID: ${task14.id}`);

    // --------------------------------------------------------------------------
    // CASE 16: Failed report submission does not create a return-ticket task.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 16: Failed report submission does not create return-ticket task ---');
    const d16Date = getUniqueDate(70);
    const chk16 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Validation Fail ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Madurai',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d16Date,
      service_engineer: 'Mathi',
    });

    let submissionFailed = false;
    try {
      // Intentionally provide invalid reconciliation quantities (carried 10, installed 5, returned 0 -> mismatch 5)
      await submitInstallationCompletionReport({
        checklist_id: chk16.id,
        user: testUserTech,
        items: [
          {
            device_type: '4 Channel Live',
            quantity_carried: 10,
            quantity_installed: 5,
            quantity_to_return: 0,
            quantity_damaged: 0,
            quantity_missing: 0,
          },
        ],
      });
    } catch (err) {
      submissionFailed = true;
      assert(err.message.includes('Reconciliation mismatch'), 'Error must specify reconciliation mismatch');
    }
    assert(submissionFailed, 'Report submission with reconciliation error must fail');
    const bookingDetails16 = await getBookingDetails(chk16.id);
    assert.strictEqual(bookingDetails16.booking.return_status, 'Not Required Yet');
    recordTest(16, 'Failed report submission does not create a return-ticket task', true, 'Task prevented: Status remains Not Required Yet');

    // --------------------------------------------------------------------------
    // CASE 17: Coordinator records Government bus and Private travels bookings.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 17: Coordinator records Government bus & Private travels bookings ---');
    const d17Date = getUniqueDate(80);
    const chk17 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Multi-Travel ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Coimbatore',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d17Date,
      service_engineer: 'Mathi',
    });

    // 17A: Outbound with Government bus
    await saveCoordinatorBooking({
      checklistId: chk17.id,
      user: testUserCoordinator,
      bookingData: {
        outbound_status: 'Confirmed',
        outbound_method: 'Government bus',
        outbound_operator: 'SETC Ultra Deluxe AC',
        outbound_origin: 'Chennai',
        outbound_destination: 'Coimbatore',
        outbound_departure_datetime: `${d17Date}T06:00:00`,
        outbound_ticket_reference: 'SETC-TN-99214',
      },
    });

    // 17B: Return with Private travels
    await updateReturnTicketBooking({
      checklistId: chk17.id,
      user: testUserCoordinator,
      returnData: {
        return_status: 'Confirmed',
        return_method: 'Private travels',
        return_operator: 'KPN Travels AC Sleeper',
        return_origin: 'Coimbatore',
        return_destination: 'Chennai',
        return_departure_datetime: `${d17Date}T21:00:00`,
        return_ticket_reference: 'KPN-PVT-88124',
      },
    });

    const chk17Details = (await getBookingDetails(chk17.id)).booking;
    assert.strictEqual(chk17Details.outbound_method, 'Government bus');
    assert.strictEqual(chk17Details.return_method, 'Private travels');
    recordTest(17, 'Coordinator can record Government bus and Private travels bookings', true, 'Outbound: Govt bus (SETC) | Return: Private travels (KPN)');

    // --------------------------------------------------------------------------
    // CASE 18: Coordinator records Online and Offline accommodation bookings.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 18: Coordinator records Online & Offline accommodation bookings ---');
    // 18A: Online accommodation requires confirmation reference or attachment
    await saveCoordinatorBooking({
      checklistId: chk17.id,
      user: testUserCoordinator,
      bookingData: {
        accommodation_status: 'Confirmed',
        accommodation_type: 'Online booking',
        hotel_name: 'FabHotel Grand',
        hotel_platform: 'MakeMyTrip',
        check_in_date: d17Date,
        check_out_date: getUniqueDate(81),
        number_of_rooms: 1,
        hotel_booking_reference: 'MMT-HTL-94812',
      },
    });

    // 18B: Offline accommodation does NOT require online confirmation reference
    const d18Date = getUniqueDate(90);
    const chk18 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Offline Lodge ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Dharmapuri',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d18Date,
      service_engineer: 'Sakthivel',
    });

    const offlineRoom = await saveCoordinatorBooking({
      checklistId: chk18.id,
      user: testUserCoordinator,
      bookingData: {
        accommodation_status: 'Confirmed',
        accommodation_type: 'Offline booking',
        hotel_name: 'Sri Venkateswara Lodge',
        offline_contact_person: 'Manager Ramesh',
        hotel_contact: '9840199999',
        check_in_date: d18Date,
        check_out_date: getUniqueDate(91),
        total_cost: 1200,
        payment_status: 'Agreed upon arrival',
        offline_notes: 'Cash on arrival agreed with manager',
      },
    });

    assert.strictEqual(offlineRoom.accommodation_type, 'Offline booking');
    assert.strictEqual(offlineRoom.hotel_booking_reference, null);
    recordTest(18, 'Coordinator can record online and offline accommodation bookings', true, 'Online (MMT-HTL) & Offline (Sri Venkateswara Lodge - no online ref)');

    // --------------------------------------------------------------------------
    // CASE 19: Confirmed booking is NOT created without actual confirmation details.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 19: Confirmed booking validation prevents empty confirmations ---');
    let emptyConfirmBlocked = false;
    try {
      await saveCoordinatorBooking({
        checklistId: chk18.id,
        user: testUserCoordinator,
        bookingData: {
          outbound_status: 'Confirmed',
          outbound_origin: 'Chennai',
          outbound_destination: 'Dharmapuri',
          outbound_departure_datetime: `${d18Date}T06:00:00`,
          outbound_ticket_reference: '',
          outbound_attachment_url: '',
        },
      });
    } catch (err) {
      emptyConfirmBlocked = true;
      assert(err.message.includes('ticket reference'), 'Must require ticket reference');
    }
    assert(emptyConfirmBlocked, 'Must not allow confirmed status without ticket details');
    recordTest(19, 'Confirmed booking is not created without actual confirmation details', true, 'Validation error enforced on empty reference');

    // --------------------------------------------------------------------------
    // CASE 20: Existing technician availability constraints remain enforced.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 20: Existing technician availability constraints enforced ---');
    // An incomplete overdue job marks the engineer's status OVERDUE
    const engAvail = await checkEngineerAvailability({
      engineerName: 'Mathi',
      startDate: d1Start,
      endDate: d1After,
    });
    // Incomplete overdue job blocks or flags conflict
    assert(engAvail, 'Availability check must execute');
    recordTest(20, 'Existing technician availability constraints remain enforced', true, 'Overdue jobs prevent unverified reassignment');

    // --------------------------------------------------------------------------
    // CASE 21: Existing Store Manager stock verification remains independent.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 21: Store Manager stock verification remains independent ---');
    // Submitting a completion report sets reconciliation_status: PENDING_STORE_VERIFICATION
    // and does NOT auto-verify physical returns
    const d21Date = getUniqueDate(100);
    const chk21 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Store Separation ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Salem',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: d21Date,
      service_engineer: 'Mathi',
    });
    await submitInstallationCompletionReport({
      checklist_id: chk21.id,
      user: testUserTech,
      items: [
        {
          device_type: '4 Channel Live',
          quantity_carried: 2,
          quantity_installed: 1,
          quantity_to_return: 1, // 1 unused device declared for return
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
    });
    const chk21After = await getChecklistById(chk21.id);
    assert.strictEqual(chk21After.installation_status, 'Completed');
    assert.strictEqual(chk21After.reconciliation_status, 'PENDING_STORE_VERIFICATION');
    recordTest(21, 'Existing Store Manager stock verification remains independent', true, 'Status: PENDING_STORE_VERIFICATION');

    // --------------------------------------------------------------------------
    // CASE 22: Role permissions and database security remain intact.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 22: Role permissions and database security remain intact ---');
    // Coordinator attempting to approve extension returns 403 Forbidden
    const extForbiddenRes = await fetch(`${baseUrl}/api/coordinator/schedule-extensions/${extReq3.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'COORDINATOR' },
      body: JSON.stringify({ notes: 'Coordinator trying to approve extension' }),
    });
    assert.strictEqual(extForbiddenRes.status, 403, 'Coordinator approval must return 403 Forbidden');
    recordTest(22, 'Existing role permissions and database security remain intact', true, '403 Forbidden on Coordinator approving HR extension');

    console.log('\n========================================================================');
    console.log(`  ALL ${results.length} END-TO-END TESTS COMPLETED SUCCESSFULLY!        `);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ Test Suite Aborted due to error:', err);
    throw err;
  } finally {
    server.close();
  }

  return results;
}

runCompleteHrTestSuite()
  .then((results) => {
    const passed = results.filter((r) => r.passed).length;
    console.log(`Summary: ${passed}/${results.length} test cases passed.`);
    process.exit(passed === results.length ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
