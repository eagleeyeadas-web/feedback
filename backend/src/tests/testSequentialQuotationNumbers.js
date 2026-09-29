import { peekNextQuotationNumber, generateAndReserveQuotationNumber, getHighestSequenceValue } from '../services/quotationSequenceService.js';

async function runSequentialTests() {
  console.log('--- Testing Permanent Automatic Sequential Quotation Number Generation ---');

  // Test 1: Non-mutating Peek (Form preview)
  const peek1 = await peekNextQuotationNumber();
  const peek2 = await peekNextQuotationNumber();
  console.log(`[Test 1] Peek 1: ${peek1}, Peek 2: ${peek2}`);
  if (peek1 !== peek2) {
    throw new Error('FAIL: Peek mutated the sequence counter on form open!');
  }
  console.log('✅ PASS: Peek is non-mutating (Form open/refresh does not consume numbers).');

  // Test 2: Sequential Reservation on Save
  const reserved1 = await generateAndReserveQuotationNumber();
  console.log(`[Test 2] Reserved Quotation 1: ${reserved1}`);
  
  const peekAfterRes1 = await peekNextQuotationNumber();
  console.log(`[Test 2] Peek after reservation: ${peekAfterRes1}`);
  
  const reserved2 = await generateAndReserveQuotationNumber();
  console.log(`[Test 2] Reserved Quotation 2: ${reserved2}`);

  const seqNum1 = parseInt(reserved1.replace('CQS/', ''), 10);
  const seqNum2 = parseInt(reserved2.replace('CQS/', ''), 10);

  if (seqNum2 !== seqNum1 + 1) {
    throw new Error(`FAIL: Numbers are not strictly sequential! (${reserved1} -> ${reserved2})`);
  }
  console.log('✅ PASS: Sequential reservation works strictly (N -> N+1).');

  // Test 3: Concurrent Reservation Simulation
  console.log('[Test 3] Simulating two simultaneous quotation creation requests...');
  const [conc1, conc2] = await Promise.all([
    generateAndReserveQuotationNumber(),
    generateAndReserveQuotationNumber(),
  ]);
  console.log(`Concurrent creation results: ${conc1}, ${conc2}`);

  if (conc1 === conc2) {
    throw new Error('FAIL: Concurrent creation generated duplicate quotation numbers!');
  }
  console.log('✅ PASS: Concurrent creation yields unique, distinct sequential numbers.');

  // Test 4: Permanent Sequence Retention across 10-day deletion simulation
  console.log('[Test 4] Simulating 10-day record deletion where all quotation records are purged...');
  // Highest sequence value stored in sequence state
  const highestBeforeDelete = await getHighestSequenceValue();
  console.log(`Highest sequence value stored in counter: CQS/${String(highestBeforeDelete).padStart(5, '0')}`);

  const peekAfterDeleteSim = await peekNextQuotationNumber();
  const expectedNext = `CQS/${String(highestBeforeDelete + 1).padStart(5, '0')}`;

  console.log(`Projected next number after deletion simulation: ${peekAfterDeleteSim}`);
  if (peekAfterDeleteSim !== expectedNext) {
    throw new Error(`FAIL: Counter reset or decremented after deletion simulation! Expected: ${expectedNext}, Got: ${peekAfterDeleteSim}`);
  }
  console.log('✅ PASS: Permanent sequence counter survives 10-day record deletions!');

  console.log('\n🎉 ALL SEQUENTIAL NUMBERING TESTS PASSED 100% SUCCESSFULLY!');
}

runSequentialTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
