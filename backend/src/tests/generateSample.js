import fs from 'fs';
import path from 'path';
import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';

async function generateSample() {
  const sampleQuotation = {
    quotation_number: 'CQS/00231',
    quotation_date: '2026-09-23',
    customer_name: 'ABM TRANSPORT',
    contact_person: 'IYYAPPAN',
    address: 'THANJAVUR\n9384329903',
    phone_number: '9384329903',
    gst_number: '33AAICE7626B1ZX',
    subtotal: 18644,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    cgst_amount: 1678,
    sgst_pct: 9,
    sgst_amount: 1678,
    net_amount: 22000,
    include_tech_specs: true,
  };

  const sampleItems = [
    {
      sno: 1,
      item_description: '2 channel LIVE 10 inch AI processing display with (2 cameras & 2 cables)',
      hsn_sac: '852589',
      qty: 1,
      uom: 'SET',
      rate: 18644,
      discount_pct: 0,
      discount_amount: 0,
      amount: 18644,
    }
  ];

  const pdfBuffer = await generateQuotationPDF(sampleQuotation, sampleItems);
  const outPath = path.join(process.cwd(), 'sample_quotation.pdf');
  fs.writeFileSync(outPath, pdfBuffer);
  console.log(`Generated sample PDF saved to: ${outPath} (${pdfBuffer.length} bytes)`);
}

generateSample().catch(console.error);
