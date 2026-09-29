import { peekNextQuotationNumber, generateAndReserveQuotationNumber } from '../services/quotationSequenceService.js';

async function testSequence239() {
  console.log('--- Verifying Quotation Sequence: Next Must Be CQS/00239 ---');

  // 1. Non-mutating preview
  const peek1 = await peekNextQuotationNumber();
  const peek2 = await peekNextQuotationNumber();
  console.log(`Peek 1: ${peek1}`);
  console.log(`Peek 2: ${peek2}`);

  if (peek1 !== 'CQS/00239' || peek2 !== 'CQS/00239') {
    throw new Error(`FAIL: Expected next quotation preview to be CQS/00239, got ${peek1}`);
  }
  console.log('✅ PASS: Form preview returns CQS/00239 without consuming sequence.');

  // 2. Reserving quotation upon save
  const created1 = await generateAndReserveQuotationNumber();
  console.log(`Saved Quotation 1: ${created1}`);
  if (created1 !== 'CQS/00239') {
    throw new Error(`FAIL: Expected first reserved quotation to be CQS/00239, got ${created1}`);
  }
  console.log('✅ PASS: First created quotation successfully received CQS/00239!');

  // 3. Subsequent quotation creation
  const peekNext = await peekNextQuotationNumber();
  console.log(`Next peek after CQS/00239 save: ${peekNext}`);
  if (peekNext !== 'CQS/00240') {
    throw new Error(`FAIL: Expected next preview to be CQS/00240, got ${peekNext}`);
  }

  const created2 = await generateAndReserveQuotationNumber();
  console.log(`Saved Quotation 2: ${created2}`);
  if (created2 !== 'CQS/00240') {
    throw new Error(`FAIL: Expected second reserved quotation to be CQS/00240, got ${created2}`);
  }
  console.log('✅ PASS: Subsequent quotation creation correctly generated CQS/00240!');

  console.log('\n🎉 VERIFICATION SUCCESS: Sequence CQS/00239 -> CQS/00240 is 100% verified!');
}

testSequence239().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
