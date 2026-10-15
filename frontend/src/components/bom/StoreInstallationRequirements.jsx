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
  ExternalLink,
  Phone,
  MapPin,
  Filter,
  Check,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  HardDrive,
  User,
  Info,
  FileDown,
  Calendar,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  fetchStoreMaterialRequirements,
  syncStoreMaterialRequirements,
  downloadStoreRequirementPDF,
  downloadInstallationPDF,
  verifyStoreMaterialReturnApi,
  verifyStoreBackupReturns,
} from '../../lib/api';
import IssueMaterialsModal from './IssueMaterialsModal';

export default function StoreInstallationRequirements({ token, onSelectChecklist }) {
  const [requirements, setRequirements] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    installationCount: 0,
    serviceCount: 0,
    pendingCount: 0,
    shortageCounter: 0,
    issuedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [shortageOnly, setShortageOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [issueModalChecklist, setIssueModalChecklist] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

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
        installationCount: 0,
        serviceCount: 0,
        pendingCount: 0,
        shortageCounter: 0,
        issuedCount: 0,
      });
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('Failed to load store material requirements:', err);
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

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await syncStoreMaterialRequirements(token);
      showToast(`Synced ${res.synced_count || 0} checklist requirement records!`);
      loadRequirements();
    } catch (err) {
      console.error('Failed to sync requirements:', err);
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

  const handleVerifyMaterialReturn = async (e) => {
    e.preventDefault();
    if (!token || !returnVerificationModal) return;
    setVerificationError('');
    setSubmittingVerification(true);
    try {
      await verifyStoreMaterialReturnApi(token, returnVerificationModal.checklistId, {
        return_id: returnVerificationModal.return_id,
        accepted_usable_qty: parseFloat(returnForm.accepted_usable_qty) || 0,
        damaged_qty: parseFloat(returnForm.damaged_qty) || 0,
        missing_qty: parseFloat(returnForm.missing_qty) || 0,
        remarks: returnForm.remarks.trim(),
      });
      showToast(`Physical return verified for ${returnVerificationModal.checklistNumber}! Usable warehouse stock updated.`);
      setReturnVerificationModal(null);
      loadRequirements();
    } catch (err) {
      setVerificationError(err.message || 'Failed to verify material return');
    } finally {
      setSubmittingVerification(false);
    }
  };

  const handleOpenBackupReturnModal = (checklistId, checklistNumber, backupItems) => {
    setBackupReturnError('');
    setBackupReturnRemarks('');
    setBackupReturnRows(
      (backupItems || []).map((item) => ({
        item_name: item.item_name,
        unit: item.unit || 'Nos.',
        declared_carried: Number(item.quantity) || 0,
        quantity_returned: Number(item.quantity_returned) || 0,
        accepted_usable_qty: Number(item.quantity_returned) || 0,
        damaged_qty: Number(item.quantity_damaged) || 0,
        missing_qty: Number(item.quantity_missing) || 0,
      }))
    );
    setBackupReturnModal({ checklistId, checklistNumber });
  };

  const handleVerifyBackupReturnSubmit = async (e) => {
    e.preventDefault();
    if (!token || !backupReturnModal) return;
    setBackupReturnError('');
    setSubmittingBackupReturn(true);
    try {
      await verifyStoreBackupReturns(token, backupReturnModal.checklistId, {
        verification_items: backupReturnRows.map((r) => ({
          item_name: r.item_name,
          accepted_usable_qty: parseFloat(r.accepted_usable_qty) || 0,
          damaged_qty: parseFloat(r.damaged_qty) || 0,
          missing_qty: parseFloat(r.missing_qty) || 0,
        })),
        remarks: backupReturnRemarks.trim(),
      });
      showToast(`Physical return verified for loose backup items of ${backupReturnModal.checklistNumber}! Usable store stock updated.`);
      setBackupReturnModal(null);
      loadRequirements();
    } catch (err) {
      setBackupReturnError(err.message || 'Failed to verify backup item returns');
    } finally {
      setSubmittingBackupReturn(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Issuance Modal */}
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

      {/* SECTION TITLE BANNER */}
      <div className="bg-gradient-to-r from-navy via-slate-900 to-indigo-950 text-white p-5 rounded-2xl shadow-sm border border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-md border border-amber-400/30 uppercase tracking-wider">
            Store Manager Workspace
          </span>
          <h2 className="text-xl font-black mt-1.5 flex items-center gap-2 text-white">
            <Package className="w-6 h-6 text-amber-400" />
            <span>Incoming Installation Jobs &amp; Material Requirements</span>
          </h2>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Live copy of Sales installation checklists, device specifications, assigned engineers, salesperson tracking, and automatically aggregated BOM requirements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncing}
            className="px-4 py-2 text-xs font-bold text-navy bg-amber-400 hover:bg-amber-300 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh and sync requirements from checklists"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync All Jobs</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Total Requirements</span>
          <span className="text-xl font-black text-gray-900 mt-1 block">{summary.total || 0}</span>
          <span className="text-[10px] text-gray-400 mt-0.5 block">Synced from sales jobs</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-blue-200 shadow-2xs bg-blue-50/20">
          <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Installation Jobs</span>
          <span className="text-xl font-black text-blue-900 mt-1 block">{summary.installationCount || 0}</span>
          <span className="text-[10px] text-blue-600/70 mt-0.5 block">BOM calculated</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-purple-200 shadow-2xs bg-purple-50/20">
          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">Service Jobs</span>
          <span className="text-xl font-black text-purple-900 mt-1 block">{summary.serviceCount || 0}</span>
          <span className="text-[10px] text-purple-600/70 mt-0.5 block">Direct tech support</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-amber-200 shadow-2xs bg-amber-50/30">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Pending Issuance</span>
          <span className="text-xl font-black text-amber-900 mt-1 block">{summary.pendingCount || 0}</span>
          <span className="text-[10px] text-amber-600/70 mt-0.5 block">Awaiting Store Manager</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-rose-200 shadow-2xs bg-rose-50/40">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Stock Shortages</span>
          <span className="text-xl font-black text-rose-900 mt-1 block">{summary.shortageCounter || 0}</span>
          <span className="text-[10px] text-rose-600/70 mt-0.5 block">Deficits in warehouse</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-2xs bg-emerald-50/20">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Stock Issued</span>
          <span className="text-xl font-black text-emerald-900 mt-1 block">{summary.issuedCount || 0}</span>
          <span className="text-[10px] text-emerald-600/70 mt-0.5 block">Deducted from store</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Checklist #, Client Name, Mobile, or Location..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Job Type Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium">Job:</span>
            <select
              value={jobTypeFilter}
              onChange={(e) => {
                setJobTypeFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-amber-500"
            >
              <option value="All">All Jobs</option>
              <option value="Installation">Installation Only</option>
              <option value="Service">Service Only</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-amber-500"
            >
              <option value="All">All Statuses</option>
              <option value="PENDING">Pending Store Review</option>
              <option value="ISSUED">Stock Issued</option>
              <option value="NOT_APPLICABLE">Not Applicable (Service)</option>
            </select>
          </div>

          {/* Shortage Toggle */}
          <button
            type="button"
            onClick={() => {
              setShortageOnly(!shortageOnly);
              setPage(1);
            }}
            className={`py-1.5 px-3 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
              shortageOnly
                ? 'bg-rose-100 text-rose-800 border-rose-300 shadow-2xs'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${shortageOnly ? 'text-rose-600' : 'text-gray-400'}`} />
            <span>Shortages Only</span>
          </button>

          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncing}
            className="py-1.5 px-3 rounded-lg text-gray-600 hover:bg-gray-100 font-semibold border border-gray-200 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            title="Sync all requirements from existing checklists"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Requirements List */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-gray-600">Loading installation & service requirements...</p>
        </div>
      ) : requirements.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-3">
          <Package className="w-10 h-10 text-gray-300 mx-auto" />
          <h3 className="text-sm font-bold text-gray-800">No Job Requirements Found</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            {search || jobTypeFilter !== 'All' || statusFilter !== 'All' || shortageOnly
              ? 'No checklist records match the current filter criteria.'
              : 'When Sales submits an Installation Initiation Checklist, its camera models, material requirements, and client details will automatically appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requirements.map((req) => {
            const isService = req.job_type === 'Service';
            const isIssued = req.material_issuance_status === 'ISSUED';
            const hasShortage = Boolean(req.has_shortage);
            const isExpanded = expandedCards.has(req.id || req.checklist_id);
            const materialItems = Array.isArray(req.material_items) ? req.material_items : [];
            const reqDeviceItems = Array.isArray(req.required_device_items) && req.required_device_items.length > 0
              ? req.required_device_items
              : (req.device_configurations || []).map((c) => ({
                  device_type: c.device_type,
                  quantity: c.number_of_devices || 1,
                }));
            const extraDeviceItems = Array.isArray(req.extra_device_items)
              ? req.extra_device_items
              : [];
            const deviceItems = Array.isArray(req.device_items) && req.device_items.length > 0
              ? req.device_items
              : (reqDeviceItems.length > 0 ? reqDeviceItems.map((d) => ({
                  device_type: d.device_type,
                  required_quantity: d.quantity || 1,
                  unit: 'Nos.',
                  available_stock: 0,
                  shortage: 0,
                })) : []);

            return (
              <div
                key={req.id || req.checklist_id}
                className={`bg-white rounded-2xl border transition-all shadow-xs ${
                  hasShortage && !isIssued && !isService
                    ? 'border-rose-300 hover:border-rose-400'
                    : isIssued
                    ? 'border-emerald-200 hover:border-emerald-300'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Header Card */}
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200">
                        {req.checklist_number}
                      </span>

                      {/* Job Type Badge */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isService
                            ? 'bg-purple-100 text-purple-800 border border-purple-300'
                            : 'bg-blue-100 text-blue-800 border border-blue-200'
                        }`}
                      >
                        {req.job_type}
                      </span>

                      {/* BOM Availability Status Badge */}
                      {isService ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          BOM Not Applicable (Service Call)
                        </span>
                      ) : req.bom_availability_status === 'Available' ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          BOM Available
                        </span>
                      ) : req.bom_availability_status === 'Out of Stock' ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          BOM Out of Stock ({req.shortage_count || 1} Short)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          BOM Partially Available ({req.shortage_count || 1} Short)
                        </span>
                      )}

                      {/* Store Stock Issuance Status */}
                      {!isService && (
                        isIssued ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" />
                            Stock Issued from Store
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            Issuance Pending
                          </span>
                        )
                      )}
                    </div>

                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-3 pt-0.5">
                      <span>Submitted: <strong>{new Date(req.submission_date || req.created_at).toLocaleString('en-IN')}</strong></span>
                      {req.material_issued_at && (
                        <span>Issued: <strong className="text-emerald-700">{new Date(req.material_issued_at).toLocaleString('en-IN')}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(req.id || req.checklist_id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs ${
                        isExpanded
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-200'
                      }`}
                      title={isExpanded ? 'Collapse Material Requirements' : 'View Full Material Requirements & Live Stock'}
                    >
                      <span>{isExpanded ? 'Hide Requirements' : 'View Material Requirements'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-amber-700" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(req.checklist_id || req.id, req.checklist_number)}
                      className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Download/Print Store Manager Device & Material Requirement Sheet"
                    >
                      <FileDown className="w-3.5 h-3.5 text-blue-600" />
                      <span>Store Manager PDF</span>
                    </button>

                    {!isService && !isIssued && (
                      <button
                        type="button"
                        onClick={() => setIssueModalChecklist({
                          id: req.checklist_id || req.id,
                          checklist_number: req.checklist_number,
                          client_name: req.client_name,
                          device_items: deviceItems,
                          device_configurations: req.device_configurations,
                          bom_snapshot: req.bom_snapshot,
                          material_items: materialItems,
                        })}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>Issue Materials</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectChecklist && onSelectChecklist(req.checklist_id || req.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                      title="View full installation checklist details"
                    >
                      <Eye className="w-3.5 h-3.5 text-gray-400" />
                      <span>Checklist</span>
                    </button>
                  </div>
                </div>

                {/* Client, Job, Team & Device Summary */}
                <div className="p-5 bg-slate-50/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                  {/* Col 1: Client Information */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Client Information</span>
                    <span className="font-bold text-gray-900 text-sm flex items-center gap-1.5 mt-0.5">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      {req.client_name}
                    </span>
                    <a
                      href={`tel:${req.client_mobile}`}
                      className="text-blue-600 hover:text-blue-800 font-mono flex items-center gap-1 mt-0.5"
                    >
                      <Phone className="w-3 h-3 text-gray-400" />
                      {req.client_mobile}
                    </a>
                    <div className="text-gray-600 flex items-start gap-1 mt-1 text-[11px]">
                      <MapPin className="w-3 h-3 text-rose-500 shrink-0 mt-0.5" />
                      <span>{req.client_location || 'Not provided'}</span>
                    </div>
                    {req.google_maps_location && (
                      <a
                        href={req.google_maps_location}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-700 hover:underline flex items-center gap-1 font-semibold mt-1 text-[11px]"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Google Maps</span>
                      </a>
                    )}
                  </div>

                  {/* Col 2: Salesperson & Team Assignment */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Team &amp; Salesperson</span>
                    <div className="mt-1 space-y-1">
                      <div className="text-[11px]">
                        <span className="text-gray-500 block text-[10px]">Salesperson Name:</span>
                        <span className="font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block mt-0.5">
                          {req.salesperson_name || '—'}
                        </span>
                      </div>
                      <div className="text-[11px] pt-0.5">
                        <span className="text-gray-500">Service Engineer: </span>
                        <strong className="text-gray-900">{req.service_engineer || 'Unassigned'}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Col 3: Device Models & Quantities Carried */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Required Devices &amp; Backup</span>
                    <div className="mt-1 space-y-1.5 min-w-[170px]">
                      {/* Required Devices */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-blue-700 block uppercase">Required for Installation:</span>
                        {reqDeviceItems.map((d, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] bg-blue-50/60 px-1.5 py-0.5 rounded border border-blue-100">
                            <span className="font-semibold text-gray-900 truncate">{d.device_type}</span>
                            <span className="font-mono text-blue-800 font-bold shrink-0">{d.quantity ?? d.number_of_devices ?? 1} req</span>
                          </div>
                        ))}
                      </div>

                      {/* Extra Backup Items Expected Flag */}
                      <div className="pt-0.5">
                        <span className="text-[10px] text-gray-500 block uppercase font-bold">Extra Backup Items:</span>
                        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border mt-0.5 ${
                          req.carry_extra_backup_items
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {req.carry_extra_backup_items ? 'Yes (Carried by Tech)' : 'No (None expected)'}
                        </span>
                      </div>

                      {extraDeviceItems.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          <span className="text-[10px] font-bold text-amber-800 block uppercase">Legacy Extra Devices:</span>
                          {extraDeviceItems.map((d, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] bg-amber-50/70 px-1.5 py-0.5 rounded border border-amber-200">
                              <span className="font-semibold text-gray-900 truncate">{d.device_type}</span>
                              <span className="font-mono text-amber-900 font-bold shrink-0">+{d.extra_quantity ?? 1}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="pt-1 border-t border-gray-200/80 flex items-center justify-between font-bold text-[11px]">
                        <span className="text-navy">Required Device Sets:</span>
                        <span className="font-mono text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {req.number_of_devices || req.total_devices_required || 1} Sets
                        </span>
                      </div>
                      {req.number_of_vehicles && (
                        <div className="text-[10px] text-gray-500">
                          Vehicles: {req.number_of_vehicles}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Col 4: Arrival Schedule & Duration */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Arrival Schedule</span>
                    <div className="mt-1 space-y-1 text-[11px]">
                      <div>
                        <span className="text-gray-400 block text-[10px] uppercase font-bold">Original Planned:</span>
                        <strong className="text-gray-900">
                          {req.original_arrival_date || req.expected_arrival_date || 'TBD'}
                        </strong>
                        <span className="text-gray-500 ml-1">
                          ({req.original_installation_duration || req.installation_duration || '1'}d)
                        </span>
                        {req.expected_arrival_time && (
                          <div className="text-gray-500 text-[10px] font-mono">{req.expected_arrival_time}</div>
                        )}
                      </div>

                      {(req.schedule_revision_count > 0 || req.current_expected_arrival_date) && (
                        <div className="pt-1 border-t border-amber-200/60 mt-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-amber-800 uppercase">Current Expected:</span>
                            <span className="text-[9px] font-extrabold bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded border border-amber-300">
                              Rev {req.schedule_revision_count || 1}
                            </span>
                          </div>
                          <strong className="text-amber-950 block text-[11px]">
                            {req.current_expected_arrival_date || req.expected_arrival_date}
                          </strong>
                          <span className="text-amber-800 text-[10px]">
                            Duration: {req.current_installation_duration || req.installation_duration || '1'} Days
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Col 5: BOM Stock & Warehouse Status */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">BOM Status</span>
                    {isService ? (
                      <span className="text-purple-700 font-medium block mt-1 text-[11px]">
                        Service Call • Direct Tech Support
                      </span>
                    ) : (
                      <div className="mt-1 space-y-1">
                        <span className="text-gray-700 block font-bold">
                          {materialItems.length} BOM Material Types
                        </span>
                        <div>
                          {req.bom_availability_status === 'Available' ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md inline-block">
                              ✓ All Materials Available
                            </span>
                          ) : req.bom_availability_status === 'Out of Stock' ? (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md inline-block">
                              ✕ Out of Stock ({req.shortage_count} Short)
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md inline-block">
                              ⚠ Partially Available ({req.shortage_count} Short)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Service Job Notice Banner */}
                {isService && (
                  <div className="p-4 bg-slate-50 border-t border-gray-100 flex items-center gap-3 text-xs text-slate-700">
                    <Info className="w-4 h-4 text-purple-600 shrink-0" />
                    <span>
                      <strong>Service Call:</strong> Client, location, device details, assigned engineer, salesperson, and checklist number are recorded. No automatic installation BOM is generated or deducted.
                    </span>
                  </div>
                )}

                {/* Expanded Detailed Breakdown (Separating Camera Devices & Materials) */}
                {!isService && isExpanded && (
                  <div className="border-t border-gray-200 p-5 space-y-6 bg-white">
                    {/* SECTION 1: Camera Devices Allocation & Store Dispatch */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-gray-800 flex items-center gap-2">
                          <HardDrive className="w-4 h-4 text-blue-600" />
                          <span>1. Camera Devices Allocation &amp; Store Issuance</span>
                        </h4>
                        <span className="text-[11px] text-gray-500">Tracked separately from installation materials</span>
                      </div>

                      {/* 1A. Required Installation Devices */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                          1A. Required Installation Devices (Customer Job)
                        </span>
                        <div className="border border-blue-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-blue-50/80 border-b border-blue-100 text-[10px] font-bold text-blue-900 uppercase">
                              <tr>
                                <th className="py-2 px-3 w-12 text-center">#</th>
                                <th className="py-2 px-3">Device Model</th>
                                <th className="py-2 px-3 text-center">Required Quantity</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-blue-50">
                              {reqDeviceItems.map((d, idx) => (
                                <tr key={idx} className="hover:bg-blue-50/40">
                                  <td className="py-2 px-3 text-center font-mono text-gray-400">{idx + 1}</td>
                                  <td className="py-2 px-3 font-bold text-gray-900">{d.device_type}</td>
                                  <td className="py-2 px-3 text-center font-bold text-blue-900 font-mono">
                                    {d.quantity ?? d.number_of_devices ?? 1} Nos.
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 1B. Pre-Installation Loose Backup Items (Separate from Sales BOM) */}
                      <div className="space-y-2 pt-2 border-t border-blue-100">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5 text-amber-600" />
                              <span>1B. Pre-Installation Loose Backup Items (Separate from Sales BOM)</span>
                            </span>
                            <span className="text-[10px] text-gray-500 block">
                              Technician backup items: <strong>{req.carry_extra_backup_items ? 'Yes (Carried by Tech)' : 'No (None)'}</strong>. Loose backup items do NOT increase Sales BOM or device set counts.
                            </span>
                          </div>
                          {req.backup_declaration?.items?.some((it) => Number(it.quantity_returned) > 0) && (
                            <button
                              type="button"
                              onClick={() => handleOpenBackupReturnModal(req.checklist_id || req.id, req.checklist_number, req.backup_declaration.items)}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer transition-all self-start sm:self-auto"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Verify Loose Backup Returns</span>
                            </button>
                          )}
                        </div>

                        {req.backup_declaration?.items && req.backup_declaration.items.length > 0 ? (
                          <div className="border border-amber-200 rounded-xl overflow-x-auto bg-amber-50/20">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-amber-100/70 border-b border-amber-200 text-[10px] font-bold text-amber-950 uppercase">
                                <tr>
                                  <th className="py-2 px-3 w-10 text-center">#</th>
                                  <th className="py-2 px-3">Item Name</th>
                                  <th className="py-2 px-3">SKU</th>
                                  <th className="py-2 px-3 text-center">Declared Carried</th>
                                  <th className="py-2 px-3 text-center">Unit</th>
                                  <th className="py-2 px-3 text-center">Used on Site</th>
                                  <th className="py-2 px-3 text-center">Returned</th>
                                  <th className="py-2 px-3 text-center">Damaged</th>
                                  <th className="py-2 px-3 text-center">Missing</th>
                                  <th className="py-2 px-3">Discrepancy Notes</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {req.backup_declaration.items.map((it, idx) => (
                                  <tr key={idx} className="hover:bg-amber-50/50">
                                    <td className="py-2 px-3 text-center font-mono text-gray-400">{idx + 1}</td>
                                    <td className="py-2 px-3 font-bold text-gray-900">{it.item_name}</td>
                                    <td className="py-2 px-3 font-mono text-[11px] text-gray-500">{it.item_sku || it.sku || '—'}</td>
                                    <td className="py-2 px-3 text-center font-bold text-amber-900 font-mono">{it.quantity}</td>
                                    <td className="py-2 px-3 text-center text-gray-600">{it.unit || 'Nos.'}</td>
                                    <td className="py-2 px-3 text-center font-mono text-blue-700">{it.quantity_used || 0}</td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">{it.quantity_returned || 0}</td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-rose-700">{it.quantity_damaged > 0 ? it.quantity_damaged : 0}</td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-amber-700">{it.quantity_missing > 0 ? it.quantity_missing : 0}</td>
                                    <td className="py-2 px-3 text-[11px] text-gray-600">{it.discrepancy_reason || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : req.backup_declaration?.has_backup_items === false ? (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-700 flex items-center gap-2">
                            <Info className="w-4 h-4 text-blue-600 shrink-0" />
                            <span>
                              Technician confirmed no extra backup items were carried to site.
                              {req.backup_declaration.no_items_reason && (
                                <span className="font-semibold text-gray-900 ml-1">Reason: &ldquo;{req.backup_declaration.no_items_reason}&rdquo;</span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>
                              Pre-installation loose items declaration pending from technician before job initiation.
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Legacy Extra Devices Carried (if any) */}
                      {extraDeviceItems.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
                            Legacy Extra Devices Carried to Site
                          </span>
                          <div className="border border-amber-200 rounded-xl overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-amber-50 border-b border-amber-200 text-[10px] font-bold text-amber-900 uppercase">
                                <tr>
                                  <th className="py-2 px-3 w-12 text-center">#</th>
                                  <th className="py-2 px-3">Device Model</th>
                                  <th className="py-2 px-3 text-center">Extra Quantity Carried</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {extraDeviceItems.map((d, idx) => (
                                  <tr key={idx} className="hover:bg-amber-50/40">
                                    <td className="py-2 px-3 text-center font-mono text-amber-600">{idx + 1}</td>
                                    <td className="py-2 px-3 font-bold text-gray-900">{d.device_type}</td>
                                    <td className="py-2 px-3 text-center font-bold text-amber-900 font-mono">
                                      +{d.extra_quantity ?? 1} Nos.
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 1C. Total Device Quantity to Issue & Stock Availability */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-purple-900 uppercase tracking-wider block">
                          1C. Total Quantity to Issue for Each Device Type &amp; Usable Stock
                        </span>
                        <div className="border border-purple-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-purple-50 border-b border-purple-100 text-[10px] font-bold text-purple-900 uppercase">
                              <tr>
                                <th className="py-2.5 px-3">Device Model</th>
                                <th className="py-2.5 px-3">SKU</th>
                                <th className="py-2.5 px-3 text-center">Total Quantity to Issue</th>
                                <th className="py-2.5 px-3 text-center">Available Usable Stock</th>
                                <th className="py-2.5 px-3 text-center">Shortage</th>
                                <th className="py-2.5 px-3 text-center">Warehouse Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-purple-50">
                              {deviceItems.map((d, idx) => {
                                const dShortage = Number(d.shortage) || 0;
                                const dAvail = Number(d.available_stock) || 0;
                                const dReq = Number(d.required_quantity ?? d.quantity_carried) || 1;
                                const devStatus = d.availability_status || (dAvail >= dReq ? 'Available' : dAvail > 0 ? 'Partially Available' : 'Out of Stock');

                                return (
                                  <tr key={idx} className={devStatus === 'Out of Stock' ? 'bg-rose-50/40' : devStatus === 'Partially Available' ? 'bg-amber-50/30' : 'hover:bg-purple-50/20'}>
                                    <td className="py-2.5 px-3 font-bold text-gray-900">{d.device_type}</td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">{d.sku || 'N/A'}</td>
                                    <td className="py-2.5 px-3 text-center font-bold text-purple-900 font-mono">{dReq} Nos.</td>
                                    <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{dAvail} Nos.</td>
                                    <td className="py-2.5 px-3 text-center font-mono font-bold text-rose-700">{dShortage > 0 ? `${dShortage} Nos.` : '0'}</td>
                                    <td className="py-2.5 px-3 text-center">
                                      {devStatus === 'Available' ? (
                                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600" /> Available
                                        </span>
                                      ) : devStatus === 'Partially Available' ? (
                                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <Clock className="w-3 h-3 text-amber-600" /> Partially Available
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-bold text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <AlertTriangle className="w-3 h-3 text-rose-600" /> Out of Stock
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
                    </div>

                    {/* SECTION 2: Installation Materials Availability */}
                    {materialItems.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-800 flex items-center gap-2">
                            <Layers className="w-4 h-4 text-amber-600" />
                            <span>2. Installation Materials Stock &amp; Shortages</span>
                          </h4>
                          <span className="text-[11px] text-gray-500">{materialItems.length} configured materials</span>
                        </div>

                        <div className="border border-gray-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase">
                              <tr>
                                <th className="py-2.5 px-3 w-10 text-center">#</th>
                                <th className="py-2.5 px-3">Material Name</th>
                                <th className="py-2.5 px-3">SKU</th>
                                <th className="py-2.5 px-3 text-center">Qty / Device</th>
                                <th className="py-2.5 px-3 text-center">Calculated Total Req</th>
                                <th className="py-2.5 px-3 text-center">Unit</th>
                                <th className="py-2.5 px-3 text-center">Available in Store</th>
                                <th className="py-2.5 px-3 text-center">Shortage</th>
                                <th className="py-2.5 px-3 text-center">Warehouse Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {materialItems.map((item, idx) => {
                                const itemShortage = Number(item.shortage) || 0;
                                const availableStock = Number(item.available_stock) || 0;
                                const requiredQty = Number(item.total_required_quantity) || 0;
                                const availStatus = item.availability_status || (availableStock >= requiredQty ? 'Available' : availableStock > 0 ? 'Partially Available' : 'Out of Stock');

                                return (
                                  <tr key={idx} className={availStatus === 'Out of Stock' ? 'bg-rose-50/40' : availStatus === 'Partially Available' ? 'bg-amber-50/30' : 'hover:bg-gray-50/50'}>
                                    <td className="py-2.5 px-3 text-center text-gray-400 font-mono">{idx + 1}</td>
                                    <td className="py-2.5 px-3 font-semibold text-gray-900">{item.material_name}</td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">{item.sku || 'N/A'}</td>
                                    <td className="py-2.5 px-3 text-center text-gray-600 font-medium">
                                      {item.quantity_per_device !== undefined ? `${item.quantity_per_device}` : 'Combined'}
                                    </td>
                                    <td className="py-2.5 px-3 text-center font-bold text-gray-900">{requiredQty}</td>
                                    <td className="py-2.5 px-3 text-center text-gray-500 font-medium">{item.unit}</td>
                                    <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{availableStock}</td>
                                    <td className="py-2.5 px-3 text-center font-mono font-bold text-rose-700">{itemShortage > 0 ? itemShortage : 0}</td>
                                    <td className="py-2.5 px-3 text-center">
                                      {availStatus === 'Available' ? (
                                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600" /> Available
                                        </span>
                                      ) : availStatus === 'Partially Available' ? (
                                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <Clock className="w-3 h-3 text-amber-600" /> Partially Available
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-bold text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <AlertTriangle className="w-3 h-3 text-rose-600" /> Out of Stock
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

                    {/* SECTION 3: Installation Completion, Final Installed BOM & Physical Returns Verification */}
                    {(req.final_bom_snapshot || req.completion_report || req.is_completion_submitted || req.installation_status === 'Completed' || (Array.isArray(req.actual_materials_used) && req.actual_materials_used.length > 0)) && (
                      <div className="space-y-4 pt-4 border-t border-gray-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gradient-to-r from-blue-900 to-indigo-950 p-3.5 rounded-xl text-white">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 uppercase tracking-wider">
                                Technical Installation Completed
                              </span>
                              {req.material_return_status === 'PENDING_STORE_VERIFICATION' ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/30 text-amber-200 border border-amber-400/40 uppercase tracking-wider flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-amber-300" /> Pending Physical Return Verification
                                </span>
                              ) : req.material_return_status === 'VERIFIED_ACCEPTED' ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 uppercase tracking-wider flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-300" /> Verified &amp; Credited
                                </span>
                              ) : null}
                            </div>
                            <h4 className="text-sm font-black mt-1 text-white flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              <span>3. Actual Installation Report, Final BOM &amp; Physical Stock Returns</span>
                            </h4>
                          </div>

                          {/* Action button if pending return verification */}
                          {req.material_return_status === 'PENDING_STORE_VERIFICATION' && (
                            <button
                              type="button"
                              onClick={() => {
                                const retItems = req.actual_materials_returned || [];
                                const firstRet = retItems[0] || {};
                                setReturnVerificationModal({
                                  checklistId: req.checklist_id || req.id,
                                  checklistNumber: req.checklist_number,
                                  return_id: req.material_returns?.[0]?.id,
                                  items: retItems,
                                  total_qty: retItems.reduce((acc, m) => acc + (Number(m.quantity_returned) || 0), 0),
                                });
                                setReturnForm({
                                  accepted_usable_qty: String(firstRet.quantity_returned || firstRet.declared_return_qty || ''),
                                  damaged_qty: '0',
                                  missing_qty: '0',
                                  remarks: '',
                                });
                                setVerificationError('');
                              }}
                              className="px-3.5 py-1.5 text-xs font-bold text-navy bg-amber-400 hover:bg-amber-300 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Verify Physical Returns</span>
                            </button>
                          )}
                        </div>

                        {/* 3A: Device Reconciliation Breakdown */}
                        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                          <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wider block">
                            3A. Carried Devices vs Installed &amp; Returned Reconciliation
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center text-xs">
                            <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                              <span className="text-[10px] text-gray-500 font-semibold uppercase block">Total Carried</span>
                              <span className="text-base font-black text-gray-900 mt-0.5 block font-mono">
                                {req.final_bom_snapshot?.summary?.total_carried_devices ?? req.total_devices_carried ?? req.number_of_devices ?? 0} Nos.
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-lg border border-blue-200 bg-blue-50/30">
                              <span className="text-[10px] text-blue-700 font-semibold uppercase block">Req. Installed</span>
                              <span className="text-base font-black text-blue-900 mt-0.5 block font-mono">
                                {req.final_bom_snapshot?.summary?.required_installed_count ?? (req.device_items?.length || 1)} Nos.
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-lg border border-indigo-200 bg-indigo-50/30">
                              <span className="text-[10px] text-indigo-700 font-semibold uppercase block">Extra Installed</span>
                              <span className="text-base font-black text-indigo-900 mt-0.5 block font-mono">
                                {req.final_bom_snapshot?.summary?.extra_installed_count ?? 0} Nos.
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/30">
                              <span className="text-[10px] text-emerald-700 font-semibold uppercase block">Total Installed</span>
                              <span className="text-base font-black text-emerald-900 mt-0.5 block font-mono">
                                {req.final_bom_snapshot?.summary?.total_installed_devices ?? req.number_of_devices ?? 0} Nos.
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-lg border border-amber-200 bg-amber-50/40">
                              <span className="text-[10px] text-amber-700 font-semibold uppercase block">Unused Returned</span>
                              <span className="text-base font-black text-amber-900 mt-0.5 block font-mono">
                                {req.final_bom_snapshot?.summary?.unused_returned_devices ?? 0} Nos.
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-lg border border-rose-200 bg-rose-50/30">
                              <span className="text-[10px] text-rose-700 font-semibold uppercase block">Damaged / Missing</span>
                              <span className="text-base font-black text-rose-900 mt-0.5 block font-mono">
                                {(req.final_bom_snapshot?.summary?.damaged_devices || 0) + (req.final_bom_snapshot?.summary?.missing_devices || 0)} Nos.
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 italic">
                            Formula: Final BOM is strictly computed for the {req.final_bom_snapshot?.summary?.total_installed_devices ?? 'actually installed'} devices. Unused extra devices do not contribute to final BOM materials.
                          </p>
                        </div>

                        {/* 3B: Preliminary BOM vs Final BOM & Actual Usage Comparison Table */}
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wider block">
                            3B. Preliminary BOM vs Final Installed BOM &amp; Actual Material Consumption
                          </span>
                          <div className="border border-gray-200 rounded-xl overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-slate-100 border-b border-gray-200 text-[10px] font-bold text-gray-700 uppercase">
                                <tr>
                                  <th className="py-2.5 px-3">#</th>
                                  <th className="py-2.5 px-3">Material Name</th>
                                  <th className="py-2.5 px-3 text-center">Unit</th>
                                  <th className="py-2.5 px-3 text-center bg-blue-50/50">Preliminary BOM (Carried)</th>
                                  <th className="py-2.5 px-3 text-center bg-emerald-50/50">Final BOM (Installed)</th>
                                  <th className="py-2.5 px-3 text-center">Variance (Diff)</th>
                                  <th className="py-2.5 px-3 text-center">Actual Issued</th>
                                  <th className="py-2.5 px-3 text-center">Actual Used</th>
                                  <th className="py-2.5 px-3 text-center">Unused Returned</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {((req.final_bom_snapshot?.comparison && req.final_bom_snapshot.comparison.length > 0)
                                  ? req.final_bom_snapshot.comparison
                                  : (req.material_items || []).map((m) => ({
                                      material_name: m.material_name,
                                      unit: m.unit,
                                      preliminary_quantity: m.total_required_quantity || 0,
                                      final_quantity: m.total_required_quantity || 0,
                                      difference: 0,
                                      actual_quantity_issued: m.total_required_quantity || 0,
                                      actual_quantity_used: m.total_required_quantity || 0,
                                      actual_quantity_returned: 0,
                                    }))
                                ).map((row, idx) => (
                                  <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="py-2 px-3 text-gray-400 font-mono">{idx + 1}</td>
                                    <td className="py-2 px-3 font-semibold text-gray-900">{row.material_name}</td>
                                    <td className="py-2 px-3 text-center text-gray-500">{row.unit}</td>
                                    <td className="py-2 px-3 text-center font-bold text-blue-900 font-mono bg-blue-50/30">
                                      {row.preliminary_quantity}
                                    </td>
                                    <td className="py-2 px-3 text-center font-bold text-emerald-900 font-mono bg-emerald-50/30">
                                      {row.final_quantity}
                                    </td>
                                    <td className="py-2 px-3 text-center font-mono">
                                      {row.difference > 0 ? (
                                        <span className="text-amber-700 font-bold">-{row.difference} (reduced)</span>
                                      ) : row.difference < 0 ? (
                                        <span className="text-purple-700 font-bold">+{Math.abs(row.difference)}</span>
                                      ) : (
                                        <span className="text-gray-400">0</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center font-mono text-gray-700">
                                      {row.actual_quantity_issued ?? '—'}
                                    </td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-indigo-900">
                                      {row.actual_quantity_used ?? '—'}
                                    </td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-amber-800">
                                      {row.actual_quantity_returned > 0 ? `${row.actual_quantity_returned} ${row.unit}` : '0'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-600 pt-2">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Physical Return Verification Modal */}
      {returnVerificationModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Verify Returned Stock: {returnVerificationModal.checklistNumber}</span>
              </h3>
              <button
                type="button"
                onClick={() => setReturnVerificationModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {verificationError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs">
                {verificationError}
              </div>
            )}

            <form onSubmit={handleVerifyMaterialReturn} className="space-y-3 text-xs">
              <div className="p-3 bg-amber-50 rounded-xl text-amber-900 border border-amber-200">
                <span className="font-bold block">Technician Declared Unused Material Returns:</span>
                {returnVerificationModal.items && returnVerificationModal.items.length > 0 ? (
                  <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
                    {returnVerificationModal.items.map((it, i) => (
                      <li key={i}>
                        {it.material_name}: <strong>{it.quantity_returned} {it.unit}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-[11px] block mt-0.5">Unused fitting materials declared by technical team upon installation completion.</span>
                )}
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Accepted Usable Quantity *
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={returnForm.accepted_usable_qty}
                  onChange={(e) => setReturnForm({ ...returnForm, accepted_usable_qty: e.target.value })}
                  placeholder="e.g. 5"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Only credited if previously issued from store and physically confirmed usable.
                </span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Damaged Quantity</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={returnForm.damaged_qty}
                  onChange={(e) => setReturnForm({ ...returnForm, damaged_qty: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Routed separately to damaged stock (never added to usable stock).
                </span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Missing / Unreturned Quantity</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={returnForm.missing_qty}
                  onChange={(e) => setReturnForm({ ...returnForm, missing_qty: e.target.value })}
                  placeholder="0"
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Do not add missing items to stock; logged as audit discrepancy.
                </span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Verification Remarks</label>
                <input
                  type="text"
                  value={returnForm.remarks}
                  onChange={(e) => setReturnForm({ ...returnForm, remarks: e.target.value })}
                  placeholder="e.g. Physical count confirmed on shelf"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReturnVerificationModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingVerification}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {submittingVerification ? 'Updating Stock...' : 'Confirm Verification & Credit Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Loose Backup Return Physical Verification Modal */}
      {backupReturnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-gray-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span>Physically Verify Loose Backup Returns: {backupReturnModal.checklistNumber}</span>
              </h3>
              <button
                type="button"
                onClick={() => setBackupReturnModal(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl text-amber-900 border border-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Store Physical Verification:</strong> Only usable items verified by Store Manager will be restored to warehouse inventory. Damaged items will be recorded separately and missing items are strictly never added to stock.
              </span>
            </div>

            {backupReturnError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-semibold">
                {backupReturnError}
              </div>
            )}

            <form onSubmit={handleVerifyBackupReturnSubmit} className="space-y-4 text-xs">
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Item</th>
                      <th className="py-2.5 px-3 text-center">Tech Returned</th>
                      <th className="py-2.5 px-3 text-center">Accepted Usable (Restored)</th>
                      <th className="py-2.5 px-3 text-center">Damaged</th>
                      <th className="py-2.5 px-3 text-center">Missing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {backupReturnRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 font-semibold text-gray-900">
                          {row.item_name}
                          <span className="text-[10px] text-gray-400 block font-normal">Unit: {row.unit}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-emerald-800 font-mono">
                          {row.quantity_returned} {row.unit}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={row.accepted_usable_qty}
                            onChange={(e) => {
                              const updated = [...backupReturnRows];
                              updated[idx].accepted_usable_qty = e.target.value;
                              setBackupReturnRows(updated);
                            }}
                            className="w-20 p-1.5 text-center border border-gray-300 rounded-lg font-mono font-bold text-emerald-900 focus:outline-none focus:border-amber-500"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={row.damaged_qty}
                            onChange={(e) => {
                              const updated = [...backupReturnRows];
                              updated[idx].damaged_qty = e.target.value;
                              setBackupReturnRows(updated);
                            }}
                            className="w-16 p-1.5 text-center border border-gray-300 rounded-lg font-mono font-bold text-rose-700 focus:outline-none focus:border-amber-500"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={row.missing_qty}
                            onChange={(e) => {
                              const updated = [...backupReturnRows];
                              updated[idx].missing_qty = e.target.value;
                              setBackupReturnRows(updated);
                            }}
                            className="w-16 p-1.5 text-center border border-gray-300 rounded-lg font-mono font-bold text-amber-700 focus:outline-none focus:border-amber-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Store Physical Verification Remarks</label>
                <input
                  type="text"
                  value={backupReturnRemarks}
                  onChange={(e) => setBackupReturnRemarks(e.target.value)}
                  placeholder="e.g. Loose cameras and cables physically counted and inspected on warehouse shelf"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setBackupReturnModal(null)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingBackupReturn}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {submittingBackupReturn ? 'Crediting Usable Stock...' : 'Confirm Verification & Restore Usable Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
