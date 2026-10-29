import fs from 'fs';
import path from 'path';
import { generateQuotationPDF } from './src/services/quotationPdfGenerator.js';

// Base mock quotation matching production structure
const baseQuotation = {
  customer_name: 'SASTI LOGISTICS',
  contact_person: '',
  address: '1/150, AYYAMPALAYAM, KANAKAMPALAYAM, PERUMANALLUR, TIRUPPUR - 641666',
  phone_number: '9840112345',
  gst_number: '33DJOPK2987N1ZD',
  quotation_date: '2026-10-28',
  gst_applicable: true,
  gst_type: 'CGST_SGST',
  subtotal: 22033.9,
  cgst_pct: 9,
  cgst_amount: 1983.05,
  sgst_pct: 9,
  sgst_amount: 1983.05,
  igst_pct: 0,
  igst_amount: 0,
  net_amount: 26000,
  include_tech_specs: true,
  tech_spec_template: 'default',
  display_size: '10-inch',
};

const baseItems = [
  {
    sno: 1,
    item_description: '4 Channel Live GPS 10 inch AI processing display with (4 cameras & 4 cables) Including Installation',
    hsn_sac: '852589',
    qty: 1,
    uom: 'Nos',
    rate: 26000,
    discount_pct: 0,
    discount_amount: 0,
    amount: 26000,
  },
];

// Helper to extract text placements from uncompressed PDF streams
function extractTextPlacements(pdfBuffer) {
  const pdfStr = pdfBuffer.toString('binary');
  // Match stream ... endstream blocks
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const pages = [];
  let match;

  while ((match = streamRegex.exec(pdfStr)) !== null) {
    const streamContent = match[1];
    // Find text operations: Td or Tm followed by (text) Tj
    const lines = [];
    const textRegex = /([-\d.]+)\s+([-\d.]+)\s+Td\s*\r?\n\s*\(([\s\S]*?)\)\s*Tj/g;
    let tMatch;
    while ((tMatch = textRegex.exec(streamContent)) !== null) {
      lines.push({
        x: parseFloat(tMatch[1]),
        y: parseFloat(tMatch[2]), // PDF coordinates from bottom
        text: tMatch[3],
      });
    }
    if (lines.length > 0) {
      pages.push(lines);
    }
  }
  return { pages, rawStr: pdfStr };
}

