import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Clock,
  Package,
  SlidersHorizontal,
  Search,
  Eye,
  Check,
  RotateCcw,
  Info,
  ShieldCheck,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  fetchBoms,
  fetchBomUnits,
  updateDeviceBom,
  resetDeviceBom,
  fetchChecklistBomHistory,
  fetchMaterialInventory,
  adjustMaterialStock,
} from '../../lib/api';
import IssueMaterialsModal from './IssueMaterialsModal';

export default function StoreBomManager({ token, onSelectChecklist }) {
  // Sub-tab: 'configure', 'history', 'material_stock'
  const [subTab, setSubTab] = useState('configure');

  // BOM Config State
  const [boms, setBoms] = useState([]);
  const [selectedDeviceType, setSelectedDeviceType] = useState('2 Channel Live');
  const [units, setUnits] = useState(['Nos.', 'Packet', 'No.', 'Metres', 'Roll', 'Box', 'Kg', 'Set']);
  const [standardDeviceTypes, setStandardDeviceTypes] = useState([
    '2 Channel Live',
    '2 Channel Recording',
    '4 Channel Live',
    '4 Channel Recording',
    '6 Channel Live',
    '6 Channel Recording',
    '8 Channel Live',
  ]);

  // Current editing BOM items
  const [items, setItems] = useState([]);
  const [bomVersion, setBomVersion] = useState(1);
  const [isConfigured, setIsConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  // Checklist History Review State
  const [checklistHistory, setChecklistHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDeviceFilter, setHistoryDeviceFilter] = useState('');
  const [selectedSnapshotChecklist, setSelectedSnapshotChecklist] = useState(null);
  const [issueModalChecklist, setIssueModalChecklist] = useState(null);

  // Material Inventory State
  const [materials, setMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [adjustModalMaterial, setAdjustModalMaterial] = useState(null);
  const [adjustAction, setAdjustAction] = useState('ADD');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  // Load all BOMs
  const loadBoms = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [bomsData, unitsData] = await Promise.all([
        fetchBoms(token).catch(() => []),
        fetchBomUnits(token).catch(() => ({ units: [], device_types: [] })),
      ]);

      setBoms(bomsData || []);
      if (unitsData?.units?.length > 0) setUnits(unitsData.units);
      if (unitsData?.device_types?.length > 0) setStandardDeviceTypes(unitsData.device_types);

      // Select active BOM
      const current = (bomsData || []).find((b) => b.device_type === selectedDeviceType);
      if (current) {
        setItems((current.items || []).map((it) => ({ ...it })));
        setBomVersion(current.version || 1);
        setIsConfigured(Boolean(current.is_configured));
      }
    } catch (err) {
      console.error('Error loading BOMs:', err);
      showFeedback('error', err.message || 'Failed to load BOM configurations');
    } finally {
      setLoading(false);
    }
  }, [token, selectedDeviceType]);

  // Load Checklist History
  const loadChecklistHistory = useCallback(async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const data = await fetchChecklistBomHistory(token, {
        deviceType: historyDeviceFilter,
        search: historySearch,
      });
      setChecklistHistory(data?.checklists || []);
    } catch (err) {
      console.error('Error loading checklist history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [token, historyDeviceFilter, historySearch]);

  // Load Material Stock
  const loadMaterialInventory = useCallback(async () => {
    if (!token) return;
    setLoadingMaterials(true);
    try {
      const data = await fetchMaterialInventory(token);
      setMaterials(data || []);
    } catch (err) {
      console.error('Error loading materials:', err);
    } finally {
      setLoadingMaterials(false);
    }
  }, [token]);

  useEffect(() => {
    loadBoms();
  }, [loadBoms]);

  useEffect(() => {
    if (subTab === 'history') {
      loadChecklistHistory();
    } else if (subTab === 'material_stock') {
      loadMaterialInventory();
    }
  }, [subTab, loadChecklistHistory, loadMaterialInventory]);

  // Whenever selectedDeviceType changes, sync items
  useEffect(() => {
    const current = boms.find((b) => b.device_type === selectedDeviceType);
    if (current) {
      setItems((current.items || []).map((it) => ({ ...it })));
      setBomVersion(current.version || 1);
      setIsConfigured(Boolean(current.is_configured));
    } else {
      // Unconfigured or new
      setItems([]);
      setBomVersion(1);
      setIsConfigured(false);
    }
  }, [selectedDeviceType, boms]);

  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback({ type: '', message: '' }), 4000);
  };

  // Add a material row
  const handleAddMaterialRow = () => {
    setItems((prev) => [
      ...prev,
      {
        material_name: '',
        quantity_per_device: 1,
        unit: units[0] || 'Nos.',
        sort_order: prev.length + 1,
      },
    ]);
  };

  // Remove a material row
  const handleRemoveMaterialRow = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Update a row field
  const handleItemChange = (idx, field, value) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  };

  // Save changes
  const handleSaveBom = async () => {
    if (isConfigured && items.length === 0) {
      showFeedback('error', 'A configured BOM must contain at least one material.');
      return;
    }

    // Validation
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.material_name || '').trim();
      const qty = parseFloat(it.quantity_per_device);
      const unit = (it.unit || '').trim();

      if (!name) {
        showFeedback('error', `Material at row #${i + 1} has an empty name.`);
        return;
      }
      if (!unit) {
        showFeedback('error', `Material "${name}" must have a unit of measurement.`);
        return;
      }
      if (isNaN(qty) || qty <= 0) {
        showFeedback('error', `Material "${name}" must have a positive quantity per device (> 0).`);
        return;
      }

      if (seen.has(name.toLowerCase())) {
        showFeedback('error', `Duplicate material "${name}". Each material name must be unique.`);
        return;
      }
      seen.add(name.toLowerCase());
    }

    setSaving(true);
    try {
      const res = await updateDeviceBom(token, selectedDeviceType, {
        items,
        is_configured: isConfigured,
      });

      showFeedback('success', `BOM for "${selectedDeviceType}" saved successfully! Version incremented to v${res.bom?.version || bomVersion + 1}.`);
      await loadBoms();
    } catch (err) {
      console.error('Error saving BOM:', err);
      showFeedback('error', err.message || 'Failed to save BOM changes.');
    } finally {
      setSaving(false);
    }
  };

  // Reset to initial template
  const handleResetToTemplate = async () => {
    if (!window.confirm(`Are you sure you want to reset the BOM for "${selectedDeviceType}" to the standard initial template?`)) {
      return;
    }

    setSaving(true);
    try {
      await resetDeviceBom(token, selectedDeviceType);
      showFeedback('success', `BOM for "${selectedDeviceType}" reset to default template.`);
      await loadBoms();
    } catch (err) {
      console.error('Error resetting BOM:', err);
      showFeedback('error', err.message || 'Failed to reset BOM.');
    } finally {
      setSaving(false);
    }
  };

  // Adjust material stock submission
  const handleAdjustMaterialSubmit = async (e) => {
    e.preventDefault();
    if (!adjustModalMaterial) return;

    const qty = parseFloat(adjustQty);
    if (isNaN(qty) || qty <= 0) {
      alert('Please enter a valid positive quantity.');
      return;
    }
    if (!adjustReason.trim()) {
      alert('A valid reason is required for any stock adjustment.');
      return;
    }

    setAdjusting(true);
    try {
      await adjustMaterialStock(token, {
        material_name: adjustModalMaterial.material_name,
        action: adjustAction,
        quantity: qty,
        reason: adjustReason.trim(),
      });
      showFeedback('success', `Stock adjusted for "${adjustModalMaterial.material_name}".`);
      setAdjustModalMaterial(null);
      setAdjustQty('');
      setAdjustReason('');
      loadMaterialInventory();
    } catch (err) {
      alert(err.message || 'Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedback.message && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-800 text-white'
              : 'bg-rose-800 text-white'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-300" /> : <AlertTriangle className="w-5 h-5 text-rose-300" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Sub Navigation Bar */}
      <div className="bg-white p-2 rounded-2xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSubTab('configure')}
            className={`py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              subTab === 'configure'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Device BOM Configurations</span>
          </button>

          <button
            onClick={() => setSubTab('history')}
            className={`py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              subTab === 'history'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Checklist BOM Version Review</span>
            <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-black/10 rounded-full font-mono">
              {checklistHistory.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab('material_stock')}
            className={`py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              subTab === 'material_stock'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Consumables & Material Stock</span>
            <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-black/10 rounded-full font-mono">
              {materials.length}
            </span>
          </button>
        </div>

        <button
          onClick={() => {
            if (subTab === 'configure') loadBoms();
            else if (subTab === 'history') loadChecklistHistory();
            else loadMaterialInventory();
          }}
          disabled={loading || historyLoading || loadingMaterials}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${(loading || historyLoading || loadingMaterials) ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ============================================================
          TAB 1: DEVICE BOM CONFIGURATIONS
          ============================================================ */}
      {subTab === 'configure' && (
        <div className="space-y-6">
          {/* Device Type Selection Pills */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Select Device Type to Configure
              </label>
              <span className="text-[11px] text-gray-500">
                Configure minimum required materials per 1 device unit
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {standardDeviceTypes.map((type) => {
                const b = boms.find((x) => x.device_type === type);
                const isSelected = selectedDeviceType === type;
                const isConf = b?.is_configured && (b?.items?.length > 0);

                return (
                  <button
                    key={type}
                    onClick={() => setSelectedDeviceType(type)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
                      isSelected
                        ? 'bg-amber-700 text-white border-amber-800 shadow-sm'
                        : isConf
                        ? 'bg-gray-50 hover:bg-gray-100 text-gray-800 border-gray-200'
                        : 'bg-amber-50/60 hover:bg-amber-100/60 text-amber-900 border-amber-200 border-dashed'
                    }`}
                  >
                    <span>{type}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : isConf
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-200 text-amber-900'
                      }`}
                    >
                      {isConf ? `v${b?.version || 1}` : 'Unconfigured'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Device Type Editor Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            {/* Header & Controls */}
            <div className="p-5 border-b border-gray-200 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                    BOM Version: v{bomVersion}
                  </span>
                  {isConfigured ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Active & Configured
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      Unconfigured / Inactive
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mt-1">
                  {selectedDeviceType} — Material Requirements
                </h3>
                <p className="text-xs text-gray-500">
                  Total required quantity on checklist = Configured quantity per device × Number of devices.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleResetToTemplate}
                  disabled={saving}
                  className="px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Reset to 9 standard initial materials"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset to Standard</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddMaterialRow}
                  disabled={saving}
                  className="px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Material</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveBom}
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving v{bomVersion + 1}...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save BOM Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Editable Materials Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4 min-w-[220px]">Material Name</th>
                    <th className="py-3 px-4 min-w-[140px] text-center">Min Qty / Device</th>
                    <th className="py-3 px-4 min-w-[150px]">Unit of Measurement</th>
                    <th className="py-3 px-4 w-16 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-400">
                        No materials configured for {selectedDeviceType}. Click &ldquo;Add Material&rdquo; or &ldquo;Reset to Standard&rdquo; to populate.
                      </td>
                    </tr>
                  ) : (
                    items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-amber-50/20 transition-colors">
                        <td className="py-2.5 px-4 text-center text-gray-400 font-mono text-xs">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="text"
                            value={it.material_name}
                            onChange={(e) => handleItemChange(idx, 'material_name', e.target.value)}
                            placeholder="e.g. Insulation Tape, Screw (Long)"
                            className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-500 font-semibold text-gray-900 bg-white"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <input
                            type="number"
                            min="0.1"
                            step="any"
                            value={it.quantity_per_device}
                            onChange={(e) => handleItemChange(idx, 'quantity_per_device', e.target.value)}
                            className="w-28 mx-auto text-xs p-2 border border-gray-200 rounded-lg text-center font-mono font-bold text-gray-900 focus:outline-none focus:border-amber-500 bg-white"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <select
                              value={units.includes(it.unit) ? it.unit : 'custom'}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val !== 'custom') {
                                  handleItemChange(idx, 'unit', val);
                                }
                              }}
                              className="text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white font-medium text-gray-800"
                            >
                              {units.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                              <option value="custom">Other (Custom)</option>
                            </select>

                            {(!units.includes(it.unit) || it.unit === 'custom') && (
                              <input
                                type="text"
                                value={it.unit === 'custom' ? '' : it.unit}
                                onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                                placeholder="Enter unit"
                                className="w-24 text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white font-medium"
                              />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveMaterialRow(idx)}
                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Remove Material"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom info footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-gray-500 gap-2">
              <span className="flex items-center gap-1.5 font-medium text-gray-700">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                Changes saved here will increment the BOM to version v{bomVersion + 1} and will automatically apply to newly created installation checklists.
              </span>
              <span className="text-gray-400 shrink-0">
                Total Materials Configured: <strong>{items.length}</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 2: CHECKLIST BOM VERSION REVIEW
          ============================================================ */}
      {subTab === 'history' && (
        <div className="space-y-4">
          {/* Filters & Search */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 w-full sm:w-auto flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search by Checklist Number or Client Name..."
                  className="w-full text-xs pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <select
                value={historyDeviceFilter}
                onChange={(e) => setHistoryDeviceFilter(e.target.value)}
                className="text-xs p-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 bg-white"
              >
                <option value="">All Device Types</option>
                {standardDeviceTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-xs text-gray-500 font-medium shrink-0">
              Showing {checklistHistory.length} checklists
            </span>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Checklist No.</th>
                    <th className="py-3 px-4">Client Name</th>
                    <th className="py-3 px-4">Device Configured</th>
                    <th className="py-3 px-4 text-center">BOM Version Used</th>
                    <th className="py-3 px-4 text-center">Materials Count</th>
                    <th className="py-3 px-4 text-center">Material Issuance</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historyLoading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1 text-amber-600" />
                        <span>Loading checklist BOM history...</span>
                      </td>
                    </tr>
                  ) : checklistHistory.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-400">
                        No checklists found matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    checklistHistory.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-gray-900">
                          {c.checklist_number}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-800">
                          {c.client_name}
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {Array.isArray(c.device_configurations) && c.device_configurations.length > 1 ? (
                            <div>
                              <span className="font-bold text-gray-900">{c.number_of_devices} Devices Total</span>
                              <div className="text-[10px] text-gray-500 font-medium leading-tight">
                                {c.device_configurations.map((dc) => `${dc.device_type} (${dc.number_of_devices})`).join(', ')}
                              </div>
                            </div>
                          ) : (
                            <>
                              {c.device_type} <span className="font-mono text-gray-500 font-bold">({c.number_of_devices} units)</span>
                            </>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {c.bom_version_used !== 'N/A' ? (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-bold font-mono text-[11px] border border-indigo-200">
                              v{c.bom_version_used}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium text-[10px]">
                              None
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-gray-700">
                          {c.bom_items_count} items
                        </td>
                        <td className="py-3 px-4 text-center">
                          {c.material_issuance_status === 'ISSUED' ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-200 flex items-center justify-center gap-1 w-max mx-auto">
                              <CheckCircle2 className="w-3 h-3" /> Issued
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px] border border-amber-200 flex items-center justify-center gap-1 w-max mx-auto">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedSnapshotChecklist(c)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                              title="Inspect exact saved BOM snapshot"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View Snapshot</span>
                            </button>

                            {c.material_issuance_status !== 'ISSUED' && c.bom_items_count > 0 && (
                              <button
                                type="button"
                                onClick={() => setIssueModalChecklist(c)}
                                className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                              >
                                <Package className="w-3.5 h-3.5" />
                                <span>Issue</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 3: CONSUMABLES & MATERIAL STOCK
          ============================================================ */}
      {subTab === 'material_stock' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Installation Consumables & Material Stock Levels</h3>
              <p className="text-xs text-gray-500">Live store stock balances for tapes, ties, wires, cables, and screws.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {materials.map((m) => {
              const current = Number(m.current_stock) || 0;
              const minLevel = Number(m.min_stock_level) || 20;
              const isLow = current <= minLevel;

              return (
                <div key={m.id} className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900">{m.material_name}</h4>
                      <p className="text-[11px] text-gray-400">Unit: {m.unit}</p>
                    </div>
                    {isLow ? (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                        Low Stock
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                        Adequate
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <div>
                      <span className="text-2xl font-bold font-mono text-gray-900">{current}</span>
                      <span className="text-xs text-gray-500 ml-1">{m.unit}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 font-mono">
                      Min: {minLevel}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAdjustModalMaterial(m);
                      setAdjustAction('ADD');
                      setAdjustQty('');
                      setAdjustReason('');
                    }}
                    className="w-full py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Adjust / Add Stock</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Snapshot Preview Modal */}
      {selectedSnapshotChecklist && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-gray-100">
              <div>
                <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  Historical BOM Snapshot (Version v{selectedSnapshotChecklist.bom_snapshot?.bom_version || 'N/A'})
                </h4>
                <p className="text-xs text-gray-500">
                  Checklist: <strong className="font-mono text-gray-800">{selectedSnapshotChecklist.checklist_number}</strong> — {selectedSnapshotChecklist.device_type} ({selectedSnapshotChecklist.number_of_devices} total devices)
                </p>
              </div>
              <button
                onClick={() => setSelectedSnapshotChecklist(null)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600">
                  <tr>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3 text-center">Qty/Device</th>
                    <th className="py-2.5 px-3 text-center">Total Devices</th>
                    <th className="py-2.5 px-3 text-center">Total Required</th>
                    <th className="py-2.5 px-3 text-center">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedSnapshotChecklist.bom_snapshot?.items?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-3 font-semibold text-gray-900">
                        <div>{item.material_name}</div>
                        {Array.isArray(item.breakdown) && item.breakdown.length > 1 && (
                          <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                            {item.breakdown.map((b) => `${b.device_type}: ${b.subtotal} ${item.unit}`).join(' • ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-gray-600">
                        {item.quantity_per_device !== undefined ? item.quantity_per_device : 'Combined'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-gray-600">{selectedSnapshotChecklist.number_of_devices}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-indigo-900">{item.total_quantity}</td>
                      <td className="py-2.5 px-3 text-center text-gray-600">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedSnapshotChecklist(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Material Stock Adjustment Modal */}
      {adjustModalMaterial && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-amber-600" />
              Adjust Stock: {adjustModalMaterial.material_name}
            </h4>
            <p className="text-xs text-gray-500">
              Current Balance: <strong className="font-mono text-gray-800">{adjustModalMaterial.current_stock} {adjustModalMaterial.unit}</strong>
            </p>

            <form onSubmit={handleAdjustMaterialSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Action</label>
                <div className="grid grid-cols-3 gap-2">
                  {['ADD', 'REMOVE', 'SET'].map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setAdjustAction(act)}
                      className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                        adjustAction === act
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Quantity ({adjustModalMaterial.unit})</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 font-mono font-bold"
                  placeholder="e.g. 100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Reason for Adjustment</label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. New supplier shipment received, physical count audit"
                  className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setAdjustModalMaterial(null)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjusting}
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {adjusting ? 'Saving...' : 'Apply Stock Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Modal Triggered from History */}
      {issueModalChecklist && (
        <IssueMaterialsModal
          checklist={issueModalChecklist}
          token={token}
          onClose={() => setIssueModalChecklist(null)}
          onSuccess={() => {
            setIssueModalChecklist(null);
            showFeedback('success', 'Materials issued successfully!');
            loadChecklistHistory();
          }}
        />
      )}
    </div>
  );
}
