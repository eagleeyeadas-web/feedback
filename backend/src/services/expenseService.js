import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { getChecklistById } from './installationService.js';
import { getInstallationCompletionReport } from './workflowService.js';
import { generateTechnicianExpensePDF } from './technicianExpensePdfGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/workflow_storage.json');

export const EXPENSE_CATEGORIES = [
  'Travel',
  'Fuel',
  'Food',
  'Toll',
  'Accommodation',
  'Parking',
  'Other Travel Expense',
];

export const PAYMENT_METHODS = [
  'Cash',
  'UPI',
  'Personal Card',
  'Company Payment',
  'Other',
];

// Fallback in-memory map: key = id, value = expense object
const inMemoryJobExpenses = new Map();

function loadFallbackStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.jobExpenses && typeof data.jobExpenses === 'object') {
        Object.entries(data.jobExpenses).forEach(([k, v]) => {
          inMemoryJobExpenses.set(k, v);
        });
      }
    }
  } catch (err) {
    console.warn('Could not load job expenses fallback storage:', err.message);
  }
}

function saveFallbackStorage() {
  try {
    let data = {};
    if (fs.existsSync(STORAGE_FILE)) {
      data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8'));
    }
    data.jobExpenses = Object.fromEntries(inMemoryJobExpenses);
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save job expenses fallback storage:', err.message);
  }
}

// Load storage on module initialization
loadFallbackStorage();

/**
 * Validates that the job exists, that post-installation report was submitted,
 * and that the technician is authorized for this job.
 * Enforces privacy: Sales, Coordinator, and Store Manager cannot access expenses.
 */
export async function assertChecklistEligibleForExpenses(checklistId, user) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required');
    err.statusCode = 400;
    throw err;
  }

  // 1. Role Authorization guard: Expenses are strictly private to Technical & Admin
  if (user && user.role && user.role !== 'TECHNICAL' && user.role !== 'ADMIN') {
    const err = new Error('Access denied. Job expenses are restricted to the service engineer and administrator.');
    err.statusCode = 403;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found');
    err.statusCode = 404;
    throw err;
  }

  // 2. Post-Installation Report MUST have been submitted!
  // Criterion 1: The expense form is unavailable before the post-installation report is successfully submitted.
  const completionReport = await getInstallationCompletionReport(checklistId).catch(() => null);
  const statusNorm = (checklist.installation_status || '').toLowerCase().trim();
  const isReportSubmitted = Boolean(
    completionReport ||
    checklist.has_completion_report ||
    statusNorm === 'completed' ||
    statusNorm === 'site work completed'
  );

  if (!isReportSubmitted) {
    const err = new Error(
      'Step 2 — Technician Expenses is unavailable until the post-installation report has been successfully submitted.'
    );
    err.statusCode = 400;
    throw err;
  }

  // 3. Technical user assignment check: Technicians cannot access unauthorized jobs.
  if (user && user.role === 'TECHNICAL') {
    const userEmail = (user.email || '').toLowerCase().trim();
    const userName = (user.full_name || '').toLowerCase().trim();
    const assignedEng = (checklist.service_engineer || '').toLowerCase().trim();
    const assignedAsst = (checklist.service_assistant || '').toLowerCase().trim();

    const isAssigned =
      !assignedEng || // Open/unassigned job
      assignedEng.includes(userName) ||
      userName.includes(assignedEng) ||
      assignedEng.includes(userEmail) ||
      assignedAsst.includes(userName) ||
      assignedAsst.includes(userEmail) ||
      checklist.technician_id === user.id;

    if (!isAssigned) {
      const err = new Error('You are not authorized to view or submit expenses for this job.');
      err.statusCode = 403;
      throw err;
    }
  }

  return { checklist, completionReport };
}

/**
 * Fetch all expenses for a checklist, computing job totals and monthly totals
 */
