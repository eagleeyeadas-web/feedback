import { useState, useEffect } from 'react';
import {
  Receipt,
  Plus,
  Trash2,
  Upload,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  Loader2,
  Calendar,
  CreditCard,
  Tag,
  DollarSign,
  FileCheck,
  ExternalLink,
} from 'lucide-react';
import {
  fetchJobExpenses,
  saveJobExpensesApi,
  uploadExpenseReceiptApi,
  fetchTechnicianMonthlyExpenseSummary,
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
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Loaded expenses and metrics
  const [existingExpenses, setExistingExpenses] = useState([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [monthlyTotal, setMonthlyTotal] = useState(0);

  // New expense entries form
  const [newEntries, setNewEntries] = useState([
    {
      id: `new-${Date.now()}-0`,
      expense_date: new Date().toISOString().split('T')[0],
      category: 'Travel',
      description: '',
      amount: '',
      payment_method: 'Cash',
      receipt_url: '',
      receipt_filename: '',
      notes: '',
      uploading: false,
    },
  ]);

  // Load existing expenses and technician monthly total
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!checklist?.id || !token) return;
      setLoading(true);
      setError('');

      try {
        const [expData, monthlyData] = await Promise.all([
          fetchJobExpenses(token, checklist.id),
          fetchTechnicianMonthlyExpenseSummary(token).catch(() => ({ total: 0 })),
        ]);

        if (isMounted) {
          setExistingExpenses(expData.expenses || []);
          setJobTotal(expData.job_total || 0);
          setDraftTotal(expData.draft_total || 0);
          setDraftCount(expData.draft_count || 0);
          setMonthlyTotal(monthlyData.total || expData.technician_monthly_total || 0);

          // If there are existing draft entries, pre-fill them into the form for editing
          const drafts = (expData.expenses || []).filter((e) => e.status === 'Draft');
          if (drafts.length > 0) {
            setNewEntries(
              drafts.map((d) => ({
                id: d.id,
                expense_date: d.expense_date || new Date().toISOString().split('T')[0],
                category: d.category || 'Travel',
                description: d.description || '',
                amount: String(d.amount || ''),
                payment_method: d.payment_method || 'Cash',
                receipt_url: d.receipt_url || '',
                receipt_filename: d.receipt_filename || '',
                notes: d.notes || '',
                uploading: false,
              }))
            );
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to load expenses for this job');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [checklist?.id, token]);

  // Add another expense entry row
  const handleAddEntry = () => {
    setNewEntries((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        expense_date: new Date().toISOString().split('T')[0],
        category: 'Travel',
        description: '',
        amount: '',
        payment_method: 'Cash',
        receipt_url: '',
        receipt_filename: '',
        notes: '',
        uploading: false,
      },
    ]);
  };

  // Remove an entry row
  const handleRemoveEntry = (index) => {
    setNewEntries((prev) => prev.filter((_, i) => i !== index));
  };

  // Update field of an entry row
  const handleEntryChange = (index, field, value) => {
    setNewEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
    );
  };

  // Upload receipt file for an entry
  const handleReceiptUpload = async (index, file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Receipt must be an image (JPEG, PNG, WebP) or PDF file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Receipt file size must be less than 10MB.');
      return;
    }

    handleEntryChange(index, 'uploading', true);
    setError('');

    try {
      const res = await uploadExpenseReceiptApi(token, checklist.id, file);
      setNewEntries((prev) =>
        prev.map((entry, i) =>
          i === index
            ? {
                ...entry,
                receipt_url: res.receipt_url,
                receipt_filename: res.receipt_filename || file.name,
                uploading: false,
              }
            : entry
        )
      );
    } catch (err) {
      setError(err.message || 'Failed to upload receipt');
      handleEntryChange(index, 'uploading', false);
    }
  };

  // Validate form entries
  const validateForm = () => {
    if (newEntries.length === 0) {
      return 'Please add at least one expense entry.';
    }

    for (let i = 0; i < newEntries.length; i++) {
      const entry = newEntries[i];
      const amt = parseFloat(entry.amount);
      if (isNaN(amt) || amt <= 0) {
        return `Expense #${i + 1}: Amount must be a positive number greater than ₹0.`;
      }
      if (!entry.description.trim()) {
        return `Expense #${i + 1}: Description is required.`;
      }
    }
    return null;
  };

  // Submit expenses (isDraft = false for Recorded, isDraft = true for Draft)
  const handleSaveExpenses = async (isDraft = false) => {
    setError('');
    setSuccessMsg('');

    const validationErr = validateForm();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setSubmitting(true);
    const idempotencyKey = `exp-${checklist.id}-${Date.now()}`;

    try {
      const payload = {
        is_draft: isDraft,
        idempotency_key: idempotencyKey,
        expenses: newEntries.map((e) => ({
          expense_date: e.expense_date,
          category: e.category,
          description: e.description.trim(),
          amount: parseFloat(e.amount),
          payment_method: e.payment_method,
          receipt_url: e.receipt_url || null,
          receipt_filename: e.receipt_filename || null,
          notes: e.notes ? e.notes.trim() : null,
        })),
      };

      const result = await saveJobExpensesApi(token, checklist.id, payload);

      setSuccessMsg(
        isDraft
          ? 'Draft expenses saved successfully!'
          : 'Technician expenses recorded successfully!'
      );

      // Refresh loaded expenses
      if (result.summary) {
        setExistingExpenses(result.summary.expenses || []);
        setJobTotal(result.summary.job_total || 0);
        setDraftTotal(result.summary.draft_total || 0);
        setDraftCount(result.summary.draft_count || 0);
        setMonthlyTotal(result.summary.technician_monthly_total || monthlyTotal);
      }

      if (!isDraft) {
        // Clear new form if fully recorded
        setNewEntries([]);
      }

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      console.error('Failed to save expenses:', err);
      setError(err.message || 'Failed to record expenses');
    } finally {
      setSubmitting(false);
    }
  };

  // Sum of currently entered (unsubmitted) rows
  const currentFormSum = newEntries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 my-8 max-h-[92vh] overflow-y-auto border border-gray-100">
        {/* Header with Workflow Step Breadcrumb */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Step 1: Report Submitted
              </span>
              <span className="text-gray-300">→</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-600 text-white uppercase tracking-wider">
                Step 2: Technician Expenses
              </span>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-purple-600" />
              <span>Record Job Expenses — {checklist.client_name}</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Record-only job travel, fuel, food, toll, and accommodation costs incurred during this installation.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Populated Job Reference */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Checklist No.</span>
              <span className="font-mono font-bold text-purple-700">{checklist.checklist_number}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Client Name</span>
              <span className="font-bold text-gray-900 truncate block">{checklist.client_name}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Service Engineer</span>
              <span className="font-semibold text-gray-800 truncate block">
                {checklist.service_engineer || 'Technician'}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Job Location</span>
              <span className="text-gray-700 truncate block">{checklist.client_location || 'Site Location'}</span>
            </div>
          </div>
        </div>

        {/* Summary Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50/40 p-3.5 rounded-xl border border-purple-200">
            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">
              This Job Recorded Expenses
            </span>
            <span className="text-xl font-black text-purple-950 mt-1 block font-mono">
              ₹{jobTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-purple-600 block mt-0.5">
              Confirmed &amp; recorded for this job
            </span>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-slate-50 p-3.5 rounded-xl border border-blue-200">
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
              Monthly Recorded Total
            </span>
            <span className="text-xl font-black text-blue-950 mt-1 block font-mono">
              ₹{monthlyTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-blue-600 block mt-0.5">
              Your submitted total this month
            </span>
          </div>

          <div className="bg-gradient-to-br from-amber-50 to-slate-50 p-3.5 rounded-xl border border-amber-200">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
              Drafts Saved
            </span>
            <span className="text-xl font-black text-amber-950 mt-1 block font-mono">
              {draftCount} Entry(ies)
            </span>
            <span className="text-[10px] text-amber-600 block mt-0.5">
              Drafts excluded from submitted totals
            </span>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Previously Recorded Expenses (Audit Trail) */}
        {existingExpenses.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Previously Recorded Expenses for this Job ({existingExpenses.length})</span>
              </h4>
              <span className="text-[11px] text-gray-500 font-mono">
                Total: ₹{jobTotal.toFixed(2)}
              </span>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3">Description</th>
                    <th className="py-2 px-3 text-right">Amount (₹)</th>
                    <th className="py-2 px-3 text-center">Payment</th>
                    <th className="py-2 px-3 text-center">Status</th>
                    <th className="py-2 px-3 text-center">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {existingExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-gray-50/60">
                      <td className="py-2 px-3 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                        {exp.expense_date}
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-medium text-gray-900 max-w-xs truncate">
                        {exp.description}
                        {exp.notes && (
                          <span className="block text-[10px] text-gray-400 font-normal">
                            Note: {exp.notes}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-gray-900">
                        ₹{parseFloat(exp.amount).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center text-[10px] text-gray-600">
                        {exp.payment_method}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            exp.status === 'Recorded'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {exp.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {exp.receipt_url ? (
                          <a
                            href={exp.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-purple-600 hover:text-purple-800 flex items-center justify-center gap-1 font-semibold text-[11px]"
                          >
                            <span>View</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-400 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Enter New Expense Items Form */}
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-purple-600" />
                <span>Add Expense Entries</span>
              </h4>
              <span className="text-[11px] text-gray-500">
                Enter all expenses incurred during this installation job.
              </span>
            </div>
            <button
              type="button"
              onClick={handleAddEntry}
              className="px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Another Expense</span>
            </button>
          </div>

          {newEntries.length === 0 ? (
            <div className="p-6 text-center border-2 border-dashed border-gray-200 rounded-xl space-y-2">
              <Receipt className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="text-xs text-gray-500 font-medium">No new expense entries in this batch.</p>
              <button
                type="button"
                onClick={handleAddEntry}
                className="px-3 py-1.5 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-lg cursor-pointer"
              >
                + Add Expense Entry
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {newEntries.map((entry, index) => (
                <div
                  key={entry.id || index}
                  className="p-3.5 bg-gray-50/80 rounded-xl border border-gray-200 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/60">
                    <span className="font-bold text-gray-700 flex items-center gap-1 text-[11px]">
                      <Tag className="w-3.5 h-3.5 text-purple-600" />
                      <span>Expense #{index + 1}</span>
                    </span>
                    {newEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(index)}
                        className="text-rose-600 hover:text-rose-800 flex items-center gap-1 text-[11px] cursor-pointer"
                        title="Remove this expense row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  {/* Grid 1: Date, Category, Amount, Payment Method */}
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
                        placeholder="e.g. 350.00"
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

                  {/* Grid 2: Description & Optional Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                        Description *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Diesel fuel for service vehicle / Highway toll"
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
                        placeholder="e.g. Toll plaza receipt #44091"
                        value={entry.notes}
                        onChange={(e) => handleEntryChange(index, 'notes', e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  {/* Receipt Upload Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-gray-200/50">
                    <div className="flex items-center gap-2">
                      <label className="px-2.5 py-1 text-[11px] font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3 h-3 text-purple-600" />
                        <span>{entry.receipt_filename ? 'Replace Receipt' : 'Upload Receipt (Photo/PDF)'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          className="hidden"
                          onChange={(e) => handleReceiptUpload(index, e.target.files[0])}
                        />
                      </label>

                      {entry.uploading && (
                        <span className="text-[11px] text-purple-600 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
                        </span>
                      )}

                      {entry.receipt_filename && !entry.uploading && (
                        <div className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span className="max-w-[180px] truncate">{entry.receipt_filename}</span>
                          <button
                            type="button"
                            onClick={() => {
                              handleEntryChange(index, 'receipt_url', '');
                              handleEntryChange(index, 'receipt_filename', '');
                            }}
                            className="text-gray-400 hover:text-gray-600 ml-1"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>

                    <span className="text-[10px] text-gray-400">
                      Receipt photo or PDF (max 10MB)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New Entries Subtotal Banner */}
          {newEntries.length > 0 && (
            <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-200/80 flex items-center justify-between text-xs">
              <span className="font-bold text-purple-900">
                New Expenses in this Submission ({newEntries.length} entries):
              </span>
              <span className="font-mono font-black text-purple-900 text-sm">
                ₹{currentFormSum.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-gray-100">
          <div className="text-[11px] text-gray-500">
            <span>Expenses are recorded against </span>
            <strong className="text-gray-800">{checklist.checklist_number}</strong>.
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
            >
              Enter Later / Close
            </button>

            {newEntries.length > 0 && (
              <button
                type="button"
                onClick={() => handleSaveExpenses(true)}
                disabled={submitting}
                className="px-4 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Draft</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSaveExpenses(false)}
              disabled={submitting || newEntries.length === 0}
              className="px-5 py-2 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
              <span>Submit Expenses (Recorded)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
