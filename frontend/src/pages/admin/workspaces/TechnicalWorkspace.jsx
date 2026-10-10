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
  Play,
  RefreshCw,
} from 'lucide-react';
import DeviceCarryModal from '../../../components/workspaces/DeviceCarryModal';
import InstallationCompletionModal from '../../../components/workspaces/InstallationCompletionModal';
import { fetchInstallationChecklists, fetchServiceEngineers, startInstallationJob } from '../../../lib/api';

export default function TechnicalWorkspace({ onSelectChecklist }) {
  const { session, token: authToken, loading: authLoading } = useAuth();
  const token = authToken || session?.access_token;
  const navigate = useNavigate();

  const [checklists, setChecklists] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [selectedEngineer, setSelectedEngineer] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  // Active Modals State
  const [carryModalJob, setCarryModalJob] = useState(null);
  const [completionModalJob, setCompletionModalJob] = useState(null);
  const [viewReportModalJob, setViewReportModalJob] = useState(null);

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
      // 1. Fetch all assigned installation checklists
      const res = await fetchInstallationChecklists(token, { limit: 200 });
      setChecklists(res.checklists || []);

      // 2. Fetch engineers list for filter dropdown
      const engList = await fetchServiceEngineers(token);
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

  const showToast = (msg) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(''), 3500);
  };

  // Filter checklists by Service Engineer (primary filter) AND search query
  const filteredChecklists = checklists.filter((item) => {
    // 1. Service Engineer primary filter
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
  });

  // Calculate dynamic dashboard summary metrics
  const assignedJobsCount = checklists.length;
  const inProgressCount = checklists.filter(
    (c) => c.installation_status === 'In Progress' || c.reconciliation_status === 'STORE_ISSUED'
  ).length;
  const siteCompletedCount = checklists.filter(
    (c) =>
      c.installation_status === 'Site Work Completed' ||
      c.installation_status === 'Completed' ||
      c.reconciliation_status === 'SITE_WORK_COMPLETED' ||
      c.reconciliation_status === 'FULLY_RECONCILED'
  ).length;

  const handleStartInstallation = async (jobId) => {
    try {
      await startInstallationJob(token, jobId);
      showToast('Installation status updated to In Progress.');
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to start installation job');
    }
  };

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
            View assigned installation jobs, record mandatory pre-installation devices carried, start site work, submit completion reports, and declare return items.
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
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Assigned Jobs</p>
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

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Site Work Completed</p>
            <p className="text-2xl font-bold text-gray-900">{siteCompletedCount}</p>
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
            <option value="all">All Engineers ({checklists.length} jobs)</option>
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

      {/* Technical Jobs Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-purple-600" /> Assigned Technical Installation Jobs
          </h3>
          <span className="text-xs text-gray-500 font-medium">
            Showing {filteredChecklists.length} of {checklists.length} jobs
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-gray-600">Loading Technical jobs...</p>
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
        ) : filteredChecklists.length === 0 ? (
          <div className="p-12 text-center text-gray-400 space-y-2">
            <Filter className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="font-semibold text-gray-600">No assigned technical jobs found</p>
            <p className="text-[11px] text-gray-400">
              {checklists.length === 0
                ? 'No installation checklists exist in the database yet.'
                : 'Try adjusting your Service Engineer filter or search query.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client Details</th>
                  <th className="py-3 px-4">Sales Device Request</th>
                  <th className="py-3 px-4">Assigned Team</th>
                  <th className="py-3 px-4">Arrival Date/Time</th>
                  <th className="py-3 px-4">Carry Status</th>
                  <th className="py-3 px-4">Installation Status</th>
                  <th className="py-3 px-4">Reconciliation Status</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredChecklists.map((item) => {
                  const isCarryDone = item.carry_status === 'RECORDED' || item.reconciliation_status === 'CARRY_RECORDED' || item.reconciliation_status === 'STORE_ISSUED';
                  const isReportSubmitted = item.installation_status === 'Site Work Completed' || item.installation_status === 'Completed';

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

                      {/* Sales Device Request */}
                      <td className="py-3 px-4">
                        <span className="font-semibold text-gray-800">{item.device_type}</span>
                        <div className="text-[10px] text-gray-400">Qty: {item.number_of_devices}</div>
                        {item.extra_devices && item.extra_device_type && (
                          <div className="text-[10px] text-purple-600 font-medium">
                            + {item.extra_device_count} {item.extra_device_type}
                          </div>
                        )}
                      </td>

                      {/* Assigned Team */}
                      <td className="py-3 px-4 text-gray-700">
                        <div>
                          <strong className="text-gray-900">Eng:</strong> {item.service_engineer || 'Unassigned'}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          <strong>Asst:</strong> {item.service_assistant || 'Unassigned'}
                        </div>
                      </td>

                      {/* Arrival Schedule */}
                      <td className="py-3 px-4 text-gray-600">
                        <div>{item.expected_arrival_date || 'TBD'}</div>
                        <div className="text-[10px] text-gray-400">{item.expected_arrival_time}</div>
                      </td>

                      {/* Carry Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                            isCarryDone
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}
                        >
                          {isCarryDone ? 'Recorded' : 'Not Recorded'}
                        </span>
                      </td>

                      {/* Installation Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                            isReportSubmitted
                              ? item.reconciliation_status === 'PENDING_STORE_VERIFICATION'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : item.reconciliation_status === 'DISCREPANCY_OPEN'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : isCarryDone
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}
                        >
                          {isReportSubmitted
                            ? item.reconciliation_status === 'PENDING_STORE_VERIFICATION'
                              ? 'Awaiting Store Verification'
                              : item.reconciliation_status === 'DISCREPANCY_OPEN'
                              ? 'Requires Review'
                              : 'Completed'
                            : !isCarryDone
                            ? 'Carry Form Required'
                            : 'Ready for Report'}
                        </span>
                      </td>

                      {/* Reconciliation Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.reconciliation_status === 'FULLY_RECONCILED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.reconciliation_status === 'DISCREPANCY_OPEN'
                              ? 'bg-rose-100 text-rose-800'
                              : item.reconciliation_status === 'PENDING_STORE_VERIFICATION'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {item.reconciliation_status || 'SALES_CREATED'}
                        </span>
                      </td>

                      {/* Actions Column: Single Primary Button per Workflow Stage */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1.5">
                          {/* STAGE 1: Carry record not submitted */}
                          {!isCarryDone && !isReportSubmitted && (
                            <button
                              onClick={() => setCarryModalJob(item)}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer w-fit"
                            >
                              <Truck className="w-3.5 h-3.5" /> Record Devices Carried
                            </button>
                          )}

                          {/* STAGE 2: Carry record submitted, completion report not submitted */}
                          {isCarryDone && !isReportSubmitted && (
                            <button
                              onClick={() => setCompletionModalJob(item)}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer w-fit"
                            >
                              <FileCheck className="w-3.5 h-3.5" /> Record Installed & Returned Devices
                            </button>
                          )}

                          {/* STAGE 3: Completion report submitted */}
                          {isReportSubmitted && (
                            <button
                              onClick={() => setViewReportModalJob(item)}
                              className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1.5 cursor-pointer w-fit"
                            >
                              <FileCheck className="w-3.5 h-3.5 text-blue-600" /> View Installation Report
                            </button>
                          )}

                          {/* SECONDARY LINKS */}
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

                            {/* Optional edit carry record link prior to report submission */}
                            {isCarryDone && !isReportSubmitted && (
                              <>
                                <span>•</span>
                                <button
                                  onClick={() => setCarryModalJob(item)}
                                  className="text-gray-500 hover:text-gray-800 underline font-medium cursor-pointer"
                                  title="Update physical device carry declaration prior to submitting report"
                                >
                                  Edit Carry Record
                                </button>
                              </>
                            )}
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

      {/* MODAL 1: Pre-Installation Device Carry Form */}
      {carryModalJob && (
        <DeviceCarryModal
          checklist={carryModalJob}
          token={token}
          onClose={() => setCarryModalJob(null)}
          onSuccess={() => {
            setCarryModalJob(null);
            showToast('Device carry record submitted successfully!');
            loadData();
          }}
        />
      )}

      {/* MODAL 2: Post-Installation Completion Form (Editable) */}
      {completionModalJob && (
        <InstallationCompletionModal
          checklist={completionModalJob}
          token={token}
          onClose={() => setCompletionModalJob(null)}
          onSuccess={() => {
            setCompletionModalJob(null);
            showToast('Post-installation completion report submitted!');
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
    </div>
  );
}
