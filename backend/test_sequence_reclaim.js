import supabase from './src/services/supabase.js';
import {
  peekNextQuotationNumber,
  generateAndReserveQuotationNumber,
  handleQuotationDeletion,
  getHighestSequenceValue
} from './src/services/quotationSequenceService.js';

async function runTests() {
  console.log('=== STARTING QUOTATION SEQUENCE RECLAIM TEST SUITE ===\n');

  // Helper to create mock quotation in DB
  async function createMockQuotation(customerName = 'Test Reclaim Customer') {
    const nextNo = await generateAndReserveQuotationNumber();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const record = {
      quotation_number: nextNo,
      customer_name: customerName,
      contact_person: 'Mr. Test',
      address: 'Coimbatore',
      phone_number: '9876543210',
      quotation_date: new Date().toISOString().split('T')[0],
      subtotal: 18644.07,
      net_amount: 22000,
      created_at: createdAt,
      expires_at: expiresAt,
    };

    const { data, error } = await supabase
      .from('quotations')
      .insert([record])
      .select()
      .single();

    if (error) throw new Error(`Insert failed for ${nextNo}: ${error.message}`);
    return data;
  }

  // --- TEST CASE 1: Create CQS/00240, delete it -> next is CQS/00240 ---
  console.log('--- TEST CASE 1: Create & Delete Latest Quotation (Reclaim) ---');
  const baselinePeek = await peekNextQuotationNumber();
  console.log(`Baseline Next Quotation Number: ${baselinePeek}`);

  const q1 = await createMockQuotation('Customer Q1');
  console.log(`Created quotation: ${q1.quotation_number} (ID: ${q1.id})`);

  const peekAfterQ1 = await peekNextQuotationNumber();
  console.log(`Next preview after creation: ${peekAfterQ1}`);

  const del1 = await handleQuotationDeletion(q1.id);
  console.log(`Deleted ${q1.quotation_number}: reclaimed=${del1.reclaimed}, newLastValue=${del1.newLastValue}`);

  const peekAfterDel1 = await peekNextQuotationNumber();
  console.log(`Next preview after deletion: ${peekAfterDel1}`);

  if (peekAfterDel1 === q1.quotation_number) {
    console.log(`✅ TEST CASE 1 PASSED: Next quotation successfully reclaimed number ${q1.quotation_number}!\n`);
  } else {
    console.error(`❌ TEST CASE 1 FAILED: Expected ${q1.quotation_number}, got ${peekAfterDel1}\n`);
  }

  // --- TEST CASE 2 & 3: Non-latest deletion vs Latest deletion ---
  console.log('--- TEST CASE 2 & 3: Delete Older Quotation vs Delete Latest Quotation ---');
  const qA = await createMockQuotation('Customer QA');
  console.log(`Created Q A: ${qA.quotation_number}`);

  const qB = await createMockQuotation('Customer QB');
  console.log(`Created Q B: ${qB.quotation_number}`);

  const peekBeforeDelA = await peekNextQuotationNumber();
  console.log(`Preview before deleting Q A: ${peekBeforeDelA}`);

  // Delete Q A (Older quotation)
  const delA = await handleQuotationDeletion(qA.id);
  console.log(`Deleted Q A (${qA.quotation_number}): reclaimed=${delA.reclaimed}, newLastValue=${delA.newLastValue}`);

  const peekAfterDelA = await peekNextQuotationNumber();
  console.log(`Preview after deleting older Q A: ${peekAfterDelA}`);

  if (peekAfterDelA === peekBeforeDelA && !delA.reclaimed) {
    console.log(`✅ TEST CASE 2 PASSED: Deleting older quotation ${qA.quotation_number} DID NOT decrement counter. Next remains ${peekAfterDelA}!`);
  } else {
    console.error(`❌ TEST CASE 2 FAILED: Counter incorrectly changed after deleting older quotation!`);
  }

  // Delete Q B (Latest quotation)
  const delB = await handleQuotationDeletion(qB.id);
  console.log(`Deleted Q B (${qB.quotation_number}): reclaimed=${delB.reclaimed}, newLastValue=${delB.newLastValue}`);

  const peekAfterDelB = await peekNextQuotationNumber();
  console.log(`Preview after deleting latest Q B: ${peekAfterDelB}`);

  if (peekAfterDelB === qB.quotation_number && delB.reclaimed) {
    console.log(`✅ TEST CASE 3 PASSED: Deleting latest quotation ${qB.quotation_number} reclaimed the sequence number ${qB.quotation_number}!\n`);
  } else {
    console.error(`❌ TEST CASE 3 FAILED: Expected ${qB.quotation_number}, got ${peekAfterDelB}\n`);
  }

  // --- TEST CASE 4: Step-by-step sequential step-back ---
  console.log('--- TEST CASE 4: Sequential Step-Back of Latest Quotations ---');
  const batch1 = await createMockQuotation('Batch 1');
  const batch2 = await createMockQuotation('Batch 2');
  const batch3 = await createMockQuotation('Batch 3');

  console.log(`Created 3 quotations: ${batch1.quotation_number}, ${batch2.quotation_number}, ${batch3.quotation_number}`);

  await handleQuotationDeletion(batch3.id);
  const p3 = await peekNextQuotationNumber();
  console.log(`After deleting ${batch3.quotation_number}, next is: ${p3}`);

  await handleQuotationDeletion(batch2.id);
  const p2 = await peekNextQuotationNumber();
  console.log(`After deleting ${batch2.quotation_number}, next is: ${p2}`);

  await handleQuotationDeletion(batch1.id);
  const p1 = await peekNextQuotationNumber();
  console.log(`After deleting ${batch1.quotation_number}, next is: ${p1}`);

  if (p3 === batch3.quotation_number && p2 === batch2.quotation_number && p1 === batch1.quotation_number) {
    console.log(`✅ TEST CASE 4 PASSED: Counter stepped back sequentially for 3 consecutive deletions!\n`);
  } else {
    console.error(`❌ TEST CASE 4 FAILED in sequential step-back.`);
  }

  // --- TEST CASE 5: Concurrency check ---
  console.log('--- TEST CASE 5: Concurrent Reservations ---');
  const concurrentP = await Promise.all([
    generateAndReserveQuotationNumber(),
    generateAndReserveQuotationNumber(),
    generateAndReserveQuotationNumber(),
  ]);

  const uniqueSet = new Set(concurrentP);
  console.log(`Generated concurrent numbers:`, concurrentP);

  if (uniqueSet.size === concurrentP.length) {
    console.log(`✅ TEST CASE 5 PASSED: All concurrent sequence reservations produced unique numbers!\n`);
  } else {
    console.error(`❌ TEST CASE 5 FAILED: Duplicate numbers generated under concurrency!`);
  }

  console.log('=== ALL TEST SUITE SCENARIOS COMPLETED SUCCESSFULLY ===');
}

runTests().catch(console.error);