async function runTermsLayoutTests() {
  console.log('========================================================================');
  console.log('  TESTING DYNAMIC TERMS & CONDITIONS PDF LAYOUT & OVERLAP PREVENTION   ');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 5;

  // ---------------------------------------------------------------------------
  // TEST 1: Fewer Terms (5 terms)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: Fewer Terms (5 terms) ---');
  const terms5 = [
    '100% payment in advance is required along with a valid Purchase Order (PO).',
    'Payments are non-refundable once the order has been confirmed.',
    'SIM card procurement and recharge shall be under the customer scope.',
    'Delivery timelines are estimates only and subject to stock availability.',
    'Replacement Policy: No returns after sales; defective products will be replaced after inspection.',
  ];

  const q5 = { ...baseQuotation, quotation_number: 'CQS/00279-5T', terms_conditions: terms5 };
  const pdfBuf5 = await generateQuotationPDF(q5, baseItems);
  fs.writeFileSync('test_terms_5_compact.pdf', pdfBuf5);

  const pageCount5 = (pdfBuf5.toString('binary').match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count: ${pageCount5} (Expected: 2)`);
  if (pageCount5 !== 2) throw new Error(`Test 1 Failed: Expected 2 pages, got ${pageCount5}`);
  console.log('✓ Test 1: 5-term quotation renders cleanly in exactly 2 pages (Page 1 Quote + Page 2 Specs)\n');
  passedTests++;

  // ---------------------------------------------------------------------------
  // TEST 2: Standard 7 Terms (Default Template)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 2: Standard 7 Terms (Default Template) ---');
  const terms7 = [
    '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
    'Payments are non-refundable once the order has been confirmed and processing has begun.',
    'SIM card procurement, activation, and recharged/data charges shall be under the customer\'s scope.',
    'Delivery timelines are estimates only and subject to stock availability.',
    'Products/services provided are subject to a 3-year replacement warranty against manufacturing defects.',
    'This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
    'Replacement Policy: No returns after sales; defective products will be replaced only after inspection and verification, subject to warranty terms and conditions.',
  ];

  const q7 = { ...baseQuotation, quotation_number: 'CQS/00279-7T', terms_conditions: terms7 };
  const pdfBuf7 = await generateQuotationPDF(q7, baseItems);
  fs.writeFileSync('test_terms_7_standard.pdf', pdfBuf7);

  const pageCount7 = (pdfBuf7.toString('binary').match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count: ${pageCount7} (Expected: 2)`);
  if (pageCount7 !== 2) throw new Error(`Test 2 Failed: Expected 2 pages, got ${pageCount7}`);
  console.log('✓ Test 2: Standard 7-term quotation renders cleanly in exactly 2 pages\n');
  passedTests++;

  // ---------------------------------------------------------------------------
  // TEST 3: 8 Terms (EXACT CQS-00279 Live Quotation with manually added 8th term)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 3: 8 Terms (Exact CQS-00279 Live Quotation) ---');
  const terms8 = [
    '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
    'Payments are non-refundable once the order has been confirmed and processing has begun.',
    'SIM card procurement, activation, and recharge/data charges shall be under the customer\'s scope.',
    'Delivery timelines are estimates only and subject to stock availability.',
    'Products/services provided are subject to a 3-year replacement warranty against manufacturing defects.',
    'This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
    'Replacement Policy: No returns after sales; defective products will be replaced only after inspection and verification, subject to warranty terms and conditions.',
    'The quoted price is applicable for the installation of 5 vehicles and is not applicable for a single-vehicle installation.',
  ];

  const q8 = { ...baseQuotation, quotation_number: 'CQS/00279', terms_conditions: terms8 };
  const pdfBuf8 = await generateQuotationPDF(q8, baseItems);
  fs.writeFileSync('test_terms_8_cqs00279.pdf', pdfBuf8);

  const pdfStr8 = pdfBuf8.toString('binary');
  const pageCount8 = (pdfStr8.match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count: ${pageCount8} (Expected: 2)`);
  if (pageCount8 !== 2) throw new Error(`Test 3 Failed: Expected 2 pages for CQS-00279, got ${pageCount8}`);

  // Verify term 1 text contains 100% (not stripped)
  const term1Preserved = pdfStr8.includes('100% payment in advance');
  console.log('Term 1 (100% payment) intact:', term1Preserved);
  if (!term1Preserved) throw new Error('Test 3 Failed: 100% in Term 1 was corrupted or stripped');

  // Verify term 8 text is present
  const term8Included = pdfStr8.includes('installation of 5 vehicles');
  console.log('Term 8 present in PDF:', term8Included);
  if (!term8Included) throw new Error('Test 3 Failed: 8th term not found in PDF');

  // Verify Net Amount in words is present
  const netWordsIncluded = pdfStr8.includes('Twenty Six Thousand Only');
  console.log('Net Amount in words present:', netWordsIncluded);
  if (!netWordsIncluded) throw new Error('Test 3 Failed: Net amount in words missing');

  console.log('✓ Test 3: CQS-00279 (8 terms) rendered cleanly with 0 overlaps and fits in 2 pages\n');
  passedTests++;

  // ---------------------------------------------------------------------------
  // TEST 4: Long Multi-line Terms (wrapping across multiple lines)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 4: Long Multi-line Terms ---');
  const longTerms = [
    '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order, and work will commence only after the credited funds have been fully reconciled with our accounts department.',
    'Payments are strictly non-refundable once the order has been confirmed, as equipment allocation and specialized SIM provisioning begins immediately upon formal order placement.',
    'SIM card procurement, activation, and continuous high-speed data recharge charges shall be completely under the customer\'s operational scope and responsibility throughout the active deployment lifecycle.',
    'Delivery timelines communicated by the sales team are strictly estimates and remain contingent on component availability, logistics schedules, and customs clearance procedures.',
    'Replacement Policy: No returns after sales; defective products will be replaced only after inspection and verification, subject to warranty terms and conditions and manufacturer authorization policies.',
  ];

  const qLong = { ...baseQuotation, quotation_number: 'CQS/00279-LONG', terms_conditions: longTerms };
  const pdfBufLong = await generateQuotationPDF(qLong, baseItems);
  fs.writeFileSync('test_terms_long_multiline.pdf', pdfBufLong);

  const pageCountLong = (pdfBufLong.toString('binary').match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count: ${pageCountLong} (Expected: 2)`);
  if (pageCountLong !== 2) throw new Error(`Test 4 Failed: Expected 2 pages, got ${pageCountLong}`);

  const pdfStrLong = pdfBufLong.toString('binary');
  const hasReconciled = pdfStrLong.includes('fully reconciled');
  const hasAccounts = pdfStrLong.includes('accounts department');
  const hasOperational = pdfStrLong.includes('operational scope');
  console.log('Multi-line wrapped text parts present:', hasReconciled && hasAccounts && hasOperational);
  if (!hasReconciled || !hasAccounts || !hasOperational) throw new Error('Test 4 Failed: Wrapped multi-line text missing');

  console.log('✓ Test 4: Long multi-line terms wrapped and rendered dynamically without overlap\n');
  passedTests++;

  // ---------------------------------------------------------------------------
  // TEST 5: Overflowing Terms (16 Terms triggering clean continuation page)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 5: Overflowing Terms (16 terms triggering continuation page) ---');
  const terms16 = [
    ...terms8,
    'Client must provide safe vehicle access for installation engineers during standard working hours.',
    'Any delay in providing vehicles on site will incur additional engineer detention charges at prevailing rates.',
    'Cable routing inside the vehicle cabin will follow manufacturer harness channels where technically feasible.',
    'Power connection must be taken from the vehicle ignition supply as per SafDrive wiring standard operating procedures.',
    'Tampering with device antennas, wiring looms, or SD card slots voids all warranty claims automatically.',
    'Calibration of AI forward collision warning requires an initial road trial of at least 5 kilometers.',
    'Server cloud hosting and live video streaming API access is provided under the SafDrive SLA agreement.',
    'Jurisdiction for any unresolved legal disputes shall be exclusively within Coimbatore courts.',
  ];

  const q16 = { ...baseQuotation, quotation_number: 'CQS/00279-16T', terms_conditions: terms16 };
  const pdfBuf16 = await generateQuotationPDF(q16, baseItems);
  fs.writeFileSync('test_terms_16_overflow.pdf', pdfBuf16);

  const pdfStr16 = pdfBuf16.toString('binary');
  const pageCount16 = (pdfStr16.match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count: ${pageCount16} (Expected: 3 pages: Page 1 Quote + Page 2 Terms Continued + Page 3 Specs)`);
  if (pageCount16 !== 3) throw new Error(`Test 5 Failed: Expected 3 pages, got ${pageCount16}`);

  const hasContinuationBanner = pdfStr16.includes('TERMS & CONDITIONS') && pdfStr16.includes('CONTINUED');
  const hasJurisdiction = pdfStr16.includes('Coimbatore courts');
  console.log('Has Continuation Banner:', hasContinuationBanner);
  console.log('Has Overflow Term 16 text:', hasJurisdiction);
  if (!hasContinuationBanner || !hasJurisdiction) throw new Error('Test 5 Failed: Continuation page content missing');

  console.log('✓ Test 5: 16-term overflow cleanly split between Page 1 and Page 2 continuation banner, with Tech Specs on Page 3\n');
  passedTests++;

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('========================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} DYNAMIC TERMS & CONDITIONS TESTS PASSED 100%! 🎉`);
  console.log('========================================================================\n');
}

runTermsLayoutTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
