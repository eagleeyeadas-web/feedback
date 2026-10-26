import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/app_notifications_storage.json');

export const inMemoryNotifications = new Map();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.notifications)) {
        data.notifications.forEach((n) => inMemoryNotifications.set(n.id, n));
      }
    }
  } catch (err) {
    console.warn('Could not load notifications fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      notifications: Array.from(inMemoryNotifications.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save notifications fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Permanently delete notifications associated with a deleted checklist
 */
export function deleteNotificationsForChecklist(checklistId, checklistNumber = null) {
  let changed = false;
  inMemoryNotifications.forEach((n, k) => {
    const matchId = n.checklist_id === checklistId || n.metadata?.checklist_id === checklistId;
    const matchNum =
      checklistNumber &&
      (n.checklist_number === checklistNumber ||
        n.metadata?.checklist_number === checklistNumber ||
        n.message?.includes(checklistNumber) ||
        n.title?.includes(checklistNumber));
    if (matchId || matchNum) {
      inMemoryNotifications.delete(k);
      changed = true;
    }
  });
  if (changed) {
    saveStorage();
  }
}

/**
 * Create a new application notification
 */
export async function createNotification({
  targetRole = null,
  targetUserId = null,
  title,
  message,
  type = 'INFO',
  checklistId = null,
  checklistNumber = null,
  metadata = null,
}) {
  // Idempotency check: Prevent duplicate notifications for retried requests or identical idempotency_key
  const idempotencyKey = metadata?.idempotency_key;
  if (idempotencyKey) {
    for (const notif of inMemoryNotifications.values()) {
      if (notif.metadata?.idempotency_key === idempotencyKey) {
        return notif;
      }
    }
  }

  if (type === 'POST_INSTALLATION_REPORT_SUBMITTED' && checklistId) {
    for (const notif of inMemoryNotifications.values()) {
      if (
        (notif.type === 'POST_INSTALLATION_REPORT_SUBMITTED' && notif.checklist_id === checklistId) ||
        notif.metadata?.idempotency_key === `post-install-report-${checklistId}`
      ) {
        return notif;
      }
    }
    try {
      const { data: existingDb } = await supabase
        .from('app_notifications')
        .select('*')
        .eq('type', 'POST_INSTALLATION_REPORT_SUBMITTED')
        .eq('checklist_id', checklistId)
        .maybeSingle();
      if (existingDb) {
        inMemoryNotifications.set(existingDb.id, existingDb);
        return existingDb;
      }
    } catch (e) {
      // Non-blocking fallback
    }
  }

  const notifId = uuidv4();
  const notifRecord = {
    id: notifId,
    target_role: targetRole,
    target_user_id: targetUserId,
    title,
    message,
    type,
    checklist_id: checklistId,
    checklist_number: checklistNumber,
    metadata: metadata || null,
    is_read: false,
    created_at: new Date().toISOString(),
  };

  try {
    const { data: dbData, error } = await supabase
      .from('app_notifications')
      .insert([notifRecord])
      .select()
      .single();
    if (!error && dbData) {
      notifRecord.id = dbData.id;
    }
  } catch (err) {
    // Fallback store
  }

  inMemoryNotifications.set(notifRecord.id, notifRecord);
  saveStorage();
  return notifRecord;
}

/**
 * Fetch notifications for a user or role
 */
export async function getNotifications({ role = null, userId = null, unreadOnly = false, limit = 50 }) {
  const notifications = [];
  const seenIds = new Set();

  try {
    let query = supabase.from('app_notifications').select('*').order('created_at', { ascending: false }).limit(limit);
    if (role && userId) {
      query = query.or(`target_role.eq.${role},target_user_id.eq.${userId}`);
    } else if (role) {
      query = query.eq('target_role', role);
    } else if (userId) {
      query = query.eq('target_user_id', userId);
    }
    if (unreadOnly) {
      query = query.eq('is_read', false);
    }
    const { data: dbData, error } = await query;
    if (!error && Array.isArray(dbData)) {
      dbData.forEach((n) => {
        seenIds.add(n.id);
        notifications.push(n);
      });
    }
  } catch (err) {
    // Non-blocking
  }

  inMemoryNotifications.forEach((n) => {
    if (seenIds.has(n.id)) return;
    let match = false;
    if (role && userId) {
      match = (n.target_role && n.target_role.toLowerCase() === role.toLowerCase()) ||
              (n.target_user_id && n.target_user_id === userId);
    } else if (role) {
      match = !n.target_role || (n.target_role && n.target_role.toLowerCase() === role.toLowerCase());
    } else if (userId) {
      match = n.target_user_id === userId;
    } else {
      match = true;
    }
    if (match && (!unreadOnly || !n.is_read)) {
      notifications.push(n);
    }
  });

  notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return notifications.slice(0, limit);
}

/**
 * Mark a single notification as read
 */
export async function markNotificationRead(id) {
  try {
    await supabase.from('app_notifications').update({ is_read: true }).eq('id', id);
  } catch (err) {
    // Non-blocking
  }
  const inMem = inMemoryNotifications.get(id);
  if (inMem) {
    inMem.is_read = true;
    inMemoryNotifications.set(id, inMem);
    saveStorage();
  }
  return { success: true };
}

/**
 * Mark all notifications for a role/user as read
 */
export async function markAllNotificationsRead({ role = null, userId = null }) {
  try {
    let q = supabase.from('app_notifications').update({ is_read: true });
    if (role) q = q.eq('target_role', role);
    if (userId) q = q.eq('target_user_id', userId);
    await q;
  } catch (err) {
    // Non-blocking
  }

  inMemoryNotifications.forEach((n) => {
    const roleMatch = !role || (n.target_role && n.target_role.toLowerCase() === role.toLowerCase());
    const userMatch = !userId || n.target_user_id === userId;
    if (roleMatch || userMatch) {
      n.is_read = true;
    }
  });
  saveStorage();
  return { success: true };
}

/**
 * Count unread notifications
 */
export async function getUnreadCount({ role = null, userId = null }) {
  const notifs = await getNotifications({ role, userId, unreadOnly: true, limit: 100 });
  return notifs.length;
}

/**
 * Delete a single notification by ID
 */
export async function deleteNotificationById(id) {
  try {
    await supabase.from('app_notifications').delete().eq('id', id);
  } catch (err) {
    // Non-blocking
  }
  inMemoryNotifications.delete(id);
  saveStorage();
  return { success: true, id };
}

/**
 * Delete all notifications for a role/user
 */
export async function clearNotifications({ role = null, userId = null } = {}) {
  try {
    let q = supabase.from('app_notifications').delete();
    if (role) q = q.eq('target_role', role);
    if (userId) q = q.eq('target_user_id', userId);
    await q;
  } catch (err) {
    // Non-blocking
  }

  let deletedCount = 0;
  inMemoryNotifications.forEach((n, k) => {
    const roleMatch = !role || (n.target_role && n.target_role.toLowerCase() === role.toLowerCase());
    const userMatch = !userId || n.target_user_id === userId;
    if (roleMatch || userMatch) {
      inMemoryNotifications.delete(k);
      deletedCount++;
    }
  });
  saveStorage();
  return { success: true, deletedCount };
}
