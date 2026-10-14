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
  createDeviceProductApi,
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

  // Manage Stock Modal State (Unified Simplified Stock Management)
  const [manageStockItem, setManageStockItem] = useState(null); // { type: 'DEVICE' | 'MATERIAL', name, unit, currentStock, rawItem }
  const [manageStockAction, setManageStockAction] = useState('ADD'); // 'ADD' | 'REMOVE'
  const [manageStockQty, setManageStockQty] = useState('');
  const [manageStockReason, setManageStockReason] = useState('');
  const [manageStockSubmitting, setManageStockSubmitting] = useState(false);
  const [manageStockError, setManageStockError] = useState('');

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

  // Add New Device Model State
  const [addDeviceModalOpen, setAddDeviceModalOpen] = useState(false);
  const [newDeviceForm, setNewDeviceForm] = useState({
    device_type: '',
    device_name: '',
    sku: '',
    opening_quantity: '',
    min_stock_level: '5',
  });

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

  // Handle Adding New Camera Device Model
  const handleAddDeviceSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newDeviceForm.device_type.trim()) {
      setModalError('Device Model / Type name is required.');
      return;
    }
    const openingQty = newDeviceForm.opening_quantity ? parseInt(newDeviceForm.opening_quantity, 10) : 0;
    if (isNaN(openingQty) || openingQty < 0) {
      setModalError('Opening quantity must be a non-negative number (0 or greater).');
      return;
    }
    const minLevel = newDeviceForm.min_stock_level ? parseInt(newDeviceForm.min_stock_level, 10) : 5;
    if (isNaN(minLevel) || minLevel < 0) {
      setModalError('Minimum stock level must be 0 or greater.');
      return;
    }

    setSubmittingModal(true);
    try {
      await createDeviceProductApi(token, {
        device_type: newDeviceForm.device_type.trim(),
        device_name: newDeviceForm.device_name.trim() || `${newDeviceForm.device_type.trim()} Camera System`,
        sku: newDeviceForm.sku.trim() || undefined,
        opening_quantity: openingQty,
        min_stock_level: minLevel,
      });
      showToast(`Device "${newDeviceForm.device_type.trim()}" added successfully!`);
      setAddDeviceModalOpen(false);
      setNewDeviceForm({
        device_type: '',
        device_name: '',
        sku: '',
        opening_quantity: '',
        min_stock_level: '5',
      });
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Failed to add device product');
    } finally {
      setSubmittingModal(false);
    }
  };

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

  // Open Simplified Manage Stock Modal (Camera Devices & Installation Materials)
  const openManageStockModal = (item, type) => {
    const isDevice = type === 'DEVICE';
    const name = isDevice ? item.device_type : item.material_name;
    const unit = isDevice ? 'Nos.' : (item.unit || 'Nos.');
    const currentStock = Number(isDevice ? item.usable_stock : item.current_stock) || 0;

    setManageStockItem({
      type,
      name,
      unit,
      currentStock,
      rawItem: item,
    });
    setManageStockAction('ADD');
    setManageStockQty('');
    setManageStockReason('');
    setManageStockError('');
  };

  // Handle Simplified Stock Adjustment (Add Stock or Remove Stock)
  const handleManageStockSubmit = async (e) => {
    e.preventDefault();
    if (!manageStockItem || manageStockSubmitting) return;
    setManageStockError('');

    const isDevice = manageStockItem.type === 'DEVICE';
    const qty = isDevice ? parseInt(manageStockQty, 10) : parseFloat(manageStockQty);

    if (isNaN(qty) || qty <= 0) {
      setManageStockError('Quantity must be a positive number greater than 0.');
      return;
    }

    if (isDevice && !Number.isInteger(qty)) {
      setManageStockError('Quantity for camera devices must be a whole number.');
      return;
    }

    if (manageStockAction === 'REMOVE' && qty > manageStockItem.currentStock) {
      setManageStockError(
        `Cannot remove ${qty} ${manageStockItem.unit}. Current stock is only ${manageStockItem.currentStock} ${manageStockItem.unit}. Stock cannot become negative.`
      );
      return;
    }

    if (!manageStockReason.trim()) {
      setManageStockError('A reason or note is required for manual stock adjustments.');
      return;
    }

    setManageStockSubmitting(true);
    try {
      if (isDevice) {
        await adjustInventoryStock(token, {
          device_type: manageStockItem.name,
          action: manageStockAction, // 'ADD' or 'REMOVE'
          quantity: qty,
          reason: manageStockReason.trim(),
        });
      } else {
        await adjustMaterialStock(token, {
          material_name: manageStockItem.name,
          action: manageStockAction, // 'ADD' or 'REMOVE'
          quantity: qty,
          reason: manageStockReason.trim(),
        });
      }

      const actionText = manageStockAction === 'ADD' ? 'added to' : 'removed from';
      showToast(`Stock updated: ${qty} ${manageStockItem.unit} ${actionText} ${manageStockItem.name}.`);
      setManageStockItem(null);
      setManageStockQty('');
      setManageStockReason('');

      // Refresh displayed stock immediately
      await loadAllData();
    } catch (err) {
      console.error('Failed to adjust stock:', err);
      setManageStockError(err.message || 'Failed to update stock. Please try again.');
    } finally {
      setManageStockSubmitting(false);
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

  // Handle Verify Technician Return (Devices & Materials)
  const handleVerifyReturnSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    setSubmittingModal(true);
    try {
      await verifyStoreReturnApi(token, {
        return_id: verifyReturnModal.id,
        return_category: verifyReturnModal.return_category,
        is_material: verifyReturnModal.return_category === 'MATERIAL',
        accepted_usable_qty: parseFloat(modalQty) || 0,
        damaged_qty: parseFloat(modalCost) || 0,
        missing_qty: parseFloat(modalSupplier) || 0,
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
          <span>Incoming Jobs & Material Requirements</span>
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
                Configurable inventory entries for all camera device models, tracked separately from installation materials.
              </p>
            </div>
            <button
              onClick={() => {
                setModalError('');
                setNewDeviceForm({
                  device_type: '',
                  device_name: '',
                  sku: '',
                  opening_quantity: '',
                  min_stock_level: '5',
                });
                setAddDeviceModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Add Device</span>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Item</th>
                    <th className="py-3.5 px-6 text-center">Stock Remaining</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-gray-400">
                        No camera devices found.
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => {
                      const usable = Number(p.usable_stock) || 0;
                      return (
                        <tr key={p.id || p.device_type} className="hover:bg-amber-50/20 transition-colors">
                          <td className="py-3.5 px-6 font-bold text-gray-900 text-xs sm:text-sm">
                            {p.device_type}
                          </td>
                          <td className="py-3.5 px-6 text-center font-bold font-mono text-xs sm:text-sm text-gray-900">
                            {usable} Nos.
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <button
                              onClick={() => openManageStockModal(p, 'DEVICE')}
                              className="px-3.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                              <span>Manage Stock</span>
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

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Item</th>
                    <th className="py-3.5 px-6 text-center">Stock Remaining</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-gray-400">
                        No installation materials found.
                      </td>
                    </tr>
                  ) : (
                    materials.map((m) => {
                      const stock = Number(m.current_stock) || 0;
                      return (
                        <tr key={m.id || m.material_name} className="hover:bg-amber-50/20 transition-colors">
                          <td className="py-3.5 px-6 font-bold text-gray-900 text-xs sm:text-sm">
                            {m.material_name}
                          </td>
                          <td className="py-3.5 px-6 text-center font-bold font-mono text-xs sm:text-sm text-gray-900">
                            {stock} {m.unit || 'Nos.'}
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <button
                              onClick={() => openManageStockModal(m, 'MATERIAL')}
                              className="px-3.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                              <span>Manage Stock</span>
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
      )}

      {/* ============================================================
          TAB 4: BOM CONFIGURATION
          ============================================================ */}
      {activeTab === 'bom' && (
        <StoreBomManager token={token} onSelectChecklist={onSelectChecklist} />
      )}

      {/* ============================================================
          TAB 5: INCOMING INSTALLATION JOBS & MATERIAL REQUIREMENTS
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
                <span>Physical Return Verification (Devices &amp; Materials)</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Technician declared returns must be verified by Store Manager. Usable stock is credited only upon verification; damaged units/materials are routed to scrap stock. Missing items are logged as discrepancies.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Job Reference</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">Item / Model</th>
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
                    <td colSpan={9} className="py-8 text-center text-gray-400">
                      No device or material returns recorded.
                    </td>
                  </tr>
                ) : (
                  storeReturns.map((r) => {
                    const isMat = r.return_category === 'MATERIAL';
                    const unitStr = r.unit || 'Nos.';
                    return (
                      <tr key={r.id} className="hover:bg-amber-50/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-amber-800">
                          {r.checklist?.checklist_number || 'N/A'}
                          <span className="block text-[11px] text-gray-500 font-sans font-normal">{r.checklist?.client_name}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isMat ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {isMat ? 'Material' : 'Device'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {r.technician?.full_name || r.technician?.email || 'Technician'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-900">
                          {r.material_name || r.device_type}
                        </td>
                        <td className="py-3 px-4 text-center font-bold font-mono">{r.declared_return_qty} {unitStr}</td>
                        <td className="py-3 px-4 text-center font-bold font-mono text-emerald-700">
                          {r.accepted_usable_qty !== null ? `${r.accepted_usable_qty} ${unitStr}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-center font-bold font-mono text-rose-600">
                          {r.damaged_qty !== null ? `${r.damaged_qty} ${unitStr}` : '—'}
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
                    );
                  })
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

      {/* Add New Camera Device Model Modal */}
      {addDeviceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Add Camera Device Model</span>
              </h3>
              <button
                onClick={() => setAddDeviceModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-medium">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAddDeviceSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Device Model / Type Name *
                </label>
                <input
                  type="text"
                  required
                  value={newDeviceForm.device_type}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewDeviceForm((prev) => ({
                      ...prev,
                      device_type: val,
                      sku: prev.sku || (val ? `EE-${val.replace(/[^a-zA-Z0-9]+/g, '-').toUpperCase()}` : ''),
                    }));
                  }}
                  placeholder="e.g. 12 Channel Live or Dashcam Pro"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Display / Product Title
                </label>
                <input
                  type="text"
                  value={newDeviceForm.device_name}
                  onChange={(e) =>
                    setNewDeviceForm((prev) => ({ ...prev, device_name: e.target.value }))
                  }
                  placeholder="e.g. 12 Channel Live Enterprise MDVR"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  SKU / Product Code (Auto-generated if blank)
                </label>
                <input
                  type="text"
                  value={newDeviceForm.sku}
                  onChange={(e) =>
                    setNewDeviceForm((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))
                  }
                  placeholder="e.g. EE-12CH-LIVE"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-mono text-[11px] focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Opening Stock (Nos.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newDeviceForm.opening_quantity}
                    onChange={(e) =>
                      setNewDeviceForm((prev) => ({ ...prev, opening_quantity: e.target.value }))
                    }
                    placeholder="0"
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Min Stock Alert Level
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newDeviceForm.min_stock_level}
                    onChange={(e) =>
                      setNewDeviceForm((prev) => ({ ...prev, min_stock_level: e.target.value }))
                    }
                    placeholder="5"
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <p className="text-[11px] text-gray-500 italic">
                Device details and stock balances are saved permanently and will not be lost across server restarts.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setAddDeviceModalOpen(false)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors"
                >
                  {submittingModal ? 'Saving Device...' : 'Save Device Model'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Stock Modal (Camera Devices & Installation Materials) */}
      {manageStockItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-amber-600" />
                <span>Manage Stock</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!manageStockSubmitting) setManageStockItem(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Item & Current Stock Card */}
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block">
                {manageStockItem.type === 'DEVICE' ? 'Camera Device Model' : 'Installation Material'}
              </span>
              <div className="flex items-center justify-between">
                <span className="font-black text-gray-900 text-sm">{manageStockItem.name}</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 text-blue-800 font-mono">
                  Current: {manageStockItem.currentStock} {manageStockItem.unit}
                </span>
              </div>
            </div>

            {manageStockError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs flex items-start gap-2 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{manageStockError}</span>
              </div>
            )}

            <form onSubmit={handleManageStockSubmit} className="space-y-4 text-xs">
              {/* Action Segmented Toggle: Add Stock vs Remove Stock */}
              <div>
                <label className="block font-bold text-gray-700 mb-1.5">Action *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setManageStockAction('ADD');
                      setManageStockError('');
                    }}
                    className={`py-2 px-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      manageStockAction === 'ADD'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Stock</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManageStockAction('REMOVE');
                      setManageStockError('');
                    }}
                    className={`py-2 px-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      manageStockAction === 'REMOVE'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base font-black leading-none">−</span>
                    <span>Remove Stock</span>
                  </button>
                </div>
              </div>

              {/* Quantity Input */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Quantity ({manageStockItem.unit}) *
                </label>
                <input
                  type="number"
                  min="1"
                  step={manageStockItem.type === 'DEVICE' ? '1' : 'any'}
                  required
                  value={manageStockQty}
                  onChange={(e) => {
                    setManageStockQty(e.target.value);
                    setManageStockError('');
                  }}
                  placeholder="Enter quantity greater than 0"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                {/* Projected Stock Preview */}
                {(() => {
                  const parsed = parseFloat(manageStockQty);
                  if (!isNaN(parsed) && parsed > 0) {
                    const projected =
                      manageStockAction === 'ADD'
                        ? manageStockItem.currentStock + parsed
                        : manageStockItem.currentStock - parsed;
                    const isNegative = projected < 0;
                    return (
                      <p
                        className={`text-[11px] mt-1 font-medium ${
                          isNegative ? 'text-rose-600 font-bold' : 'text-gray-500'
                        }`}
                      >
                        Projected stock remaining:{' '}
                        <strong className={isNegative ? 'text-rose-700 font-black' : 'text-gray-900 font-mono'}>
                          {projected} {manageStockItem.unit}
                        </strong>
                        {isNegative && ' (Negative stock is strictly prevented)'}
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Reason / Notes */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Reason / Notes *
                </label>
                <textarea
                  rows={2}
                  required
                  value={manageStockReason}
                  onChange={(e) => {
                    setManageStockReason(e.target.value);
                    setManageStockError('');
                  }}
                  placeholder="e.g. Physical inventory adjustment, Supplier delivery batch, Damaged write-off"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 resize-none font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  disabled={manageStockSubmitting}
                  onClick={() => setManageStockItem(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manageStockSubmitting}
                  className={`px-5 py-2 font-bold text-white rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                    manageStockAction === 'ADD'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {manageStockSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Stock</span>
                  )}
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
                <span>Verify Return: {verifyReturnModal.material_name || verifyReturnModal.device_type}</span>
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
                Declared Return Qty: <strong>{verifyReturnModal.declared_return_qty} {verifyReturnModal.unit || 'Nos.'}</strong>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Accepted Usable Quantity ({verifyReturnModal.unit || 'Nos.'}) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Physically verified and credited back to usable warehouse stock</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Damaged Quantity ({verifyReturnModal.unit || 'Nos.'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={modalCost}
                  onChange={(e) => setModalCost(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Recorded in damaged stock ledger (not added to usable inventory)</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Missing / Unreturned Quantity ({verifyReturnModal.unit || 'Nos.'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={modalSupplier}
                  onChange={(e) => setModalSupplier(e.target.value)}
                  placeholder="0"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Never added to stock; logged as audit discrepancy</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Inspection Remarks</label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="e.g. Serial checked, tested operational on test bench"
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
