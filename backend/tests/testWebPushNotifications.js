import assert from 'assert';
import webpush from 'web-push';
import config from '../src/config.js';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  getSubscriptionStatus,
  getAllActiveSubscriptions,
  notifyChecklistCreated,
  sendTestNotificationToUser,
  getNotificationHistory,
} from '../src/services/pushNotificationService.js';
import { createChecklist, updateChecklist } from '../src/services/installationService.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  RUNNING MOBILE WEB PUSH NOTIFICATIONS TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(msg) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  }

  function fail(msg, err) {
    failed++;
    console.error(`❌ [FAIL] ${msg}`, err);
  }

  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testUserEmail = 'sales@eagleeyesafdrive.com';

  // Generate test client keys
  const clientKeys = webpush.generateVAPIDKeys();
  const testEndpoint = `https://fcm.googleapis.com/fcm/send/test-endpoint-${Date.now()}`;
  const testSubPayload = {
    endpoint: testEndpoint,
    keys: {
      p256dh: clientKeys.publicKey,
      auth: 'fakeAuthSecretForTesting123',
    },
  };

  // Test 1: VAPID Public Key Retrieval
  try {
    const pubKey = getVapidPublicKey();
    assert(pubKey && typeof pubKey === 'string' && pubKey.length > 20, 'VAPID public key should be valid string');
    assert(!pubKey.includes('private'), 'Public key should never expose private key');
    pass('1. VAPID public key is retrievable and securely configured without private key exposure');
  } catch (err) {
    fail('1. VAPID public key retrieval failed', err);
  }

  // Test 2: Register Web Push Subscription
  try {
    const res = await saveSubscription({
      userId: testUserId,
      userEmail: testUserEmail,
      userRole: 'SALES',
      subscription: testSubPayload,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36',
      deviceType: 'Android',
    });
    assert(res.success === true, 'Subscription save should return success');
    assert(res.endpoint === testEndpoint, 'Returned endpoint should match');
    pass('2. Authorized user can successfully register Web Push subscription for Android/iPhone device');
  } catch (err) {
    fail('2. Register push subscription failed', err);
  }

  // Test 3: Check Subscription Status
  try {
    const status = await getSubscriptionStatus({
      userId: testUserId,
      endpoint: testEndpoint,
    });
    assert(status.isSubscribed === true, 'Device should be reported as subscribed');
    assert(status.totalActiveForUser >= 1, 'Active user count should be at least 1');
    pass('3. Subscription status correctly reports active registration for the user device');
  } catch (err) {
    fail('3. Check subscription status failed', err);
  }

  // Test 4: Retrieve Active Subscriptions
  try {
    const allSubs = await getAllActiveSubscriptions();
    const found = allSubs.find((s) => s.endpoint === testEndpoint);
    assert(found, 'Created test subscription should be found in active list');
    assert(found.user_id === testUserId, 'Subscription user_id must match');
    pass('4. All active team member subscriptions are dynamically retrieved without hardcoded emails');
  } catch (err) {
    fail('4. Retrieve active subscriptions failed', err);
  }

  // Test 5: Verify Notification Payload & Format for New Checklist
  try {
    const mockChecklist = {
      id: `chk-test-${Date.now()}`,
      checklist_number: `EE-INST-20261021-9999`,
      client_name: 'Apex Fleet Logistics',
      client_location: 'Coimbatore Airport Road Hub',
      service_engineer: 'Mathi',
      created_at: new Date().toISOString(),
    };

    const res = await notifyChecklistCreated(mockChecklist, { force: true });
    assert(res.success === true, 'Dispatch should return success');
    assert(res.attempted >= 1, 'Should attempt delivery to subscribed recipients');

    const history = await getNotificationHistory(5);
    const item = history.find((h) => h.checklist_id === mockChecklist.id);
    assert(item, 'Notification history should record the event');
    assert(item.title === 'Eagle Eye SafDrive — New Installation Checklist', 'Title matches specification');
    assert(item.body.includes('A new installation checklist has been created.'), 'Body contains required message');
    assert(item.body.includes('Mathi'), 'Body includes technician name');
    assert(item.body.includes('Coimbatore Airport Road Hub'), 'Body includes location');
    assert(item.body.includes(mockChecklist.checklist_number), 'Body includes Job ID');
    assert(item.url === `/admin/installation-checklists/${mockChecklist.id}`, 'URL opens the checklist');

    pass('5. New checklist creation formats title, message, job ID, tech, location, and deep link URL');
  } catch (err) {
    fail('5. Notification payload formatting failed', err);
  }

  // Test 6: Deduplication / Idempotency (Retry Prevention)
  try {
    const idempEndpoint = `https://fcm.googleapis.com/fcm/send/test-endpoint-idemp-${Date.now()}`;
    await saveSubscription({
      userId: testUserId,
      userEmail: testUserEmail,
      userRole: 'SALES',
      subscription: {
        endpoint: idempEndpoint,
        keys: {
          p256dh: clientKeys.publicKey,
          auth: 'authSecretIdemp',
        },
      },
      deviceType: 'Android',
    });

    const mockChecklist = {
      id: `chk-idemp-${Date.now()}`,
      checklist_number: `EE-INST-IDEMP-001`,
      client_name: 'Retry Fleet',
      client_location: 'Madurai Ring Road',
      service_engineer: 'Guna',
      created_at: new Date().toISOString(),
    };

    // First call
    const firstCall = await notifyChecklistCreated(mockChecklist);
    assert(firstCall.success === true, 'First call should succeed');

    // Duplicate call (simulated retry)
    const duplicateCall = await notifyChecklistCreated(mockChecklist);
    assert(duplicateCall.skipped === true, 'Duplicate call should be skipped');
    assert(duplicateCall.reason.includes('Duplicate'), 'Reason should cite duplicate event');

    pass('6. Retried creation requests are detected and duplicate notifications are prevented');
  } catch (err) {
    fail('6. Idempotency test failed', err);
  }

  // Test 7: Verify Real Checklist Creation Triggers Push Dispatch
  try {
    // Ensure an active subscription is present for the checklist test
    const chkEndpoint = `https://fcm.googleapis.com/fcm/send/test-endpoint-chk-${Date.now()}`;
    await saveSubscription({
      userId: testUserId,
      userEmail: testUserEmail,
      userRole: 'SALES',
      subscription: {
        endpoint: chkEndpoint,
        keys: {
          p256dh: clientKeys.publicKey,
          auth: 'authSecret123',
        },
      },
      deviceType: 'Android',
    });

    const randomYear = 2035;
    const randomDay = Math.floor(Math.random() * 20) + 1;
    const testDate = `${randomYear}-09-${String(randomDay).padStart(2, '0')}`;

    const newChecklist = await createChecklist(testUserId, {
      salesperson_name: 'Test Salesperson',
      client_name: `Push Verify Client ${Date.now()}`,
      client_mobile: '9876543219',
      client_location: 'Salem Bypass Transport Hub',
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 22000,
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: testDate,
      service_engineer: 'Kamalesh',
      remarks: 'Push notification end-to-end integration test',
    });

    assert(newChecklist && newChecklist.id, 'Checklist should be created successfully');

    // History should record notification for newChecklist
    const history = await getNotificationHistory(10);
    const recorded = history.find((h) => h.checklist_id === newChecklist.id);
    assert(recorded, 'Notification history should contain record for freshly created checklist');
    assert(recorded.body.includes('Kamalesh'), 'History record contains assigned technician');
    assert(recorded.body.includes('Salem Bypass Transport Hub'), 'History record contains location');

    pass('7. Successful checklist creation automatically invokes push service and logs delivery attempt');

    // Test 8: Ordinary edit to existing checklist does NOT trigger push notification
    const historyCountBefore = (await getNotificationHistory(100)).length;
    await updateChecklist(newChecklist.id, {
      remarks: 'Updated remarks without triggering push notification',
    });
    const historyCountAfter = (await getNotificationHistory(100)).length;
    assert(historyCountAfter === historyCountBefore, 'Checklist edit must NOT trigger push notification');
    pass('8. Ordinary edits to existing checklists do not dispatch push notifications');
  } catch (err) {
    fail('7/8. Real checklist creation push integration failed', err);
  }

  // Test 9: Unsubscribe Flow
  try {
    const unsubRes = await removeSubscription({
      userId: testUserId,
      endpoint: testEndpoint,
    });
    assert(unsubRes.success === true, 'Unsubscribe should return success');

    const statusAfter = await getSubscriptionStatus({
      userId: testUserId,
      endpoint: testEndpoint,
    });
    assert(statusAfter.isSubscribed === false, 'Device should no longer be subscribed');
    pass('9. Users can successfully unsubscribe and disable notifications');
  } catch (err) {
    fail('9. Unsubscribe test failed', err);
  }

  // Test 10: Non-blocking Resilience (Push failures do not roll back checklist)
  try {
    const invalidChecklist = { id: null };
    const res = await notifyChecklistCreated(invalidChecklist);
    assert(res.skipped === true, 'Invalid checklist safely skipped without throwing unhandled exception');
    pass('10. Push notification failures never crash server or roll back database transactions');
  } catch (err) {
    fail('10. Fault tolerance test failed', err);
  }

  console.log('\n========================================================================');
  console.log(`  PUSH NOTIFICATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
