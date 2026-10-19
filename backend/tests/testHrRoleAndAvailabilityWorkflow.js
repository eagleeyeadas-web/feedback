/**
 * testHrRoleAndAvailabilityWorkflow.js
 *
 * Comprehensive integration test suite for:
 * 1. HR Role authentication, provisioning, and least-privilege security.
 * 2. Role-based access control (non-HR roles blocked from HR endpoints, Coordinator blocked from approvals).
 * 3. Technician availability-date extension submission (notifies HR, NOT Coordinator).
 * 4. HR approval workflow (updates schedule, notifies Coordinator with exact text, logs history).
 * 5. HR rejection workflow (schedule untouched, technician notified, Coordinator NOT notified).
 * 6. Duplicate decision and submission prevention.
 * 7. HR manual availability controls (Mathi, Guna, Sakthivel, Kamalesh only).
 * 8. Manual Unavailable override blocking assignments.
 * 9. Manual Available override with hard job/leave conflict handling.
 * 10. Override reversal and calendar availability calculation.
 */

import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import config from '../src/config.js';
import supabase from '../src/services/supabase.js';
import {
  validateAuthorizedServiceEngineer,
  getTechnicianAvailabilityOverview,
  setTechnicianManualAvailability,
  reverseTechnicianManualAvailability,
  getActiveOverrideForEngineer,
} from '../src/services/hrAvailabilityService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  getScheduleRevisionHistory,
} from '../src/services/scheduleExtensionService.js';
import {
  createChecklist,
  getChecklistById,
} from '../src/services/installationService.js';
import {
  checkEngineerAvailability,
} from '../src/services/engineerBookingService.js';
import { submitInstallationCompletionReport } from '../src/services/workflowService.js';
import { getNotifications } from '../src/services/appNotificationService.js';

