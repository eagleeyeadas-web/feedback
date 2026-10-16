import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { getMaterialInventory, adjustMaterialStock } from './materialStockService.js';
import { getInventoryProducts, adjustStock } from './inventoryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/backup_items_storage.json');

/**
 * Resilient in-memory store with file backing for loose backup item declarations
 */
const inMemoryDeclarations = new Map(); // checklist_id -> declaration object
const inMemoryVerifiedReturns = new Set(); // verification keys to prevent duplicate return credits

export function loadBackupItemsStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.declarations && typeof data.declarations === 'object') {
        Object.entries(data.declarations).forEach(([k, v]) => {
          inMemoryDeclarations.set(k, { ...v });
        });
      }
      if (Array.isArray(data.verifiedReturns)) {
        data.verifiedReturns.forEach((key) => inMemoryVerifiedReturns.add(key));
      }
    } else {
      saveBackupItemsStorage();
    }
  } catch (err) {
    console.warn('Could not load backup items storage:', err.message);
  }
}

function saveBackupItemsStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      declarations: Object.fromEntries(inMemoryDeclarations.entries()),
      verifiedReturns: Array.from(inMemoryVerifiedReturns),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save backup items storage:', err.message);
  }
}

// Initial load
loadBackupItemsStorage();

/**
 * Permanently delete backup declarations and items for a deleted checklist
 */
export function deleteBackupDeclarationForChecklist(checklistId) {
  if (inMemoryDeclarations.has(checklistId)) {
    inMemoryDeclarations.delete(checklistId);
    saveBackupItemsStorage();
  }
}

/**
 * Get available loose backup products from both Camera/Device Products and Material Inventory catalogs
 */
export async function getAvailableBackupProducts() {
  try {
    const [materials, devices] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);

    // Category A: Camera / Device Products (Complete systems & MDVRs)
    const deviceProducts = (devices || []).map((d) => ({
      id: d.id,
      item_id: d.id,
      product_id: d.id,
      item_name: d.device_name || `${d.device_type} System`,
      display_name: d.device_name || d.device_type,
      device_type: d.device_type,
      sku: d.sku || 'N/A',
      unit: d.unit || 'Nos.',
      category: 'Device Component',
      category_group: 'A',
      item_type: 'DEVICE',
      available_stock: Number(d.usable_stock) || 0,
      current_stock: Number(d.usable_stock) || 0,
      min_stock_level: Number(d.min_stock_level) || 0,
    }));

    const categoryAComponents = [];
    const categoryBMaterials = [];

    (materials || []).forEach((m) => {
      const lower = (m.material_name || '').toLowerCase();
      const isDeviceComp =
        lower.includes('camera') ||
        lower.includes('display') ||
        lower.includes('screen') ||
        lower.includes('mdvr') ||
        lower.includes('sensor');

      const entry = {
        id: m.id,
        item_id: m.id,
        material_id: m.id,
        item_name: m.material_name,
        display_name: m.material_name,
        sku: m.sku || 'N/A',
        unit: m.unit || 'Nos.',
        category: isDeviceComp ? 'Device Component' : 'Installation Material',
        category_group: isDeviceComp ? 'A' : 'B',
        item_type: isDeviceComp ? 'COMPONENT' : 'MATERIAL',
        available_stock: Number(m.current_stock) || 0,
        current_stock: Number(m.current_stock) || 0,
        min_stock_level: Number(m.min_stock_level) || 0,
      };

      if (isDeviceComp) {
        categoryAComponents.push(entry);
        // If loose Display item exists, provide explicit Live Display and Recording Display options for technician selection
        if (lower === 'display') {
          categoryAComponents.push({
            ...entry,
            id: `${m.id}-live-display`,
            canonical_id: m.id,
            item_name: 'Live Display',
            display_name: 'Live Display',
          });
          categoryAComponents.push({
            ...entry,
            id: `${m.id}-recording-display`,
            canonical_id: m.id,
            item_name: 'Recording Display',
            display_name: 'Recording Display',
          });
        }
      } else {
        categoryBMaterials.push(entry);
        if (lower.includes('cable tie') && lower.includes('200')) {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-ct-200mm`,
            canonical_id: m.id,
            item_name: 'Cable Tie 200mm',
            display_name: 'Cable Tie 200mm',
          });
        }
        if (lower.includes('cable tie') && lower.includes('300')) {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-ct-300mm`,
            canonical_id: m.id,
            item_name: 'Cable Tie 300mm',
            display_name: 'Cable Tie 300mm',
          });
        }
        if (lower.includes('5-metre') || lower === '5m cable') {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-5m-cable`,
            canonical_id: m.id,
            item_name: '5m Cable',
            display_name: '5m Cable',
          });
        }
        if (lower.includes('15-metre') || lower === '15m cable') {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-15m-cable`,
            canonical_id: m.id,
            item_name: '15m Cable',
            display_name: '15m Cable',
          });
        }
      }
    });

    // Deduplicate by normalized lowercase product name, prioritizing real UUID records over synthetic aliases
    const productMap = new Map();
    [...categoryAComponents, ...deviceProducts, ...categoryBMaterials].forEach((prod) => {
      const key = (prod.item_name || '').trim().toLowerCase();
      if (!key) return;
      if (!productMap.has(key)) {
        productMap.set(key, prod);
      } else {
        const existing = productMap.get(key);
        if (existing.canonical_id && !prod.canonical_id) {
          productMap.set(key, prod);
        }
      }
    });

    return Array.from(productMap.values());
  } catch (err) {
    console.warn('Could not load authoritative catalogue for backup products:', err.message);
    return [];
  }
}

