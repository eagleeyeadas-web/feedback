import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  Package,
  HardDrive,
  Check,
  Info,
} from 'lucide-react';
import {
  fetchBoms,
  fetchBomUnits,
  updateDeviceBom,
  resetDeviceBom,
  fetchMaterialInventory,
} from '../../lib/api';

export default function StoreBomManager({ token, onSelectChecklist }) {
  // BOM Config State
  const [boms, setBoms] = useState([]);
  const [selectedDeviceType, setSelectedDeviceType] = useState('2 Channel Live');
  const [units, setUnits] = useState(['Nos.', 'Packet', 'Packets', 'No.', 'Metres', 'Roll', 'Box', 'Kg', 'Set', 'Piece']);
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

  // Material Inventory for linking Product IDs and locking units
  const [materials, setMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  // Load all BOMs and Materials
  const loadBomsAndMaterials = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [bomsData, unitsData, matsData] = await Promise.all([
        fetchBoms(token).catch(() => []),
        fetchBomUnits(token).catch(() => ({ units: [], device_types: [] })),
        fetchMaterialInventory(token).catch(() => []),
      ]);

      setBoms(bomsData || []);
      setMaterials(matsData || []);
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

  useEffect(() => {
    loadBomsAndMaterials();
  }, [loadBomsAndMaterials]);

  // Whenever selectedDeviceType changes, sync items
  useEffect(() => {
    const current = boms.find((b) => b.device_type === selectedDeviceType);
    if (current) {
      setItems((current.items || []).map((it) => ({ ...it })));
      setBomVersion(current.version || 1);
      setIsConfigured(Boolean(current.is_configured));
    } else {
      setItems([]);
      setBomVersion(1);
      setIsConfigured(false);
    }
  }, [selectedDeviceType, boms]);

  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback({ type: '', message: '' }), 4500);
  };

  // Add a material row
  const handleAddMaterialRow = () => {
    // Default to first material in inventory
    const firstMat = materials[0];
    setItems((prev) => [
      ...prev,
      {
        material_id: firstMat?.id || null,
        material_name: firstMat?.material_name || '',
        quantity_per_device: 1,
        unit: firstMat?.unit || 'Nos.',
        sort_order: prev.length + 1,
      },
    ]);
  };

  // Remove a material row
  const handleRemoveMaterialRow = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Handle changing selected inventory material
  const handleSelectMaterial = (idx, selectedIdOrName) => {
    const matched = materials.find((m) => m.id === selectedIdOrName || m.material_name === selectedIdOrName);
    setItems((prev) => {
      const copy = [...prev];
      if (matched) {
        copy[idx] = {
          ...copy[idx],
          material_id: matched.id,
          material_name: matched.material_name,
          unit: matched.unit, // Enforces BOM unit matches inventory unit!
        };
      } else {
        copy[idx] = {
          ...copy[idx],
          material_name: selectedIdOrName,
        };
      }
      return copy;
    });
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

      // Check unit matching against inventory
      const invMatch = materials.find((m) => m.id === it.material_id || m.material_name.toLowerCase() === name.toLowerCase());
      if (invMatch && invMatch.unit && unit) {
        const u1 = unit.trim().toLowerCase();
        const u2 = invMatch.unit.trim().toLowerCase();
        const compatible = u1 === u2 ||
          ((u1.includes('packet') && u2.includes('packet')) ||
           (u1.includes('no') && u2.includes('no')));
        if (!compatible) {
          showFeedback('error', `Unit mismatch for "${name}": Warehouse unit is "${invMatch.unit}", but BOM has "${unit}". Units must match without conversion.`);
          return;
        }
      }

      if (seen.has(name.toLowerCase())) {
        showFeedback('error', `Duplicate material "${name}". Each material name in BOM must be unique.`);
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
      await loadBomsAndMaterials();
    } catch (err) {
      console.error('Error saving BOM:', err);
      showFeedback('error', err.message || 'Failed to save BOM changes.');
    } finally {
      setSaving(false);
    }
  };

  // Reset to initial template
  const handleResetToTemplate = async () => {
    if (!window.confirm(`Reset the BOM for "${selectedDeviceType}" to the initial standard template?`)) {
      return;
    }

    setSaving(true);
    try {
      await resetDeviceBom(token, selectedDeviceType);
      showFeedback('success', `BOM for "${selectedDeviceType}" reset to initial template.`);
      await loadBomsAndMaterials();
    } catch (err) {
      console.error('Error resetting BOM:', err);
      showFeedback('error', err.message || 'Failed to reset BOM.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback Alert */}
      {feedback.message && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between border shadow-xs animate-in fade-in duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback({ type: '', message: '' })}
            className="text-gray-400 hover:text-gray-600 font-bold ml-4 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Device Type Selection Pills */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-amber-600" />
            <span>Select Camera Device Model to Configure</span>
          </label>
          <span className="text-[11px] text-gray-500">
            Configure minimum installation materials required per 1 device unit
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
        {/* Editor Header */}
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/60 to-transparent">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono">
                v{bomVersion}
              </span>
              <h3 className="text-base font-black text-gray-900">
                {selectedDeviceType} — Bill of Materials (BOM)
              </h3>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Required materials link to warehouse product IDs. Total required = BOM qty per device × quantity of devices.
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
                  <span>Save BOM Configuration</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 8 Channel Live Notice */}
        {selectedDeviceType === '8 Channel Live' && (
          <div className="mx-5 mt-4 p-3 bg-blue-50/80 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>BOM Rule:</strong> 8 Channel Live does not require a Memory Card for installation. Memory Card is excluded from its BOM configuration.
            </span>
          </div>
        )}

        {/* Materials Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4 min-w-[260px]">Inventory Material (Linked to Product ID)</th>
                <th className="py-3 px-4 min-w-[140px] text-center">Required Per Device</th>
                <th className="py-3 px-4 min-w-[130px] text-center">Unit</th>
                <th className="py-3 px-4 min-w-[130px] text-center">Warehouse Stock</th>
                <th className="py-3 px-4 w-16 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No materials configured for {selectedDeviceType}. Click &ldquo;Add Material&rdquo; or &ldquo;Reset to Standard&rdquo; to populate.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => {
                  const invMat = materials.find(
                    (m) => (it.material_id && m.id === it.material_id) || m.material_name.toLowerCase() === (it.material_name || '').toLowerCase()
                  );

                  return (
                    <tr key={idx} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-2.5 px-4 text-center text-gray-400 font-mono text-xs">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="space-y-1">
                          <select
                            value={invMat?.id || it.material_name}
                            onChange={(e) => handleSelectMaterial(idx, e.target.value)}
                            className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-500 font-semibold text-gray-900 bg-white"
                          >
                            <option value="">-- Select Inventory Product --</option>
                            {materials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.material_name} ({m.unit}) — SKU: {m.sku || 'N/A'}
                              </option>
                            ))}
                          </select>
                          {invMat && (
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                              <span>Product ID: {invMat.id.slice(0, 8)}...</span>
                              <span>•</span>
                              <span>SKU: {invMat.sku || 'N/A'}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <input
                          type="number"
                          min="0.1"
                          step="any"
                          value={it.quantity_per_device}
                          onChange={(e) => handleItemChange(idx, 'quantity_per_device', e.target.value)}
                          className="w-24 mx-auto text-xs p-2 border border-gray-200 rounded-lg text-center font-mono font-bold text-gray-900 focus:outline-none focus:border-amber-500 bg-white"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="font-semibold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-md text-[11px]">
                          {invMat?.unit || it.unit}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="font-mono text-xs font-bold text-gray-700">
                          {invMat ? `${invMat.current_stock} ${invMat.unit}` : 'N/A'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveMaterialRow(idx)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Remove material from BOM"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