// Isolated auth client so tests do NOT mutate the singleton backend supabase client
const clientAuth = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const PORT = config.port || 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Helper: HTTP request
async function apiRequest(endpoint, method = 'GET', token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body && method !== 'GET' && method !== 'HEAD') {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

// Ensure Express server is running
import '../src/index.js';

console.log('========================================================================');
console.log('  TESTING HR ROLE & TECHNICIAN AVAILABILITY GOVERNANCE WORKFLOW       ');
console.log('========================================================================\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• ${name}... `);
      await fn();
      console.log('PASSED ✓');
      passed++;
    } catch (err) {
      console.log(`FAILED ✗\n  Error: ${err.message}`);
      if (err.stack) console.log(err.stack);
      failed++;
    }
  }

  // Tokens
  let hrToken = null;
  let coordToken = null;
  let techToken = null;
  let salesToken = null;

  const hrUser = {
    id: '5598cef6-0095-4403-a664-98d0f7666987',
    email: 'hr@gmail.com',
    role: 'HR',
    user_metadata: { name: 'HR Manager', role: 'HR' },
  };

  const coordUser = {
    id: '6532b157-cfa2-4c71-9e23-b8b0d81bf60d',
    email: 'coordinator@gmail.com',
    role: 'COORDINATOR',
    user_metadata: { name: 'Coordinator', role: 'COORDINATOR' },
  };

  const techUser = {
    id: 'abaff860-05b2-44fa-9139-b14d92e3fa19',
    email: 'tech@gmail.com',
    role: 'TECHNICAL',
    user_metadata: { name: 'Mathi', role: 'TECHNICAL' },
  };

  // Give server 600ms to bind port
  await new Promise((r) => setTimeout(r, 600));

  // --- SECTION 1: AUTHENTICATION & PROVISIONING ---
  await test('1.1 HR Account is provisioned in Supabase Auth with HR role', async () => {
    const { data: users, error } = await supabase.auth.admin.listUsers();
    assert(!error, `Failed to list users: ${error?.message}`);
    const hr = users.users.find((u) => u.email === 'hr@gmail.com');
    assert(hr, 'hr@gmail.com user must exist in Supabase auth');
    assert.strictEqual(hr.app_metadata?.role, 'HR', 'app_metadata.role must be HR');
    assert.strictEqual(hr.user_metadata?.role, 'HR', 'user_metadata.role must be HR');
  });

  await test('1.2 HR can authenticate with password and obtain HR session', async () => {
    const { data, error } = await clientAuth.auth.signInWithPassword({
      email: 'hr@gmail.com',
      password: process.env.HR_ACCOUNT_PASSWORD || 'hr@2026',
    });
    assert(!error, `HR signInWithPassword failed: ${error?.message}`);
    assert(data.session?.access_token, 'Session access token must be returned');
    hrToken = data.session.access_token;
  });

  await test('1.3 Also authenticate Coordinator, Sales, and Technical accounts', async () => {
    try {
      const coordRes = await clientAuth.auth.signInWithPassword({
        email: 'coordinator@gmail.com',
        password: process.env.COORDINATOR_ACCOUNT_PASSWORD || 'coord@2026',
      });
      if (coordRes.data?.session) coordToken = coordRes.data.session.access_token;
    } catch {
      console.warn('Coord auth fallback');
    }

    try {
      const salesRes = await clientAuth.auth.signInWithPassword({
        email: 'sales@gmail.com',
        password: process.env.SALES_ACCOUNT_PASSWORD || 'sales@2026',
      });
      if (salesRes.data?.session) salesToken = salesRes.data.session.access_token;
    } catch {
      console.warn('Sales auth fallback');
    }

    try {
      const techRes = await clientAuth.auth.signInWithPassword({
        email: 'tech@gmail.com',
        password: process.env.TECH_ACCOUNT_PASSWORD || 'tech@2026',
      });
      if (techRes.data?.session) techToken = techRes.data.session.access_token;
    } catch {
      console.warn('Tech auth fallback');
    }
  });

  // --- SECTION 2: ACCESS CONTROL & PERMISSION BOUNDARIES ---
  await test('2.1 Unauthenticated requests to /api/hr/availability are rejected with 401', async () => {
    const res = await apiRequest('/api/hr/availability');
    assert.strictEqual(res.status, 401, 'Expected 401 Unauthorized');
  });

  await test('2.2 HR token grants access to /api/hr/availability and /api/hr/extensions', async () => {
    if (!hrToken) throw new Error('HR token not available');
    const res = await apiRequest('/api/hr/availability', 'GET', hrToken);
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(Array.isArray(res.data.engineers), 'Expected engineers array');
    assert.strictEqual(res.data.engineers.length, 4, 'Expected exactly 4 authorized engineers');

    const extRes = await apiRequest('/api/hr/extensions', 'GET', hrToken);
    assert.strictEqual(extRes.status, 200, 'Expected 200 OK on HR extensions endpoint');
  });

  await test('2.3 Non-HR roles (Technical/Sales) are blocked with 403 on HR endpoints', async () => {
    if (techToken) {
      const res = await apiRequest('/api/hr/availability', 'GET', techToken);
      assert.strictEqual(res.status, 403, 'Technical role must be blocked with 403 Forbidden from HR endpoints');
    }
    if (salesToken) {
      const res = await apiRequest('/api/hr/availability', 'GET', salesToken);
      assert.strictEqual(res.status, 403, 'Sales role must be blocked with 403 Forbidden from HR endpoints');
    }
  });

  await test('2.4 HR token is blocked from unrelated financial/quotation deletion actions', async () => {
    if (!hrToken) throw new Error('HR token not available');
    const res = await apiRequest('/api/admin/quotations/delete-all', 'DELETE', hrToken, { confirmCount: 1 });
    assert.strictEqual(res.status, 403, 'HR should not be permitted to perform quotation management actions');
  });

  // --- SECTION 3: HR MANUAL AVAILABILITY CONTROLS ---
  let createdOverrideId = null;

  await test('3.1 Only the 4 authorized engineers (Mathi, Guna, Sakthivel, Kamalesh) are permitted', async () => {
    assert.doesNotThrow(() => validateAuthorizedServiceEngineer('Mathi'));
    assert.doesNotThrow(() => validateAuthorizedServiceEngineer('Guna'));
    assert.doesNotThrow(() => validateAuthorizedServiceEngineer('Sakthivel'));
    assert.doesNotThrow(() => validateAuthorizedServiceEngineer('Kamalesh'));

    assert.throws(
      () => validateAuthorizedServiceEngineer('UnauthorizedTech'),
      /authorized service engineers/
    );
  });

  await test('3.2 HR sets manual availability to Unavailable for Mathi with reason & confirmation', async () => {
    const override = await setTechnicianManualAvailability({
      engineer_name: 'Mathi',
      manual_status: 'Unavailable',
      reason: 'Medical checkup and personal emergency',
      effective_start_datetime: '2029-05-01T09:00:00Z',
      effective_end_datetime: '2029-05-03T18:00:00Z',
      confirmation: true,
      user: hrUser,
    });

    assert(override, 'Override record must be created');
    assert.strictEqual(override.engineer_name, 'Mathi');
    assert.strictEqual(override.manual_status, 'Unavailable');
    assert.strictEqual(override.is_active, true);
    createdOverrideId = override.id;

    // Verify active override lookup
    const active = await getActiveOverrideForEngineer('Mathi', '2029-05-02');
    assert(active, 'Active override must be detected on 2029-05-02');
    assert.strictEqual(active.manual_status, 'Unavailable');
  });

  await test('3.3 Unavailable manual override blocks new conflicting job assignments during override period', async () => {
    const availability = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: '2029-05-02',
      endDate: '2029-05-02',
    });
    assert.strictEqual(availability.available, false, 'Engineer Mathi must be unavailable on 2029-05-02');
    assert(
      availability.reasons?.some((r) => r.includes('HR manual availability override') || r.includes('HR_MANUAL_OVERRIDE') || r.includes('Unavailable by HR')) ||
        availability.message?.includes('Unavailable by HR') ||
        availability.conflict?.type === 'HR_MANUAL_OVERRIDE',
      `Expected HR override reason, got: ${JSON.stringify(availability.reasons)}`
    );
  });

  await test('3.4 Manual Available override does NOT silently erase active job conflict', async () => {
    // Dynamic future date to prevent repeat collision across test runs
    const conflictDate = `2033-04-${String(Math.floor(Math.random() * 18) + 10).padStart(2, '0')}`;
    const chk = await createChecklist(uuidv4(), {
      client_name: 'Conflict Test Client',
      client_mobile: '9999988888',
      client_location: 'Coimbatore',
      service_engineer: 'Sakthivel',
      expected_arrival_date: conflictDate,
      installation_duration: '1 Day',
      installation_status: 'Assigned',
    });

    // HR attempts to set Sakthivel to Available on conflictDate
    const result = await setTechnicianManualAvailability({
      engineer_name: 'Sakthivel',
      manual_status: 'Available',
      reason: 'Special client request',
      effective_start_datetime: `${conflictDate}T09:00:00Z`,
      confirmation: true,
      user: hrUser,
    });

    assert(result, 'Result should be returned');
    assert.strictEqual(result.engineer_name, 'Sakthivel');
    assert.strictEqual(result.is_schedulable, false, 'Must NOT be schedulable because hard conflict exists');
    assert(result.active_conflicts?.length > 0, 'Active conflict details must be clearly explained');
    assert(
      result.active_conflicts.some((c) => c.checklist_id === chk.id || c.type === 'JOB_ASSIGNMENT'),
      'The active job commitment must be retained and not cleared'
    );
  });

  await test('3.5 HR reverses manual override, restoring calculated availability', async () => {
    if (!createdOverrideId) throw new Error('No override id');
    const reversed = await reverseTechnicianManualAvailability(
      createdOverrideId,
      'Emergency resolved, technician returned early',
      hrUser
    );

    assert.strictEqual(reversed.is_active, false, 'Override must be deactivated');
    assert.strictEqual(reversed.reversal_reason, 'Emergency resolved, technician returned early');
    assert.strictEqual(reversed.reversed_by, hrUser.email);

    // After reversal, Mathi is no longer blocked by the manual override
    const active = await getActiveOverrideForEngineer('Mathi', '2029-05-02');
    assert(!active, 'No active override should remain for Mathi on 2029-05-02');
  });

  // --- SECTION 4: TECHNICIAN EXTENSION WORKFLOW & NOTIFICATIONS ---
  let testChecklist1 = null;
  let testChecklist2 = null;
  let extensionRequest1 = null;
  let extensionRequest2 = null;

  // Use dynamic unique year (between 2040 and 2090) so repeat test runs never collide on dates
  const testYear = 2040 + Math.floor(Math.random() * 50);
  const chk1Arrival = `${testYear}-08-10`;
  const chk1InitialEnd = `${testYear}-08-12`; // 3 Days: Aug 10, 11, 12 inclusive
  const chk1ExtendedDate = `${testYear}-08-15`;
  const chk1NextDay = `${testYear}-08-16`;

  const chk2Arrival = `${testYear}-08-20`;
  const chk2InitialEnd = `${testYear}-08-22`; // 3 Days: Aug 20, 21, 22 inclusive
  const chk2RequestedDate = `${testYear}-08-25`;

  await test('4.1 Create test checklists for extension workflow', async () => {
    testChecklist1 = await createChecklist(uuidv4(), {
      client_name: 'HR Approval Test Transport',
      client_mobile: '9888877777',
      client_location: 'Salem Hub',
      service_engineer: 'Mathi',
      expected_arrival_date: chk1Arrival,
      installation_duration: '3 Days', // Work ends Aug 12 inclusive -> earliest avail Aug 13
      installation_status: 'In Progress',
    });
    assert(testChecklist1?.id, 'Checklist 1 must be created');

    testChecklist2 = await createChecklist(uuidv4(), {
      client_name: 'HR Rejection Test Transport',
      client_mobile: '9888866666',
      client_location: 'Madurai Depot',
      service_engineer: 'Sakthivel',
      expected_arrival_date: chk2Arrival,
      installation_duration: '3 Days', // Work ends Aug 22 inclusive -> earliest avail Aug 23
      installation_status: 'In Progress',
    });
    assert(testChecklist2?.id, 'Checklist 2 must be created');
  });

  await test('4.2 Technician submits extension request: status PENDING, notifies HR (NOT Coordinator)', async () => {
    const ext = await requestScheduleExtension({
      checklistId: testChecklist1.id,
      requestedCompletionDate: chk1ExtendedDate, // Extend work through Aug 15
      reason: 'Installation taking longer than expected',
      notes: 'Customer added 3 additional vehicle sensors',
      user: techUser,
    });

    assert(ext, 'Extension request must be created');
    assert.strictEqual(ext.status, 'PENDING');
    assert.strictEqual(ext.requested_completion_date, chk1ExtendedDate);
    extensionRequest1 = ext;

    // Check notifications: must have notification for HR, NOT Coordinator
    const hrNotifs = await getNotifications({ role: 'HR' });
    const hrNotif = (hrNotifs || []).find((n) =>
      n.message?.includes(testChecklist1.checklist_number) || n.title?.includes(testChecklist1.checklist_number)
    );
    assert(hrNotif, 'HR must receive notification for pending extension');

    // Coordinator must NOT receive pending extension notification
    const coordNotifs = await getNotifications({ role: 'COORDINATOR' });
    const misleadingCoord = (coordNotifs || []).filter((n) =>
      (n.message?.includes(testChecklist1.checklist_number) || n.title?.includes(testChecklist1.checklist_number)) &&
      (n.message?.includes('Pending') || n.title?.includes('Pending'))
    );
    assert.strictEqual(
      misleadingCoord.length,
      0,
      'Coordinator must NOT receive notification of pending technician extension requests'
    );
  });

  await test('4.3 Duplicate extension request submission is prevented', async () => {
    await assert.rejects(
      async () => {
        await requestScheduleExtension({
          checklistId: testChecklist1.id,
          requestedCompletionDate: `${testYear}-08-16`,
          reason: 'Duplicate attempt',
          user: techUser,
        });
      },
      /already pending review/i
    );
  });

  await test('4.4 Coordinator role is FORBIDDEN from approving extension requests', async () => {
    // Calling approveScheduleExtension with COORDINATOR role must fail
    await assert.rejects(
      async () => {
        await approveScheduleExtension(
          extensionRequest1.id,
          coordUser,
          'Coordinator should not be able to approve'
        );
      },
      /Permission Denied: Only authorized HR or Admin/
    );
  });

  await test('4.5 HR approves extension: updates schedule, logs history, notifies Coordinator with exact text', async () => {
    const approved = await approveScheduleExtension(
      extensionRequest1.id,
      hrUser,
      'Approved: Additional sensors confirmed with client'
    );

    assert.strictEqual(approved.status, 'APPROVED');
    assert.strictEqual(approved.reviewed_by, hrUser.email);

    // Verify official checklist schedule updated
    const updatedChk = await getChecklistById(testChecklist1.id);
    assert.strictEqual(
      updatedChk.current_booking_end_date,
      chk1ExtendedDate,
      `current_booking_end_date must be updated to ${chk1ExtendedDate}`
    );

    // Verify Coordinator receives notification with exact required text
    const coordNotifs = await getNotifications({ role: 'COORDINATOR' });
    const matchNotif = (coordNotifs || []).find((n) =>
      n.message?.includes('Date Extended — Review Room Booking and Travel Arrangements.')
    );

    assert(
      matchNotif,
      'Coordinator must receive notification with exact text: "Date Extended — Review Room Booking and Travel Arrangements."'
    );
    assert(
      matchNotif.message.includes('Mathi') && matchNotif.message.includes(testChecklist1.checklist_number),
      'Notification must include technician name and checklist number'
    );
    assert(
      matchNotif.action_url?.includes('/coordinator') ||
        matchNotif.metadata?.action_url?.includes('/coordinator') ||
        matchNotif.metadata?.booking_url?.includes('/coordinator'),
      'Notification must contain direct link to booking management screen'
    );

    // Verify revision history was recorded
    const history = await getScheduleRevisionHistory(testChecklist1.id);
    assert(history.length > 0, 'Schedule revision history must be recorded');
    assert.strictEqual(history[0].new_completion_date, chk1ExtendedDate);
    assert.strictEqual(history[0].action, 'APPROVED');
  });

  await test('4.6 Duplicate decision on already approved request is rejected', async () => {
    await assert.rejects(
      async () => {
        await approveScheduleExtension(extensionRequest1.id, hrUser, 'Duplicate approve attempt');
      },
      /already been reviewed|already APPROVED/i
    );
  });

  // --- SECTION 5: HR REJECTION WORKFLOW ---
  await test('5.1 Technician submits second extension request for Checklist 2', async () => {
    const ext = await requestScheduleExtension({
      checklistId: testChecklist2.id,
      requestedCompletionDate: chk2RequestedDate,
      reason: 'Travel delay',
      notes: 'Bus delayed',
      user: techUser,
    });
    assert(ext, 'Second extension request created');
    extensionRequest2 = ext;
  });

  await test('5.2 HR rejects extension: schedule remains unchanged, technician notified, Coordinator NOT notified', async () => {
    const rejected = await rejectScheduleExtension(
      extensionRequest2.id,
      hrUser,
      'Site management confirmed standard slot must be honored'
    );

    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.reviewed_by, hrUser.email);
    assert.strictEqual(rejected.decision_notes, 'Site management confirmed standard slot must be honored');

    // Official schedule remains unchanged (still chk2InitialEnd)
    const chk = await getChecklistById(testChecklist2.id);
    assert.strictEqual(
      chk.current_booking_end_date,
      chk2InitialEnd,
      'Official schedule must remain unchanged on rejection'
    );

    // Technician receives rejection notification
    const techNotifs = await getNotifications({ role: 'TECHNICAL' });
    const techMatch = (techNotifs || []).find((n) =>
      n.message?.includes(testChecklist2.checklist_number) && n.message?.toLowerCase().includes('rejected')
    );
    assert(techMatch, 'Technician must be notified of rejection and reason');

    // Coordinator does NOT receive "Date Extended" notification
    const coordNotifs = await getNotifications({ role: 'COORDINATOR' });
    const misleading = (coordNotifs || []).filter((n) =>
      n.message?.includes(testChecklist2.checklist_number) &&
      n.message?.includes('Date Extended — Review Room Booking and Travel Arrangements.')
    );
    assert.strictEqual(
      misleading.length,
      0,
      'Coordinator must NOT receive misleading Date Extended notification when request is rejected'
    );
  });

  // --- SECTION 6: CALENDAR INCLUSIVE WORKING DATES & ACTUAL COMPLETION ---
  await test('6.1 Inclusive working dates rule: job ending Aug 15 blocks engineer through Aug 15; earliest avail Aug 16', async () => {
    // For Checklist 1 (Mathi), work was extended through chk1ExtendedDate.
    // Earliest availability is chk1NextDay (chk1ExtendedDate + 1 day).
    const availAug15 = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: chk1ExtendedDate,
      duration: '1 Day',
    });
    assert.strictEqual(
      availAug15.available,
      false,
      `Mathi must NOT be available on final working day ${chk1ExtendedDate} (working day is inclusive)`
    );

    const availAug16 = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: chk1NextDay,
      duration: '1 Day',
    });
    assert.strictEqual(
      availAug16.available,
      true,
      `Mathi earliest normal availability date must be ${chk1NextDay} (scheduled end date + 1 day)`
    );
  });

  await test('6.2 Incomplete job blocks engineer even if planned end date passed', async () => {
    // Check Kamalesh's availability on today (2026-10-17) where an overdue incomplete installation exists
    const avail = await checkEngineerAvailability({
      engineerIdOrName: 'Kamalesh',
      startDate: '2026-10-17',
      duration: '1 Day',
    });
    assert.strictEqual(
      avail.available,
      false,
      'Incomplete job must block engineer availability even after planned end date has passed'
    );
    assert(
      avail.conflict && (avail.conflict.status === 'OVERDUE' || avail.conflict.checklist_number || avail.conflict.checklist_id),
      'Availability check must note incomplete job commitment'
    );
  });

  await test('6.3 Return ticket booking task is triggered on post-installation submission without duplicates', async () => {
    // Submit completion report for testChecklist1
    await submitInstallationCompletionReport({
      checklist_id: testChecklist1.id,
      user: techUser,
      actual_completion_datetime: `${chk1ExtendedDate}T18:00:00Z`,
      items: [{ device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0 }],
      material_items: [],
      completion_status: 'Completed',
    });

    // Verify Coordinator receives return-ticket booking task
    const coordNotifs = await getNotifications({ role: 'COORDINATOR' });
    const returnTask = (coordNotifs || []).find((n) =>
      (n.message?.toLowerCase().includes('return ticket') || n.title?.toLowerCase().includes('return ticket')) &&
      n.message?.includes(testChecklist1.checklist_number)
    );
    assert(returnTask, 'Coordinator must receive return-ticket booking notification upon completion');

    // Calling again does not generate duplicate notification
    const countBefore = (await getNotifications({ role: 'COORDINATOR' })).filter((n) =>
      (n.message?.toLowerCase().includes('return ticket') || n.title?.toLowerCase().includes('return ticket')) &&
      n.message?.includes(testChecklist1.checklist_number)
    ).length;

    await submitInstallationCompletionReport({
      checklist_id: testChecklist1.id,
      user: techUser,
      actual_completion_datetime: `${chk1ExtendedDate}T18:00:00Z`,
      items: [{ device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0 }],
      material_items: [],
      completion_status: 'Completed',
    });

    const countAfter = (await getNotifications({ role: 'COORDINATOR' })).filter((n) =>
      (n.message?.toLowerCase().includes('return ticket') || n.title?.toLowerCase().includes('return ticket')) &&
      n.message?.includes(testChecklist1.checklist_number)
    ).length;

    assert.strictEqual(countAfter, countBefore, 'Duplicate return-ticket tasks must be prevented');
  });

  console.log('\n========================================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled fatal error during test run:', err);
  process.exit(1);
});
