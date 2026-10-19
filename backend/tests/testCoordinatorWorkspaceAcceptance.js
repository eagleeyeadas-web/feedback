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
  getBookingAuditHistory,
  validateBookingCompletion,
} from '../src/services/coordinatorBookingService.js';
import coordinatorRoutes from '../src/routes/coordinator.js';
import installationRoutes from '../src/routes/installation.js';
import inventoryRoutes from '../src/routes/inventory.js';
import bomRoutes from '../src/routes/bom.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — COORDINATOR WORKSPACE ACCEPTANCE TEST SUITE      ');
  console.log('  Testing: Travel & Accommodation Bookings, Workflow & Role Security    ');
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

  let testChecklist = null;

  try {
    // --------------------------------------------------------------------------
    // Criterion 1 & 2: Sales creates checklist; appears in Coordinator workspace
    // with assigned engineer, client, location, and schedule
    // --------------------------------------------------------------------------
    console.log('-> Criterion 1 & 2: Sales creates checklist -> appears in Coordinator workspace...');
    const timestamp = Date.now();
    const daysAhead = Math.floor(Math.random() * 500) + 100;
    const futureDateObj = new Date(Date.now() + daysAhead * 86400000);
    const testDate = futureDateObj.toISOString().split('T')[0];

    testChecklist = await createChecklist(testUserSales.id, {
      salesperson_name: 'Ranjith',
      client_name: `Apollo Fleet Logistics ${timestamp}`,
      client_mobile: '9876543210',
      client_location: 'Coimbatore Industrial Zone',
      google_maps_location: 'https://maps.google.com/?q=11.0168,76.9558',
      device_type: '4 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 2,
      confirmed_price: 36000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 15000,
      installation_duration: '2 Days',
      vehicle_type: 'Truck',
      expected_arrival_date: testDate,
      expected_arrival_time: '09:30:00',
      installation_or_service: 'Installation',
      service_engineer: 'Sakthivel',
      remarks: 'Technician needs morning bus tickets and hotel near site.',
    });

    assert(testChecklist && testChecklist.id, 'Checklist should be created');
    console.log(`   Checklist created: #${testChecklist.checklist_number} (ID: ${testChecklist.id})`);

    // Fetch in Coordinator workspace
    const coordList = await getCoordinatorChecklists({
      tab: 'pending',
      search: testChecklist.checklist_number,
    });

    assert(coordList.checklists && coordList.checklists.length > 0, 'Checklist should appear in Coordinator pending list');
    const matched = coordList.checklists.find((c) => c.id === testChecklist.id);
    assert(matched, 'Created checklist must be present in coordinator bookings list');

    // Verify all required information is visible to Coordinator
    assert.strictEqual(matched.checklist_number, testChecklist.checklist_number);
    assert.strictEqual(matched.client_name, testChecklist.client_name);
    assert.strictEqual(matched.client_location, 'Coimbatore Industrial Zone');
    assert.strictEqual(matched.google_maps_location, 'https://maps.google.com/?q=11.0168,76.9558');
    assert.strictEqual(matched.installation_or_service, 'Installation');
    assert.strictEqual(matched.service_engineer, 'Sakthivel');
    assert.strictEqual(matched.number_of_vehicles, 2);
    assert.strictEqual(matched.booking_status, 'PENDING');
    console.log('   [PASS] Criteria 1 & 2: Sales checklist successfully received with engineer, client, location, schedule, and maps link.');

    // --------------------------------------------------------------------------
    // Criterion 3: Coordinator can record bus and room booking details
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 3: Coordinator records bus and room booking details...');
    const bookingPayload = {
      booking_status: 'IN_PROGRESS',
      travel_required: true,
      travel_type: 'Bus',
      departure_city: 'Chennai',
      destination: 'Coimbatore',
      travel_datetime: '2026-11-19T22:30:00.000Z',
      ticket_reference: 'KPN-SLEEPER-9942',
      travel_notes: 'Boarding at Koyambedu Gate 4',
      accommodation_required: true,
      hotel_name: 'Coimbatore Grand Residency',
      check_in_date: '2026-11-20',
      check_out_date: '2026-11-22',
      number_of_rooms: 1,
      hotel_booking_reference: 'HOTEL-RES-7788',
      accommodation_notes: 'Breakfast included, near site',
      additional_personnel: 'None',
      coordinator_notes: 'Booked via RedBus and MakeMyTrip; sent to engineer on WhatsApp',
    };

    const savedBooking = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      bookingData: bookingPayload,
      user: testUserCoordinator,
    });

    assert(savedBooking, 'Booking should be saved');
    assert.strictEqual(savedBooking.booking_status, 'IN_PROGRESS');
    assert.strictEqual(savedBooking.departure_city, 'Chennai');
    assert.strictEqual(savedBooking.ticket_reference, 'KPN-SLEEPER-9942');
    assert.strictEqual(savedBooking.hotel_name, 'Coimbatore Grand Residency');
    assert.strictEqual(savedBooking.hotel_booking_reference, 'HOTEL-RES-7788');
    assert.strictEqual(savedBooking.number_of_rooms, 1);
    console.log('   [PASS] Criterion 3: Bus and room booking details recorded successfully.');

    // --------------------------------------------------------------------------
    // Criterion 5: Coordinator cannot complete booking while required arrangement is missing
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 5: Validating prevention of accidental completion with missing required arrangements...');
    
    // Incomplete booking: Travel is required but departure city is missing
    const incompleteBooking = {
      booking_status: 'COMPLETED',
      travel_required: true,
      departure_city: '', // MISSING!
      destination: 'Coimbatore',
      travel_datetime: '2026-11-19T22:30:00Z',
      accommodation_required: false,
    };

    let rejected = false;
    try {
      await saveCoordinatorBooking({
        checklistId: testChecklist.id,
        bookingData: incompleteBooking,
        user: testUserCoordinator,
      });
    } catch (err) {
      rejected = true;
      assert(err.message.includes('Departure city is required') || err.message.includes('Cannot complete'), 'Should reject incomplete travel');
      console.log(`   Incomplete booking properly rejected: "${err.message}"`);
    }
    assert(rejected, 'Should not allow COMPLETED status with missing travel details');

    // Incomplete booking 2: Accommodation is required but hotel name is missing
    rejected = false;
    try {
      await saveCoordinatorBooking({
        checklistId: testChecklist.id,
        bookingData: {
          booking_status: 'COMPLETED',
          travel_required: false,
          accommodation_required: true,
          hotel_name: '', // MISSING!
          check_in_date: '2026-11-20',
          check_out_date: '2026-11-21',
        },
        user: testUserCoordinator,
      });
    } catch (err) {
      rejected = true;
      assert(err.message.includes('Hotel / room booking name is required') || err.message.includes('Cannot complete'), 'Should reject incomplete hotel');
      console.log(`   Incomplete accommodation properly rejected: "${err.message}"`);
    }
    assert(rejected, 'Should not allow COMPLETED status with missing accommodation details');
    console.log('   [PASS] Criterion 5: Enforced strict validation preventing accidental completion when required arrangements are outstanding.');

    // --------------------------------------------------------------------------
    // Criterion 4: Travel or accommodation marked Not Required
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 4: Travel and accommodation marked Not Required...');
    const notRequiredBooking = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      bookingData: {
        booking_status: 'NOT_REQUIRED',
        travel_required: false,
        accommodation_required: false,
        coordinator_notes: 'Local job: client arranged local transit and hotel not required.',
      },
      user: testUserCoordinator,
    });
    assert.strictEqual(notRequiredBooking.booking_status, 'NOT_REQUIRED');
    assert.strictEqual(notRequiredBooking.travel_required, false);
    assert.strictEqual(notRequiredBooking.accommodation_required, false);
    console.log('   [PASS] Criterion 4: Successfully marked Not Required where appropriate.');

    // --------------------------------------------------------------------------
    // Criterion 6: Marking a booking Completed does NOT mark installation itself Completed
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 6: Verifying checklist installation_status is preserved when booking is COMPLETED...');
    const completedBooking = await saveCoordinatorBooking({
      checklistId: testChecklist.id,
      bookingData: {
        ...bookingPayload,
        booking_status: 'COMPLETED',
      },
      user: testUserCoordinator,
    });
    assert.strictEqual(completedBooking.booking_status, 'COMPLETED');

    // Inspect the underlying checklist record
    const checklistAfter = await getChecklistById(testChecklist.id);
    assert.strictEqual(
      checklistAfter.installation_status,
      testChecklist.installation_status,
      'Checklist installation_status MUST NOT be changed by coordinator booking status!'
    );
    console.log(`   Checklist installation_status remains: "${checklistAfter.installation_status}" (Booking: COMPLETED)`);
    console.log('   [PASS] Criterion 6: Booking completion is completely decoupled from installation completion.');

    // --------------------------------------------------------------------------
    // Criterion 7: Completed booking history remains accessible
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 7: Completed booking history remains accessible...');
    const completedList = await getCoordinatorChecklists({
      tab: 'completed',
      search: testChecklist.checklist_number,
    });
    assert(completedList.checklists && completedList.checklists.length > 0, 'Completed checklist must be in completed tab');
    const completedItem = completedList.checklists.find((c) => c.id === testChecklist.id);
    assert(completedItem, 'Checklist must be found in completed bookings');
    assert.strictEqual(completedItem.booking_status, 'COMPLETED');

    // Retrieve audit history
    const auditLogs = await getBookingAuditHistory(testChecklist.id);
    assert(Array.isArray(auditLogs) && auditLogs.length >= 3, 'Audit history must record state transitions');
    const hasStatusChanged = auditLogs.some((l) => l.action === 'STATUS_CHANGED' || l.action === 'CREATED');
    assert(hasStatusChanged, 'Audit log must record status changes');
    console.log(`   Retrieved ${auditLogs.length} audit trail records for this booking.`);
    console.log('   [PASS] Criterion 7: Completed booking history and audit trail remain accessible.');

    // --------------------------------------------------------------------------
    // Criterion 8 & 9: Backend authorization: Coordinator CANNOT mutate Sales checklists,
    // inventory, BOM, or technical reports
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 8 & 9: Backend authorization: Least-privilege role boundaries...');

    // Spin up Express test app with auth injection
    const testApp = express();
    testApp.use(express.json());

    // Middleware to simulate token with coordinator profile
    let activeTestUser = testUserCoordinator;
    testApp.use((req, res, next) => {
      req.user = activeTestUser;
      req.profile = activeTestUser;
      req.adminUser = activeTestUser;
      next();
    });

    testApp.use('/api/admin/coordinator', coordinatorRoutes);
    testApp.use('/api/admin/installations', installationRoutes);
    testApp.use('/api/admin/inventory', inventoryRoutes);
    testApp.use('/api/admin/bom', bomRoutes);

    const server = http.createServer(testApp);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    async function reqApi(method, path, body = null) {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`${baseUrl}${path}`, opts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    }

    // A. Coordinator CAN access Coordinator API
    const coordApiRes = await reqApi('GET', '/api/admin/coordinator/bookings');
    assert.strictEqual(coordApiRes.status, 200, 'Coordinator must have access to /coordinator/bookings');
    console.log('   [PASS] Coordinator successfully accesses /api/admin/coordinator/bookings (200 OK)');

    // B. Coordinator CANNOT create Sales checklists
    const createChecklistRes = await reqApi('POST', '/api/admin/installations', { client_name: 'Hack' });
    assert.strictEqual(createChecklistRes.status, 403, 'Coordinator must NOT create Sales checklists');
    console.log('   [PASS] Coordinator blocked from creating Sales checklists (403 Forbidden)');

    // C. Coordinator CANNOT modify Sales checklists or change engineer
    const updateChecklistRes = await reqApi('PUT', `/api/admin/installations/${testChecklist.id}`, { service_engineer: 'Guna' });
    assert.strictEqual(updateChecklistRes.status, 403, 'Coordinator must NOT edit Sales checklists');
    console.log('   [PASS] Coordinator blocked from editing Sales checklists (403 Forbidden)');

    // D. Coordinator CANNOT adjust inventory stock
    const adjustStockRes = await reqApi('POST', '/api/admin/inventory/adjust', { device_type: '4 Channel Live', quantity: 10 });
    assert.strictEqual(adjustStockRes.status, 403, 'Coordinator must NOT adjust inventory');
    console.log('   [PASS] Coordinator blocked from adjusting inventory (403 Forbidden)');

    // E. Coordinator CANNOT submit technical post-installation reports
    const techReportRes = await reqApi('POST', `/api/admin/installations/${testChecklist.id}/completion-report`, { items: [] });
    assert.strictEqual(techReportRes.status, 403, 'Coordinator must NOT submit technical reports');
    console.log('   [PASS] Coordinator blocked from submitting technical reports (403 Forbidden)');

    // F. Technical Team CANNOT access Coordinator booking APIs
    activeTestUser = testUserTech;
    const techAccessCoordRes = await reqApi('GET', '/api/admin/coordinator/bookings');
    assert.strictEqual(techAccessCoordRes.status, 403, 'Technical role must NOT access Coordinator APIs');
    console.log('   [PASS] Technical role blocked from Coordinator bookings (403 Forbidden)');

    server.close();
    console.log('   [PASS] Criteria 8 & 9: Strict backend authorization enforced across all routes.');

    // --------------------------------------------------------------------------
    // Criterion 10: Existing roles, workflows, and data remain intact
    // --------------------------------------------------------------------------
    console.log('\n-> Criterion 10: Verifying existing workflows and data integrity...');
    const intactChecklist = await getChecklistById(testChecklist.id);
    assert.strictEqual(intactChecklist.service_engineer, 'Sakthivel');
    assert.strictEqual(intactChecklist.number_of_devices, 2);
    assert.strictEqual(intactChecklist.device_type, '4 Channel Live');
    console.log('   [PASS] Criterion 10: Existing checklist data and relationships remain intact.');

    console.log('\n========================================================================');
    console.log('  ALL 10 ACCEPTANCE TEST CRITERIA PASSED SUCCESSFULLY!                  ');
    console.log('========================================================================');
  } finally {
    // Cleanup created test checklist
    if (testChecklist?.id) {
      try {
        const { default: supabase } = await import('../src/services/supabase.js');
        await supabase.from('installation_checklists').delete().eq('id', testChecklist.id);
        await supabase.from('coordinator_bookings').delete().eq('checklist_id', testChecklist.id);
        console.log(`Cleaned up test checklist ${testChecklist.id}`);
      } catch (e) {
        // ignore cleanup error
      }
    }
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ Acceptance test suite failed:', err);
  process.exit(1);
});
