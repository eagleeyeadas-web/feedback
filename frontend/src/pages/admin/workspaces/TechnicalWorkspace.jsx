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
  Receipt,
  Calendar,
  CalendarPlus,
  Coffee,
  History,
  Package,
  Trash2,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import InstallationCompletionModal from '../../../components/workspaces/InstallationCompletionModal';
import TechnicianExpenseModal from '../../../components/workspaces/TechnicianExpenseModal';
import TechnicianScheduleExtensionModal from '../../../components/workspaces/TechnicianScheduleExtensionModal';
import TechnicianRestDayModal from '../../../components/workspaces/TechnicianRestDayModal';
import TechnicianLeaveModal from '../../../components/workspaces/TechnicianLeaveModal';
import ScheduleHistoryModal from '../../../components/workspaces/ScheduleHistoryModal';
import TechnicianBackupDeclarationModal from '../../../components/workspaces/TechnicianBackupDeclarationModal';
import {
  fetchInstallationChecklists,
  fetchServiceEngineers,
  startInstallationJob,
  fetchChecklistDeletionPreviewApi,
  deleteAllEligibleChecklistsApi,
  checkChecklistDeletionEligibilityApi,
  deleteChecklistApi,
} from '../../../lib/api';

// Helper to extract separated required and extra device allocations
function getDeviceAllocationSummary(item) {
  if (!item) {
    return { reqConfigs: [], extraConfigs: [], carryExtra: false, totalReq: 0, totalExtra: 0, totalCarried: 0 };
  }
  const reqConfigs = Array.isArray(item.device_configurations) && item.device_configurations.length > 0
    ? item.device_configurations
    : (item.device_type ? [{ device_type: item.device_type, number_of_devices: item.number_of_devices || 1 }] : []);

  let extraConfigs = [];
  if (Array.isArray(item.extra_device_configurations) && item.extra_device_configurations.length > 0) {
    extraConfigs = item.extra_device_configurations;
  } else if (item.extra_devices && item.extra_device_type) {
    extraConfigs = [{ device_type: item.extra_device_type, extra_quantity: item.extra_device_count || 1 }];
  }

  const carryExtra = Boolean(item.carry_extra_backup_items ?? item.extra_devices) || extraConfigs.length > 0;
  const totalReq = reqConfigs.reduce((sum, c) => sum + (Number(c.number_of_devices ?? c.quantity_carried) || 1), 0);
  const totalExtra = extraConfigs.reduce((sum, c) => sum + (Number(c.extra_quantity ?? c.quantity_carried ?? c.number_of_devices) || 1), 0);
  const totalCarried = totalReq + (carryExtra ? totalExtra : 0);

  return { reqConfigs, extraConfigs, carryExtra, totalReq, totalExtra, totalCarried };
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
  const [extensionModalJob, setExtensionModalJob] = useState(null);
  const [isRestDayModalOpen, setIsRestDayModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [historyModalJob, setHistoryModalJob] = useState(null);
  const [backupModalJob, setBackupModalJob] = useState(null);

  // Safe Checklist Deletion States
  const [deleteSingleModal, setDeleteSingleModal] = useState({
    open: false,
    checklist: null,
    checking: false,
    eligibility: null,
    submitting: false,
    error: '',
  });

  const [deleteAllModal, setDeleteAllModal] = useState({
    open: false,
    loading: false,
    preview: null,
    confirmedCountInput: '',
    submitting: false,
    error: '',
    result: null,
  });

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

  const handleOpenDeleteSingleModal = async (checklist) => {
    setDeleteSingleModal({
      open: true,
      checklist,
      checking: true,
      eligibility: null,
      submitting: false,
      error: '',
    });

    try {
      const check = await checkChecklistDeletionEligibilityApi(token, checklist.id);
      setDeleteSingleModal((prev) => ({
        ...prev,
        checking: false,
        eligibility: check,
      }));
    } catch (err) {
      setDeleteSingleModal((prev) => ({
        ...prev,
        checking: false,
        error: err.message || 'Failed to check deletion eligibility',
      }));
    }
  };

  const handleConfirmDeleteSingle = async () => {
    const { checklist } = deleteSingleModal;
    if (!checklist) return;

    setDeleteSingleModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      await deleteChecklistApi(token, checklist.id);
      showToast(`Checklist ${checklist.checklist_number} deleted successfully.`);
      setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, submitting: false, error: '' });
      loadData();
    } catch (err) {
      setDeleteSingleModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete checklist',
      }));
    }
  };

  const handleOpenDeleteAllModal = async () => {
    setDeleteAllModal({
      open: true,
      loading: true,
      preview: null,
      confirmedCountInput: '',
      submitting: false,
      error: '',
      result: null,
    });

    try {
      const preview = await fetchChecklistDeletionPreviewApi(token);
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        preview,
      }));
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to evaluate deletion preview',
      }));
    }
  };

  const handleConfirmDeleteAll = async () => {
    const { preview, confirmedCountInput } = deleteAllModal;
    const eligibleCount = preview?.eligibleCount || 0;

    if (eligibleCount > 0 && String(confirmedCountInput).trim() !== String(eligibleCount)) {
      setDeleteAllModal((prev) => ({
        ...prev,
        error: `Please enter exact count "${eligibleCount}" to proceed.`,
      }));
      return;
    }

    setDeleteAllModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const result = await deleteAllEligibleChecklistsApi(token, { confirmedCount: eligibleCount });
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        result,
      }));
      showToast(result.message || `Deleted ${result.deletedCount} eligible checklists.`);
      loadData();
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to execute bulk deletion',
      }));
    }
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

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setIsRestDayModalOpen(true)}
            className="flex items-center gap-1.5 bg-purple-600/60 hover:bg-purple-600 text-white text-xs font-semibold px-3 py-2 rounded-xl border border-purple-400/40 transition-all cursor-pointer shadow-xs"
            title="Request post-job or scheduled rest days"
          >
            <Coffee className="w-3.5 h-3.5 text-amber-300" />
            <span>Request Rest Day</span>
          </button>

          <button
            type="button"
            onClick={() => setIsLeaveModalOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600/60 hover:bg-indigo-600 text-white text-xs font-semibold px-3 py-2 rounded-xl border border-indigo-400/40 transition-all cursor-pointer shadow-xs"
            title="Request casual or sick leave"
          >
            <Calendar className="w-3.5 h-3.5 text-blue-300" />
            <span>Request Leave</span>
          </button>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Jobs</span>
          </button>
        </div>
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
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-600" /> Assigned Technical Jobs
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Jobs awaiting installation site work or post-installation device reporting. Devices carried are recorded by Sales.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">
                {filteredAssignedJobs.length} of {allAssignedJobs.length} jobs
              </span>
              <button
                type="button"
                id="tech-delete-all-btn"
                onClick={handleOpenDeleteAllModal}
                className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-xl flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                title="Delete all eligible draft jobs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete All / Clean Test Jobs</span>
              </button>
            </div>
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
                            const { reqConfigs, carryExtra, totalReq } = getDeviceAllocationSummary(item);
                            return (
                              <div className="space-y-1.5 min-w-[200px]">
                                <div className="flex items-center justify-between gap-1 text-xs font-mono font-bold text-gray-900 border-b border-gray-100 pb-1">
                                  <span>Required Devices:</span>
                                  <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                    {totalReq} Units
                                  </span>
                                </div>

                                {/* Required Devices */}
                                <div className="space-y-1">
                                  {reqConfigs.map((dc, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-1 text-[11px] bg-blue-50/60 px-2 py-0.5 rounded border border-blue-100">
                                      <span className="font-semibold text-gray-800 truncate">{dc.device_type}</span>
                                      <span className="font-mono font-bold text-blue-800 shrink-0">
                                        {dc.number_of_devices ?? dc.quantity_carried} req
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {/* Extra Backup Items Expected */}
                                <div className="pt-0.5 flex items-center justify-between text-[10px]">
                                  <span className="font-bold text-gray-500 uppercase tracking-wider">Extra Backup:</span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded font-extrabold border ${
                                      carryExtra
                                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                    }`}
                                  >
                                    {carryExtra ? 'EXPECTED' : 'NONE'}
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Assigned Team */}
                        <td className="py-3 px-4 text-gray-700">
                          <div>
                            <strong className="text-gray-900">Engineer:</strong> {item.service_engineer || 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-indigo-700 font-semibold mt-0.5">
                            <strong>Sales:</strong> {item.salesperson_name || '—'}
                          </div>
                        </td>

                        {/* Arrival Schedule */}
                        <td className="py-3 px-4 text-gray-600">
                          <div className="space-y-1">
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase font-bold block">Original Planned</span>
                              <span className="font-semibold text-gray-900">
                                {item.original_arrival_date || item.expected_arrival_date || 'TBD'}
                              </span>
                              <span className="text-[10px] text-gray-500 ml-1">
                                ({item.original_installation_duration || item.installation_duration || '1'}d)
                              </span>
                            </div>

                            {(item.schedule_revision_count > 0 || item.current_expected_arrival_date) && (
                              <div className="pt-1 border-t border-purple-100">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-purple-700 uppercase">Current Expected</span>
                                  <span className="text-[9px] font-extrabold bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded border border-purple-300">
                                    Rev {item.schedule_revision_count || 1}
                                  </span>
                                </div>
                                <span className="font-bold text-purple-900 block text-xs">
                                  {item.current_expected_arrival_date || item.expected_arrival_date}
                                </span>
                                <span className="text-[10px] text-purple-700">
                                  Duration: {item.current_installation_duration || item.installation_duration || '1'} Days
                                </span>
                              </div>
                            )}

                            {/* Pending Availability Date Request Indicator */}
                            {item.pending_extension && (
                              <div className="pt-1 border-t border-amber-200">
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 w-fit">
                                  <Clock className="w-2.5 h-2.5 text-amber-600" />
                                  <span>Pending Avail: {item.pending_extension.requested_completion_date}</span>
                                </span>
                              </div>
                            )}

                            <div className="text-[10px] text-gray-400 font-mono">{item.expected_arrival_time}</div>
                          </div>
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

                        {/* Actions Column: Direct Post-Installation Device Report & Extensions */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1.5">
                            {!item.has_completion_report ? (
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  onClick={() => setBackupModalJob(item)}
                                  className={`px-2.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer w-fit shadow-2xs ${
                                    item.carry_extra_backup_items
                                      ? 'text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300'
                                      : 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                                  }`}
                                  title="Pre-Installation: Extra Backup Items Declaration"
                                >
                                  <Package className="w-3.5 h-3.5 text-amber-600" /> Pre-Installation Backup Items
                                </button>
                                <button
                                  onClick={() => setCompletionModalJob(item)}
                                  className="px-3 py-1.5 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer w-fit"
                                >
                                  <FileCheck className="w-3.5 h-3.5" /> Post-Installation Device Report
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExtensionModalJob(item)}
                                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer w-fit ${
                                    item.pending_extension
                                      ? 'text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 font-bold'
                                      : 'text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200'
                                  }`}
                                  title={
                                    item.pending_extension
                                      ? `Availability date update to ${item.pending_extension.requested_completion_date} pending review`
                                      : 'Update availability date'
                                  }
                                >
                                  {item.pending_extension ? (
                                    <>
                                      <Clock className="w-3.5 h-3.5 text-amber-700" /> Availability Update Pending
                                    </>
                                  ) : (
                                    <>
                                      <CalendarPlus className="w-3.5 h-3.5 text-amber-600" /> Update Availability Date
                                    </>
                                  )}
                                </button>
                              </div>
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

                            {/* Revision History & Job Details */}
                            <div className="flex items-center gap-2.5 text-[10px] mt-0.5 text-gray-500">
                              <button
                                type="button"
                                onClick={() => setHistoryModalJob(item)}
                                className="font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-0.5 cursor-pointer"
                              >
                                <History className="w-3 h-3" />
                                <span>Schedule History</span>
                              </button>
                              <span>•</span>
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
                              <span>•</span>
                              <button
                                type="button"
                                onClick={() => handleOpenDeleteSingleModal(item)}
                                className="font-semibold text-gray-400 hover:text-rose-600 flex items-center gap-0.5 cursor-pointer"
                                title="Delete checklist record"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
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
                                {Array.isArray(extraConfigs) && extraConfigs.length > 0 && (
                                  <div className="space-y-1 pt-0.5">
                                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                                      Extra Backup ({totalExtra || 0}):
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
                            <strong className="text-gray-900">Engineer:</strong> {item.service_engineer || 'Unassigned'}
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

                            <div className="flex items-center gap-2.5 text-[10px] mt-0.5 text-gray-500">
                              <button
                                type="button"
                                onClick={() => setHistoryModalJob(item)}
                                className="font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-0.5 cursor-pointer"
                              >
                                <History className="w-3 h-3" />
                                <span>Schedule History</span>
                              </button>
                              <span>•</span>
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
                <span>Step 2 — Technician Expenses (Download &amp; Print PDF)</span>
              </span>
              <p className="text-[11px] text-purple-700">
                Enter job expenses, save them, and download the print-ready A4 PDF to physically submit it to accounts. You can do this now or return anytime from Completed Jobs.
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

      {/* AVAILABILITY DATE REQUEST MODAL */}
      {extensionModalJob && (
        <TechnicianScheduleExtensionModal
          checklist={extensionModalJob}
          token={token}
          onClose={() => setExtensionModalJob(null)}
          onSuccess={() => {
            showToast(`Availability date request submitted for ${extensionModalJob.checklist_number}! Coordinator will review.`);
            loadData();
          }}
        />
      )}

      {/* REST DAY REQUEST MODAL */}
      {isRestDayModalOpen && (
        <TechnicianRestDayModal
          token={token}
          onClose={() => setIsRestDayModalOpen(false)}
          onSuccess={() => {
            showToast('Rest day request submitted successfully! Coordinator will review.');
            loadData();
          }}
        />
      )}

      {/* LEAVE REQUEST MODAL */}
      {isLeaveModalOpen && (
        <TechnicianLeaveModal
          token={token}
          onClose={() => setIsLeaveModalOpen(false)}
          onSuccess={() => {
            showToast('Leave request submitted successfully! Coordinator will review.');
            loadData();
          }}
        />
      )}

      {/* SCHEDULE REVISION HISTORY MODAL */}
      {historyModalJob && (
        <ScheduleHistoryModal
          checklist={historyModalJob}
          token={token}
          onClose={() => setHistoryModalJob(null)}
        />
      )}
      {/* PRE-INSTALLATION BACKUP ITEMS DECLARATION MODAL */}
      {backupModalJob && (
        <TechnicianBackupDeclarationModal
          isOpen={Boolean(backupModalJob)}
          job={backupModalJob}
          token={token}
          onClose={() => setBackupModalJob(null)}
          onSaved={() => {
            showToast(`Backup items declaration recorded for ${backupModalJob.checklist_number}!`);
            loadData();
            setBackupModalJob(null);
          }}
        />
      )}

      {/* ---------------------------------------------------- */}
      {/* Delete Single Checklist Modal                        */}
      {/* ---------------------------------------------------- */}
      {deleteSingleModal.open && deleteSingleModal.checklist && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                  <Trash2 size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delete Checklist</h3>
                  <p className="text-[11px] text-gray-500">Technical Team Workspace</p>
                </div>
              </div>
              <button
                disabled={deleteSingleModal.submitting}
                onClick={() => setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, submitting: false, error: '' })}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Checklist Number:</span>
                <span className="font-mono font-bold text-navy">{deleteSingleModal.checklist.checklist_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Client Name:</span>
                <span className="font-bold text-gray-800">{deleteSingleModal.checklist.client_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Installation Status:</span>
                <span className="font-semibold text-gray-700">{deleteSingleModal.checklist.installation_status || 'Pending'}</span>
              </div>
            </div>

            {deleteSingleModal.checking ? (
              <div className="p-6 text-center space-y-2">
                <Loader2 size={24} className="animate-spin text-purple-600 mx-auto" />
                <p className="text-xs text-gray-600 font-medium">Checking operational dependencies...</p>
              </div>
            ) : deleteSingleModal.eligibility?.eligible ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <ShieldCheck size={16} className="text-emerald-600" />
                  <span>Eligible for Permanent Deletion</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  This job has no issued stock, technical reports, bookings, or completed records.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle size={16} className="text-amber-600" />
                  <span>Cannot Be Permanently Deleted</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  This checklist contains dependent operational or inventory history:
                </p>
                <ul className="list-disc list-inside text-[11px] text-amber-900 font-medium space-y-0.5">
                  {(deleteSingleModal.eligibility?.reasons || []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {deleteSingleModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                {deleteSingleModal.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteSingleModal.submitting}
                onClick={() => setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, submitting: false, error: '' })}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              {deleteSingleModal.eligibility?.eligible && (
                <button
                  type="button"
                  disabled={deleteSingleModal.submitting}
                  onClick={handleConfirmDeleteSingle}
                  className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {deleteSingleModal.submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Delete All (Safe Bulk Deletion) Modal                */}
      {/* ---------------------------------------------------- */}
      {deleteAllModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy flex items-center gap-2">
                    <span>Delete All Eligible Checklists</span>
                    <span className="text-[11px] font-semibold bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full">
                      Technical Workspace
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Deletes unstarted draft checklists while strictly preserving active, assigned, and completed jobs.
                  </p>
                </div>
              </div>
              <button
                disabled={deleteAllModal.submitting}
                onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {deleteAllModal.loading ? (
              <div className="py-12 text-center space-y-2">
                <Loader2 size={32} className="animate-spin text-purple-600 mx-auto" />
                <p className="text-xs font-semibold text-gray-700">Evaluating operational dependencies across checklists...</p>
              </div>
            ) : deleteAllModal.result ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    <span>Safe Bulk Deletion Completed</span>
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">{deleteAllModal.result.message}</p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                    <span className="text-[11px] text-emerald-700 font-semibold uppercase block">Deleted</span>
                    <span className="text-xl font-bold text-emerald-900">{deleteAllModal.result.deletedCount}</span>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Preserved / Skipped</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.result.skippedCount}</span>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Failed</span>
                    <span className="text-xl font-bold text-gray-700">{deleteAllModal.result.failedCount}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Total Checklists</span>
                    <span className="text-xl font-bold text-gray-900">{deleteAllModal.preview?.totalCount || 0}</span>
                  </div>
                  <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
                    <span className="text-[11px] text-rose-700 font-semibold uppercase block">Eligible to Delete</span>
                    <span className="text-xl font-bold text-rose-900">{deleteAllModal.preview?.eligibleCount || 0}</span>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Protected / Kept</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.preview?.protectedCount || 0}</span>
                  </div>
                </div>

                {deleteAllModal.preview?.eligibleChecklists && deleteAllModal.preview.eligibleChecklists.length > 0 && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-700 block mb-1.5">
                      Eligible Draft Checklists ({deleteAllModal.preview.eligibleCount}):
                    </span>
                    <div className="max-h-32 overflow-y-auto p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1 font-mono text-[11px]">
                      {deleteAllModal.preview.eligibleChecklists.map((c) => (
                        <div key={c.id} className="flex justify-between text-gray-700">
                          <span>{c.checklist_number} — {c.client_name}</span>
                          <span className="text-gray-400">{c.client_mobile}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(deleteAllModal.preview?.eligibleCount || 0) > 0 ? (
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-2">
                    <span className="font-bold text-amber-900 block">
                      Type <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300">{deleteAllModal.preview?.eligibleCount}</span> to confirm deletion:
                    </span>
                    <input
                      type="text"
                      value={deleteAllModal.confirmedCountInput}
                      onChange={(e) => setDeleteAllModal((prev) => ({ ...prev, confirmedCountInput: e.target.value }))}
                      placeholder={`Enter ${deleteAllModal.preview?.eligibleCount}`}
                      className="w-full px-3 py-2 bg-white rounded-lg border border-amber-300 text-xs font-mono font-bold text-gray-800"
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs text-gray-500">
                    No draft checklists are currently eligible for deletion. All checklists have active dependencies.
                  </div>
                )}

                {deleteAllModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                    {deleteAllModal.error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={deleteAllModal.submitting}
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      deleteAllModal.submitting ||
                      !deleteAllModal.preview?.eligibleCount ||
                      String(deleteAllModal.confirmedCountInput).trim() !== String(deleteAllModal.preview?.eligibleCount)
                    }
                    onClick={handleConfirmDeleteAll}
                    className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    {deleteAllModal.submitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Deleting Records...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        <span>Confirm Delete ({deleteAllModal.preview?.eligibleCount || 0})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
