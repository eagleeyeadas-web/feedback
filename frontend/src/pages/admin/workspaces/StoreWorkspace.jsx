import React, { useState, useEffect, useCallback } from 'react';
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
  Trash2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
} from 'lucide-react';
import StoreBomManager from '../../../components/bom/StoreBomManager';
import StoreInstallationRequirements from '../../../components/bom/StoreInstallationRequirements';
import IssueMaterialsModal from '../../../components/bom/IssueMaterialsModal';
import WeeklyStockReportTab from './WeeklyStockReportTab';
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
  triggerInventoryCleanupApi,
  fetchInventoryCleanupStatusApi,
  fetchStoreMaterialRequirements,
  createDeviceProductApi,
  deleteStockMovementApi,
  clearStockMovementsHistoryApi,
  deleteStoreReturnApi,
  clearStoreReturnsHistoryApi,
  fetchDeviceAllocationsApi,
} from '../../../lib/api';
import { isScrewMaterial } from '../../../lib/productHelpers';

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
  const { token, user, profile } = useAuth();

  // 10 Workspace Tabs
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

  // Movements Filters & Pagination
  const [movementCategory, setMovementCategory] = useState('All');
  const [movementType, setMovementType] = useState('All');
  const [movementSearch, setMovementSearch] = useState('');
  const [movementPage, setMovementPage] = useState(1);
  const [movementTotalPages, setMovementTotalPages] = useState(1);
  const [movementTotalCount, setMovementTotalCount] = useState(0);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState(null);

  // Delete History States (Movements & Returns)
  const [showDeleteMovementsModal, setShowDeleteMovementsModal] = useState(false);
  const [deletingMovements, setDeletingMovements] = useState(false);
  const [deleteMovementsScope, setDeleteMovementsScope] = useState('ALL'); // 'ALL' | 'FILTERED'
  const [singleDeleteMovement, setSingleDeleteMovement] = useState(null);
  const [deletingSingleMovement, setDeletingSingleMovement] = useState(false);
  const [singleDeleteError, setSingleDeleteError] = useState('');
  const [remarksModalMovement, setRemarksModalMovement] = useState(null);

  const [showDeleteReturnsModal, setShowDeleteReturnsModal] = useState(false);
  const [deletingReturns, setDeletingReturns] = useState(false);
  const [deleteReturnsScope, setDeleteReturnsScope] = useState('ALL'); // 'ALL' | 'VERIFIED_ONLY'

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
  const [addDeviceModalOpen, setAddDeviceModalOpen] = useState(false);
  const [newDeviceForm, setNewDeviceForm] = useState({
    device_type: '',
    device_name: '',
    sku: '',
    opening_quantity: '',
    min_stock_level: '5',
  });

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

  // Active Stock Allocations for tracking legitimate reservations
  const [allocations, setAllocations] = useState([]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const loadAllData = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    try {
      const [prodData, matData, sumData, movData, returnsData, reqData, allocData] = await Promise.all([
        fetchInventoryProducts(token).catch(() => []),
        fetchMaterialInventory(token).catch(() => []),
        fetchInventorySummary(token).catch(() => null),
        fetchAllMovements(token, {
          category: movementCategory,
          type: movementType,
          search: movementSearch,
          page: movementPage,
          limit: 50,
        }).catch(() => ({ transactions: [], totalCount: 0, totalPages: 1 })),
        fetchAllStoreReturns(token).catch(() => []),
        fetchStoreMaterialRequirements(token, { limit: 15, issuance_status: 'PENDING' }).catch(() => ({ requirements: [] })),
        fetchDeviceAllocationsApi(token).catch(() => []),
      ]);

      setProducts(prodData || []);
      setMaterials(matData || []);
      setMovements(movData.transactions || []);
      setMovementTotalCount(movData.totalCount !== undefined ? movData.totalCount : (movData.transactions?.length || 0));
      setMovementTotalPages(movData.totalPages || 1);
      const rawPending = reqData.requirements || [];
      const cleanPending = rawPending.filter((job) => {
        const isCourier = job.delivery_method === 'Product Couriered' || job.is_courier || job.job_type === 'Courier';
        const isFullyIssued = job.stock_issuance_status === 'Completed' ||
          job.is_issued === true ||
          job.status === 'ISSUED';
        if (isFullyIssued) return false;
        if (isCourier) {
          const isCourierIssued =
            job.material_issuance_status === 'ISSUED' ||
            job.devices_issuance_status === 'ISSUED' ||
            job.courier_dispatch_status === 'ISSUED' ||
            Boolean(job.is_courier_dispatched);
          return !isCourierIssued;
        }
        return job.material_issuance_status !== 'ISSUED' || job.devices_issuance_status !== 'ISSUED';
      });
      setPendingRequirements(cleanPending);
      setAllocations(allocData || []);

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

      // Fetch 60-day retention cleanup status for Store Manager observability
      fetchInventoryCleanupStatusApi(token)
        .then((st) => setCleanupStatus(st))
        .catch(() => null);
    } catch (err) {
      console.error('Failed to load Store Workspace data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, movementCategory, movementType, movementSearch, movementPage]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    const handleInventoryChange = () => {
      loadAllData();
    };
    window.addEventListener('inventory-updated', handleInventoryChange);
    return () => window.removeEventListener('inventory-updated', handleInventoryChange);
  }, [loadAllData]);

  // Handle Manual 60-Day Retention Cleanup Trigger
  const handleTriggerCleanup = async () => {
    if (!token || cleanupRunning) return;
    setCleanupRunning(true);
    try {
      const res = await triggerInventoryCleanupApi(token);
      showToast(
        `60-day cleanup completed! Deleted ${res.movements_deleted || 0} old movements, ${res.device_returns_deleted || 0} device returns, ${res.material_returns_deleted || 0} material returns.`
      );
      fetchInventoryCleanupStatusApi(token).then((st) => setCleanupStatus(st)).catch(() => null);
      loadAllData();
    } catch (err) {
      showToast(`Cleanup notice: ${err.message}`);
    } finally {
      setCleanupRunning(false);
    }
  };

  // Format Movement Type helper for clean UI badges
  const formatMovementType = (type) => {
    if (!type) return 'Movement';
    switch (type) {
      case 'OPENING_STOCK': return 'Opening Stock';
      case 'STOCK_RECEIVED': return 'Stock Received';
      case 'STOCK_ISSUED': return 'Stock Issued';
      case 'COURIER_DISPATCHED': return 'Courier Dispatched';
      case 'STOCK_ADJUSTMENT': return 'Stock Adjustment';
      case 'STOCK_REVERSAL': return 'Stock Reversal';
      case 'USABLE_STOCK_RETURNED':
      case 'RETURNED_USABLE': return 'Usable Return';
      case 'DAMAGED_STOCK_RECEIVED':
      case 'RETURNED_DAMAGED': return 'Damaged Return';
      case 'DAMAGED_STOCK_DISPOSITION': return 'Damaged Disposition';
      default: return type.replace(/_/g, ' ');
    }
  };

  // Handle Delete / Clear Stock Movement History
  const handleDeleteAllMovements = async (scope = deleteMovementsScope) => {
    if (!token || deletingMovements) return;
    setDeletingMovements(true);
    try {
      const params = scope === 'FILTERED'
        ? { category: movementCategory, type: movementType }
        : { category: 'All', type: 'All' };
      const res = await clearStockMovementsHistoryApi(token, params);
      showToast(res.message || `Cleaned ${res.deletedCount || 0} eligible test records. Preserved ${res.protectedCount || 0} genuine transactions.`);
      setShowDeleteMovementsModal(false);
      await loadAllData();
    } catch (err) {
      showToast(err.message || 'Failed to clean movement history');
    } finally {
      setDeletingMovements(false);
    }
  };

  const handleOpenSingleDeleteModal = (movement) => {
    setSingleDeleteError('');
    setSingleDeleteMovement(movement);
  };

  const handleConfirmSingleDelete = async () => {
    if (!token || !singleDeleteMovement || deletingSingleMovement) return;
    setDeletingSingleMovement(true);
    setSingleDeleteError('');
    try {
      const res = await deleteStockMovementApi(token, singleDeleteMovement.id);
      showToast(res.message || 'Stock movement record deleted from history');
      setSingleDeleteMovement(null);
      await loadAllData();
    } catch (err) {
      setSingleDeleteError(err.message || 'Failed to delete movement record');
    } finally {
      setDeletingSingleMovement(false);
    }
  };

  // Handle Delete / Clear Return History
  const handleDeleteAllReturns = async (statusScope = deleteReturnsScope) => {
    if (!token || deletingReturns) return;
    setDeletingReturns(true);
    try {
      const res = await clearStoreReturnsHistoryApi(token, { status: statusScope });
      showToast(res.message || 'Return history records deleted successfully!');
      setShowDeleteReturnsModal(false);
      await loadAllData();
    } catch (err) {
      showToast(err.message || 'Failed to delete return records');
    } finally {
      setDeletingReturns(false);
    }
  };

  const handleDeleteSingleReturn = async (id) => {
    if (!token || !id) return;
    if (!window.confirm('Are you sure you want to delete this return record from history?')) return;
    try {
      await deleteStoreReturnApi(token, id);
      showToast('Return record deleted from history');
      setStoreReturns((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      showToast(err.message || 'Failed to delete return record');
    }
  };

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

  // Filter pending returns (screws excluded from return verification)
  const pendingReturns = storeReturns
    .filter((r) => !isScrewMaterial(r.material_name || r.device_type))
    .filter((r) => r.status === 'PENDING_STORE_VERIFICATION');

  // Low stock items check
  const lowStockDevices = products.filter((p) => Number(p.usable_stock) <= Number(p.min_stock_level || 5));
  const lowStockMaterials = materials.filter((m) => Number(m.current_stock) <= Number(m.min_stock_level || 10));

  // Requirements with shortage
  const shortageJobs = pendingRequirements.filter((r) => r.has_shortage);

  // Physical Loose Camera & Display Products Specification
  const LOOSE_CAMERA_ITEMS = [
    { name: 'Camera', sku: 'MAT-CAM-LOOSE', defaultUnit: 'Nos.', description: 'Loose physical cameras for customer vehicle installations' },
    { name: 'Live Display', sku: 'MAT-DISP-LIVE', defaultUnit: 'Nos.', description: 'Physical live monitors for multi-channel camera display' },
    { name: 'Recording Display', sku: 'MAT-DISP-REC', defaultUnit: 'Nos.', description: 'Physical recording displays for MDVR / DVR telematics' },
  ];

  const getReservedForComponent = (compName) => {
    let totalReserved = 0;
    const activeAllocations = (allocations || []).filter((a) => a.status === 'ALLOCATED');
    for (const a of activeAllocations) {
      const comps = Array.isArray(a.components_reserved) ? a.components_reserved : [];
      for (const c of comps) {
        if ((c.component_name || '').toLowerCase() === compName.toLowerCase()) {
          totalReserved += Number(c.quantity) || 0;
        }
      }
    }
    return totalReserved;
  };

  const camMat = materials.find((m) => m.material_name.toLowerCase() === 'camera') || { material_name: 'Camera', sku: 'MAT-CAM-LOOSE', unit: 'Nos.', current_stock: 0, min_stock_level: 10 };
  const liveMat = materials.find((m) => m.material_name.toLowerCase() === 'live display') || { material_name: 'Live Display', sku: 'MAT-DISP-LIVE', unit: 'Nos.', current_stock: 0, min_stock_level: 5 };
  const recMat = materials.find((m) => m.material_name.toLowerCase() === 'recording display') || { material_name: 'Recording Display', sku: 'MAT-DISP-REC', unit: 'Nos.', current_stock: 0, min_stock_level: 5 };

  const camStock = Number(camMat.current_stock) || 0;
  const camReserved = getReservedForComponent('Camera');
  const camFree = Math.max(0, camStock - camReserved);

  const liveStock = Number(liveMat.current_stock) || 0;
  const liveReserved = getReservedForComponent('Live Display');
  const liveFree = Math.max(0, liveStock - liveReserved);

  const recStock = Number(recMat.current_stock) || 0;
  const recReserved = getReservedForComponent('Recording Display');
  const recFree = Math.max(0, recStock - recReserved);

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
          <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-full font-mono">{LOOSE_CAMERA_ITEMS.length}</span>
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
          onClick={() => setActiveTab('issue')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'issue' || activeTab === 'requirements' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
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

        <button
          onClick={() => setActiveTab('weekly-report')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'weekly-report' ? 'bg-amber-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Weekly Stock Report</span>
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
          TAB 2: CAMERA DEVICES (PHYSICAL LOOSE-PRODUCT STOCK)
          ============================================================ */}
      {activeTab === 'devices' && (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Camera Devices &amp; Displays (Physical Loose Stock)</span>
              </h2>
              <p className="text-gray-500 mt-0.5">
                Maintain actual physical loose camera and display stock ledger. Manage stock levels for physical cameras, live displays, and recording displays.
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
              className="px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs shrink-0 self-start sm:self-auto"
            >
              <Plus size={14} />
              <span>Add Camera Model</span>
            </button>
          </div>

          {/* Loose Component Stock Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Cameras */}
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Loose Cameras</span>
                <span className="text-xl font-black text-gray-900 mt-0.5 block">{camFree} Nos. Free</span>
                <span className="text-[10px] text-gray-400 block">Total: {camStock} | Reserved: {camReserved}</span>
              </div>
              <button
                onClick={() => openManageStockModal(camMat, 'MATERIAL')}
                className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                title="Manage Camera Stock"
              >
                <SlidersHorizontal size={12} className="text-amber-600" />
                <span>Manage</span>
              </button>
            </div>

            {/* Live Displays */}
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Live Displays</span>
                <span className="text-xl font-black text-gray-900 mt-0.5 block">{liveFree} Nos. Free</span>
                <span className="text-[10px] text-gray-400 block">Total: {liveStock} | Reserved: {liveReserved}</span>
              </div>
              <button
                onClick={() => openManageStockModal(liveMat, 'MATERIAL')}
                className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                title="Manage Live Display Stock"
              >
                <SlidersHorizontal size={12} className="text-amber-600" />
                <span>Manage</span>
              </button>
            </div>

            {/* Recording Displays */}
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Recording Displays</span>
                <span className="text-xl font-black text-gray-900 mt-0.5 block">{recFree} Nos. Free</span>
                <span className="text-[10px] text-gray-400 block">Total: {recStock} | Reserved: {recReserved}</span>
              </div>
              <button
                onClick={() => openManageStockModal(recMat, 'MATERIAL')}
                className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                title="Manage Recording Display Stock"
              >
                <SlidersHorizontal size={12} className="text-amber-600" />
                <span>Manage</span>
              </button>
            </div>
          </div>

          {/* Physical Loose-Product Stock Ledger Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Physical Product</th>
                    <th className="py-3.5 px-6 text-center">Total Stock</th>
                    <th className="py-3.5 px-6 text-center">Reserved for Jobs</th>
                    <th className="py-3.5 px-6 text-center">Available (Free)</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {LOOSE_CAMERA_ITEMS.map((item) => {
                    const mat = materials.find((m) => m.material_name.toLowerCase() === item.name.toLowerCase()) || {
                      material_name: item.name,
                      sku: item.sku,
                      unit: item.defaultUnit,
                      current_stock: 0,
                    };
                    const total = Number(mat.current_stock) || 0;
                    const res = getReservedForComponent(item.name);
                    const free = Math.max(0, total - res);

                    return (
                      <tr key={item.name} className="hover:bg-amber-50/20 transition-colors">
                        <td className="py-3.5 px-6">
                          <div className="space-y-0.5">
                            <span className="font-bold text-gray-900 text-xs sm:text-sm block">
                              {item.name}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400 block">
                              SKU: {mat.sku || item.sku} &bull; {item.description}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-6 text-center font-bold font-mono text-xs sm:text-sm text-gray-900">
                          {total} {mat.unit || 'Nos.'}
                        </td>
                        <td className="py-3.5 px-6 text-center font-mono text-xs text-amber-800 font-bold">
                          {res > 0 ? `${res} ${mat.unit || 'Nos.'}` : '0 Nos.'}
                        </td>
                        <td className="py-3.5 px-6 text-center">
                          <span className="inline-block px-2.5 py-1 rounded-md font-bold font-mono text-xs bg-emerald-50 text-emerald-900 border border-emerald-200">
                            {free} {mat.unit || 'Nos.'}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          <button
                            type="button"
                            onClick={() => openManageStockModal(mat, 'MATERIAL')}
                            className="px-3.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                            <span>Manage Stock</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
                    <th className="py-3.5 px-6 text-center">Total Stock</th>
                    <th className="py-3.5 px-6 text-center">Reserved for Jobs</th>
                    <th className="py-3.5 px-6 text-center">Available (Free)</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-8 text-center text-gray-400">
                        No installation materials found.
                      </td>
                    </tr>
                  ) : (
                    materials.map((m) => {
                      const stock = Number(m.current_stock) || 0;
                      const res = getReservedForComponent(m.material_name);
                      const free = Math.max(0, stock - res);
                      return (
                        <tr key={m.id || m.material_name} className="hover:bg-amber-50/20 transition-colors">
                          <td className="py-3.5 px-6 font-bold text-gray-900 text-xs sm:text-sm">
                            <div>
                              <span>{m.material_name}</span>
                              {m.sku && (
                                <span className="block text-[10px] font-mono font-normal text-gray-400">
                                  SKU: {m.sku}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-6 text-center font-bold font-mono text-xs sm:text-sm text-gray-900">
                            {stock} {m.unit || 'Nos.'}
                          </td>
                          <td className="py-3.5 px-6 text-center font-mono text-xs text-amber-800 font-bold">
                            {res > 0 ? `${res} ${m.unit || 'Nos.'}` : `0 ${m.unit || 'Nos.'}`}
                          </td>
                          <td className="py-3.5 px-6 text-center">
                            <span className="inline-block px-2.5 py-1 rounded-md font-bold font-mono text-xs bg-emerald-50 text-emerald-900 border border-emerald-200">
                              {free} {m.unit || 'Nos.'}
                            </span>
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
          TAB 5: ISSUE MATERIALS (CONSOLIDATED WORKSPACE)
          ============================================================ */}
      {(activeTab === 'issue' || activeTab === 'requirements') && (
        <StoreInstallationRequirements
          token={token}
          onSelectChecklist={onSelectChecklist}
          onInventoryUpdated={loadAllData}
        />
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
            {storeReturns.length > 0 && (
              <button
                type="button"
                id="btn-delete-all-returns"
                onClick={() => setShowDeleteReturnsModal(true)}
                className="self-start sm:self-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer"
                title="Delete return records history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete All / Clean Returns</span>
              </button>
            )}
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
                        <td className="py-3 px-4 text-center font-bold font-mono">
                          {r.declared_return_qty !== null && r.declared_return_qty !== undefined ? `${r.declared_return_qty} ${unitStr}` : `0 ${unitStr}`}
                        </td>
                        <td className="py-3 px-4 text-center font-bold font-mono text-emerald-700">
                          {r.accepted_usable_qty !== null && r.accepted_usable_qty !== undefined
                            ? `${r.accepted_usable_qty} ${unitStr}`
                            : (r.status === 'PENDING_STORE_VERIFICATION' ? '—' : `0 ${unitStr}`)}
                        </td>
                        <td className="py-3 px-4 text-center font-bold font-mono text-rose-600">
                          {r.damaged_qty !== null && r.damaged_qty !== undefined
                            ? `${r.damaged_qty} ${unitStr}`
                            : (r.status === 'PENDING_STORE_VERIFICATION' ? '—' : `0 ${unitStr}`)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            r.status === 'VERIFIED_ACCEPTED' || r.status === 'VERIFIED_AND_RECONCILED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'DISCREPANCY_FLAGGED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {r.status === 'VERIFIED_ACCEPTED' || r.status === 'VERIFIED_AND_RECONCILED'
                              ? 'Verified & Credited'
                              : r.status === 'DISCREPANCY_FLAGGED'
                              ? 'Discrepancy Flagged'
                              : 'Awaiting Store Verification'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
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
                              <span className="text-gray-400 text-xs font-medium">Completed</span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteSingleReturn(r.id)}
                              className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete this return record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

              {movementTotalCount > 0 && (
                <button
                  type="button"
                  id="btn-delete-all-movements"
                  onClick={() => setShowDeleteMovementsModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold transition-colors cursor-pointer"
                  title="Delete movement history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All / Clean Movements</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Date & Time</th>
                  <th className="py-2.5 px-3.5">Item</th>
                  <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Type</th>
                  <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Quantity</th>
                  <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Stock Balance</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Performed By</th>
                  <th className="py-2.5 px-3.5 min-w-[180px]">Reason</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Action</th>
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
                  movements.map((t) => {
                    const balanceBefore = t.balance_before !== undefined && t.balance_before !== null ? t.balance_before : t.previous_balance;
                    const balanceAfter = t.balance_after !== undefined && t.balance_after !== null ? t.balance_after : t.new_balance;
                    const movementTypeVal = t.movement_type || t.transaction_type;
                    const reasonText = t.reason_or_remarks || t.reason || '—';

                    return (
                      <tr key={t.id} className="hover:bg-amber-50/20 transition-colors">
                        {/* 1. Date & Time */}
                        <td className="py-2.5 px-3.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>

                        {/* 2. Item */}
                        <td className="py-2.5 px-3.5 font-bold text-gray-900">
                          <span className="block leading-tight">
                            {t.item_name || t.device_name || t.device_type || t.material_name}
                          </span>
                          {t.sku && (
                            <span className="font-mono text-[10px] text-gray-400 font-normal block">
                              {t.sku}
                            </span>
                          )}
                        </td>

                        {/* 3. Type */}
                        <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            movementTypeVal === 'STOCK_ISSUED' || movementTypeVal === 'COURIER_DISPATCHED'
                              ? 'bg-blue-100 text-blue-800'
                              : movementTypeVal === 'STOCK_RECEIVED' || movementTypeVal === 'OPENING_STOCK'
                              ? 'bg-emerald-100 text-emerald-800'
                              : movementTypeVal?.includes('RETURN')
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {formatMovementType(movementTypeVal)}
                          </span>
                        </td>

                        {/* 4. Quantity */}
                        <td className="py-2.5 px-3.5 text-center font-bold font-mono text-gray-900 whitespace-nowrap">
                          {t.quantity} {t.unit || 'Nos.'}
                        </td>

                        {/* 5. Stock Balance */}
                        <td className="py-2.5 px-3.5 text-center font-mono text-[11px] whitespace-nowrap">
                          {balanceBefore !== null && balanceBefore !== undefined && balanceAfter !== null && balanceAfter !== undefined ? (
                            <span className="text-gray-600">
                              {balanceBefore} → <strong className="text-gray-900">{balanceAfter}</strong>
                            </span>
                          ) : balanceAfter !== null && balanceAfter !== undefined ? (
                            <strong className="text-gray-900">{balanceAfter}</strong>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* 6. Performed By */}
                        <td className="py-2.5 px-3.5 text-gray-700 whitespace-nowrap">
                          {t.performer_name || 'Store Manager'}
                        </td>

                        {/* 7. Reason */}
                        <td className="py-2.5 px-3.5 text-gray-600 max-w-[220px]">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate block" title={reasonText}>
                              {reasonText}
                            </span>
                            {(t.reason_or_remarks || t.reason) && (
                              <button
                                type="button"
                                onClick={() => setRemarksModalMovement(t)}
                                className="text-[10px] text-amber-700 hover:text-amber-900 font-semibold underline shrink-0 cursor-pointer ml-1"
                              >
                                View
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 8. Action */}
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenSingleDeleteModal(t)}
                            className="px-2.5 py-1 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                            title="Delete or inspect this movement record"
                          >
                            <Trash2 className="w-3 h-3 text-rose-500" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between p-3 bg-gray-50 border-t border-gray-100 rounded-b-2xl text-xs gap-2">
              <span className="text-gray-500 font-medium">
                Showing {movements.length} of {movementTotalCount} movements (Page {movementPage} of {movementTotalPages})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMovementPage((p) => Math.max(1, p - 1))}
                  disabled={movementPage <= 1}
                  className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-gray-700 font-bold hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                >
                  Previous
                </button>
                <span className="px-2 font-mono font-bold text-gray-800">{movementPage} / {movementTotalPages}</span>
                <button
                  type="button"
                  onClick={() => setMovementPage((p) => Math.min(movementTotalPages, p + 1))}
                  disabled={movementPage >= movementTotalPages}
                  className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-gray-700 font-bold hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Automatic 60-Day Retention Notice & Real-Time Status */}
          <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-950 text-sm">
                  Automatic 60-Day History Retention
                </h4>
                <p className="text-amber-800/80 mt-0.5 max-w-2xl leading-relaxed">
                  Eligible stock movement history older than 60 days is automatically deleted on a daily schedule. Authoritative inventory stock balances, pending returns, unresolved discrepancy records, checklists, and quotations are permanently preserved and protected.
                </p>
                {cleanupStatus && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-amber-900">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold shadow-2xs ${
                        cleanupStatus.health === 'HEALTHY'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          cleanupStatus.health === 'HEALTHY' ? 'bg-emerald-600 animate-pulse' : 'bg-rose-600'
                        }`}
                      />
                      {cleanupStatus.health === 'HEALTHY' ? 'Automatic 60-Day Cleanup Active' : 'Cleanup Issue Detected'}
                    </span>
                    {cleanupStatus.last_successful_run && (
                      <span className="text-amber-900 bg-amber-100/60 px-2 py-0.5 rounded-md border border-amber-200/50">
                        Last cleaned: <strong>{new Date(cleanupStatus.last_successful_run).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</strong> ({cleanupStatus.movements_deleted_last_run || 0} expired records removed)
                      </span>
                    )}
                    {cleanupStatus.error_message && (
                      <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 font-semibold">
                        Notice: {cleanupStatus.error_message}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleTriggerCleanup}
              disabled={cleanupRunning}
              className="px-3.5 py-2 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-xl shadow-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cleanupRunning ? 'animate-spin' : ''}`} />
              <span>{cleanupRunning ? 'Running Cleanup...' : 'Run 60-Day Cleanup Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 10: WEEKLY STOCK MAINTENANCE REPORT
          ============================================================ */}
      {activeTab === 'weekly-report' && (
        <WeeklyStockReportTab token={token} user={profile || user} />
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

      {/* 8. Stock Movement Remarks Details Modal */}
      {remarksModalMovement && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2 text-gray-900">
                <div className="p-2 bg-amber-50 rounded-xl text-amber-700">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Stock Movement Audit Details</h3>
                  <p className="text-[11px] text-gray-500 font-mono">
                    {new Date(remarksModalMovement.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemarksModalMovement(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Item</span>
                  <span className="font-bold text-gray-900 block mt-0.5">
                    {remarksModalMovement.item_name}
                  </span>
                  {remarksModalMovement.sku && (
                    <span className="text-[10px] font-mono text-gray-500 block">
                      SKU: {remarksModalMovement.sku}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Type & Qty</span>
                  <span className="font-bold text-gray-900 block mt-0.5">
                    {formatMovementType(remarksModalMovement.movement_type || remarksModalMovement.transaction_type)}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-amber-800 block">
                    {remarksModalMovement.quantity} {remarksModalMovement.unit || 'Nos.'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Stock Transition</span>
                  <span className="font-mono text-xs font-semibold text-gray-800 block mt-0.5">
                    {remarksModalMovement.balance_before ?? '—'} → <strong className="text-gray-900">{remarksModalMovement.balance_after ?? '—'}</strong>
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Performed By</span>
                  <span className="font-semibold text-gray-900 block mt-0.5">
                    {remarksModalMovement.performer_name || 'Store Manager'}
                  </span>
                  {remarksModalMovement.performer_email && (
                    <span className="text-[10px] text-gray-500 block">{remarksModalMovement.performer_email}</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Full Reason / Audit Remarks
                </span>
                <div className="p-3 bg-amber-50/50 border border-amber-200/60 rounded-xl text-gray-800 text-xs leading-relaxed font-sans whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {remarksModalMovement.reason_or_remarks || remarksModalMovement.reason || 'No detailed remarks recorded for this movement.'}
                </div>
              </div>

              {(remarksModalMovement.checklist_id || remarksModalMovement.reference_transaction_id) && (
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 space-y-0.5">
                  <span className="font-bold block">Linked Business Transaction:</span>
                  {remarksModalMovement.checklist_id && (
                    <span className="block font-mono">Checklist ID: {remarksModalMovement.checklist_id}</span>
                  )}
                  {remarksModalMovement.reference_transaction_id && (
                    <span className="block font-mono">Ref Tx ID: {remarksModalMovement.reference_transaction_id}</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setRemarksModalMovement(null)}
                className="px-4 py-2 font-bold text-white bg-gray-900 hover:bg-black rounded-xl text-xs cursor-pointer shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Single Stock Movement Delete Confirmation Modal */}
      {singleDeleteMovement && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl ${singleDeleteMovement.is_protected ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'}`}>
                  {singleDeleteMovement.is_protected ? <ShieldCheck className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    {singleDeleteMovement.is_protected ? 'Protected Genuine Transaction' : 'Delete Test Movement Record'}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-mono">ID: {singleDeleteMovement.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSingleDeleteMovement(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {singleDeleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
                {singleDeleteError}
              </div>
            )}

            {singleDeleteMovement.is_protected ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Audit Preservation Safeguard</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    This stock movement record represents a genuine inventory transaction linked to an installation checklist, store issuance, return, or physical inventory change.
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-900 font-semibold">
                    Under inventory audit compliance rules, genuine historical movements cannot be deleted.
                  </p>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
                  <span className="text-[11px] text-gray-600 block">
                    <strong>Need to correct stock counts?</strong>
                  </span>
                  <p className="text-[11px] text-gray-500">
                    Use <strong>Manage Stock</strong> to record an authorized Stock Adjustment or Reversal with a valid business reason.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSingleDeleteMovement(null)}
                    className="px-4 py-2 font-bold text-gray-700 hover:bg-gray-100 rounded-xl text-xs cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-gray-50 rounded-xl space-y-1 text-gray-700">
                  <p>
                    <strong>Item:</strong> {singleDeleteMovement.item_name}
                  </p>
                  <p>
                    <strong>Type:</strong> {formatMovementType(singleDeleteMovement.movement_type || singleDeleteMovement.transaction_type)} ({singleDeleteMovement.quantity} {singleDeleteMovement.unit || 'Nos.'})
                  </p>
                  <p>
                    <strong>Remarks:</strong> {singleDeleteMovement.reason_or_remarks || singleDeleteMovement.reason || '—'}
                  </p>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Eligible Test Record</span>
                  </div>
                  <p className="text-emerald-800">
                    This is a non-authoritative test entry. Deleting it will remove it from the audit ledger without changing any product stock balances.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={deletingSingleMovement}
                    onClick={() => setSingleDeleteMovement(null)}
                    className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deletingSingleMovement}
                    onClick={handleConfirmSingleDelete}
                    className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{deletingSingleMovement ? 'Deleting...' : 'Confirm Delete'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 10. Delete All / Clean Movements Modal */}
      {showDeleteMovementsModal && (() => {
        const eligibleCount = movements.filter((m) => !m.is_protected).length;
        const protectedCount = movements.filter((m) => m.is_protected).length;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2 text-rose-700">
                  <div className="p-2 bg-rose-100 rounded-xl">
                    <Trash2 className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Clean Stock Movements History</h3>
                    <p className="text-[11px] text-gray-500">Safe purge of eligible test/non-authoritative records</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteMovementsModal(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Breakdown */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Eligible Test Records</span>
                  <span className="text-xl font-black text-rose-900 block mt-1">{eligibleCount}</span>
                  <span className="text-[10px] text-rose-600 block mt-0.5">Will be safely cleaned</span>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Protected Transactions</span>
                  <span className="text-xl font-black text-emerald-900 block mt-1">{protectedCount}</span>
                  <span className="text-[10px] text-emerald-700 block mt-0.5">Safely preserved</span>
                </div>
              </div>

              {/* Stock Balance Invariance Guarantee */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Physical Stock Count Protected</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Cleanup removes test audit entries only. Protected movements linked to checklists, issuances, or returns are permanently preserved. Usable stock balances will remain completely safe and untouched.
                </p>
              </div>

              {/* Scope Selection */}
              <div className="space-y-2 text-xs">
                <label className="block font-bold text-gray-700">Select Deletion Scope:</label>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  deleteMovementsScope === 'ALL' ? 'border-rose-300 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                }`}>
                  <input
                    type="radio"
                    name="movementScope"
                    value="ALL"
                    checked={deleteMovementsScope === 'ALL'}
                    onChange={() => setDeleteMovementsScope('ALL')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                  />
                  <div>
                    <span className="font-bold text-gray-900 block">Clean All Eligible Test Records</span>
                    <span className="text-[11px] text-gray-500">Purges eligible test entries across all categories. Protected records stay preserved.</span>
                  </div>
                </label>

                {(movementCategory !== 'All' || movementType !== 'All') && (
                  <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                    deleteMovementsScope === 'FILTERED' ? 'border-rose-300 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="movementScope"
                      value="FILTERED"
                      checked={deleteMovementsScope === 'FILTERED'}
                      onChange={() => setDeleteMovementsScope('FILTERED')}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="font-bold text-gray-900 block">
                        Clean Filtered Movements Only
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Only cleans test records matching {movementCategory !== 'All' ? `Category: ${movementCategory}` : ''} {movementType !== 'All' ? `Type: ${movementType}` : ''}.
                      </span>
                    </div>
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deletingMovements}
                  onClick={() => setShowDeleteMovementsModal(false)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingMovements || eligibleCount === 0}
                  onClick={handleDeleteAllMovements}
                  className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingMovements ? 'Cleaning...' : eligibleCount === 0 ? 'No Eligible Test Records' : 'Confirm & Clean Records'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 9. Delete Return Records Confirmation Modal */}
      {showDeleteReturnsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2 text-rose-700">
                <div className="p-2 bg-rose-100 rounded-xl">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delete Return Records History</h3>
                  <p className="text-[11px] text-gray-500">Purge device and material return records</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteReturnsModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Reassurance */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-900">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Credited Warehouse Stock Intact</span>
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Stock already verified and credited back to inventory remains intact. Deleting records removes entries from this returns log only.
              </p>
            </div>

            {/* Scope Selection */}
            <div className="space-y-2 text-xs">
              <label className="block font-bold text-gray-700">Select Deletion Scope:</label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                deleteReturnsScope === 'ALL' ? 'border-rose-300 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="returnScope"
                  value="ALL"
                  checked={deleteReturnsScope === 'ALL'}
                  onChange={() => setDeleteReturnsScope('ALL')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="font-bold text-gray-900 block">Delete All Return Records ({storeReturns.length})</span>
                  <span className="text-[11px] text-gray-500">Deletes all return declaration entries, including pending test submissions.</span>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                deleteReturnsScope === 'VERIFIED_ONLY' ? 'border-rose-300 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="returnScope"
                  value="VERIFIED_ONLY"
                  checked={deleteReturnsScope === 'VERIFIED_ONLY'}
                  onChange={() => setDeleteReturnsScope('VERIFIED_ONLY')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="font-bold text-gray-900 block">Delete Completed / Verified Returns Only</span>
                  <span className="text-[11px] text-gray-500">Retains any returns currently awaiting physical store verification.</span>
                </div>
              </label>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px]">
              <strong>Warning:</strong> This deletion is permanent and cannot be undone.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingReturns}
                onClick={() => setShowDeleteReturnsModal(false)}
                className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingReturns}
                onClick={handleDeleteAllReturns}
                className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingReturns ? 'Deleting Records...' : 'Confirm & Delete Records'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
