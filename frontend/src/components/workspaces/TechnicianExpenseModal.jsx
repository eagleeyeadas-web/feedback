import { useState, useEffect } from 'react';
import {
  Receipt,
  Plus,
  Trash2,
  FileText,
  Download,
  Printer,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Save,
  Tag,
  Building,
  User,
  MapPin,
  Calendar,
  CreditCard,
  FileCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchJobExpenses,
  saveJobExpensesApi,
  downloadJobExpensePdfApi,
} from '../../lib/api';

const CATEGORIES = [
  'Travel',
  'Fuel',
  'Food',
  'Toll',
  'Accommodation',
  'Parking',
  'Other Travel Expense',
];

const PAYMENT_METHODS = [
  'Cash',
  'UPI',
  'Personal Card',
  'Company Payment',
  'Other',
];

export default function TechnicianExpenseModal({
  checklist,
  token,
  user,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(true);
  const [isDenied, setIsDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Persisted state
  const [savedExpenses, setSavedExpenses] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);

  // Form entries: start empty until authorized response loads
  const [entries, setEntries] = useState([]);

  // Load existing saved expenses for this checklist
  useEffect(() => {
    let isMounted = true;

    async function loadExpenses() {
      if (!checklist?.id || !token) return;
      setLoading(true);
      setError('');
      setIsDenied(false);

      try {
        const expData = await fetchJobExpenses(token, checklist.id);
        if (isMounted) {
          setError('');
          setIsDenied(false);
          const loaded = expData.expenses || [];
          setSavedExpenses(loaded);

          if (loaded.length > 0) {
            setEntries(
              loaded.map((item) => ({
                id: item.id,
                expense_date: item.expense_date || new Date().toISOString().split('T')[0],
                category: item.category || 'Travel',
                description: item.description || '',
                amount: String(item.amount || ''),
                payment_method: item.payment_method || 'Cash',
                notes: item.notes || '',
              }))
            );
          } else {
            setEntries([
              {
                id: `new-${Date.now()}-0`,
                expense_date: new Date().toISOString().split('T')[0],
                category: 'Travel',
                description: '',
                amount: '',
                payment_method: 'Cash',
                notes: '',
              },
            ]);
          }
        }
      } catch (err) {
        if (isMounted) {
          const errMsg = err.message || 'Failed to load expenses for this checklist';
          setError(errMsg);
          const isForbidden =
            err.status === 403 ||
            err.status === 401 ||
            /not authorized|forbidden|permission|unauthorized/i.test(errMsg);

          if (isForbidden) {
            setIsDenied(true);
            // CRITICAL: Do NOT expose expense details that the user is not allowed to view
            setEntries([]);
            setSavedExpenses([]);
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadExpenses();
    return () => {
      isMounted = false;
    };
  }, [checklist?.id, token]);

  // Action 1: Add Expense
  const handleAddExpense = () => {
    if (isDenied || loading) return;
    setEntries((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        expense_date: new Date().toISOString().split('T')[0],
        category: 'Travel',
        description: '',
        amount: '',
        payment_method: 'Cash',
        notes: '',
      },
    ]);
  };

  // Remove an expense entry
  const handleRemoveEntry = (index) => {
    if (isDenied || loading) return;
    const item = entries[index];
    if (item && item.id && !item.id.startsWith('new-')) {
      setDeletedIds((prev) => [...prev, item.id]);
    }
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all expense entries for this checklist
  const handleClearAllExpenses = async () => {
    if (isDenied || loading) return;
    if (!window.confirm(`Are you sure you want to clear all ${entries.length} expense entry(ies) for this job? This will remove saved expense records.`)) {
      return;
    }
    const allSavedIds = entries.filter((e) => e.id && !e.id.startsWith('new-')).map((e) => e.id);
    const combinedDeleted = Array.from(new Set([...deletedIds, ...allSavedIds]));

    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      if (combinedDeleted.length > 0) {
        await saveJobExpensesApi(token, checklist.id, {
          expenses: [],
          deletedExpenseIds: combinedDeleted,
        });
      }
      setEntries([]);
      setSavedExpenses([]);
      setDeletedIds([]);
      setSuccessMsg('All expenses cleared successfully.');
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to clear expenses');
    } finally {
      setSaving(false);
    }
  };

  // Update entry field
  const handleEntryChange = (index, field, value) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
    );
  };

  // Validate form entries
  const validateEntries = () => {
    if (entries.length === 0) {
      return 'Please add at least one expense entry before saving.';
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const amt = parseFloat(e.amount);
      if (isNaN(amt) || amt <= 0) {
        return `Expense #${i + 1}: Amount must be a positive number greater than ₹0.`;
      }
      if (!e.description.trim()) {
        return `Expense #${i + 1}: Description is required.`;
      }
      if (!e.category) {
        return `Expense #${i + 1}: Category is required.`;
      }
      if (!e.payment_method) {
        return `Expense #${i + 1}: Payment method is required.`;
      }
    }
    return null;
  };

  // Action 2: Save Expenses
  const handleSaveExpenses = async () => {
    if (isDenied || loading) return;
    setError('');
    setSuccessMsg('');

    const valErr = validateEntries();
    if (valErr) {
      setError(valErr);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        is_draft: false,
        delete_ids: deletedIds,
        expenses: entries.map((e) => ({
          id: e.id && !e.id.startsWith('new-') ? e.id : undefined,
          expense_date: e.expense_date,
          category: e.category,
          description: e.description.trim(),
          amount: parseFloat(e.amount),
          payment_method: e.payment_method,
          notes: e.notes ? e.notes.trim() : null,
        })),
      };

      const res = await saveJobExpensesApi(token, checklist.id, payload);
      const updated = res.expenses || [];
      setSavedExpenses(updated);
      setDeletedIds([]);

      // Update entry IDs to match persisted IDs
      if (updated.length > 0) {
        setEntries(
          updated.map((item) => ({
            id: item.id,
            expense_date: item.expense_date || new Date().toISOString().split('T')[0],
            category: item.category || 'Travel',
            description: item.description || '',
            amount: String(item.amount || ''),
            payment_method: item.payment_method || 'Cash',
            notes: item.notes || '',
          }))
        );
      }

      setSuccessMsg('Expenses saved successfully! You can now download or print your PDF report.');
      if (onSuccess) onSuccess(res);
    } catch (err) {
      console.error('Failed to save expenses:', err);
      setError(err.message || 'Failed to save expenses');
    } finally {
      setSaving(false);
    }
  };

  // Action 3: Download Expense PDF
  const handleDownloadExpensePdf = async () => {
    if (isDenied || loading || !hasSavedRecords) return;
    setError('');
    setSuccessMsg('');
    setDownloadingPdf(true);

    try {
      const blob = await downloadJobExpensePdfApi(token, checklist.id, false);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const cleanChecklistNo = (checklist.checklist_number || 'job').replace(/[^a-zA-Z0-9-_]/g, '_');
      link.download = `Expense-Report-${cleanChecklistNo}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      setSuccessMsg('Expense report PDF downloaded. Please print this PDF and submit the physical printout manually.');
    } catch (err) {
      console.error('Download PDF error:', err);
      setError(err.message || 'Failed to download expense report PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Action 4: Print Expense Report
  const handlePrintExpenseReport = async () => {
    if (isDenied || loading || !hasSavedRecords) return;
    setError('');
    setSuccessMsg('');
    setPrintingPdf(true);

    try {
      const blob = await downloadJobExpensePdfApi(token, checklist.id, true);
      const blobUrl = URL.createObjectURL(blob);

      // Open new window for print preview
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
      } else {
        // Fallback using invisible iframe if popup blocker is active
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.src = blobUrl;
        document.body.appendChild(iframe);
        iframe.onload = () => {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          }, 300);
        };
      }
      setSuccessMsg('Print preview opened. Please print and submit the physical copy to Accounts.');
    } catch (err) {
      console.error('Print PDF error:', err);
      setError(err.message || 'Failed to open print preview for expense report');
    } finally {
      setPrintingPdf(false);
    }
  };

  // Calculate total expense amount
  const totalAmount = isDenied ? 0 : entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const hasSavedRecords = !isDenied && savedExpenses.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 my-8 max-h-[92vh] overflow-y-auto border border-gray-100">
        
        {/* Header with Title and Close Button */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Post-Installation Report Completed
              </span>
              <span className="text-gray-300">→</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-700 text-white uppercase tracking-wider">
                Technician Expenses
              </span>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-purple-700" />
              <span>Technician Expenses — Download &amp; Print Only</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Enter travel, fuel, food, toll, accommodation, or parking costs incurred for this job. Save, download as PDF, and print to submit manually on paper.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Auto-Populated Information Card */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase flex items-center gap-1">
                <Tag className="w-2.5 h-2.5 text-purple-600" /> Checklist Number
              </span>
              <span className="font-mono font-bold text-purple-700 text-xs mt-0.5 block">
                {checklist.checklist_number}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase flex items-center gap-1">
                <Building className="w-2.5 h-2.5 text-blue-600" /> Client Name
              </span>
              <span className="font-bold text-gray-900 truncate block mt-0.5">
                {checklist.client_name}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase flex items-center gap-1">
                <User className="w-2.5 h-2.5 text-emerald-600" /> Service Engineer
              </span>
              <span className="font-semibold text-gray-800 truncate block mt-0.5">
                {checklist.service_engineer || 'Technician'}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase flex items-center gap-1">
                <MapPin className="w-2.5 h-2.5 text-amber-600" /> Location / Site
              </span>
              <span className="text-gray-700 truncate block mt-0.5">
                {checklist.client_location || 'On-site'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Toolbar: Add Expense, Save Expenses, Download Expense PDF, Print Expense Report */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-purple-50/70 rounded-xl border border-purple-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-add-expense"
              onClick={handleAddExpense}
              disabled={loading || isDenied}
              className={`px-3 py-1.5 text-xs font-bold text-purple-800 bg-white border border-purple-300 rounded-lg transition-all flex items-center gap-1.5 shadow-2xs ${
                loading || isDenied
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-purple-100 cursor-pointer'
              }`}
            >
              <Plus className="w-3.5 h-3.5 text-purple-700" />
              <span>Add Expense</span>
            </button>

            <button
              type="button"
              id="btn-save-expenses"
              onClick={handleSaveExpenses}
              disabled={saving || loading || isDenied || entries.length === 0}
              className={`px-4 py-1.5 text-xs font-bold text-white bg-purple-700 rounded-lg transition-all flex items-center gap-1.5 shadow-xs ${
                saving || loading || isDenied || entries.length === 0
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-purple-800 cursor-pointer'
              }`}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Expenses</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-download-expense-pdf"
              onClick={handleDownloadExpensePdf}
              disabled={downloadingPdf || !hasSavedRecords || isDenied || loading}
              title={
                isDenied
                  ? 'Access denied for this job'
                  : !hasSavedRecords
                  ? 'Please click "Save Expenses" first to generate PDF'
                  : 'Download printable A4 Expense Report PDF'
              }
              className="px-3.5 py-1.5 text-xs font-bold text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-indigo-600" />}
              <span>Download Expense PDF</span>
            </button>

            <button
              type="button"
              id="btn-print-expense-report"
              onClick={handlePrintExpenseReport}
              disabled={printingPdf || !hasSavedRecords || isDenied || loading}
              title={
                isDenied
                  ? 'Access denied for this job'
                  : !hasSavedRecords
                  ? 'Please click "Save Expenses" first to print report'
                  : 'Print Expense Report for physical paper submission'
              }
              className="px-3.5 py-1.5 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {printingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 text-slate-700" />}
              <span>Print Expense Report</span>
            </button>
          </div>
        </div>

        {/* Notification Alerts */}
        {error && !loading && (
          <div className="p-3.5 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs flex items-start gap-2.5 shadow-2xs">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">{error}</span>
              {isDenied && (
                <p className="text-[11px] text-rose-700">
                  Technician expenses are private to the assigned service engineer ({checklist.service_engineer || 'Assigned Engineer'}) and administrators.
                </p>
              )}
            </div>
          </div>
        )}

        {successMsg && !loading && (
          <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {/* Expenses Table Form */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <FileCheck className="w-3.5 h-3.5 text-purple-700" />
              <span>Expense Entries ({entries.length})</span>
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddExpense}
                disabled={loading || isDenied}
                className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Entry</span>
              </button>
              {entries.length > 0 && !isDenied && !loading && (
                <button
                  type="button"
                  onClick={handleClearAllExpenses}
                  disabled={saving || loading || isDenied}
                  className="px-2.5 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-2xs"
                  title="Clear all expense entries for this job"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Clear All Expenses</span>
                </button>
              )}
              <span className="text-xs font-mono font-bold text-purple-900 bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-200">
                Total: ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center space-y-2.5 bg-slate-50/80 rounded-xl border border-slate-200">
              <Loader2 className="w-7 h-7 animate-spin text-purple-600 mx-auto" />
              <p className="text-xs font-bold text-gray-800">Verifying authorization and loading expenses...</p>
              <p className="text-[11px] text-gray-500">Checking permissions for checklist {checklist.checklist_number}...</p>
            </div>
          ) : isDenied ? (
            <div className="p-8 text-center border-2 border-dashed border-rose-200 bg-rose-50/50 rounded-xl space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-2xs">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-rose-900 uppercase tracking-wider">Access Restricted</h4>
                <p className="text-xs font-semibold text-rose-700 mt-1 max-w-md mx-auto">
                  {error || 'You are not authorized to view or submit expenses for this job.'}
                </p>
              </div>
              <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                No expense entries are displayed. Expense management is restricted strictly to the assigned service engineer and administrators.
              </p>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-xl space-y-2">
              <Receipt className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="text-xs text-gray-500 font-medium">No expenses entered yet.</p>
              <button
                type="button"
                onClick={handleAddExpense}
                className="px-3 py-1.5 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-lg cursor-pointer"
              >
                + Add Expense
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry, index) => (
                <div
                  key={entry.id || index}
                  className="p-3.5 bg-gray-50/80 rounded-xl border border-gray-200 space-y-2.5 text-xs shadow-2xs hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/60">
                    <span className="font-bold text-gray-700 flex items-center gap-1 text-[11px]">
                      <Tag className="w-3 h-3 text-purple-600" />
                      <span>Expense #{index + 1}</span>
                    </span>
                    {entries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(index)}
                        className="text-rose-600 hover:text-rose-800 flex items-center gap-1 text-[11px] cursor-pointer"
                        title="Remove this expense"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  {/* Row 1: Date, Category, Amount in ₹, Payment Method */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Expense Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={entry.expense_date}
                        onChange={(e) => handleEntryChange(index, 'expense_date', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg font-medium text-gray-800 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Category *
                      </label>
                      <select
                        value={entry.category}
                        onChange={(e) => handleEntryChange(index, 'category', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg font-bold text-gray-800 focus:outline-none focus:border-purple-500"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Amount (₹) *
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="e.g. 450.00"
                        value={entry.amount}
                        onChange={(e) => handleEntryChange(index, 'amount', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg font-mono font-bold text-gray-900 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Payment Method *
                      </label>
                      <select
                        value={entry.payment_method}
                        onChange={(e) => handleEntryChange(index, 'payment_method', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-purple-500"
                      >
                        {PAYMENT_METHODS.map((pm) => (
                          <option key={pm} value={pm}>
                            {pm}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Description and Optional Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Description *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Bus fare to customer depot / Fuel for vehicle"
                        value={entry.description}
                        onChange={(e) => handleEntryChange(index, 'description', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg font-medium text-gray-800 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Optional Notes
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Bill #1029 attach with paper submission"
                        value={entry.notes}
                        onChange={(e) => handleEntryChange(index, 'notes', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Total Summary Footer & Physical Submission Instructions */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-bold text-slate-800 block">Physical Submission Notice:</span>
            <span className="text-[11px] text-slate-500">
              There is no multi-user approval process. After saving, download and print the A4 PDF to physically submit it with your original bills to the office.
            </span>
          </div>

          <div className="text-right shrink-0">
            <span className="text-[10px] font-semibold text-gray-400 uppercase block">Total Expenses</span>
            <span className="text-base font-black font-mono text-purple-900">
              ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Modal Bottom Action Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveExpenses}
              disabled={saving || loading || isDenied || entries.length === 0}
              className={`px-5 py-2 text-xs font-bold text-white bg-purple-700 rounded-xl transition-all flex items-center gap-1.5 shadow-xs ${
                saving || loading || isDenied || entries.length === 0
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-purple-800 cursor-pointer'
              }`}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Expenses</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadExpensePdf}
              disabled={downloadingPdf || !hasSavedRecords || isDenied || loading}
              className="px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Download Expense PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePrintExpenseReport}
              disabled={printingPdf || !hasSavedRecords || isDenied || loading}
              className="px-4 py-2 text-xs font-bold text-gray-800 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {printingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              <span>Print Expense Report</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
