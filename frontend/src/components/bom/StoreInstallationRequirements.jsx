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
} from 'lucide-react';
import {
  fetchStoreMaterialRequirements,
  syncStoreMaterialRequirements,
  downloadInstallationPDF,
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
      showToast(`Generating official PDF for ${checklistNumber}...`);
      const blob = await downloadInstallationPDF(token, checklistId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `EagleEye-Installation-${checklistNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`PDF downloaded for ${checklistNumber}`);
    } catch (err) {
      console.error('PDF download error:', err);
      alert('Failed to download PDF. Please try again.');
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
            const deviceItems = Array.isArray(req.device_items) && req.device_items.length > 0
              ? req.device_items
              : (req.device_configurations || []).map((c) => ({
                  device_type: c.device_type,
                  required_quantity: c.number_of_devices,
                  unit: 'Nos.',
                  available_stock: 0,
                  shortage: 0,
                }));

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
                      onClick={() => onSelectChecklist && onSelectChecklist(req.checklist_id || req.id)}
                      className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-gray-500" />
                      <span>Checklist Details</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(req.checklist_id || req.id, req.checklist_number)}
                      className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Download official PDF copy"
                    >
                      <FileDown className="w-3.5 h-3.5 text-blue-600" />
                      <span>PDF</span>
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
                        <span>Issue Stock</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(req.id || req.checklist_id)}
                      className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl cursor-pointer transition-colors flex items-center gap-1"
                      title={isExpanded ? 'Collapse BOM & Details' : 'View Full Details & BOM'}
                    >
                      <span>{isExpanded ? 'Hide BOM' : 'View BOM'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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
                      {req.service_assistant && (
                        <div className="text-[11px] text-gray-600">
                          <span>Assistant: </span>
                          <strong>{req.service_assistant}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Col 3: Device Models & Quantities */}
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Device Models &amp; Quantities</span>
                    <div className="mt-1 space-y-1">
                      {deviceItems.map((d, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-gray-900 flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-blue-600" />
                            {d.device_type}
                          </span>
                          <span className="font-mono text-gray-600 font-bold">{d.required_quantity} Nos.</span>
                        </div>
                      ))}
                      <div className="pt-1 border-t border-gray-200/80 flex items-center justify-between font-bold text-[11px]">
                        <span className="text-navy">Total Devices:</span>
                        <span className="font-mono text-blue-900">{req.number_of_devices} Units</span>
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
                        <span className="text-gray-500 block text-[10px]">Expected Arrival:</span>
                        <strong className="text-gray-900">{req.expected_arrival_date || 'TBD'}</strong>
                        {req.expected_arrival_time && (
                          <span className="text-gray-600 ml-1 font-mono">({req.expected_arrival_time})</span>
                        )}
                      </div>
                      <div>
                        <span className="text-gray-500">Duration: </span>
                        <strong className="text-gray-800">{req.installation_duration || '1 Day'}</strong>
                      </div>
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
                    {/* SECTION 1: Camera Devices Availability */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-gray-800 flex items-center gap-2">
                          <HardDrive className="w-4 h-4 text-blue-600" />
                          <span>1. Camera Devices Stock &amp; Availability</span>
                        </h4>
                        <span className="text-[11px] text-gray-500">Tracked separately from materials</span>
                      </div>

                      <div className="border border-gray-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase">
                            <tr>
                              <th className="py-2.5 px-3">Device Model</th>
                              <th className="py-2.5 px-3">SKU</th>
                              <th className="py-2.5 px-3 text-center">Required Quantity</th>
                              <th className="py-2.5 px-3 text-center">Available Usable Stock</th>
                              <th className="py-2.5 px-3 text-center">Shortage</th>
                              <th className="py-2.5 px-3 text-center">Warehouse Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {deviceItems.map((d, idx) => {
                              const dShortage = Number(d.shortage) || 0;
                              const dAvail = Number(d.available_stock) || 0;
                              const dReq = Number(d.required_quantity) || 1;
                              const devStatus = d.availability_status || (dAvail >= dReq ? 'Available' : dAvail > 0 ? 'Partially Available' : 'Out of Stock');

                              return (
                                <tr key={idx} className={devStatus === 'Out of Stock' ? 'bg-rose-50/40' : devStatus === 'Partially Available' ? 'bg-amber-50/30' : 'hover:bg-gray-50/50'}>
                                  <td className="py-2.5 px-3 font-bold text-gray-900">{d.device_type}</td>
                                  <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">{d.sku || 'N/A'}</td>
                                  <td className="py-2.5 px-3 text-center font-bold text-gray-900">{dReq} Nos.</td>
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
    </div>
  );
}
