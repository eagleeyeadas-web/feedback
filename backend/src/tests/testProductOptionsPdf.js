import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';
import fs from 'fs';
import path from 'path';

const PRODUCT_OPTIONS = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '8 Channel Live',
  '8 Channel Recording'
];

async function runTest() {
  console.log('--- Testing PDF Generation for all 6 Product Options ---');

  for (let i = 0; i < PRODUCT_OPTIONS.length; i++) {
    const prodName = PRODUCT_OPTIONS[i];
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
      terms_and_conditions: [
        '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
        'Payments are non-refundable once the order has been confirmed and processing has begun.',
      ]
    };

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
    console.log(`[PASS] Product "${prodName}" generated PDF: ${pdfBuffer.length} bytes`);
  }

  console.log('✅ ALL 6 PRODUCTS TESTED SUCCESSFULLY IN PDF GENERATOR!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
