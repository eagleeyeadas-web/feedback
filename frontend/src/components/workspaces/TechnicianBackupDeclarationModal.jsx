import { useState, useEffect } from 'react';
import {
  X,
  Package,
  Plus,
  Trash2,
  Sparkles,
  Info,
  History,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { fetchBackupProducts, fetchBackupDeclaration, saveBackupDeclaration } from '../../lib/api';

const COMMON_UNITS = ['Nos.', 'Metres', 'Packets', 'Roll', 'Set', 'Box', 'Piece'];

export default function TechnicianBackupDeclarationModal({
  isOpen,
  job,
  token,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [availableProducts, setAvailableProducts] = useState([]);
  const [hasBackupItems, setHasBackupItems] = useState(false);
  const [noItemsReason, setNoItemsReason] = useState('');
  const [items, setItems] = useState([]);
  const [declarationStatus, setDeclarationStatus] = useState('NOT_RECORDED');
  const [declarationTimestamp, setDeclarationTimestamp] = useState(null);
  const [history, setHistory] = useState([]);
  const [salesExpected, setSalesExpected] = useState(false);

  useEffect(() => {
    if (!isOpen || !job?.id) return;
    let isMounted = true;

    async function load() {
      setLoading(true);
      setError('');
      setSuccessMsg('');
      try {
        const [products, decl] = await Promise.all([
          fetchBackupProducts(token).catch(() => []),
          fetchBackupDeclaration(token, job.id).catch(() => null),
        ]);

        if (!isMounted) return;

        setAvailableProducts(products);

        const salesExpects = Boolean(job.carry_extra_backup_items ?? job.extra_devices ?? decl?.sales_expected);
        setSalesExpected(salesExpects);

        if (decl && decl.status && decl.status !== 'NOT_RECORDED') {
          setHasBackupItems(Boolean(decl.has_backup_items));
          setNoItemsReason(decl.no_items_reason || '');
          setDeclarationStatus(decl.status);
          setDeclarationTimestamp(decl.declaration_timestamp || decl.updated_at);
          setHistory(Array.isArray(decl.history) ? decl.history : []);

          if (Array.isArray(decl.items) && decl.items.length > 0) {
            setItems(
              decl.items.map((it, idx) => ({
                id: it.id || `item-${idx}-${Date.now()}`,
                item_name: it.item_name || '',
                quantity: Number(it.quantity) || 1,
                unit: it.unit || 'Nos.',
                sku: it.item_sku || it.sku || '',
                material_id: it.material_id || it.item_id || null,
              }))
            );
          } else {
            setItems([]);
          }
        } else {
          // Defaults if not yet recorded
          setHasBackupItems(salesExpects);
          setNoItemsReason('');
          setDeclarationStatus('NOT_RECORDED');
          setDeclarationTimestamp(null);
          setHistory([]);
          if (salesExpects) {
            setItems([
              {
                id: `item-init-${Date.now()}`,
                item_name: products[0]?.item_name || 'Camera',
                quantity: 1,
                unit: products[0]?.unit || 'Nos.',
                sku: products[0]?.sku || '',
                material_id: products[0]?.id || null,
              },
            ]);
          } else {
            setItems([]);
          }
        }
      } catch (err) {
        if (isMounted) setError(err.message || 'Failed to load backup declaration details');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [isOpen, job, token]);

  if (!isOpen || !job) return null;

  const handleAddItemRow = () => {
    const firstProd = availableProducts[0];
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        item_name: firstProd ? firstProd.item_name : '',
        quantity: 1,
        unit: firstProd ? firstProd.unit : 'Nos.',
        sku: firstProd ? firstProd.sku : '',
        material_id: firstProd ? firstProd.id : null,
      },
    ]);
  };

  const handleRemoveItemRow = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleItemChange = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (field === 'item_name') {
          const matched = availableProducts.find((p) => p.item_name.toLowerCase() === value.toLowerCase());
          return {
            ...it,
            item_name: value,
            unit: matched?.unit || it.unit,
            sku: matched?.sku || it.sku,
            material_id: matched?.id || it.material_id,
          };
        }
        if (field === 'quantity') {
          const parsed = value === '' ? '' : parseFloat(value);
          return { ...it, quantity: isNaN(parsed) ? '' : Math.max(0.1, parsed) };
        }
        return { ...it, [field]: value };
      })
    );
  };

  const handleToggleHasItems = (isYes) => {
    setHasBackupItems(isYes);
    setError('');
    if (isYes && items.length === 0) {
      handleAddItemRow();
    }
  };

  const validate = () => {
    if (salesExpected && !hasBackupItems) {
      if (!noItemsReason || !noItemsReason.trim()) {
        return 'Sales indicated extra backup items are expected. Please specify why no extra backup items were carried to the site.';
      }
    }

    if (hasBackupItems) {
      if (!items || items.length === 0) {
        return 'Please add at least one loose backup item.';
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.item_name || !it.item_name.trim()) {
          return `Row #${i + 1}: Please select or enter an item name.`;
        }
        const q = Number(it.quantity);
        if (isNaN(q) || q <= 0) {
          return `Row #${i + 1} (${it.item_name}): Quantity must be a positive number greater than 0.`;
        }
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const valErr = validate();
    if (valErr) {
      setError(valErr);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const payload = {
        has_backup_items: hasBackupItems,
        no_items_reason: hasBackupItems ? null : noItemsReason.trim(),
        items: hasBackupItems
          ? items.map((it) => ({
              item_name: it.item_name.trim(),
              quantity: Number(it.quantity),
              unit: it.unit || 'Nos.',
              item_sku: it.sku || null,
              item_id: it.material_id || null,
            }))
          : [],
      };

      const res = await saveBackupDeclaration(token, job.id, payload);
      setSuccessMsg('Pre-installation extra backup items recorded successfully!');
      setTimeout(() => {
        if (onSaved) onSaved(res.declaration);
        onClose();
      }, 750);
    } catch (err) {
      setError(err.message || 'Failed to save backup items declaration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900 via-indigo-950 to-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-200 shadow-inner">
              <Package size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">Pre-Installation: Extra Backup Items</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-800 text-purple-200 border border-purple-600/40">
                  {declarationStatus === 'CORRECTED' ? 'Corrected' : declarationStatus === 'DECLARED' ? 'Declared' : 'Not Recorded'}
                </span>
              </div>
              <p className="text-xs text-purple-200/80 mt-0.5">
                Checklist #{job.checklist_number} • Client: {job.client_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-purple-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Status & Error Alerts */}
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Sales Declaration Notice Box */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
                Sales Team Expectation
              </span>
              <div className="text-xs font-bold text-gray-900 flex items-center gap-2">
                <span>Technician carrying extra backup items?</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                    salesExpected
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {salesExpected ? 'YES' : 'NO'}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-gray-500 max-w-xs sm:text-right">
              {salesExpected
                ? 'Sales confirmed extra backup items are expected. Please record individual loose products below.'
                : 'Sales indicated no extra backup items. You may confirm or add backup items if necessary.'}
            </div>
          </div>

          {/* Core Rule Explanatory Banner */}
          <div className="p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-xl text-xs text-purple-950 flex items-start gap-2.5">
            <Info size={16} className="text-purple-700 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <strong>Mandatory Rule:</strong> Extra loose backup items are individual products (e.g., loose cameras, displays, cables) carried for site contingencies. They <strong>never</strong> increase the Sales preliminary BOM, <strong>never</strong> count as complete camera sets, and <strong>never</strong> modify customer device counts.
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-purple-600" />
              <p className="text-xs">Loading backup items and available catalog...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Question: Carrying Extra Items? */}
              <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
                <label className="block text-xs font-bold text-gray-900">
                  Are you carrying extra loose backup items for this job? <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-6">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="techHasBackupItems"
                      checked={hasBackupItems}
                      onChange={() => handleToggleHasItems(true)}
                      className="w-4 h-4 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-xs font-bold text-purple-900">
                      Yes, carrying extra backup items
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="techHasBackupItems"
                      checked={!hasBackupItems}
                      onChange={() => handleToggleHasItems(false)}
                      className="w-4 h-4 text-gray-600 focus:ring-gray-500"
                    />
                    <span className="text-xs font-semibold text-gray-700">
                      No extra backup items carried
                    </span>
                  </label>
                </div>

                {/* If Sales indicated YES but Tech selects NO: require reason */}
                {salesExpected && !hasBackupItems && (
                  <div className="pt-2 animate-in fade-in duration-150">
                    <label className="block text-xs font-bold text-rose-800 mb-1">
                      Reason why no backup items were carried <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      value={noItemsReason}
                      onChange={(e) => setNoItemsReason(e.target.value)}
                      placeholder="Explain why backup hardware was not carried (e.g., standard depot fleet, verified working stock on site, technician vehicle capacity)..."
                      rows={2}
                      className="w-full text-xs p-2.5 border border-rose-300 rounded-xl focus:outline-none focus:border-rose-500 font-medium bg-rose-50/20"
                    />
                  </div>
                )}
              </div>

              {/* Items Table when hasBackupItems === true */}
              {hasBackupItems && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles size={14} className="text-amber-500" /> Declared Loose Products
                      </h4>
                      <p className="text-[11px] text-gray-500">
                        Record each loose component, quantity, and unit.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddItemRow}
                      className="px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    >
                      <Plus size={14} /> Add Product
                    </button>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Product / Loose Item</th>
                          <th className="py-2.5 px-3 w-28">Quantity</th>
                          <th className="py-2.5 px-3 w-32">Unit</th>
                          <th className="py-2.5 px-3 text-right w-16">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-gray-400 italic">
                              No loose items added yet. Click "+ Add Product" to add.
                            </td>
                          </tr>
                        ) : (
                          items.map((it, idx) => (
                            <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-3 font-mono font-bold text-gray-400">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3">
                                {availableProducts.length > 0 ? (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      list={`prod-list-${it.id}`}
                                      value={it.item_name}
                                      onChange={(e) => handleItemChange(it.id, 'item_name', e.target.value)}
                                      placeholder="e.g., Camera, Display, Cable..."
                                      className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-medium"
                                      required
                                    />
                                    <datalist id={`prod-list-${it.id}`}>
                                      {availableProducts.map((p) => (
                                        <option key={p.id} value={p.item_name}>
                                          {p.item_name} ({p.unit || 'Nos.'})
                                        </option>
                                      ))}
                                    </datalist>
                                  </div>
                                ) : (
                                  <input
                                    type="text"
                                    value={it.item_name}
                                    onChange={(e) => handleItemChange(it.id, 'item_name', e.target.value)}
                                    placeholder="e.g. Camera, Display, 5m Cable"
                                    className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-medium"
                                    required
                                  />
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <input
                                  type="number"
                                  min="0.1"
                                  step="any"
                                  value={it.quantity}
                                  onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                                  placeholder="1"
                                  className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-bold font-mono text-gray-900"
                                  required
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <select
                                  value={it.unit}
                                  onChange={(e) => handleItemChange(it.id, 'unit', e.target.value)}
                                  className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-medium bg-white"
                                >
                                  {COMMON_UNITS.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItemRow(it.id)}
                                  className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                  title="Remove item"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* History & Audit Logs Preview */}
              {history.length > 0 && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                    <History size={13} className="text-purple-600" /> Declaration Revision History ({history.length})
                  </div>
                  <div className="space-y-1.5 max-h-24 overflow-y-auto">
                    {history.map((h, i) => (
                      <div key={i} className="text-[10px] text-gray-600 flex items-center justify-between bg-white px-2.5 py-1 rounded border border-gray-100">
                        <span>Modified by {h.modified_by} (Items: {h.previous_items_count})</span>
                        <span className="font-mono text-gray-400">{new Date(h.modified_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp footer indicator */}
              {declarationTimestamp && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1 font-mono">
                  <ShieldCheck size={13} className="text-emerald-500" /> Last recorded: {new Date(declarationTimestamp).toLocaleString()}
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  <span>{submitting ? 'Saving...' : declarationStatus === 'NOT_RECORDED' ? 'Save Declaration' : 'Save Correction'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
