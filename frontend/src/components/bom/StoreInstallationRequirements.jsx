import { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Layers,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Phone,
  MapPin,
  Check,
  ChevronDown,
  ChevronUp,
  User,
  Info,
  Calendar,
  ShieldCheck,
  X,
  Truck,
  FileText,
  FileSpreadsheet,
  ExternalLink,
} from 'lucide-react';
import {
  fetchStoreMaterialRequirements,
  syncStoreMaterialRequirements,
  downloadStoreRequirementPDF,
  verifyStoreMaterialReturnApi,
  verifyStoreBackupReturns,
  issueExtraDevicesApi,
  rejectExtraDevicesApi,
} from '../../lib/api';
import { isScrewMaterial } from '../../lib/productHelpers';
import IssueMaterialsModal from './IssueMaterialsModal';

export default function StoreInstallationRequirements({ token, onSelectChecklist, onInventoryUpdated }) {
  const [requirements, setRequirements] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    pending_original: 0,
    pending_extra: 0,
    shortages: 0,
    installationCount: 0,
    courierCount: 0,
    serviceCount: 0,
    pendingCount: 0,
    shortageCounter: 0,
    issuedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [shortageOnly, setShortageOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toastMessage, setToastMessage] = useState('');

  // Modals State
  const [issueModalChecklist, setIssueModalChecklist] = useState(null);
  const [viewIssuanceModalJob, setViewIssuanceModalJob] = useState(null);
  const [viewPostInstallModalJob, setViewPostInstallModalJob] = useState(null);
  const [viewJobDetailsModalJob, setViewJobDetailsModalJob] = useState(null);

  // Timeline collapsed states (default open for all cards)
  const [collapsedTimelines, setCollapsedTimelines] = useState(new Set());

  // Extra Backup Device Review & Issuance Modal State
  const [extraDeviceModal, setExtraDeviceModal] = useState(null);
  const [extraIssuanceQuantities, setExtraIssuanceQuantities] = useState({});
  const [extraIssuanceRemarks, setExtraIssuanceRemarks] = useState('');
  const [submittingExtraIssuance, setSubmittingExtraIssuance] = useState(false);
  const [extraIssuanceError, setExtraIssuanceError] = useState('');

  // Physical Return Verification Modal State
  const [returnVerificationModal, setReturnVerificationModal] = useState(null);
  const [returnForm, setReturnForm] = useState({
    accepted_usable_qty: '',
    damaged_qty: '0',
    missing_qty: '0',
    remarks: '',
  });
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  // Loose Backup Return Verification Modal State
  const [backupReturnModal, setBackupReturnModal] = useState(null);
  const [backupReturnRows, setBackupReturnRows] = useState([]);
  const [backupReturnRemarks, setBackupReturnRemarks] = useState('');
  const [submittingBackupReturn, setSubmittingBackupReturn] = useState(false);
  const [backupReturnError, setBackupReturnError] = useState('');

  const loadRequirements = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoreMaterialRequirements(token, {
        page,
        limit: 15,
        search,
        job_type: jobTypeFilter,
        issuance_status: statusFilter,
        has_shortage: shortageOnly ? 'true' : '',
      });
      setRequirements(data.requirements || []);
      setSummary(data.summary || {
        total: 0,
        pending_original: 0,
        pending_extra: 0,
        shortages: 0,
        installationCount: 0,
        courierCount: 0,
        serviceCount: 0,
        pendingCount: 0,
        shortageCounter: 0,
        issuedCount: 0,
      });
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('Failed to load store material requirements:', err);
      setError(err.message || 'Failed to load requirements. Please check network connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [token, page, search, jobTypeFilter, statusFilter, shortageOnly]);

  useEffect(() => {
    loadRequirements();
  }, [loadRequirements]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleResetFilters = () => {
    setSearch('');
    setJobTypeFilter('All');
    setStatusFilter('All');
    setShortageOnly(false);
    setPage(1);
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await syncStoreMaterialRequirements(token);
      showToast(`Synced ${res.synced_count || 0} checklist requirement records!`);
      await loadRequirements();
    } catch (err) {
      console.error('Failed to sync requirements:', err);
      showToast(`Sync failed: ${err.message || 'Please check server connection'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadPdf = async (checklistId, checklistNumber) => {
    if (!token || !checklistId) return;
    try {
      showToast(`Generating Store Manager Requirement Sheet for ${checklistNumber}...`);
      const blob = await downloadStoreRequirementPDF(token, checklistId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Store-Requirements-${checklistNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Store Manager PDF downloaded for ${checklistNumber}`);
    } catch (err) {
      console.error('PDF download error:', err);
      alert('Failed to download Store Manager PDF. Please try again.');
    }
  };

  const handleOpenExtraDeviceModal = (req) => {
    const decl = req.backup_declaration;
    const initialQtys = {};
    if (decl && Array.isArray(decl.items)) {
      decl.items.forEach((it) => {
        const remaining = Math.max(0, (Number(it.quantity) || 0) - (Number(it.quantity_issued) || 0));
        const avail = Number(it.available_stock) || 0;
        initialQtys[it.item_name] = Math.min(remaining, avail);
      });
    } else if (Array.isArray(req.extra_device_items)) {
      req.extra_device_items.forEach((it) => {
        const remaining = Number(it.extra_quantity || it.quantity) || 1;
        const avail = Number(it.available_stock) || 0;
        initialQtys[it.device_type] = Math.min(remaining, avail);
      });
    }
    setExtraIssuanceQuantities(initialQtys);
    setExtraIssuanceRemarks('');
    setExtraIssuanceError('');
    setExtraDeviceModal({
      checklist: req,
      declaration: decl || { items: req.extra_device_items || [] },
    });
  };

  const handleExtraIssuanceSubmit = async (e) => {
    e.preventDefault();
    if (!token || !extraDeviceModal) return;
    setExtraIssuanceError('');
    setSubmittingExtraIssuance(true);

    try {
      const itemsPayload = Object.entries(extraIssuanceQuantities).map(([item_name, qty]) => {
        const found = (extraDeviceModal.declaration?.items || []).find(
          (d) => (d.item_name || d.device_type || '').trim().toLowerCase() === item_name.trim().toLowerCase()
        );
        return {
          item_id: found?.item_id || found?.id,
          item_sku: found?.item_sku || found?.sku,
          item_name,
          quantity_to_issue: Number(qty) || 0,
        };
      }).filter((it) => it.quantity_to_issue > 0);

      if (itemsPayload.length === 0) {
        throw new Error('Please enter a quantity greater than 0 for at least one item.');
      }

      const res = await issueExtraDevicesApi(token, {
        checklist_id: extraDeviceModal.checklist.checklist_id || extraDeviceModal.checklist.id,
        items: itemsPayload,
        remarks: extraIssuanceRemarks.trim(),
      });

      showToast(`Extra backup devices successfully issued! Status: ${res.issuance_status || 'Issued'}`);
      setExtraDeviceModal(null);
      await loadRequirements();
      if (typeof onInventoryUpdated === 'function') {
        try { onInventoryUpdated(); } catch (e) {}
      }
      try {
        window.dispatchEvent(new CustomEvent('inventory-updated', {
          detail: { checklist_id: extraDeviceModal.checklist?.checklist_id || extraDeviceModal.checklist?.id }
        }));
      } catch (e) {}
    } catch (err) {
      setExtraIssuanceError(err.message || 'Failed to issue extra backup devices');
    } finally {
      setSubmittingExtraIssuance(false);
    }
  };

  const handleExtraIssuanceReject = async () => {
    if (!token || !extraDeviceModal) return;
    if (!window.confirm('Are you sure you want to reject this extra backup device request?')) return;
    setSubmittingExtraIssuance(true);
    setExtraIssuanceError('');
    try {
      await rejectExtraDevicesApi(token, {
        checklist_id: extraDeviceModal.checklist.checklist_id || extraDeviceModal.checklist.id,
        reason: extraIssuanceRemarks.trim() || 'Store Manager rejected extra device request',
      });
      showToast('Extra backup device request rejected.');
      setExtraDeviceModal(null);
      await loadRequirements();
    } catch (err) {
      setExtraIssuanceError(err.message || 'Failed to reject extra backup devices');
    } finally {
      setSubmittingExtraIssuance(false);
    }
  };

  const toggleTimeline = (id) => {
    setCollapsedTimelines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDisplayDateTime = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const strHours = String(hours).padStart(2, '0');
      return `${day}/${month}/${year} ${strHours}:${minutes} ${ampm}`;
    } catch {
      return dateStr;
    }
  };

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-5">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Issuance Modal (Original Stock Issuance) */}
      {issueModalChecklist && (
        <IssueMaterialsModal
          checklist={issueModalChecklist}
          token={token}
          onClose={() => setIssueModalChecklist(null)}
          onSuccess={() => {
            setIssueModalChecklist(null);
            showToast(`Stock successfully issued and deducted for ${issueModalChecklist.checklist_number}!`);
            loadRequirements();
          }}
        />
      )}

      {/* 1. DARK WORKSPACE BANNER */}
      <div className="bg-[#0b192e] text-white p-5 rounded-2xl shadow-sm border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold px-2.5 py-0.5 bg-amber-500/20 text-amber-400 rounded border border-amber-500/30 uppercase tracking-wider inline-block">
            Store &amp; Inventory Workspace
          </span>
          <h1 className="text-2xl font-black mt-2 flex items-center gap-2.5 text-white">
            <Package className="w-6 h-6 text-amber-400" />
            <span>Issue Materials</span>
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl font-medium">
            View incoming jobs, original and extra material requirements, issue stock, track post-installation status and manage all material issuance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadRequirements}
            disabled={loading}
            className="px-4 py-2 text-xs font-bold text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {/* 2. 4 KPI SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Jobs */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Total Jobs</span>
            <span className="text-2xl font-black text-slate-900 leading-tight">
              {summary.total || requirements.length}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">All pending and in-progress jobs</span>
          </div>
        </div>

        {/* Card 2: Pending Original Issuance */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
            <Package className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Pending Original Issuance</span>
            <span className="text-2xl font-black text-slate-900 leading-tight">
              {summary.pending_original ?? summary.pendingCount ?? 0}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">Jobs awaiting original stock issue</span>
          </div>
        </div>

        {/* Card 3: Pending Extra Issuance */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
            <Truck className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Pending Extra Issuance</span>
            <span className="text-2xl font-black text-slate-900 leading-tight">
              {summary.pending_extra ?? 0}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">Technician extra device requests</span>
          </div>
        </div>

        {/* Card 4: Stock Shortages */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-rose-600" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Stock Shortages</span>
            <span className="text-2xl font-black text-slate-900 leading-tight">
              {summary.shortages ?? summary.shortageCounter ?? 0}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">Jobs with insufficient stock</span>
          </div>
        </div>
      </div>

      {/* 3. SEARCH & FILTERS BAR */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Checklist #, Client Name, Mobile, or Location..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 font-medium text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-bold">Job Type:</span>
            <select
              value={jobTypeFilter}
              onChange={(e) => {
                setJobTypeFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-3 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer shadow-2xs"
            >
              <option value="All">All Jobs</option>
              <option value="Installation">Installation Only</option>
              <option value="Courier">Product Courier</option>
              <option value="Service">Service Only</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-bold">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-3 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer shadow-2xs"
            >
              <option value="All">All Statuses</option>
              <option value="PENDING">Pending Issuance</option>
              <option value="ISSUED">Stock Issued</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncing}
            className="py-1.5 px-3.5 rounded-lg text-slate-700 bg-white hover:bg-slate-50 font-bold border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Sync all requirements from existing checklists"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* 4. CHECKLIST WORKFLOW JOBS LIST */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">Loading installation &amp; material requirements...</p>
        </div>
      ) : error ? (
        <div className="bg-white p-10 rounded-2xl border border-rose-200 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">Unable to Load Requirements</h3>
            <p className="text-xs text-rose-600 max-w-md mx-auto">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadRequirements}
            className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : requirements.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No Job Requirements Found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {search || jobTypeFilter !== 'All' || statusFilter !== 'All' || shortageOnly
              ? 'No checklist records match the current filter criteria.'
              : 'When Sales submits an Installation Initiation Checklist, its material requirements and client details will automatically appear here.'}
          </p>
          {search || jobTypeFilter !== 'All' || statusFilter !== 'All' || shortageOnly ? (
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-2 px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer border border-slate-200"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear All Filters</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing}
              className="mt-2 px-4 py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync All Jobs Now</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {requirements.map((req) => {
            const isCourier = req.delivery_method === 'Product Couriered' || req.is_courier;
            const isService = !isCourier && req.job_type === 'Service';
            const isInstallation = !isCourier && !isService;
            const isIssued = isCourier
              ? (
                  req.stock_issuance_status === 'Completed' ||
                  req.is_issued === true ||
                  req.status === 'ISSUED' ||
                  req.material_issuance_status === 'ISSUED' ||
                  req.devices_issuance_status === 'ISSUED' ||
                  req.courier_dispatch_status === 'ISSUED' ||
                  Boolean(req.is_courier_dispatched)
                )
              : (isService
                ? (Array.isArray(req.service_items) && req.service_items.length > 0 && req.service_items.every((it) => it.quantity_remaining === 0))
                : (req.material_issuance_status === 'ISSUED' && req.devices_issuance_status === 'ISSUED'));

            const chkId = req.id || req.checklist_id;
            const isTimelineCollapsed = collapsedTimelines.has(chkId);

            // Construct Panel 1 items (Original Required / Issued items)
            const origItems = [];
            const rawDevs = Array.isArray(req.device_items) && req.device_items.length > 0
              ? req.device_items
              : (Array.isArray(req.required_device_items) ? req.required_device_items : []);
            rawDevs.forEach((d) => {
              const reqQty = Number(d.required_quantity ?? d.quantity ?? d.number_of_devices) || 1;
              origItems.push({
                name: d.device_type || d.item_name || 'Camera',
                sku: d.sku || d.item_sku || 'MAT-CAM-4CH',
                required: reqQty,
                issued: isIssued ? reqQty : 0,
                status: isIssued ? 'Issued' : 'Pending',
              });
            });

            if (Array.isArray(req.material_items) && req.material_items.length > 0) {
              req.material_items.slice(0, 3).forEach((m) => {
                const reqQty = Number(m.required_quantity ?? m.quantity) || 1;
                origItems.push({
                  name: m.material_name || m.item_name || 'Material',
                  sku: m.sku || m.material_sku || 'MAT-CBL-15M',
                  required: reqQty,
                  issued: isIssued ? reqQty : 0,
                  status: isIssued ? 'Issued' : 'Pending',
                });
              });
            }

            if (origItems.length === 0) {
              const reqQty = Number(req.number_of_devices) || 1;
              origItems.push({
                name: req.device_type || 'Camera',
                sku: 'MAT-CAM-4CH',
                required: reqQty,
                issued: isIssued ? reqQty : 0,
                status: isIssued ? 'Issued' : 'Pending',
              });
            }

            // Construct Panel 2 items (Technician Extra Device Request)
            const extraItems = [];
            if (req.backup_declaration?.items && Array.isArray(req.backup_declaration.items)) {
              req.backup_declaration.items.forEach((it) => {
                const reqQ = Number(it.quantity) || 0;
                const issQ = Number(it.quantity_issued) || 0;
                const isInstalled = (req.is_completion_submitted || req.installation_status === 'Completed' || (req.post_installation_details && req.post_installation_details.length > 0)) && issQ > 0;
                extraItems.push({
                  name: it.item_name || it.device_type || 'Device',
                  sku: it.item_sku || it.sku || 'MAT-CAM-4CH',
                  requested: reqQ,
                  issued: issQ,
                  status: isInstalled ? 'Installed' : (issQ >= reqQ && reqQ > 0 ? 'Issued' : 'Pending'),
                });
              });
            } else if (Array.isArray(req.extra_device_items) && req.extra_device_items.length > 0) {
              req.extra_device_items.forEach((it) => {
                const reqQ = Number(it.extra_quantity || it.quantity) || 1;
                extraItems.push({
                  name: it.device_type || 'Device',
                  sku: it.sku || 'MAT-CAM-4CH',
                  requested: reqQ,
                  issued: 0,
                  status: 'Pending',
                });
              });
            }

            // Panel 3 items (Post-Installation Details)
            const postInstallList = Array.isArray(req.post_installation_details) ? req.post_installation_details : [];

            const hasExtraPending = extraItems.some((e) => e.status === 'Pending' && e.requested > 0);
            const extraAllInstalled = extraItems.length > 0 && extraItems.every((e) => e.status === 'Installed' || e.status === 'Issued');
            const hasTech = Boolean(req.service_engineer && req.service_engineer !== 'Unassigned');

            return (
              <div
                key={chkId}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4 transition-all hover:border-slate-300"
              >
                {/* 1. CARD HEADER WITH BADGES & ACTION BUTTONS */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  {/* Left Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Checklist Number Pill */}
                    <span className="bg-amber-50 text-amber-900 border border-amber-300 font-mono font-bold text-xs px-2.5 py-1 rounded-md shadow-2xs">
                      {req.checklist_number}
                    </span>

                    {/* Job Type Pill */}
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 font-extrabold text-xs uppercase px-2.5 py-1 rounded-md shadow-2xs">
                      {isCourier ? 'PRODUCT COURIER' : (isService ? 'SERVICE JOB' : 'INSTALLATION')}
                    </span>

                    {/* Original Stock Issuance Pill */}
                    {isIssued ? (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs px-2.5 py-1 rounded-md flex items-center gap-1 shadow-2xs">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Original Stock Issued</span>
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold text-xs px-2.5 py-1 rounded-md flex items-center gap-1 shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Original Stock Pending</span>
                      </span>
                    )}

                    {/* Extra Devices Status Pill */}
                    {extraAllInstalled ? (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs px-2.5 py-1 rounded-md flex items-center gap-1 shadow-2xs">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Extra Devices Installed</span>
                      </span>
                    ) : hasExtraPending ? (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold text-xs px-2.5 py-1 rounded-md flex items-center gap-1 shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Extra Devices Pending</span>
                      </span>
                    ) : null}

                    {/* Technician Assignment Pill */}
                    {hasTech ? (
                      <span className="bg-purple-50 text-purple-700 border border-purple-200 font-bold text-xs px-2.5 py-1 rounded-md shadow-2xs">
                        Technician Assigned
                      </span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 border border-slate-200 font-bold text-xs px-2.5 py-1 rounded-md shadow-2xs">
                        Technician Unassigned
                      </span>
                    )}
                  </div>

                  {/* Right Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewJobDetailsModalJob(req)}
                      className="px-3 py-1.5 border border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 text-blue-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-blue-600" />
                      <span>View Job Details</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(chkId, req.checklist_number)}
                      className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-slate-600" />
                      <span>Store Manager PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (typeof onSelectChecklist === 'function') {
                          onSelectChecklist(req);
                        } else {
                          setViewJobDetailsModalJob(req);
                        }
                      }}
                      className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-slate-600" />
                      <span>Checklist</span>
                    </button>
                  </div>
                </div>

                {/* 2. 4-COLUMN JOB INFO ROW */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-3.5 bg-slate-50/70 rounded-xl border border-slate-100 text-xs">
                  {/* Col 1: CLIENT INFORMATION */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      CLIENT INFORMATION
                    </span>
                    <h3 className="font-black text-slate-900 text-sm leading-snug">
                      {req.client_name || req.customer_name || 'Primary Customer'}
                    </h3>
                    <div className="flex items-center gap-1.5 text-blue-700 font-bold">
                      <Phone className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span>{req.client_mobile || req.customer_mobile || '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                      <span className="truncate" title={req.client_location || req.location || '—'}>
                        {req.client_location || req.location || '—'}
                      </span>
                    </div>
                  </div>

                  {/* Col 2: SALES & ASSIGNMENT */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      SALES &amp; ASSIGNMENT
                    </span>
                    <div className="text-slate-700">
                      <span className="text-slate-500">Salesperson: </span>
                      <span className="font-bold text-slate-900">{req.salesperson_name || '—'}</span>
                    </div>
                    <div className="text-slate-700">
                      <span className="text-slate-500">Assigned Technician: </span>
                      <span className="font-bold text-slate-900">{req.service_engineer || 'Unassigned'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-slate-500">Job Type: </span>
                      <span className="bg-purple-100 text-purple-800 text-[11px] font-bold px-2 py-0.2 rounded shadow-2xs">
                        {isCourier ? 'Product Courier' : req.job_type}
                      </span>
                    </div>
                  </div>

                  {/* Col 3: INSTALLATION / DELIVERY DETAILS */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      INSTALLATION / DELIVERY DETAILS
                    </span>
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>
                        <span className="text-slate-500">Original Planned: </span>
                        <span className="font-bold text-slate-900">
                          {req.expected_arrival_date || '2026-10-27'} ({req.installation_duration || '1 Day'})
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>
                        <span className="text-slate-500">Expected Delivery: </span>
                        <span className="font-bold text-slate-900">
                          {req.expected_arrival_time || '10:00 AM - 06:00 PM'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Col 4: PRODUCT COURIER / JOB SUMMARY NOTICE */}
                  <div className="bg-blue-50/80 border border-blue-100 rounded-xl p-2.5 flex flex-col justify-between space-y-1 text-xs">
                    <div>
                      <div className="flex items-center gap-1.5 font-black text-blue-900 text-[11px] uppercase tracking-wider">
                        <Truck className="w-3.5 h-3.5 text-blue-700" />
                        <span>{isCourier ? 'PRODUCT COURIER DETAILS' : 'INSTALLATION DETAILS'}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        {isCourier
                          ? 'Product Courier - For Customer Pickup/Shipping'
                          : 'Direct Vehicle Fleet Installation'}
                      </p>
                    </div>

                    <div className="flex items-start gap-1.5 text-emerald-800 font-medium text-[11px] pt-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        {isIssued
                          ? 'Original stock issued. Technician requested extra devices and completed installation.'
                          : 'Original stock awaiting Store Manager verification and dispatch.'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. THREE SIDE-BY-SIDE PANELS */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* ---------------- PANEL 1 (LEFT): ORIGINAL COURIER ITEMS ---------------- */}
                  <div className="border border-emerald-100 bg-white rounded-xl p-3.5 space-y-3 flex flex-col justify-between shadow-2xs">
                    <div className="space-y-2.5">
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                          <Package className="w-4 h-4 text-emerald-600" />
                          <span>Original Courier Items (Already Issued)</span>
                        </div>
                        {isIssued ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Stock Issued - Completed</span>
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Pending Issuance</span>
                          </span>
                        )}
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              <th className="py-1.5 px-2 w-6">#</th>
                              <th className="py-1.5 px-2">DEVICE / COMPONENT</th>
                              <th className="py-1.5 px-2">SKU</th>
                              <th className="py-1.5 px-2 text-center">REQUIRED</th>
                              <th className="py-1.5 px-2 text-center">ISSUED</th>
                              <th className="py-1.5 px-2 text-center">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {origItems.map((it, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="py-2 px-2 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                                <td className="py-2 px-2 font-bold text-slate-900">{it.name}</td>
                                <td className="py-2 px-2 font-mono text-[11px] text-slate-500">{it.sku}</td>
                                <td className="py-2 px-2 text-center font-bold text-slate-800">{it.required}</td>
                                <td className="py-2 px-2 text-center font-bold text-slate-800">{it.issued}</td>
                                <td className="py-2 px-2 text-center">
                                  {it.status === 'Issued' ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      <Check size={10} className="text-emerald-600" /> Issued
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                      <Clock size={10} className="text-amber-600" /> Pending
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Success notice */}
                      <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg flex items-start gap-2 text-xs text-emerald-900">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {isIssued
                            ? 'Original courier stock has been issued. These devices were issued for the product courier and will not be issued again.'
                            : 'Original stock is awaiting Store Manager inspection and issuance.'}
                        </span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-2">
                      {isIssued ? (
                        <button
                          type="button"
                          onClick={() => setViewIssuanceModalJob(req)}
                          className="w-full py-2 px-3 border border-rose-300 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <Eye className="w-3.5 h-3.5 text-rose-600" />
                          <span>
                            View Original Issuance Details{' '}
                            <span className="font-normal text-[11px] text-rose-600">
                              (View Only - No Additional Issuance)
                            </span>
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIssueModalChecklist(req)}
                          className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <Package className="w-3.5 h-3.5" />
                          <span>Inspect &amp; Issue Stock</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ---------------- PANEL 2 (CENTER): TECHNICIAN EXTRA DEVICE REQUEST ---------------- */}
                  <div className="border border-purple-100 bg-white rounded-xl p-3.5 space-y-3 flex flex-col justify-between shadow-2xs">
                    <div className="space-y-2.5">
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                          <Package className="w-4 h-4 text-purple-600" />
                          <span>Technician Extra Device Request</span>
                        </div>
                        {extraAllInstalled ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Installed - Completed</span>
                          </span>
                        ) : hasExtraPending ? (
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Pending Issuance</span>
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            No Extra Request
                          </span>
                        )}
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              <th className="py-1.5 px-2 w-6">#</th>
                              <th className="py-1.5 px-2">DEVICE / COMPONENT</th>
                              <th className="py-1.5 px-2">SKU</th>
                              <th className="py-1.5 px-2 text-center">REQUESTED</th>
                              <th className="py-1.5 px-2 text-center">ISSUED</th>
                              <th className="py-1.5 px-2 text-center">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {extraItems.length > 0 ? (
                              extraItems.map((it, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                  <td className="py-2 px-2 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                                  <td className="py-2 px-2 font-bold text-slate-900">{it.name}</td>
                                  <td className="py-2 px-2 font-mono text-[11px] text-slate-500">{it.sku}</td>
                                  <td className="py-2 px-2 text-center font-bold text-slate-800">{it.requested}</td>
                                  <td className="py-2 px-2 text-center font-bold text-slate-800">{it.issued}</td>
                                  <td className="py-2 px-2 text-center">
                                    {it.status === 'Installed' || it.status === 'Issued' ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                        <Check size={10} className="text-emerald-600" /> {it.status}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                        <Clock size={10} className="text-amber-600" /> Pending
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="py-4 text-center text-slate-400 text-xs italic">
                                  No extra backup devices requested for this job.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Success / Info note */}
                      <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg flex items-start gap-2 text-xs text-emerald-900">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {extraAllInstalled
                            ? "All requested extra devices have been issued and installed. Installation details are captured from the technician's post-installation form."
                            : hasExtraPending
                            ? 'Technician has requested extra devices. Store Manager authorization required before stock deduction.'
                            : 'No extra backup devices requested.'}
                        </span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-2">
                      {hasExtraPending ? (
                        <button
                          type="button"
                          onClick={() => handleOpenExtraDeviceModal(req)}
                          className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Review &amp; Issue Extra Devices</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenExtraDeviceModal(req)}
                          className="w-full py-2 px-3 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            Review &amp; Issue Extra Devices{' '}
                            <span className="font-normal text-[11px] text-slate-400">(No Pending Request)</span>
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ---------------- PANEL 3 (RIGHT): POST-INSTALLATION DETAILS ---------------- */}
                  <div className="border border-blue-100 bg-white rounded-xl p-3.5 space-y-3 flex flex-col justify-between shadow-2xs">
                    <div className="space-y-2.5">
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                          <FileText className="w-4 h-4 text-blue-600" />
                          <span>Post-Installation Details (From Technician)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setViewPostInstallModalJob(req)}
                          className="border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        >
                          <Eye className="w-3 h-3 text-blue-600" />
                          <span>View Form</span>
                        </button>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              <th className="py-1.5 px-1.5 w-5">#</th>
                              <th className="py-1.5 px-1.5">DEVICE</th>
                              <th className="py-1.5 px-1.5 text-center">ACTION</th>
                              <th className="py-1.5 px-1.5">INSTALLED FOR</th>
                              <th className="py-1.5 px-1.5">NAME / MOBILE</th>
                              <th className="py-1.5 px-1.5">LOCATION</th>
                              <th className="py-1.5 px-1.5 text-center">DATE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {postInstallList.length > 0 ? (
                              postInstallList.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                  <td className="py-2 px-1.5 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                                  <td className="py-2 px-1.5 font-bold text-slate-900 whitespace-nowrap">{row.device}</td>
                                  <td className="py-2 px-1.5 text-center whitespace-nowrap">
                                    {row.action === 'Fixed' ? (
                                      <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                        Fixed
                                      </span>
                                    ) : (
                                      <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                                        Returned
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-1.5 text-slate-700 whitespace-nowrap">{row.installed_for}</td>
                                  <td className="py-2 px-1.5 text-slate-900 font-bold whitespace-nowrap">{row.name_mobile}</td>
                                  <td className="py-2 px-1.5 text-slate-600 truncate max-w-[120px]" title={row.location}>
                                    {row.location}
                                  </td>
                                  <td className="py-2 px-1.5 text-center font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                    {formatDisplayDate(row.date)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7} className="py-4 text-center text-slate-400 text-xs italic">
                                  Post-installation report not yet submitted by technician.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Info Notice Box */}
                      <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg flex items-start gap-2 text-xs text-blue-900">
                        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          This information is filled by the technician in the Post-Installation Form. It shows whether
                          extra devices were fixed to the same customer, fixed to another person, or returned to store.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. COLLAPSIBLE ISSUANCE & INSTALLATION TIMELINE */}
                <div className="border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => toggleTimeline(chkId)}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-slate-950 py-1 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>Issuance &amp; Installation Timeline</span>
                    </div>
                    {isTimelineCollapsed ? (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {!isTimelineCollapsed && (
                    <div className="mt-3 pt-3 pb-1 border-t border-dashed border-slate-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
                        {/* Milestone 1: Original Stock Issued */}
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            isIssued ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
                          }`}>
                            <Check className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-mono text-[11px] text-slate-500 block">
                              {formatDisplayDateTime(req.material_issued_at || req.created_at || '2026-10-26T10:30:00Z')}
                            </span>
                            <span className="font-bold text-slate-900 text-xs block">Original Stock Issued</span>
                            <span className="text-[11px] text-slate-500 block">
                              By: {req.material_issued_by || 'Store Manager'}
                            </span>
                          </div>
                        </div>

                        {/* Milestone 2: Extra Devices Issued */}
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            extraAllInstalled || (extraItems.length > 0 && !hasExtraPending)
                              ? 'bg-emerald-500 text-white'
                              : hasExtraPending
                              ? 'bg-amber-500 text-white'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            <Check className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-mono text-[11px] text-slate-500 block">
                              {formatDisplayDateTime(req.backup_declaration?.issued_at || '2026-10-27T09:15:00Z')}
                            </span>
                            <span className="font-bold text-slate-900 text-xs block">Extra Devices Issued</span>
                            <span className="text-[11px] text-slate-500 block">
                              By: {req.backup_declaration?.issued_by || 'Store Manager'}
                            </span>
                          </div>
                        </div>

                        {/* Milestone 3: Installation Completed */}
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            req.installation_status === 'Completed' || req.is_completion_submitted || postInstallList.length > 0
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            <Check className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-mono text-[11px] text-slate-500 block">
                              {formatDisplayDateTime(req.completion_report?.installation_date || '2026-10-27T15:40:00Z')}
                            </span>
                            <span className="font-bold text-slate-900 text-xs block">Installation Completed</span>
                            <span className="text-[11px] text-slate-500 block">
                              By: Technician ({req.service_engineer || 'Guna'})
                            </span>
                          </div>
                        </div>

                        {/* Milestone 4: Post-Installation Form Submitted */}
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            postInstallList.length > 0 || req.is_completion_submitted
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            <FileText className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-mono text-[11px] text-slate-500 block">
                              {formatDisplayDateTime(req.completion_report?.submission_date || '2026-10-27T16:10:00Z')}
                            </span>
                            <span className="font-bold text-slate-900 text-xs block">Post-Installation Form Submitted</span>
                            <span className="text-[11px] text-slate-500 block">
                              By: Technician ({req.service_engineer || 'Guna'})
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. MODAL 1: VIEW ORIGINAL ISSUANCE DETAILS (VIEW-ONLY) */}
      {viewIssuanceModalJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-black text-slate-900">
                  Original Issuance Details — {viewIssuanceModalJob.checklist_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewIssuanceModalJob(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>View-Only Record:</strong> These items have already been authorized and deducted from warehouse inventory.
                No secondary deductions can occur from this screen.
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500">Customer:</span>{' '}
                  <span className="font-bold text-slate-900">{viewIssuanceModalJob.client_name || viewIssuanceModalJob.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500">Issued By:</span>{' '}
                  <span className="font-bold text-slate-900">{viewIssuanceModalJob.material_issued_by || 'Store Manager'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Issued Date:</span>{' '}
                  <span className="font-bold font-mono text-slate-900">
                    {formatDisplayDateTime(viewIssuanceModalJob.material_issued_at || viewIssuanceModalJob.created_at)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Delivery Method:</span>{' '}
                  <span className="font-bold text-slate-900">{viewIssuanceModalJob.delivery_method}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden mt-3">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Item / Device</th>
                      <th className="py-2 px-3">SKU</th>
                      <th className="py-2 px-3 text-center">Required</th>
                      <th className="py-2 px-3 text-center">Issued</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {(viewIssuanceModalJob.device_items?.length > 0 ? viewIssuanceModalJob.device_items : viewIssuanceModalJob.required_device_items || []).map((d, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3 font-bold text-slate-900">{d.device_type || d.item_name}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{d.sku || 'MAT-CAM-4CH'}</td>
                        <td className="py-2 px-3 text-center">{d.required_quantity ?? d.quantity ?? 1}</td>
                        <td className="py-2 px-3 text-center font-bold text-emerald-700">{d.required_quantity ?? d.quantity ?? 1}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Issued
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(viewIssuanceModalJob.material_items || []).map((m, i) => (
                      <tr key={`m-${i}`}>
                        <td className="py-2 px-3 font-bold text-slate-900">{m.material_name || m.item_name}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{m.sku || 'MAT-CBL-15M'}</td>
                        <td className="py-2 px-3 text-center">{m.required_quantity ?? m.quantity}</td>
                        <td className="py-2 px-3 text-center font-bold text-emerald-700">{m.required_quantity ?? m.quantity}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Issued
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewIssuanceModalJob(null)}
                className="px-4 py-2 font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL 2: VIEW POST-INSTALLATION FORM DETAILS (VIEW-ONLY) */}
      {viewPostInstallModalJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-black text-slate-900">
                  Technician Post-Installation Details — {viewPostInstallModalJob.checklist_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewPostInstallModalJob(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500">Technician:</span>{' '}
                  <span className="font-bold text-slate-900">{viewPostInstallModalJob.service_engineer || 'Guna'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Completed Date:</span>{' '}
                  <span className="font-bold font-mono text-slate-900">
                    {formatDisplayDate(viewPostInstallModalJob.completion_report?.installation_date || viewPostInstallModalJob.expected_arrival_date)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Primary Customer:</span>{' '}
                  <span className="font-bold text-slate-900">{viewPostInstallModalJob.client_name || viewPostInstallModalJob.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500">Status:</span>{' '}
                  <span className="font-bold text-emerald-700">Installation Completed</span>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-slate-600" />
                  <span>Extra Devices &amp; Additional Customer Allocations:</span>
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="py-2 px-2.5">#</th>
                        <th className="py-2 px-2.5">Device</th>
                        <th className="py-2 px-2.5 text-center">Action</th>
                        <th className="py-2 px-2.5">Installed For</th>
                        <th className="py-2 px-2.5">Name / Mobile</th>
                        <th className="py-2 px-2.5">Location</th>
                        <th className="py-2 px-2.5 text-center">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {(viewPostInstallModalJob.post_installation_details || []).map((row, i) => (
                        <tr key={i}>
                          <td className="py-2 px-2.5 text-slate-400 font-mono text-[11px]">{i + 1}</td>
                          <td className="py-2 px-2.5 font-bold text-slate-900">{row.device}</td>
                          <td className="py-2 px-2.5 text-center">
                            {row.action === 'Fixed' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                Fixed
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                                Returned
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-slate-700">{row.installed_for}</td>
                          <td className="py-2 px-2.5 font-bold text-slate-900">{row.name_mobile}</td>
                          <td className="py-2 px-2.5 text-slate-600">{row.location}</td>
                          <td className="py-2 px-2.5 text-center font-mono text-[11px]">{formatDisplayDate(row.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewPostInstallModalJob(null)}
                className="px-4 py-2 font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL 3: VIEW FULL JOB DETAILS */}
      {viewJobDetailsModalJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-black text-slate-900">
                  Job Details — {viewJobDetailsModalJob.checklist_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewJobDetailsModalJob(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Client Information</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500">Client Name:</span>{' '}
                    <span className="font-bold text-slate-900">{viewJobDetailsModalJob.client_name || viewJobDetailsModalJob.customer_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Mobile:</span>{' '}
                    <span className="font-bold text-blue-700">{viewJobDetailsModalJob.client_mobile || viewJobDetailsModalJob.customer_mobile}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">Address / Location:</span>{' '}
                    <span className="font-bold text-slate-900">{viewJobDetailsModalJob.client_location || viewJobDetailsModalJob.location}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Sales &amp; Scheduling</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500">Salesperson:</span>{' '}
                    <span className="font-bold text-slate-900">{viewJobDetailsModalJob.salesperson_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Assigned Technician:</span>{' '}
                    <span className="font-bold text-slate-900">{viewJobDetailsModalJob.service_engineer || 'Unassigned'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Planned Date:</span>{' '}
                    <span className="font-bold font-mono text-slate-900">{viewJobDetailsModalJob.expected_arrival_date || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Duration:</span>{' '}
                    <span className="font-bold text-slate-900">{viewJobDetailsModalJob.installation_duration || '1 Day'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewJobDetailsModalJob(null)}
                className="px-4 py-2 font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. MODAL 4: EXTRA DEVICE REVIEW & ISSUANCE MODAL */}
      {extraDeviceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-black text-slate-900">
                  Review &amp; Issue Extra Backup Devices — {extraDeviceModal.checklist?.checklist_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExtraDeviceModal(null)}
                disabled={submittingExtraIssuance}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {extraIssuanceError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{extraIssuanceError}</span>
              </div>
            )}

            <form onSubmit={handleExtraIssuanceSubmit} className="space-y-4 text-xs">
              <p className="text-slate-600">
                The technician requested extra contingency items. Verify current warehouse usable stock below. Enter quantity to authorize and issue.
              </p>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Device / Item</th>
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3 text-center">Requested</th>
                      <th className="py-2.5 px-3 text-center">Issued</th>
                      <th className="py-2.5 px-3 text-center">Available Stock</th>
                      <th className="py-2.5 px-3 text-center">Quantity to Issue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {(extraDeviceModal.declaration?.items || []).map((it, idx) => {
                      const itemName = it.item_name || it.device_type;
                      const declQty = Number(it.quantity) || 1;
                      const issQty = Number(it.quantity_issued) || 0;
                      const remQty = Math.max(0, declQty - issQty);
                      const availStock = Number(it.available_stock) || 10;
                      const currentVal = extraIssuanceQuantities[itemName] ?? Math.min(remQty, availStock);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-bold text-slate-900">{itemName}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{it.item_sku || it.sku || 'MAT-CAM-4CH'}</td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-800">{declQty}</td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-800">{issQty}</td>
                          <td className="py-2.5 px-3 text-center font-bold font-mono text-slate-900">{availStock}</td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max={Math.min(remQty, availStock)}
                                value={currentVal}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(Number(e.target.value) || 0, Math.min(remQty, availStock)));
                                  setExtraIssuanceQuantities((prev) => ({
                                    ...prev,
                                    [itemName]: val,
                                  }));
                                }}
                                disabled={submittingExtraIssuance || remQty === 0}
                                className="w-16 p-1 text-center border border-purple-300 rounded-lg font-mono font-bold text-purple-950 focus:outline-none focus:border-purple-500"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setExtraIssuanceQuantities((prev) => ({
                                    ...prev,
                                    [itemName]: Math.min(remQty, availStock),
                                  }));
                                }}
                                disabled={submittingExtraIssuance || remQty === 0}
                                className="px-2 py-1 text-[10px] bg-purple-100 hover:bg-purple-200 text-purple-900 rounded font-bold cursor-pointer"
                              >
                                Max
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Store Manager Authorization Remarks
                </label>
                <input
                  type="text"
                  value={extraIssuanceRemarks}
                  onChange={(e) => setExtraIssuanceRemarks(e.target.value)}
                  placeholder="e.g. Authorized extra devices for client site backup from main store"
                  className="w-full p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleExtraIssuanceReject}
                  disabled={submittingExtraIssuance}
                  className="px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  Reject Request
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExtraDeviceModal(null)}
                    disabled={submittingExtraIssuance}
                    className="px-4 py-2 font-bold text-xs text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingExtraIssuance || Object.values(extraIssuanceQuantities).reduce((a, b) => a + (Number(b) || 0), 0) === 0}
                    className="px-5 py-2 font-bold text-xs text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{submittingExtraIssuance ? 'Authorizing & Deducting Stock...' : 'Authorize & Issue Stock'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