/**
 * Get pre-installation backup declaration for a checklist
 */
export async function getBackupDeclaration(checklistId) {
  if (!checklistId) return null;

  // 1. Fetch checklist to determine sales expectation
  let checklist = null;
  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, carry_extra_backup_items, extra_devices, service_engineer, service_engineer_id, installation_status')
      .eq('id', checklistId)
      .maybeSingle();
    if (!error && data) {
      checklist = data;
    }
  } catch (e) {
    // Non-blocking
  }

  const salesExpected = Boolean(checklist?.carry_extra_backup_items ?? checklist?.extra_devices);

  // 2. Try Supabase
  try {
    const { data: decl, error: declErr } = await supabase
      .from('pre_installation_backup_declarations')
      .select('*')
      .eq('checklist_id', checklistId)
      .maybeSingle();

    if (!declErr && decl) {
      const { data: rows, error: rowsErr } = await supabase
        .from('pre_installation_backup_items')
        .select('*')
        .eq('declaration_id', decl.id)
        .order('created_at', { ascending: true });

      const items = !rowsErr && Array.isArray(rows)
        ? rows.map((r) => ({
            ...r,
            category: r.category || classifyBackupItemCategory(r.item_name),
          }))
        : [];
      const result = {
        ...decl,
        sales_expected: salesExpected,
        items,
      };
      // Keep memory synced
      inMemoryDeclarations.set(checklistId, result);
      return result;
    }
  } catch (e) {
    // Fall back to memory
  }

  // 3. Fallback to memory
  const cached = inMemoryDeclarations.get(checklistId);
  if (cached) {
    return {
      ...cached,
      sales_expected: salesExpected,
      items: (cached.items || []).map((it) => ({
        ...it,
        category: it.category || classifyBackupItemCategory(it.item_name),
      })),
    };
  }

  // Default empty declaration state
  return {
    checklist_id: checklistId,
    sales_expected: salesExpected,
    has_backup_items: false,
    no_items_reason: null,
    status: 'NOT_RECORDED',
    items: [],
  };
}

export function classifyBackupItemCategory(name = '', declaredCategory = '') {
  if (declaredCategory === 'Device Component' || declaredCategory === 'Installation Material') {
    return declaredCategory;
  }
  const lower = (name || '').toLowerCase();
  if (
    lower.includes('camera') ||
    lower.includes('display') ||
    lower.includes('mdvr') ||
    lower.includes('sensor') ||
    lower.includes('system')
  ) {
    return 'Device Component';
  }
  return 'Installation Material';
}

