import { useState, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Package, ShieldCheck, AlertTriangle, ArrowRight, Clock, CheckCircle2, X } from 'lucide-react';
import InventoryManagement from '../InventoryManagement';
import { fetchPendingStoreReturns } from '../../../lib/api';

export default function StoreWorkspace({ onSelectChecklist }) {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [pendingReturns, setPendingReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'pending_issue', 'pending_verification'
  const [verifyModalReturn, setVerifyModalReturn] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch checklists
      const res = await fetch('/api/admin/installations', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setChecklists(data.checklists || []);
      }

      // 2. Fetch pending returns
      const returnsData = await fetchPendingStoreReturns(token);
      setPendingReturns(returnsData || []);
    } catch (err) {
      console.error('Failed to load Store workspace data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const pendingIssueJobs = checklists.filter(
    (c) => c.reconciliation_status === 'INITIATED' || c.installation_status === 'Assigned'
  );

  // Return jobs awaiting store physical verification
  const pendingVerifyJobs = checklists.filter(
    (c) =>
      c.reconciliation_status === 'PENDING_STORE_VERIFICATION' ||
      c.reconciliation_status === 'SITE_WORK_COMPLETED' ||
      pendingReturns.some((r) => r.checklist_id === c.id)
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-amber-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-amber-500/30 text-amber-200 rounded-md border border-amber-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="w-7 h-7 text-amber-400" /> Store Manager Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            Receive incoming stock batches, issue physical devices for approved installation jobs, verify returned devices, separate damaged stock, and reconcile inventory discrepancies.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex flex-wrap gap-6">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'inventory' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <Package className="w-4 h-4" /> Stock Balances & Add Stock
        </button>
        <button
          onClick={() => setActiveTab('pending_issue')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'pending_issue' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <Clock className="w-4 h-4" /> Jobs Awaiting Issue ({pendingIssueJobs.length})
        </button>
        <button
          onClick={() => setActiveTab('pending_verification')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'pending_verification' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> Returns Pending Physical Verification ({pendingVerifyJobs.length})
        </button>
      </div>

      {/* TAB 1: Inventory Management View */}
      {activeTab === 'inventory' && <InventoryManagement />}

      {/* TAB 2: Pending Stock Issue Jobs */}
      {activeTab === 'pending_issue' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Installation Jobs Awaiting Device Issue</h3>
            <span className="text-xs text-gray-500 font-medium">{pendingIssueJobs.length} pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Requested Device Type</th>
                  <th className="py-3 px-4">Requested Quantity</th>
                  <th className="py-3 px-4">Arrival Schedule</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingIssueJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      No jobs currently awaiting stock issuance.
                    </td>
                  </tr>
                ) : (
                  pendingIssueJobs.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-amber-800">{item.checklist_number}</td>
                      <td className="py-3 px-4 font-bold text-gray-900">{item.client_name}</td>
                      <td className="py-3 px-4 font-semibold text-gray-800">{item.device_type}</td>
                      <td className="py-3 px-4 font-bold text-blue-700">{item.number_of_devices} units</td>
                      <td className="py-3 px-4 text-gray-600">
                        {item.expected_arrival_date} {item.expected_arrival_time}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() =>
                            onSelectChecklist
                              ? onSelectChecklist(item.id)
                              : navigate(`/admin/installation-checklists/${item.id}`)
                          }
                          className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1 cursor-pointer"
                        >
                          Issue Stock <ArrowRight className="w-3 h-3" />
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

      {/* TAB 3: Store Manager Return Verification */}
      {activeTab === 'pending_verification' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" /> Declared Returns Pending Physical Store Verification
            </h3>
            <span className="text-xs text-gray-500 font-medium">{pendingVerifyJobs.length} pending</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Device Type</th>
                  <th className="py-3 px-4">Technician Name</th>
                  <th className="py-3 px-4">Declared Return Qty</th>
                  <th className="py-3 px-4">Verification Status</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingVerifyJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      No returned devices currently awaiting store physical verification.
                    </td>
                  </tr>
                ) : (
                  pendingVerifyJobs.map((item) => {
                    const matchedReturn = pendingReturns.find((r) => r.checklist_id === item.id);
                    const returnId = matchedReturn ? matchedReturn.id : null;
                    const declaredQty = matchedReturn ? matchedReturn.declared_return_qty : item.number_of_devices;

                    return (
                      <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-emerald-800">{item.checklist_number}</td>
                        <td className="py-3 px-4 font-bold text-gray-900">{item.client_name}</td>
                        <td className="py-3 px-4 font-semibold text-gray-800">{item.device_type}</td>
                        <td className="py-3 px-4 text-gray-700">{item.service_engineer || 'Technician'}</td>
                        <td className="py-3 px-4 font-bold text-blue-700">{declaredQty} units</td>
                        <td className="py-3 px-4 font-bold text-amber-700">
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px]">
                            {matchedReturn?.status || item.reconciliation_status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() =>
                              setVerifyModalReturn({
                                return_id: returnId || `return-${item.id}`,
                                checklist_id: item.id,
                                checklist_number: item.checklist_number,
                                client_name: item.client_name,
                                technician_name: item.service_engineer || 'Technician',
                                device_type: item.device_type,
                                declared_return_qty: declaredQty,
                              })
                            }
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-2xs text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Verify Physical Return
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
      )}

      {/* Store Verification Modal */}
      {verifyModalReturn && (
        <StoreReturnVerifyModal
          returnItem={verifyModalReturn}
          token={token}
          user={user}
          onClose={() => setVerifyModalReturn(null)}
          onSuccess={() => {
            setVerifyModalReturn(null);
            showToast('Returned devices physically verified and stock updated!');
            loadData();
          }}
        />
      )}
    </div>
  );
}

function StoreReturnVerifyModal({ returnItem, token, user, onClose, onSuccess }) {
  const [declaredQty] = useState(returnItem.declared_return_qty || 0);
  const [receivedQty, setReceivedQty] = useState(returnItem.declared_return_qty || 0);
  const [acceptedUsableQty, setAcceptedUsableQty] = useState(returnItem.declared_return_qty || 0);
  const [damagedQty, setDamagedQty] = useState(0);
  const [missingQty, setMissingQty] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const rec = parseInt(receivedQty, 10) || 0;
    const usable = parseInt(acceptedUsableQty, 10) || 0;
    const dmg = parseInt(damagedQty, 10) || 0;
    const miss = parseInt(missingQty, 10) || 0;

    if (rec < 0 || usable < 0 || dmg < 0 || miss < 0) {
      setError('Quantities cannot be negative.');
      return;
    }

    if (usable + dmg > rec) {
      setError(`Usable (${usable}) + Damaged (${dmg}) cannot exceed received quantity (${rec}).`);
      return;
    }

    const totalAccounted = rec + miss;
    if (totalAccounted !== declaredQty && (!remarks || !remarks.trim())) {
      setError(`Received (${rec}) + Missing (${miss}) does not equal Declared Return (${declaredQty}). Explanation remarks are required.`);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/admin/installations/${returnItem.checklist_id}/verify-return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          return_id: returnItem.return_id,
          accepted_usable_qty: usable,
          damaged_qty: dmg,
          missing_qty: miss,
          remarks: remarks.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify store return');
      onSuccess();
    } catch (err) {
      console.error('Error verifying return:', err);
      setError(err.message || 'Failed to verify store return');
    } finally {
      setLoading(false);
    }
  };

  const recNum = parseInt(receivedQty, 10) || 0;
  const missNum = parseInt(missingQty, 10) || 0;
  const hasDiscrepancy = recNum + missNum !== declaredQty;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" /> Store Physical Return Verification
          </h3>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reference Information */}
        <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 text-xs space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-gray-500 block text-[10px]">Checklist No:</span>
              <span className="font-mono font-bold text-purple-700">{returnItem.checklist_number}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">Client Name:</span>
              <span className="font-bold text-gray-900">{returnItem.client_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">Technician:</span>
              <span className="font-semibold text-gray-800">{returnItem.technician_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">Device Type:</span>
              <span className="font-bold text-blue-800">{returnItem.device_type}</span>
            </div>
          </div>
          <div className="pt-1.5 border-t border-gray-200 flex justify-between font-bold text-xs">
            <span>Declared Return Qty by Tech:</span>
            <span className="text-purple-700 font-mono">{declaredQty} units</span>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-gray-700 mb-1">Physically Received Quantity</label>
            <input
              type="number"
              min="0"
              value={receivedQty}
              onChange={(e) => setReceivedQty(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg font-bold text-blue-900 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-emerald-800 mb-1">Accepted Usable (Credits Stock)</label>
              <input
                type="number"
                min="0"
                value={acceptedUsableQty}
                onChange={(e) => setAcceptedUsableQty(e.target.value)}
                className="w-full px-3 py-2 border border-emerald-300 rounded-lg font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-rose-800 mb-1">Damaged Qty (Damaged Stock)</label>
              <input
                type="number"
                min="0"
                value={damagedQty}
                onChange={(e) => setDamagedQty(e.target.value)}
                className="w-full px-3 py-2 border border-rose-300 rounded-lg font-bold text-rose-600 focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-amber-800 mb-1">Missing Qty</label>
              <input
                type="number"
                min="0"
                value={missingQty}
                onChange={(e) => setMissingQty(e.target.value)}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg font-bold text-amber-600 focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>

          {hasDiscrepancy && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
              <label className="block font-bold text-amber-900 text-xs">
                Discrepancy Reason / Remarks <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Explain quantity mismatch between declared return and physical count..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-1.5 border border-amber-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                required
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-gray-700 mb-1">Store Verification Notes</label>
            <textarea
              rows="2"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Physical inspection notes..."
              className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? 'Verifying...' : 'Verify Return & Update Inventory'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
