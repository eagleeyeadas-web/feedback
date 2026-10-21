import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchInstallationChecklists,
  deleteInstallationChecklist,
  checkInstallationChecklistEligibility,
  previewInstallationChecklistsDeletion,
  deleteAllEligibleInstallationChecklists,
  cancelChecklistApi,
} from '../../../lib/api';
import { downloadInstallationExcel, downloadAllInstallationsExcel } from '../../../lib/excelHelper';
import {
  Search,
  Plus,
  Filter,
  Eye,
  Edit,
  Trash2,
  FileSpreadsheet,
  FileDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  MapPin,
  ExternalLink,
  Share2,
  CheckCircle2,
  Wrench,
  ShieldAlert,
  ShieldCheck,
  Check,
  X,
  Info,
  Loader2,
} from 'lucide-react';

export default function InstallationChecklistList({ onSelectChecklist, onCreateNew }) {
  const { session, role } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();

  const userRole = (role || 'ADMIN').toUpperCase();
  const canCreateOrEdit = userRole === 'SALES' || userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
  const canDelete = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'COORDINATOR' || userRole === 'SALES';

  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Filters & Pagination State
  const [search, setSearch] = useState('');
  const [installationStatus, setInstallationStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [installationOrService, setInstallationOrService] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Single Delete Modal State
  const [deleteSingleModal, setDeleteSingleModal] = useState({
    open: false,
    checklist: null,
    checking: false,
    eligibility: null,
    error: '',
    deleting: false,
    cancelling: false,
  });

  // Delete All (Bulk) Modal State
  const [deleteAllModal, setDeleteAllModal] = useState({
    open: false,
    loading: false,
    preview: null,
    error: '',
    submitting: false,
    confirmedChecked: false,
    activeTab: 'eligible', // 'eligible' or 'protected'
    result: null,
  });

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchInstallationChecklists(token, {
        search,
        installationStatus,
        paymentStatus,
        installationOrService,
        vehicleType,
        dateFrom,
        dateTo,
        page,
        limit: 15,
      });
      setChecklists(res.checklists || []);
      setTotalPages(res.totalPages || 1);
      setTotalCount(res.totalCount || 0);
    } catch (err) {
      console.error('Error loading installation checklists:', err);
      setError(err.message || 'Failed to load checklists');
    } finally {
      setLoading(false);
    }
  }, [token, search, installationStatus, paymentStatus, installationOrService, vehicleType, dateFrom, dateTo, page]);

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
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  const handleResetFilters = () => {
    setSearch('');
    setInstallationStatus('');
    setPaymentStatus('');
    setInstallationOrService('');
    setVehicleType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // Open Single Delete Modal & Check Eligibility
  const openDeleteSingleModal = async (chk) => {
    setDeleteSingleModal({
      open: true,
      checklist: chk,
      checking: true,
      eligibility: null,
      error: '',
      deleting: false,
      cancelling: false,
    });

    try {
      const eligibility = await checkInstallationChecklistEligibility(token, chk.id);
      setDeleteSingleModal((prev) => (prev.open ? { ...prev, checking: false, eligibility } : prev));
    } catch (err) {
      setDeleteSingleModal((prev) => (prev.open ? { ...prev, checking: false, error: err.message || 'Failed to check eligibility' } : prev));
    }
  };

  // Confirm Single Delete
  const handleConfirmDeleteSingle = async () => {
    if (!deleteSingleModal.checklist || !token) return;
    setDeleteSingleModal((prev) => ({ ...prev, deleting: true, error: '' }));
    try {
      const res = await deleteInstallationChecklist(token, deleteSingleModal.checklist.id);
      showToast(res.message || `Checklist ${deleteSingleModal.checklist.checklist_number} permanently deleted.`);
      setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, error: '', deleting: false, cancelling: false });
      loadData();
    } catch (err) {
      console.error('Failed to delete checklist:', err);
      setDeleteSingleModal((prev) => ({
        ...prev,
        deleting: false,
        error: err.message || 'Failed to delete checklist',
        eligibility: err.reasons ? { ...prev.eligibility, reasons: err.reasons, canCancel: err.canCancel } : prev.eligibility,
      }));
    }
  };

  // Cancel Single Checklist (Safe Preservation)
  const handleCancelChecklistSingle = async () => {
    if (!deleteSingleModal.checklist || !token) return;
    setDeleteSingleModal((prev) => ({ ...prev, cancelling: true, error: '' }));
    try {
      await cancelChecklistApi(token, deleteSingleModal.checklist.id, 'Cancelled via Checklist Manager');
      showToast(`Checklist ${deleteSingleModal.checklist.checklist_number} marked as Cancelled.`);
      setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, error: '', deleting: false, cancelling: false });
      loadData();
    } catch (err) {
      console.error('Failed to cancel checklist:', err);
      setDeleteSingleModal((prev) => ({
        ...prev,
        cancelling: false,
        error: err.message || 'Failed to cancel checklist',
      }));
    }
  };

  // Open Delete All Modal & Fetch Preview
  const openDeleteAllModal = async () => {
    setDeleteAllModal({
      open: true,
      loading: true,
      preview: null,
      error: '',
      submitting: false,
      confirmedChecked: false,
      activeTab: 'eligible',
      result: null,
    });

    try {
      const preview = await previewInstallationChecklistsDeletion(token, {
        search,
        status: installationStatus,
      });
      setDeleteAllModal((prev) => (prev.open ? {
        ...prev,
        loading: false,
        preview,
        activeTab: preview.eligibleCount > 0 ? 'eligible' : 'protected',
      } : prev));
    } catch (err) {
      setDeleteAllModal((prev) => (prev.open ? {
        ...prev,
        loading: false,
        error: err.message || 'Failed to load checklist deletion preview',
      } : prev));
    }
  };

  // Confirm Delete All Eligible
  const handleConfirmDeleteAll = async () => {
    if (!deleteAllModal.preview || !token) return;
    setDeleteAllModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const res = await deleteAllEligibleInstallationChecklists(
        token,
        deleteAllModal.preview.eligibleCount,
        { search, status: installationStatus }
      );
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        result: res,
      }));
      showToast(`Bulk deletion completed: ${res.deletedCount} deleted, ${res.skippedCount} preserved.`);
      loadData();
    } catch (err) {
      console.error('Failed to bulk delete checklists:', err);
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete eligible checklists',
        preview: err.preview || prev.preview,
      }));
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Completed':
      case 'Site Work Completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Assigned':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Assign Later':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getPaymentBadge = (status) => {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Partially Paid':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      default:
        return 'bg-rose-100 text-rose-800 border-rose-300';
    }
  };

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt || 0);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium animate-bounce">
          <CheckCircle2 size={18} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-navy flex items-center gap-2">
            <Wrench className="text-blue-600" size={24} />
            Installation Checklists
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Manage client vehicle device installation and service records ({totalCount} total)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canDelete && (
            <button
              onClick={openDeleteAllModal}
              title="Delete all eligible draft and unprocessed checklists"
              className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-xs"
            >
              <Trash2 size={16} />
              <span>Delete All</span>
            </button>
          )}

          <button
            onClick={() => {
              downloadAllInstallationsExcel(checklists);
              showToast('Exported all checklists to Excel successfully!');
            }}
            title="Download all listed checklists as Excel file"
            className="flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-xs"
          >
            <FileSpreadsheet size={16} />
            <span>Export Excel</span>
          </button>

          {canCreateOrEdit && (
            <button
              onClick={() => {
                if (onCreateNew) onCreateNew();
                else navigate('/admin/installation-checklists/create');
              }}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer"
            >
              <Plus size={18} />
              <span>Create Checklist</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Checklist No, Client Name, Mobile, Location..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </form>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                showFilters || installationStatus || paymentStatus || installationOrService || vehicleType || dateFrom
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <Filter size={15} />
              <span>Filters</span>
              {(installationStatus || paymentStatus || installationOrService || vehicleType || dateFrom) && (
                <span className="w-2 h-2 rounded-full bg-blue-600" />
              )}
            </button>

            <button
              onClick={loadData}
              title="Refresh Data"
              className="p-2 text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Filter Drawer */}
        {showFilters && (
          <div className="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Installation Status
              </label>
              <select
                value={installationStatus}
                onChange={(e) => { setInstallationStatus(e.target.value); setPage(1); }}
                className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">All Statuses</option>
                <option value="Assigned">Assigned</option>
                <option value="Assign Later">Assign Later</option>
                <option value="Completed">Completed</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Payment Status
              </label>
              <select
                value={paymentStatus}
                onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}
                className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">All Payments</option>
                <option value="Paid">Paid</option>
                <option value="Partially Paid">Partially Paid</option>
                <option value="Pending">Pending</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Type
              </label>
              <select
                value={installationOrService}
                onChange={(e) => { setInstallationOrService(e.target.value); setPage(1); }}
                className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">All Types</option>
                <option value="Installation">Installation</option>
                <option value="Service">Service</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Vehicle Type
              </label>
              <select
                value={vehicleType}
                onChange={(e) => { setVehicleType(e.target.value); setPage(1); }}
                className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">All Vehicles</option>
                <option value="Lorry">Lorry</option>
                <option value="Truck">Truck</option>
                <option value="Bus">Bus</option>
                <option value="Heavy Vehicle">Heavy Vehicle</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={handleResetFilters}
                className="w-full py-2 px-3 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 font-medium rounded-lg transition-colors cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-gray-700">
              {isWakingUp
                ? 'Connecting to backend... Free-tier server is spinning up (takes ~15-20s on initial load)'
                : 'Loading installation checklists...'}
            </p>
            {isWakingUp && (
              <p className="text-[11px] text-gray-400 mt-1">Please wait while the server container finishes starting.</p>
            )}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">
            <AlertTriangle className="mx-auto mb-2" size={28} />
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={loadData}
              className="mt-3 text-xs bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg border border-rose-200"
            >
              Retry
            </button>
          </div>
        ) : checklists.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Wrench className="mx-auto mb-3 opacity-40" size={40} />
            <p className="text-sm font-semibold text-gray-600">No installation checklists found</p>
            <p className="text-xs mt-1">Try adjusting your search criteria or create a new checklist.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Checklist Number</th>
                  <th className="py-3.5 px-4">Client Name</th>
                  <th className="py-3.5 px-4">Mobile Number</th>
                  <th className="py-3.5 px-4">Client Location</th>
                  <th className="py-3.5 px-4">Installation Status</th>
                  <th className="py-3.5 px-4">Payment Status</th>
                  <th className="py-3.5 px-4">Created Date</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {checklists.map((item) => (
                  <tr key={item.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-blue-900 whitespace-nowrap">
                      {item.checklist_number}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-navy whitespace-nowrap">
                      {item.client_name}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-gray-600">
                      {item.client_mobile}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-gray-600">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1 font-semibold text-navy">
                          <MapPin size={13} className="text-blue-600 shrink-0" />
                          {item.client_location || '—'}
                        </span>
                        {item.google_maps_location ? (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <a
                              href={item.google_maps_location}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={item.google_maps_location}
                              className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200/60 max-w-[170px] truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={11} className="shrink-0 text-blue-600" />
                              <span className="truncate">Open GMap</span>
                            </a>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(item.google_maps_location);
                                showToast('Google Maps URL copied to clipboard!');
                              }}
                              title="Copy Google Maps URL to share"
                              className="p-1 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                            >
                              <Share2 size={12} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">No Map Link</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${getStatusBadge(item.installation_status)}`}>
                        {item.installation_status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getPaymentBadge(item.payment_status)}`}>
                        {item.payment_status}
                      </span>
                      <span className="text-[10px] text-gray-500 block font-mono mt-0.5">
                        {formatCurrency(item.confirmed_price)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-500 text-[11px]">
                      {new Date(item.created_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Action */}
                        <button
                          onClick={() => {
                            if (onSelectChecklist) onSelectChecklist(item.id, 'view');
                            else navigate(`/admin/installation-checklists/${item.id}`);
                          }}
                          title="View Checklist"
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Eye size={16} />
                        </button>

                        {/* Edit Action */}
                        {canCreateOrEdit && (
                          <button
                            onClick={() => {
                              if (onSelectChecklist) onSelectChecklist(item.id, 'edit');
                              else navigate(`/admin/installation-checklists/${item.id}/edit`);
                            }}
                            title="Edit Checklist"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit size={16} />
                          </button>
                        )}

                        {/* Download PDF Action */}
                        <button
                          onClick={() => {
                            if (onSelectChecklist) onSelectChecklist(item.id, 'download');
                            else navigate(`/admin/installation-checklists/${item.id}?action=download`);
                          }}
                          title="Download PDF"
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <FileDown size={16} />
                        </button>

                        {/* Download Excel Action */}
                        <button
                          onClick={() => {
                            downloadInstallationExcel(item);
                            showToast(`Excel file downloaded for ${item.checklist_number}`);
                          }}
                          title="Download as Excel"
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <FileSpreadsheet size={16} />
                        </button>

                        {/* Delete Action */}
                        {canDelete && (
                          <button
                            onClick={() => openDeleteSingleModal(item)}
                            title={`Delete Checklist ${item.checklist_number}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border border-rose-200/80 rounded-lg transition-colors cursor-pointer shadow-2xs"
                          >
                            <Trash2 size={13} className="text-rose-600" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Showing page <strong className="text-gray-700">{page}</strong> of <strong className="text-gray-700">{totalPages}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* Individual Checklist Delete Modal                   */}
      {/* ---------------------------------------------------- */}
      {deleteSingleModal.open && deleteSingleModal.checklist && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${
                  deleteSingleModal.eligibility && !deleteSingleModal.eligibility.isEligible
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-rose-50 text-rose-600'
                }`}>
                  {deleteSingleModal.eligibility && !deleteSingleModal.eligibility.isEligible ? (
                    <ShieldAlert size={24} />
                  ) : (
                    <Trash2 size={24} />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy">
                    {deleteSingleModal.eligibility && !deleteSingleModal.eligibility.isEligible
                      ? 'Protected Checklist'
                      : 'Confirm Deletion'}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    Ref: {deleteSingleModal.checklist.checklist_number} • Client: {deleteSingleModal.checklist.client_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, error: '', deleting: false, cancelling: false })}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Checking State */}
            {deleteSingleModal.checking ? (
              <div className="py-8 text-center">
                <Loader2 size={28} className="animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-700">Verifying operational dependencies & audit safety...</p>
                <p className="text-[11px] text-gray-400 mt-1">Checking store issuances, stock ledger, technician reports, and bookings</p>
              </div>
            ) : deleteSingleModal.error && !deleteSingleModal.eligibility ? (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-4">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={15} />
                  <span>Error Checking Dependencies</span>
                </p>
                <p className="mt-1">{deleteSingleModal.error}</p>
              </div>
            ) : deleteSingleModal.eligibility && !deleteSingleModal.eligibility.isEligible ? (
              /* Protected Record View */
              <div className="space-y-4">
                <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-amber-900 text-xs">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <ShieldAlert size={16} className="text-amber-700 shrink-0" />
                    <span>Permanent Deletion Blocked to Protect Operational History</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    This checklist cannot be deleted because it is tied to active operations, stock records, or audit history:
                  </p>
                  <ul className="mt-2 list-disc list-inside space-y-1 font-medium text-[11px] text-amber-900 bg-white/70 p-2.5 rounded-lg border border-amber-200/60">
                    {deleteSingleModal.eligibility.reasons.map((reason, idx) => (
                      <li key={idx} className="leading-snug">{reason}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs text-gray-600">
                  <p className="font-semibold text-gray-700 flex items-center gap-1.5">
                    <Info size={14} className="text-blue-600" />
                    <span>SafDrive Data Safety Policy</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed">
                    Jobs with issued store stock, completed technical reports, or active bookings cannot be deleted to prevent data corruption and ensure complete audit accountability.
                  </p>
                </div>

                {deleteSingleModal.eligibility.canCancel && (
                  <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">Cancel Job Instead?</p>
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        Marks the checklist as Cancelled to release scheduled engineers while safely preserving history.
                      </p>
                    </div>
                    <button
                      disabled={deleteSingleModal.cancelling}
                      onClick={handleCancelChecklistSingle}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {deleteSingleModal.cancelling ? 'Cancelling...' : 'Cancel Job'}
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, error: '', deleting: false, cancelling: false })}
                    className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              /* Eligible for Deletion View */
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold block">Verified Eligible for Safe Deletion</span>
                    <span className="text-[11px] text-emerald-700">This unprocessed draft record has no stock movements, issued materials, reports, or bookings.</span>
                  </div>
                </div>

                <div className="text-xs text-gray-600 leading-relaxed space-y-2">
                  <p>
                    Are you sure you want to permanently delete checklist{' '}
                    <strong className="text-navy font-bold font-mono">{deleteSingleModal.checklist.checklist_number}</strong>{' '}
                    for client <strong className="text-navy font-bold">{deleteSingleModal.checklist.client_name}</strong>?
                  </p>
                  <p className="text-[11px] text-rose-600 font-medium">
                    This action is permanent and will remove the checklist from the system.
                  </p>
                </div>

                {deleteSingleModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                    {deleteSingleModal.error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                  <button
                    disabled={deleteSingleModal.deleting}
                    onClick={() => setDeleteSingleModal({ open: false, checklist: null, checking: false, eligibility: null, error: '', deleting: false, cancelling: false })}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={deleteSingleModal.deleting}
                    onClick={handleConfirmDeleteSingle}
                    className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {deleteSingleModal.deleting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        <span>Yes, Delete Checklist</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Delete All (Safe Bulk Deletion) Modal                */}
      {/* ---------------------------------------------------- */}
      {deleteAllModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy flex items-center gap-2">
                    <span>Delete All Checklists</span>
                    <span className="text-[11px] font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">
                      Safe Bulk Deletion
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Deletes eligible draft checklists while strictly preserving active, assigned, and completed jobs.
                  </p>
                </div>
              </div>
              <button
                disabled={deleteAllModal.submitting}
                onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            {deleteAllModal.loading ? (
              <div className="py-12 text-center">
                <Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />
                <p className="text-xs font-semibold text-gray-700">Evaluating operational dependencies across all checklists...</p>
                <p className="text-[11px] text-gray-400 mt-1">Analyzing store requirements, stock ledger, technical reports, and bookings</p>
              </div>
            ) : deleteAllModal.result ? (
              /* Result Card */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    <span>Safe Bulk Deletion Completed Successfully</span>
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">
                    All eligible draft checklists have been safely removed. Protected operational records remain intact.
                  </p>
                </div>

                {/* Stat breakdown */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
                    <span className="text-[11px] text-emerald-700 font-semibold uppercase block">Deleted</span>
                    <span className="text-xl font-bold text-emerald-900">{deleteAllModal.result.deletedCount}</span>
                  </div>
                  <div className="p-3 bg-blue-50/60 border border-blue-200/60 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Protected / Skipped</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.result.skippedCount}</span>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Failed</span>
                    <span className="text-xl font-bold text-gray-700">{deleteAllModal.result.failedCount}</span>
                  </div>
                </div>

                {deleteAllModal.result.deletedChecklists && deleteAllModal.result.deletedChecklists.length > 0 && (
                  <div className="text-xs">
                    <span className="font-semibold text-gray-700 block mb-1">Deleted Checklists:</span>
                    <div className="max-h-32 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-200 font-mono text-[11px] text-gray-600 space-y-0.5">
                      {deleteAllModal.result.deletedChecklists.map((c) => (
                        <div key={c.id}>✓ {c.checklist_number} — {c.client_name}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : deleteAllModal.preview ? (
              /* Preview View */
              <div className="space-y-4">
                {/* 3 Summary Stat Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-center">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase block tracking-wider">Total Checklists</span>
                    <span className="text-2xl font-bold text-gray-900 mt-1 block">{deleteAllModal.preview.totalCount}</span>
                  </div>
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-center">
                    <span className="text-[11px] font-semibold text-rose-700 uppercase block tracking-wider">Eligible to Delete</span>
                    <span className="text-2xl font-bold text-rose-700 mt-1 block">{deleteAllModal.preview.eligibleCount}</span>
                  </div>
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                    <span className="text-[11px] font-semibold text-emerald-700 uppercase block tracking-wider">Protected / Preserved</span>
                    <span className="text-2xl font-bold text-emerald-800 mt-1 block">{deleteAllModal.preview.protectedCount}</span>
                  </div>
                </div>

                {/* Protection Safeguard Notice */}
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <ShieldAlert size={16} className="text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Business Protection Safeguard:</strong> Active, assigned, in-progress, or completed jobs, as well as checklists with issued store materials, stock movements, or technician reports are strictly protected and will <strong>never</strong> be deleted.
                  </p>
                </div>

                {deleteAllModal.preview.eligibleCount === 0 ? (
                  <div className="p-8 text-center bg-gray-50 border border-gray-200 rounded-xl">
                    <CheckCircle2 size={32} className="text-emerald-600 mx-auto mb-2" />
                    <p className="text-xs font-bold text-gray-800">No Eligible Draft Checklists Found</p>
                    <p className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto">
                      All {deleteAllModal.preview.totalCount} existing checklist(s) are protected operational records with active status, stock issuances, or completion reports.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Tabs to inspect Eligible vs Protected */}
                    <div className="flex items-center gap-2 border-b border-gray-200">
                      <button
                        onClick={() => setDeleteAllModal((prev) => ({ ...prev, activeTab: 'eligible' }))}
                        className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                          deleteAllModal.activeTab === 'eligible'
                            ? 'border-rose-600 text-rose-700'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Eligible Drafts ({deleteAllModal.preview.eligibleCount})
                      </button>
                      <button
                        onClick={() => setDeleteAllModal((prev) => ({ ...prev, activeTab: 'protected' }))}
                        className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                          deleteAllModal.activeTab === 'protected'
                            ? 'border-blue-600 text-blue-700'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Protected Jobs ({deleteAllModal.preview.protectedCount})
                      </button>
                    </div>

                    {/* Tab 1: Eligible List */}
                    {deleteAllModal.activeTab === 'eligible' && (
                      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 text-xs">
                        {deleteAllModal.preview.eligibleChecklists.map((chk) => (
                          <div key={chk.id} className="p-2.5 flex items-center justify-between hover:bg-gray-50">
                            <div>
                              <span className="font-bold text-navy font-mono">{chk.checklist_number}</span>
                              <span className="text-gray-600 ml-2">{chk.client_name}</span>
                            </div>
                            <span className="text-[10px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded font-medium border border-rose-200">
                              Unprocessed Draft
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tab 2: Protected List */}
                    {deleteAllModal.activeTab === 'protected' && (
                      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 text-xs">
                        {deleteAllModal.preview.protectedChecklists.map((chk) => (
                          <div key={chk.id} className="p-2.5 space-y-1 hover:bg-gray-50">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-bold text-navy font-mono">{chk.checklist_number}</span>
                                <span className="text-gray-600 ml-2">{chk.client_name}</span>
                              </div>
                              <span className="text-[10px] bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold border border-emerald-200">
                                {chk.installation_status}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500">
                              Reasons: {chk.reasons.join('; ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Confirmation Checkbox */}
                    <label className="flex items-start gap-2.5 p-3 bg-rose-50/50 border border-rose-200 rounded-xl cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteAllModal.confirmedChecked}
                        onChange={(e) => setDeleteAllModal((prev) => ({ ...prev, confirmedChecked: e.target.checked }))}
                        className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs text-rose-900 leading-snug">
                        I confirm that I want to delete all <strong>{deleteAllModal.preview.eligibleCount}</strong> eligible draft checklist(s). I understand this operation is permanent and cannot be undone.
                      </span>
                    </label>
                  </>
                )}

                {deleteAllModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                    {deleteAllModal.error}
                  </div>
                )}

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                  <button
                    disabled={deleteAllModal.submitting}
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  {deleteAllModal.preview.eligibleCount > 0 && (
                    <button
                      disabled={!deleteAllModal.confirmedChecked || deleteAllModal.submitting}
                      onClick={handleConfirmDeleteAll}
                      className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {deleteAllModal.submitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Deleting Eligible Checklists...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={14} />
                          <span>Delete {deleteAllModal.preview.eligibleCount} Eligible Checklists</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
