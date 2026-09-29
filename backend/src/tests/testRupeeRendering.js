import { jsPDF } from 'jspdf';
import fs from 'fs';

const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
doc.setFont('helvetica', 'bold');
doc.setFontSize(10);

doc.text('Rate (₹)', 20, 20);
doc.text('Amount (₹)', 20, 30);
doc.text('Rate (Rs.)', 20, 40);
doc.text('Amount (Rs.)', 20, 50);

const buf = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync('test_rupee.pdf', buf);
console.log('Saved test_rupee.pdf, byte size:', buf.length);
