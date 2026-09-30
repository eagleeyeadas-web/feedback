export const PRODUCT_OPTIONS = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '8 Channel Live',
];

/**
 * Extracts the product option key from a full description or short name
 */
export function getProductKeyFromDescription(desc) {
  if (!desc) return '2 Channel Live';
  const s = String(desc).trim();
  if (PRODUCT_OPTIONS.includes(s)) return s;
  if (s.startsWith('4 Channel Live')) return '4 Channel Live';
  if (s.startsWith('4 Channel Rec')) return '4 Channel Recording';
  if (s.startsWith('2 Channel Live')) return '2 Channel Live';
  if (s.startsWith('2 Channel Rec')) return '2 Channel Recording';
  if (s.startsWith('6 Channel Live')) return '6 Channel Live';
  if (s.startsWith('8 Channel Live')) return '8 Channel Live';
  return s;
}

/**
 * Formats display size text for inclusion in product description (e.g. '7-inch' -> '7 inch')
 */
export function formatDisplaySizeText(displaySize) {
  if (!displaySize) return '';
  const str = String(displaySize).trim();
  if (str.toLowerCase().includes('7')) return '7 inch';
  if (str.toLowerCase().includes('10')) return '10 inch';
  return str.replace(/-/g, ' ');
}

/**
 * Generates the full complete item description based on product option key and display size
 */
export function getFullProductDescription(productKeyOrDesc, displaySize = '10-inch') {
  if (!productKeyOrDesc) return '';

  const key = getProductKeyFromDescription(productKeyOrDesc);
  const sizeText = formatDisplaySizeText(displaySize);

  switch (key) {
    case '4 Channel Live':
      return '4 Channel Live GPS 10 inch AI processing display with (4 cameras & 4 cables) Including Installation';

    case '4 Channel Recording':
      return '4 Channel Rec 10 inch AI processing display with (4 cameras & 4 cables) Including Installation';

    case '2 Channel Live':
      if (sizeText) {
        return `2 Channel Live & Rec GPS AI processing ${sizeText} display with (2 cameras & 2 cables) Including Installation`;
      }
      return '2 Channel Live & Rec GPS AI processing display with (2 cameras & 2 cables) Including Installation';

    case '2 Channel Recording':
      if (sizeText) {
        return `2 Channel Rec AI processing ${sizeText} display with (2 cameras & 2 cables) Including Installation`;
      }
      return '2 Channel Rec AI processing display with (2 cameras & 2 cables) Including Installation';

    case '6 Channel Live':
      return '6 Channel Live & Rec GPS 10 inch AI processing display with (6 cameras & 6 cables) Including Installation';

    case '8 Channel Live':
      return '8 Channel Live & Rec GPS 10 inch AI processing display with (8 cameras & 8 cables) Including Installation';

    default:
      return productKeyOrDesc;
  }
}
