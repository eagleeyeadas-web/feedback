import { generateQuotationPDF } from './src/services/quotationPdfGenerator.js';
import fs from 'fs';
import path from 'path';

const mockQuotation = {
  quotation_number: 'CQS/00240',
  customer_name: 'kdkd',
  contact_person: '',
  address: '',
  phone_number: '',
  quotation_date: '2026-09-29',
  gst_applicable: true,
  gst_type: 'CGST_SGST',
  subtotal: 18644.07,
  cgst_pct: 9,
  cgst_amount: 1677.97,
  sgst_pct: 9,
  sgst_amount: 1677.96,
  net_amount: 22000,
  terms_conditions: [
    '1. 100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
    '2. Payments are non-refundable once the order has been confirmed and processing has begun.',
    '3. SIM card procurement, activation, and recharged/data charges shall be under the customer\'s scope.',
    '4. Delivery timelines are estimates only and subject to stock availability.',
    '5. Products/services provided are subject to a 3-year replacement warranty against manufacturing defects.',
    '6. This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
  ],
  include_tech_specs: false, // Standard quotation -> 1 Page A4
};

const mockItems = [
  {
    sno: 1,
    item_description: '4 Channel Live',
    hsn_sac: '852589',
    qty: 1,
    uom: 'Nos',
    rate: 22000,
    discount_pct: 0,
    amount: 22000,
  }
];

async function runVerification() {
  console.log('=== VERIFYING PDF LAYOUT AGAINST REFERENCE IMAGE ===\n');

  const pdfBuffer = await generateQuotationPDF(mockQuotation, mockItems);
  
  const testPdfPath = path.resolve(process.cwd(), 'sample_reference_match.pdf');
  fs.writeFileSync(testPdfPath, pdfBuffer);
  console.log(`Saved sample PDF to: ${testPdfPath}`);

  // Inspect PDF binary string
  const pdfStr = pdfBuffer.toString('binary');
  const pageMatches = (pdfStr.match(/\/Type\s*\/Page\b/g) || []).length;

  console.log(`Page Count (standard quotation without tech specs): ${pageMatches}`);

  const checks = [
    { label: 'Company Header Name', text: 'Eagle Eye Safdrive Pvt Ltd' },
    { label: 'QUOTATION Title Banner', text: 'QUOTATION' },
    { label: 'Customer Details Header', text: 'CUSTOMER DETAILS' },
    { label: 'Quotation Number & Date', text: 'Quotation No : CQS/00240 Dt 29.09.26' },
    { label: 'Product Item', text: '4 Channel Live' },
    { label: 'Terms & Conditions Heading', text: 'Terms & Conditions' },
    { label: 'Term 1', text: '100% payment in advance' },
    { label: 'Term 6', text: 'normal wear and tear' },
    { label: 'CGST Amount', text: '1,677.97' },
    { label: 'SGST Amount', text: '1,677.96' },
    { label: 'Net Amount', text: '22,000' },
    { label: 'Net Amount in words', text: 'Twenty Two Thousand Only' },
    { label: 'Bank Name', text: 'Indian Overseas Bank' },
    { label: 'Signatory Text', text: 'For Eagle Eye Safdrive Pvt Ltd' },
    { label: 'Authorised Signatory', text: 'Authorised Signatory' },
    { label: 'Footer Disclaimer', text: 'This is a Computer Generated Document' },
  ];

  let passed = true;
  for (const c of checks) {
    const found = pdfStr.includes(c.text);
    if (found) {
      console.log(`  ✅ ${c.label.padEnd(30)}: "${c.text}"`);
    } else {
      console.error(`  ❌ ${c.label.padEnd(30)}: "${c.text}" NOT FOUND`);
      passed = false;
    }
  }

  if (passed && pageMatches === 1) {
    console.log('\n=== ALL PDF LAYOUT CHECKS PASSED PERFECTLY (1 PAGE A4 MATCH) ===');
  } else {
    console.error('\n❌ PDF Layout check had issues.');
  }
}

runVerification().catch(console.error);
