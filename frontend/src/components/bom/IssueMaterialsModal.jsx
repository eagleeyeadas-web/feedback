import { useState, useEffect } from 'react';
import { Package, X, AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { fetchMaterialInventory, issueMaterialsForChecklist } from '../../lib/api';

export default function IssueMaterialsModal({ checklist, token, onClose, onSuccess }) {
  const [inventory, setInventory] = useState([]);
  const [loadingInv, setLoadingInv] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const bomItems = Array.isArray(checklist.bom_snapshot?.items)
    ? checklist.bom_snapshot.items
    : [];

  useEffect(() => {
    if (!token) return;
    setLoadingInv(true);
    fetchMaterialInventory(token)
      .then((data) => setInventory(data || []))
      .catch((err) => console.error('Failed to load material inventory:', err))
      .finally(() => setLoadingInv(false));
  }, [token]);

  // Inventory map
  const invMap = new Map(inventory.map((m) => [m.material_name.toLowerCase(), m]));

  // Check if any material has insufficient stock
  const stockDeficits = [];
  bomItems.forEach((item) => {
    const inv = invMap.get((item.material_name || '').toLowerCase());
    const available = inv ? Number(inv.current_stock) || 0 : 0;
    const required = Number(item.total_quantity) || 0;
    if (required > available) {
      stockDeficits.push({
        material_name: item.material_name,
        available,
        required,
        unit: item.unit || inv?.unit || 'Nos.',
      });
    }
  });

  const hasDeficit = stockDeficits.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (hasDeficit) {
      setError('Cannot issue materials due to insufficient stock for one or more items. Negative stock is strictly prevented.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await issueMaterialsForChecklist(token, {
        checklist_id: checklist.id,
        items: bomItems,
        remarks: remarks.trim() || `Materials issued for checklist ${checklist.checklist_number}`,
      });
      onSuccess();
    } catch (err) {
      console.error('Error issuing materials:', err);
      setError(err.message || 'Failed to issue materials');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8 border border-gray-100">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                Store Manager: Authorize Material Issuance
              </h3>
              <p className="text-xs text-gray-500">
                Job: <strong className="font-mono text-gray-800">{checklist.checklist_number}</strong> ({checklist.client_name} — {checklist.device_type} × {checklist.number_of_devices})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning / Error alert */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {hasDeficit && (
          <div className="p-4 bg-red-50 border-2 border-red-300 text-red-900 rounded-xl text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-red-900">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
              <span>Insufficient Stock Detected (Negative Stock Prevented)</span>
            </div>
            <p className="text-[11px] text-red-800">
              The following materials do not have enough usable stock in the store to fulfill this requirement:
            </p>
            <ul className="list-disc pl-5 text-[11px] space-y-0.5 text-red-900 font-semibold">
              {stockDeficits.map((d, i) => (
                <li key={i}>
                  {d.material_name}: Available {d.available} {d.unit}, Required {d.required} {d.unit} (Shortage: {d.required - d.available} {d.unit})
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-red-700 pt-1">
              Please replenish stock in the Store Manager workspace before proceeding with issuance.
            </p>
          </div>
        )}

        {/* Materials Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
            <span>Required Materials for Dispatch ({bomItems.length} items)</span>
            {loadingInv && <span className="text-gray-400 text-[11px] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking stock...</span>}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Material</th>
                  <th className="py-2.5 px-3 text-center">Req. Qty</th>
                  <th className="py-2.5 px-3 text-center">Unit</th>
                  <th className="py-2.5 px-3 text-center">In Stock</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bomItems.map((item, idx) => {
                  const inv = invMap.get((item.material_name || '').toLowerCase());
                  const inStock = inv ? Number(inv.current_stock) || 0 : 0;
                  const req = Number(item.total_quantity) || 0;
                  const isShort = req > inStock;

                  return (
                    <tr key={idx} className={isShort ? 'bg-red-50/50' : 'hover:bg-gray-50/50'}>
                      <td className="py-2.5 px-3 font-semibold text-gray-900">{item.material_name}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{item.total_quantity}</td>
                      <td className="py-2.5 px-3 text-center text-gray-600">{item.unit}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-700">
                        {loadingInv ? '...' : inStock}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {isShort ? (
                          <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 font-bold text-[10px]">
                            Shortage
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                            Available
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Dispatch Remarks / Notes
          </label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Issued materials to lead installation technician"
            className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || hasDeficit || loadingInv}
            className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing Atomic Deduction...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Authorize & Deduct Inventory</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