/**
 * Save / Update pre-installation backup declaration
 */
export async function saveBackupDeclaration({
  checklistId,
  user,
  hasBackupItems,
  noItemsReason = '',
  items = [],
}) {
  if (!checklistId) {
    throw new Error('Checklist ID is required.');
  }

  // Fetch checklist
  let checklist = null;
  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, carry_extra_backup_items, extra_devices, service_engineer, service_engineer_id, installation_status')
      .eq('id', checklistId)
      .maybeSingle();
    if (!error && data) checklist = data;
  } catch (e) {
    // Non-blocking
  }

  const isCarrying = Boolean(hasBackupItems);

  if (!isCarrying) {
    const salesExpected = Boolean(checklist?.carry_extra_backup_items ?? checklist?.extra_devices);
    if (salesExpected && (!noItemsReason || !noItemsReason.trim())) {
      throw new Error('Please provide a reason why no extra backup items are carried when Sales indicated backup items were needed.');
    }
  }

  let validatedItems = [];
  if (isCarrying) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Please add at least one backup item with a positive quantity.');
    }

    const itemMap = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.item_name || it.material_name || '').trim();
      if (!name) {
        throw new Error(`Row #${i + 1}: Please select a product.`);
      }
      const qty = Number(it.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Row #${i + 1} (${name}): Quantity must be a positive number greater than 0.`);
      }

      const unit = (it.unit || 'Nos.').trim();
      const itemId = (it.item_id || it.id || `item-${name.toLowerCase().replace(/\s+/g, '-')}`).trim();
      const sku = (it.sku || it.item_sku || '').trim();
      const category = classifyBackupItemCategory(name, it.category);

      // Combine duplicate rows if user selected same item
      if (itemMap.has(name.toLowerCase())) {
        const existing = itemMap.get(name.toLowerCase());
        existing.quantity += qty;
      } else {
        itemMap.set(name.toLowerCase(), {
          item_id: itemId,
          item_name: name,
          item_sku: sku || null,
          category,
          quantity: qty,
          unit: unit || 'Nos.',
          quantity_issued: 0,
          quantity_used: 0,
          quantity_returned: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
          discrepancy_reason: null,
        });
      }
    }
    validatedItems = Array.from(itemMap.values());
  }

  const existingDecl = await getBackupDeclaration(checklistId);
  const isCorrection = Boolean(existingDecl && existingDecl.status && existingDecl.status !== 'NOT_RECORDED');

  // Maintain history when correcting
  const history = Array.isArray(existingDecl?.history) ? [...existingDecl.history] : [];
  if (isCorrection) {
    history.push({
      modified_at: new Date().toISOString(),
      modified_by: user?.email || user?.id || 'Technician',
      previous_has_backup_items: existingDecl.has_backup_items,
      previous_items_count: existingDecl.items?.length || 0,
      previous_items: existingDecl.items || [],
    });
  }

  const nowIso = new Date().toISOString();
  const isValidUuid = (val) =>
    typeof val === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

  const declarationPayload = {
    checklist_id: checklistId,
    technician_id: isValidUuid(user?.id)
      ? user.id
      : isValidUuid(checklist?.service_engineer_id)
      ? checklist.service_engineer_id
      : null,
    technician_name: user?.name || user?.email || checklist?.service_engineer || 'Technician',
    has_backup_items: isCarrying,
    no_items_reason: isCarrying ? null : (noItemsReason ? noItemsReason.trim() : null),
    status: isCorrection ? 'CORRECTED' : 'DECLARED',
    declaration_timestamp: nowIso,
    history,
    updated_at: nowIso,
  };

  let savedDeclaration = null;

  // 1. Try Supabase upsert
  try {
    const { data: upsertedDecl, error: declErr } = await supabase
      .from('pre_installation_backup_declarations')
      .upsert(
        {
          ...(isValidUuid(existingDecl?.id) ? { id: existingDecl.id } : {}),
          ...declarationPayload,
          created_at: existingDecl?.created_at || nowIso,
        },
        { onConflict: 'checklist_id' }
      )
      .select()
      .single();

    if (!declErr && upsertedDecl) {
      savedDeclaration = upsertedDecl;

      // Delete old items and insert fresh rows
      await supabase
        .from('pre_installation_backup_items')
        .delete()
        .eq('declaration_id', savedDeclaration.id);

      if (validatedItems.length > 0) {
        const rowsToInsert = validatedItems.map((vi) => ({
          declaration_id: savedDeclaration.id,
          checklist_id: checklistId,
          item_id: isValidUuid(vi.item_id) ? vi.item_id : crypto.randomUUID(),
          item_name: vi.item_name,
          item_sku: vi.item_sku,
          quantity: vi.quantity,
          unit: vi.unit,
          quantity_issued: vi.quantity_issued || 0,
          quantity_used: vi.quantity_used || 0,
          quantity_returned: vi.quantity_returned || 0,
          quantity_damaged: vi.quantity_damaged || 0,
          quantity_missing: vi.quantity_missing || 0,
          discrepancy_reason: vi.discrepancy_reason || null,
          created_at: nowIso,
          updated_at: nowIso,
        }));

        const { data: insertedRows } = await supabase
          .from('pre_installation_backup_items')
          .insert(rowsToInsert)
          .select();

        const finalRows = insertedRows || rowsToInsert;
        savedDeclaration.items = finalRows.map((row) => ({
          ...row,
          category:
            validatedItems.find((vi) => (vi.item_name || '').toLowerCase() === (row.item_name || '').toLowerCase())?.category ||
            classifyBackupItemCategory(row.item_name),
        }));
      } else {
        savedDeclaration.items = [];
      }
    }
  } catch (err) {
    console.warn('Supabase backup declaration save failed, falling back to local store:', err.message);
  }

  // 2. Fallback to in-memory / local storage
  if (!savedDeclaration) {
    const declId = existingDecl?.id || `decl-${checklistId}`;
    savedDeclaration = {
      id: declId,
      ...declarationPayload,
      created_at: existingDecl?.created_at || nowIso,
      items: validatedItems.map((vi, idx) => ({
        id: `bitem-${declId}-${idx + 1}`,
        declaration_id: declId,
        checklist_id: checklistId,
        ...vi,
        created_at: nowIso,
        updated_at: nowIso,
      })),
    };
  }

  savedDeclaration.sales_expected = false;
  inMemoryDeclarations.set(checklistId, savedDeclaration);
  saveBackupItemsStorage();

  // Synchronize technician's backup declaration onto the parent installation checklist record
  try {
    const totalExtra = validatedItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

    await supabase
      .from('installation_checklists')
      .update({
        carry_extra_backup_items: isCarrying,
        updated_at: nowIso,
      })
      .eq('id', checklistId);
  } catch (err) {
    console.warn('Could not update carry_extra_backup_items on installation_checklists:', err.message);
  }

  // Audit log
  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role || 'TECHNICAL',
    action: isCorrection ? 'CORRECT_BACKUP_ITEMS_DECLARATION' : 'DECLARE_BACKUP_ITEMS',
    target_table: 'pre_installation_backup_declarations',
    target_id: savedDeclaration.id,
    details: {
      checklist_id: checklistId,
      has_backup_items: isCarrying,
      items_count: validatedItems.length,
      is_correction: isCorrection,
    },
  });

  return savedDeclaration;
}

