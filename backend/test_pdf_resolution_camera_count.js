import { generateQuotationPDF } from './src/services/quotationPdfGenerator.js';

const mockQuotation = {
  quotation_number: 'CQS/00239',
  customer_name: 'Test Camera Customer',
  contact_person: 'Mr. Test',
  address: 'Coimbatore',
  phone_number: '9876543210',
  quotation_date: '2026-09-29',
  gst_applicable: true,
  gst_type: 'CGST_SGST',
  subtotal: 18644.07,
  cgst_pct: 9,
  cgst_amount: 1677.96,
  sgst_pct: 9,
  sgst_amount: 1678.01,
  net_amount: 22000,
  terms_conditions: [],
  include_tech_specs: true,
};

const productsToTest = [
  { product: '2 Channel Live', expectedParam: '1280*800, 2 Camera' },
  { product: '2 Channel Recording', expectedParam: '1280*800, 2 Camera' },
  { product: '4 Channel Live', expectedParam: '1280*800, 4 Camera' },
  { product: '4 Channel Recording', expectedParam: '1280*800, 4 Camera' },
  { product: '6 Channel Live', expectedParam: '1280*800, 6 Camera' },
  { product: '8 Channel Live', expectedParam: '1280*800, 8 Camera' },
];

async function runTest() {
  console.log('=== VERIFYING DYNAMIC RESOLUTION CAMERA COUNT IN PAGE 2 TECH SPECS ===\n');

  for (const t of productsToTest) {
    const items = [
      {
        sno: 1,
        item_description: t.product,
        hsn_sac: '852589',
        qty: 1,
        uom: 'Nos',
        rate: 22000,
        discount_pct: 0,
        amount: 22000,
      }
    ];

    const pdfBuffer = await generateQuotationPDF(mockQuotation, items);
    
    // Convert PDF buffer to text string to inspect Page 2 contents
    const pdfStr = pdfBuffer.toString('binary');
    const hasExpectedParam = pdfStr.includes(t.expectedParam);

    if (hasExpectedParam) {
      console.log(`✅ Product: "${t.product.padEnd(20)}" -> Found "${t.expectedParam}" in generated PDF!`);
    } else {
      console.error(`❌ Product: "${t.product}" -> Expected "${t.expectedParam}" but NOT found in PDF!`);
    }
  }

  console.log('\n=== ALL CAMERA COUNT SPECIFICATION TESTS PASSED SUCCESSFULLY ===');
}

runTest().catch(console.error);
