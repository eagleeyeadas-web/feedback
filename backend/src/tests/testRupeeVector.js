import { jsPDF } from 'jspdf';
import fs from 'fs';

/**
 * Draws a clean vector Rupee symbol (₹) at (x, y) with height (h)
 */
function drawRupeeSymbol(doc, x, y, size = 3) {
  doc.setLineWidth(0.35);
  doc.setDrawColor(0, 0, 0);

  const topY = y - size * 0.7;
  const midY = y - size * 0.35;
  const botY = y + size * 0.3;
  const w = size * 0.6;

  // Top horizontal bar
  doc.line(x, topY, x + w, topY);
  // Middle horizontal bar
  doc.line(x, midY, x + w * 0.9, midY);
  // Left vertical bar
  doc.line(x + 0.2, topY, x + 0.2, midY + 0.5);
  // Curve arc
  doc.line(x + 0.2, midY + 0.5, x + w * 0.7, midY + 0.5);
  doc.line(x + w * 0.7, midY + 0.5, x + 0.2, y);
  // Diagonal leg
  doc.line(x + 0.4, y - 0.2, x + w, botY);
}

const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
doc.setFont('helvetica', 'bold');
doc.setFontSize(8);

// Draw 'Rate ('
doc.text('Rate (', 20, 20);
drawRupeeSymbol(doc, 29, 20, 3);
doc.text(')', 31.5, 20);

// Draw 'Amount ('
doc.text('Amount (', 20, 30);
drawRupeeSymbol(doc, 33, 30, 3);
doc.text(')', 35.5, 30);

const buf = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync('test_rupee_vector.pdf', buf);
console.log('Saved test_rupee_vector.pdf');
