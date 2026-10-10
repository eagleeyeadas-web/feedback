import { useState, useEffect } from 'react';
import { Wrench, CheckCircle2, AlertTriangle, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { submitInstallationCompletionReport, fetchDeviceCarryRecord } from '../../lib/api';

export default function InstallationCompletionModal({ checklist, carryRecord: initialCarryRecord, token, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [fetchingCarry, setFetchingCarry] = useState(!initialCarryRecord && !!checklist?.id);
  const [error, setError] = useState('');
  const [completionStatus, setCompletionStatus] = useState('Site Work Completed');
  const [generalRemarks, setGeneralRemarks] = useState('');
  const [items, setItems] = useState([]);
  const [expandedDamagedMissing, setExpandedDamagedMissing] = useState({});

  useEffect(() => {
    let isMounted = true;
    async function loadCarryRecord() {
      if (initialCarryRecord) {
        setupItems(initialCarryRecord.items);
        setFetchingCarry(false);
        return;
      }
      if (checklist?.id) {
        try {
          setFetchingCarry(true);
          const res = await fetchDeviceCarryRecord(token, checklist.id);
          if (isMounted && res?.items && res.items.length > 0) {
            setupItems(res.items);
          } else if (isMounted) {
            setupFallbackItems();
          }
        } catch (err) {
          console.warn('Could not fetch carry record for completion modal, using fallback:', err.message);
          if (isMounted) setupFallbackItems();
        } finally {
          if (isMounted) setFetchingCarry(false);
        }
      } else {
        setupFallbackItems();
        setFetchingCarry(false);
      }
    }

    function setupItems(carryItems) {
      const formItems = carryItems.map((ci) => {
        const qtyCarried = Math.max(0, parseInt(ci.quantity_declared_to_carry || ci.quantity_carried, 10) || 0);
        return {
          device_type: ci.device_type,
          quantity_carried: qtyCarried,
          quantity_installed: qtyCarried, // default installed = carried
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
          discrepancy_reason: '',
        };
      });
      setItems(formItems);
    }

    function setupFallbackItems() {
      const fallbackItems = [
        {
          device_type: checklist.device_type || '2 Channel Live',
          quantity_carried: checklist.number_of_devices || 1,
        },
        ...(checklist.extra_devices && checklist.extra_device_type
          ? [{ device_type: checklist.extra_device_type, quantity_carried: checklist.extra_device_count || 1 }]
          : []),
      ];
      setupItems(fallbackItems);
    }

    loadCarryRecord();
    return () => {
      isMounted = false;
    };
  }, [checklist, initialCarryRecord, token]);

  const toggleDamagedMissing = (idx) => {
    setExpandedDamagedMissing((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const validateForm = () => {
    for (const item of items) {
      const carried = parseInt(item.quantity_carried, 10) || 0;
      const installed = parseInt(item.quantity_installed, 10) || 0;
      const toReturn = parseInt(item.quantity_to_return, 10) || 0;
      const damaged = parseInt(item.quantity_damaged, 10) || 0;
      const missing = parseInt(item.quantity_missing, 10) || 0;

      if (installed < 0 || toReturn < 0 || damaged < 0 || missing < 0) {
        return `Quantities for "${item.device_type}" cannot be negative.`;
      }

      if (installed > carried || toReturn > carried || damaged > carried || missing > carried) {
        return `Individual quantities for "${item.device_type}" cannot exceed total carried quantity (${carried}).`;
      }

      const totalAccounted = installed + toReturn + damaged + missing;
      if (totalAccounted !== carried && (!item.discrepancy_reason || !item.discrepancy_reason.trim())) {
        return `Quantities do not match for "${item.device_type}" (Carried: ${carried}, Accounted: ${totalAccounted}). Please check your entries or provide an explanation.`;
      }
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationErr = validateForm();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        items: items.map((i) => ({
          device_type: i.device_type,
          quantity_carried: parseInt(i.quantity_carried, 10) || 0,
          quantity_installed: parseInt(i.quantity_installed, 10) || 0,
          quantity_to_return: parseInt(i.quantity_to_return, 10) || 0,
          quantity_damaged: parseInt(i.quantity_damaged, 10) || 0,
          quantity_missing: parseInt(i.quantity_missing, 10) || 0,
          discrepancy_reason: i.discrepancy_reason,
        })),
        completion_status: completionStatus,
        remarks: generalRemarks,
      };

      const result = await submitInstallationCompletionReport(token, checklist.id, payload);
      onSuccess(result);
    } catch (err) {
      console.error('Error submitting completion report:', err);
      setError(err.message || 'Failed to submit installation completion report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-purple-100 text-purple-800 rounded">
              Site Completion Report
            </span>
            <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-purple-600" /> Submit Site Installation Completion Report
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Job Reference Summary */}
        <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold">Checklist No.</span>
              <span className="font-mono font-bold text-purple-700">{checklist.checklist_number}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold">Client Name</span>
              <span className="font-bold text-gray-900 truncate block">{checklist.client_name}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold">Assigned Engineer</span>
              <span className="font-semibold text-gray-800 truncate block">{checklist.service_engineer || 'Unassigned'}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold">Service Assistant</span>
              <span className="font-semibold text-gray-800 truncate block">{checklist.service_assistant || 'Unassigned'}</span>
            </div>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fetchingCarry ? (
          <div className="py-10 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
            <span className="text-xs font-medium">Loading carry record details...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Device Cards */}
            <div className="space-y-3">
              {items.map((item, idx) => {
                const carried = parseInt(item.quantity_carried, 10) || 0;
                const installed = parseInt(item.quantity_installed, 10) || 0;
                const toReturn = parseInt(item.quantity_to_return, 10) || 0;
                const damaged = parseInt(item.quantity_damaged, 10) || 0;
                const missing = parseInt(item.quantity_missing, 10) || 0;

                const totalAccounted = installed + toReturn + damaged + missing;
                const isDiscrepancy = carried !== totalAccounted;
                const isExpanded = !!expandedDamagedMissing[idx];

                return (
                  <div key={idx} className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs space-y-3">
                    {/* Device Header */}
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                      <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                        <Wrench className="w-4 h-4 text-purple-600" /> {item.device_type}
                      </span>
                      <span className="text-xs font-medium text-gray-600 bg-purple-50 px-2.5 py-0.5 rounded-md border border-purple-100">
                        Carried: <strong className="text-purple-700 font-mono">{carried} units</strong>
                      </span>
                    </div>

                    {/* Quantity Installed & Returning Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Quantity Installed</label>
                        <input
                          type="number"
                          min="0"
                          max={carried}
                          value={item.quantity_installed}
                          onChange={(e) => handleItemChange(idx, 'quantity_installed', e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Quantity Returning to Store</label>
                        <input
                          type="number"
                          min="0"
                          max={carried}
                          value={item.quantity_to_return}
                          onChange={(e) => handleItemChange(idx, 'quantity_to_return', e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Collapsible Damaged / Missing Section */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleDamagedMissing(idx)}
                        className="text-[11px] font-semibold text-gray-500 hover:text-purple-600 flex items-center gap-1 focus:outline-none transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        <span>Report damaged or missing devices</span>
                        {(damaged > 0 || missing > 0) && (
                          <span className="ml-1.5 px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                            {damaged > 0 && `${damaged} damaged`}
                            {damaged > 0 && missing > 0 && ', '}
                            {missing > 0 && `${missing} missing`}
                          </span>
                        )}
                      </button>

                      {(isExpanded || damaged > 0 || missing > 0) && (
                        <div className="grid grid-cols-2 gap-3 mt-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Damaged Qty</label>
                            <input
                              type="number"
                              min="0"
                              max={carried}
                              value={item.quantity_damaged}
                              onChange={(e) => handleItemChange(idx, 'quantity_damaged', e.target.value)}
                              className="w-full px-2.5 py-1 border border-gray-300 rounded text-xs font-bold text-rose-600 focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Missing Qty</label>
                            <input
                              type="number"
                              min="0"
                              max={carried}
                              value={item.quantity_missing}
                              onChange={(e) => handleItemChange(idx, 'quantity_missing', e.target.value)}
                              className="w-full px-2.5 py-1 border border-gray-300 rounded text-xs font-bold text-amber-600 focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Inline Mismatch Alert (Only shown if quantities do not match) */}
                    {isDiscrepancy && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg space-y-1.5">
                        <div className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                          <span>Quantities do not match. (Carried: {carried}, Total: {totalAccounted})</span>
                        </div>
                        <input
                          type="text"
                          placeholder="Brief explanation required..."
                          value={item.discrepancy_reason}
                          onChange={(e) => handleItemChange(idx, 'discrepancy_reason', e.target.value)}
                          className="w-full px-3 py-1 border border-rose-300 rounded text-xs focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                          required
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block font-semibold text-gray-700 mb-1 text-xs">Overall Installation Status</label>
                <select
                  value={completionStatus}
                  onChange={(e) => setCompletionStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="Site Work Completed">Site Work Completed</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1 text-xs">Optional Technician Remarks</label>
                <input
                  type="text"
                  placeholder="Optional site notes..."
                  value={generalRemarks}
                  onChange={(e) => setGeneralRemarks(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{loading ? 'Submitting Report...' : 'Submit Installation Report'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
