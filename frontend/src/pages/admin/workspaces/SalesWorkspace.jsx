import { useState, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  Wrench,
  FileText,
  Calendar,
  CreditCard,
  ArrowRight,
  Search,
  CheckCircle2,
  History,
  Trash2,
  AlertTriangle,
  X,
  Loader2,
  ShieldCheck,
  Check,
} from 'lucide-react';
import {
  fetchInstallationChecklists,
  fetchCustomers,
  fetchAdminQuotations,
  fetchChecklistDeletionPreviewApi,
  deleteAllEligibleChecklistsApi,
  checkChecklistDeletionEligibilityApi,
  deleteChecklistApi,
  cancelChecklistApi,
} from '../../../lib/api';
import EngineerAvailabilityCalendar from '../../../components/workspaces/EngineerAvailabilityCalendar';

export default function SalesWorkspace({ onSelectChecklist, onCreateChecklist, onNavigateTab }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [quotationsCount, setQuotationsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toastMsg, setToastMsg] = useState('');

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

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [checkData, custData, quoteData] = await Promise.all([
        fetchInstallationChecklists(token, { limit: 50 }).catch(() => ({ checklists: [] })),
        fetchCustomers(token, { limit: 10 }).catch(() => ({ customers: [] })),
        fetchAdminQuotations(token, { limit: 1 }).catch(() => ({ totalCount: 0 })),
      ]);

      setChecklists(checkData?.checklists || []);
      setCustomers(custData?.customers || []);
      setQuotationsCount(quoteData?.totalCount || 0);
    } catch (err) {
      console.error('Failed to load Sales workspace data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  // Handle Opening Single Checklist Deletion Modal with Pre-check
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
      showToast(`Checklist ${checklist.checklist_number} permanently deleted.`);
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

  // Handle Bulk Deletion Modal
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

  const filteredChecklists = checklists.filter((c) =>
    (c.client_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.checklist_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.salesperson_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.client_location || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="bg-gradient-to-r from-blue-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-blue-500/30 text-blue-200 rounded-md border border-blue-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Users className="w-7 h-7 text-blue-400" /> Sales & Customer Intake Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            Create customer records, initiate installation checklists with original client requirements, generate official quotations, review quotation records, and monitor job progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab ? onNavigateTab('quotation-generator') : navigate('/sales?tab=quotation-generator')}
            className="px-3.5 py-2 text-xs font-bold text-white bg-blue-700/80 hover:bg-blue-700 border border-blue-400/30 rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-blue-200" />
            <span>Generate Quotation</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab ? onNavigateTab('quotation-history') : navigate('/sales?tab=quotation-history')}
            className="px-3.5 py-2 text-xs font-bold text-white bg-blue-700/80 hover:bg-blue-700 border border-blue-400/30 rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <History className="w-3.5 h-3.5 text-blue-200" />
            <span>Quotation History</span>
          </button>

          <button
            type="button"
            onClick={() => onCreateChecklist ? onCreateChecklist() : navigate('/sales?create=true')}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Installation Checklist</span>
          </button>

          <button
            type="button"
            id="sales-delete-all-btn"
            onClick={handleOpenDeleteAllModal}
            className="px-3.5 py-2 text-xs font-bold text-rose-200 bg-rose-900/60 hover:bg-rose-800 border border-rose-400/40 rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            title="Clean eligible draft checklists without affecting active jobs"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-300" />
            <span>Delete All / Clean Test Jobs</span>
          </button>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Wrench className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Total Checklists</p>
            <p className="text-xl font-bold text-gray-900">{checklists.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Assigned Jobs</p>
            <p className="text-xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'Assigned' || c.installation_status === 'Pending').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Completed Jobs</p>
            <p className="text-xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'Completed' || c.installation_status === 'Site Work Completed').length}
            </p>
          </div>
        </div>

        <div
          onClick={() => onNavigateTab ? onNavigateTab('quotation-history') : navigate('/sales?tab=quotation-history')}
          className="bg-white p-4 rounded-xl border border-gray-200 hover:border-blue-300 shadow-xs flex items-center gap-3 cursor-pointer transition"
          title="Click to view Quotation History"
        >
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Quotations</p>
            <p className="text-xl font-bold text-gray-900">{quotationsCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Customer Profiles</p>
            <p className="text-xl font-bold text-gray-900">{customers.length}</p>
          </div>
        </div>
      </div>

      {/* FIELD ENGINEER AVAILABILITY CALENDAR */}
      <EngineerAvailabilityCalendar
        token={token}
        onSelectChecklist={onSelectChecklist}
        onCreateWithEngineer={(engName) => {
          if (onCreateChecklist) onCreateChecklist();
          else navigate('/admin/installation-checklists/create');
        }}
      />

      {/* Search & Actions */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter Sales checklists by client name, checklist number, or location..."
          className="w-full text-xs bg-transparent border-none outline-none text-gray-800 placeholder-gray-400"
        />
      </div>

      {/* Sales Job Checklists Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Sales Initiated Installation Checklists</h3>
          <span className="text-xs text-gray-500 font-medium">Showing {filteredChecklists.length} jobs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">Checklist No.</th>
                <th className="py-3 px-4">Client Name & Mobile</th>
                <th className="py-3 px-4">Device Requested</th>
                <th className="py-3 px-4">Vehicles</th>
                <th className="py-3 px-4">Confirmed Price</th>
                <th className="py-3 px-4">Expected Arrival</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">Loading Sales job checklists...</td>
                </tr>
              ) : filteredChecklists.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">No matching Sales checklists found.</td>
                </tr>
              ) : (
                filteredChecklists.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-700">{item.checklist_number}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900">{item.client_name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{item.client_mobile}</div>
                      <div className="text-[10px] text-blue-700 font-semibold mt-0.5">
                        Sales: {item.salesperson_name || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {Array.isArray(item.device_configurations) && item.device_configurations.length > 1 ? (
                        <div>
                          <div className="font-bold text-gray-900 text-xs">
                            {item.number_of_devices} Devices ({item.device_configurations.length} types)
                          </div>
                          <div className="text-[10px] text-indigo-700 font-medium leading-tight mt-0.5">
                            {item.device_configurations.map((dc) => `${dc.device_type} (${dc.number_of_devices})`).join(', ')}
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="font-medium text-gray-800">{item.device_type}</span>
                          <div className="text-[10px] text-gray-400">Qty: {item.number_of_devices}</div>
                        </>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">{item.number_of_vehicles} vehicles ({item.vehicle_type || 'Lorry'})</td>
                    <td className="py-3 px-4 font-mono font-bold text-gray-900">₹{item.confirmed_price || 0}</td>
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
                          <div className="pt-1 border-t border-blue-100">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-bold text-blue-700 uppercase">Current Expected</span>
                              <span className="text-[9px] font-extrabold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded border border-blue-300">
                                Rev {item.schedule_revision_count || 1}
                              </span>
                            </div>
                            <span className="font-bold text-blue-900 block text-xs">
                              {item.current_expected_arrival_date || item.expected_arrival_date}
                            </span>
                            <span className="text-[10px] text-blue-700">
                              Duration: {item.current_installation_duration || item.installation_duration || '1'} Days
                            </span>
                          </div>
                        )}

                        <div className="text-[10px] text-gray-400 font-mono">{item.expected_arrival_time}</div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        item.installation_status === 'Completed' || item.installation_status === 'Site Work Completed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : item.installation_status === 'In Progress'
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : item.installation_status === 'Assigned'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {item.installation_status === 'Site Work Completed' ? 'Completed' : (item.installation_status || 'Assigned')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onSelectChecklist ? onSelectChecklist(item.id) : navigate(`/admin/installation-checklists/${item.id}`)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                        >
                          View Details <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteSingleModal(item)}
                          className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete checklist record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-navy text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
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
                  <p className="text-[11px] text-gray-500">Sales Operational Workspace</p>
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
                <span className="text-gray-500">Mobile Number:</span>
                <span className="font-mono text-gray-700">{deleteSingleModal.checklist.client_mobile}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Installation Status:</span>
                <span className="font-semibold text-gray-700">{deleteSingleModal.checklist.installation_status || 'Pending'}</span>
              </div>
            </div>

            {deleteSingleModal.checking ? (
              <div className="p-6 text-center space-y-2">
                <Loader2 size={24} className="animate-spin text-blue-600 mx-auto" />
                <p className="text-xs text-gray-600 font-medium">Checking operational dependencies...</p>
              </div>
            ) : deleteSingleModal.eligibility?.eligible ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <ShieldCheck size={16} className="text-emerald-600" />
                  <span>Eligible for Permanent Deletion</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  This checklist has no active bookings, issued materials, reports, or device returns.
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
                      Sales Workspace
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
                <Loader2 size={32} className="animate-spin text-blue-600 mx-auto" />
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
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs"
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
