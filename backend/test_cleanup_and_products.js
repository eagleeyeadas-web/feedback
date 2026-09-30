import { runFullCleanup, runFeedbackPdfCleanup, runQuotationCleanup } from './src/services/quotationCleanupService.js';
import { PRODUCT_OPTIONS } from './src/services/quotationPdfGenerator.js';

async function verify() {
  console.log('=== VERIFICATION TEST SUITE ===');

  console.log('\n--- 1. Testing Product Options in Quotation Generator ---');
  console.log('Product Options:', PRODUCT_OPTIONS);
  const expectedProducts = [
    '2 Channel Live',
    '2 Channel Recording',
    '4 Channel Live',
    '4 Channel Recording',
    '6 Channel Live',
    '8 Channel Live',
  ];
  
  const matches = expectedProducts.length === PRODUCT_OPTIONS.length && 
    expectedProducts.every((val, index) => val === PRODUCT_OPTIONS[index]);

  if (matches) {
    console.log('✅ Product options match the exact 6 options required!');
  } else {
    console.error('❌ Product options mismatch:', PRODUCT_OPTIONS);
  }

  console.log('\n--- 2. Testing Combined Cleanup Engine ---');
  const cleanupResult = await runFullCleanup();
  console.log('Cleanup Result:', JSON.stringify(cleanupResult, null, 2));

  console.log('\n=== VERIFICATION COMPLETE ===');
}

verify().catch(console.error);
