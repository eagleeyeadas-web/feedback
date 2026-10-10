import { useState, useEffect } from 'react';
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
  RotateCcw,
} from 'lucide-react';
import DeviceCarryModal from '../../../components/workspaces/DeviceCarryModal';
import InstallationCompletionModal from '../../../components/workspaces/InstallationCompletionModal';
import { fetchServiceEngineers, startInstallationJob } from '../../../lib/api';

export default function TechnicalWorkspace({ onSelectChecklist }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [selectedEngineer, setSelectedEngineer] = useState('all');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  // Active Modals State
  const [carryModalJob, setCarryModalJob] = useState(null);
  const [completionModalJob, setCompletionModalJob] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch checklists
      const res = await fetch('/api/admin/installations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setChecklists(data.checklists || []);
      }

      // 2. Fetch engineers list for filter dropdown
      const engList = await fetchServiceEngineers(token);
      setEngineers(engList || []);
    } catch (err) {
      console.error('Failed to load Technical workspace data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const showToast = (msg) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(''), 3500);
  };

  // Filter checklists by Service Engineer (primary filter) AND search text
  const filteredChecklists = checklists.filter((item) => {
    // Service Engineer primary filter matching engineer ID or engineer name
    let matchesEngineer = true;
    if (selectedEngineer !== 'all') {
      const targetEng = engineers.find((e) => e.id === selectedEngineer);
      const targetName = targetEng ? targetEng.name.toLowerCase() : selectedEngineer.toLowerCase();

      const engPrimaryName = (item.service_engineer || '').toLowerCase();
      matchesEngineer = engPrimaryName.includes(targetName) || item.service_engineer === selectedEngineer;
    }

    // Text search matching checklist_number, client_name, service_engineer, service_assistant
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

  // Calculate dynamic metric counts based on filtered results
  const assignedJobsCount = filteredChecklists.length;
  const inProgressCount = filteredChecklists.filter(
    (c) => c.installation_status === 'In Progress' || c.reconciliation_status === 'STORE_ISSUED'
  ).length;
  const siteCompletedCount = filteredChecklists.filter(
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
            Record mandatory pre-installation physical devices carried, start installation jobs, submit site installation completion reports, and declare unused devices for store verification.
          </p>
        </div>
      </div>

      {/* Metrics Bar (Updates based on filtered results) */}
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
            <option value="all">All Engineers</option>
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
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-gray-400">
                    Loading Technical jobs...
                  </td>
                </tr>
              ) : filteredChecklists.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400 space-y-2">
                    <Filter className="w-8 h-8 text-gray-300 mx-auto" />
                    <p className="font-semibold text-gray-600">No matching installation jobs found.</p>
                    <p className="text-[11px] text-gray-400">
                      Try adjusting your Service Engineer filter or search keywords.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredChecklists.map((item) => {
                  const isCarryDone = item.carry_status === 'RECORDED';
                  const isStarted = ['In Progress', 'Site Work Completed', 'Completed'].includes(
                    item.installation_status
                  );
                  const isCompleted = item.installation_status === 'Completed' || item.installation_status === 'Site Work Completed';

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

                      {/* Sales Request */}
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
                          {isCarryDone ? 'RECORDED' : 'NOT RECORDED'}
                        </span>
                      </td>

                      {/* Installation Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                            item.installation_status === 'Completed' || item.installation_status === 'Site Work Completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.installation_status === 'In Progress'
                              ? 'bg-blue-100 text-blue-800'
                              : item.installation_status === 'Ready to Start'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {!isCarryDone && item.installation_status !== 'Completed'
                            ? 'Carry Form Required'
                            : item.installation_status}
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

                      {/* Actions Column */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1.5">
                          {/* 1. Pre-Installation Carry Form Button */}
                          {!isCarryDone ? (
                            <button
                              onClick={() => setCarryModalJob(item)}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                            >
                              <Truck className="w-3 h-3" /> Record Devices Carried
                            </button>
                          ) : (
                            <button
                              onClick={() => setCarryModalJob(item)}
                              className="px-2.5 py-1 text-[10px] font-medium text-gray-600 hover:text-gray-900 bg-gray-100 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Truck className="w-3 h-3 text-emerald-600" /> View Carry Record
                            </button>
                          )}

                          {/* 2. Start Installation Button (Only after carry form done and not started yet) */}
                          {isCarryDone && !isStarted && (
                            <button
                              onClick={() => handleStartInstallation(item.id)}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-3 h-3" /> Start Installation
                            </button>
                          )}

                          {/* 3. Post-Installation Completion Form Button */}
                          {isStarted && (
                            <button
                              onClick={() => setCompletionModalJob(item)}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                            >
                              <FileCheck className="w-3 h-3" /> {isCompleted ? 'View/Update Completion' : 'Complete Installation'}
                            </button>
                          )}

                          {/* View Checklist Details */}
                          <button
                            onClick={() =>
                              onSelectChecklist
                                ? onSelectChecklist(item.id)
                                : navigate(`/admin/installation-checklists/${item.id}`)
                            }
                            className="text-[11px] font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1 mt-0.5"
                          >
                            Job Details <ArrowRight className="w-3 h-3" />
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

      {/* MODAL 1: Mandatory Pre-Installation Device Carry Form */}
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

      {/* MODAL 2: Post-Installation Completion Form */}
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
    </div>
  );
}
