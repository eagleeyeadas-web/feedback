import { generateQuotationPDF, getFullProductDescription } from '../services/quotationPdfGenerator.js';

const PRODUCT_OPTIONS = [
  '4 Channel Live',
  '4 Channel Recording',
  '2 Channel Live',
  '2 Channel Recording',
  '6 Channel Live',
  '8 Channel Live'
];

async function runTest() {
  console.log('--- Testing PDF Generation for all 6 Product Options ---');

  for (let i = 0; i < PRODUCT_OPTIONS.length; i++) {
    const prodName = PRODUCT_OPTIONS[i];
    const displaySize = i % 2 === 0 ? '10-inch' : '7-inch';
    const sampleQuotation = {
      quotation_number: `TEST-PROD-00${i + 1}`,
      quotation_date: '2026-09-29',
      customer_name: 'Test Customer Pvt Ltd',
      contact_person: 'Mr. Ramesh',
      address: '123 Test Street, Coimbatore',
      phone_number: '9876543210',
      gst_number: '33AAAAA0000A1Z5',
      subtotal: 25000,
      gst_applicable: true,
      gst_type: 'CGST_SGST',
      cgst_pct: 9,
      sgst_pct: 9,
      cgst_amount: 2250,
      sgst_amount: 2250,
      igst_pct: 18,
      igst_amount: 0,
      net_amount: 29500,
      display_size: displaySize,
      terms_conditions: [
        '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
        'Payments are non-refundable once the order has been confirmed and processing has begun.',
      ]
    };

    const expectedFullDesc = getFullProductDescription(prodName, displaySize);

    const sampleItems = [
      {
        sno: 1,
        item_description: prodName,
        hsn_sac: '852589',
        qty: 1,
        uom: 'Nos',
        rate: 25000,
        discount_pct: 0,
        discount_amount: 0,
        amount: 25000,
      }
    ];

    const pdfBuffer = await generateQuotationPDF(sampleQuotation, sampleItems);
    const pdfStr = pdfBuffer.toString('binary');
    
    // Verify that key text from complete description appears in PDF
    const firstFewWords = expectedFullDesc.substring(0, 25);
    const hasText = pdfStr.includes(firstFewWords);

    if (hasText) {
      console.log(`[PASS] Product "${prodName}" (${displaySize}) generated PDF: ${pdfBuffer.length} bytes`);
      console.log(`       Full Desc: "${expectedFullDesc}"`);
    } else {
      console.error(`[FAIL] Product "${prodName}" PDF missing text "${firstFewWords}"`);
      process.exit(1);
    }
  }

  console.log('\n✅ ALL 6 PRODUCTS TESTED SUCCESSFULLY IN PDF GENERATOR WITH FULL DESCRIPTIONS!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

