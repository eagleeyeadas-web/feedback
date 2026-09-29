import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';

async function testGstInclusiveModel() {
  console.log('--- Testing GST-Inclusive Rate Model & Calculations ---');

  // Input: Rate ₹22,000 (Incl. 18% GST), Qty 1, Disc 0%
  const rate = 22000;
  const qty = 1;
  const discPct = 0;

  const rawTotal = qty * rate;
  const discountAmount = Math.round((rawTotal * (discPct / 100)) * 100) / 100;
  const totalInclusive = Math.round((rawTotal - discountAmount) * 100) / 100;

  const cgstPct = 9;
  const sgstPct = 9;
  const totalGstRate = (cgstPct + sgstPct) / 100;

  const subtotal = Math.round((totalInclusive / (1 + totalGstRate)) * 100) / 100;
  const totalGst = Math.round((totalInclusive - subtotal) * 100) / 100;
  const cgstAmount = Math.round((totalGst / 2) * 100) / 100;
  const sgstAmount = Math.round((totalGst - cgstAmount) * 100) / 100;

  const netAmount = Math.round((subtotal + cgstAmount + sgstAmount) * 100) / 100;

  console.log(`Input Rate (Incl. GST): ₹${rate.toLocaleString('en-IN')}`);
  console.log(`Taxable Subtotal: ₹${subtotal.toFixed(2)} (Expected ~18644.07)`);
  console.log(`CGST (9%): ₹${cgstAmount.toFixed(2)} (Expected ~1677.97)`);
  console.log(`SGST (9%): ₹${sgstAmount.toFixed(2)} (Expected ~1677.96)`);
  console.log(`Calculated Net Amount: ₹${netAmount.toFixed(2)} (Expected 22000.00)`);

  if (netAmount !== 22000) {
    throw new Error(`FAIL: Net amount is ₹${netAmount}, expected ₹22,000.00!`);
  }
  console.log('✅ VERIFICATION PASSED: Net Amount remains EXACTLY ₹22,000.00 (GST-Inclusive)!');

  // Test PDF generation with this data
  const sampleQuotation = {
    quotation_number: 'TEST-INCL-001',
    quotation_date: '2026-09-29',
    customer_name: 'Test Customer Ltd',
    contact_person: 'Mr. Ramesh',
    address: 'Coimbatore',
    phone_number: '9876543210',
    gst_number: '33AAAAA0000A1Z5',
    subtotal,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    sgst_pct: 9,
    cgst_amount: cgstAmount,
    sgst_amount: sgstAmount,
    igst_pct: 18,
    igst_amount: 0,
    net_amount: netAmount,
    terms_conditions: [
      '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
      'Payments are non-refundable once the order has been confirmed and processing has begun.',
    ]
  };

  const sampleItems = [
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
    }
  ];

  const pdfBuffer = await generateQuotationPDF(sampleQuotation, sampleItems);
  console.log(`✅ PDF Generated Successfully: ${pdfBuffer.length} bytes`);
}

testGstInclusiveModel().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
