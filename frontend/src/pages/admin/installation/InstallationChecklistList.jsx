import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { fetchInstallationChecklists, deleteInstallationChecklist } from '../../../lib/api';
import { downloadInstallationExcel, downloadAllInstallationsExcel } from '../../../lib/excelHelper';
import {
  Search,
  Plus,
  Filter,
  Eye,
  Edit,
  Trash2,
  FileSpreadsheet,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  MapPin,
  ExternalLink,
  Share2,
  CheckCircle2,
  Wrench,
} from 'lucide-react';

export default function InstallationChecklistList({ onSelectChecklist, onCreateNew }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();

  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
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

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
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

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !token) return;
    setDeleting(true);
    try {
      await deleteInstallationChecklist(token, deleteTarget.id);
      showToast(`Checklist ${deleteTarget.checklist_number} deleted successfully.`);
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      console.error('Failed to delete checklist:', err);
      alert(err.message || 'Failed to delete installation checklist');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Assigned':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Cancelled':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-amber-100 text-amber-800 border-amber-300';
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
                <option value="Pending">Pending</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
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
            <p className="text-xs text-gray-500">Loading installation checklists...</p>
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
                  <th className="py-3.5 px-4">Type of Device</th>
                  <th className="py-3.5 px-4 text-center">Devices</th>
                  <th className="py-3.5 px-4 text-center">Vehicles</th>
                  <th className="py-3.5 px-4">Vehicle Type</th>
                  <th className="py-3.5 px-4">Installation or Service</th>
                  <th className="py-3.5 px-4">Expected Arrival</th>
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
                      <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-medium text-[11px]">
                        {item.device_type}
                      </span>
                      {item.extra_devices && (
                        <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          +{item.extra_device_count} extra
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold">{item.number_of_devices}</td>
                    <td className="py-3.5 px-4 text-center font-bold">{item.number_of_vehicles}</td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-600">
                      {item.vehicle_type || '—'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.installation_or_service === 'Service'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {item.installation_or_service}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-600">
                      {item.expected_arrival_date ? new Date(item.expected_arrival_date).toLocaleDateString('en-IN') : '—'}
                      {item.expected_arrival_time && (
                        <span className="text-[10px] text-gray-400 block font-mono">
                          {item.expected_arrival_time}
                        </span>
                      )}
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

                        {/* Download Image Action */}
                        <button
                          onClick={() => {
                            if (onSelectChecklist) onSelectChecklist(item.id, 'download');
                            else navigate(`/admin/installation-checklists/${item.id}?action=download`);
                          }}
                          title="Download Image"
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <ImageIcon size={16} />
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
                        <button
                          onClick={() => setDeleteTarget(item)}
                          title="Delete Checklist"
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 size={16} />
                        </button>
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

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-50 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-navy">Confirm Deletion</h3>
                <p className="text-xs text-gray-500">Checklist: {deleteTarget.checklist_number}</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed mb-6">
              Are you sure you want to delete this installation checklist for client{' '}
              <strong className="text-gray-900">{deleteTarget.client_name}</strong>? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting ? 'Deleting...' : 'Yes, Delete Checklist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