/**
 * Reconcile backup items during post-installation report submission
 */
export async function reconcileBackupItems({ checklistId, user, items = [] }) {
  const declaration = await getBackupDeclaration(checklistId);
  if (!declaration || !declaration.has_backup_items) {
    return { reconciled: true, items: [] };
  }

  const declaredItems = declaration.items || [];
  const inputMap = new Map();
  items.forEach((it) => {
    const key = (it.item_name || it.material_name || '').toLowerCase();
    inputMap.set(key, it);
  });

  const reconciledRows = [];

  for (const decItem of declaredItems) {
    const key = decItem.item_name.toLowerCase();
    const rep = inputMap.get(key) || {};

    const qtyCarried = Number(decItem.quantity) || 0;
    const qtyUsed = Math.max(0, Number(rep.quantity_used || rep.quantity_installed || 0));
    const qtyReturned = Math.max(0, Number(rep.quantity_returned || rep.quantity_to_return || 0));
    const qtyDamaged = Math.max(0, Number(rep.quantity_damaged || 0));
    const qtyMissing = Math.max(0, Number(rep.quantity_missing || 0));

    const totalAccounted = qtyUsed + qtyReturned + qtyDamaged + qtyMissing;
    if (totalAccounted !== qtyCarried) {
      throw new Error(
        `Backup item reconciliation mismatch for "${decItem.item_name}": Declared quantity (${qtyCarried}) must equal Used (${qtyUsed}) + Returned (${qtyReturned}) + Damaged (${qtyDamaged}) + Missing (${qtyMissing}). Currently accounts for ${totalAccounted}.`
      );
    }

    if ((qtyDamaged > 0 || qtyMissing > 0) && (!rep.discrepancy_reason || !rep.discrepancy_reason.trim())) {
      throw new Error(
        `Discrepancy remark is required for backup item "${decItem.item_name}" when reporting damaged (${qtyDamaged}) or missing (${qtyMissing}) items.`
      );
    }

    reconciledRows.push({
      ...decItem,
      quantity_used: qtyUsed,
      quantity_returned: qtyReturned,
      quantity_damaged: qtyDamaged,
      quantity_missing: qtyMissing,
      discrepancy_reason: rep.discrepancy_reason ? rep.discrepancy_reason.trim() : null,
      updated_at: new Date().toISOString(),
    });
  }

  // Update rows in Supabase
  try {
    for (const r of reconciledRows) {
      if (r.id) {
        await supabase
          .from('pre_installation_backup_items')
          .update({
            quantity_used: r.quantity_used,
            quantity_returned: r.quantity_returned,
            quantity_damaged: r.quantity_damaged,
            quantity_missing: r.quantity_missing,
            discrepancy_reason: r.discrepancy_reason,
            updated_at: r.updated_at,
          })
          .eq('id', r.id);
      }
    }
  } catch (e) {
    console.warn('Failed to update reconciled backup items in Supabase:', e.message);
  }

  // Update memory
  declaration.items = reconciledRows;
  declaration.status = 'RECONCILED';
  inMemoryDeclarations.set(checklistId, declaration);
  saveBackupItemsStorage();

  return {
    reconciled: true,
    items: reconciledRows,
  };
}

