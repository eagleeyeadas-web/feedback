import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getNextQuotationNumber, createQuotation, downloadQuotationPDF } from '../../lib/api';
import { Plus, Trash2, Download, RefreshCw, FileText, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

const DEFAULT_TERMS = [
  '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
  'Payments are non-refundable once the order has been confirmed and processing has begun.',
  'SIM card procurement, activation, and recharge/data charges shall be under the customer\'s scope.',
  'Delivery timelines are estimates only and subject to stock availability.',
  'Products/services provided are subject to "3 years replacement warranty against manufacturing defects".',
  'This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
];

export default function QuotationGenerator() {
  const { session } = useAuth();
  const token = session?.access_token;

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [createdQuotationId, setCreatedQuotationId] = useState(null);

  // Form State
  const [customerName, setCustomerName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [address, setAddress] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [quotationNumber, setQuotationNumber] = useState('');
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Dynamic Product Items
  const [items, setItems] = useState([
    {
      id: '1',
      item_description: 'Eagle Eye AIS-140 GPS Tracking Device with 3 Years Subscription',
      hsn_sac: '8526',
      qty: 1,
      uom: 'Nos',
      rate: 22000,
      discount_pct: 0,
    }
  ]);

  // GST State
  const [gstApplicable, setGstApplicable] = useState(true);
  const [gstType, setGstType] = useState('CGST_SGST'); // 'CGST_SGST' | 'IGST'
  const [cgstPct, setCgstPct] = useState(9);
  const [sgstPct, setSgstPct] = useState(9);
  const [igstPct, setIgstPct] = useState(18);

  // Terms & Specs
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [includeTechSpecs, setIncludeTechSpecs] = useState(false);
  const [techSpecTemplate, setTechSpecTemplate] = useState('default');

  // Load next quotation number on mount
  useEffect(() => {
    fetchNextQuotationNumber();
  }, [token]);

  const fetchNextQuotationNumber = async () => {
    if (!token) return;
    try {
      const res = await getNextQuotationNumber(token);
      if (res.quotationNumber) {
        setQuotationNumber(res.quotationNumber);
      }
    } catch (err) {
      console.error('Error getting next quotation number:', err);
    }
  };

  // Add Item Row
  const addItem = () => {
    setItems([
      ...items,
      {
        id: String(Date.now()),
        item_description: '',
        hsn_sac: '8526',
        qty: 1,
        uom: 'Nos',
        rate: 0,
        discount_pct: 0,
      }
    ]);
  };

  // Remove Item Row
  const removeItem = (index) => {
    if (items.length <= 1) {
      alert('At least one product item is required');
      return;
    }
    setItems(items.filter((_, i) => i !== index));
  };

  // Update Item Row
  const updateItem = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  };

  // Calculations
  const calculateRowTotal = (item) => {
    const qty = parseFloat(item.qty) || 0;
    const rate = parseFloat(item.rate) || 0;
    const discPct = parseFloat(item.discount_pct) || 0;
    const rawTotal = qty * rate;
    const discAmt = rawTotal * (discPct / 100);
    return {
      discAmt: discAmt,
      amount: rawTotal - discAmt,
    };
  };

  const subtotal = items.reduce((sum, item) => sum + calculateRowTotal(item).amount, 0);

  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (gstApplicable) {
    if (gstType === 'CGST_SGST') {
      cgstAmount = subtotal * ((parseFloat(cgstPct) || 0) / 100);
      sgstAmount = subtotal * ((parseFloat(sgstPct) || 0) / 100);
    } else if (gstType === 'IGST') {
      igstAmount = subtotal * ((parseFloat(igstPct) || 0) / 100);
    }
  }

  const netAmount = subtotal + cgstAmount + sgstAmount + igstAmount;

  // Amount in Words (Client-side helper)
  const numberToWordsClient = (num) => {
    if (!num || isNaN(num)) return 'Zero Only';
    const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teen = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const roundNum = Math.floor(Math.abs(num));

    function convertChunk(n) {
      let str = '';
      if (n >= 100) {
        str += single[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 10 && n <= 19) {
        str += teen[n - 10] + ' ';
      } else if (n >= 20 || n === 10) {
        str += tens[Math.floor(n / 10)] + ' ';
        if (n % 10 > 0) str += single[n % 10] + ' ';
      } else if (n > 0) {
        str += single[n] + ' ';
      }
      return str;
    }

    let words = '';
    let temp = roundNum;

    const crore = Math.floor(temp / 10000000);
    temp %= 10000000;
    const lakh = Math.floor(temp / 100000);
    temp %= 100000;
    const thousand = Math.floor(temp / 1000);
    temp %= 1000;
    const hundred = temp;

    if (crore > 0) words += convertChunk(crore) + 'Crore ';
    if (lakh > 0) words += convertChunk(lakh) + 'Lakh ';
    if (thousand > 0) words += convertChunk(thousand) + 'Thousand ';
    if (hundred > 0) words += convertChunk(hundred);

    return (words.trim() || 'Zero') + ' Rupees Only';
  };

  // Submit & Generate Quotation
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setErrorMsg('Customer name is required');
      return;
    }
    if (items.some(i => !i.item_description.trim())) {
      setErrorMsg('Item description is required for all products');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    const payload = {
      customer_name: customerName.trim(),
      contact_person: contactPerson.trim(),
      address: address.trim(),
      phone_number: phoneNumber.trim(),
      gst_number: gstNumber.trim(),
      quotation_number: quotationNumber.trim(),
      quotation_date: quotationDate,
      gst_applicable: gstApplicable,
      gst_type: gstApplicable ? gstType : 'NONE',
      cgst_pct: parseFloat(cgstPct) || 0,
      sgst_pct: parseFloat(sgstPct) || 0,
      igst_pct: parseFloat(igstPct) || 0,
      terms_conditions: terms.filter(t => t.trim().length > 0),
      include_tech_specs: includeTechSpecs,
      tech_spec_template: techSpecTemplate,
      items: items.map(item => ({
        item_description: item.item_description.trim(),
        hsn_sac: item.hsn_sac.trim(),
        qty: parseFloat(item.qty) || 1,
        uom: item.uom || 'Nos',
        rate: parseFloat(item.rate) || 0,
        discount_pct: parseFloat(item.discount_pct) || 0,
      })),
    };

    try {
      const res = await createQuotation(token, payload);
      setSuccessMsg(`Quotation ${res.quotation.quotation_number} generated successfully!`);
      setCreatedQuotationId(res.quotation.id);

      // Auto download generated PDF
      await triggerDownload(res.quotation.id, res.quotation.quotation_number);
    } catch (err) {
      console.error('Error generating quotation:', err);
      setErrorMsg(err.message || 'Failed to generate quotation');
    } finally {
      setLoading(false);
    }
  };

  // Download PDF Helper
  const triggerDownload = async (quotationId, qNo) => {
    try {
      const blob = await downloadQuotationPDF(token, quotationId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EagleEye_Quotation_${(qNo || quotationNumber).replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Download PDF failed:', err);
      alert('Could not download PDF. Please try again.');
    }
  };

  // Reset Form
  const resetForm = () => {
    setCustomerName('');
    setContactPerson('');
    setAddress('');
    setPhoneNumber('');
    setGstNumber('');
    setQuotationDate(new Date().toISOString().split('T')[0]);
    setItems([
      {
        id: String(Date.now()),
        item_description: 'Eagle Eye AIS-140 GPS Tracking Device with 3 Years Subscription',
        hsn_sac: '8526',
        qty: 1,
        uom: 'Nos',
        rate: 22000,
        discount_pct: 0,
      }
    ]);
    setGstApplicable(true);
    setGstType('CGST_SGST');
    setCgstPct(9);
    setSgstPct(9);
    setIgstPct(18);
    setTerms(DEFAULT_TERMS);
    setIncludeTechSpecs(false);
    setSuccessMsg('');
    setErrorMsg('');
    setCreatedQuotationId(null);
    fetchNextQuotationNumber();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <FileText className="w-7 h-7 text-blue-600" />
            Quotation Generator (PDF)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create traditional professional Eagle Eye Safdrive quotations with exact reference layout and GST calculations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2 transition"
          >
            <RefreshCw className="w-4 h-4" /> Reset Form
          </button>

          {createdQuotationId && (
            <button
              type="button"
              onClick={() => triggerDownload(createdQuotationId, quotationNumber)}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2 transition shadow-sm"
            >
              <Download className="w-4 h-4" /> Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* 1. CUSTOMER DETAILS SECTION */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-navy border-b pb-2 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">1</span>
            Customer & Quotation Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Quotation Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={quotationNumber}
                onChange={(e) => setQuotationNumber(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 font-mono font-bold text-blue-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Quotation Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Customer / Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. ABC Logistics Pvt Ltd"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Contact Person
              </label>
              <input
                type="text"
                placeholder="e.g. Mr. Rajesh Kumar"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Billing Address
              </label>
              <textarea
                rows={2}
                placeholder="Complete address details..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                placeholder="+91 98765 43210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                GST Number (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 33AAAAA0000A1Z5"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* 2. DYNAMIC PRODUCTS TABLE */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-lg font-semibold text-navy flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">2</span>
              Product & Service Items
            </h2>
            <button
              type="button"
              onClick={addItem}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Product Item
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-navy text-white uppercase text-[11px] tracking-wider">
                  <th className="p-2.5 text-center w-10">S.No</th>
                  <th className="p-2.5 min-w-[240px]">Item Description</th>
                  <th className="p-2.5 w-24">HSN/SAC</th>
                  <th className="p-2.5 w-20 text-center">QTY</th>
                  <th className="p-2.5 w-20 text-center">UOM</th>
                  <th className="p-2.5 w-28 text-right">Rate (₹)</th>
                  <th className="p-2.5 w-20 text-center">Disc %</th>
                  <th className="p-2.5 w-28 text-right">Discount (₹)</th>
                  <th className="p-2.5 w-28 text-right">Amount (₹)</th>
                  <th className="p-2.5 w-12 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 border-b">
                {items.map((item, index) => {
                  const { discAmt, amount } = calculateRowTotal(item);
                  return (
                    <tr key={item.id || index} className="hover:bg-gray-50">
                      <td className="p-2 text-center font-bold text-gray-500">{index + 1}</td>
                      
                      <td className="p-2">
                        <input
                          type="text"
                          placeholder="Product description..."
                          value={item.item_description}
                          onChange={(e) => updateItem(index, 'item_description', e.target.value)}
                          required
                          className="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500"
                        />
                      </td>

                      <td className="p-2">
                        <input
                          type="text"
                          value={item.hsn_sac}
                          onChange={(e) => updateItem(index, 'hsn_sac', e.target.value)}
                          className="w-full px-2 py-1 border rounded text-xs text-center"
                        />
                      </td>

                      <td className="p-2">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.qty}
                          onChange={(e) => updateItem(index, 'qty', e.target.value)}
                          required
                          className="w-full px-2 py-1 border rounded text-xs text-center font-semibold"
                        />
                      </td>

                      <td className="p-2">
                        <select
                          value={item.uom}
                          onChange={(e) => updateItem(index, 'uom', e.target.value)}
                          className="w-full px-1 py-1 border rounded text-xs text-center"
                        >
                          <option value="Nos">Nos</option>
                          <option value="Set">Set</option>
                          <option value="Pcs">Pcs</option>
                          <option value="Units">Units</option>
                          <option value="Lot">Lot</option>
                        </select>
                      </td>

                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.rate}
                          onChange={(e) => updateItem(index, 'rate', e.target.value)}
                          required
                          className="w-full px-2 py-1 border rounded text-xs text-right font-mono font-semibold"
                        />
                      </td>

                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={item.discount_pct}
                          onChange={(e) => updateItem(index, 'discount_pct', e.target.value)}
                          className="w-full px-2 py-1 border rounded text-xs text-center"
                        />
                      </td>

                      <td className="p-2 text-right font-mono text-gray-600">
                        ₹{discAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      <td className="p-2 text-right font-mono font-bold text-blue-900">
                        ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
                          title="Remove Item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. TAX & SUMMARY SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* GST Controls */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-navy border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">3</span>
              GST & Tax Setup
            </h2>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="gstApplicable"
                checked={gstApplicable}
                onChange={(e) => setGstApplicable(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="gstApplicable" className="text-sm font-semibold text-gray-800">
                GST Applicable on this quotation
              </label>
            </div>

            {gstApplicable && (
              <div className="space-y-4 pt-2 border-t">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gstType"
                      value="CGST_SGST"
                      checked={gstType === 'CGST_SGST'}
                      onChange={() => setGstType('CGST_SGST')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    CGST + SGST (Intrastate Tamil Nadu)
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gstType"
                      value="IGST"
                      checked={gstType === 'IGST'}
                      onChange={() => setGstType('IGST')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    IGST (Interstate Outside TN)
                  </label>
                </div>

                {gstType === 'CGST_SGST' && (
                  <div className="grid grid-cols-2 gap-4 bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">CGST Rate (%)</label>
                      <input
                        type="number"
                        step="any"
                        value={cgstPct}
                        onChange={(e) => setCgstPct(e.target.value)}
                        className="w-full px-3 py-1.5 border rounded text-sm font-bold text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">SGST Rate (%)</label>
                      <input
                        type="number"
                        step="any"
                        value={sgstPct}
                        onChange={(e) => setSgstPct(e.target.value)}
                        className="w-full px-3 py-1.5 border rounded text-sm font-bold text-center"
                      />
                    </div>
                  </div>
                )}

                {gstType === 'IGST' && (
                  <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">IGST Rate (%)</label>
                    <input
                      type="number"
                      step="any"
                      value={igstPct}
                      onChange={(e) => setIgstPct(e.target.value)}
                      className="w-full px-3 py-1.5 border rounded text-sm font-bold text-center max-w-[200px]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live Summary Box */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3 flex flex-col justify-between">
            <h2 className="text-lg font-semibold text-navy border-b pb-2">Financial Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Sub Total:</span>
                <span className="font-mono font-semibold">₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>

              {gstApplicable && gstType === 'CGST_SGST' && (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>CGST ({cgstPct}%):</span>
                    <span className="font-mono">₹{cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>SGST ({sgstPct}%):</span>
                    <span className="font-mono">₹{sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}

              {gstApplicable && gstType === 'IGST' && (
                <div className="flex justify-between text-gray-600">
                  <span>IGST ({igstPct}%):</span>
                  <span className="font-mono">₹{igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}

              <div className="pt-2 border-t flex justify-between items-center text-lg font-bold text-blue-900 bg-blue-50 p-3 rounded-lg">
                <span>NET AMOUNT:</span>
                <span className="font-mono text-xl">₹{netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>

              <div className="text-xs text-gray-500 pt-1">
                <span className="font-semibold text-gray-700">Amount in Words:</span> {numberToWordsClient(netAmount)}
              </div>
            </div>
          </div>
        </div>

        {/* 4. TERMS & CONDITIONS AND PAGE 2 OPTIONS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Terms & Conditions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-navy border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">4</span>
              Terms & Conditions (Editable)
            </h2>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {terms.map((term, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-xs font-bold text-gray-500 mt-2">{index + 1}.</span>
                  <textarea
                    rows={2}
                    value={term}
                    onChange={(e) => {
                      const newTerms = [...terms];
                      newTerms[index] = e.target.value;
                      setTerms(newTerms);
                    }}
                    className="w-full p-2 border rounded text-xs focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setTerms(terms.filter((_, i) => i !== index))}
                    className="p-1 text-gray-400 hover:text-red-500 mt-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setTerms([...terms, 'New term requirement...'])}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Term
            </button>
          </div>

          {/* Page 2 Technical Specs Option */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-navy border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">5</span>
              Technical Specifications (Page 2 Optional)
            </h2>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeTechSpecs"
                checked={includeTechSpecs}
                onChange={(e) => setIncludeTechSpecs(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="includeTechSpecs" className="text-sm font-semibold text-gray-800">
                Include Product Technical Specifications Table on Page 2
              </label>
            </div>

            {includeTechSpecs && (
              <div className="p-4 bg-gray-50 rounded-lg border space-y-3">
                <label className="block text-xs font-semibold text-gray-700">
                  Select Technical Specification Template:
                </label>
                <select
                  value={techSpecTemplate}
                  onChange={(e) => setTechSpecTemplate(e.target.value)}
                  className="w-full p-2 border rounded text-xs bg-white"
                >
                  <option value="default">AIS-140 GPS Tracker Specifications</option>
                  <option value="speed_governor">Electronic Speed Governor (SLD) Specifications</option>
                </select>
                <p className="text-xs text-gray-500">
                  Adds a 4-column technical matrix table (No. | Specification | Technical Parameter | Remark) to the generated PDF.
                </p>
              </div>
            )}

            {/* Bank Details Banner Notice */}
            <div className="p-4 bg-blue-50/60 rounded-lg border border-blue-100 text-xs text-blue-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Automatic Bank & UPI QR Integration
              </div>
              <p>
                The generated PDF automatically embeds Eagle Eye Safdrive's official Indian Overseas Bank details and UPI QR code (<code className="bg-blue-100 px-1 rounded">EAGLEEYESAFDRIVE@iob</code>).
              </p>
            </div>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                Generate & Save Quotation PDF
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
