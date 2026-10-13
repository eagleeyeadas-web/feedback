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

                      {/* Status Badges */}
                      {isService ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          BOM Not Applicable (Service Call)
                        </span>
                      ) : isIssued ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Stock Issued from Store
                        </span>
                      ) : hasShortage ? (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          Stock Shortage Flagged ({req.shortage_count || 1} item{req.shortage_count > 1 ? 's' : ''})
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

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectChecklist && onSelectChecklist(req.checklist_id || req.id)}
                      className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-gray-500" />
                      <span>View Checklist Details</span>
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
                      className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors"
                      title={isExpanded ? 'Collapse' : 'Expand full inventory requirements'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Client & Device Summary */}
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
                        className="text-amber-700 hover:underline flex items-center gap-1 font-semibold mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Google Maps</span>
                      </a>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Camera Device Models</span>
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
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Warehouse Status</span>
                    {isService ? (
                      <span className="text-purple-700 font-medium block mt-1">
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
                            {req.shortage_count} Item Shortage in Store
                          </span>
                        ) : isIssued ? (
                          <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                            <Check className="w-3 h-3" /> All Items Deducted & Issued
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-semibold text-[11px] flex items-center gap-1">
                            <Check className="w-3 h-3" /> Sufficient Stock Available
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Service Job Notice Banner */}
                {isService && (
                  <div className="p-4 bg-slate-50 border-t border-gray-100 flex items-center gap-3 text-xs text-slate-700">
                    <Info className="w-4 h-4 text-purple-600 shrink-0" />
                    <span>
                      <strong>Service Call:</strong> Job and device details are recorded for the Store Manager. No automatic installation BOM materials or stock deductions are calculated or issued.
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
                          <span>1. Camera Devices Stock & Availability</span>
                        </h4>
                        <span className="text-[11px] text-gray-500">Tracked separately from materials</span>
                      </div>

                      <div className="border border-gray-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase">
                            <tr>
                              <th className="py-2 px-3">Device Model</th>
                              <th className="py-2 px-3">SKU</th>
                              <th className="py-2 px-3 text-center">Required Quantity</th>
                              <th className="py-2 px-3 text-center">Available Usable Stock</th>
                              <th className="py-2 px-3 text-center">Warehouse Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {deviceItems.map((d, idx) => (
                              <tr key={idx} className={d.shortage > 0 ? 'bg-rose-50/50' : 'hover:bg-gray-50/50'}>
                                <td className="py-2.5 px-3 font-bold text-gray-900">{d.device_type}</td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">{d.sku || 'N/A'}</td>
                                <td className="py-2.5 px-3 text-center font-bold text-gray-900">{d.required_quantity} Nos.</td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-800">{d.available_stock} Nos.</td>
                                <td className="py-2.5 px-3 text-center">
                                  {d.shortage > 0 ? (
                                    <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                      Shortage by {d.shortage} Nos.
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                      In Stock
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
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
                            <span>2. Installation Materials Stock & Shortages</span>
                          </h4>
                          <span className="text-[11px] text-gray-500">{materialItems.length} configured materials</span>
                        </div>

                        <div className="border border-gray-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase">
                              <tr>
                                <th className="py-2 px-3 w-10 text-center">#</th>
                                <th className="py-2 px-3">Material Name</th>
                                <th className="py-2 px-3">SKU</th>
                                <th className="py-2 px-3 text-center">Qty / Device</th>
                                <th className="py-2 px-3 text-center">Calculated Total Req</th>
                                <th className="py-2 px-3 text-center">Unit</th>
                                <th className="py-2 px-3 text-center">Available in Store</th>
                                <th className="py-2 px-3 text-center">Shortage</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {materialItems.map((item, idx) => {
                                const itemShortage = Number(item.shortage) || 0;
                                const availableStock = Number(item.available_stock) || 0;
                                const requiredQty = Number(item.total_required_quantity) || 0;

                                return (
                                  <tr key={idx} className={itemShortage > 0 ? 'bg-rose-50/50' : 'hover:bg-gray-50/50'}>
                                    <td className="py-2 px-3 text-center text-gray-400 font-mono">{idx + 1}</td>
                                    <td className="py-2 px-3 font-semibold text-gray-900">{item.material_name}</td>
                                    <td className="py-2 px-3 font-mono text-[11px] text-gray-500">{item.sku || 'N/A'}</td>
                                    <td className="py-2 px-3 text-center text-gray-600 font-medium">
                                      {item.quantity_per_device !== undefined ? `${item.quantity_per_device}` : 'Combined'}
                                    </td>
                                    <td className="py-2 px-3 text-center font-bold text-gray-900">{requiredQty}</td>
                                    <td className="py-2 px-3 text-center text-gray-500 font-medium">{item.unit}</td>
                                    <td className="py-2 px-3 text-center font-mono font-bold text-gray-800">{availableStock}</td>
                                    <td className="py-2 px-3 text-center">
                                      {itemShortage > 0 ? (
                                        <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                          Short by {itemShortage} {item.unit}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                          In Stock
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
