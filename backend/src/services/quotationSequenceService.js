import fs from 'fs';
import path from 'path';
import supabase from './supabase.js';

const SEQUENCE_FILE_PATH = path.resolve(process.cwd(), 'assets/quotation_sequence.json');

// In-memory mutex lock for atomic sequence increment
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
  return 230; // Default baseline (so next is CQS/00231)
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

    let maxVal = 230;

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
    return 230;
  }
}

/**
 * Gets current highest issued sequence number across DB sequence table, DB records, and local backup
 */
export async function getHighestSequenceValue() {
  await acquireLock();
  try {
    const localVal = readLocalSequence();
    const dbMaxVal = await getMaxSequenceFromQuotationsTable();

    // Try fetching from quotation_sequence table in Supabase
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

    const highest = Math.max(localVal, dbMaxVal, dbSeqVal, 230);
    return highest;
  } finally {
    releaseLock();
  }
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
 * Ensures numbers are NEVER reused even after 10-day record deletions.
 */
export async function generateAndReserveQuotationNumber(userSubmittedNo = null) {
  await acquireLock();
  try {
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
      // Ignore
    }

    let highest = Math.max(localVal, dbMaxVal, dbSeqVal, 230);
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
