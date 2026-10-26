import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import supabase from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBS_STORAGE_FILE = path.join(__dirname, '../data/push_subscriptions_storage.json');
const HISTORY_STORAGE_FILE = path.join(__dirname, '../data/push_notification_history_storage.json');

// Initialize Web Push VAPID configuration
try {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
  console.log('[PUSH_SERVICE] Web Push VAPID configured successfully');
} catch (err) {
  console.error('[PUSH_SERVICE] Failed to configure Web Push VAPID:', err.message);
}

export const inMemorySubscriptions = new Map(); // endpoint -> subscription record
export const inMemoryHistory = [];
export const processedEventIds = new Set();

/**
 * Load fallback JSON storage
 */
function loadStorage() {
  try {
    if (fs.existsSync(SUBS_STORAGE_FILE)) {
      const raw = fs.readFileSync(SUBS_STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.subscriptions)) {
        data.subscriptions.forEach((sub) => {
          if (sub.endpoint && sub.is_active !== false) {
            inMemorySubscriptions.set(sub.endpoint, sub);
          }
        });
      }
    }
  } catch (err) {
    console.warn('[PUSH_SERVICE] Could not load push subscriptions fallback:', err.message);
  }

  try {
    if (fs.existsSync(HISTORY_STORAGE_FILE)) {
      const raw = fs.readFileSync(HISTORY_STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.history)) {
        data.history.forEach((h) => {
          inMemoryHistory.push(h);
          if (h.event_id) processedEventIds.add(h.event_id);
        });
      }
    }
  } catch (err) {
    console.warn('[PUSH_SERVICE] Could not load push history fallback:', err.message);
  }
}

/**
 * Save subscriptions fallback JSON
 */
