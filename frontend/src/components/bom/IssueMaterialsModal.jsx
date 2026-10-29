import { useState, useEffect } from 'react';
import { Package, X, AlertTriangle, CheckCircle2, Loader2, HardDrive, Layers, ArrowRight, Wrench } from 'lucide-react';
import {
  fetchMaterialInventory,
  fetchInventoryProducts,
  issueFullJobStockApi,
  issueServiceJobStockApi,
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
  const [courierIssuedSuccess, setCourierIssuedSuccess] = useState(false);

  const isCourierJob = (checklist.delivery_method === 'Product Couriered' || checklist.isCourier || checklist.job_type === 'Courier');
  const isServiceJob = !isCourierJob && (checklist.job_type === 'Service' || checklist.installation_or_service === 'Service');

  // Service items issuance state: map of item.id -> qty to issue
  const [serviceIssueQtys, setServiceIssueQtys] = useState({});

  const isCourierStockIssued = isCourierJob && (
    courierIssuedSuccess ||
    checklist.stock_issuance_status === 'Completed' ||
    checklist.is_issued === true ||
    checklist.devices_issuance_status === 'ISSUED' ||
    checklist.material_issuance_status === 'ISSUED' ||
    checklist.status === 'ISSUED' ||
    checklist.courier_dispatch_status === 'ISSUED' ||
    Boolean(checklist.is_courier_dispatched)
  );

  const devicesAlreadyIssued = isCourierStockIssued || checklist.devices_issuance_status === 'ISSUED';
  const materialsAlreadyIssued = isCourierStockIssued || checklist.material_issuance_status === 'ISSUED';

  const [issueDevices, setIssueDevices] = useState(!devicesAlreadyIssued);
  const [issueMaterials, setIssueMaterials] = useState(!isCourierJob && !materialsAlreadyIssued);

  useEffect(() => {
    if (!token) return;
    setLoadingInv(true);
    const chkId = checklist.checklist_id || checklist.id;
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
  const devById = new Map(deviceInventory.map((d) => [d.id, d]));
  const matMap = new Map(materialInventory.map((m) => [m.material_name.toLowerCase(), m]));
  const matById = new Map(materialInventory.map((m) => [m.id, m]));

  // ==========================================
  // SERVICE JOB ITEMS CALCULATIONS
  // ==========================================
  const rawServiceItems = Array.isArray(checklist.service_items) ? checklist.service_items : [];
  const serviceList = rawServiceItems.map((it) => {
    const isDev = it.item_type === 'DEVICE';
    let available = 0;
    let sku = it.sku || 'N/A';

    if (isDev) {
      const prod = (it.item_id && devById.get(it.item_id)) || devMap.get(it.item_name);
      available = prod ? Number(prod.usable_stock) || 0 : 0;
      sku = prod?.sku || sku;
    } else {
      const mat = (it.item_id && matById.get(it.item_id)) || matMap.get((it.item_name || '').toLowerCase());
      available = mat ? Number(mat.current_stock) || 0 : 0;
      sku = mat?.sku || sku;
    }

    const req = Number(it.quantity_required) || 0;
    const issued = Number(it.quantity_issued) || 0;
    const remaining = it.quantity_remaining !== undefined ? Number(it.quantity_remaining) : Math.max(0, req - issued);
    const shortage = Math.max(0, remaining - available);

    return {
      ...it,
      sku,
      quantity_required: req,
      quantity_issued: issued,
      quantity_remaining: remaining,
      available_stock: available,
      shortage,
    };
  });

  // Initialize service issue quantities once loaded
  useEffect(() => {
    if (isServiceJob && serviceList.length > 0) {
      setServiceIssueQtys((prev) => {
        const next = { ...prev };
        serviceList.forEach((it) => {
          if (next[it.id] === undefined) {
            next[it.id] = Math.min(it.quantity_remaining, it.available_stock);
          }
        });
        return next;
      });
    }
  }, [isServiceJob, deviceInventory, materialInventory, checklist]);

  const serviceDeficits = serviceList.filter((s) => s.shortage > 0);
  const allServiceAlreadyIssued = serviceList.length > 0 && serviceList.every((s) => s.quantity_remaining === 0);

  // ==========================================
  // INSTALLATION JOB ITEMS CALCULATIONS
  // ==========================================
  // 1. Camera Devices to Issue
  const rawConfigs = Array.isArray(checklist.device_items) && checklist.device_items.length > 0
    ? checklist.device_items
    : (Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0
      ? checklist.device_configurations
      : [{ device_type: checklist.device_type || '2 Channel Live', number_of_devices: checklist.number_of_devices || 1 }]);

  const deviceList = rawConfigs.map((c) => {
    const dType = c.device_type || '';
    const req = Number(c.required_quantity !== undefined ? c.required_quantity : (c.quantity_carried !== undefined ? c.quantity_carried : c.number_of_devices)) || 1;
    const prod = devMap.get(dType);
    const available = prod ? Number(prod.usable_stock) || 0 : 0;
    const shortage = Math.max(0, req - available);
    return {
      device_type: dType,
      sku: prod?.sku || 'N/A',
      required: req,
      required_for_installation: c.required_for_installation,
      extra_quantity: c.extra_quantity,
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

  // Shortage calculations for Installation
  const devDeficits = deviceList.filter((d) => d.shortage > 0);
  const matDeficits = materialList.filter((m) => m.shortage > 0);
  const backupDeficits = backupList.filter((b) => b.shortage > 0);

  const willIssueDevices = isCourierJob ? !devicesAlreadyIssued : (!devicesAlreadyIssued && issueDevices);
  const willIssueMaterials = isCourierJob ? false : (!materialsAlreadyIssued && issueMaterials);

  const hasDeviceDeficit = willIssueDevices && devDeficits.length > 0;
  const hasMaterialDeficit = willIssueMaterials && matDeficits.length > 0;
  const hasDeficit = hasDeviceDeficit || hasMaterialDeficit;

  // Total quantity selected to issue for Service job
  const totalServiceSelectedQty = serviceList.reduce((acc, it) => acc + (Number(serviceIssueQtys[it.id]) || 0), 0);
  const hasServiceSelectedDeficit = serviceList.some((it) => {
    const selected = Number(serviceIssueQtys[it.id]) || 0;
    return selected > it.available_stock || selected > it.quantity_remaining;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    if (isServiceJob) {
      if (allServiceAlreadyIssued) {
        setError('All requested service items have already been issued for this job.');
        return;
      }

      if (serviceList.length > 0 && totalServiceSelectedQty <= 0) {
        setError('Please enter a quantity greater than 0 to issue for at least one item.');
        return;
      }

      for (const it of serviceList) {
        const selected = Number(serviceIssueQtys[it.id]) || 0;
        if (selected > it.available_stock) {
          setError(`Cannot issue ${selected} for "${it.item_name}". Only ${it.available_stock} available in store.`);
          return;
        }
        if (selected > it.quantity_remaining) {
          setError(`Cannot issue ${selected} for "${it.item_name}". Only ${it.quantity_remaining} remaining to issue.`);
          return;
        }
      }

      setSubmitting(true);
      setError('');

      try {
        const payloadItems = serviceList
          .filter((it) => (Number(serviceIssueQtys[it.id]) || 0) > 0)
          .map((it) => ({
            id: it.id,
            item_id: it.item_id,
            item_type: it.item_type,
            item_name: it.item_name,
            quantity_to_issue: Number(serviceIssueQtys[it.id]),
          }));

        await issueServiceJobStockApi(token, {
          checklist_id: checklist.checklist_id || checklist.id,
          items: payloadItems,
          remarks: remarks.trim() || `Authorized service items issuance for job ${checklist.checklist_number}`,
        });
        onSuccess();
      } catch (err) {
        console.error('Error issuing service job stock:', err);
        setError(err.message || 'Failed to issue service items');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Courier Job Submission Flow
    if (isCourierJob) {
      if (isCourierStockIssued) {
        setError(`Checklist ${checklist.checklist_number} courier stock has already been issued. Duplicate issuance is prevented.`);
        setCourierIssuedSuccess(true);
        return;
      }
      if (hasDeviceDeficit) {
        setError('Cannot issue courier stock due to insufficient inventory. Negative stock is strictly prevented. Please replenish shortage before issuing.');
        return;
      }

      setSubmitting(true);
      setError('');

      try {
        await issueFullJobStockApi(token, {
          checklist_id: checklist.checklist_id || checklist.id,
          issue_devices: true,
          issue_materials: false,
          remarks: remarks.trim() || `Authorized courier stock issuance for job ${checklist.checklist_number} to recipient ${checklist.client_name || checklist.customer_name || 'Customer'}`,
        });
        setCourierIssuedSuccess(true);
        if (onSuccess) onSuccess();
      } catch (err) {
        if (err.already_issued || err.status === 409 || err.message?.includes('already been issued')) {
          setCourierIssuedSuccess(true);
          setError(`Checklist ${checklist.checklist_number} courier stock has already been issued. Duplicate issuance is prevented.`);
          if (onSuccess) onSuccess();
        } else {
          console.error('Error issuing courier job stock:', err);
          setError(err.message || 'Failed to issue courier job stock');
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Installation Submission Flow
    if (!willIssueDevices && !willIssueMaterials) {
      if (devicesAlreadyIssued && materialsAlreadyIssued) {
        setError('All stock components have already been issued for this job.');
      } else {
        setError('Please select at least one pending component (Devices or Materials) to issue.');
      }
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
        checklist_id: checklist.checklist_id || checklist.id,
        issue_devices: willIssueDevices,
        issue_materials: willIssueMaterials,
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
            <div className={`w-10 h-10 rounded-xl ${isCourierJob ? 'bg-indigo-600' : isServiceJob ? 'bg-purple-600' : 'bg-amber-600'} text-white flex items-center justify-center shadow-xs`}>
              {isCourierJob ? <Package className="w-5 h-5" /> : isServiceJob ? <Wrench className="w-5 h-5" /> : <Package className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-gray-900">
                  {isCourierJob
                    ? (isCourierStockIssued ? 'Product Courier Stock Issuance Details' : 'Store Manager: Authorize & Issue Courier Stock')
                    : isServiceJob
                    ? 'Store Manager: Authorize & Issue Service Items'
                    : 'Store Manager: Authorize & Issue Stock'}
                </h3>
                {isCourierJob && isCourierStockIssued && (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Stock Issued — Completed
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Job: <strong className="font-mono text-gray-800">{checklist.checklist_number}</strong> ({checklist.client_name || checklist.customer_name || 'Valued Customer'}) • <span className={`font-semibold ${isCourierJob ? 'text-indigo-700' : isServiceJob ? 'text-purple-700' : 'text-blue-700'}`}>
                  {isCourierJob ? 'Product Couriered' : (checklist.job_type || checklist.installation_or_service || 'Installation')}
                </span>
                {isCourierJob ? (
                  <span> • Destination: <strong>{checklist.destination || checklist.client_location || 'Customer Address'}</strong></span>
                ) : checklist.service_engineer ? (
                  <span> • Eng: {checklist.service_engineer}</span>
                ) : null}
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

        {/* ========================================================
            COURIER JOB SECTION
            ======================================================== */}
        {isCourierJob ? (
          isCourierStockIssued ? (
            /* ========================================================
               COURIER JOB SECTION: COMPLETED READ-ONLY STATE
               ======================================================== */
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-2xl text-xs space-y-2 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Product Courier Stock Successfully Issued</span>
                </div>
                <p className="text-emerald-700 leading-relaxed">
                  Authoritative stock issuance for checklist <strong className="font-mono">{checklist.checklist_number}</strong> was successfully committed and recorded in the stock ledger. No further deductions can be made.
                </p>
              </div>

              {/* Read-only Issuance Summary Details */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-xs space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Customer Details</span>
                    <span className="font-bold text-gray-900 block mt-0.5">{checklist.client_name || 'Customer'}</span>
                    {checklist.client_mobile && (
                      <span className="text-gray-600 font-mono block text-[11px]">{checklist.client_mobile}</span>
                    )}
                    <span className="text-gray-600 text-[11px] block mt-0.5">
                      Destination: <strong>{checklist.destination || checklist.client_location || 'Customer Address'}</strong>
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Authoritative Issuance Status</span>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Stock Issuance: Completed
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-2">
                      Installation Status: <span className="font-semibold text-gray-800">{checklist.installation_status || 'Pending Customer Installation / Technician Assignment'}</span>
                    </div>
                    {(checklist.material_issued_at || checklist.devices_issued_at) && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Issued On: <strong className="text-gray-700">{new Date(checklist.material_issued_at || checklist.devices_issued_at).toLocaleString('en-IN')}</strong>
                      </div>
                    )}
                    {(checklist.material_issued_by || checklist.devices_issued_by) && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Authorized By: <strong className="text-gray-700">Store Manager</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Issued Product Table */}
                <div className="pt-2 border-t border-gray-200">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Issued Products</span>
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-100 text-[10px] font-bold text-gray-600 uppercase border-b border-gray-200">
                        <tr>
                          <th className="py-2 px-3">Device Model</th>
                          <th className="py-2 px-3">SKU</th>
                          <th className="py-2 px-3 text-center">Issued Qty</th>
                          <th className="py-2 px-3 text-center">Ledger Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {deviceList.map((d, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="py-2 px-3 font-semibold text-gray-900">{d.device_type}</td>
                            <td className="py-2 px-3 font-mono text-[11px] text-gray-500">{d.sku}</td>
                            <td className="py-2 px-3 text-center font-bold text-gray-900">{d.required} Nos.</td>
                            <td className="py-2 px-3 text-center">
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                Deducted &amp; Committed
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Read-only Action: Close Only */}
              <div className="flex items-center justify-end pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all cursor-pointer shadow-2xs"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {loadingInv ? (
                <div className="py-8 text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
                  <p className="text-xs text-gray-500">Checking store stock for required courier devices...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                    <span className="flex items-center gap-1.5 text-indigo-900">
                      <Package className="w-4 h-4 text-indigo-600" />
                      <span>Required Courier Devices ({deviceList.length})</span>
                    </span>
                    {devDeficits.length > 0 && (
                      <span className="text-rose-600 text-[11px] font-bold">
                        ⚠ {devDeficits.length} Device Shortage in Store
                      </span>
                    )}
                  </div>

                  <div className="border border-indigo-200 rounded-xl overflow-hidden text-xs bg-white shadow-2xs">
                    <table className="w-full text-left">
                      <thead className="bg-indigo-50 text-[10px] font-bold text-indigo-900 uppercase border-b border-indigo-200">
                        <tr>
                          <th className="py-2.5 px-3">Device Model</th>
                          <th className="py-2.5 px-3">SKU</th>
                          <th className="py-2.5 px-3 text-center">Required Qty</th>
                          <th className="py-2.5 px-3 text-center">In Store Stock</th>
                          <th className="py-2.5 px-3 text-center">Shortage</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {deviceList.map((d, i) => (
                          <tr key={i} className={d.shortage > 0 ? 'bg-rose-50/40' : 'hover:bg-indigo-50/20'}>
                            <td className="py-2.5 px-3 font-semibold text-gray-900">{d.device_type}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">{d.sku}</td>
                            <td className="py-2.5 px-3 text-center font-bold text-gray-900">{d.required} Nos.</td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{d.available} Nos.</td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold">
                              {d.shortage > 0 ? (
                                <span className="text-rose-700 bg-rose-100 px-2 py-0.5 rounded text-[11px]">
                                  -{d.shortage} Short
                                </span>
                              ) : (
                                <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded text-[11px]">
                                  0
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {d.shortage > 0 ? (
                                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                  Out of Stock
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

                  <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                    <span>Destination / Recipient: <strong className="text-gray-900">{checklist.destination || checklist.client_location || checklist.client_name}</strong></span>
                    <span className="text-[11px] text-gray-500">Single-action Store issuance • Deducts from usable stock</span>
                  </div>
                </div>
              )}
            </div>
          )
        ) : isServiceJob ? (
          <div className="space-y-4">
            {allServiceAlreadyIssued && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>All requested service devices and materials have already been issued for this job.</span>
              </div>
            )}

            {loadingInv ? (
              <div className="py-8 text-center space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600 mx-auto" />
                <p className="text-xs text-gray-500">Checking store stock for requested service items...</p>
              </div>
            ) : serviceList.length === 0 ? (
              <div className="p-6 bg-purple-50/50 border border-purple-200 rounded-2xl text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-purple-600 mx-auto opacity-75" />
                <h4 className="text-sm font-bold text-gray-900">Direct Service Call — No Items Requested</h4>
                <p className="text-xs text-gray-600 max-w-md mx-auto">
                  This Service checklist has no requested devices or materials. The technician will perform labor/troubleshooting on site without Store Manager stock issuance.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl cursor-pointer"
                  >
                    Close Window
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                  <span className="flex items-center gap-1.5 text-purple-900">
                    <Package className="w-4 h-4 text-purple-600" /> Requested Service Items ({serviceList.length})
                  </span>
                  {serviceDeficits.length > 0 && (
                    <span className="text-rose-600 text-[11px] font-bold">
                      ⚠ {serviceDeficits.length} Item Shortage in Store
                    </span>
                  )}
                </div>

                <div className="border border-purple-200 rounded-xl overflow-hidden text-xs bg-white shadow-2xs">
                  <table className="w-full text-left">
                    <thead className="bg-purple-50 text-[10px] font-bold text-purple-900 uppercase border-b border-purple-200">
                      <tr>
                        <th className="py-2.5 px-3">Item Name / SKU</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3 text-center">Req Qty</th>
                        <th className="py-2.5 px-3 text-center">In Store</th>
                        <th className="py-2.5 px-3 text-center">Remaining</th>
                        <th className="py-2.5 px-3 text-center w-28">Issue Qty</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {serviceList.map((it) => {
                        const remaining = it.quantity_remaining;
                        const isFullyIssued = remaining === 0;
                        const selectedVal = serviceIssueQtys[it.id] !== undefined ? serviceIssueQtys[it.id] : Math.min(remaining, it.available_stock);
                        const isOverAvailable = selectedVal > it.available_stock;
                        const isOverRemaining = selectedVal > remaining;

                        return (
                          <tr key={it.id} className={it.shortage > 0 ? 'bg-rose-50/40' : 'hover:bg-gray-50/50'}>
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-gray-900 block">{it.item_name}</span>
                              <span className="text-[10px] text-gray-400 font-mono block">SKU: {it.sku}</span>
                              {it.service_note && (
                                <span className="text-[10px] text-purple-700 italic block mt-0.5">Note: {it.service_note}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${it.item_type === 'DEVICE' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                                {it.item_type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-gray-900">{it.quantity_required} {it.unit}</td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{it.available_stock} {it.unit}</td>
                            <td className="py-2.5 px-3 text-center font-mono font-semibold text-gray-700">{remaining} {it.unit}</td>
                            <td className="py-2.5 px-3 text-center">
                              {isFullyIssued ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                  Done
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  max={Math.min(remaining, it.available_stock)}
                                  value={selectedVal}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0);
                                    setServiceIssueQtys((prev) => ({ ...prev, [it.id]: val }));
                                  }}
                                  className={`w-20 text-center font-mono font-bold text-xs p-1.5 border rounded-lg focus:outline-none ${
                                    isOverAvailable || isOverRemaining
                                      ? 'border-rose-400 bg-rose-50 text-rose-700'
                                      : 'border-purple-300 focus:border-purple-600 bg-white text-gray-900'
                                  }`}
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isFullyIssued ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                  Fully Issued
                                </span>
                              ) : it.shortage > 0 ? (
                                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                  Short by {it.shortage}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
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
            )}
          </div>
        ) : (
          /* ========================================================
             INSTALLATION JOB SECTION (PRESERVED EXISTING BEHAVIOR)
             ======================================================== */
          <>
            {devicesAlreadyIssued && materialsAlreadyIssued && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>All camera devices and installation materials have already been authorized and issued for this job.</span>
              </div>
            )}

            {/* Issuance Checkbox Toggles */}
            <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/60 flex flex-wrap items-center gap-6 text-xs font-semibold text-gray-800">
              <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Components to Issue:</span>
              <label className={`flex items-center gap-2 ${devicesAlreadyIssued ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={devicesAlreadyIssued ? false : issueDevices}
                  disabled={devicesAlreadyIssued}
                  onChange={(e) => setIssueDevices(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                />
                <span>Camera Devices ({deviceList.length})</span>
                {devicesAlreadyIssued && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Already Issued
                  </span>
                )}
              </label>
              <label className={`flex items-center gap-2 ${materialsAlreadyIssued ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={materialsAlreadyIssued ? false : issueMaterials}
                  disabled={materialsAlreadyIssued}
                  onChange={(e) => setIssueMaterials(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                />
                <span>Installation Materials ({materialList.length})</span>
                {materialsAlreadyIssued && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Already Issued
                  </span>
                )}
              </label>
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

              </div>
            )}
          </>
        )}

        {/* Remarks Form & Submission */}
        {!isCourierStockIssued && (!isServiceJob || serviceList.length > 0) && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-gray-100">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                Store Manager Remarks / Dispatch Notes
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  isCourierJob
                    ? `e.g. Products inspected and packaged for courier dispatch to ${checklist.client_name || 'recipient'}`
                    : isServiceJob
                    ? 'e.g. Issued requested service replacement items to technician'
                    : 'e.g. Dispatched complete kit with technician; batch verified'
                }
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500"
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
                disabled={
                  submitting ||
                  (isCourierJob
                    ? devicesAlreadyIssued || hasDeviceDeficit || deviceList.length === 0
                    : isServiceJob
                    ? allServiceAlreadyIssued || hasServiceSelectedDeficit || totalServiceSelectedQty <= 0
                    : hasDeficit || (!willIssueDevices && !willIssueMaterials && !willIssueBackup))
                }
                className={`px-5 py-2 text-xs font-bold text-white ${
                  isCourierJob
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : isServiceJob
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                } rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deducting Stock...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isCourierJob
                        ? 'Authorize & Issue Courier Stock'
                        : isServiceJob
                        ? 'Authorize & Issue Service Items'
                        : 'Authorize & Issue Stock'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

