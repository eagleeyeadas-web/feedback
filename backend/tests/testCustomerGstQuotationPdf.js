import { generateQuotationPDF } from '../src/services/quotationPdfGenerator.js';
import fs from 'fs';
import path from 'path';

async function runCustomerGstTests() {
  console.log('=== TEST SUITE: CUSTOMER GST NUMBER IN GENERATED QUOTATION PDF ===\n');

  let passedAll = true;

  // -------------------------------------------------------------
  // Test 1: Quotation with Customer GSTIN provided
  // -------------------------------------------------------------
  console.log('--- Test 1: Customer GSTIN Entered ---');
  const sampleCustGst = '33ABCDE1234F1Z5';
  const quotationWithGst = {
    quotation_number: 'CQS/00250',
    quotation_date: '2026-10-14',
    customer_name: 'TEST LOGISTICS PRIVATE LIMITED',
    contact_person: 'RAJESH KUMAR',
    address: '123 INDUSTRIAL ESTATE, COIMBATORE - 641001',
    phone_number: '9876543210',
    gst_number: sampleCustGst,
    subtotal: 18644.07,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    cgst_amount: 1677.97,
    sgst_pct: 9,
    sgst_amount: 1677.96,
    net_amount: 22000,
    include_tech_specs: true,
    display_size: '10-inch',
  };

  const sampleItems = [
    {
      sno: 1,
      item_description: '4 Channel Live',
      hsn_sac: '852589',
      qty: 1,
      uom: 'Nos',
      rate: 22000,
      discount_pct: 0,
      discount_amount: 0,
      amount: 22000,
    },
  ];

  const pdfWithGstBuf = await generateQuotationPDF(quotationWithGst, sampleItems);
  const pdfWithGstStr = pdfWithGstBuf.toString('binary');

  // Verify page count
  const pagesWithGst = (pdfWithGstStr.match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count with tech specs: ${pagesWithGst} (Expected: 2)`);
  if (pagesWithGst !== 2) {
    console.error('❌ Failed: Expected exactly 2 pages with tech specs');
    passedAll = false;
  } else {
    console.log('✅ Page count is exactly 2 pages');
  }

  // Check Customer GSTIN label & value
  if (pdfWithGstStr.includes('Customer GSTIN:')) {
    console.log('✅ Label "Customer GSTIN:" is present in PDF');
  } else {
    console.error('❌ Label "Customer GSTIN:" NOT found in PDF');
    passedAll = false;
  }

  if (pdfWithGstStr.includes(sampleCustGst)) {
    console.log(`✅ Customer GST number "${sampleCustGst}" is present in PDF`);
  } else {
    console.error(`❌ Customer GST number "${sampleCustGst}" NOT found in PDF`);
    passedAll = false;
  }

  // Check Company GSTIN is unchanged
  const companyGst = '33AAICE7626B1ZX';
  if (pdfWithGstStr.includes(companyGst)) {
    console.log(`✅ Eagle Eye SafDrive company GSTIN "${companyGst}" remains intact in header`);
  } else {
    console.error(`❌ Company GSTIN "${companyGst}" missing or corrupted`);
    passedAll = false;
  }

  // Check other customer details are present
  if (pdfWithGstStr.includes('TEST LOGISTICS PRIVATE LIMITED') && pdfWithGstStr.includes('RAJESH KUMAR')) {
    console.log('✅ Customer name and contact person present alongside GSTIN');
  } else {
    console.error('❌ Customer name or contact person missing');
    passedAll = false;
  }

  // -------------------------------------------------------------
  // Test 2: Quotation with Empty/Optional GSTIN
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Optional GSTIN Empty / Omitted ---');
  const quotationWithoutGst = {
    ...quotationWithGst,
    quotation_number: 'CQS/00251',
    gst_number: '',
    customer_name: 'INDIVIDUAL RETAIL CUSTOMER',
    contact_person: '',
    address: 'SALEM, TAMIL NADU',
    phone_number: '9123456789',
    include_tech_specs: false, // 1-page standard quotation
  };

  const pdfWithoutGstBuf = await generateQuotationPDF(quotationWithoutGst, sampleItems);
  const pdfWithoutGstStr = pdfWithoutGstBuf.toString('binary');

  const pagesWithoutGst = (pdfWithoutGstStr.match(/\/Type\s*\/Page\b/g) || []).length;
  console.log(`Page count without tech specs: ${pagesWithoutGst} (Expected: 1)`);
  if (pagesWithoutGst !== 1) {
    console.error('❌ Failed: Expected exactly 1 page when include_tech_specs: false');
    passedAll = false;
  } else {
    console.log('✅ Page count is exactly 1 page');
  }

  if (!pdfWithoutGstStr.includes('Customer GSTIN:')) {
    console.log('✅ "Customer GSTIN:" row cleanly omitted when GST number is blank');
  } else {
    console.error('❌ "Customer GSTIN:" should NOT be present when field is empty');
    passedAll = false;
  }

  const hasNullText = pdfWithoutGstStr.includes('(undefined)') || 
                      pdfWithoutGstStr.includes('(null)') || 
                      pdfWithoutGstStr.includes('Customer GSTIN: null') ||
                      pdfWithoutGstStr.includes('Customer GSTIN: undefined');

  if (hasNullText) {
    console.error('❌ Found rendered "undefined" or "null" text in PDF content');
    passedAll = false;
  } else {
    console.log('✅ No "undefined" or "null" text rendered in PDF');
  }

  // -------------------------------------------------------------
  // Test 3: History roundtrip & regeneration with saved GST
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Quotation History Record PDF Regeneration ---');
  const historicalRecord = {
    id: 'quot-test-hist-001',
    quotation_number: 'CQS/00199',
    quotation_date: '2026-08-15',
    customer_name: 'HISTORICAL CLIENT TRANSPORT',
    contact_person: 'SURESH',
    address: 'MADURAI',
    phone_number: '9988776655',
    gst_number: '33AAAPL1234C1ZV',
    subtotal: 18644.07,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    cgst_amount: 1677.97,
    sgst_pct: 9,
    sgst_amount: 1677.96,
    net_amount: 22000,
    include_tech_specs: true,
  };

  const histItems = [
    {
      sno: 1,
      item_description: '2 Channel Live',
      hsn_sac: '852589',
      qty: 1,
      uom: 'Nos',
      rate: 22000,
      discount_pct: 0,
      discount_amount: 0,
      amount: 22000,
    },
  ];

  const regeneratedBuf = await generateQuotationPDF(historicalRecord, histItems);
  const regeneratedStr = regeneratedBuf.toString('binary');

  if (regeneratedStr.includes('Customer GSTIN:') && regeneratedStr.includes('33AAAPL1234C1ZV')) {
    console.log('✅ Regenerated history PDF uses saved record GSTIN "33AAAPL1234C1ZV"');
  } else {
    console.error('❌ Regenerated history PDF missing saved GSTIN');
    passedAll = false;
  }

  // -------------------------------------------------------------
  // Test 4: Financial and Calculation Integrity
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Financial Calculations and Details Integrity ---');
  const checks = [
    { label: 'CGST Amount', match: '1,677.97' },
    { label: 'SGST Amount', match: '1,677.96' },
    { label: 'Net Amount', match: '22,000' },
    { label: 'Words Representation', match: 'Twenty Two Thousand Only' },
    { label: 'HSN/SAC Code', match: '852589' },
    { label: 'Bank Name', match: 'Indian Overseas Bank' },
    { label: 'UPI ID', match: 'EAGLEEYESAFDRIVE@iob' },
  ];

  for (const c of checks) {
    if (pdfWithGstStr.includes(c.match)) {
      console.log(`✅ ${c.label} intact: "${c.match}"`);
    } else {
      console.error(`❌ ${c.label} mismatch or not found: "${c.match}"`);
      passedAll = false;
    }
  }

  // Save sample PDF to artifacts for visual verification
  const outPath = path.resolve(process.cwd(), 'sample_quotation_with_customer_gst.pdf');
  fs.writeFileSync(outPath, pdfWithGstBuf);
  console.log(`\nSample PDF with Customer GSTIN saved to: ${outPath}`);

  console.log('\n======================================================');
  if (passedAll) {
    console.log('🎉 ALL CUSTOMER GSTIN QUOTATION TESTS PASSED 100%! 🎉');
    console.log('======================================================');
  } else {
    console.error('💥 SOME TESTS FAILED. PLEASE REVIEW LOGS. 💥');
    console.log('======================================================');
    process.exit(1);
  }
}

runCustomerGstTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
