import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';

export default function InventoryManagement() {
  const { token, role } = useAuth();
  const [products, setProducts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stock'); // 'stock', 'transactions', 'discrepancies'

  // Receive stock modal state
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedDeviceType, setSelectedDeviceType] = useState('2 Channel Live');
  const [receiveQty, setReceiveQty] = useState('');
  const [receiveRemarks, setReceiveRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const canManageStock = role === 'STORE_MANAGER' || role === 'ADMIN';

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Products
      const prodRes = await fetch('/api/admin/inventory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProducts(prodData);
      }

      // 2. Transactions
      if (canManageStock) {
        const txRes = await fetch('/api/admin/inventory/transactions', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (txRes.ok) {
          const txData = await txRes.json();
          setTransactions(txData.transactions || []);
        }

        // 3. Discrepancies
        const discRes = await fetch('/api/admin/inventory/discrepancies', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (discRes.ok) {
          const discData = await discRes.json();
          setDiscrepancies(discData || []);
        }
      }
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, role]);

  const handleReceiveStock = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const qty = parseInt(receiveQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg('Quantity must be a positive number');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/inventory/receive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_type: selectedDeviceType,
          quantity: qty,
          remarks: receiveRemarks,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to receive stock');

      setSuccessMsg(`Successfully added ${qty} units of ${selectedDeviceType} to usable stock.`);
      setReceiveQty('');
      setReceiveRemarks('');
      setShowReceiveModal(false);
      fetchData();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <Package className="w-7 h-7 text-blue-600" /> Inventory & Stock Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track usable stock, issued quantities, physically verified returns, and damaged stock.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {canManageStock && (
            <button
              onClick={() => setShowReceiveModal(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> Receive Stock Batch
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> {successMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6">
        <button
          onClick={() => setActiveTab('stock')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'stock'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package className="w-4 h-4" /> Device Stock Levels
        </button>
        {canManageStock && (
          <>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'transactions'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Clock className="w-4 h-4" /> Movement Transactions ({transactions.length})
            </button>
            <button
              onClick={() => setActiveTab('discrepancies')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'discrepancies'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <AlertTriangle className="w-4 h-4" /> Stock Discrepancies ({discrepancies.length})
            </button>
          </>
        )}
      </div>

      {/* TAB 1: Stock Levels Grid */}
      {activeTab === 'stock' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((item) => {
            const isLowStock = item.usable_stock <= (item.min_stock_level || 5);
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border p-5 shadow-xs transition-all hover:shadow-md ${
                  isLowStock ? 'border-amber-300 ring-1 ring-amber-300' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      {item.device_type}
                    </span>
                    <h3 className="text-base font-bold text-gray-900 mt-2">{item.device_name}</h3>
                  </div>
                  {isLowStock && (
                    <span className="text-xs font-medium px-2 py-1 bg-amber-100 text-amber-800 rounded-md flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Low Stock
                    </span>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <p className="text-xs text-gray-500 font-medium">Usable Stock</p>
                    <p className={`text-xl font-bold mt-1 ${isLowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {item.usable_stock} units
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <p className="text-xs text-gray-500 font-medium">Issued Stock</p>
                    <p className="text-xl font-bold text-blue-600 mt-1">{item.issued_stock || 0} units</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 border-t border-gray-100 pt-3">
                  <div>
                    <span className="text-gray-400">Verified Returns:</span>{' '}
                    <span className="font-semibold text-gray-800">{item.returned_usable_stock || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Damaged Stock:</span>{' '}
                    <span className="font-semibold text-red-600">{item.damaged_stock || 0}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Transactions History */}
      {activeTab === 'transactions' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Device Type</th>
                  <th className="py-3 px-4">Transaction Type</th>
                  <th className="py-3 px-4">Quantity</th>
                  <th className="py-3 px-4">Performed By</th>
                  <th className="py-3 px-4">Remarks / Job Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      No stock movement transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {new Date(tx.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-900">
                        {tx.product?.device_type || 'Device'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${
                            tx.transaction_type === 'STOCK_RECEIVED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : tx.transaction_type === 'STOCK_ISSUED'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : tx.transaction_type === 'USABLE_STOCK_RETURNED'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {tx.transaction_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-gray-800">
                        {tx.transaction_type === 'STOCK_ISSUED' ? `-${tx.quantity}` : `+${tx.quantity}`}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-600">
                        {tx.actor?.full_name || tx.actor?.email || 'System'}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-600 max-w-xs truncate">
                        {tx.reason_or_remarks || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Stock Discrepancies */}
      {activeTab === 'discrepancies' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-800">Flagged Return Mismatches & Missing Stock</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {discrepancies.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <p className="font-medium text-gray-600">No open inventory discrepancies found!</p>
              </div>
            ) : (
              discrepancies.map((disc) => (
                <div key={disc.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 bg-red-100 text-red-800 rounded-md">
                        {disc.discrepancy_type}
                      </span>
                      <span className="text-xs text-gray-500">
                        Checklist: {disc.checklist?.checklist_number || disc.checklist_id}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mt-1">
                      {disc.device_type}: Declared {disc.declared_qty} vs Verified Usable {disc.verified_qty} (Diff: {disc.discrepancy_qty})
                    </p>
                    {disc.resolution_notes && (
                      <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-2 rounded-md border border-gray-100">
                        Notes: {disc.resolution_notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        disc.status === 'OPEN'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {disc.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Receive Stock Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" /> Receive New Stock Batch
            </h3>
            <p className="text-xs text-gray-500">
              Record incoming physical inventory batch received from manufacturer/supplier.
            </p>

            {errorMsg && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleReceiveStock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Device Type</label>
                <select
                  value={selectedDeviceType}
                  onChange={(e) => setSelectedDeviceType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.device_type}>
                      {p.device_type} (Current Usable: {p.usable_stock})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Received Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Batch / Receipt Remarks</label>
                <textarea
                  rows="2"
                  value={receiveRemarks}
                  onChange={(e) => setReceiveRemarks(e.target.value)}
                  placeholder="Supplier batch number or delivery invoice note..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Receiving...' : 'Add to Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