export async function getExpensesForChecklist(checklistId, user) {
  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found');
    err.statusCode = 404;
    throw err;
  }

  const completionReport = await getInstallationCompletionReport(checklistId).catch(() => null);
  const statusNorm = (checklist.installation_status || '').toLowerCase().trim();
  const isReportSubmitted = Boolean(
    completionReport ||
    checklist.has_completion_report ||
    statusNorm === 'completed' ||
    statusNorm === 'site work completed'
  );

  let expenses = [];
  try {
    const { data, error } = await supabase
      .from('job_expenses')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('expense_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      expenses = data;
    } else {
      // Fallback to in-memory if DB query returned empty or errored
      const inMem = Array.from(inMemoryJobExpenses.values()).filter(
        (e) => e.checklist_id === checklistId
      );
      expenses = inMem.length > 0 ? inMem : (data || []);
    }
  } catch (err) {
    expenses = Array.from(inMemoryJobExpenses.values()).filter(
      (e) => e.checklist_id === checklistId
    );
  }

  // Calculate job totals (strictly distinguishing Recorded vs Draft)
  const recordedExpenses = expenses.filter((e) => e.status === 'Recorded');
  const draftExpenses = expenses.filter((e) => e.status === 'Draft');

  const jobTotal = recordedExpenses.reduce(
    (sum, e) => sum + (parseFloat(e.amount) || 0),
    0
  );
  const draftTotal = draftExpenses.reduce(
    (sum, e) => sum + (parseFloat(e.amount) || 0),
    0
  );

  // Calculate monthly total for authenticated technician
  const techId = user?.id;
  const techName = user?.full_name || checklist.service_engineer;
  const monthlyTotal = await getTechnicianCurrentMonthTotal(techId, techName);

  return {
    checklist_id: checklist.id,
    checklist_number: checklist.checklist_number,
    client_name: checklist.client_name,
    service_engineer: checklist.service_engineer,
    report_submitted: isReportSubmitted,
    expenses,
    job_total: Math.round(jobTotal * 100) / 100,
    draft_total: Math.round(draftTotal * 100) / 100,
    draft_count: draftExpenses.length,
    recorded_count: recordedExpenses.length,
    technician_monthly_total: monthlyTotal,
  };
}

/**
 * Calculates current month total for the technician
 */
export async function getTechnicianCurrentMonthTotal(technicianId, technicianName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const startOfMonth = `${year}-${month}-01`;
  const endOfMonth = `${year}-${month}-31`;

  let monthlyTotal = 0;

  try {
    let query = supabase
      .from('job_expenses')
      .select('amount, status, expense_date')
      .eq('status', 'Recorded')
      .gte('expense_date', startOfMonth)
      .lte('expense_date', endOfMonth);

    if (technicianId) {
      query = query.eq('technician_id', technicianId);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      monthlyTotal = data.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      return Math.round(monthlyTotal * 100) / 100;
    }
  } catch (err) {
    // Fall back to memory
  }

  // In-memory fallback
  const inMem = Array.from(inMemoryJobExpenses.values()).filter((e) => {
    if (e.status !== 'Recorded') return false;
    const isThisMonth = e.expense_date >= startOfMonth && e.expense_date <= endOfMonth;
    if (!isThisMonth) return false;
    if (technicianId && e.technician_id === technicianId) return true;
    if (technicianName && e.technician_name === technicianName) return true;
    return !technicianId && !technicianName;
  });

  monthlyTotal = inMem.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  return Math.round(monthlyTotal * 100) / 100;
}

/**
 * Save multiple expenses for a checklist (Add Expense, Save Draft, Submit Expenses)
 * Strictly preserves idempotency to prevent duplicate entries on network retries.
 */