function saveSubscriptionsStorage() {
  try {
    const dir = path.dirname(SUBS_STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      subscriptions: Array.from(inMemorySubscriptions.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(SUBS_STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[PUSH_SERVICE] Could not save push subscriptions fallback:', err.message);
  }
}

/**
 * Save history fallback JSON
 */
function saveHistoryStorage() {
  try {
    const dir = path.dirname(HISTORY_STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      history: inMemoryHistory.slice(-200), // Keep latest 200 history items
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(HISTORY_STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[PUSH_SERVICE] Could not save push history fallback:', err.message);
  }
}

loadStorage();

/**
 * Get VAPID public key
 */
export function getVapidPublicKey() {
  return config.vapid.publicKey;
}

/**
 * Determine the canonical application base URL for generating absolute push notification links.
 * Avoids hardcoded localhost in production and respects deployment environment settings.
 */
export function getNotificationBaseUrl() {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  
  const corsOrigin = config.cors?.origin;
  if (corsOrigin && typeof corsOrigin === 'string' && !corsOrigin.includes('localhost') && !corsOrigin.includes('127.0.0.1')) {
    return corsOrigin.replace(/\/+$/, '');
  }

  // Canonical production deployment URL for SafDrive
  return 'https://eagleeyesafdrive.vercel.app';
}

/**
 * Format a canonical hash-based absolute URL for push notifications.
 * e.g. "/admin/installation-checklists/uuid" -> "https://eagleeyesafdrive.vercel.app/#/admin/installation-checklists/uuid"
 */
export function buildNotificationUrl(relativePath) {
  const baseUrl = getNotificationBaseUrl();
  const cleanPath = (relativePath || '/').replace(/^\/+/, '').replace(/^#\/?/, '');
  return `${baseUrl}/#/${cleanPath}`;
}

/**
 * Save or update a Web Push subscription
 */
export async function saveSubscription({
  userId,
  userEmail = null,
  userRole = null,
  subscription,
  userAgent = null,
  deviceType = 'Other',
}) {
  if (!userId) {
    throw new Error('User ID is required to save a push subscription');
  }

  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('Invalid Web Push subscription payload. Missing endpoint or keys.');
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const authKey = subscription.keys.auth;

  const now = new Date().toISOString();
  const subRecord = {
    id: inMemorySubscriptions.get(endpoint)?.id || uuidv4(),
    user_id: userId,
    user_email: userEmail,
    user_role: userRole,
    endpoint,
    p256dh,
    auth: authKey,
    user_agent: userAgent || null,
    device_type: deviceType || 'Other',
    is_active: true,
    created_at: inMemorySubscriptions.get(endpoint)?.created_at || now,
    updated_at: now,
    last_used_at: now,
  };

  // 1. Try persisting in Supabase
  try {
    const { data: dbData, error } = await supabase
      .from('push_subscriptions')
      .upsert(subRecord, { onConflict: 'endpoint' })
      .select()
      .maybeSingle();

    if (!error && dbData) {
      subRecord.id = dbData.id;
    }
  } catch (err) {
    // Graceful fallback to in-memory/JSON storage
  }

  // 2. Persist in fallback store
  inMemorySubscriptions.set(endpoint, subRecord);
  saveSubscriptionsStorage();

  console.log(`[PUSH_SERVICE] Push subscription registered for user ${userEmail || userId} (${deviceType})`);
  return { success: true, id: subRecord.id, endpoint: subRecord.endpoint };
}

/**
 * Remove a Web Push subscription
 */
export async function removeSubscription({ userId = null, endpoint }) {
  if (!endpoint) return { success: false, message: 'Endpoint is required' };

  try {
    let query = supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (userId) {
      query = query.eq('user_id', userId);
    }
    await query;
  } catch (err) {
    // Non-blocking
  }

  if (inMemorySubscriptions.has(endpoint)) {
    inMemorySubscriptions.delete(endpoint);
    saveSubscriptionsStorage();
  }

  return { success: true };
}

/**
 * Check subscription status for a user/device endpoint
 */
export async function getSubscriptionStatus({ userId, endpoint = null }) {
  let isSubscribed = false;
  if (endpoint && inMemorySubscriptions.has(endpoint)) {
    const s = inMemorySubscriptions.get(endpoint);
    if (s.user_id === userId && s.is_active) {
      isSubscribed = true;
    }
  }

  let totalActiveForUser = 0;
  inMemorySubscriptions.forEach((s) => {
    if (s.user_id === userId && s.is_active) {
      totalActiveForUser++;
    }
  });

  return {
    isSubscribed,
    totalActiveForUser,
    totalSystemActive: inMemorySubscriptions.size,
  };
}

/**
 * Retrieve all active push subscriptions for team members
 */
export async function getAllActiveSubscriptions() {
  const mergedMap = new Map();

  // Try DB first
  try {
    const { data: dbData, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('is_active', true);

    if (!error && Array.isArray(dbData)) {
      dbData.forEach((s) => {
        mergedMap.set(s.endpoint, s);
      });
    }
  } catch (err) {
    // Non-blocking
  }

  // Merge with fallback store
  inMemorySubscriptions.forEach((s, ep) => {
    if (s.is_active && !mergedMap.has(ep)) {
      mergedMap.set(ep, s);
    }
  });

  return Array.from(mergedMap.values());
}

/**
 * Send a single Web Push notification to a subscription
 */
export async function sendPushNotification(subRecord, payload) {
  const pushSubscription = {
    endpoint: subRecord.endpoint,
    keys: {
      p256dh: subRecord.p256dh,
      auth: subRecord.auth,
    },
  };

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    const result = await webpush.sendNotification(pushSubscription, payloadString, {
      TTL: 86400, // 24 hours
      urgency: 'high',
    });

    // Update last_used_at
    subRecord.last_used_at = new Date().toISOString();
    inMemorySubscriptions.set(subRecord.endpoint, subRecord);

    return {
      success: true,
      statusCode: result.statusCode,
      endpoint: subRecord.endpoint,
      userId: subRecord.user_id,
    };
  } catch (err) {
    const statusCode = err.statusCode || 0;
    const isExpired = statusCode === 404 || statusCode === 410 ||
      err.message?.includes('expired') ||
      err.message?.includes('not registered') ||
      err.message?.includes('unsubscribed');

    if (isExpired) {
      console.log(`[PUSH_SERVICE] Deactivating expired subscription for ${subRecord.user_email || subRecord.user_id} (${statusCode})`);
      removeSubscription({ endpoint: subRecord.endpoint }).catch(() => {});
    }

    return {
      success: false,
      statusCode,
      expired: isExpired,
      error: err.message,
      endpoint: subRecord.endpoint,
      userId: subRecord.user_id,
    };
  }
}

/**
 * Trigger Web Push notifications when a new installation checklist is created
 * Meets all 5 acceptance criteria:
 * - Only after successful save
 * - Includes Job ID, Technician, Location, Creation Time
 * - No failed submissions or ordinary edits
 * - Idempotent (no duplicates on retry)
 * - Non-blocking (will never roll back checklist creation)
 */
export async function notifyChecklistCreated(checklist, options = {}) {
  if (!checklist || (!checklist.id && !checklist.checklist_number)) {
    return { skipped: true, reason: 'Invalid checklist data' };
  }

  const checklistId = checklist.id;
  const checklistNumber = checklist.checklist_number || `INST-${checklistId?.slice(0, 8)}`;
  const eventId = `checklist-created-${checklistId || checklistNumber}`;

  // Idempotency: Prevent duplicate notifications if creation is retried
  if (processedEventIds.has(eventId) && !options.force) {
    console.log(`[PUSH_SERVICE] Notification event ${eventId} already processed. Skipping duplicate.`);
    return { skipped: true, reason: 'Duplicate event already dispatched' };
  }
  processedEventIds.add(eventId);

  // Active subscriptions
  const subscriptions = await getAllActiveSubscriptions();
  if (subscriptions.length === 0) {
    console.log('[PUSH_SERVICE] No active team push subscriptions registered. Push notification skipped.');
    return { skipped: true, reason: 'No active subscriptions' };
  }

  // Format notification content matching design guidelines
  const techName = checklist.service_engineer ? checklist.service_engineer.trim() : null;
  const location = checklist.client_location ? checklist.client_location.trim() : null;
  const clientName = checklist.client_name ? checklist.client_name.trim() : null;
  const createdAt = checklist.created_at ? new Date(checklist.created_at) : new Date();
  const timeFormatted = createdAt.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const title = 'Eagle Eye SafDrive — New Installation Checklist';

  // Build clear, informative body
  const detailsParts = [];
  if (techName) detailsParts.push(`Tech: ${techName}`);
  if (location) detailsParts.push(`Loc: ${location}`);
  else if (clientName) detailsParts.push(`Client: ${clientName}`);
  detailsParts.push(`Time: ${timeFormatted}`);

  const body = `A new installation checklist has been created.\nJob #${checklistNumber} • ${detailsParts.join(' • ')}`;

  // Canonical hash-based absolute URL for push notifications matching HashRouter structure
  const relativePath = `/admin/installation-checklists/${checklistId}`;
  const absoluteUrl = buildNotificationUrl(relativePath);
  const baseUrl = getNotificationBaseUrl();

  const pushPayload = {
    title,
    body,
    icon: `${baseUrl}/icon-192.png`,
    badge: `${baseUrl}/badge-96.png`,
    tag: `checklist-${checklistId || checklistNumber}`,
    renotify: true,
    data: {
      url: absoluteUrl,
      path: relativePath,
      checklistId,
      checklistNumber,
      timestamp: Date.now(),
    },
  };

  console.log(`[PUSH_SERVICE] Dispatching push notification for ${checklistNumber} to ${subscriptions.length} subscriber(s)...`);

  const deliveryPromises = subscriptions.map((sub) => sendPushNotification(sub, pushPayload));
  const results = await Promise.allSettled(deliveryPromises);

  let succeeded = 0;
  let failed = 0;
  const deliveryDetails = [];

  results.forEach((res, idx) => {
    const sub = subscriptions[idx];
    if (res.status === 'fulfilled' && res.value.success) {
      succeeded++;
      deliveryDetails.push({
        userId: sub.user_id,
        userEmail: sub.user_email,
        status: 'SUCCESS',
        statusCode: res.value.statusCode,
      });
    } else {
      failed++;
      deliveryDetails.push({
        userId: sub.user_id,
        userEmail: sub.user_email,
        status: 'FAILED',
        error: res.value?.error || res.reason?.message || 'Delivery error',
        statusCode: res.value?.statusCode || 0,
      });
    }
  });

  console.log(`[PUSH_SERVICE] Dispatch complete for ${checklistNumber}: ${succeeded} succeeded, ${failed} failed`);

  // Record audit history
  const historyRecord = {
    id: uuidv4(),
    event_id: eventId,
    checklist_id: checklistId || null,
    checklist_number: checklistNumber,
    title,
    body,
    url: relativePath,
    recipients_attempted: subscriptions.length,
    recipients_succeeded: succeeded,
    recipients_failed: failed,
    delivery_details: deliveryDetails,
    created_at: new Date().toISOString(),
  };

  inMemoryHistory.push({ ...historyRecord, full_url: absoluteUrl });
  saveHistoryStorage();

  // Try DB audit recording
  try {
    await supabase.from('push_notification_history').insert([historyRecord]);
  } catch (err) {
    // Non-blocking
  }

  return {
    success: true,
    eventId,
    attempted: subscriptions.length,
    succeeded,
    failed,
    historyId: historyRecord.id,
    payload: pushPayload,
  };
}

/**
 * Send a test notification to verify push functionality for a user's active device
 */
export async function sendTestNotificationToUser({ userId, userEmail = null }) {
  if (!userId) {
    throw new Error('User ID is required to send test notification');
  }

  const subscriptions = await getAllActiveSubscriptions();
  const userSubs = subscriptions.filter((s) => s.user_id === userId);

  if (userSubs.length === 0) {
    throw new Error('No active push subscriptions found for your account on this device. Please enable notifications first.');
  }

  const title = 'Eagle Eye SafDrive — Test Push Notification';
  const body = 'Real mobile push notifications are successfully active on your device! You will receive system alerts when new checklists are created.';

  const relativePath = '/admin/installation-checklists';
  const absoluteUrl = buildNotificationUrl(relativePath);
  const baseUrl = getNotificationBaseUrl();

  const payload = {
    title,
    body,
    icon: `${baseUrl}/icon-192.png`,
    badge: `${baseUrl}/badge-96.png`,
    tag: `test-push-${Date.now()}`,
    data: {
      url: absoluteUrl,
      path: relativePath,
      timestamp: Date.now(),
      isTest: true,
    },
  };

  let sent = 0;
  for (const sub of userSubs) {
    const res = await sendPushNotification(sub, payload);
    if (res.success) sent++;
  }

  return {
    success: true,
    attempted: userSubs.length,
    sent,
    message: `Test notification sent to ${sent} active device(s).`,
    payload,
  };
}

/**
 * Get notification history for troubleshooting/admin
 */
export async function getNotificationHistory(limit = 50) {
  const merged = [...inMemoryHistory];
  try {
    const { data: dbData } = await supabase
      .from('push_notification_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (Array.isArray(dbData)) {
      const seen = new Set(merged.map((h) => h.id));
      dbData.forEach((d) => {
        if (!seen.has(d.id)) merged.push(d);
      });
    }
  } catch (err) {
    // Non-blocking
  }

  merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return merged.slice(0, limit);
}

/**
 * Trigger Web Push notification to Coordinator when a Post-Installation Report is submitted
 * Follows all acceptance criteria:
 * - Clear title: "Post-Installation Report Submitted"
 * - Concise, privacy-safe message (no private customer details or expense details on lock screen)
 * - Clickable destination: links to report / return ticket in Coordinator Workspace
 * - Restricted to authorized COORDINATOR subscriptions
 * - Idempotent (stable event identifier prevents duplicate push on retries)
 * - Non-blocking (push failure never disrupts or reverts saved report)
 */
export async function notifyCoordinatorReportSubmitted({
  checklist,
  report = null,
  technicianName = null,
  submissionTime = null,
  force = false,
}) {
  if (!checklist || (!checklist.id && !checklist.checklist_number)) {
    return { skipped: true, reason: 'Invalid checklist data' };
  }

  const checklistId = checklist.id;
  const checklistNumber = checklist.checklist_number || `INST-${checklistId?.slice(0, 8)}`;
  const eventId = `post-install-push-${checklistId || checklistNumber}`;

  // Idempotency check: Skip duplicate dispatch if already handled
  if (processedEventIds.has(eventId) && !force) {
    console.log(`[PUSH_SERVICE] Notification event ${eventId} already processed. Skipping duplicate.`);
    return { skipped: true, reason: 'Duplicate event already dispatched' };
  }
  processedEventIds.add(eventId);

  // Filter for active Coordinator subscriptions only
  const allSubscriptions = await getAllActiveSubscriptions();
  const coordinatorSubs = allSubscriptions.filter((s) => {
    if (!s.is_active) return false;
    const role = s.user_role ? String(s.user_role).toUpperCase() : '';
    const email = s.user_email ? String(s.user_email).toLowerCase() : '';
    return role === 'COORDINATOR' || (role === '' && email.includes('coordinator'));
  });

  if (coordinatorSubs.length === 0) {
    console.log('[PUSH_SERVICE] No active coordinator push subscriptions registered. Push notification skipped.');
    return { skipped: true, reason: 'No active coordinator subscriptions' };
  }

  const techName = technicianName || checklist.service_engineer || 'Technician';
  const title = 'Post-Installation Report Submitted';
  const body = `Technician ${techName} has submitted the post-installation report for checklist ${checklistNumber}. Please review the report and return-ticket details.`;

  // Canonical absolute URL with both view and checklist parameters for deep linking
  const relativePath = `/coordinator?view=${checklistId}&checklist=${checklistId}&tab=return&openReport=true`;
  const absoluteUrl = buildNotificationUrl(relativePath);
  const baseUrl = getNotificationBaseUrl();

  const pushPayload = {
    title,
    body,
    icon: `${baseUrl}/icon-192.png`,
    badge: `${baseUrl}/badge-96.png`,
    tag: `post-install-${checklistId || checklistNumber}`,
    renotify: true,
    data: {
      url: absoluteUrl,
      path: relativePath,
      checklistId,
      checklistNumber,
      action: 'review_report',
      timestamp: Date.now(),
    },
  };

  console.log(`[PUSH_SERVICE] Dispatching coordinator push notification for ${checklistNumber} to ${coordinatorSubs.length} subscriber(s)...`);

  const deliveryPromises = coordinatorSubs.map((sub) => sendPushNotification(sub, pushPayload));
  const results = await Promise.allSettled(deliveryPromises);

  let succeeded = 0;
  let failed = 0;
  const deliveryDetails = [];

  results.forEach((res, idx) => {
    const sub = coordinatorSubs[idx];
    if (res.status === 'fulfilled' && res.value.success) {
      succeeded++;
      deliveryDetails.push({
        userId: sub.user_id,
        userEmail: sub.user_email,
        status: 'SUCCESS',
        statusCode: res.value.statusCode,
      });
    } else {
      failed++;
      deliveryDetails.push({
        userId: sub.user_id,
        userEmail: sub.user_email,
        status: 'FAILED',
        error: res.value?.error || res.reason?.message || 'Delivery error',
        statusCode: res.value?.statusCode || 0,
      });
    }
  });

  console.log(`[PUSH_SERVICE] Coordinator dispatch complete for ${checklistNumber}: ${succeeded} succeeded, ${failed} failed`);

  const historyRecord = {
    id: uuidv4(),
    event_id: eventId,
    checklist_id: checklistId || null,
    checklist_number: checklistNumber,
    title,
    body,
    url: relativePath,
    recipients_attempted: coordinatorSubs.length,
    recipients_succeeded: succeeded,
    recipients_failed: failed,
    delivery_details: deliveryDetails,
    created_at: new Date().toISOString(),
  };

  inMemoryHistory.push({ ...historyRecord, full_url: absoluteUrl });
  saveHistoryStorage();

  try {
    await supabase.from('push_notification_history').insert([historyRecord]);
  } catch (err) {
    // Non-blocking
  }

  return {
    success: true,
    eventId,
    attempted: coordinatorSubs.length,
    succeeded,
    failed,
    historyId: historyRecord.id,
    payload: pushPayload,
  };
}
