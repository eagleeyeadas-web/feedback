import { useState, useEffect } from 'react';
import { Package, X, AlertTriangle, CheckCircle2, Loader2, HardDrive, Layers, ArrowRight } from 'lucide-react';
import {
  fetchMaterialInventory,
  fetchInventoryProducts,
  issueFullJobStockApi,
  fetchBackupDeclaration,
} from '../../lib/api';

export default function IssueMaterialsModal({ checklist, token, onClose, onSuccess }) {
  const [deviceInventory, setDeviceInventory] = useState([]);
  const [materialInventory, setMaterialInventory] = useState([]);
  const [backupDeclaration, setBackupDeclaration] = useState(null);
  const [loadingInv, setLoadingInv] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const [issueDevices, setIssueDevices] = useState(true);
  const [issueMaterials, setIssueMaterials] = useState(true);
  const [issueBackupItems, setIssueBackupItems] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoadingInv(true);
    const chkId = checklist.id || checklist.checklist_id;
    Promise.all([
      fetchInventoryProducts(token).catch(() => []),
      fetchMaterialInventory(token).catch(() => []),
      chkId ? fetchBackupDeclaration(token, chkId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([devs, mats, bDecl]) => {
        setDeviceInventory(devs || []);
        setMaterialInventory(mats || []);
        setBackupDeclaration(bDecl);
      })
      .catch((err) => console.error('Failed to load live inventory or backup items:', err))
      .finally(() => setLoadingInv(false));
  }, [token, checklist]);

  // Maps for live availability
  const devMap = new Map(deviceInventory.map((d) => [d.device_type, d]));
  const matMap = new Map(materialInventory.map((m) => [m.material_name.toLowerCase(), m]));

  // 1. Camera Devices to Issue
  const rawConfigs = Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0
    ? checklist.device_configurations
    : (checklist.device_items && checklist.device_items.length > 0
      ? checklist.device_items
      : [{ device_type: checklist.device_type || '2 Channel Live', number_of_devices: checklist.number_of_devices || 1 }]);

  const deviceList = rawConfigs.map((c) => {
    const dType = c.device_type || '';
    const req = Number(c.number_of_devices !== undefined ? c.number_of_devices : c.required_quantity) || 1;
    const prod = devMap.get(dType);
    const available = prod ? Number(prod.usable_stock) || 0 : 0;
    const shortage = Math.max(0, req - available);
    return {
      device_type: dType,
      sku: prod?.sku || 'N/A',
      required: req,
      available,
      shortage,
      unit: 'Nos.',
    };
  });

  // 2. Installation Materials to Issue
  const bomItems = Array.isArray(checklist.bom_snapshot?.items)
    ? checklist.bom_snapshot.items
    : (Array.isArray(checklist.material_items) ? checklist.material_items : []);

  const materialList = bomItems.map((it) => {
    const mName = it.material_name || '';
    const req = Number(it.total_quantity !== undefined ? it.total_quantity : it.total_required_quantity) || 0;
    const inv = matMap.get(mName.toLowerCase());
    const available = inv ? Number(inv.current_stock) || 0 : 0;
    const shortage = Math.max(0, req - available);
    return {
      material_id: it.material_id || inv?.id,
      material_name: mName,
      sku: inv?.sku || it.material_sku || 'N/A',
      required: req,
      available,
      shortage,
      unit: it.unit || inv?.unit || 'Nos.',
    };
  });

  // 3. Extra Loose Backup Items to Issue (if declared by technician)
  const declaredBackupItems = backupDeclaration?.has_backup_items && Array.isArray(backupDeclaration.items)
    ? backupDeclaration.items
    : [];

  const backupList = declaredBackupItems.map((b) => {
    const bName = b.item_name || '';
    const req = Number(b.quantity) || 0;
    const inv = matMap.get(bName.toLowerCase());
    const dev = devMap.get(bName);
    const available = inv ? Number(inv.current_stock) || 0 : (dev ? Number(dev.usable_stock) || 0 : 0);
    const shortage = Math.max(0, req - available);
    return {
      item_name: bName,
      sku: inv?.sku || dev?.sku || b.item_sku || 'N/A',
      required: req,
      available,
      shortage,
      unit: b.unit || inv?.unit || dev?.unit || 'Nos.',
    };
  });

  // Shortage calculations
  const devDeficits = deviceList.filter((d) => d.shortage > 0);
  const matDeficits = materialList.filter((m) => m.shortage > 0);
  const backupDeficits = backupList.filter((b) => b.shortage > 0);

  const hasDeviceDeficit = issueDevices && devDeficits.length > 0;
  const hasMaterialDeficit = issueMaterials && matDeficits.length > 0;
  const hasBackupDeficit = issueBackupItems && backupDeficits.length > 0;
  const hasDeficit = hasDeviceDeficit || hasMaterialDeficit || hasBackupDeficit;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!issueDevices && !issueMaterials && (!declaredBackupItems.length || !issueBackupItems)) {
      setError('Please select at least one component (Devices, Materials, or Backup Items) to issue.');
      return;
    }

    if (hasDeficit) {
      setError('Cannot issue stock due to insufficient inventory. Negative stock is strictly prevented. Please replenish shortage before issuing.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await issueFullJobStockApi(token, {
        checklist_id: checklist.id || checklist.checklist_id,
        issue_devices: issueDevices,
        issue_materials: issueMaterials,
        issue_backup_items: issueBackupItems,
        remarks: remarks.trim() || `Authorized stock issuance for job ${checklist.checklist_number}`,
      });
      onSuccess();
    } catch (err) {
      console.error('Error issuing job stock:', err);
      setError(err.message || 'Failed to issue job stock');
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
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-xs">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                Store Manager: Authorize & Issue Stock
              </h3>
              <p className="text-xs text-gray-500">
                Job: <strong className="font-mono text-gray-800">{checklist.checklist_number}</strong> ({checklist.client_name})
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

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Issuance Checkbox Toggles */}
        <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/60 flex flex-wrap items-center gap-6 text-xs font-semibold text-gray-800">
          <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Components to Issue:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={issueDevices}
              onChange={(e) => setIssueDevices(e.target.checked)}
              className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
            />
            <span>Camera Devices ({deviceList.length})</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={issueMaterials}
              onChange={(e) => setIssueMaterials(e.target.checked)}
              className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
            />
            <span>Installation Materials ({materialList.length})</span>
          </label>
          {declaredBackupItems.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer bg-purple-100/70 text-purple-900 px-2 py-0.5 rounded-lg border border-purple-200">
              <input
                type="checkbox"
                checked={issueBackupItems}
                onChange={(e) => setIssueBackupItems(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500"
              />
              <span className="font-bold">Extra Loose Backup Items ({declaredBackupItems.length})</span>
            </label>
          )}
        </div>

        {loadingInv ? (
          <div className="py-8 text-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600 mx-auto" />
            <p className="text-xs text-gray-500">Verifying authoritative stock balances...</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {/* 1. Camera Devices Stock Review */}
            {issueDevices && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                  <span className="flex items-center gap-1.5 text-blue-800">
                    <HardDrive className="w-4 h-4" /> Camera Devices to Issue
                  </span>
                  {hasDeviceDeficit && (
                    <span className="text-rose-600 text-[11px] font-bold">
                      ⚠ {devDeficits.length} Device Model Shortage
                    </span>
                  )}
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-[10px] font-bold text-gray-600 uppercase border-b border-gray-200">
                      <tr>
                        <th className="py-2 px-3">Device Model</th>
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3 text-center">Req Qty</th>
                        <th className="py-2 px-3 text-center">In Store</th>
                        <th className="py-2 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deviceList.map((d, i) => (
                        <tr key={i} className={d.shortage > 0 ? 'bg-rose-50/50' : 'hover:bg-gray-50/50'}>
                          <td className="py-2 px-3 font-semibold text-gray-900">{d.device_type}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-gray-500">{d.sku}</td>
                          <td className="py-2 px-3 text-center font-bold text-gray-900">{d.required} Nos.</td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-gray-800">{d.available} Nos.</td>
                          <td className="py-2 px-3 text-center">
                            {d.shortage > 0 ? (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                Short by {d.shortage}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                Available
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. Installation Materials Stock Review */}
            {issueMaterials && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                  <span className="flex items-center gap-1.5 text-amber-800">
                    <Layers className="w-4 h-4" /> Installation Materials to Issue
                  </span>
                  {hasMaterialDeficit && (
                    <span className="text-rose-600 text-[11px] font-bold">
                      ⚠ {matDeficits.length} Material Shortage
                    </span>
                  )}
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-[10px] font-bold text-gray-600 uppercase border-b border-gray-200">
                      <tr>
                        <th className="py-2 px-3">Material</th>
                        <th className="py-2 px-3 text-center">Req Qty</th>
                        <th className="py-2 px-3 text-center">Unit</th>
                        <th className="py-2 px-3 text-center">In Store</th>
                        <th className="py-2 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {materialList.map((m, i) => (
                        <tr key={i} className={m.shortage > 0 ? 'bg-rose-50/50' : 'hover:bg-gray-50/50'}>
                          <td className="py-2 px-3 font-semibold text-gray-900">{m.material_name}</td>
                          <td className="py-2 px-3 text-center font-bold text-gray-900">{m.required}</td>
                          <td className="py-2 px-3 text-center text-gray-500 font-medium">{m.unit}</td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-gray-800">{m.available}</td>
                          <td className="py-2 px-3 text-center">
                            {m.shortage > 0 ? (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                Short by {m.shortage}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                Available
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. Extra Loose Backup Items Stock Review */}
            {issueBackupItems && backupList.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                  <span className="flex items-center gap-1.5 text-purple-900">
                    <Package className="w-4 h-4 text-purple-600" /> Declared Loose Backup Items to Issue
                  </span>
                  {hasBackupDeficit && (
                    <span className="text-rose-600 text-[11px] font-bold">
                      ⚠ {backupDeficits.length} Backup Item Shortage
                    </span>
                  )}
                </div>

                <div className="border border-purple-200 rounded-xl overflow-hidden text-xs bg-purple-50/20">
                  <table className="w-full text-left">
                    <thead className="bg-purple-50 text-[10px] font-bold text-purple-900 uppercase border-b border-purple-200">
                      <tr>
                        <th className="py-2 px-3">Loose Product</th>
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3 text-center">Declared Qty</th>
                        <th className="py-2 px-3 text-center">Unit</th>
                        <th className="py-2 px-3 text-center">In Store</th>
                        <th className="py-2 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-purple-100">
                      {backupList.map((b, i) => (
                        <tr key={i} className={b.shortage > 0 ? 'bg-rose-50/60' : 'hover:bg-purple-50/40'}>
                          <td className="py-2 px-3 font-semibold text-gray-900">{b.item_name}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-gray-500">{b.sku}</td>
                          <td className="py-2 px-3 text-center font-bold text-gray-900">{b.required}</td>
                          <td className="py-2 px-3 text-center text-gray-600 font-medium">{b.unit}</td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-gray-800">{b.available}</td>
                          <td className="py-2 px-3 text-center">
                            {b.shortage > 0 ? (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                Short by {b.shortage}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                Available
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Remarks Form & Submission */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-gray-100">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">
              Store Manager Remarks / Dispatch Notes
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Dispatched complete kit with technician; batch verified"
              className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || hasDeficit || (!issueDevices && !issueMaterials && (!declaredBackupItems.length || !issueBackupItems))}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Deducting Stock...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Authorize & Issue Stock</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
