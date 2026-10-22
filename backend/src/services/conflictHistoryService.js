import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/deleted_conflicts_storage.json');

const inMemoryDeletedConflictIds = new Set();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.deleted_ids)) {
        data.deleted_ids.forEach((id) => inMemoryDeletedConflictIds.add(id));
      }
    }
  } catch (err) {
    console.warn('Could not load deleted conflicts fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      deleted_ids: Array.from(inMemoryDeletedConflictIds),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save deleted conflicts fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Generate a deterministic stable ID for a schedule conflict
 */
export function generateConflictId(c) {
  if (c.id) return c.id;
  const engId = c.engineer_id || 'eng';
  const idA = c.commitment_a?.id || c.commitment_a?.checklist_number || c.commitment_a?.checklist_id || c.commitment_a?.type || 'A';
  const idB = c.commitment_b?.id || c.commitment_b?.checklist_number || c.commitment_b?.checklist_id || c.commitment_b?.type || 'B';
  const start = c.overlap_start || '';
  const end = c.overlap_end || '';
  const raw = `${engId}_${idA}_${idB}_${start}_${end}`;
  return 'conf_' + Buffer.from(raw).toString('base64url');
}

/**
 * Check if a conflict ID is in the deleted/dismissed set
 */
export function isConflictDeleted(conflictId) {
  if (!conflictId) return false;
  if (inMemoryDeletedConflictIds.has(conflictId)) return true;
  if (conflictId.startsWith('conf_')) {
    try {
      const raw = Buffer.from(conflictId.slice(5), 'base64url').toString('utf-8');
      if (inMemoryDeletedConflictIds.has(raw)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Get all deleted conflict IDs
 */
export function getDeletedConflictIds() {
  return inMemoryDeletedConflictIds;
}

/**
 * Delete / dismiss a single conflict ID
 */
export function deleteConflictId(conflictId) {
  if (!conflictId) return false;
  inMemoryDeletedConflictIds.add(conflictId);
  if (!conflictId.startsWith('conf_')) {
    const hashed = 'conf_' + Buffer.from(conflictId).toString('base64url');
    inMemoryDeletedConflictIds.add(hashed);
  }
  saveStorage();
  return true;
}

/**
 * Delete / dismiss multiple conflict IDs
 */
export function deleteConflictIds(conflictIds) {
  if (!Array.isArray(conflictIds)) return 0;
  let count = 0;
  conflictIds.forEach((id) => {
    if (id) {
      inMemoryDeletedConflictIds.add(id);
      if (!id.startsWith('conf_')) {
        const hashed = 'conf_' + Buffer.from(id).toString('base64url');
        inMemoryDeletedConflictIds.add(hashed);
      }
      count++;
    }
  });
  if (count > 0) {
    saveStorage();
  }
  return count;
}

/**
 * Clear/reset all deleted conflict history (restore all)
 */
export function resetDeletedConflicts() {
  inMemoryDeletedConflictIds.clear();
  saveStorage();
  return true;
}