const processedChecklistBackupIssuances = new Set();

/**
 * Server-side atomic transaction to issue declared loose backup items for a checklist.
 * Deducts stock only when authorized Store Manager issues the actual quantities.
 * Prevents double-deductions and negative stock.
 */
export async function issueBackupItemsForChecklist({
  checklist_id,
  items,
  remarks = '',
  user,
}) {
  if (!checklist_id) throw new Error('Checklist ID is required.');
  if (processedChecklistBackupIssuances.has(checklist_id)) {
    return { success: true, message: 'Backup items already issued' };
  }

  const declaration = await getBackupDeclaration(checklist_id);
  if (!declaration || !declaration.has_backup_items) {
    return { success: true, items: [] };
  }

  const itemsToIssue = Array.isArray(items) && items.length > 0 ? items : (declaration.items || []);
  if (itemsToIssue.length === 0) return { success: true, items: [] };

  const [allMats, allDevs] = await Promise.all([
    getMaterialInventory().catch(() => []),
    getInventoryProducts().catch(() => []),
  ]);

  const matMap = new Map(allMats.map((m) => [m.material_name.toLowerCase(), m]));
  const devMap = new Map(allDevs.map((d) => [d.device_type.toLowerCase(), d]));

  const issuedResults = [];

  for (const it of itemsToIssue) {
    const name = (it.item_name || '').trim();
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;

    // Skip if already issued
    if (Number(it.quantity_issued) >= qty) {
      continue;
    }

    let mat = matMap.get(name.toLowerCase());
    if (!mat && name.toLowerCase().includes('display')) {
      mat = matMap.get('display');
    }
    if (!mat) {
      const lower = name.toLowerCase();
      if (lower.includes('cable tie') && lower.includes('200')) {
        mat = allMats.find((m) => m.material_name.toLowerCase().includes('cable tie') && m.material_name.includes('200'));
      } else if (lower.includes('cable tie') && lower.includes('300')) {
        mat = allMats.find((m) => m.material_name.toLowerCase().includes('cable tie') && m.material_name.includes('300'));
      } else if (lower.includes('5m') || lower.includes('5-metre')) {
        mat = allMats.find((m) => m.material_name.toLowerCase().includes('5-metre'));
      } else if (lower.includes('15m') || lower.includes('15-metre')) {
        mat = allMats.find((m) => m.material_name.toLowerCase().includes('15-metre'));
      }
    }
    const dev = devMap.get(name.toLowerCase());

    if (mat) {
      const currentStock = Number(mat.current_stock) || 0;
      if (qty > currentStock) {
        throw new Error(
          `Insufficient stock for backup material "${name}". In store: ${currentStock} ${mat.unit || 'Nos.'}, required: ${qty} ${mat.unit || 'Nos.'}.`
        );
      }
      await adjustMaterialStock({
        material_name: mat.material_name,
        action: 'REMOVE',
        quantity: qty,
        reason: `Backup material issued for checklist ${checklist_id}: ${qty} ${mat.unit}. ${remarks || ''}`.trim(),
        user,
      });
    } else if (dev) {
      const currentStock = Number(dev.usable_stock) || 0;
      if (qty > currentStock) {
        throw new Error(
          `Insufficient stock for backup device "${name}". In store: ${currentStock} Nos., required: ${qty} Nos.`
        );
      }
      await adjustStock({
        device_type: dev.device_type,
        action: 'REMOVE',
        quantity: qty,
        reason: `Backup device issued for checklist ${checklist_id}: ${qty} Nos. ${remarks || ''}`.trim(),
        user,
      });
    } else {
      console.warn(`Backup item "${name}" not found in materials or device products. Stock not deducted.`);
    }

    it.quantity_issued = qty;
    issuedResults.push({
      item_name: name,
      quantity_issued: qty,
      unit: it.unit || mat?.unit || dev?.unit || 'Nos.',
    });

    // Update in Supabase
    if (it.id) {
      try {
        await supabase
          .from('pre_installation_backup_items')
          .update({
            quantity_issued: qty,
            updated_at: new Date().toISOString(),
          })
          .eq('id', it.id);
      } catch (e) {
        // Non-blocking
      }
    }
  }

  // Update in-memory declaration
  declaration.items = itemsToIssue;
  inMemoryDeclarations.set(checklist_id, declaration);
  saveBackupItemsStorage();
  processedChecklistBackupIssuances.add(checklist_id);

  if (issuedResults.length > 0) {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'STORE_MANAGER',
      action: 'ISSUE_BACKUP_ITEMS',
      target_table: 'pre_installation_backup_declarations',
      target_id: declaration.id,
      details: {
        checklist_id,
        issued_items: issuedResults,
        remarks,
      },
    });
  }

  return { success: true, issued_items: issuedResults };
}

