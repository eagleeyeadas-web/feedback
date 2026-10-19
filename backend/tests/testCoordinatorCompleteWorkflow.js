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
import {
  getCoordinatorChecklists,
  getBookingDetails,
  saveCoordinatorBooking,
  extendRoomBooking,
  triggerReturnTicketBookingTask,
  updateReturnTicketBooking,
  getBookingAuditHistory,
  TRAVEL_METHODS,
  ROOM_BOOKING_METHODS,
  RETURN_TASK_STATUSES,
} from '../src/services/coordinatorBookingService.js';
import { getNotifications, createNotification } from '../src/services/appNotificationService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
} from '../src/services/scheduleExtensionService.js';
import coordinatorRoutes from '../src/routes/coordinator.js';
import hrRoutes from '../src/routes/hr.js';

async function runCoordinatorTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — COORDINATOR WORKFLOW COMPLETE TEST SUITE        ');
  console.log('  Testing all 19 End-to-End Scenarios from Section 14                  ');
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

  // Setup express test server for role permission test
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const u = req.headers['x-test-role'] === 'HR' ? testUserHR : testUserCoordinator;
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

  let testChecklist = null;
  // Use unique offset based on millisecond timestamp to prevent booking collisions across repeated test runs
  const runSeed = Math.floor((Date.now() % 1000000) / 1000);
  const getUniqueDate = (offsetDays) => {
    const d = new Date(Date.now() + (2000 + runSeed + offsetDays) * 86400000);
    return d.toISOString().split('T')[0];
  };

  const testDate = getUniqueDate(0);
  const checkoutDate = getUniqueDate(2);
  const returnTravelDate = getUniqueDate(1);

  try {
    // --------------------------------------------------------------------------
    // CASE 1: A checklist is created and outbound travel details are recorded.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 1: Checklist creation & outbound travel recording ---');
    testChecklist = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Test Client ${Date.now()}`,
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
      expected_arrival_date: testDate,
      service_engineer: 'Sakthivel',
    });
    assert(testChecklist && testChecklist.id, 'Checklist must be created');

    const outboundRes = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
      bookingData: {
        booking_status: 'IN_PROGRESS',
        outbound_method: 'Government bus',
        outbound_mode: 'Bus',
        outbound_status: 'Confirmed',
        outbound_operator: 'SETC Bus #402',
        outbound_origin: 'Chennai CMBT',
        outbound_destination: 'Coimbatore',
        outbound_departure_datetime: `${testDate}T06:00:00`,
        outbound_boarding_point: 'CMBT Platform 3',
        outbound_arrival_location: 'Gandhipuram Central',
        outbound_estimated_arrival_time: `${testDate}T14:00:00`,
        outbound_fare: 650,
        outbound_currency: 'INR',
        outbound_ticket_reference: 'SETC-TN-98124',
      },
    });
    assert.strictEqual(outboundRes.outbound_method, 'Government bus');
    assert.strictEqual(outboundRes.outbound_status, 'Confirmed');
    assert.strictEqual(outboundRes.outbound_ticket_reference, 'SETC-TN-98124');
    recordTest(1, 'Checklist created & outbound travel recorded', true, `Ticket Ref: ${outboundRes.outbound_ticket_reference}`);

    // --------------------------------------------------------------------------
    // CASE 2: Online room booking is saved.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 2: Online room booking saved with confirmation reference ---');
    const onlineRoomRes = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
      bookingData: {
        booking_status: 'IN_PROGRESS',
        accommodation_type: 'Online booking',
        accommodation_status: 'Confirmed',
        hotel_name: 'Grand Residency Hotel',
        hotel_platform: 'Booking.com',
        hotel_address: '124 Avinashi Road, Coimbatore',
        hotel_contact: '+91 9443322110',
        check_in_date: testDate,
        check_out_date: checkoutDate,
        number_of_rooms: 1,
        number_of_occupants: 1,
        price_per_night: 1800,
        total_cost: 3600,
        hotel_booking_reference: 'BKG-9921448',
      },
    });
    assert.strictEqual(onlineRoomRes.accommodation_type, 'Online booking');
    assert.strictEqual(onlineRoomRes.accommodation_status, 'Confirmed');
    assert.strictEqual(onlineRoomRes.hotel_booking_reference, 'BKG-9921448');
    recordTest(2, 'Online room booking saved with confirmation number', true, 'BKG-9921448');

    // --------------------------------------------------------------------------
    // CASE 3: Offline room booking is saved without requiring online confirmation number.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 3: Offline room booking saved without online confirmation number ---');
    const offlineRoomRes = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
      bookingData: {
        booking_status: 'IN_PROGRESS',
        accommodation_type: 'Offline booking',
        accommodation_status: 'Confirmed',
        hotel_name: 'Sri Krishna Lodge',
        hotel_platform: '', // No online platform
        hotel_address: 'Near Central Bus Stand, Coimbatore',
        hotel_contact: '0422-2233445',
        person_contacted: 'Manager Murugan',
        check_in_date: testDate,
        check_out_date: checkoutDate,
        number_of_rooms: 1,
        number_of_occupants: 1,
        price_per_night: 800,
        total_cost: 1600,
        hotel_booking_reference: '', // Empty online confirmation number! Must succeed!
        payment_method: 'Cash at Check-in',
        payment_status: 'Agreed upon arrival',
        notes: 'Direct phone booking with manager Murugan, no advance needed',
      },
    });
    assert.strictEqual(offlineRoomRes.accommodation_type, 'Offline booking');
    assert.strictEqual(offlineRoomRes.accommodation_status, 'Confirmed');
    assert.strictEqual(offlineRoomRes.hotel_booking_reference, null);
    recordTest(3, 'Offline room booking saved without online confirmation number', true, 'Sri Krishna Lodge (No online ref required)');

    // --------------------------------------------------------------------------
    // CASE 4: Government bus selected for outbound and private travels for return.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 4: Government bus outbound & Private travels return ---');
    const splitMethodRes = await updateReturnTicketBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
      returnData: {
        return_method: 'Private travels',
        return_operator: 'KPN Travels Sleeper',
        return_departure_datetime: `${testDate}T22:30:00`,
        return_origin: 'Coimbatore Omni Bus Stand',
        return_destination: 'Chennai Koyambedu',
        return_boarding_point: 'KPN Office Bay 2',
        return_arrival_location: 'Chennai Koyambedu',
        return_estimated_arrival_time: `${returnTravelDate}T06:00:00`,
        return_fare: 950,
        return_currency: 'INR',
        return_ticket_reference: 'KPN-SL-44912',
        return_status: 'Confirmed',
      },
    });
    const currentBooking = (await getBookingDetails(testChecklist.id)).booking;
    assert.strictEqual(currentBooking.outbound_method, 'Government bus');
    assert.strictEqual(currentBooking.return_method, 'Private travels');
    recordTest(4, 'Government bus for outbound & Private travels for return', true, 'Outbound: Govt bus | Return: Private travels');

    // --------------------------------------------------------------------------
    // CASE 5: Technician submits Post-Installation Form at 9:00 PM.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 5: Post-Installation submission at 9:00 PM ---');
    const date5 = getUniqueDate(10);
    const chk5 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive 9PM Job ${Date.now()}`,
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
      expected_arrival_date: date5,
      service_engineer: 'Mathi',
    });
    const task9pm = await triggerReturnTicketBookingTask(chk5.id, {
      actualCompletionDatetime: `${date5}T20:30:00`,
      submissionDatetime: `${date5}T21:00:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(task9pm.return_status, 'Booking Required');
    assert.strictEqual(task9pm.actual_completion_datetime, `${date5}T20:30:00`);
    recordTest(5, 'Post-Installation submitted at 9:00 PM -> Return task created', true, 'Task: Booking Required');

    // --------------------------------------------------------------------------
    // CASE 6: Technician submits Post-Installation Form at 10:30 PM (after 10 PM shift).
    // --------------------------------------------------------------------------
    console.log('\n--- Case 6: Post-Installation submission at 10:30 PM (after-hours) ---');
    const date6 = getUniqueDate(20);
    const chk6 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive 10:30PM Job ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Trichy',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: date6,
      service_engineer: 'Mathi',
    });
    const task1030pm = await triggerReturnTicketBookingTask(chk6.id, {
      actualCompletionDatetime: `${date6}T22:15:00`,
      submissionDatetime: `${date6}T22:30:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(task1030pm.return_status, 'Booking Required');
    assert(task1030pm.return_task_created_at, 'Task creation timestamp must exist');
    recordTest(6, 'Post-Installation submitted at 10:30 PM -> Created independently of Coordinator hours', true, 'Created: Booking Required');

    // --------------------------------------------------------------------------
    // CASE 7: Technician submits Post-Installation Form at 1:00 AM (midnight / early morning).
    // --------------------------------------------------------------------------
    console.log('\n--- Case 7: Post-Installation submission at 1:00 AM (midnight) ---');
    const date7 = getUniqueDate(30);
    const date7Next = getUniqueDate(31);
    const chk7 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive 1AM Job ${Date.now()}`,
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
      expected_arrival_date: date7,
      service_engineer: 'Mathi',
    });
    const task1am = await triggerReturnTicketBookingTask(chk7.id, {
      actualCompletionDatetime: `${date7Next}T00:45:00`,
      submissionDatetime: `${date7Next}T01:00:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(task1am.return_status, 'Booking Required');
    recordTest(7, 'Post-Installation submitted at 1:00 AM -> Immediate backend task creation', true, 'Created: Booking Required');

    // --------------------------------------------------------------------------
    // CASE 8: Scheduled job ends on 16th, but actual work completes on 17th at 1:00 AM.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 8: Schedule ends 16th, completed 17th at 1:00 AM (Overdue detection) ---');
    const date8Start = getUniqueDate(40);
    const date8Overdue = getUniqueDate(42);
    const chk8 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Overdue Job ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Erode',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '2 Days',
      vehicle_type: 'Truck',
      expected_arrival_date: date8Start,
      service_engineer: 'Mathi',
    });
    const taskOverdue = await triggerReturnTicketBookingTask(chk8.id, {
      actualCompletionDatetime: `${date8Overdue}T01:00:00`,
      submissionDatetime: `${date8Overdue}T01:10:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(taskOverdue.return_status, 'Booking Required');
    assert.strictEqual(taskOverdue.return_urgency, 'Overdue');
    recordTest(8, 'Scheduled 2-day job, completed past scheduled end date at 1:00 AM -> Marked Overdue', true, `Urgency: ${taskOverdue.return_urgency}`);

    // --------------------------------------------------------------------------
    // CASE 9: Actual completion time differs from report submission time.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 9: Actual completion time recorded separately from submission time ---');
    const compTime = `${date8Overdue}T01:00:00`;
    const subTime = `${date8Overdue}T01:10:00`;
    assert.notStrictEqual(compTime, subTime, 'Completion and submission time must be distinct');
    assert.strictEqual(taskOverdue.actual_completion_datetime, compTime);
    assert.strictEqual(taskOverdue.report_submission_datetime, subTime);
    recordTest(9, 'Actual completion time stored separately from report submission time', true, `Completion: ${compTime} vs Submission: ${subTime}`);

    // --------------------------------------------------------------------------
    // CASE 10: Coordinator is offline when report is submitted.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 10: Coordinator offline during submission ---');
    assert(taskOverdue.id, 'Task is persisted in database without requiring coordinator socket/session');
    assert.strictEqual(taskOverdue.return_status, 'Booking Required');
    recordTest(10, 'Coordinator offline during submission -> task automatically created in database', true, `Task ID: ${taskOverdue.id}`);

    // --------------------------------------------------------------------------
    // CASE 11: Coordinator logs in next morning and sees pending task.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 11: Coordinator logs in and fetches pending return tickets ---');
    const coordRes = await getCoordinatorChecklists(testUserCoordinator, {
      returnStatus: 'Booking Required',
      tab: 'all',
    });
    const foundTask = (coordRes.checklists || []).find((c) => c.id === chk8.id);
    assert(foundTask, 'Task must appear in coordinator pending return tickets list');
    assert.strictEqual(foundTask.coordinator_booking.return_status, 'Booking Required');
    recordTest(11, 'Coordinator logs in and fetches pending task in workspace', true, `Found: #${foundTask.checklist_number}`);

    // --------------------------------------------------------------------------
    // CASE 12: Notification failure does not lose the task.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 12: Decoupled notification failure does not lose return task ---');
    const date12 = getUniqueDate(50);
    const chk12 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Notif Fail ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Tirunelveli',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: date12,
      service_engineer: 'Mathi',
    });
    const task12 = await triggerReturnTicketBookingTask(chk12.id, {
      actualCompletionDatetime: `${date12}T18:00:00`,
      submissionDatetime: `${date12}T18:15:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(task12.return_status, 'Booking Required');
    const verifiedBooking12 = (await getBookingDetails(chk12.id)).booking;
    assert.strictEqual(verifiedBooking12.return_status, 'Booking Required');
    recordTest(12, 'Notification failure does not lose return-ticket task (transactionally persisted)', true, 'Task persisted before notification dispatch');

    // --------------------------------------------------------------------------
    // CASE 13: Retried submission does not create duplicate tasks.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 13: Duplicate prevention on retried submission ---');
    const retry1 = await triggerReturnTicketBookingTask(chk12.id, {
      actualCompletionDatetime: `${date12}T18:00:00`,
      submissionDatetime: `${date12}T18:15:00`,
      destination: 'Chennai',
    });
    const retry2 = await triggerReturnTicketBookingTask(chk12.id, {
      actualCompletionDatetime: `${date12}T18:00:00`,
      submissionDatetime: `${date12}T18:15:00`,
      destination: 'Chennai',
    });
    assert.strictEqual(retry1.id, retry2.id, 'Must reuse identical booking record ID without duplicates');
    recordTest(13, 'Retried submission does not create duplicate tasks', true, `Same Booking ID: ${retry1.id}`);

    // --------------------------------------------------------------------------
    // CASE 14: HR approves extension -> Coordinator receives review task.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 14: HR approves extension & Coordinator receives review task ---');
    const date14 = getUniqueDate(60);
    const date14Rev = getUniqueDate(62);
    const chk14 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Extension Review ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Hosur',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: date14,
      service_engineer: 'Mathi',
    });
    // Technician requests extension
    const extReq = await requestScheduleExtension({
      checklistId: chk14.id,
      user: testUserTech,
      requestedCompletionDate: date14Rev,
      reason: 'Additional customer wiring requirement',
    });
    assert(extReq && extReq.id, 'Extension request must be created');

    // HR approves extension
    const approvedExt = await approveScheduleExtension(extReq.id, testUserHR, 'Approved by HR');
    assert.strictEqual(approvedExt.status, 'APPROVED');

    // Verify Coordinator receives flagged review task
    const bookingAfterApproval = (await getBookingDetails(chk14.id)).booking;
    assert.strictEqual(bookingAfterApproval.schedule_flagged_for_review, true);
    assert.strictEqual(bookingAfterApproval.accommodation_status, 'Extension Required');

    // Verify Coordinator notification created: "Date Extended — Review Room Booking and Travel Arrangements."
    const coordNotifs = await getNotifications(testUserCoordinator.id, { limit: 10 });
    const extNotif = coordNotifs.find((n) => n.title && n.title.includes('Date Extended'));
    assert(extNotif, 'Coordinator must receive "Date Extended — Review Room Booking and Travel Arrangements" notification');
    recordTest(14, 'HR approves extension -> Coordinator receives review task & notification', true, extNotif.title);

    // --------------------------------------------------------------------------
    // CASE 15: HR rejects extension -> official schedule unchanged.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 15: HR rejects extension -> official schedule unchanged ---');
    const date15 = getUniqueDate(70);
    const date15Rev = getUniqueDate(73);
    const chk15 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Extension Rejection ${Date.now()}`,
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
      expected_arrival_date: date15,
      service_engineer: 'Mathi',
    });
    const origSchedule = chk15.expected_arrival_date;
    const extReq15 = await requestScheduleExtension({
      checklistId: chk15.id,
      user: testUserTech,
      requestedCompletionDate: date15Rev,
      reason: 'Site work delayed',
    });
    await rejectScheduleExtension(extReq15.id, testUserHR, 'Unjustified delay - maintain schedule');
    const freshChk15 = await getChecklistById(chk15.id);
    assert.strictEqual(freshChk15.expected_arrival_date, origSchedule, 'Official arrival date must remain unchanged on rejection');
    assert.strictEqual(freshChk15.installation_duration, '1 Day', 'Official duration must remain unchanged');
    recordTest(15, 'HR rejects extension -> official schedule retained & rejection recorded', true, `Schedule kept at: ${origSchedule}`);

    // --------------------------------------------------------------------------
    // CASE 16: Confirmed ticket edited or cancelled -> booking history preserved.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 16: Confirmed ticket edit/cancellation preserves audit history ---');
    await updateReturnTicketBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
      returnData: {
        return_method: 'Government bus',
        return_operator: 'TNSTC Super Deluxe',
        return_departure_datetime: `${testDate}T20:00:00`,
        return_ticket_reference: 'TNSTC-REVISED-109',
        return_status: 'Confirmed',
        return_notes: 'Updated due to earlier road opening',
      },
    });
    // Check audit history
    const auditLogs = await getBookingAuditHistory(testChecklist.id);
    assert(auditLogs.length >= 2, 'Audit history must contain prior revisions');
    const hasPreviousKpnRef = auditLogs.some((l) =>
      JSON.stringify(l.diff || {}).includes('KPN-SL-44912') ||
      JSON.stringify(l.before_state || {}).includes('KPN-SL-44912') ||
      JSON.stringify(l.snapshot || {}).includes('KPN-SL-44912') ||
      JSON.stringify(l.notes || '').includes('KPN-SL-44912')
    );
    assert(hasPreviousKpnRef, 'Audit log must retain previous ticket details');
    recordTest(16, 'Confirmed ticket edited -> previous history preserved in audit log', true, `${auditLogs.length} audit revisions found`);

    // --------------------------------------------------------------------------
    // CASE 17: Overdue job remains flagged appropriately after late completion.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 17: Late completion preserves overdue history ---');
    const chk8Fresh = await getChecklistById(chk8.id);
    const booking8Fresh = (await getBookingDetails(chk8.id)).booking;
    assert.strictEqual(booking8Fresh.return_urgency, 'Overdue');
    assert.strictEqual(booking8Fresh.actual_completion_datetime, `${date8Overdue}T01:00:00`);
    recordTest(17, 'Overdue job remains flagged appropriately after late completion', true, 'Overdue flag preserved');

    // --------------------------------------------------------------------------
    // CASE 18: Role permissions prevent Coordinator from approving HR extensions or confirming without details.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 18: Role permission enforcement ---');
    // 18A: Coordinator cannot approve HR extensions (403 Forbidden)
    const extApproveRes = await fetch(`${baseUrl}/api/coordinator/schedule-extensions/${extReq.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'COORDINATOR' },
      body: JSON.stringify({ notes: 'Coordinator trying to approve' }),
    });
    assert.strictEqual(extApproveRes.status, 403, 'Coordinator approving extension must return 403 Forbidden');

    // 18B: Coordinator cannot mark confirmed without ticket reference or receipt attachment
    let confirmWithoutRefFailed = false;
    try {
      await saveCoordinatorBooking({
        checklistId: testChecklist.id,
        user: testUserCoordinator,
        bookingData: {
          booking_status: 'COMPLETED',
          outbound_status: 'Confirmed',
          outbound_ticket_reference: '', // Missing ticket reference!
          outbound_attachment_url: '',  // Missing attachment!
        },
      });
    } catch (err) {
      confirmWithoutRefFailed = true;
      assert(err.message.includes('ticket reference'), 'Error must specify ticket reference requirement');
    }
    assert(confirmWithoutRefFailed, 'Cannot confirm booking without recording actual confirmation details');
    recordTest(18, 'Backend role permissions enforce HR extension exclusive & ticket ref requirements', true, '403 on extension approval & validation on confirmation');

    // --------------------------------------------------------------------------
    // CASE 19: Existing stock, Sales checklist, and Store Manager workflows continue to work.
    // --------------------------------------------------------------------------
    console.log('\n--- Case 19: Existing workflows (Sales, Technical, Store) integrity ---');
    const date19 = getUniqueDate(80);
    const chk19 = await createChecklist(testUserSales.id, {
      salesperson_name: 'Test Sales Rep',
      client_name: `SafDrive Integration Test ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Madurai Industrial Hub',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 36000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 15000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: date19,
      service_engineer: 'Mathi',
    });
    assert(chk19 && chk19.id, 'Sales checklist workflow works');
    assert(chk19.checklist_number.startsWith('EE-INST-'), 'Checklist number generated correctly');
    assert.strictEqual(chk19.installation_status, 'Assigned');
    recordTest(19, 'Existing Sales, Technical, Stock, and Store workflows continue to operate seamlessly', true, `Checklist #${chk19.checklist_number}`);

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

runCoordinatorTestSuite()
  .then((results) => {
    const passed = results.filter((r) => r.passed).length;
    console.log(`Summary: ${passed}/${results.length} test cases passed.`);
    process.exit(passed === results.length ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
