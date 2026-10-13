import { useState, useEffect } from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  ShieldAlert,
  ArrowRight,
  Package,
  Layers,
  Sparkles,
  Plus,
  Trash2,
  Calculator,
  ArrowDownLeft,
} from 'lucide-react';
import {
  submitInstallationCompletionReport,
  fetchInstallationCompletionReport,
} from '../../lib/api';

export default function InstallationCompletionModal({
  checklist,
  token,
  readOnly = false,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(false);
  const [fetchingReport, setFetchingReport] = useState(readOnly);
  const [error, setError] = useState('');
  const [completionStatus, setCompletionStatus] = useState('Completed');
  const [generalRemarks, setGeneralRemarks] = useState('');
  const [items, setItems] = useState([]);
  const [materialItems, setMaterialItems] = useState([]);
  const [reportSnapshot, setReportSnapshot] = useState(null);
  const [expandedDamagedMissing, setExpandedDamagedMissing] = useState({});
  const [activeTab, setActiveTab] = useState('devices'); // 'devices' | 'materials' | 'final_bom'

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // 1. If in readOnly mode, fetch the submitted completion report
      if (readOnly && checklist?.id) {
        try {
          setFetchingReport(true);
          const report = await fetchInstallationCompletionReport(token, checklist.id);
          if (isMounted && report) {
            setReportSnapshot(report);
            if (Array.isArray(report.items) && report.items.length > 0) {
              const formItems = report.items.map((ci) => {
                const qtyCarried = Math.max(0, parseInt(ci.quantity_carried, 10) || 0);
                const reqInstalled = Math.max(0, parseInt(ci.quantity_installed_required, 10) || 0);
                const extInstalled = Math.max(0, parseInt(ci.quantity_installed_extra, 10) || 0);
                const totalInst = reqInstalled + extInstalled > 0 ? (reqInstalled + extInstalled) : Math.max(0, parseInt(ci.quantity_installed, 10) || 0);

                return {
                  device_type: ci.device_type,
                  quantity_carried: qtyCarried,
                  required_quantity: ci.required_quantity ?? Math.max(0, qtyCarried - extInstalled),
                  extra_quantity: ci.extra_quantity ?? extInstalled,
                  quantity_installed_required: reqInstalled || totalInst,
                  quantity_installed_extra: extInstalled,
                  quantity_installed: totalInst,
                  quantity_to_return: Math.max(0, parseInt(ci.quantity_to_return, 10) || 0),
                  quantity_damaged: Math.max(0, parseInt(ci.quantity_damaged, 10) || 0),
                  quantity_missing: Math.max(0, parseInt(ci.quantity_missing, 10) || 0),
                  discrepancy_reason: ci.discrepancy_reason || '',
                };
              });
              setItems(formItems);
            }

            if (Array.isArray(report.material_items) && report.material_items.length > 0) {
              setMaterialItems(report.material_items);
            }

            setCompletionStatus(report.completion_status || 'Completed');
            setGeneralRemarks(report.remarks || '');
            setFetchingReport(false);
            return;
          }
        } catch (err) {
          console.warn('Could not fetch completion report for readOnly view:', err.message);
        } finally {
          if (isMounted) setFetchingReport(false);
        }
      }

      // 2. Pre-populate items directly from Sales' recorded Devices Carried allocation
      if (checklist) {
        let configs = [];
        if (Array.isArray(checklist.devices_carried) && checklist.devices_carried.length > 0) {
          configs = checklist.devices_carried;
        } else {
          // Combine required and extra device configurations
          const reqConfigs = Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0
            ? checklist.device_configurations
            : (checklist.device_type ? [{ device_type: checklist.device_type, number_of_devices: checklist.number_of_devices || 1, quantity_carried: checklist.number_of_devices || 1 }] : []);
          
          let extraConfigs = [];
          if (Array.isArray(checklist.extra_device_configurations) && checklist.extra_device_configurations.length > 0) {
            extraConfigs = checklist.extra_device_configurations;
          } else if (checklist.extra_devices && checklist.extra_device_type) {
            extraConfigs = [{ device_type: checklist.extra_device_type, extra_quantity: checklist.extra_device_count || 1 }];
          }

          const map = new Map();
          reqConfigs.forEach((c) => {
            const type = c.device_type;
            const qty = Number(c.number_of_devices ?? c.quantity_carried) || 0;
            map.set(type, {
              device_type: type,
              required_quantity: qty,
              extra_quantity: 0,
              quantity_carried: qty,
            });
          });
          extraConfigs.forEach((c) => {
            const type = c.device_type;
            const extraQty = Number(c.extra_quantity ?? c.quantity_carried ?? c.number_of_devices) || 0;
            if (map.has(type)) {
              const ex = map.get(type);
              ex.extra_quantity = (ex.extra_quantity || 0) + extraQty;
              ex.quantity_carried = (ex.quantity_carried || 0) + extraQty;
            } else {
              map.set(type, {
                device_type: type,
                required_quantity: 0,
                extra_quantity: extraQty,
                quantity_carried: extraQty,
              });
            }
          });
          configs = Array.from(map.values());
        }

        if (configs.length === 0) {
          configs = [
            {
              device_type: checklist.device_type || '2 Channel Live',
              quantity_carried: checklist.number_of_devices || 1,
              number_of_devices: checklist.number_of_devices || 1,
              required_quantity: checklist.number_of_devices || 1,
              extra_quantity: 0,
            },
          ];
        }

        const formItems = configs.map((c) => {
          const qtyCarried = Math.max(
            1,
            parseInt(c.quantity_carried !== undefined ? c.quantity_carried : (Number(c.required_quantity || 0) + Number(c.extra_quantity || 0) || c.number_of_devices), 10) || 1
          );
          const reqQty = Math.max(0, parseInt(c.required_quantity !== undefined ? c.required_quantity : c.number_of_devices, 10) || 0);
          const extraQty = Math.max(0, parseInt(c.extra_quantity !== undefined ? c.extra_quantity : Math.max(0, qtyCarried - reqQty), 10) || 0);

          // Default: required devices installed, extra backup devices returned
          const defaultReqInstalled = reqQty;
          const defaultExtraInstalled = 0;
          const defaultReturn = extraQty;

          return {
            device_type: c.device_type,
            required_quantity: reqQty,
            extra_quantity: extraQty,
            quantity_carried: qtyCarried, // Read-only from Sales checklist
            quantity_installed_required: defaultReqInstalled,
            quantity_installed_extra: defaultExtraInstalled,
            quantity_installed: defaultReqInstalled + defaultExtraInstalled,
            quantity_to_return: defaultReturn,
            quantity_damaged: 0,
            quantity_missing: 0,
            discrepancy_reason: '',
          };
        });
        setItems(formItems);

        // Pre-populate material items from checklist preliminary BOM snapshot or template
        const prelimMaterials = checklist.bom_snapshot?.items || [];
        if (prelimMaterials.length > 0) {
          const mItems = prelimMaterials.map((m) => {
            const issuedQty = Number(m.total_quantity) || 0;
            return {
              material_id: m.material_id || null,
              material_name: m.material_name,
              unit: m.unit || 'Nos.',
              quantity_issued: issuedQty,
              quantity_used: issuedQty, // default assume used unless changed
              quantity_returned: 0,
              quantity_damaged: 0,
              quantity_missing: 0,
              remarks: '',
            };
          });
          setMaterialItems(mItems);
        } else {
          setMaterialItems([]);
        }

        setFetchingReport(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [checklist, readOnly, token]);

  const toggleDamagedMissing = (idx) => {
    setExpandedDamagedMissing((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleDeviceChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], [field]: value };
      // Keep total installed in sync
      const reqInst = parseInt(field === 'quantity_installed_required' ? value : item.quantity_installed_required, 10) || 0;
      const extInst = parseInt(field === 'quantity_installed_extra' ? value : item.quantity_installed_extra, 10) || 0;
      item.quantity_installed = reqInst + extInst;
      next[index] = item;
      return next;
    });
  };

  const handleMaterialChange = (index, field, value) => {
    setMaterialItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddMaterialRow = () => {
    setMaterialItems((prev) => [
      ...prev,
      {
        material_id: null,
        material_name: '',
        unit: 'Nos.',
        quantity_issued: 0,
        quantity_used: 0,
        quantity_returned: 1,
        quantity_damaged: 0,
        quantity_missing: 0,
        remarks: 'Extra material return',
      },
    ]);
  };

  const handleRemoveMaterialRow = (idx) => {
    setMaterialItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const validateForm = () => {
    if (!items || items.length === 0) {
      return 'No device allocation found for this installation checklist.';
    }

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const carried = parseInt(item.quantity_carried, 10) || 0;
      const reqInst = parseInt(item.quantity_installed_required, 10) || 0;
      const extInst = parseInt(item.quantity_installed_extra, 10) || 0;
      const installed = reqInst + extInst;
      const toReturn = parseInt(item.quantity_to_return, 10) || 0;
      const damaged = parseInt(item.quantity_damaged, 10) || 0;
      const missing = parseInt(item.quantity_missing, 10) || 0;

      if (reqInst < 0 || extInst < 0 || toReturn < 0 || damaged < 0 || missing < 0) {
        return `Quantities for "${item.device_type}" cannot be negative numbers.`;
      }

      const totalAccounted = installed + toReturn + damaged + missing;
      if (totalAccounted !== carried) {
        return `Reconciliation mismatch for "${item.device_type}": Quantity carried (${carried}) must equal Installed (${installed} [${reqInst} req + ${extInst} extra]) + Returned (${toReturn}) + Damaged (${damaged}) + Missing (${missing}). Quantities must reconcile before submission.`;
      }

      if ((damaged > 0 || missing > 0) && (!item.discrepancy_reason || !item.discrepancy_reason.trim())) {
        return `Explanation remark is required for "${item.device_type}" because damaged (${damaged}) or missing (${missing}) devices were recorded.`;
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
          quantity_installed_required: parseInt(i.quantity_installed_required, 10) || 0,
          quantity_installed_extra: parseInt(i.quantity_installed_extra, 10) || 0,
          quantity_installed: (parseInt(i.quantity_installed_required, 10) || 0) + (parseInt(i.quantity_installed_extra, 10) || 0),
          quantity_to_return: parseInt(i.quantity_to_return, 10) || 0,
          quantity_damaged: parseInt(i.quantity_damaged, 10) || 0,
          quantity_missing: parseInt(i.quantity_missing, 10) || 0,
          discrepancy_reason: i.discrepancy_reason ? i.discrepancy_reason.trim() : null,
        })),
        material_items: materialItems.map((m) => ({
          material_id: m.material_id,
          material_name: (m.material_name || '').trim(),
          unit: m.unit || 'Nos.',
          quantity_issued: parseFloat(m.quantity_issued) || 0,
          quantity_used: parseFloat(m.quantity_used) || 0,
          quantity_returned: parseFloat(m.quantity_returned) || 0,
          quantity_damaged: parseFloat(m.quantity_damaged) || 0,
          quantity_missing: parseFloat(m.quantity_missing) || 0,
          remarks: m.remarks ? m.remarks.trim() : null,
        })),
        completion_status: completionStatus,
        remarks: generalRemarks.trim() || null,
      };

      const result = await submitInstallationCompletionReport(token, checklist.id, payload);
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      console.error('Error submitting completion report:', err);
      setError(err.message || 'Failed to submit post-installation report');
    } finally {
      setLoading(false);
    }
  };

  const totalCarriedAll = items.reduce((sum, i) => sum + (parseInt(i.quantity_carried, 10) || 0), 0);
  const totalInstalledAll = items.reduce((sum, i) => sum + ((parseInt(i.quantity_installed_required, 10) || 0) + (parseInt(i.quantity_installed_extra, 10) || 0)), 0);
  const totalReturnedAll = items.reduce((sum, i) => sum + (parseInt(i.quantity_to_return, 10) || 0), 0);
  const totalDamagedAll = items.reduce((sum, i) => sum + (parseInt(i.quantity_damaged, 10) || 0), 0);
  const totalMissingAll = items.reduce((sum, i) => sum + (parseInt(i.quantity_missing, 10) || 0), 0);
  const totalAccountedAll = totalInstalledAll + totalReturnedAll + totalDamagedAll + totalMissingAll;
  const isOverallBalanced = totalCarriedAll === totalAccountedAll && items.every((i) => {
    const c = parseInt(i.quantity_carried, 10) || 0;
    const a = (parseInt(i.quantity_installed_required, 10) || 0) + (parseInt(i.quantity_installed_extra, 10) || 0) + (parseInt(i.quantity_to_return, 10) || 0) + (parseInt(i.quantity_damaged, 10) || 0) + (parseInt(i.quantity_missing, 10) || 0);
    return c === a;
  });

  const finalBomSnapshot = reportSnapshot?.final_bom || reportSnapshot?.final_bom_snapshot || checklist?.final_bom_snapshot;
  const preliminaryBomSnapshot = checklist?.bom_snapshot;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 my-8 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-purple-100 text-purple-800 rounded">
              {readOnly ? 'View Site Installation Report (Read-Only)' : 'Technical Site Installation & Returns Form'}
            </span>
            <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-purple-600" />
              {readOnly ? 'Site Work Completion & Returns Report' : 'Post-Installation Completion & Returns Form'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Job Reference Summary */}
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
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Assigned Engineer</span>
              <span className="font-semibold text-gray-800 truncate block">{checklist.service_engineer || 'Unassigned'}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Total Devices Carried</span>
              <span className="font-mono font-bold text-blue-700 block">{totalCarriedAll} Units (Sales Allocation)</span>
            </div>
          </div>
        </div>

        {/* Modal Section Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-gray-100/80 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('devices')}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'devices'
                ? 'bg-white text-purple-900 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5 text-purple-600" />
            <span>Devices Installed & Returned</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('materials')}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'materials'
                ? 'bg-white text-purple-900 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            <span>Fitting Materials Usage & Returns</span>
            {materialItems.length > 0 && (
              <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded-full font-mono">
                {materialItems.length}
              </span>
            )}
          </button>

          {finalBomSnapshot && (
            <button
              type="button"
              onClick={() => setActiveTab('final_bom')}
              className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'final_bom'
                  ? 'bg-white text-purple-900 shadow-2xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Calculator className="w-3.5 h-3.5 text-emerald-600" />
              <span>Final BOM & Reconciliation</span>
            </button>
          )}
        </div>

        {/* Informational Guidance */}
        {!readOnly && activeTab === 'devices' && (
          <div className="p-3 bg-purple-50/70 border border-purple-200/80 rounded-xl text-xs text-purple-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              Technician Installation & Reconciliation Rule:
            </p>
            <p className="text-[11px] text-purple-800">
              Record quantity installed from Required allocation and Extra allocation separately. Carried = Installed + Returned + Damaged + Missing. All carried devices must reconcile before submitting.
            </p>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fetchingReport ? (
          <div className="py-10 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
            <span className="text-xs font-medium">Loading report details...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* ============================================================
                TAB 1: CAMERA DEVICES SECTION
                ============================================================ */}
            {activeTab === 'devices' && (
              <div className="space-y-3">
                {items.map((item, idx) => {
                  const carried = parseInt(item.quantity_carried, 10) || 0;
                  const reqInst = parseInt(item.quantity_installed_required, 10) || 0;
                  const extInst = parseInt(item.quantity_installed_extra, 10) || 0;
                  const installed = reqInst + extInst;
                  const toReturn = parseInt(item.quantity_to_return, 10) || 0;
                  const damaged = parseInt(item.quantity_damaged, 10) || 0;
                  const missing = parseInt(item.quantity_missing, 10) || 0;

                  const totalAccounted = installed + toReturn + damaged + missing;
                  const isItemBalanced = carried === totalAccounted;
                  const isExpanded = !!expandedDamagedMissing[idx] || damaged > 0 || missing > 0;

                  return (
                    <div key={idx} className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs space-y-3">
                      {/* Device Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-2.5 gap-2">
                        <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                          <Wrench className="w-4 h-4 text-purple-600 shrink-0" /> {item.device_type}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-gray-700 bg-purple-50 px-2.5 py-0.5 rounded-md border border-purple-200">
                            Carried: <strong className="text-purple-700 font-mono font-bold">{carried} units</strong>
                            <span className="ml-1 text-[10px] text-gray-500 font-normal">
                              ({item.required_quantity || 0} req + {item.extra_quantity || 0} backup)
                            </span>
                          </span>
                          {isItemBalanced ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-300">
                              <CheckCircle2 size={12} /> Balanced
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 flex items-center gap-1 border border-rose-300">
                              <AlertTriangle size={12} /> Unbalanced ({totalAccounted}/{carried})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Installed Required vs Extra Split & Returns */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Installed (From Required Allocation) <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={carried}
                            disabled={readOnly}
                            value={item.quantity_installed_required}
                            onChange={(e) => handleDeviceChange(idx, 'quantity_installed_required', e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg font-bold font-mono text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100 disabled:text-gray-800"
                            required
                          />
                          <span className="text-[10px] text-gray-400 mt-0.5 block">Allocated: {item.required_quantity || 0}</span>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Installed (From Extra Allocation)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={carried}
                            disabled={readOnly}
                            value={item.quantity_installed_extra}
                            onChange={(e) => handleDeviceChange(idx, 'quantity_installed_extra', e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg font-bold font-mono text-amber-700 focus:ring-2 focus:ring-amber-500 outline-none disabled:bg-gray-100 disabled:text-gray-800"
                          />
                          <span className="text-[10px] text-gray-400 mt-0.5 block">Extra carried: {item.extra_quantity || 0}</span>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Unused Devices Returned <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={carried}
                            disabled={readOnly}
                            value={item.quantity_to_return}
                            onChange={(e) => handleDeviceChange(idx, 'quantity_to_return', e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg font-bold font-mono text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-800"
                            required
                          />
                          <span className="text-[10px] text-gray-400 mt-0.5 block">Total Installed: {installed} units</span>
                        </div>
                      </div>

                      {/* Damaged / Missing Section */}
                      <div>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => toggleDamagedMissing(idx)}
                            className="text-[11px] font-semibold text-gray-500 hover:text-purple-600 flex items-center gap-1 focus:outline-none transition-colors cursor-pointer"
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                            <span>Record damaged or missing units</span>
                            {(damaged > 0 || missing > 0) && (
                              <span className="ml-1.5 px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                                {damaged > 0 && `${damaged} damaged`}
                                {damaged > 0 && missing > 0 && ', '}
                                {missing > 0 && `${missing} missing`}
                              </span>
                            )}
                          </button>
                        )}

                        {(isExpanded || damaged > 0 || missing > 0) && (
                          <div className="grid grid-cols-2 gap-3 mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-1">Quantity Damaged</label>
                              <input
                                type="number"
                                min="0"
                                max={carried}
                                disabled={readOnly}
                                value={item.quantity_damaged}
                                onChange={(e) => handleDeviceChange(idx, 'quantity_damaged', e.target.value)}
                                className="w-full px-2.5 py-1 border border-gray-300 rounded text-xs font-bold text-rose-600 focus:ring-2 focus:ring-rose-500 outline-none bg-white disabled:bg-gray-100 disabled:text-gray-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-1">Quantity Missing</label>
                              <input
                                type="number"
                                min="0"
                                max={carried}
                                disabled={readOnly}
                                value={item.quantity_missing}
                                onChange={(e) => handleDeviceChange(idx, 'quantity_missing', e.target.value)}
                                className="w-full px-2.5 py-1 border border-gray-300 rounded text-xs font-bold text-amber-600 focus:ring-2 focus:ring-amber-500 outline-none bg-white disabled:bg-gray-100 disabled:text-gray-800"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Explanation Remark for Damaged / Missing */}
                      {(damaged > 0 || missing > 0) && (
                        <div>
                          <label className="block text-xs font-semibold text-rose-800 mb-1">
                            Discrepancy Explanation <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            disabled={readOnly}
                            value={item.discrepancy_reason || ''}
                            onChange={(e) => handleDeviceChange(idx, 'discrepancy_reason', e.target.value)}
                            placeholder="Explain why devices were damaged or missing..."
                            className="w-full px-3 py-1.5 border border-rose-300 rounded-lg text-xs focus:ring-2 focus:ring-rose-500 outline-none bg-rose-50/50"
                            required
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ============================================================
                TAB 2: FITTING MATERIALS SECTION
                ============================================================ */}
            {activeTab === 'materials' && (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-bold block">Actual Fitting Materials Tracking:</span>
                    <span className="text-[11px] text-blue-800">
                      Record actual quantities used and unused quantities returned. Do not assume all calculated materials were consumed.
                    </span>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleAddMaterialRow}
                      className="px-2.5 py-1 bg-blue-600 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shrink-0 hover:bg-blue-700 cursor-pointer"
                    >
                      <Plus size={12} /> Add Material Line
                    </button>
                  )}
                </div>

                {materialItems.length === 0 ? (
                  <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center text-gray-500 text-xs">
                    No preliminary fitting materials recorded for this job.
                    {!readOnly && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={handleAddMaterialRow}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs"
                        >
                          + Add Material Return
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase">
                          <th className="py-2.5 px-3">Material Name</th>
                          <th className="py-2.5 px-3 text-center">Unit</th>
                          <th className="py-2.5 px-3 text-center">Issued</th>
                          <th className="py-2.5 px-3 text-center">Actual Used</th>
                          <th className="py-2.5 px-3 text-center">Returned Unused</th>
                          <th className="py-2.5 px-3">Remarks</th>
                          {!readOnly && <th className="py-2.5 px-2 text-center w-10"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {materialItems.map((mat, mIdx) => (
                          <tr key={mIdx} className="hover:bg-slate-50">
                            <td className="py-2 px-3">
                              {readOnly ? (
                                <span className="font-semibold text-gray-900">{mat.material_name}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={mat.material_name}
                                  onChange={(e) => handleMaterialChange(mIdx, 'material_name', e.target.value)}
                                  placeholder="Material Name"
                                  className="w-full p-1 border border-gray-200 rounded text-xs font-semibold"
                                  required
                                />
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {readOnly ? (
                                <span className="font-mono text-gray-600">{mat.unit}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={mat.unit}
                                  onChange={(e) => handleMaterialChange(mIdx, 'unit', e.target.value)}
                                  className="w-16 p-1 border border-gray-200 rounded text-xs text-center font-mono"
                                />
                              )}
                            </td>
                            <td className="py-2 px-3 text-center font-mono font-bold text-gray-700">
                              {mat.quantity_issued || 0}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={readOnly}
                                value={mat.quantity_used}
                                onChange={(e) => handleMaterialChange(mIdx, 'quantity_used', e.target.value)}
                                className="w-16 p-1 border border-gray-300 rounded text-xs text-center font-mono font-bold text-emerald-700 disabled:bg-gray-100"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={readOnly}
                                value={mat.quantity_returned}
                                onChange={(e) => handleMaterialChange(mIdx, 'quantity_returned', e.target.value)}
                                className="w-16 p-1 border border-blue-300 rounded text-xs text-center font-mono font-bold text-blue-700 disabled:bg-gray-100"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                disabled={readOnly}
                                value={mat.remarks || ''}
                                onChange={(e) => handleMaterialChange(mIdx, 'remarks', e.target.value)}
                                placeholder="Return notes"
                                className="w-full p-1 border border-gray-200 rounded text-[11px] disabled:bg-gray-100"
                              />
                            </td>
                            {!readOnly && (
                              <td className="py-2 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMaterialRow(mIdx)}
                                  className="text-gray-400 hover:text-rose-600 p-1"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================
                TAB 3: FINAL BOM & RECONCILIATION SUMMARY
                ============================================================ */}
            {activeTab === 'final_bom' && finalBomSnapshot && (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    Final BOM Calculated on All Actually Installed Devices:
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Formula: Sum of (actual installed quantity for each device type × configured BOM quantity per device type). Includes extra devices installed; excludes unused extra devices.
                  </p>
                </div>

                {/* Comparison Table */}
                {Array.isArray(finalBomSnapshot.comparison) && (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase">
                          <th className="py-2.5 px-3">Material Item</th>
                          <th className="py-2.5 px-3 text-center">Preliminary (All Carried)</th>
                          <th className="py-2.5 px-3 text-center">Final (Actually Installed)</th>
                          <th className="py-2.5 px-3 text-center">Difference</th>
                          <th className="py-2.5 px-3 text-center">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {finalBomSnapshot.comparison.map((c, cIdx) => (
                          <tr key={cIdx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-semibold text-gray-900">{c.material_name}</td>
                            <td className="py-2 px-3 text-center font-mono font-bold text-gray-600">{c.preliminary_quantity}</td>
                            <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">{c.final_quantity}</td>
                            <td className="py-2 px-3 text-center font-mono font-bold">
                              <span className={`px-2 py-0.5 rounded text-[11px] ${
                                c.difference < 0 ? 'bg-amber-100 text-amber-800' : c.difference > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {c.difference > 0 ? `+${c.difference}` : c.difference}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center text-gray-500">{c.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Reconciliation Totals Banner */}
            <div className={`p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isOverallBalanced ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950' : 'bg-rose-50 border-rose-200 text-rose-950'
            }`}>
              <div>
                <span className="font-bold block flex items-center gap-1.5">
                  {isOverallBalanced ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
                  {isOverallBalanced ? 'All Device Quantities Reconciled' : 'Device Allocation Discrepancy Detected'}
                </span>
                <span className="text-[11px] opacity-80 block mt-0.5">
                  Carried: {totalCarriedAll} = Installed ({totalInstalledAll}) + Returned ({totalReturnedAll}) + Damaged ({totalDamagedAll}) + Missing ({totalMissingAll})
                </span>
              </div>
              <div className="font-mono text-xs font-bold shrink-0">
                Total Accounted: {totalAccountedAll} / {totalCarriedAll}
              </div>
            </div>

            {/* General Completion Remarks */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Technician General Remarks / Installation Notes
              </label>
              <textarea
                disabled={readOnly}
                rows={2}
                value={generalRemarks}
                onChange={(e) => setGeneralRemarks(e.target.value)}
                placeholder="Optional overall installation notes, client signatures, site condition details..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-purple-500 outline-none disabled:bg-gray-100"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                {readOnly ? 'Close' : 'Cancel'}
              </button>

              {!readOnly && (
                <button
                  type="submit"
                  disabled={loading || !isOverallBalanced}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Submit Completion Report</span>
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
