import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Users,
  Search,
  Plus,
  Phone,
  MapPin,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  X,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchCustomers,
  createCustomer,
  fetchCustomerDeletionPreview,
  deleteCustomerApi,
  deleteAllCustomersApi,
} from '../../lib/api';

export default function CustomerManagement() {
  const { token, user } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    client_name: '',
    client_mobile: '',
    client_location: '',
    google_maps_location: '',
    company_name: '',
    email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Single Customer Delete Modal State
  const [deleteSingleModal, setDeleteSingleModal] = useState({
    open: false,
    customer: null,
    submitting: false,
    error: '',
    reasons: [],
  });

  // Bulk / Delete All Customers Modal State
  const [deleteAllModal, setDeleteAllModal] = useState({
    open: false,
    loading: false,
    submitting: false,
    scope: 'TEST', // 'TEST' | 'ALL'
    preview: null,
    confirmedCountInput: '',
    error: '',
    result: null,
  });

  const isAuthorized = Boolean(
    user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SALES')
  );

  // 300ms search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadCustomers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchCustomers(token, { search: debouncedSearch, limit: 100 });
      setCustomers(data?.customers || []);
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoading(false);
    }
  }, [token, debouncedSearch]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!formData.client_name || !formData.client_mobile) {
      setErrorMsg('Client name and mobile number are required.');
      return;
    }

    setSubmitting(true);
    try {
      await createCustomer(token, formData);
      setShowModal(false);
      setFormData({
        client_name: '',
        client_mobile: '',
        client_location: '',
        google_maps_location: '',
        company_name: '',
        email: '',
      });
      loadCustomers();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Single Customer Delete
  const handleConfirmDeleteSingle = async () => {
    if (!deleteSingleModal.customer) return;
    setDeleteSingleModal((prev) => ({ ...prev, submitting: true, error: '', reasons: [] }));
    try {
      await deleteCustomerApi(token, deleteSingleModal.customer.id);
      setDeleteSingleModal({ open: false, customer: null, submitting: false, error: '', reasons: [] });
      loadCustomers();
    } catch (err) {
      setDeleteSingleModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete customer',
        reasons: err.reasons || [],
      }));
    }
  };

  // Open Bulk Delete Modal & fetch preview
  const openDeleteAllModal = async (initialScope = 'TEST') => {
    setDeleteAllModal({
      open: true,
      loading: true,
      submitting: false,
      scope: initialScope,
      preview: null,
      confirmedCountInput: '',
      error: '',
      result: null,
    });

    try {
      const preview = await fetchCustomerDeletionPreview(token, {
        scope: initialScope,
        search: debouncedSearch,
      });
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        preview,
      }));
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to evaluate customer deletion preview',
      }));
    }
  };

  // Change Scope in Bulk Delete Modal
  const handleChangeDeleteScope = async (newScope) => {
    setDeleteAllModal((prev) => ({
      ...prev,
      scope: newScope,
      loading: true,
      error: '',
      confirmedCountInput: '',
    }));
    try {
      const preview = await fetchCustomerDeletionPreview(token, {
        scope: newScope,
        search: debouncedSearch,
      });
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        preview,
      }));
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to refresh preview for selected scope',
      }));
    }
  };

  // Confirm Bulk Customer Deletion
  const handleConfirmDeleteAllCustomers = async () => {
    const eligibleCount = deleteAllModal.preview?.eligibleCount || 0;
    if (String(deleteAllModal.confirmedCountInput).trim() !== String(eligibleCount)) {
      setDeleteAllModal((prev) => ({
        ...prev,
        error: `Please type exactly "${eligibleCount}" to confirm deletion.`,
      }));
      return;
    }

    setDeleteAllModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const res = await deleteAllCustomersApi(token, {
        scope: deleteAllModal.scope,
        confirmedCount: eligibleCount,
        search: debouncedSearch,
      });
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        result: res,
      }));
      loadCustomers();
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete customers',
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <Users className="w-7 h-7 text-blue-600" /> Customer Records &amp; Directory
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Internal customer registry managed by Sales &amp; Admin teams. Clean test records directly with full history protection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isAuthorized && (
            <button
              type="button"
              id="btn-delete-all-customers"
              onClick={() => openDeleteAllModal('TEST')}
              disabled={loading || customers.length === 0}
              className="px-3.5 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-xl transition flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clean test customer records safely"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Clean / Delete All</span>
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add New Customer
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name, mobile number, or location..."
          className="w-full text-sm bg-transparent border-none outline-none text-gray-800 placeholder-gray-400"
        />
        {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Client Name</th>
                <th className="py-3.5 px-4">Mobile Number</th>
                <th className="py-3.5 px-4">Location</th>
                <th className="py-3.5 px-4">Company / Email</th>
                <th className="py-3.5 px-4">Maps Link</th>
                {isAuthorized && <th className="py-3.5 px-4 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={isAuthorized ? 6 : 5} className="py-8 text-center text-gray-400">
                    No customer records found. Click &quot;Add New Customer&quot; to record a client.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">{c.client_name}</td>
                    <td className="py-3.5 px-4 text-gray-700">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <Phone className="w-3.5 h-3.5 text-gray-400" /> {c.client_mobile}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" /> {c.client_location || 'N/A'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-500">
                      <div>{c.company_name || '-'}</div>
                      <div className="text-gray-400">{c.email || '-'}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      {c.google_maps_location ? (
                        <a
                          href={c.google_maps_location}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          Open Maps <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    {isAuthorized && (
                      <td className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          id={`btn-delete-customer-${c.id}`}
                          onClick={() =>
                            setDeleteSingleModal({
                              open: true,
                              customer: c,
                              submitting: false,
                              error: '',
                              reasons: [],
                            })
                          }
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="Delete customer record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" /> Create Customer Record
            </h3>

            {errorMsg && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Client Name *</label>
                  <input
                    type="text"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Ramesh Kumar"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Mobile Number *</label>
                  <input
                    type="tel"
                    value={formData.client_mobile}
                    onChange={(e) => setFormData({ ...formData, client_mobile: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. 9876543210"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Client Location *</label>
                <input
                  type="text"
                  value={formData.client_location}
                  onChange={(e) => setFormData({ ...formData, client_location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. Whitefield, Bengaluru"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Google Maps URL</label>
                <input
                  type="url"
                  value={formData.google_maps_location}
                  onChange={(e) => setFormData({ ...formData, google_maps_location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="https://maps.google.com/?q=..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Company / Fleet Name</label>
                  <input
                    type="text"
                    value={formData.company_name}
                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Express Logistics"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="client@example.com"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {submitting ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Single Customer Delete Confirmation Modal */}
      {deleteSingleModal.open && deleteSingleModal.customer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" />
                <span>Delete Customer Record</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  setDeleteSingleModal({ open: false, customer: null, submitting: false, error: '', reasons: [] })
                }
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-600">
              Are you sure you want to delete customer{' '}
              <strong className="text-gray-900">{deleteSingleModal.customer.client_name}</strong> (
              <span className="font-mono text-gray-700">{deleteSingleModal.customer.client_mobile}</span>)?
            </p>

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
              <div>
                <span className="font-semibold text-gray-500">Location:</span>{' '}
                <span className="text-gray-800">{deleteSingleModal.customer.client_location || 'N/A'}</span>
              </div>
              {deleteSingleModal.customer.company_name && (
                <div>
                  <span className="font-semibold text-gray-500">Company:</span>{' '}
                  <span className="text-gray-800">{deleteSingleModal.customer.company_name}</span>
                </div>
              )}
            </div>

            {deleteSingleModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Cannot Delete Customer</span>
                </div>
                <p>{deleteSingleModal.error}</p>
                {deleteSingleModal.reasons && deleteSingleModal.reasons.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-700 pt-1">
                    {deleteSingleModal.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() =>
                  setDeleteSingleModal({ open: false, customer: null, submitting: false, error: '', reasons: [] })
                }
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSingle}
                disabled={deleteSingleModal.submitting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deleteSingleModal.submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete All / Clean Test Customers Modal */}
      {deleteAllModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-200">
                  Global Test Data Cleanup
                </span>
                <h3 className="text-base font-bold text-gray-900 mt-1 flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                  <span>Clean / Delete Customer Records</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {deleteAllModal.loading ? (
              <div className="py-12 text-center text-gray-500 space-y-2">
                <Loader2 className="w-7 h-7 animate-spin text-rose-600 mx-auto" />
                <p className="text-xs font-medium">Checking active checklists and quotation dependencies...</p>
              </div>
            ) : deleteAllModal.result ? (
              /* Deletion Result Card */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-1">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h4 className="font-bold text-emerald-900 text-sm">Customer Cleanup Completed</h4>
                  <p className="text-xs text-emerald-700">
                    Test and eligible customer records were safely deleted. Operational history remains intact.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                    <span className="text-[11px] text-rose-700 font-semibold uppercase block">Deleted</span>
                    <span className="text-xl font-bold text-rose-900">{deleteAllModal.result.deletedCount || 0}</span>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Preserved</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.result.skippedCount || 0}</span>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Failed</span>
                    <span className="text-xl font-bold text-gray-700">{deleteAllModal.result.failedCount || 0}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Scope selection and confirmation */
              <div className="space-y-4">
                {/* 3-card stats */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Total Records</span>
                    <span className="text-xl font-bold text-gray-900">{deleteAllModal.preview?.totalCount || 0}</span>
                  </div>
                  <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
                    <span className="text-[11px] text-rose-700 font-semibold uppercase block">Eligible to Delete</span>
                    <span className="text-xl font-bold text-rose-900">{deleteAllModal.preview?.eligibleCount || 0}</span>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Preserved</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.preview?.protectedCount || 0}</span>
                  </div>
                </div>

                {/* Scope Radio Selection */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-gray-800 block">Select Deletion Scope:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                        deleteAllModal.scope === 'TEST' ? 'border-rose-400 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="customerScope"
                        value="TEST"
                        checked={deleteAllModal.scope === 'TEST'}
                        onChange={() => handleChangeDeleteScope('TEST')}
                        className="mt-0.5 text-rose-600 focus:ring-rose-500"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block">Delete Test Records Only</span>
                        <span className="text-[11px] text-gray-500">
                          Matches test markers (test, demo, sample, dummy) without linked checklists or quotations.
                        </span>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                        deleteAllModal.scope === 'ALL' ? 'border-rose-400 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="customerScope"
                        value="ALL"
                        checked={deleteAllModal.scope === 'ALL'}
                        onChange={() => handleChangeDeleteScope('ALL')}
                        className="mt-0.5 text-rose-600 focus:ring-rose-500"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block">Delete All Unlinked</span>
                        <span className="text-[11px] text-gray-500">
                          Deletes all unlinked customers. Preserves customers with linked checklists or quotations.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Sample records to be deleted */}
                {deleteAllModal.preview?.eligibleCustomers && deleteAllModal.preview.eligibleCustomers.length > 0 && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-700 block mb-1.5">
                      Customers to be deleted ({deleteAllModal.preview.eligibleCount}):
                    </span>
                    <div className="max-h-28 overflow-y-auto p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1 font-mono text-[11px]">
                      {deleteAllModal.preview.eligibleCustomers.slice(0, 10).map((r) => (
                        <div key={r.id} className="flex justify-between text-gray-700">
                          <span>{r.client_name}</span>
                          <span className="text-gray-400">{r.client_mobile}</span>
                        </div>
                      ))}
                      {deleteAllModal.preview.eligibleCount > 10 && (
                        <div className="text-gray-400 italic">
                          ...and {deleteAllModal.preview.eligibleCount - 10} more customers
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Protected Records preview */}
                {deleteAllModal.preview?.protectedCustomers && deleteAllModal.preview.protectedCustomers.length > 0 && (
                  <div className="text-xs">
                    <span className="font-bold text-blue-900 block mb-1.5 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      <span>Preserved Customers ({deleteAllModal.preview.protectedCount}):</span>
                    </span>
                    <div className="max-h-24 overflow-y-auto p-2.5 bg-blue-50/50 rounded-xl border border-blue-200 space-y-1 text-[11px]">
                      {deleteAllModal.preview.protectedCustomers.slice(0, 5).map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-blue-950">
                          <span className="font-semibold">{r.client_name}</span>
                          <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-mono">
                            {r.reason || 'Active history'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Required confirmation input */}
                {(deleteAllModal.preview?.eligibleCount || 0) > 0 ? (
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-2">
                    <span className="font-bold text-amber-900 block">
                      Type{' '}
                      <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300">
                        {deleteAllModal.preview?.eligibleCount}
                      </span>{' '}
                      to confirm deletion:
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
                    No customer records match the selected scope for deletion.
                  </div>
                )}

                {deleteAllModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                    {deleteAllModal.error}
                  </div>
                )}

                {/* Modal Footer */}
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
                    onClick={handleConfirmDeleteAllCustomers}
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
                        <span>Delete {deleteAllModal.preview?.eligibleCount} Customers</span>
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
