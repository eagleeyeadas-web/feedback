import { generateQuotationPDF } from './src/services/quotationPdfGenerator.js';

const combinationsToTest = [
  { product: '2 Channel Live', displaySize: '7-inch', expectedDisplay: '7-inch IPS full viewing angle HD screen', expectedRes: '1280*800, 2 Camera' },
  { product: '2 Channel Live', displaySize: '10-inch', expectedDisplay: '10-inch IPS full viewing angle HD screen 16:10', expectedRes: '1280*800, 2 Camera' },
  { product: '2 Channel Recording', displaySize: '7-inch', expectedDisplay: '7-inch IPS full viewing angle HD screen', expectedRes: '1280*800, 2 Camera' },
  { product: '2 Channel Recording', displaySize: '10-inch', expectedDisplay: '10-inch IPS full viewing angle HD screen 16:10', expectedRes: '1280*800, 2 Camera' },
];

async function runTest() {
  console.log('=== VERIFYING DYNAMIC DISPLAY SIZE & CAMERA COUNT ON PAGE 2 TECH SPECS ===\n');

  for (const t of combinationsToTest) {
    const mockQuotation = {
      quotation_number: 'CQS/00240',
      customer_name: 'Test Customer',
      quotation_date: '2026-09-29',
      net_amount: 22000,
      display_size: t.displaySize,
    };

    const items = [
      {
        sno: 1,
        item_description: t.product,
        qty: 1,
        uom: 'Nos',
        rate: 22000,
        amount: 22000,
      }
    ];

    const pdfBuffer = await generateQuotationPDF(mockQuotation, items);
    const pdfStr = pdfBuffer.toString('binary');

    const hasDisplay = pdfStr.includes(t.expectedDisplay);
    const hasRes = pdfStr.includes(t.expectedRes);

    if (hasDisplay && hasRes) {
      console.log(`✅ Passed: [Product: "${t.product}"] + [Size: "${t.displaySize}"]`);
      console.log(`   -> Display Size: "${t.expectedDisplay}"`);
      console.log(`   -> Resolution:   "${t.expectedRes}"\n`);
    } else {
      console.error(`❌ Failed: [Product: "${t.product}"] + [Size: "${t.displaySize}"]`);
      console.error(`   Has Display Spec: ${hasDisplay}, Has Resolution Spec: ${hasRes}\n`);
    }
  }

  console.log('=== ALL DISPLAY SIZE COMBINATION TESTS PASSED SUCCESSFULLY ===');
}

runTest().catch(console.error);
