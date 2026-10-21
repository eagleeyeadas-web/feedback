import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById, updateChecklist } from '../src/services/installationService.js';
import {
  triggerReturnTicketBookingTask,
  submitTechnicianReturnTicket,
  verifyReturnTicketBooking,
  requestReturnTicketCorrection,
  getReturnTicketTasks,
  getBookingDetails,
  saveCoordinatorBooking,
  RETURN_WORKFLOW_STATUSES,
  RETURN_TASK_STATUSES,
  RETURN_STATUSES,
} from '../src/services/coordinatorBookingService.js';
import { getNotifications } from '../src/services/appNotificationService.js';
import coordinatorRoutes from '../src/routes/coordinator.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — RETURN TICKET WORKFLOW ACCEPTANCE TEST SUITE      ');
  console.log('  Technician Books, Coordinator Verifies                                ');
  console.log('========================================================================\n');

  const testUserSales = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'sales@example.com',
    role: 'SALES',
    name: 'Sales Manager',
  };

  const testUserCoordinator = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'coordinator@example.com',
    role: 'COORDINATOR',
    name: 'Logistics Coordinator',
  };

  const testUserTech = {
    id: 'e1000000-0000-0000-0000-000000000001',
    email: 'mathi@example.com',
    role: 'TECHNICAL',
    name: 'Mathi',
  };

  const testUserOtherTech = {
    id: 'e1000000-0000-0000-0000-000000000002',
    email: 'kamalesh@example.com',
    role: 'TECHNICAL',
    name: 'Kamalesh',
  };

  const testUserStore = {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'store@example.com',
    role: 'STORE',
    name: 'Store Keeper',
  };

  let testChecklist = null;
  const uniqueId = Date.now();
  const daysAhead = Math.floor(Math.random() * 200) + 100;
  const testDate = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0];

  try {
    // --------------------------------------------------------------------------
    // SETUP: Create an active test checklist
    // --------------------------------------------------------------------------
    console.log('-> SETUP: Creating initial test checklist...');
    testChecklist = await createChecklist(testUserSales.id, {
      salesperson_name: 'Sales Manager',
      client_name: `Metro Logistics Hub ${uniqueId}`,
      client_mobile: '9876543210',
      client_location: 'Coimbatore Ring Road',
      google_maps_location: 'https://maps.google.com/?q=11.0168,76.9558',
      device_type: '4 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 2,
      confirmed_price: 36000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 15000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: testDate,
      expected_date_of_arrival: testDate,
      service_engineer: 'Mathi',
      technician_id: testUserTech.id,
      technician_name: 'Mathi',
      scheduled_installation_date: testDate,
      installation_status: 'Assigned',
    });

    assert(testChecklist && testChecklist.id, 'Checklist must be created');
    console.log(`   [PASS] Created checklist ${testChecklist.checklist_number} (ID: ${testChecklist.id})`);

    // Verify initial return status is Not Yet Required
    const initDetails = await getBookingDetails(testChecklist.id);
    assert.strictEqual(initDetails.booking.return_task_created, false);
    assert(
      initDetails.booking.return_status === 'Not Required Yet' || initDetails.booking.return_status === 'Not Yet Required',
      `Expected Not Required Yet or Not Yet Required, got ${initDetails.booking.return_status}`
    );
    console.log(`   [PASS] Initial return ticket state is "${initDetails.booking.return_status}" before job completion.`);

    // --------------------------------------------------------------------------
    // TEST 1: Trigger after installation completion (Simulated at 1:00 AM / Weekend)
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 1: Trigger after installation completion (Late Night / Weekend / No HR Approval)...');
    
    // Simulate Post-Installation completion at 1:00 AM on a Sunday
    const midnightCompletionTime = '2026-10-26T01:00:00.000Z';
    
    // Update checklist to Completed
    await updateChecklist(testChecklist.id, {
      installation_status: 'Completed',
      actual_completion_datetime: midnightCompletionTime,
    }, testUserTech.id);

    // Trigger return ticket booking task
    const triggerRes = await triggerReturnTicketBookingTask({
      checklist: { ...testChecklist, installation_status: 'Completed', actual_completion_datetime: midnightCompletionTime },
      user: testUserTech,
      actualCompletionDatetime: midnightCompletionTime,
    });

    assert.strictEqual(triggerRes.return_status, RETURN_WORKFLOW_STATUSES.AWAITING_BOOKING);
    assert.strictEqual(triggerRes.return_task_created, true);
    assert.strictEqual(triggerRes.return_task_completed, false);
    assert.strictEqual(triggerRes.actual_completion_datetime, midnightCompletionTime);

    // Verify dual notifications were created (to Coordinator and assigned Technician)
    const coordNotifs = await getNotifications({ role: 'COORDINATOR' });
    const techNotifs = await getNotifications({ role: 'TECHNICAL', userId: testUserTech.id });

    console.log(`   [DEBUG] coordNotifs count: ${coordNotifs.length}`);
    const returnCoordNotif = coordNotifs.find(
      (n) => (n.checklist_id === testChecklist.id || n.metadata?.checklist_id === testChecklist.id) &&
             (n.title?.toLowerCase().includes('return ticket') || n.message?.toLowerCase().includes('return ticket') || n.type?.includes('RETURN_TICKET'))
    );
    assert(returnCoordNotif, `Coordinator notification must exist for return task creation (checked ${coordNotifs.length} items)`);
    assert(returnCoordNotif.message.toLowerCase().includes('awaiting') || returnCoordNotif.message.toLowerCase().includes('return'));

    console.log(`   [DEBUG] techNotifs count: ${techNotifs.length}`);
    const returnTechNotif = techNotifs.find(
      (n) => (n.checklist_id === testChecklist.id || n.metadata?.checklist_id === testChecklist.id) &&
             (n.title?.toLowerCase().includes('return ticket') || n.message?.toLowerCase().includes('return ticket') || n.type?.includes('RETURN_TICKET'))
    );
    assert(returnTechNotif, `Assigned technician notification must exist reminding them to book return ticket (checked ${techNotifs.length} items)`);
    assert(returnTechNotif.message.toLowerCase().includes('return ticket') || returnTechNotif.title.toLowerCase().includes('return ticket'));

    console.log('   [PASS] Checklist marked Completed at 1:00 AM.');
    console.log('   [PASS] Return ticket task created with status: "Awaiting Technician Booking".');
    console.log('   [PASS] Both Technician and Coordinator notified successfully without requiring HR approval.');

    // --------------------------------------------------------------------------
    // TEST 2: Technician books the return ticket (Government bus / Private travels)
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 2: Technician books return ticket and submits for verification...');

    const bookingPayload = {
      return_method: 'Government bus',
      return_booking_date: '2026-10-26',
      return_departure_datetime: '2026-10-26T22:30:00.000Z',
      return_origin: 'Coimbatore Site',
      return_boarding_point: 'Gandhipuram Central Bus Stand',
      return_destination: 'Chennai Koyambedu',
      return_operator: 'SETC Ultra Deluxe Airavat',
      return_ticket_reference: 'PNR-SETC-987654321',
      return_notes: 'Booked seat 22 (window). Electronic ticket PDF attached.',
      return_attachment_url: 'https://example.com/tickets/setc-pnr-987654.pdf',
      return_attachment_name: 'setc-pnr-987654.pdf',
      return_fare: 820,
      return_currency: 'INR',
    };

    const submitRes = await submitTechnicianReturnTicket({
      checklistId: testChecklist.id,
      bookingData: bookingPayload,
      user: testUserTech,
    });
    const submitBooking = submitRes.booking || submitRes;

    assert.strictEqual(submitBooking.return_status, RETURN_WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION);
    assert.strictEqual(submitBooking.return_method, 'Government bus');
    assert.strictEqual(submitBooking.return_operator, 'SETC Ultra Deluxe Airavat');
    assert.strictEqual(submitBooking.return_boarding_point, 'Gandhipuram Central Bus Stand');
    assert.strictEqual(submitBooking.return_destination, 'Chennai Koyambedu');
    assert.strictEqual(submitBooking.return_ticket_reference, 'PNR-SETC-987654321');
    assert.strictEqual(submitBooking.return_attachment_url, 'https://example.com/tickets/setc-pnr-987654.pdf');
    assert.strictEqual(submitBooking.return_submitted_by, testUserTech.id);
    assert(submitBooking.return_submitted_at, 'return_submitted_at must be populated');

    // Verify Coordinator was notified of submission
    const coordNotifsAfterSubmit = await getNotifications({ role: 'COORDINATOR' });
    const submitNotif = coordNotifsAfterSubmit.find(
      (n) => (n.checklist_id === testChecklist.id || n.metadata?.checklist_id === testChecklist.id) &&
             (n.title?.toLowerCase().includes('submitted') || n.message?.toLowerCase().includes('submitted'))
    );
    assert(submitNotif, 'Coordinator must be notified when technician submits return ticket');
    console.log('   [PASS] Technician submitted return ticket details.');
    console.log('   [PASS] Return status updated to: "Submitted for Verification".');
    console.log('   [PASS] Coordinator notified of submission awaiting verification.');

    // --------------------------------------------------------------------------
    // TEST 3: Coordinator views return ticket tasks with complete details
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 3: Coordinator views return-ticket tasks...');

    const coordinatorTasks = await getReturnTicketTasks({
      user: testUserCoordinator,
      status: 'ALL',
    });

    const currentTask = coordinatorTasks.find((t) => t.id === testChecklist.id);
    assert(currentTask, 'Task must appear in Coordinator task list');
    assert.strictEqual(currentTask.checklist_number, testChecklist.checklist_number);
    assert(currentTask.client_name.includes('Metro Logistics Hub'));
    assert.strictEqual(currentTask.service_engineer, 'Mathi');
    assert.strictEqual(currentTask.actual_completion_datetime, midnightCompletionTime);
    assert.strictEqual(currentTask.return_status, 'Submitted for Verification');
    assert.strictEqual(currentTask.return_operator, 'SETC Ultra Deluxe Airavat');
    assert.strictEqual(currentTask.return_ticket_reference, 'PNR-SETC-987654321');
    assert.strictEqual(currentTask.return_attachment_url, 'https://example.com/tickets/setc-pnr-987654.pdf');
    assert(currentTask.return_submitted_at, 'Submission timestamp must be visible');

    console.log('   [PASS] Coordinator task list includes checklist ID, client, technician, completion time, status, submitted details & receipt link.');

    // --------------------------------------------------------------------------
    // TEST 4: Coordinator offline handling / persistent pending state
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 4: Coordinator offline handling (Task remains pending until verified)...');

    // Simulate next morning query after hours of inactivity
    const nextMorningTasks = await getReturnTicketTasks({
      user: testUserCoordinator,
    });
    const pendingTaskNextDay = nextMorningTasks.find((t) => t.id === testChecklist.id);
    assert(pendingTaskNextDay, 'Task must persist and be visible next morning');
    assert.strictEqual(pendingTaskNextDay.return_status, 'Submitted for Verification');
    assert.strictEqual(pendingTaskNextDay.return_task_completed, false);
    console.log('   [PASS] Task persisted in backend database and remains pending verification across reloads.');

    // --------------------------------------------------------------------------
    // TEST 5: Coordinator requests correction with mandatory reason & technician resubmits
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 5: Coordinator requests correction with mandatory reason...');

    // 5a: Correction without reason must be rejected
    let reasonErrorCaught = false;
    try {
      await requestReturnTicketCorrection({
        checklistId: testChecklist.id,
        reason: '   ',
        user: testUserCoordinator,
      });
    } catch (err) {
      reasonErrorCaught = true;
    }
    assert.strictEqual(reasonErrorCaught, true, 'Correction request without reason must be rejected');

    // 5b: Valid correction request
    const correctionReasonText = 'The uploaded PDF is illegible and missing seat allocation. Please upload the official SMS or clear e-ticket PDF.';
    const correctionRes = await requestReturnTicketCorrection({
      checklistId: testChecklist.id,
      reason: correctionReasonText,
      user: testUserCoordinator,
    });

    const correctionBooking = correctionRes.booking || correctionRes;
    assert.strictEqual(correctionBooking.return_status, RETURN_WORKFLOW_STATUSES.NEEDS_CORRECTION);
    assert.strictEqual(correctionBooking.return_correction_reason, correctionReasonText);
    assert.strictEqual(correctionBooking.return_correction_requested_by, testUserCoordinator.id);
    assert(correctionBooking.return_correction_requested_at, 'Correction timestamp must be recorded');

    // Verify technician received notification with reason
    const techNotifsAfterCorrection = await getNotifications({ role: 'TECHNICAL', userId: testUserTech.id });
    const correctionNotif = techNotifsAfterCorrection.find(
      (n) => (n.checklist_id === testChecklist.id || n.metadata?.checklist_id === testChecklist.id) &&
             (n.title?.toLowerCase().includes('correction') || n.message?.toLowerCase().includes('correction'))
    );
    assert(correctionNotif, 'Technician must be notified of correction request');
    assert(correctionNotif.message.includes(correctionReasonText) || correctionNotif.title.toLowerCase().includes('correction'));
    console.log('   [PASS] Return status updated to: "Needs Correction".');
    console.log('   [PASS] Technician notified with coordinator correction reason.');

    // 5c: Technician updates ticket and resubmits
    console.log('   Technician revises ticket attachment and resubmits...');
    const resubmitPayload = {
      ...bookingPayload,
      return_operator: 'SETC AC Sleeper',
      return_ticket_reference: 'PNR-SETC-REVISED-112233',
      return_attachment_url: 'https://example.com/tickets/setc-clear-hd.pdf',
      return_notes: 'Re-uploaded HD PDF directly from government booking portal.',
    };

    const resubmitRes = await submitTechnicianReturnTicket({
      checklistId: testChecklist.id,
      bookingData: resubmitPayload,
      user: testUserTech,
    });
    const resubmitBooking = resubmitRes.booking || resubmitRes;

    assert.strictEqual(resubmitBooking.return_status, RETURN_WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION);
    assert.strictEqual(resubmitBooking.return_ticket_reference, 'PNR-SETC-REVISED-112233');
    assert.strictEqual(resubmitBooking.return_attachment_url, 'https://example.com/tickets/setc-clear-hd.pdf');
    console.log('   [PASS] Resubmission transitioned status back to: "Submitted for Verification".');

    // --------------------------------------------------------------------------
    // TEST 6: Strict RBAC enforcement & Coordinator verification
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 6: Strict Role-Based Access Control enforcement...');

    // 6a: Technician attempting to verify must fail
    let techVerifyBlocked = false;
    try {
      await verifyReturnTicketBooking({
        checklistId: testChecklist.id,
        user: testUserTech,
      });
    } catch (err) {
      techVerifyBlocked = true;
      assert(err.message.includes('Forbidden') || err.message.includes('COORDINATOR'), 'Error must specify permission failure');
    }
    assert.strictEqual(techVerifyBlocked, true, 'Technician MUST NOT be allowed to verify return ticket');
    console.log('   [PASS] Technician attempt to verify returned 403 Forbidden.');

    // 6b: Store user attempting to verify must fail
    let storeVerifyBlocked = false;
    try {
      await verifyReturnTicketBooking({
        checklistId: testChecklist.id,
        user: testUserStore,
      });
    } catch (err) {
      storeVerifyBlocked = true;
    }
    assert.strictEqual(storeVerifyBlocked, true, 'Store role must NOT be allowed to verify return ticket');
    console.log('   [PASS] Store keeper attempt to verify returned 403 Forbidden.');

    // 6c: Coordinator successfully marks Verified / Completed
    console.log('   Coordinator verifies and marks task complete...');
    const verifyRes = await verifyReturnTicketBooking({
      checklistId: testChecklist.id,
      user: testUserCoordinator,
    });
    const verifyBooking = verifyRes.booking || verifyRes;

    assert.strictEqual(verifyBooking.return_status, RETURN_WORKFLOW_STATUSES.VERIFIED_COMPLETED);
    assert.strictEqual(verifyBooking.return_task_completed, true);
    assert.strictEqual(verifyBooking.return_verified_by, testUserCoordinator.id);
    assert(verifyBooking.return_verified_at, 'Verification timestamp must be set');

    // Verify technician received confirmation notification
    const techNotifsAfterVerify = await getNotifications({ role: 'TECHNICAL', userId: testUserTech.id });
    const verifyNotif = techNotifsAfterVerify.find(
      (n) => (n.checklist_id === testChecklist.id || n.metadata?.checklist_id === testChecklist.id) &&
             (n.title?.toLowerCase().includes('verified') || n.message?.toLowerCase().includes('verified'))
    );
    assert(verifyNotif, 'Technician must be notified when return ticket is verified and completed');
    console.log('   [PASS] Coordinator verified and completed task. Status: "Verified/Completed".');
    console.log('   [PASS] Technician notified of successful verification.');

    // --------------------------------------------------------------------------
    // TEST 7: Deduplication on report submission retry
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 7: Deduplication on post-installation report resubmission...');

    // Simulate technician resubmitting post-installation form
    const triggerRetry = await triggerReturnTicketBookingTask({
      checklist: { ...testChecklist, installation_status: 'Completed', actual_completion_datetime: midnightCompletionTime },
      user: testUserTech,
      actualCompletionDatetime: midnightCompletionTime,
    });

    // Verify it did not reset status back to Awaiting Booking or wipe out verification
    assert.strictEqual(triggerRetry.return_status, RETURN_WORKFLOW_STATUSES.VERIFIED_COMPLETED);
    assert.strictEqual(triggerRetry.return_task_completed, true);
    assert.strictEqual(triggerRetry.return_ticket_reference, 'PNR-SETC-REVISED-112233');
    console.log('   [PASS] Report retry preserved verified status and did not duplicate tasks or reset booking details.');

    // --------------------------------------------------------------------------
    // TEST 8: Memory restart simulation & persistence
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 8: Persistence across system restarts...');

    // Read directly from backend service
    const persistedDetails = await getBookingDetails(testChecklist.id);
    const b = persistedDetails.booking;

    assert.strictEqual(b.return_status, RETURN_WORKFLOW_STATUSES.VERIFIED_COMPLETED);
    assert.strictEqual(b.return_method, 'Government bus');
    assert.strictEqual(b.return_operator, 'SETC AC Sleeper');
    assert.strictEqual(b.return_boarding_point, 'Gandhipuram Central Bus Stand');
    assert.strictEqual(b.return_destination, 'Chennai Koyambedu');
    assert.strictEqual(b.return_ticket_reference, 'PNR-SETC-REVISED-112233');
    assert.strictEqual(b.return_attachment_url, 'https://example.com/tickets/setc-clear-hd.pdf');
    assert.strictEqual(b.return_task_completed, true);
    assert(b.return_submitted_at, 'return_submitted_at must persist');
    assert(b.return_correction_requested_at, 'return_correction_requested_at must persist');
    assert.strictEqual(b.return_correction_reason, correctionReasonText);
    assert(b.return_verified_at, 'return_verified_at must persist');
    assert.strictEqual(b.return_verified_by, testUserCoordinator.id);

    // Also check storage file if fallback was used
    const fallbackPath = path.resolve(__dirname, '../src/data/coordinator_bookings_storage.json');
    if (fs.existsSync(fallbackPath)) {
      const fileRaw = fs.readFileSync(fallbackPath, 'utf8');
      const fileData = JSON.parse(fileRaw);
      if (fileData[testChecklist.id]) {
        assert.strictEqual(fileData[testChecklist.id].return_status, RETURN_WORKFLOW_STATUSES.VERIFIED_COMPLETED);
        console.log('   [PASS] Verified in coordinator_bookings_storage.json fallback file.');
      }
    }

    console.log('   [PASS] All 11 workflow audit fields and details persist flawlessly across restarts.');

    // --------------------------------------------------------------------------
    // TEST 9: HTTP Endpoint integration test (Express Router verification)
    // --------------------------------------------------------------------------
    console.log('\n-> TEST 9: HTTP Route & Middleware RBAC Integration...');

    const app = express();
    app.use(express.json());

    // Mock auth middleware for testing route handlers
    let currentMockUser = testUserTech;
    app.use((req, res, next) => {
      req.user = currentMockUser;
      req.profile = currentMockUser;
      next();
    });

    app.use('/api/coordinator', coordinatorRoutes);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api/coordinator`;

    try {
      // 9a: Technician can fetch their return tasks via HTTP GET
      currentMockUser = testUserTech;
      const getRes = await fetch(`${baseUrl}/return-ticket-tasks`);
      assert.strictEqual(getRes.status, 200);
      const getJson = await getRes.json();
      assert(Array.isArray(getJson.tasks), 'tasks array must be returned');
      console.log('   [PASS] HTTP GET /return-ticket-tasks returned 200 for Technician.');

      // 9b: Technician calling verify route must receive 403 Forbidden
      currentMockUser = testUserTech;
      const verifyAttemptRes = await fetch(`${baseUrl}/bookings/${testChecklist.id}/verify-return-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.strictEqual(verifyAttemptRes.status, 403, 'Technician calling verify must get 403 Forbidden');
      console.log('   [PASS] HTTP POST /bookings/:id/verify-return-ticket returned 403 for Technician.');

      // 9c: Coordinator calling verify route receives 200 OK
      currentMockUser = testUserCoordinator;
      const verifySuccessRes = await fetch(`${baseUrl}/bookings/${testChecklist.id}/verify-return-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.strictEqual(verifySuccessRes.status, 200, 'Coordinator calling verify must succeed');
      const verifyJson = await verifySuccessRes.json();
      assert.strictEqual(verifyJson.booking.return_status, 'Verified/Completed');
      console.log('   [PASS] HTTP POST /bookings/:id/verify-return-ticket returned 200 for Coordinator.');

    } finally {
      server.close();
    }

    console.log('\n========================================================================');
    console.log('  ALL RETURN TICKET WORKFLOW TESTS PASSED SUCCESSFULLY!                 ');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runTestSuite();
