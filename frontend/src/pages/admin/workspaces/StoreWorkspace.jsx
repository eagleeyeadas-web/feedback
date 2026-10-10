import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Clock,
  CheckCircle2,
  X,
  Plus,
  Minus,
  SlidersHorizontal,
  Edit3,
  RefreshCw,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  Truck,
  RotateCcw,
  Check,
} from 'lucide-react';
import {
  fetchInventoryProducts,
  fetchInventorySummary,
  fetchInventoryTransactions,
  receiveInventoryStock,
  adjustInventoryStock,
  fetchAllStoreReturns,
  verifyStoreReturnApi,
} from '../../../lib/api';

const STANDARD_DEVICE_TYPES = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

export default function StoreWorkspace({ onSelectChecklist }) {
  const { token, user, role } = useAuth();
  const navigate = useNavigate();

  // Tab State: 'overview', 'add_stock', 'movements', 'returns'
  const [activeTab, setActiveTab] = useState('overview');

  // Inventory State
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState({
    totalUsable: 0,
    totalIssued: 0,
    totalAwaitingReturn: 0,
    totalDamaged: 0,
  });
  const [transactions, setTransactions] = useState([]);
  const [storeReturns, setStoreReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchStock, setSearchStock] = useState('');

  // Transactions Filter
  const [txFilterType, setTxFilterType] = useState('');
  const [txSearch, setTxSearch] = useState('');

  // Add Stock Form State
  const [addDeviceType, setAddDeviceType] = useState('2 Channel Live');
  const [addQty, setAddQty] = useState('');
  const [addSupplier, setAddSupplier] = useState('');
  const [addPurchaseRef, setAddPurchaseRef] = useState('');
  const [addUnitCost, setAddUnitCost] = useState('');
  const [addReceivedDate, setAddReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [addRemarks, setAddRemarks] = useState('');
  const [addingStock, setAddingStock] = useState(false);
  const [addError, setAddError] = useState('');

  // Verify Return Modal State
  const [verifyModalReturn, setVerifyModalReturn] = useState(null);
  // Edit & Adjustment Modal State
  const [editModalData, setEditModalData] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  const loadAllData = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    try {
      // 1. Fetch inventory products
      const prodData = await fetchInventoryProducts(token).catch(() => []);
      setProducts(prodData || []);

      // 2. Fetch inventory summary metrics
      const sumData = await fetchInventorySummary(token).catch(() => null);
      if (sumData) {
        setSummary(sumData);
      } else {
        // Fallback calculate from products
        let u = 0, i = 0, d = 0;
        (prodData || []).forEach((p) => {
          u += Number(p.usable_stock) || 0;
          i += Number(p.issued_stock) || 0;
          d += Number(p.damaged_stock) || 0;
        });
        setSummary((prev) => ({ ...prev, totalUsable: u, totalIssued: i, totalDamaged: d }));
      }

      // 3. Fetch transactions
      const txData = await fetchInventoryTransactions(token, {
        type: txFilterType,
        search: txSearch,
        limit: 100,
      }).catch(() => ({ transactions: [] }));
      setTransactions(txData.transactions || []);

      // 4. Fetch all store returns
      const returnsData = await fetchAllStoreReturns(token).catch(() => []);
      setStoreReturns(returnsData || []);

      // Update awaiting return count from returns list
      const awaiting = (returnsData || [])
        .filter((r) => r.status === 'PENDING_STORE_VERIFICATION')
        .reduce((acc, curr) => acc + (Number(curr.declared_return_qty) || 0), 0);

      setSummary((prev) => ({ ...prev, totalAwaitingReturn: awaiting }));
    } catch (err) {
      console.error('Failed to load Store Workspace data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, txFilterType, txSearch]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const handleAddStockSubmit = async (e) => {
    e.preventDefault();
    setAddError('');

    const qty = parseInt(addQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setAddError('Quantity received must be a positive whole number greater than 0.');
      return;
    }

    setAddingStock(true);
    try {
      await receiveInventoryStock(token, {
        device_type: addDeviceType,
        quantity: qty,
        supplier: addSupplier,
        purchase_ref: addPurchaseRef,
        unit_cost: addUnitCost ? parseFloat(addUnitCost) : null,
        received_date: addReceivedDate,
        remarks: addRemarks,
      });

      showToast(`Successfully added ${qty} units of ${addDeviceType} to usable stock.`);
      setAddQty('');
      setAddSupplier('');
      setAddPurchaseRef('');
      setAddUnitCost('');
      setAddRemarks('');
      loadAllData();
      setActiveTab('overview');
    } catch (err) {
      console.error('Error adding stock:', err);
      setAddError(err.message || 'Failed to add stock batch.');
    } finally {
      setAddingStock(false);
    }
  };

  // Filter products by search text
  const filteredProducts = products.filter(
    (p) =>
      (p.device_type || '').toLowerCase().includes(searchStock.toLowerCase()) ||
      (p.device_name || '').toLowerCase().includes(searchStock.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(searchStock.toLowerCase())
  );

  const pendingReturns = storeReturns.filter((r) => r.status === 'PENDING_STORE_VERIFICATION');

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
      <div className="bg-gradient-to-r from-amber-900 via-amber-800 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-amber-500/30 text-amber-200 rounded-md border border-amber-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="w-7 h-7 text-amber-400" /> Store Manager Workspace
          </h1>
          <p className="text-xs text-white/80 mt-1 max-w-xl">
            Real-time usable stock balances, incoming stock intake, technician return verification, and auditable movement logs.
          </p>
        </div>

        <button
          onClick={loadAllData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Workspace</span>
        </button>
      </div>

      {/* 4 Clean Tabs */}
      <div className="bg-white p-1.5 rounded-xl border border-gray-200 shadow-xs flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Stock Overview</span>
        </button>

        <button
          onClick={() => setActiveTab('add_stock')}
          className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'add_stock'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Add / Adjust Stock</span>
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'movements'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Stock Movements</span>
          <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-black/10 rounded-full font-mono">
            {transactions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('returns')}
          className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'returns'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Device Returns</span>
          {pendingReturns.length > 0 && (
            <span
              className={`ml-1 px-1.5 py-0.2 text-[10px] rounded-full font-bold ${
                activeTab === 'returns' ? 'bg-white text-amber-900' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {pendingReturns.length} pending
            </span>
          )}
        </button>
      </div>

      {/* =========================================================================
          SECTION 1: STOCK OVERVIEW
          ========================================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Total Usable Units</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{summary.totalUsable}</p>
                <p className="text-[10px] text-emerald-600 font-medium">Available for technician carry</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <Truck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Issued to Technicians</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{summary.totalIssued}</p>
                <p className="text-[10px] text-blue-600 font-medium">Currently deployed on site</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <RotateCcw className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Awaiting Verification</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{summary.totalAwaitingReturn}</p>
                <p className="text-[10px] text-amber-700 font-medium">Declared returns pending check</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Damaged Units</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{summary.totalDamaged}</p>
                <p className="text-[10px] text-rose-600 font-medium">Quarantined from usable stock</p>
              </div>
            </div>
          </div>

          {/* Search Bar & Quick Action */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search device type or model..."
                value={searchStock}
                onChange={(e) => setSearchStock(e.target.value)}
                className="w-full text-xs pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-500 text-gray-800"
              />
            </div>

            <button
              onClick={() => setActiveTab('add_stock')}
              className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Stock Batch
            </button>
          </div>

          {/* Stock Overview Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600" /> Device Type Inventory Balances
              </h3>
              <span className="text-xs text-gray-500 font-medium">
                {filteredProducts.length} device types
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Device Type</th>
                    <th className="py-3 px-4 text-right">Usable Stock</th>
                    <th className="py-3 px-4 text-right">Issued to Techs</th>
                    <th className="py-3 px-4 text-right">Damaged Stock</th>
                    <th className="py-3 px-4 text-right">Min Level</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4">Last Updated</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        No matching device records found.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((item) => {
                      const isLowStock = item.usable_stock <= (item.min_stock_level || 5);
                      const isOutOfStock = item.usable_stock === 0;

                      return (
                        <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-gray-900">{item.device_type}</div>
                            <div className="text-[10px] text-gray-400">{item.device_name}</div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-extrabold text-sm text-emerald-700">
                            {item.usable_stock}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-blue-700">
                            {item.issued_stock || 0}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-rose-600">
                            {item.damaged_stock || 0}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-gray-500">
                            {item.min_stock_level || 5}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                isOutOfStock
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : isLowStock
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              }`}
                            >
                              {isOutOfStock ? 'OUT OF STOCK' : isLowStock ? 'LOW STOCK' : 'IN STOCK'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                            {item.updated_at ? new Date(item.updated_at).toLocaleDateString('en-IN') : 'Recently'}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <button
                                onClick={() => setEditModalData({ item, action: 'ADD' })}
                                className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-2xs"
                                title="Add stock to this device"
                              >
                                <Plus className="w-3 h-3 text-emerald-600" /> Add
                              </button>
                              <button
                                onClick={() => setEditModalData({ item, action: 'REMOVE' })}
                                className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-2xs"
                                title="Remove / deduct stock from this device"
                              >
                                <Minus className="w-3 h-3 text-rose-600" /> Remove
                              </button>
                              <button
                                onClick={() => setEditModalData({ item, action: 'SET' })}
                                className="px-2 py-1 text-[11px] font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-2xs"
                                title="Edit & adjust stock balance"
                              >
                                <SlidersHorizontal className="w-3 h-3 text-gray-500" /> Edit
                              </button>
                            </div>
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
      )}

      {/* =========================================================================
          SECTION 2: ADD STOCK (INCOMING INTAKE)
          ========================================================================= */}
      {activeTab === 'add_stock' && (
        <div className="max-w-2xl mx-auto bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-5">
          <div className="border-b border-gray-100 pb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
              Store Intake
            </span>
            <h2 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-600" /> Receive Incoming Stock Batch
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Increase physical usable stock for devices received from suppliers or central logistics. An immutable transaction record will be created.
            </p>
          </div>

          {addError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          <form onSubmit={handleAddStockSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-gray-700 mb-1">Device Type *</label>
              <select
                value={addDeviceType}
                onChange={(e) => setAddDeviceType(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-xl font-bold text-gray-800 focus:outline-none focus:border-amber-500"
                required
              >
                {STANDARD_DEVICE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Quantity Received *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 20"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-xl font-bold text-emerald-700 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">Received Date</label>
                <input
                  type="date"
                  value={addReceivedDate}
                  onChange={(e) => setAddReceivedDate(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Supplier / Vendor (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Eagle Eye Central Logistics"
                  value={addSupplier}
                  onChange={(e) => setAddSupplier(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">Invoice / PO Reference (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-904"
                  value={addPurchaseRef}
                  onChange={(e) => setAddPurchaseRef(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Remarks / Batch Notes (Optional)</label>
              <textarea
                rows="2"
                placeholder="Inspection notes or warehouse location..."
                value={addRemarks}
                onChange={(e) => setAddRemarks(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className="px-4 py-2 font-semibold text-gray-600 hover:text-gray-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingStock}
                className="px-5 py-2.5 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{addingStock ? 'Submitting Batch...' : 'Add Stock to Usable Inventory'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          SECTION 3: STOCK MOVEMENTS (AUDIT TRAIL)
          ========================================================================= */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          {/* Movement Filters */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                Filter by Transaction Type
              </label>
              <select
                value={txFilterType}
                onChange={(e) => setTxFilterType(e.target.value)}
                className="w-full text-xs p-2.5 bg-gray-50 border border-gray-200 rounded-xl font-semibold text-gray-800 focus:outline-none focus:border-amber-500"
              >
                <option value="">All Movement Types</option>
                <option value="STOCK_RECEIVED">Stock Received (Intake)</option>
                <option value="STOCK_ISSUED">Issued to Technician</option>
                <option value="USABLE_STOCK_RETURNED">Usable Return Verified</option>
                <option value="DAMAGED_STOCK_RECEIVED">Damaged Stock Received</option>
                <option value="STOCK_ADJUSTMENT">Stock Adjustment</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                Search Transactions
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by remarks, reference, technician, or device..."
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  className="w-full text-xs pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 text-gray-800"
                />
              </div>
            </div>
          </div>

          {/* Transactions Ledger */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" /> Immutable Stock Movement Ledger
              </h3>
              <span className="text-xs text-gray-500 font-medium">
                {transactions.length} recorded movements
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Transaction Type</th>
                    <th className="py-3 px-4">Device Type</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4">Checklist Ref</th>
                    <th className="py-3 px-4">Performed By</th>
                    <th className="py-3 px-4">Reason / Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-400">
                        No inventory transactions found matching filters.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => {
                      const isPositive = ['STOCK_RECEIVED', 'USABLE_STOCK_RETURNED'].includes(tx.transaction_type);
                      const isNegative = tx.transaction_type === 'STOCK_ISSUED';

                      return (
                        <tr key={tx.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono text-[11px] text-gray-500">
                            {new Date(tx.created_at).toLocaleString('en-IN', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </td>

                          <td className="py-3 px-4">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                tx.transaction_type === 'STOCK_RECEIVED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : tx.transaction_type === 'STOCK_ISSUED'
                                  ? 'bg-blue-100 text-blue-800'
                                  : tx.transaction_type === 'USABLE_STOCK_RETURNED'
                                  ? 'bg-purple-100 text-purple-800'
                                  : tx.transaction_type === 'DAMAGED_STOCK_RECEIVED'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {tx.transaction_type.replace(/_/g, ' ')}
                            </span>
                          </td>

                          <td className="py-3 px-4 font-semibold text-gray-900">{tx.device_type}</td>

                          <td
                            className={`py-3 px-4 text-right font-mono font-bold ${
                              isPositive ? 'text-emerald-600' : isNegative ? 'text-blue-600' : 'text-gray-900'
                            }`}
                          >
                            {isPositive ? `+${tx.quantity}` : isNegative ? `-${tx.quantity}` : tx.quantity}
                          </td>

                          <td className="py-3 px-4 font-mono text-purple-700 font-semibold">
                            {tx.checklist_id ? (
                              <button
                                onClick={() =>
                                  onSelectChecklist
                                    ? onSelectChecklist(tx.checklist_id)
                                    : navigate(`/admin/installation-checklists/${tx.checklist_id}`)
                                }
                                className="hover:underline cursor-pointer"
                              >
                                {tx.checklist_id.slice(0, 8)}...
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td className="py-3 px-4 text-gray-600 font-medium">{tx.performer_name || 'System'}</td>

                          <td className="py-3 px-4 text-gray-500 max-w-xs truncate" title={tx.reason_or_remarks}>
                            {tx.reason_or_remarks || '—'}
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
      )}

      {/* =========================================================================
          SECTION 4: DEVICE RETURNS (STORE VERIFICATION)
          ========================================================================= */}
      {activeTab === 'returns' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" /> Technician Declared Device Returns
            </h3>
            <span className="text-xs text-gray-500 font-medium">
              {pendingReturns.length} pending physical verification
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">Device Type</th>
                  <th className="py-3 px-4 text-right">Declared Return Qty</th>
                  <th className="py-3 px-4">Date Reported</th>
                  <th className="py-3 px-4 text-center">Verification Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {storeReturns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-400">
                      No returned devices currently recorded.
                    </td>
                  </tr>
                ) : (
                  storeReturns.map((ret) => {
                    const isPending = ret.status === 'PENDING_STORE_VERIFICATION';
                    const chk = ret.installation_checklists;
                    const chkNum = chk?.checklist_number || ret.checklist_number || ret.checklist_id?.slice(0, 8);
                    const client = chk?.client_name || ret.client_name || 'Client';
                    const tech = chk?.service_engineer || ret.technician_name || 'Technician';

                    return (
                      <tr key={ret.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-purple-700">{chkNum}</td>
                        <td className="py-3.5 px-4 font-bold text-gray-900">{client}</td>
                        <td className="py-3.5 px-4 text-gray-700 font-medium">{tech}</td>
                        <td className="py-3.5 px-4 font-semibold text-gray-800">{ret.device_type}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-blue-700">
                          {ret.declared_return_qty} units
                        </td>
                        <td className="py-3.5 px-4 text-gray-500">
                          {new Date(ret.declared_at || ret.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                              isPending
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : ret.status === 'DISCREPANCY_FLAGGED'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}
                          >
                            {isPending
                              ? 'AWAITING STORE VERIFICATION'
                              : ret.status === 'DISCREPANCY_FLAGGED'
                              ? 'VERIFIED WITH DISCREPANCY'
                              : 'VERIFIED'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {isPending ? (
                            <button
                              onClick={() =>
                                setVerifyModalReturn({
                                  return_id: ret.id,
                                  checklist_id: ret.checklist_id,
                                  checklist_number: chkNum,
                                  client_name: client,
                                  technician_name: tech,
                                  device_type: ret.device_type,
                                  declared_return_qty: ret.declared_return_qty,
                                })
                              }
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-2xs text-[11px] flex items-center justify-center gap-1 cursor-pointer transition-colors"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Verify Physical Return</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400 font-semibold flex items-center justify-center gap-1">
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Usable: {ret.accepted_usable_qty || 0} | Dmg: {ret.damaged_qty || 0}</span>
                            </span>
                          )}
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

      {/* =========================================================================
          VERIFY RETURN MODAL
          ========================================================================= */}
      {verifyModalReturn && (
        <StoreReturnVerifyModal
          returnItem={verifyModalReturn}
          token={token}
          user={user}
          onClose={() => setVerifyModalReturn(null)}
          onSuccess={() => {
            setVerifyModalReturn(null);
            showToast('Returned devices physically verified and stock updated!');
            loadAllData();
          }}
        />
      )}

      {/* =========================================================================
          STOCK EDIT & ADJUSTMENT MODAL (ADD / REMOVE / SET)
          ========================================================================= */}
      {editModalData && (
        <StockEditModal
          item={editModalData.item}
          initialAction={editModalData.action}
          token={token}
          onClose={() => setEditModalData(null)}
          onSuccess={(msg) => {
            setEditModalData(null);
            showToast(msg || 'Stock successfully updated!');
            loadAllData();
          }}
        />
      )}
    </div>
  );
}

function StoreReturnVerifyModal({ returnItem, token, user, onClose, onSuccess }) {
  const declaredQty = Number(returnItem.declared_return_qty) || 0;
  const [acceptedUsableQty, setAcceptedUsableQty] = useState(declaredQty);
  const [damagedQty, setDamagedQty] = useState(0);
  const [missingQty, setMissingQty] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const usableNum = parseInt(acceptedUsableQty, 10) || 0;
  const dmgNum = parseInt(damagedQty, 10) || 0;
  const missNum = parseInt(missingQty, 10) || 0;
  const totalAccounted = usableNum + dmgNum + missNum;
  const hasDiscrepancy = totalAccounted !== declaredQty || dmgNum > 0 || missNum > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (usableNum < 0 || dmgNum < 0 || missNum < 0) {
      setError('Quantities cannot be negative.');
      return;
    }

    if (totalAccounted !== declaredQty && (!remarks || !remarks.trim())) {
      setError(
        `Total accounted quantity (${totalAccounted}) does not match declared return quantity (${declaredQty}). An explanation remark is required.`
      );
      return;
    }

    setLoading(true);

    try {
      await verifyStoreReturnApi(token, {
        return_id: returnItem.return_id,
        accepted_usable_qty: usableNum,
        damaged_qty: dmgNum,
        missing_qty: missNum,
        remarks: remarks.trim(),
      });

      onSuccess();
    } catch (err) {
      console.error('Error verifying return:', err);
      setError(err.message || 'Failed to verify store return.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" /> Physical Store Return Verification
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-emerald-800 mb-1">
                Usable Received (Credits Usable)
              </label>
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
              <label className="block font-semibold text-rose-800 mb-1">
                Damaged Received (Damaged Stock)
              </label>
              <input
                type="number"
                min="0"
                value={damagedQty}
                onChange={(e) => setDamagedQty(e.target.value)}
                className="w-full px-3 py-2 border border-rose-300 rounded-lg font-bold text-rose-600 focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-amber-800 mb-1">
                Not Received (Missing / Discrepancy)
              </label>
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
                Discrepancy Explanation Remarks <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Explain missing units, transit damage, or reason for count variance..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-1.5 border border-amber-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                required
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-gray-700 mb-1">Verification Notes (Optional)</label>
            <textarea
              rows="2"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Physical inspection remarks..."
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
              <span>{loading ? 'Verifying...' : 'Confirm & Update Stock'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StockEditModal({ item, initialAction = 'ADD', token, onClose, onSuccess }) {
  const [action, setAction] = useState(initialAction); // 'ADD' | 'REMOVE' | 'SET'
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [moveToDamaged, setMoveToDamaged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentUsable = Number(item.usable_stock) || 0;
  const currentDamaged = Number(item.damaged_stock) || 0;
  const qtyNum = parseInt(quantity, 10) || 0;

  // Compute live projected balances
  let projectedUsable = currentUsable;
  let projectedDamaged = currentDamaged;

  if (action === 'ADD') {
    projectedUsable = currentUsable + (qtyNum > 0 ? qtyNum : 0);
  } else if (action === 'REMOVE') {
    projectedUsable = Math.max(0, currentUsable - (qtyNum > 0 ? qtyNum : 0));
    if (moveToDamaged) {
      projectedDamaged = currentDamaged + (qtyNum > 0 ? qtyNum : 0);
    }
  } else if (action === 'SET') {
    projectedUsable = qtyNum >= 0 ? qtyNum : 0;
  }

  const isExcessiveRemoval = action === 'REMOVE' && qtyNum > currentUsable;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isNaN(qtyNum) || (action !== 'SET' && qtyNum <= 0)) {
      setError('Please enter a valid quantity greater than 0.');
      return;
    }

    if (action === 'REMOVE' && qtyNum > currentUsable) {
      setError(`Cannot remove ${qtyNum} units. Available usable stock is only ${currentUsable} units.`);
      return;
    }

    if (!reason || !reason.trim()) {
      setError('A valid reason is required for any stock edit or adjustment.');
      return;
    }

    setLoading(true);

    try {
      await adjustInventoryStock(token, {
        device_type: item.device_type,
        action,
        quantity: qtyNum,
        reason: reason.trim(),
        move_to_damaged: action === 'REMOVE' && moveToDamaged,
      });

      onSuccess(
        `Successfully updated ${item.device_type} (${action === 'ADD' ? '+' : action === 'REMOVE' ? '-' : '='}${qtyNum} units). New usable balance: ${projectedUsable}`
      );
    } catch (err) {
      console.error('Error adjusting stock:', err);
      setError(err.message || 'Failed to update stock.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
              Inventory Edit & Adjust
            </span>
            <h3 className="text-base font-extrabold text-gray-900 mt-1 flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-600" /> {item.device_type}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Selector: Add, Remove, Set Balance */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setAction('ADD');
              setError('');
            }}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer ${
              action === 'ADD' ? 'bg-emerald-600 text-white shadow-xs' : 'text-gray-600 hover:text-emerald-700'
            }`}
          >
            <Plus className="w-3.5 h-3.5" /> Add Stock
          </button>

          <button
            type="button"
            onClick={() => {
              setAction('REMOVE');
              setError('');
            }}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer ${
              action === 'REMOVE' ? 'bg-rose-600 text-white shadow-xs' : 'text-gray-600 hover:text-rose-700'
            }`}
          >
            <Minus className="w-3.5 h-3.5" /> Remove Stock
          </button>

          <button
            type="button"
            onClick={() => {
              setAction('SET');
              setError('');
            }}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer ${
              action === 'SET' ? 'bg-blue-600 text-white shadow-xs' : 'text-gray-600 hover:text-blue-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Set Balance
          </button>
        </div>

        {/* Live Balance Impact Preview */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs grid grid-cols-3 gap-2 text-center">
          <div>
            <span className="text-[10px] text-gray-500 block uppercase font-bold">Current Usable</span>
            <span className="text-base font-black font-mono text-gray-900">{currentUsable}</span>
          </div>
          <div className="border-x border-gray-200">
            <span className="text-[10px] text-gray-500 block uppercase font-bold">Adjustment</span>
            <span
              className={`text-base font-black font-mono ${
                action === 'ADD' ? 'text-emerald-600' : action === 'REMOVE' ? 'text-rose-600' : 'text-blue-600'
              }`}
            >
              {action === 'ADD' ? `+${qtyNum}` : action === 'REMOVE' ? `-${qtyNum}` : `=${qtyNum}`}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block uppercase font-bold">New Usable</span>
            <span
              className={`text-base font-black font-mono ${
                isExcessiveRemoval ? 'text-rose-600 underline' : 'text-emerald-700'
              }`}
            >
              {projectedUsable}
            </span>
          </div>
        </div>

        {isExcessiveRemoval && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Quantity exceeds current usable stock ({currentUsable} units).</span>
          </div>
        )}

        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-gray-800 mb-1">
              {action === 'ADD'
                ? 'Quantity to Add (Units) *'
                : action === 'REMOVE'
                ? 'Quantity to Remove / Deduct (Units) *'
                : 'Set Exact Usable Balance (Units) *'}
            </label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 5"
              className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-hidden font-mono font-bold text-sm"
              required
              autoFocus
            />
          </div>

          {action === 'REMOVE' && (
            <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={moveToDamaged}
                  onChange={(e) => setMoveToDamaged(e.target.checked)}
                  className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="font-bold text-gray-900 block text-[11px]">
                    Transfer removed units to Damaged Stock
                  </span>
                  <span className="text-[10px] text-gray-600 block">
                    Check this if the removed devices were found damaged/faulty in the store so they remain accounted for.
                  </span>
                </div>
              </label>
            </div>
          )}

          <div>
            <label className="block font-bold text-gray-800 mb-1">
              Reason / Justification for {action === 'ADD' ? 'Addition' : action === 'REMOVE' ? 'Removal' : 'Edit'} *
            </label>
            <textarea
              rows="2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === 'ADD'
                  ? 'e.g. Additional batch received, physical count surplus found'
                  : action === 'REMOVE'
                  ? 'e.g. Damaged unit found in storage, discarded, internal test unit, stock correction'
                  : 'e.g. Annual physical inventory audit reconciliation'
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-hidden text-xs"
              required
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isExcessiveRemoval}
              className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5 ${
                action === 'ADD'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : action === 'REMOVE'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {loading ? (
                <>Updating...</>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {action === 'ADD'
                    ? 'Add to Usable Stock'
                    : action === 'REMOVE'
                    ? 'Deduct / Remove Stock'
                    : 'Confirm New Balance'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
