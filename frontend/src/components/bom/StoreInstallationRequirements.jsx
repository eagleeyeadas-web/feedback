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
  FileText,
  Truck,
  HardDrive,
  User,
  Info,
} from 'lucide-react';
import { fetchStoreMaterialRequirements, syncStoreMaterialRequirements } from '../../lib/api';
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
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold px-2.5 py-1 bg-indigo-500/30 text-indigo-200 rounded-md border border-indigo-400/30 uppercase tracking-wider">
            Store Material Issuance & Review
          </span>
          <h2 className="text-xl font-bold mt-2 flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-indigo-400" />
            Installation Material Requirements
          </h2>
          <p className="text-xs text-white/80 mt-1 max-w-2xl">
            Live Bill of Materials (BOM) calculated automatically from Sales Checklists. Review required materials, inspect inventory shortages, and authorize atomic stock deductions.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
            title="Idempotently re-sync requirements for all existing checklists"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Checklists'}</span>
          </button>

          <button
            onClick={loadRequirements}
            disabled={loading}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Total Jobs</span>
          <span className="text-xl font-extrabold text-gray-900 font-mono mt-0.5 block">{summary.total || 0}</span>
          <span className="text-[10px] text-gray-400">All submitted checklists</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">Installation Jobs</span>
          <span className="text-xl font-extrabold text-indigo-900 font-mono mt-0.5 block">{summary.installationCount || 0}</span>
          <span className="text-[10px] text-indigo-600/80">With calculated BOM</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">Service Jobs</span>
          <span className="text-xl font-extrabold text-slate-800 font-mono mt-0.5 block">{summary.serviceCount || 0}</span>
          <span className="text-[10px] text-slate-500">No installation BOM</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-amber-200 shadow-2xs bg-amber-50/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Pending Issuance</span>
          <span className="text-xl font-extrabold text-amber-900 font-mono mt-0.5 block">{summary.pendingCount || 0}</span>
          <span className="text-[10px] text-amber-600">Awaiting Store Release</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-rose-200 shadow-2xs bg-rose-50/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">Stock Shortages</span>
          <span className="text-xl font-extrabold text-rose-900 font-mono mt-0.5 block">{summary.shortageCounter || 0}</span>
          <span className="text-[10px] text-rose-600">Requires Restocking</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-2xs bg-emerald-50/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Materials Issued</span>
          <span className="text-xl font-extrabold text-emerald-900 font-mono mt-0.5 block">{summary.issuedCount || 0}</span>
          <span className="text-[10px] text-emerald-600">Store Released</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Checklist #, Client Name, Mobile, or Location..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-medium"
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
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-indigo-500"
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
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="All">All Statuses</option>
              <option value="PENDING">Pending Store Review</option>
              <option value="ISSUED">Materials Issued</option>
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
        </div>
      </div>

      {/* Requirements List */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-gray-600">Loading installation material requirements...</p>
        </div>
      ) : requirements.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-3">
          <Package className="w-10 h-10 text-gray-300 mx-auto" />
          <h3 className="text-sm font-bold text-gray-800">No Material Requirements Found</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            {search || jobTypeFilter !== 'All' || statusFilter !== 'All' || shortageOnly
              ? 'No checklist records match the current filter criteria.'
              : 'When Sales submits an Installation Initiation Checklist, its material requirements and client details will automatically appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requirements.map((req) => {
            const isService = req.job_type === 'Service';
            const isIssued = req.material_issuance_status === 'ISSUED';
            const isPending = req.material_issuance_status === 'PENDING';
            const hasShortage = Boolean(req.has_shortage);
            const isExpanded = expandedCards.has(req.id || req.checklist_id);
            const materialItems = Array.isArray(req.material_items) ? req.material_items : [];

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
                      <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-200">
                        {req.checklist_number}
                      </span>

                      {/* Job Type Badge */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isService
                            ? 'bg-slate-100 text-slate-700 border border-slate-300'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}
                      >
                        {req.job_type}
                      </span>

                      {/* Issuance Status Badge */}
                      {isService ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          BOM Not Applicable (Service Call)
                        </span>
                      ) : isIssued ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Materials Issued from Store
                        </span>
                      ) : hasShortage ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          Stock Shortage Flagged ({req.shortage_count || 1} items)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          Ready for Store Issuance
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-3 pt-0.5">
                      <span>Submitted: <strong>{new Date(req.submission_date || req.created_at).toLocaleString('en-IN')}</strong></span>
                      {req.material_issued_at && (
                        <span>Issued: <strong className="text-emerald-700">{new Date(req.material_issued_at).toLocaleString('en-IN')}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Top Right Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* View Original Checklist */}
                    <button
                      type="button"
                      onClick={() => onSelectChecklist && onSelectChecklist(req.checklist_id || req.id)}
                      className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-gray-500" />
                      <span>View Checklist Details</span>
                    </button>

                    {/* Authorize & Issue Materials Button */}
                    {!isService && !isIssued && materialItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIssueModalChecklist({
                          id: req.checklist_id || req.id,
                          checklist_number: req.checklist_number,
                          client_name: req.client_name,
                          bom_snapshot: req.bom_snapshot,
                        })}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>Authorize & Issue Stock</span>
                      </button>
                    )}

                    {/* Collapse/Expand Toggle */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(req.id || req.checklist_id)}
                      className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors"
                      title={isExpanded ? 'Collapse' : 'Expand full material table'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Client & Device Details Section */}
                <div className="p-5 bg-slate-50/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Client Details</span>
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
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Client Location</span>
                    <span className="font-medium text-gray-800 flex items-center gap-1.5 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      {req.client_location || 'Not provided'}
                    </span>
                    {req.google_maps_location && (
                      <a
                        href={req.google_maps_location}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open in Google Maps</span>
                      </a>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Device Configurations</span>
                    <span className="font-bold text-gray-900 flex items-center gap-1.5 mt-0.5">
                      <HardDrive className="w-3.5 h-3.5 text-blue-600" />
                      {req.device_type}
                    </span>
                    <span className="text-gray-500 block text-[11px] mt-0.5 font-medium">
                      Total: <strong>{req.number_of_devices} Units</strong> • <strong>{req.number_of_vehicles} Vehicles</strong>
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Store Requirement Summary</span>
                    {isService ? (
                      <span className="text-slate-600 font-medium block mt-1">
                        Service Call • Direct Tech Support
                      </span>
                    ) : (
                      <div className="mt-1 space-y-1">
                        <span className="text-gray-700 block font-bold">
                          {materialItems.length} BOM Material Types
                        </span>
                        {hasShortage && !isIssued ? (
                          <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {req.shortage_count} Item(s) Short in Inventory
                          </span>
                        ) : isIssued ? (
                          <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                            <Check className="w-3 h-3" /> All Materials Deducted & Issued
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-semibold text-[11px] flex items-center gap-1">
                            <Check className="w-3 h-3" /> All Materials In Stock
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Service Job Notice Banner */}
                {isService && (
                  <div className="p-4 bg-slate-50 border-t border-gray-100 flex items-center gap-3 text-xs text-slate-700">
                    <Info className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>
                      <strong>Service Call:</strong> All client, contact and device details have been dispatched to the Store Manager for reference. No automatic installation BOM materials or stock deductions are required for this service job.
                    </span>
                  </div>
                )}

                {/* BOM Material Requirements Table (Installation Jobs Only) */}
                {!isService && materialItems.length > 0 && (
                  <div className="border-t border-gray-200">
                    {/* Collapsible toggle bar */}
                    <div
                      onClick={() => toggleExpand(req.id || req.checklist_id)}
                      className="px-5 py-2.5 bg-gray-50/80 hover:bg-gray-100/80 flex items-center justify-between cursor-pointer transition-colors text-xs font-bold text-gray-700"
                    >
                      <span className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Calculated Material Requirements Breakdown ({materialItems.length} items)</span>
                      </span>
                      <span className="text-[11px] text-indigo-600 flex items-center gap-1">
                        {isExpanded ? 'Hide Items' : 'Inspect Items & Shortages'}
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="p-4 bg-white overflow-x-auto space-y-3">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase">
                              <th className="py-2.5 px-3 w-10 text-center">#</th>
                              <th className="py-2.5 px-4">Material Name</th>
                              <th className="py-2.5 px-4 text-center">Min Qty / Device</th>
                              <th className="py-2.5 px-4 text-center">Calculated Total Req</th>
                              <th className="py-2.5 px-4 text-center">Unit</th>
                              <th className="py-2.5 px-4 text-center">Available in Store</th>
                              <th className="py-2.5 px-4 text-center">Inventory Shortage</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {materialItems.map((item, idx) => {
                              const itemShortage = Number(item.shortage) || 0;
                              const availableStock = Number(item.available_stock) || 0;
                              const requiredQty = Number(item.total_required_quantity) || 0;

                              return (
                                <tr
                                  key={idx}
                                  className={`hover:bg-slate-50 transition-colors ${
                                    itemShortage > 0 && !isIssued ? 'bg-rose-50/40' : ''
                                  }`}
                                >
                                  <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[11px]">{idx + 1}</td>
                                  <td className="py-2.5 px-4 font-bold text-gray-900">
                                    <div>{item.material_name}</div>
                                    {Array.isArray(item.breakdown) && item.breakdown.length > 1 && (
                                      <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                                        {item.breakdown.map((b) => `${b.device_type}: ${b.subtotal} ${item.unit}`).join(' • ')}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-mono text-gray-600">
                                    {item.quantity_per_device}
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-mono font-bold text-indigo-900">
                                    <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200">
                                      {requiredQty}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-center text-gray-600 font-medium">
                                    {item.unit}
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-mono font-semibold">
                                    <span
                                      className={`px-2 py-0.5 rounded-md ${
                                        availableStock < requiredQty
                                          ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                          : 'text-gray-800 bg-gray-100'
                                      }`}
                                    >
                                      {availableStock} {item.unit}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-mono font-bold">
                                    {itemShortage > 0 && !isIssued ? (
                                      <span className="px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 inline-flex items-center gap-1 text-[11px]">
                                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                                        Short {itemShortage} {item.unit}
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1 text-[11px]">
                                        <Check className="w-3 h-3 text-emerald-600" />
                                        Sufficient
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-gray-500 font-medium">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Authorized Stock Issuance Modal */}
      {issueModalChecklist && (
        <IssueMaterialsModal
          checklist={issueModalChecklist}
          token={token}
          onClose={() => setIssueModalChecklist(null)}
          onSuccess={() => {
            setIssueModalChecklist(null);
            showToast('Materials successfully authorized and issued from store inventory!');
            loadRequirements();
          }}
        />
      )}
    </div>
  );
}