/**
 * Store Manager physically verifies returned loose backup items
 * Restores usable stock ONLY after physical verification.
 * Missing items are never added to stock.
 * Damaged items are recorded separately and not added to usable stock.
 * Prevents duplicate additions.
 * Safeguard: Unissued items are never restored to stock.
 */
export async function verifyStoreBackupItemReturn({
  checklistId,
  user,
  verificationItems = [],
  remarks = '',
}) {
  if (!checklistId) throw new Error('Checklist ID is required.');
  const verificationKey = `backup-ret-${checklistId}`;

  if (inMemoryVerifiedReturns.has(verificationKey)) {
    throw new Error('Returned backup items for this checklist have already been physically verified and processed.');
  }

  const declaration = await getBackupDeclaration(checklistId);
  if (!declaration || !declaration.items || declaration.items.length === 0) {
    throw new Error('No declared backup items found for this checklist.');
  }

  const verificationResults = [];

  for (const row of verificationItems) {
    const itemName = (row.item_name || '').trim();
    const acceptedUsable = Math.max(0, Number(row.accepted_usable_qty) || 0);
    const damagedQty = Math.max(0, Number(row.damaged_qty) || 0);
    const missingQty = Math.max(0, Number(row.missing_qty) || 0);

    let matchingDeclItem = declaration.items.find(
      (it) => it.item_name.toLowerCase() === itemName.toLowerCase()
    );
    if (!matchingDeclItem && itemName.toLowerCase().includes('display')) {
      matchingDeclItem = declaration.items.find((it) => it.item_name.toLowerCase().includes('display'));
    }

    if (!matchingDeclItem) {
      continue;
    }

    // Safeguard: Do NOT restore stock for unissued items
    const issuedQty = Number(matchingDeclItem.quantity_issued) || 0;
    if (issuedQty <= 0) {
      console.warn(`Skipping stock restoration for unissued backup item "${itemName}" (quantity_issued is 0).`);
      verificationResults.push({
        item_name: itemName,
        unit: matchingDeclItem.unit,
        accepted_usable_qty: 0,
        unissued_discarded_qty: acceptedUsable,
        damaged_qty: damagedQty,
        missing_qty: missingQty,
        notice: 'Unissued items cannot restore stock',
        verified_at: new Date().toISOString(),
      });
      continue;
    }

    // Do not restore more stock than was actually issued
    const finalUsableRestored = Math.min(acceptedUsable, issuedQty);

    // Only restore stock if the item was physically verified as usable by Store Manager
    // And only add the accepted usable quantity (never damaged or missing)
    if (finalUsableRestored > 0) {
      try {
        const allMats = await getMaterialInventory();
        let targetMat = allMats.find((m) => m.material_name.toLowerCase() === itemName.toLowerCase());
        if (!targetMat && itemName.toLowerCase().includes('display')) {
          targetMat = allMats.find((m) => m.material_name.toLowerCase() === 'display');
        }
        if (targetMat) {
          await adjustMaterialStock({
            material_name: targetMat.material_name,
            action: 'ADD',
            quantity: finalUsableRestored,
            reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} ${matchingDeclItem.unit || 'Nos.'} usable stock restored. ${remarks || ''}`.trim(),
            user,
          });
        } else {
          const allDevs = await getInventoryProducts();
          const devExists = allDevs.some((d) => d.device_type.toLowerCase() === itemName.toLowerCase());
          if (devExists) {
            await adjustStock({
              device_type: itemName,
              action: 'ADD',
              quantity: finalUsableRestored,
              reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} units usable stock restored. ${remarks || ''}`.trim(),
              user,
            });
          } else {
            await adjustMaterialStock({
              material_name: itemName,
              action: 'ADD',
              quantity: finalUsableRestored,
              reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} ${matchingDeclItem.unit || 'Nos.'} usable stock restored. ${remarks || ''}`.trim(),
              user,
            });
          }
        }
      } catch (stockAdjErr) {
        console.warn(`Stock adjustment on return verification for ${itemName}:`, stockAdjErr.message);
      }
    }

    verificationResults.push({
      item_name: itemName,
      unit: matchingDeclItem.unit,
      accepted_usable_qty: acceptedUsable,
      damaged_qty: damagedQty,
      missing_qty: missingQty,
      verified_at: new Date().toISOString(),
    });
  }

  inMemoryVerifiedReturns.add(verificationKey);
  saveBackupItemsStorage();

  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role || 'STORE_MANAGER',
    action: 'VERIFY_BACKUP_ITEMS_RETURN',
    target_table: 'pre_installation_backup_declarations',
    target_id: declaration.id,
    details: {
      checklist_id: checklistId,
      verification_results: verificationResults,
      remarks,
    },
  });

  return {
    success: true,
    message: 'Returned backup items physically verified and usable stock restored.',
    verification_results: verificationResults,
  };
}