export async function saveJobExpenses({
  checklist_id,
  user,
  expenses,
  is_draft = false,
  idempotency_key = null,
  delete_ids = [],
}) {
  if (!Array.isArray(expenses) || expenses.length === 0) {
    const err = new Error('At least one expense entry is required.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Verify eligibility (report must be submitted + authorization check)
  const { checklist } = await assertChecklistEligibleForExpenses(checklist_id, user);

  // 2. Idempotency check: if exact idempotency_key was already processed, return existing entries
  if (idempotency_key) {
    try {
      const { data: existingDb } = await supabase
        .from('job_expenses')
        .select('*')
        .eq('idempotency_key', idempotency_key);

      if (Array.isArray(existingDb) && existingDb.length > 0) {
        return {
          success: true,
          idempotent_replay: true,
          count: existingDb.length,
          expenses: existingDb,
          message: 'Expenses previously recorded (idempotent replay).',
        };
      }
    } catch (e) {
      // Check in-memory
    }

    const existingMem = Array.from(inMemoryJobExpenses.values()).filter(
      (e) => e.idempotency_key === idempotency_key
    );
    if (existingMem.length > 0) {
      return {
        success: true,
        idempotent_replay: true,
        count: existingMem.length,
        expenses: existingMem,
        message: 'Expenses previously recorded (idempotent replay).',
      };
    }
  }

  // 3. Validate each expense entry
  const validatedRecords = [];
  const status = is_draft ? 'Draft' : 'Recorded';

  for (let idx = 0; idx < expenses.length; idx++) {
    const exp = expenses[idx];
    const amount = parseFloat(exp.amount);

    if (isNaN(amount) || amount <= 0) {
      const err = new Error(`Expense #${idx + 1}: Amount must be a positive number greater than ₹0.`);
      err.statusCode = 400;
      throw err;
    }

    const category = (exp.category || '').trim();
    if (!EXPENSE_CATEGORIES.includes(category)) {
      const err = new Error(
        `Expense #${idx + 1}: Invalid category "${category}". Must be one of: ${EXPENSE_CATEGORIES.join(', ')}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const paymentMethod = (exp.payment_method || 'Cash').trim();
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      const err = new Error(
        `Expense #${idx + 1}: Invalid payment method "${paymentMethod}". Must be one of: ${PAYMENT_METHODS.join(', ')}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const description = (exp.description || '').trim();
    if (!description) {
      const err = new Error(`Expense #${idx + 1}: Description is required.`);
      err.statusCode = 400;
      throw err;
    }

    const expenseDate = exp.expense_date || new Date().toISOString().split('T')[0];
    const isTempId = !exp.id || String(exp.id).startsWith('new-');
    const recordId = isTempId ? uuidv4() : exp.id;

    validatedRecords.push({
      id: recordId,
      checklist_id,
      technician_id: user?.id || null,
      technician_name: user?.full_name || user?.email || checklist.service_engineer || 'Technician',
      expense_date: expenseDate,
      category,
      description,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      receipt_url: exp.receipt_url || null,
      receipt_filename: exp.receipt_filename || null,
      notes: (exp.notes || '').trim() || null,
      status,
      idempotency_key: idempotency_key || null,
      created_at: exp.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // Handle deletions if any rows were deleted by technician
  if (Array.isArray(delete_ids) && delete_ids.length > 0) {
    try {
      await supabase.from('job_expenses').delete().in('id', delete_ids);
    } catch (delErr) {
      console.warn('DB delete from job_expenses fallback:', delErr.message);
    }
    delete_ids.forEach((did) => {
      inMemoryJobExpenses.delete(did);
    });
  }

  // 4. Persist to DB with fallback to memory
  let insertedData = null;
  try {
    let { data, error } = await supabase
      .from('job_expenses')
      .upsert(validatedRecords, { onConflict: 'id' })
      .select();

    if (error && error.message?.includes('violates foreign key constraint')) {
      const recordsWithNullTech = validatedRecords.map((r) => ({ ...r, technician_id: null }));
      const retryResult = await supabase
        .from('job_expenses')
        .upsert(recordsWithNullTech, { onConflict: 'id' })
        .select();
      if (!retryResult.error && Array.isArray(retryResult.data)) {
        data = retryResult.data;
        error = null;
      }
    }

    if (!error && Array.isArray(data)) {
      insertedData = data;
    } else {
      console.warn('DB upsert into job_expenses failed, using dual-layer fallback:', error?.message);
    }
  } catch (err) {
    console.warn('DB job_expenses upsert exception, using fallback storage:', err.message);
  }

  // Update in-memory fallback
  const recordsToStore = insertedData || validatedRecords;
  recordsToStore.forEach((rec) => {
    inMemoryJobExpenses.set(rec.id, rec);
  });
  saveFallbackStorage();

  // 5. Fetch updated summary
  const summary = await getExpensesForChecklist(checklist_id, user);

  return {
    success: true,
    status,
    count: recordsToStore.length,
    expenses: recordsToStore,
    summary,
    message: is_draft
      ? `Saved ${recordsToStore.length} expense draft(s) successfully.`
      : `Saved ${recordsToStore.length} technician expense(s) successfully.`,
  };
}

/**
 * Generates an A4 print-ready PDF for technician expenses for a checklist
 */
export async function generateTechnicianExpensePDFForChecklist(checklistId, user) {
  // 1. Verify eligibility (report must be submitted + authorization check)
  const { checklist } = await assertChecklistEligibleForExpenses(checklistId, user);

  // 2. Fetch expenses
  const expenseData = await getExpensesForChecklist(checklistId, user);

  // 3. Generate PDF
  const pdfBuffer = await generateTechnicianExpensePDF({
    checklist,
    expenses: expenseData.expenses || [],
    user,
  });

  return {
    pdfBuffer,
    checklist,
    expenses: expenseData.expenses || [],
  };
}

/**
 * Handle receipt file upload (JPEG, PNG, WebP, PDF up to 10MB)
 */
export async function uploadExpenseReceipt({ buffer, originalname, mimetype, checklist_id }) {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedMimes.includes(mimetype)) {
    const err = new Error('Invalid file format. Only JPEG, PNG, WebP, and PDF receipts are accepted.');
    err.statusCode = 400;
    throw err;
  }

  if (buffer.length > 10 * 1024 * 1024) {
    const err = new Error('File exceeds the 10MB maximum receipt file size limit.');
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(originalname) || (mimetype === 'application/pdf' ? '.pdf' : '.jpg');
  const filename = `receipt_${checklist_id || 'job'}_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const filePath = `receipts/${filename}`;

  try {
    const { data, error } = await supabase.storage
      .from('receipts')
      .upload(filePath, buffer, {
        contentType: mimetype,
        upsert: true,
      });

    if (!error && data) {
      // Get public or signed URL
      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(filePath);
      return {
        receipt_url: urlData?.publicUrl || filePath,
        receipt_filename: originalname,
      };
    }
  } catch (err) {
    console.warn('Could not upload receipt to Supabase storage:', err.message);
  }

  // Data URL fallback for in-memory / offline capability
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;
  return {
    receipt_url: dataUrl,
    receipt_filename: originalname,
  };
}
