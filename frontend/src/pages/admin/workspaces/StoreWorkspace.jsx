import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import {
  Package,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  X,
  Plus,
  SlidersHorizontal,
  RefreshCw,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Truck,
  RotateCcw,
  Check,
  Layers,
  ClipboardList,
  HardDrive,
  Eye,
  Info,
  ExternalLink,
  ChevronRight,
  Calendar,
  User,
  DollarSign,
} from 'lucide-react';
import StoreBomManager from '../../../components/bom/StoreBomManager';
import StoreInstallationRequirements from '../../../components/bom/StoreInstallationRequirements';
import IssueMaterialsModal from '../../../components/bom/IssueMaterialsModal';
import {
  fetchInventoryProducts,
  fetchInventorySummary,
  receiveInventoryStock,
  adjustInventoryStock,
  fetchMaterialInventory,
  adjustMaterialStock,
  setMaterialOpeningStockApi,
  setDeviceOpeningStockApi,
  fetchAllMovements,
  fetchAllStoreReturns,
  verifyStoreReturnApi,
  fetchStoreMaterialRequirements,
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
  const { token } = useAuth();

  // 8 Workspace Tabs
  const [activeTab, setActiveTab] = useState('overview');

  // State
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [summary, setSummary] = useState({
    totalUsable: 0,
    totalIssued: 0,
    totalAwaitingReturn: 0,
    totalDamaged: 0,
    lowStockCount: 0,
  });
  const [movements, setMovements] = useState([]);
  const [storeReturns, setStoreReturns] = useState([]);
  const [pendingRequirements, setPendingRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');

  // Movements Filters
  const [movementCategory, setMovementCategory] = useState('All');
  const [movementType, setMovementType] = useState('All');
  const [movementSearch, setMovementSearch] = useState('');

  // Modals
  const [openingDeviceModal, setOpeningDeviceModal] = useState(null); // device object
  const [openingMaterialModal, setOpeningMaterialModal] = useState(null); // material object
  const [receiveModalDevice, setReceiveModalDevice] = useState(null);
  const [adjustDeviceModal, setAdjustDeviceModal] = useState(null);
  const [adjustMaterialModal, setAdjustMaterialModal] = useState(null);
  const [verifyReturnModal, setVerifyReturnModal] = useState(null);
  const [issueModalJob, setIssueModalJob] = useState(null);

  // Form States
  const [modalQty, setModalQty] = useState('');
  const [modalReason, setModalReason] = useState('');
  const [modalAction, setModalAction] = useState('ADD');
  const [modalSupplier, setModalSupplier] = useState('');
  const [modalRef, setModalRef] = useState('');
  const [modalCost, setModalCost] = useState('');
  const [modalDate, setModalDate] = useState(new Date().toISOString().split('T')[0]);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const loadAllData = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    try {
      const [prodData, matData, sumData, movData, returnsData, reqData] = await Promise.all([
        fetchInventoryProducts(token).catch(() => []),
        fetchMaterialInventory(token).catch(() => []),
        fetchInventorySummary(token).catch(() => null),
        fetchAllMovements(token, {
          category: movementCategory,
          type: movementType,
          search: movementSearch,
        }).catch(() => ({ transactions: [] })),
        fetchAllStoreReturns(token).catch(() => []),
        fetchStoreMaterialRequirements(token, { limit: 15, issuance_status: 'PENDING' }).catch(() => ({ requirements: [] })),
      ]);

      setProducts(prodData || []);
      setMaterials(matData || []);
      setMovements(movData.transactions || []);
      setStoreReturns(returnsData || []);
      setPendingRequirements(reqData.requirements || []);

      if (sumData) {
        setSummary(sumData);
      } else {
        let u = 0, i = 0, d = 0;
        (prodData || []).forEach((p) => {
          u += Number(p.usable_stock) || 0;
          i += Number(p.issued_stock) || 0;
          d += Number(p.damaged_stock) || 0;
        });
        setSummary({ totalUsable: u, totalIssued: i, totalDamaged: d, totalAwaitingReturn: 0, lowStockCount: 0 });
      }
    } catch (err) {
      console.error('Failed to load Store Workspace data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, movementCategory, movementType, movementSearch]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Handle Setting Camera Device Opening Stock
  const handleDeviceOpeningSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    const qty = parseInt(modalQty, 10);
    if (isNaN(qty) || qty < 0) {
      setModalError('Opening quantity must be a non-negative whole number (0 or greater).');
      return;
    }
    setSubmittingModal(true);
    try {
      await setDeviceOpeningStockApi(token, {
        device_type: openingDeviceModal.device_type,
        product_id: openingDeviceModal.id,
        opening_quantity: qty,
        reason: modalReason.trim() || `Opening stock set to ${qty} Nos. by Store Manager`,
      });
      showToast(`Opening quantity for ${openingDeviceModal.device_type} set to ${qty} Nos.!`);
      setOpeningDeviceModal(null);
      setModalQty('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to set opening stock');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Handle Setting Material Opening Stock
  const handleMaterialOpeningSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    const qty = parseFloat(modalQty);
    if (isNaN(qty) || qty < 0) {
      setModalError('Opening stock must be a non-negative number (0 or greater).');
      return;
    }
    setSubmittingModal(true);
    try {
      await setMaterialOpeningStockApi(token, {
        material_name: openingMaterialModal.material_name,
        material_id: openingMaterialModal.id,
        opening_stock: qty,
        reason: modalReason.trim() || `Opening stock set to ${qty} ${openingMaterialModal.unit} by Store Manager`,
      });
      showToast(`Opening stock for ${openingMaterialModal.material_name} set to ${qty} ${openingMaterialModal.unit}!`);
      setOpeningMaterialModal(null);
      setModalQty('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to set material opening stock');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Handle Receive Camera Device Stock
  const handleReceiveStockSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    const qty = parseInt(modalQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setModalError('Received quantity must be greater than 0.');
      return;
    }
    setSubmittingModal(true);
    try {
      await receiveInventoryStock(token, {
        device_type: receiveModalDevice.device_type,
        quantity: qty,
        supplier: modalSupplier,
        purchase_ref: modalRef,
        unit_cost: modalCost ? parseFloat(modalCost) : null,
        received_date: modalDate,
        remarks: modalReason,
      });
      showToast(`Received ${qty} units of ${receiveModalDevice.device_type}!`);
      setReceiveModalDevice(null);
      setModalQty('');
      setModalSupplier('');
      setModalRef('');
      setModalCost('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to receive stock');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Handle Adjust Camera Device Stock
  const handleAdjustDeviceSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    const qty = parseInt(modalQty, 10);
    if (isNaN(qty) || qty < 0) {
      setModalError('Quantity must be a valid non-negative whole number.');
      return;
    }
    if (!modalReason.trim()) {
      setModalError('A valid audit reason is required for any stock adjustment.');
      return;
    }
    setSubmittingModal(true);
    try {
      await adjustInventoryStock(token, {
        device_type: adjustDeviceModal.device_type,
        action: modalAction,
        quantity: qty,
        reason: modalReason.trim(),
      });
      showToast(`Adjusted ${adjustDeviceModal.device_type} stock successfully!`);
      setAdjustDeviceModal(null);
      setModalQty('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to adjust stock');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Handle Adjust Material Stock
  const handleAdjustMaterialSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    const qty = parseFloat(modalQty);
    if (isNaN(qty) || qty < 0) {
      setModalError('Quantity must be a valid non-negative number.');
      return;
    }
    if (!modalReason.trim()) {
      setModalError('A valid audit reason is required for any stock adjustment.');
      return;
    }
    setSubmittingModal(true);
    try {
      await adjustMaterialStock(token, {
        material_name: adjustMaterialModal.material_name,
        action: modalAction,
        quantity: qty,
        reason: modalReason.trim(),
      });
      showToast(`Adjusted ${adjustMaterialModal.material_name} stock successfully!`);
      setAdjustMaterialModal(null);
      setModalQty('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to adjust material stock');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Handle Verify Technician Return
  const handleVerifyReturnSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    setSubmittingModal(true);
    try {
      await verifyStoreReturnApi(token, {
        return_id: verifyReturnModal.id,
        accepted_usable_qty: parseInt(modalQty, 10) || 0,
        damaged_qty: parseInt(modalCost, 10) || 0,
        missing_qty: parseInt(modalSupplier, 10) || 0,
        remarks: modalReason.trim(),
      });
      showToast(`Verified physical return for ${verifyReturnModal.checklist?.checklist_number || 'checklist'}!`);
      setVerifyReturnModal(null);
      setModalQty('');
      setModalCost('');
      setModalSupplier('');
      setModalReason('');
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to verify return');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Filter pending returns
  const pendingReturns = storeReturns.filter((r) => r.status === 'PENDING_STORE_VERIFICATION');

  // Low stock items check
  const lowStockDevices = products.filter((p) => Number(p.usable_stock) <= Number(p.min_stock_level || 5));
  const lowStockMaterials = materials.filter((m) => Number(m.current_stock) <= Number(m.min_stock_level || 10));

  // Requirements with shortage
  const shortageJobs = pendingRequirements.filter((r) => r.has_shortage);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
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
            Store & Inventory Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="w-7 h-7 text-amber-400" /> Store Manager Workspace
          </h1>
          <p className="text-xs text-white/80 mt-1 max-w-xl">
            Camera devices and installation materials inventory, BOM configuration, live job shortage tracking, atomic material issuing, and auditable movement logs.
          </p>
        </div>

        <button
          onClick={loadAllData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh All Data</span>
        </button>
      </div>

      {/* 8 Required Tabs Bar */}
      <div className="bg-white p-1.5 rounded-2xl border border-gray-200 shadow-xs flex flex-wrap gap-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'overview' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Stock Overview</span>
        </button>

        <button
          onClick={() => setActiveTab('devices')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'devices' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Camera Devices</span>
          <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-full font-mono">{products.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('materials')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'materials' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Installation Materials</span>
          <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-full font-mono">{materials.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('bom')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'bom' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>BOM Configuration</span>
        </button>

        <button
          onClick={() => setActiveTab('requirements')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'requirements' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Pending Requirements</span>
          {shortageJobs.length > 0 && (
            <span className="text-[10px] bg-rose-500 text-white px-1.5 py-0.2 rounded-full font-bold">
              {shortageJobs.length} short
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('issue')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'issue' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Issue Materials</span>
          <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-full font-mono">{pendingRequirements.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('returns')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'returns' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Device Returns</span>
          {pendingReturns.length > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded-full font-bold">
              {pendingReturns.length} pending
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'movements' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Stock Movements</span>
          <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-full font-mono">{movements.length}</span>
        </button>
      </div>

      {/* ============================================================
          TAB 1: STOCK OVERVIEW
          ============================================================ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Usable Camera Devices</span>
              <span className="text-2xl font-black text-gray-900 mt-1 block">{summary.totalUsable || 0} Nos.</span>
              <span className="text-[10px] text-gray-400 mt-0.5 block">{products.length} models tracked</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Installation Materials</span>
              <span className="text-2xl font-black text-gray-900 mt-1 block">{materials.length} Items</span>
              <span className="text-[10px] text-gray-400 mt-0.5 block">Configurable inventory</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-blue-200 shadow-xs bg-blue-50/20">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Issued to Technicians</span>
              <span className="text-2xl font-black text-blue-900 mt-1 block">{summary.totalIssued || 0} Nos.</span>
              <span className="text-[10px] text-blue-600/70 mt-0.5 block">Dispatched for jobs</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs bg-amber-50/20">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Awaiting Verification</span>
              <span className="text-2xl font-black text-amber-900 mt-1 block">{summary.totalAwaitingReturn || pendingReturns.length} Units</span>
              <span className="text-[10px] text-amber-600/70 mt-0.5 block">Declared returns</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-xs bg-rose-50/30">
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Shortages & Low Stock</span>
              <span className="text-2xl font-black text-rose-900 mt-1 block">{lowStockDevices.length + lowStockMaterials.length + shortageJobs.length}</span>
              <span className="text-[10px] text-rose-600/70 mt-0.5 block">Requires replenishment</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Damaged Devices</span>
              <span className="text-2xl font-black text-gray-900 mt-1 block">{summary.totalDamaged || 0} Nos.</span>
              <span className="text-[10px] text-gray-400 mt-0.5 block">Isolated in scrap stock</span>
            </div>
          </div>

          {/* Alert Banners */}
          {(lowStockDevices.length > 0 || lowStockMaterials.length > 0 || shortageJobs.length > 0) && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Warehouse Inventory Alerts:</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-rose-800">
                {lowStockDevices.length > 0 && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-rose-100">
                    <strong className="block font-bold">Low Stock Camera Devices ({lowStockDevices.length}):</strong>
                    <span className="text-[11px] text-rose-700">
                      {lowStockDevices.map((d) => `${d.device_type} (${d.usable_stock} Nos.)`).join(', ')}
                    </span>
                  </div>
                )}
                {lowStockMaterials.length > 0 && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-rose-100">
                    <strong className="block font-bold">Low Stock Materials ({lowStockMaterials.length}):</strong>
                    <span className="text-[11px] text-rose-700">
                      {lowStockMaterials.map((m) => `${m.material_name} (${m.current_stock} ${m.unit})`).join(', ')}
                    </span>
                  </div>
                )}
                {shortageJobs.length > 0 && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-rose-100">
                    <strong className="block font-bold">Pending Jobs with Shortages ({shortageJobs.length}):</strong>
                    <span className="text-[11px] text-rose-700">
                      {shortageJobs.map((j) => `${j.checklist_number} (${j.client_name})`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Shortcuts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => setActiveTab('devices')}
              className="p-5 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left shadow-xs transition-all flex items-center justify-between group cursor-pointer"
            >
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Manage Models</span>
                <span className="text-sm font-black text-gray-900 mt-1 block">Camera Devices</span>
                <span className="text-xs text-gray-500 mt-0.5 block">Opening stock, inward batches, adjustments</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setActiveTab('materials')}
              className="p-5 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left shadow-xs transition-all flex items-center justify-between group cursor-pointer"
            >
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Consumables</span>
                <span className="text-sm font-black text-gray-900 mt-1 block">Installation Materials</span>
                <span className="text-xs text-gray-500 mt-0.5 block">9 standard items, tape, ties, screws, cables</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setActiveTab('bom')}
              className="p-5 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left shadow-xs transition-all flex items-center justify-between group cursor-pointer"
            >
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Bill of Materials</span>
                <span className="text-sm font-black text-gray-900 mt-1 block">BOM Configuration</span>
                <span className="text-xs text-gray-500 mt-0.5 block">Set required materials per camera device model</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setActiveTab('issue')}
              className="p-5 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left shadow-xs transition-all flex items-center justify-between group cursor-pointer"
            >
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Store Issuance</span>
                <span className="text-sm font-black text-gray-900 mt-1 block">Issue Materials</span>
                <span className="text-xs text-gray-500 mt-0.5 block">Atomic stock deduction with negative guards</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 2: CAMERA DEVICES
          ============================================================ */}
      {activeTab === 'devices' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Camera Device Products ({products.length} Models)</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Configurable inventory entries for all 7 camera device models, tracked separately from installation materials.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Device Model</th>
                  <th className="py-3 px-4">SKU / Product Code</th>
                  <th className="py-3 px-4 text-center">Usable Stock</th>
                  <th className="py-3 px-4 text-center">Opening Stock</th>
                  <th className="py-3 px-4 text-center">Issued Stock</th>
                  <th className="py-3 px-4 text-center">Damaged</th>
                  <th className="py-3 px-4 text-center">Min Level</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((p) => {
                  const usable = Number(p.usable_stock) || 0;
                  const isLow = usable <= Number(p.min_stock_level || 5);

                  return (
                    <tr key={p.id || p.device_type} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-3 px-4 font-bold text-gray-900">
                        {p.device_type}
                        <span className="block text-[11px] text-gray-400 font-normal">{p.device_name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-600 font-semibold">
                        {p.sku || `EE-${p.device_type.replace(/\s+/g, '-').toUpperCase()}`}
                      </td>
                      <td className="py-3 px-4 text-center font-bold font-mono">
                        <span className={`px-2 py-0.5 rounded-md ${isLow ? 'bg-rose-100 text-rose-800 font-black' : 'text-gray-900'}`}>
                          {usable} Nos.
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-mono text-gray-700 block">
                          {p.opening_quantity || 0} Nos.
                        </span>
                        <span className={`text-[10px] font-semibold ${p.opening_stock_set ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {p.opening_stock_set ? '✓ Baseline Set' : 'Pending Entry'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-gray-600">
                        {p.issued_stock || 0} Nos.
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-rose-600 font-bold">
                        {p.damaged_stock || 0} Nos.
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-gray-500">
                        {p.min_stock_level || 5} Nos.
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          Active
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setOpeningDeviceModal(p);
                              setModalQty(p.opening_quantity || '');
                              setModalReason('');
                              setModalError('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
                            title="Set actual opening stock quantity"
                          >
                            Set Opening
                          </button>
                          <button
                            onClick={() => {
                              setReceiveModalDevice(p);
                              setModalQty('');
                              setModalReason('');
                              setModalSupplier('');
                              setModalRef('');
                              setModalCost('');
                              setModalError('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                            title="Receive incoming batch from supplier"
                          >
                            Receive
                          </button>
                          <button
                            onClick={() => {
                              setAdjustDeviceModal(p);
                              setModalQty('');
                              setModalAction('ADD');
                              setModalReason('');
                              setModalError('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors cursor-pointer"
                            title="Adjust quantity with audit reason"
                          >
                            Adjust
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 3: INSTALLATION MATERIALS
          ============================================================ */}
      {activeTab === 'materials' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-600" />
                <span>Installation Materials & Consumables ({materials.length} Items)</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Individual inventory products for installation materials. Opening stock is preserved without duplicate inflation.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Material Name</th>
                  <th className="py-3 px-4">SKU / Code</th>
                  <th className="py-3 px-4 text-center">Unit</th>
                  <th className="py-3 px-4 text-center">Usable Current Stock</th>
                  <th className="py-3 px-4 text-center">Opening Stock</th>
                  <th className="py-3 px-4 text-center">Issued Stock</th>
                  <th className="py-3 px-4 text-center">Min Level</th>
                  <th className="py-3 px-4 text-center">Health</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {materials.map((m) => {
                  const stock = Number(m.current_stock) || 0;
                  const isLow = stock <= Number(m.min_stock_level || 10);

                  return (
                    <tr key={m.id || m.material_name} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-3 px-4 font-bold text-gray-900">
                        {m.material_name}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-600 font-semibold">
                        {m.sku || 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-[11px]">
                          {m.unit}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold font-mono">
                        <span className={`px-2 py-0.5 rounded-md ${isLow ? 'bg-rose-100 text-rose-800 font-black' : 'text-gray-900'}`}>
                          {stock} {m.unit}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-mono text-gray-700 block">
                          {m.opening_stock || 0} {m.unit}
                        </span>
                        <span className="text-[10px] text-emerald-600 font-semibold">
                          ✓ Business Baseline
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-gray-600">
                        {m.issued_stock || 0} {m.unit}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-gray-500">
                        {m.min_stock_level || 10} {m.unit}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isLow ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                            Low Stock
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            Adequate
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setOpeningMaterialModal(m);
                              setModalQty(m.opening_stock || '');
                              setModalReason('');
                              setModalError('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
                            title="Set explicit opening stock"
                          >
                            Set Opening
                          </button>
                          <button
                            onClick={() => {
                              setAdjustMaterialModal(m);
                              setModalQty('');
                              setModalAction('ADD');
                              setModalReason('');
                              setModalError('');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                            title="Add / Remove / Set quantity"
                          >
                            Adjust Stock
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 4: BOM CONFIGURATION
          ============================================================ */}
      {activeTab === 'bom' && (
        <StoreBomManager token={token} onSelectChecklist={onSelectChecklist} />
      )}

      {/* ============================================================
          TAB 5: PENDING MATERIAL REQUIREMENTS
          ============================================================ */}
      {activeTab === 'requirements' && (
        <StoreInstallationRequirements token={token} onSelectChecklist={onSelectChecklist} />
      )}

      {/* ============================================================
          TAB 6: ISSUE MATERIALS (DEDICATED ISSUANCE STATION)
          ============================================================ */}
      {activeTab === 'issue' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-amber-600" />
                <span>Store Issuance Station</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Authorized Store Manager can issue camera devices and installation materials. Negative stock is strictly prevented.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingRequirements.map((job) => (
              <div
                key={job.id || job.checklist_id}
                className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-3 hover:border-amber-300 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs font-black text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {job.checklist_number}
                    </span>
                    <h3 className="text-sm font-bold text-gray-900 mt-1">{job.client_name}</h3>
                    <p className="text-xs text-gray-500">{job.client_location || 'Location not specified'}</p>
                  </div>
                  {job.has_shortage ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Shortage Flagged
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Stock In Store
                    </span>
                  )}
                </div>

                <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Camera Devices:</span>
                    <span className="font-semibold text-gray-900">{job.device_type} ({job.number_of_devices} Nos.)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Materials:</span>
                    <span className="font-semibold text-gray-900">{job.material_items?.length || 0} BOM items</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setIssueModalJob(job)}
                    className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Inspect & Issue Stock</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 7: DEVICE RETURNS
          ============================================================ */}
      {activeTab === 'returns' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                <span>Physical Return Verification</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Technician declared returns must be verified by Store Manager. Usable stock is credited only upon verification; damaged units are routed to scrap stock.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Job Reference</th>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">Device Model</th>
                  <th className="py-3 px-4 text-center">Declared Qty</th>
                  <th className="py-3 px-4 text-center">Accepted Usable</th>
                  <th className="py-3 px-4 text-center">Damaged</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {storeReturns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-400">
                      No device returns recorded.
                    </td>
                  </tr>
                ) : (
                  storeReturns.map((r) => (
                    <tr key={r.id} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-amber-800">
                        {r.checklist?.checklist_number || 'N/A'}
                        <span className="block text-[11px] text-gray-500 font-sans font-normal">{r.checklist?.client_name}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-700">
                        {r.technician?.full_name || r.technician?.email || 'Technician'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-gray-900">{r.device_type}</td>
                      <td className="py-3 px-4 text-center font-bold font-mono">{r.declared_return_qty} Nos.</td>
                      <td className="py-3 px-4 text-center font-bold font-mono text-emerald-700">
                        {r.accepted_usable_qty !== null ? `${r.accepted_usable_qty} Nos.` : '—'}
                      </td>
                      <td className="py-3 px-4 text-center font-bold font-mono text-rose-600">
                        {r.damaged_qty !== null ? `${r.damaged_qty} Nos.` : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          r.status === 'VERIFIED_ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {r.status === 'VERIFIED_ACCEPTED' ? 'Verified & Credited' : 'Awaiting Store Verification'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {r.status === 'PENDING_STORE_VERIFICATION' ? (
                          <button
                            onClick={() => {
                              setVerifyReturnModal(r);
                              setModalQty(r.declared_return_qty || '');
                              setModalCost('0');
                              setModalSupplier('0');
                              setModalReason('');
                              setModalError('');
                            }}
                            className="px-3 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs cursor-pointer"
                          >
                            Verify Return
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">Completed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 8: STOCK MOVEMENTS (UNIFIED AUDITABLE LEDGER)
          ============================================================ */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search movements by item name, SKU, remarks..."
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={movementCategory}
                onChange={(e) => setMovementCategory(e.target.value)}
                className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800"
              >
                <option value="All">All Categories (Devices & Materials)</option>
                <option value="Devices">Camera Devices Only</option>
                <option value="Materials">Installation Materials Only</option>
              </select>

              <select
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
                className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800"
              >
                <option value="All">All Transaction Types</option>
                <option value="OPENING_STOCK">Opening Stock</option>
                <option value="STOCK_RECEIVED">Stock Received</option>
                <option value="STOCK_ISSUED">Stock Issued</option>
                <option value="STOCK_ADJUSTMENT">Stock Adjustment</option>
                <option value="USABLE_STOCK_RETURNED">Usable Return</option>
                <option value="DAMAGED_STOCK_RECEIVED">Damaged Return</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Item Name & SKU</th>
                  <th className="py-3 px-4 text-center">Type</th>
                  <th className="py-3 px-4 text-center">Movement Qty</th>
                  <th className="py-3 px-4 text-center">Balance Transition</th>
                  <th className="py-3 px-4">Performed By</th>
                  <th className="py-3 px-4 min-w-[200px]">Reason / Audit Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-400">
                      No stock movement records match the current filter.
                    </td>
                  </tr>
                ) : (
                  movements.map((t) => (
                    <tr key={t.id} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                        {new Date(t.created_at).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          t.category === 'Camera Device' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {t.category || (t.device_type ? 'Camera Device' : 'Material')}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-gray-900">
                        {t.item_name || t.device_name || t.device_type || t.material_name}
                        {t.sku && <span className="block font-mono text-[10px] text-gray-400 font-normal">{t.sku}</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800">
                          {t.transaction_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold font-mono">
                        {t.quantity} {t.unit || 'Nos.'}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[11px]">
                        {t.previous_balance !== null && t.previous_balance !== undefined && t.new_balance !== null && t.new_balance !== undefined ? (
                          <span className="text-gray-700 font-semibold">
                            {t.previous_balance} → <strong className="text-gray-900">{t.new_balance}</strong>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-700">
                        {t.performer_name || 'Store Manager'}
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-[11px]">
                        {t.reason_or_remarks || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          MODALS
          ============================================================ */}

      {/* 1. Device Opening Stock Modal */}
      {openingDeviceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Set Opening Quantity: {openingDeviceModal.device_type}</span>
              </h3>
              <button onClick={() => setOpeningDeviceModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleDeviceOpeningSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Opening Stock Quantity (Nos.)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Opening stock is not assumed. Enter the verified count on warehouse shelf.
                </span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Audit Reason / Verification Note</label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Initial store audit by Store Manager"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpeningDeviceModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Saving...' : 'Confirm Opening Quantity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Material Opening Stock Modal */}
      {openingMaterialModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-600" />
                <span>Set Opening Stock: {openingMaterialModal.material_name}</span>
              </h3>
              <button onClick={() => setOpeningMaterialModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleMaterialOpeningSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Opening Stock Quantity ({openingMaterialModal.unit})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Audit Reason</label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Opening stock confirmed"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpeningMaterialModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Saving...' : 'Set Opening Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Receive Camera Device Modal */}
      {receiveModalDevice && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>Receive Incoming Stock: {receiveModalDevice.device_type}</span>
              </h3>
              <button onClick={() => setReceiveModalDevice(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleReceiveStockSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Quantity Received (Nos.) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Supplier / Vendor Name</label>
                <input
                  type="text"
                  value={modalSupplier}
                  onChange={(e) => setModalSupplier(e.target.value)}
                  placeholder="e.g. EagleEye Systems HQ"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Invoice / PO Reference</label>
                <input
                  type="text"
                  value={modalRef}
                  onChange={(e) => setModalRef(e.target.value)}
                  placeholder="e.g. PO-2026-088"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Unit Cost (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={modalCost}
                    onChange={(e) => setModalCost(e.target.value)}
                    placeholder="Optional"
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Received Date</label>
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="Batch inspection notes"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReceiveModalDevice(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Recording...' : 'Record Received Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Adjust Camera Device Modal */}
      {adjustDeviceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-amber-600" />
                <span>Adjust Stock: {adjustDeviceModal.device_type}</span>
              </h3>
              <button onClick={() => setAdjustDeviceModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAdjustDeviceSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Adjustment Action</label>
                <div className="grid grid-cols-3 gap-2">
                  {['ADD', 'REMOVE', 'SET'].map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setModalAction(act)}
                      className={`py-2 rounded-xl font-bold border transition-all ${
                        modalAction === act
                          ? 'bg-amber-600 text-white border-amber-700'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Quantity (Nos.) *</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Mandatory Audit Reason *</label>
                <input
                  type="text"
                  required
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Physical inventory count discrepancy correction"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustDeviceModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Adjusting...' : 'Confirm Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Adjust Material Modal */}
      {adjustMaterialModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-600" />
                <span>Adjust Material: {adjustMaterialModal.material_name}</span>
              </h3>
              <button onClick={() => setAdjustMaterialModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAdjustMaterialSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Action</label>
                <div className="grid grid-cols-3 gap-2">
                  {['ADD', 'REMOVE', 'SET'].map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setModalAction(act)}
                      className={`py-2 rounded-xl font-bold border transition-all ${
                        modalAction === act
                          ? 'bg-amber-600 text-white border-amber-700'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Quantity ({adjustMaterialModal.unit}) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Mandatory Audit Reason *</label>
                <input
                  type="text"
                  required
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Stock replenishment received / physical recount"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustMaterialModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Adjusting...' : 'Confirm Material Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Verify Return Modal */}
      {verifyReturnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Verify Return: {verifyReturnModal.device_type}</span>
              </h3>
              <button onClick={() => setVerifyReturnModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleVerifyReturnSubmit} className="space-y-3 text-xs">
              <div className="p-3 bg-gray-50 rounded-xl text-gray-600">
                Declared Return Qty: <strong>{verifyReturnModal.declared_return_qty} Nos.</strong>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Accepted Usable Quantity (Nos.) *</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Credited to usable stock</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Damaged Quantity (Nos.)</label>
                <input
                  type="number"
                  min="0"
                  value={modalCost}
                  onChange={(e) => setModalCost(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Routed to damaged/scrap inventory</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Inspection Remarks</label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Serial checked, tested operational"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVerifyReturnModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs"
                >
                  {submittingModal ? 'Verifying...' : 'Verify & Credit Usable Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Issue Stock Modal */}
      {issueModalJob && (
        <IssueMaterialsModal
          checklist={issueModalJob}
          token={token}
          onClose={() => setIssueModalJob(null)}
          onSuccess={() => {
            setIssueModalJob(null);
            showToast(`Stock successfully issued for ${issueModalJob.checklist_number}!`);
            loadAllData();
          }}
        />
      )}
    </div>
  );
}
