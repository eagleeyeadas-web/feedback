import fs from 'fs';
import path from 'path';
import supabase from './supabase.js';

const SEQUENCE_FILE_PATH = path.resolve(process.cwd(), 'assets/quotation_sequence.json');

// In-memory mutex lock for atomic sequence operations
let isLockAcquired = false;
const lockQueue = [];

async function acquireLock() {
  return new Promise((resolve) => {
    if (!isLockAcquired) {
      isLockAcquired = true;
      resolve();
    } else {
      lockQueue.push(resolve);
    }
  });
}

function releaseLock() {
  if (lockQueue.length > 0) {
    const nextResolve = lockQueue.shift();
    nextResolve();
  } else {
    isLockAcquired = false;
  }
}

/**
 * Reads local sequence backup file
 */
function readLocalSequence() {
  try {
    if (fs.existsSync(SEQUENCE_FILE_PATH)) {
      const content = fs.readFileSync(SEQUENCE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.last_value === 'number') {
        return parsed.last_value;
      }
    }
  } catch (err) {
    console.warn('Could not read local sequence file:', err.message);
  }
  return 238; // Default baseline (so next is CQS/00239)
}

/**
 * Writes local sequence backup file
 */
function writeLocalSequence(val) {
  try {
    const dir = path.dirname(SEQUENCE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SEQUENCE_FILE_PATH, JSON.stringify({ last_value: val, updated_at: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn('Could not write local sequence file:', err.message);
  }
}

/**
 * Inspects existing database quotations for the maximum numeric CQS/ sequence
 */
async function getMaxSequenceFromQuotationsTable() {
  try {
    const { data: quotations } = await supabase
      .from('quotations')
      .select('quotation_number');

    let maxVal = 238;

    if (quotations && quotations.length > 0) {
      for (const q of quotations) {
        if (q.quotation_number && typeof q.quotation_number === 'string') {
          const match = q.quotation_number.match(/^CQS\/([0-9]+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxVal) {
              maxVal = num;
            }
          }
        }
      }
    }
    return maxVal;
  } catch (err) {
    console.warn('Error reading quotations table max sequence:', err.message);
    return 238;
  }
}

/**
 * Gets current highest issued sequence number across DB sequence table, DB records, and local backup
 */
export async function getHighestSequenceValue() {
  await acquireLock();
  try {
    return await getHighestSequenceValueInternal();
  } finally {
    releaseLock();
  }
}

async function getHighestSequenceValueInternal() {
  const localVal = readLocalSequence();
  const dbMaxVal = await getMaxSequenceFromQuotationsTable();

  let dbSeqVal = 0;
  try {
    const { data: seqRow } = await supabase
      .from('quotation_sequence')
      .select('last_value')
      .eq('id', 1)
      .maybeSingle();

    if (seqRow && typeof seqRow.last_value === 'number') {
      dbSeqVal = seqRow.last_value;
    }
  } catch {
    // Table may not exist yet
  }

  // If quotation_sequence DB table row exists, sync local backup with dbSeqVal
  if (dbSeqVal > 0 && localVal !== dbSeqVal) {
    writeLocalSequence(dbSeqVal);
  }

  const highest = Math.max(dbSeqVal > 0 ? dbSeqVal : localVal, dbMaxVal, 238);
  return highest;
}

/**
 * NON-MUTATING: Previews the next quotation number without burning/incrementing the sequence counter.
 * Safe to call on form load or page refresh.
 */
export async function peekNextQuotationNumber() {
  const currentHighest = await getHighestSequenceValue();
  const nextVal = currentHighest + 1;
  return `CQS/${String(nextVal).padStart(5, '0')}`;
}

/**
 * ATOMIC & MUTATING: Generates, reserves, and updates the sequence counter when a quotation is saved.
 */
export async function generateAndReserveQuotationNumber(userSubmittedNo = null) {
  await acquireLock();
  try {
    const highest = await getHighestSequenceValueInternal();
    let nextVal = highest + 1;

    // If user passed a valid CQS/ number, check if it pushes sequence further
    if (userSubmittedNo && typeof userSubmittedNo === 'string') {
      const match = userSubmittedNo.match(/^CQS\/([0-9]+)$/);
      if (match) {
        const submittedSeq = parseInt(match[1], 10);
        if (!isNaN(submittedSeq) && submittedSeq > highest) {
          nextVal = submittedSeq;
        }
      }
    }

    // Check for collision against database
    let candidateNo = `CQS/${String(nextVal).padStart(5, '0')}`;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 50) {
      const { data: existing } = await supabase
        .from('quotations')
        .select('id')
        .eq('quotation_number', candidateNo)
        .maybeSingle();

      if (existing) {
        nextVal += 1;
        candidateNo = `CQS/${String(nextVal).padStart(5, '0')}`;
        attempts += 1;
      } else {
        exists = false;
      }
    }

    // Update sequence counter in database
    try {
      await supabase.from('quotation_sequence').upsert({
        id: 1,
        last_value: nextVal,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Could not update quotation_sequence table in Supabase:', err.message);
    }

    // Update local backup file
    writeLocalSequence(nextVal);

    return candidateNo;
  } finally {
    releaseLock();
  }
}

/**
 * ATOMIC & MUTATING: Handles quotation deletion and sequence number reclaiming.
 * If the deleted quotation is the latest issued sequence number, decrements the sequence counter by 1.
 * If it is an older quotation, deletes the record without decrementing the counter.
 */
export async function handleQuotationDeletion(quotationId) {
  await acquireLock();
  try {
    // 1. Fetch quotation record to check quotation_number and pdf_path
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, quotation_number, pdf_path')
      .eq('id', quotationId)
      .maybeSingle();

    if (fetchError || !quotation) {
      return { success: false, error: 'Quotation record not found' };
    }

    const qNo = quotation.quotation_number;
    const pdfPath = quotation.pdf_path;

    // Extract numeric sequence from quotation_number (e.g. 240 from CQS/00240)
    let deletedSeq = null;
    if (qNo && typeof qNo === 'string') {
      const match = qNo.match(/^CQS\/([0-9]+)$/);
      if (match) {
        deletedSeq = parseInt(match[1], 10);
      }
    }

    // Attempt RPC execution for atomic PostgreSQL transaction
    let rpcSuccess = false;
    let reclaimed = false;
    let newLastValue = null;

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_quotation_and_reclaim_number', {
        p_quotation_id: quotationId,
      });

      if (!rpcError && rpcResult && rpcResult.success) {
        rpcSuccess = true;
        reclaimed = rpcResult.reclaimed;
        newLastValue = rpcResult.new_last_value;
      }
    } catch {
      // Fallback to JS execution if RPC function is not installed yet
    }

    // JS Fallback execution
    if (!rpcSuccess) {
      let currentSeqVal = 0;
      try {
        const { data: seqRow } = await supabase
          .from('quotation_sequence')
          .select('last_value')
          .eq('id', 1)
          .maybeSingle();
        if (seqRow && typeof seqRow.last_value === 'number') {
          currentSeqVal = seqRow.last_value;
        }
      } catch { /* ignore */ }

      if (!currentSeqVal) {
        currentSeqVal = readLocalSequence();
      }

      // Delete quotation record from DB
      const { error: deleteErr } = await supabase
        .from('quotations')
        .delete()
        .eq('id', quotationId);

      if (deleteErr) {
        return { success: false, error: deleteErr.message };
      }

      // If deleted sequence equals current sequence counter, decrement counter
      if (deletedSeq !== null && currentSeqVal > 0 && deletedSeq === currentSeqVal) {
        const decremented = Math.max(currentSeqVal - 1, 238);
        try {
          await supabase.from('quotation_sequence').upsert({
            id: 1,
            last_value: decremented,
            updated_at: new Date().toISOString(),
          });
        } catch { /* ignore */ }
        reclaimed = true;
        newLastValue = decremented;
      } else {
        newLastValue = currentSeqVal;
      }
    }

    // Remove associated PDF file from Supabase storage if pdfPath exists
    if (pdfPath) {
      try {
        await supabase.storage.from('pdfs').remove([pdfPath]);
      } catch (err) {
        console.warn('Storage removal warning during quotation delete:', err.message);
      }
    }

    // Sync local sequence backup file
    if (typeof newLastValue === 'number' && newLastValue > 0) {
      writeLocalSequence(newLastValue);
    }

    return {
      success: true,
      quotationNumber: qNo,
      reclaimed,
      newLastValue,
    };
  } finally {
    releaseLock();
  }
}
