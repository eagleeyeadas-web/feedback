import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Wrench,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Search,
  Truck,
  FileCheck,
  UserCheck,
  Filter,
  RefreshCw,
  Eye,
  Archive,
  Receipt,
} from 'lucide-react';
import InstallationCompletionModal from '../../../components/workspaces/InstallationCompletionModal';
import TechnicianExpenseModal from '../../../components/workspaces/TechnicianExpenseModal';
import { fetchInstallationChecklists, fetchServiceEngineers, startInstallationJob } from '../../../lib/api';

// Helper to extract separated required and extra device allocations
function getDeviceAllocationSummary(item) {
  if (!item) return { reqConfigs: [], extraConfigs: [], totalReq: 0, totalExtra: 0, totalCarried: 0 };
  const reqConfigs = Array.isArray(item.device_configurations) && item.device_configurations.length > 0
    ? item.device_configurations
    : (item.device_type ? [{ device_type: item.device_type, number_of_devices: item.number_of_devices || 1 }] : []);

  let extraConfigs = [];
  if (item.extra_devices) {
    if (Array.isArray(item.extra_device_configurations) && item.extra_device_configurations.length > 0) {
      extraConfigs = item.extra_device_configurations;
    } else if (item.extra_device_type) {
      const parts = String(item.extra_device_type).split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
      extraConfigs = parts.map((p) => {
        const m = p.match(/\((\d+)/);
        const q = m ? parseInt(m[1], 10) : (item.extra_device_count || 1);
        const name = p.replace(/\(.*?\)/g, '').trim();
        return { device_type: name, extra_quantity: q };
      });
    }
  }

  const totalReq = reqConfigs.reduce((sum, c) => sum + (Number(c.number_of_devices ?? c.quantity_carried) || 1), 0);
  const totalExtra = extraConfigs.reduce((sum, c) => sum + (Number(c.extra_quantity ?? c.quantity) || 1), 0);
  const totalCarried = item.total_devices_carried || (totalReq + totalExtra);

  return { reqConfigs, extraConfigs, totalReq, totalExtra, totalCarried };
}

export default function TechnicalWorkspace({ onSelectChecklist }) {
  const { session, token: authToken, loading: authLoading } = useAuth();
  const token = authToken || session?.access_token;
  const navigate = useNavigate();

  // Tab State: 'assigned' (default) vs 'completed'
  const [activeTab, setActiveTab] = useState('assigned');

  const [checklists, setChecklists] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [selectedEngineer, setSelectedEngineer] = useState('all');
  const [loading, setLoading] = useState(true);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  // Active Modals State
  const [completionModalJob, setCompletionModalJob] = useState(null);
  const [viewReportModalJob, setViewReportModalJob] = useState(null);
  const [expenseModalJob, setExpenseModalJob] = useState(null);
  const [postInstallCompletedJob, setPostInstallCompletedJob] = useState(null);

  const loadData = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Parallelize checklist and engineer fetching
      const [res, engList] = await Promise.all([
        fetchInstallationChecklists(token, { limit: 100 }),
        fetchServiceEngineers(token).catch(() => []),
      ]);
      setChecklists(res?.checklists || []);
      setEngineers(engList || []);
    } catch (err) {
      console.error('Failed to load Technical workspace data:', err);
      setError(err.message || 'Failed to fetch assigned technical jobs. Please click Retry.');
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let timer;
    if (loading) {
      timer = setTimeout(() => setIsWakingUp(true), 3000);
    } else {
      setIsWakingUp(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  const showToast = (msg) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(''), 3500);
  };

  // SOURCE OF TRUTH: Persisted installation_status determines Assigned vs Completed
  const isJobCompleted = (item) => {
    const status = (item.installation_status || '').trim().toLowerCase();
    return status === 'completed' || status === 'site work completed';
  };

  const isJobAssigned = (item) => {
    const status = (item.installation_status || '').trim().toLowerCase();
    return !isJobCompleted(item) && status !== 'cancelled';
  };

  // Base partitions (mutual exclusivity strictly enforced)
  const allAssignedJobs = checklists.filter(isJobAssigned);
  const allCompletedJobs = checklists.filter(isJobCompleted);

  // Filter helper matching Service Engineer AND search query
  const matchesFilter = (item) => {
    // 1. Service Engineer filter
    let matchesEngineer = true;
    if (selectedEngineer !== 'all') {
      const targetEng = engineers.find((e) => e.id === selectedEngineer);
      const targetName = (targetEng ? targetEng.name : selectedEngineer).toLowerCase();
      const itemEngName = (item.service_engineer || '').toLowerCase();

      matchesEngineer =
        itemEngName.includes(targetName) ||
        targetName.includes(itemEngName) ||
        item.service_engineer === selectedEngineer;
    }

    // 2. Search query matching checklist_number, client_name, location, or technician
    let matchesSearch = true;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      matchesSearch =
        (item.client_name || '').toLowerCase().includes(s) ||
        (item.checklist_number || '').toLowerCase().includes(s) ||
        (item.service_engineer || '').toLowerCase().includes(s) ||
        (item.service_assistant || '').toLowerCase().includes(s) ||
        (item.client_location || '').toLowerCase().includes(s);
    }

    return matchesEngineer && matchesSearch;
  };

  const filteredAssignedJobs = allAssignedJobs.filter(matchesFilter);
  const filteredCompletedJobs = allCompletedJobs.filter(matchesFilter);

  // Dynamic Metrics Bar (Source of Truth counts)
  const assignedJobsCount = allAssignedJobs.length;
  const inProgressCount = checklists.filter(
    (c) => (c.installation_status || '').trim().toLowerCase() === 'in progress'
  ).length;
  const completedJobsCount = allCompletedJobs.length;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionSuccessMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-purple-500/30 text-purple-200 rounded-md border border-purple-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Wrench className="w-7 h-7 text-purple-400" /> Technical Team Job Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            Manage assigned installation jobs, view Sales device allocations, submit post-installation device reports, and view historical completed jobs.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Jobs</span>
        </button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          onClick={() => setActiveTab('assigned')}
          className={`bg-white p-5 rounded-xl border shadow-xs flex items-center gap-4 cursor-pointer transition-all ${
            activeTab === 'assigned'
              ? 'border-purple-500 ring-2 ring-purple-100 bg-purple-50/20'
              : 'border-gray-200 hover:border-purple-300'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Assigned Jobs (Active)</p>
            <p className="text-2xl font-bold text-gray-900">{assignedJobsCount}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Jobs In Progress</p>
            <p className="text-2xl font-bold text-gray-900">{inProgressCount}</p>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('completed')}
          className={`bg-white p-5 rounded-xl border shadow-xs flex items-center gap-4 cursor-pointer transition-all ${
            activeTab === 'completed'
              ? 'border-emerald-500 ring-2 ring-emerald-100 bg-emerald-50/20'
              : 'border-gray-200 hover:border-emerald-300'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Completed Jobs</p>
            <p className="text-2xl font-bold text-gray-900">{completedJobsCount}</p>
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Service Engineer Name Filter */}
        <div>
          <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-purple-600" /> Filter by Service Engineer
          </label>
          <select
            value={selectedEngineer}
            onChange={(e) => setSelectedEngineer(e.target.value)}
            className="w-full text-xs p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 font-semibold text-gray-800"
          >
            <option value="all">All Engineers ({checklists.length} total jobs)</option>
            {engineers.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name} {eng.role ? `(${eng.role})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Text Search */}
        <div className="md:col-span-2">
          <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-purple-600" /> Search Jobs
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client name, checklist number, location, or technician..."
              className="w-full text-xs pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 text-gray-800 placeholder-gray-400"
            />
          </div>
        </div>
      </div>

      {/* SEGMENTED TOGGLE SWITCH (Purple & Navy Eagle Eye SafDrive Theme) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="inline-flex p-1.5 bg-slate-100/90 rounded-2xl border border-slate-200/90 shadow-inner max-w-fit">
          {/* Toggle: Assigned Jobs */}
          <button
            type="button"
            id="toggle-assigned-jobs"
            onClick={() => setActiveTab('assigned')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'assigned'
                ? 'bg-gradient-to-r from-purple-900 to-indigo-950 text-white shadow-md font-extrabold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/70'
            }`}
          >
            <Clock className={`w-3.5 h-3.5 ${activeTab === 'assigned' ? 'text-purple-300' : 'text-gray-400'}`} />
            <span>Assigned Jobs</span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                activeTab === 'assigned'
                  ? 'bg-purple-700/80 text-white border border-purple-400/30'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {filteredAssignedJobs.length}
            </span>
          </button>

          {/* Toggle: Completed Jobs */}
          <button
            type="button"
            id="toggle-completed-jobs"
            onClick={() => setActiveTab('completed')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'completed'
                ? 'bg-gradient-to-r from-purple-900 to-indigo-950 text-white shadow-md font-extrabold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/70'
            }`}
          >
            <CheckCircle2 className={`w-3.5 h-3.5 ${activeTab === 'completed' ? 'text-purple-300' : 'text-gray-400'}`} />
            <span>Completed Jobs</span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                activeTab === 'completed'
                  ? 'bg-purple-700/80 text-white border border-purple-400/30'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {filteredCompletedJobs.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-gray-500 font-medium">
          {activeTab === 'assigned' ? (
            <span>
              Showing <strong className="text-gray-800">{filteredAssignedJobs.length}</strong> of{' '}
              <strong className="text-gray-800">{allAssignedJobs.length}</strong> assigned jobs
            </span>
          ) : (
            <span>
              Showing <strong className="text-gray-800">{filteredCompletedJobs.length}</strong> of{' '}
              <strong className="text-gray-800">{allCompletedJobs.length}</strong> completed jobs
            </span>
          )}
        </div>
      </div>

      {/* SECTION 1: ASSIGNED JOBS TABLE */}
      {activeTab === 'assigned' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-600" /> Assigned Technical Jobs
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Jobs awaiting installation site work or post-installation device reporting. Devices carried are recorded by Sales.
              </p>
            </div>
            <span className="text-xs text-gray-500 font-medium">
              Showing {filteredAssignedJobs.length} of {allAssignedJobs.length} assigned jobs
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs font-semibold text-gray-700">
                {isWakingUp
                  ? 'Connecting to backend... Free-tier server is spinning up (takes ~15-20s on initial load)'
                  : 'Loading Assigned jobs...'}
              </p>
              {isWakingUp && (
                <p className="text-[11px] text-gray-400 mt-1">Please wait while the server container finishes starting.</p>
              )}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-rose-600 space-y-3">
              <AlertTriangle className="w-8 h-8 mx-auto text-rose-500" />
              <p className="text-xs font-bold">{error}</p>
              <button
                onClick={loadData}
                className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-colors cursor-pointer"
              >
                Retry Loading Jobs
              </button>
            </div>
          ) : filteredAssignedJobs.length === 0 ? (
            <div className="p-12 text-center text-gray-400 space-y-3">
              {allAssignedJobs.length === 0 ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <p className="font-bold text-gray-800 text-sm">No pending assigned jobs</p>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    All assigned installation jobs have been completed, or no new jobs are assigned at this time.
                  </p>
                </>
              ) : (
                <>
                  <Search className="w-10 h-10 text-purple-400 mx-auto" />
                  <p className="font-bold text-gray-800 text-sm">No matching assigned jobs found</p>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    No assigned jobs match your active Service Engineer filter or search query.
                  </p>
                  <button
                    onClick={() => {
                      setSelectedEngineer('all');
                      setSearch('');
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 cursor-pointer"
                  >
                    Reset Filter & Search
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Checklist No.</th>
                    <th className="py-3 px-4">Client Details</th>
                    <th className="py-3 px-4">Devices Carried to Site</th>
                    <th className="py-3 px-4">Assigned Team</th>
                    <th className="py-3 px-4">Arrival Date/Time</th>
                    <th className="py-3 px-4">Installation Status</th>
                    <th className="py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredAssignedJobs.map((item) => {
                    const isJobInProgress = (item.installation_status || '').toLowerCase() === 'in progress';
                    const configs = Array.isArray(item.device_configurations) && item.device_configurations.length > 0
                      ? item.device_configurations
                      : (item.device_type ? [{ device_type: item.device_type, number_of_devices: item.number_of_devices || 1, quantity_carried: item.number_of_devices || 1 }] : []);
                    const totalCarried = configs.reduce((sum, c) => sum + (Number(c.quantity_carried ?? c.number_of_devices) || 0), 0) || item.number_of_devices || 0;

                    return (
                      <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                        {/* Checklist No */}
                        <td className="py-3 px-4 font-mono font-bold text-purple-700">
                          {item.checklist_number}
                        </td>

                        {/* Client Details */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900">{item.client_name}</div>
                          <div className="text-[11px] text-gray-500">{item.client_location}</div>
                        </td>

                        {/* Devices Carried to Site (Sales Allocation - Read-Only) */}
                        <td className="py-3 px-4">
                          {(() => {
                            const { reqConfigs, extraConfigs, totalReq, totalExtra, totalCarried } = getDeviceAllocationSummary(item);
                            return (
                              <div className="space-y-1.5 min-w-[200px]">
                                <div className="flex items-center justify-between gap-1 text-xs font-mono font-bold text-gray-900 border-b border-gray-100 pb-1">
                                  <span>Total Carried:</span>
                                  <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                    {totalCarried} Units
                                  </span>
                                </div>

                                {/* Required Devices */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
                                    Required ({totalReq}):
                                  </span>
                                  {reqConfigs.map((dc, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-1 text-[11px] bg-blue-50/60 px-2 py-0.5 rounded border border-blue-100">
                                      <span className="font-semibold text-gray-800 truncate">{dc.device_type}</span>
                                      <span className="font-mono font-bold text-blue-800 shrink-0">
                                        {dc.number_of_devices ?? dc.quantity_carried} req
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {/* Extra Devices Carried */}
                                {extraConfigs.length > 0 && (
                                  <div className="space-y-1 pt-0.5">
                                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                                      Extra Backup ({totalExtra}):
                                    </span>
                                    {extraConfigs.map((ec, idx) => (
                                      <div key={idx} className="flex items-center justify-between gap-1 text-[11px] bg-amber-50/80 px-2 py-0.5 rounded border border-amber-200">
                                        <span className="font-semibold text-gray-800 truncate">{ec.device_type}</span>
                                        <span className="font-mono font-bold text-amber-800 shrink-0">
                                          +{ec.extra_quantity ?? 1} extra
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Assigned Team */}
                        <td className="py-3 px-4 text-gray-700">
                          <div>
                            <strong className="text-gray-900">Eng:</strong> {item.service_engineer || 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            <strong>Asst:</strong> {item.service_assistant || 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-indigo-700 font-semibold mt-0.5">
                            <strong>Sales:</strong> {item.salesperson_name || '—'}
                          </div>
                        </td>

                        {/* Arrival Schedule */}
                        <td className="py-3 px-4 text-gray-600">
                          <div>{item.expected_arrival_date || 'TBD'}</div>
                          <div className="text-[10px] text-gray-400">{item.expected_arrival_time}</div>
                        </td>

                        {/* Installation Status Badge */}
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                              isJobInProgress
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-purple-100 text-purple-800 border border-purple-300'
                            }`}
                          >
                            {isJobInProgress ? 'In Progress' : 'Assigned'}
                          </span>
                        </td>

                        {/* Actions Column: Direct Post-Installation Device Report */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1.5">
                            {!item.has_completion_report ? (
                              <button
                                onClick={() => setCompletionModalJob(item)}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer w-fit"
                              >
                                <FileCheck className="w-3.5 h-3.5" /> Post-Installation Device Report
                              </button>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                <button
                                  onClick={() => setViewReportModalJob(item)}
                                  className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1 cursor-pointer w-fit"
                                >
                                  <FileCheck className="w-3 h-3 text-blue-600" /> View Report
                                </button>
                                <button
                                  onClick={() => setExpenseModalJob(item)}
                                  className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg flex items-center gap-1 cursor-pointer w-fit"
                                >
                                  <Receipt className="w-3 h-3 text-purple-600" /> Expenses
                                </button>
                              </div>
                            )}

                            {/* Job Details Link */}
                            <div className="flex items-center gap-2 text-[10px] mt-0.5 text-gray-500">
                              <button
                                onClick={() =>
                                  onSelectChecklist
                                    ? onSelectChecklist(item.id)
                                    : navigate(`/admin/installation-checklists/${item.id}`)
                                }
                                className="font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-0.5 cursor-pointer"
                              >
                                Job Details <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
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

      {/* SECTION 2: COMPLETED JOBS TABLE */}
      {activeTab === 'completed' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Completed Installation Jobs
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Jobs where technical installation report has been submitted and verified.
              </p>
            </div>
            <span className="text-xs text-gray-500 font-medium">
              Showing {filteredCompletedJobs.length} of {allCompletedJobs.length} completed jobs
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs font-semibold text-gray-700">Loading Completed jobs...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-rose-600 space-y-3">
              <AlertTriangle className="w-8 h-8 mx-auto text-rose-500" />
              <p className="text-xs font-bold">{error}</p>
            </div>
          ) : filteredCompletedJobs.length === 0 ? (
            <div className="p-12 text-center text-gray-400 space-y-3">
              {allCompletedJobs.length === 0 ? (
                <>
                  <Archive className="w-10 h-10 text-gray-400 mx-auto" />
                  <p className="font-bold text-gray-800 text-sm">No completed jobs found</p>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    Completed installation jobs are preserved permanently and will appear here once site work is finalized.
                  </p>
                </>
              ) : (
                <>
                  <Search className="w-10 h-10 text-purple-400 mx-auto" />
                  <p className="font-bold text-gray-800 text-sm">No matching completed jobs found</p>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    No completed jobs match your active Service Engineer filter or search query.
                  </p>
                  <button
                    onClick={() => {
                      setSelectedEngineer('all');
                      setSearch('');
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 cursor-pointer"
                  >
                    Reset Filter & Search
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Checklist No.</th>
                    <th className="py-3 px-4">Client Details</th>
                    <th className="py-3 px-4">Devices Carried to Site</th>
                    <th className="py-3 px-4">Assigned Team</th>
                    <th className="py-3 px-4">Arrival Date/Time</th>
                    <th className="py-3 px-4">Installation Status</th>
                    <th className="py-3 px-4">Store Reconciliation</th>
                    <th className="py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredCompletedJobs.map((item) => {
                    const configs = Array.isArray(item.device_configurations) && item.device_configurations.length > 0
                      ? item.device_configurations
                      : (item.device_type ? [{ device_type: item.device_type, number_of_devices: item.number_of_devices || 1, quantity_carried: item.number_of_devices || 1 }] : []);
                    const totalCarried = configs.reduce((sum, c) => sum + (Number(c.quantity_carried ?? c.number_of_devices) || 0), 0) || item.number_of_devices || 0;

                    return (
                      <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                        {/* Checklist No */}
                        <td className="py-3 px-4 font-mono font-bold text-purple-700">
                          {item.checklist_number}
                        </td>

                        {/* Client Details */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900">{item.client_name}</div>
                          <div className="text-[11px] text-gray-500">{item.client_location}</div>
                        </td>

                        {/* Devices Carried to Site */}
                        <td className="py-3 px-4">
                          {(() => {
                            const { reqConfigs, extraConfigs, totalReq, totalExtra, totalCarried } = getDeviceAllocationSummary(item);
                            return (
                              <div className="space-y-1.5 min-w-[200px]">
                                <div className="flex items-center justify-between gap-1 text-xs font-mono font-bold text-gray-900 border-b border-gray-100 pb-1">
                                  <span>Total Carried:</span>
                                  <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                    {totalCarried} Units
                                  </span>
                                </div>

                                {/* Required Devices */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
                                    Required ({totalReq}):
                                  </span>
                                  {reqConfigs.map((dc, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-1 text-[11px] bg-blue-50/60 px-2 py-0.5 rounded border border-blue-100">
                                      <span className="font-semibold text-gray-800 truncate">{dc.device_type}</span>
                                      <span className="font-mono font-bold text-blue-800 shrink-0">
                                        {dc.number_of_devices ?? dc.quantity_carried} req
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {/* Extra Devices Carried */}
                                {extraConfigs.length > 0 && (
                                  <div className="space-y-1 pt-0.5">
                                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                                      Extra Backup ({totalExtra}):
                                    </span>
                                    {extraConfigs.map((ec, idx) => (
                                      <div key={idx} className="flex items-center justify-between gap-1 text-[11px] bg-amber-50/80 px-2 py-0.5 rounded border border-amber-200">
                                        <span className="font-semibold text-gray-800 truncate">{ec.device_type}</span>
                                        <span className="font-mono font-bold text-amber-800 shrink-0">
                                          +{ec.extra_quantity ?? 1} extra
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Assigned Team */}
                        <td className="py-3 px-4 text-gray-700">
                          <div>
                            <strong className="text-gray-900">Eng:</strong> {item.service_engineer || 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            <strong>Asst:</strong> {item.service_assistant || 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-indigo-700 font-semibold mt-0.5">
                            <strong>Sales:</strong> {item.salesperson_name || '—'}
                          </div>
                        </td>

                        {/* Arrival Schedule */}
                        <td className="py-3 px-4 text-gray-600">
                          <div>{item.expected_arrival_date || 'TBD'}</div>
                          <div className="text-[10px] text-gray-400">{item.expected_arrival_time}</div>
                        </td>

                        {/* Installation Status Badge: Persisted Completed Status */}
                        <td className="py-3 px-4">
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 w-fit">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Completed
                          </span>
                        </td>

                        {/* Store Return Reconciliation Badge */}
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                              item.reconciliation_status === 'PENDING_STORE_VERIFICATION'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : item.reconciliation_status === 'DISCREPANCY_OPEN'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : item.reconciliation_status === 'FULLY_RECONCILED'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {item.reconciliation_status === 'PENDING_STORE_VERIFICATION'
                              ? 'Awaiting Store Verification'
                              : item.reconciliation_status === 'DISCREPANCY_OPEN'
                              ? 'Requires Review'
                              : item.reconciliation_status === 'FULLY_RECONCILED'
                              ? 'Fully Reconciled'
                              : 'Reconciled'}
                          </span>
                        </td>

                        {/* Actions Column: View Installation Report */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap gap-1">
                              <button
                                onClick={() => setViewReportModalJob(item)}
                                className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1 cursor-pointer w-fit"
                              >
                                <FileCheck className="w-3.5 h-3.5 text-blue-600" /> View Report
                              </button>
                              <button
                                onClick={() => setExpenseModalJob(item)}
                                className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg flex items-center gap-1 cursor-pointer w-fit shadow-2xs"
                                title="View or add technician expenses for this completed job"
                              >
                                <Receipt className="w-3.5 h-3.5 text-purple-600" /> Expenses
                              </button>
                            </div>

                            <div className="flex items-center gap-2 text-[10px] mt-0.5 text-gray-500">
                              <button
                                onClick={() =>
                                  onSelectChecklist
                                    ? onSelectChecklist(item.id)
                                    : navigate(`/admin/installation-checklists/${item.id}`)
                                }
                                className="font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-0.5 cursor-pointer"
                              >
                                Job Details <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
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

      {/* MODAL 2: Post-Installation Completion Form (Editable) */}
      {completionModalJob && (
        <InstallationCompletionModal
          checklist={completionModalJob}
          token={token}
          onClose={() => setCompletionModalJob(null)}
          onSuccess={(result) => {
            const targetId = completionModalJob.id;
            const submittedJob = { ...completionModalJob, has_completion_report: true, installation_status: 'Completed' };
            const isReturn =
              result?.reconciliation_status === 'PENDING_STORE_VERIFICATION' ||
              result?.summary?.devices_unused_qty > 0;

            // Automatically move job from Assigned to Completed Jobs
            setChecklists((prev) =>
              prev.map((item) =>
                item.id === targetId
                  ? {
                      ...item,
                      carry_status: 'RECORDED',
                      installation_status: 'Completed',
                      has_completion_report: true,
                      reconciliation_status: isReturn
                        ? 'PENDING_STORE_VERIFICATION'
                        : 'FULLY_RECONCILED',
                    }
                  : item
              )
            );
            setCompletionModalJob(null);
            setActiveTab('completed');
            setPostInstallCompletedJob(submittedJob);
            loadData();
          }}
        />
      )}

      {/* MODAL 3: Submitted Installation Report (Read-Only) */}
      {viewReportModalJob && (
        <InstallationCompletionModal
          checklist={viewReportModalJob}
          token={token}
          readOnly={true}
          onClose={() => setViewReportModalJob(null)}
          onSuccess={() => setViewReportModalJob(null)}
        />
      )}

      {/* STEP 2 TRANSITION CONFIRMATION DIALOG (Post-Installation Report -> Technician Expenses) */}
      {postInstallCompletedJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-100 text-center animate-in fade-in zoom-in duration-200">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                Step 1 Complete
              </span>
              <h3 className="text-lg font-bold text-gray-900 mt-1.5">
                Post-Installation Report Saved!
              </h3>
              <p className="text-xs text-gray-600 mt-1">
                Installation details, device reconciliation, and material usage for{' '}
                <strong className="text-gray-900">{postInstallCompletedJob.checklist_number}</strong> have been recorded.
              </p>
            </div>

            <div className="p-3.5 bg-purple-50 rounded-xl border border-purple-200 text-left space-y-1">
              <span className="text-[11px] font-bold text-purple-900 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-purple-600" />
                <span>Step 2 — Record Technician Expenses</span>
              </span>
              <p className="text-[11px] text-purple-700">
                You can record travel, fuel, food, toll, and accommodation costs incurred for {postInstallCompletedJob.client_name} now, or return anytime from the Completed Jobs tab.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const targetJob = postInstallCompletedJob;
                  setPostInstallCompletedJob(null);
                  setExpenseModalJob(targetJob);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>Continue to Technician Expenses (Step 2)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPostInstallCompletedJob(null);
                  showToast('Installation report saved. You can record expenses anytime from Completed Jobs.');
                }}
                className="w-full py-2 px-4 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Complete Expenses Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TECHNICIAN EXPENSES MODAL */}
      {expenseModalJob && (
        <TechnicianExpenseModal
          checklist={expenseModalJob}
          token={token}
          onClose={() => setExpenseModalJob(null)}
          onSuccess={() => {
            showToast(`Expenses updated for ${expenseModalJob.checklist_number}!`);
            loadData();
          }}
        />
      )}
    </div>
  );
}
