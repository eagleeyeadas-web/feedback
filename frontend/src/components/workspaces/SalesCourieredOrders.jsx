import { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Truck,
  CheckCircle2,
  Search,
  RefreshCw,
  ExternalLink,
  Phone,
  MapPin,
  Calendar,
  User,
  Check,
  X,
  Wrench,
  ShieldCheck,
  Info,
} from 'lucide-react';
import {
  fetchCourieredChecklists,
  confirmCourierCustomerInstalledApi,
  scheduleCourierTechnicianApi,
  fetchEngineersAvailabilityApi,
} from '../../lib/api';

const SERVICE_ENGINEER_OPTIONS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function SalesCourieredOrders({ token, onSelectChecklist }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Outcome A: Independent Customer Installation Modal
  const [customerInstalledModal, setCustomerInstalledModal] = useState({
    open: false,
    order: null,
    notes: '',
    confirmedDelivered: false,
    confirmedInstalled: false,
    confirmedNoTech: false,
    confirmedNoWorkRemaining: false,
    submitting: false,
    error: '',
  });

  // Outcome B: Technician Scheduling Modal
  const [scheduleModal, setScheduleModal] = useState({
    open: false,
    order: null,
    service_engineer: '',
    expected_arrival_date: '',
    expected_arrival_time: '10:00 AM',
    installation_duration: '1 Day',
    remarks: '',
    engineersAvailability: [],
    checkingAvailability: false,
    submitting: false,
    error: '',
  });

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4500);
  };

  const getTodayDate = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  };

  const getTomorrowDate = () => {
    const todayStr = getTodayDate();
    const [y, m, d] = todayStr.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
    return tomorrow.toISOString().split('T')[0];
  };

  const loadOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCourieredChecklists(token, {
        search,
        limit: 100,
      });
      setOrders(data?.checklists || []);
    } catch (err) {
      console.error('Failed to load couriered orders:', err);
      setError(err.message || 'Failed to load couriered orders');
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Check engineer availability when scheduling modal dates/duration change
  const checkAvailability = async (startDate, duration) => {
    if (!startDate || !token) return;
    setScheduleModal((prev) => ({ ...prev, checkingAvailability: true }));
    try {
      const avail = await fetchEngineersAvailabilityApi(token, {
        startDate,
        duration: duration || '1 Day',
      });
      setScheduleModal((prev) => ({
        ...prev,
        engineersAvailability: avail || [],
        checkingAvailability: false,
      }));
    } catch (e) {
      setScheduleModal((prev) => ({ ...prev, checkingAvailability: false }));
    }
  };

  // Outcome A Handlers
  const handleOpenCustomerInstalledModal = (order) => {
    setCustomerInstalledModal({
      open: true,
      order,
      notes: '',
      confirmedDelivered: true,
      confirmedInstalled: true,
      confirmedNoTech: true,
      confirmedNoWorkRemaining: true,
      submitting: false,
      error: '',
    });
  };

  const handleConfirmCustomerInstalled = async (e) => {
    e.preventDefault();
    const { order, notes, confirmedDelivered, confirmedInstalled, confirmedNoTech, confirmedNoWorkRemaining } = customerInstalledModal;
    if (!order) return;

    if (!confirmedDelivered || !confirmedInstalled || !confirmedNoTech || !confirmedNoWorkRemaining) {
      setCustomerInstalledModal((p) => ({
        ...p,
        error: 'Please confirm all verification requirements before completing the order.',
      }));
      return;
    }

    setCustomerInstalledModal((p) => ({ ...p, submitting: true, error: '' }));
    try {
      await confirmCourierCustomerInstalledApi(token, order.id, { notes });
      showToast('Order completed — Customer installed independently.');
      setCustomerInstalledModal({
        open: false,
        order: null,
        notes: '',
        confirmedDelivered: false,
        confirmedInstalled: false,
        confirmedNoTech: false,
        confirmedNoWorkRemaining: false,
        submitting: false,
        error: '',
      });
      loadOrders();
    } catch (err) {
      setCustomerInstalledModal((p) => ({
        ...p,
        submitting: false,
        error: err.message || 'Failed to complete order',
      }));
    }
  };

  // Outcome B Handlers
  const handleOpenScheduleModal = (order) => {
    const tomorrow = getTomorrowDate();
    setScheduleModal({
      open: true,
      order,
      service_engineer: order.service_engineer || '',
      expected_arrival_date: order.expected_arrival_date || tomorrow,
      expected_arrival_time: order.expected_arrival_time || '10:00 AM',
      installation_duration: order.installation_duration || '1 Day',
      remarks: '',
      engineersAvailability: [],
      checkingAvailability: false,
      submitting: false,
      error: '',
    });
    checkAvailability(order.expected_arrival_date || tomorrow, order.installation_duration || '1 Day');
  };

  const handleConfirmScheduleTechnician = async (e) => {
    e.preventDefault();
    const { order, service_engineer, expected_arrival_date, expected_arrival_time, installation_duration, remarks, engineersAvailability } = scheduleModal;
    if (!order) return;

    if (!service_engineer) {
      setScheduleModal((p) => ({ ...p, error: 'Please choose an authorized Service Engineer.' }));
      return;
    }
    if (!expected_arrival_date) {
      setScheduleModal((p) => ({ ...p, error: 'Expected Arrival Date is required.' }));
      return;
    }

    // Availability conflict check
    const eng = engineersAvailability.find((e) => e.name.toLowerCase() === service_engineer.toLowerCase());
    if (eng && !eng.available) {
      setScheduleModal((p) => ({
        ...p,
        error: `Booking Conflict: ${service_engineer} is already booked until ${eng?.conflict?.booking_end_date || 'busy'}. Please choose an available engineer.`,
      }));
      return;
    }

    setScheduleModal((p) => ({ ...p, submitting: true, error: '' }));
    try {
      await scheduleCourierTechnicianApi(token, order.id, {
        service_engineer,
        expected_arrival_date,
        expected_arrival_time,
        installation_duration,
        remarks,
      });
      showToast('Technician assigned and scheduled successfully.');
      setScheduleModal({
        open: false,
        order: null,
        service_engineer: '',
        expected_arrival_date: '',
        expected_arrival_time: '10:00 AM',
        installation_duration: '1 Day',
        remarks: '',
        engineersAvailability: [],
        checkingAvailability: false,
        submitting: false,
        error: '',
      });
      loadOrders();
    } catch (err) {
      setScheduleModal((p) => ({
        ...p,
        submitting: false,
        error: err.message || 'Failed to schedule technician',
      }));
    }
  };

  // Simple search filter
  const filteredOrders = orders.filter((item) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      (item.checklist_number || '').toLowerCase().includes(s) ||
      (item.client_name || '').toLowerCase().includes(s) ||
      (item.client_mobile || '').toLowerCase().includes(s) ||
      (item.client_location || '').toLowerCase().includes(s) ||
      (item.device_type || '').toLowerCase().includes(s) ||
      (item.service_engineer || '').toLowerCase().includes(s) ||
      (item.dispatch?.tracking_number || '').toLowerCase().includes(s) ||
      (item.dispatch?.courier_company || '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-indigo-900 text-white px-5 py-3.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce border border-indigo-400">
          <CheckCircle2 className="w-5 h-5 text-indigo-300" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2.5">
            <Package className="w-6 h-6 text-indigo-600" />
            <span>Couriered Orders &amp; Customer Tracking</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
            Follow up on orders dispatched via courier. Assign a technician if the customer requests technical assistance, or mark the order completed once customer self-installation is confirmed.
          </p>
        </div>

        <button
          type="button"
          onClick={loadOrders}
          disabled={loading}
          className="self-start sm:self-auto flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold px-4 py-2.5 rounded-xl border border-gray-200 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Simple Search Box */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by checklist #, client name, mobile, location, tracking number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <span className="text-xs text-gray-500 font-medium">
          {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
        </span>
      </div>

      {/* Couriered Orders Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200 font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Checklist Number</th>
                <th className="py-3.5 px-4">Customer Name and Contact</th>
                <th className="py-3.5 px-4">Product / Device Requested</th>
                <th className="py-3.5 px-4">Courier Tracking Number and Delivery Status</th>
                <th className="py-3.5 px-4">Technician Assignment</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                      <span>Loading couriered orders...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    <p className="font-semibold text-gray-600 text-sm">No couriered orders found.</p>
                    <p className="text-[11px] text-gray-400 mt-1">Checklists created with "Product Couriered" will appear here.</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((item) => {
                  const courierStatus = item.courier_dispatch_status || item.dispatch?.delivery_status || 'Not Dispatched';
                  const isCompleted = (item.installation_status || '').toLowerCase() === 'completed';
                  const isCustomerInstalled = item.completion_type === 'CUSTOMER_INSTALLED';
                  const isTechnicianInstalled = item.completion_type === 'TECHNICIAN_INSTALLED' || item.has_completion_report;
                  const hasTechnician = Boolean(item.service_engineer && item.service_engineer.trim());

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                      {/* 1. Checklist Number */}
                      <td className="py-3.5 px-4 font-mono font-bold text-indigo-700">
                        <button
                          type="button"
                          onClick={() => onSelectChecklist && onSelectChecklist(item.id)}
                          className="hover:underline flex items-center gap-1 cursor-pointer"
                          title="View Checklist Details"
                        >
                          <span>{item.checklist_number}</span>
                          <ExternalLink className="w-3 h-3 text-gray-400" />
                        </button>
                      </td>

                      {/* 2. Customer Name and Contact */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-gray-900">{item.client_name}</div>
                        <div className="text-[11px] text-gray-500 font-mono flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                          <span>{item.client_mobile || '—'}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                          <span className="truncate max-w-[200px]">{item.client_location || '—'}</span>
                        </div>
                      </td>

                      {/* 3. Product / Device Requested */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-gray-900">{item.device_type}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {item.number_of_devices} Nos. • {item.installation_or_service || 'Installation'}
                        </div>
                      </td>

                      {/* 4. Courier Tracking Number and Delivery Status */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              courierStatus === 'Delivered'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : courierStatus === 'In Transit' || courierStatus === 'Dispatched'
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : courierStatus === 'Delivery Exception'
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : 'bg-gray-100 text-gray-700 border border-gray-200'
                            }`}
                          >
                            <Truck className="w-3 h-3" />
                            <span>{courierStatus}</span>
                          </span>

                          <div className="text-[11px] font-mono text-gray-700">
                            {item.dispatch?.tracking_number ? (
                              <span>
                                <span className="font-semibold">{item.dispatch.tracking_number}</span>
                                {item.dispatch.courier_company && (
                                  <span className="text-gray-500 font-sans ml-1">({item.dispatch.courier_company})</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-gray-400 italic font-sans">Not Dispatched</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 5. Technician Assignment */}
                      <td className="py-3.5 px-4">
                        {hasTechnician ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                              <User className="w-3 h-3 text-blue-600" />
                              <span>{item.service_engineer}</span>
                            </span>
                            <div className="text-[10px] text-gray-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-gray-400" />
                              <span>
                                {item.expected_arrival_date || 'Date Pending'}
                                {item.installation_duration ? ` (${item.installation_duration})` : ''}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-[11px] italic">
                            None (Customer Self-Installation)
                          </span>
                        )}
                      </td>

                      {/* 6. Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>
                                {isCustomerInstalled
                                  ? 'Completed (Customer Installed)'
                                  : isTechnicianInstalled
                                  ? 'Completed (Tech Installed)'
                                  : 'Completed'}
                              </span>
                            </span>
                          ) : (
                            <>
                              {/* Action 1: Assign Technician (hidden if customer already has a technician) */}
                              {!hasTechnician && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenScheduleModal(item)}
                                  className="px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                                  title="Assign an eligible technician if the customer requests technical assistance"
                                >
                                  <Wrench className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>Assign Technician</span>
                                </button>
                              )}

                              {/* Action 2: Mark Completed (valid for customer self-installation) */}
                              {!hasTechnician && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenCustomerInstalledModal(item)}
                                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                                  title="Customer confirmed independent installation completed without a technician"
                                >
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Mark Completed</span>
                                </button>
                              )}

                              {/* If technician is assigned, completion is controlled via Post-Installation Form */}
                              {hasTechnician && (
                                <span className="text-[10px] text-gray-500 italic bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-md">
                                  Completes via Post-Installation Form
                                </span>
                              )}
                            </>
                          )}
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

      {/* ============================================================
          OUTCOME A: CUSTOMER INSTALLED CONFIRMATION MODAL
          ============================================================ */}
      {customerInstalledModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Confirm Independent Customer Installation</h3>
                  <p className="text-[11px] text-gray-500">Order will be marked completed without technician involvement</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomerInstalledModal((p) => ({ ...p, open: false }))}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {customerInstalledModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold">
                {customerInstalledModal.error}
              </div>
            )}

            <div className="bg-gray-50 p-3.5 rounded-xl text-xs space-y-1.5 border border-gray-100">
              <div className="flex justify-between">
                <span className="text-gray-500">Checklist ID:</span>
                <span className="font-mono font-bold text-gray-900">{customerInstalledModal.order?.checklist_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Customer Name:</span>
                <span className="font-bold text-gray-900">{customerInstalledModal.order?.client_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Delivery Status:</span>
                <span className="font-bold text-emerald-700">Delivered</span>
              </div>
            </div>

            <form onSubmit={handleConfirmCustomerInstalled} className="space-y-4 text-xs">
              <div className="space-y-2 p-3 bg-emerald-50/50 border border-emerald-200/60 rounded-xl">
                <label className="flex items-start gap-2.5 font-semibold text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customerInstalledModal.confirmedDelivered}
                    onChange={(e) => setCustomerInstalledModal((p) => ({ ...p, confirmedDelivered: e.target.checked }))}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Product parcel was delivered successfully to customer address</span>
                </label>

                <label className="flex items-start gap-2.5 font-semibold text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customerInstalledModal.confirmedInstalled}
                    onChange={(e) => setCustomerInstalledModal((p) => ({ ...p, confirmedInstalled: e.target.checked }))}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Customer confirmed they have completed installation independently</span>
                </label>

                <label className="flex items-start gap-2.5 font-semibold text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customerInstalledModal.confirmedNoTech}
                    onChange={(e) => setCustomerInstalledModal((p) => ({ ...p, confirmedNoTech: e.target.checked }))}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>No technician visit or technical support is required</span>
                </label>

                <label className="flex items-start gap-2.5 font-semibold text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customerInstalledModal.confirmedNoWorkRemaining}
                    onChange={(e) => setCustomerInstalledModal((p) => ({ ...p, confirmedNoWorkRemaining: e.target.checked }))}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>No further company work remains for this order</span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Confirmation Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={customerInstalledModal.notes}
                  onChange={(e) => setCustomerInstalledModal((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g. Customer confirmed self-installation completed on site. Everything functioning properly."
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCustomerInstalledModal((p) => ({ ...p, open: false }))}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={customerInstalledModal.submitting}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {customerInstalledModal.submitting ? 'Completing Order...' : 'Customer Installed — Complete Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          OUTCOME B: TECHNICIAN SCHEDULING MODAL
          ============================================================ */}
      {scheduleModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-gray-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <Wrench size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Assign Technician &amp; Schedule Installation</h3>
                  <p className="text-[11px] text-gray-500">Same order #{scheduleModal.order?.checklist_number} — Stock already issued via courier</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModal((p) => ({ ...p, open: false }))}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {scheduleModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold">
                {scheduleModal.error}
              </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Products were already dispatched via courier to <strong>{scheduleModal.order?.client_name}</strong>. Assigning a technician will make this job active for the technical team without deducting stock a second time.
              </span>
            </div>

            <form onSubmit={handleConfirmScheduleTechnician} className="space-y-4 text-xs">
              {/* Authorized Service Engineer Dropdown */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Service Engineer <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={scheduleModal.service_engineer}
                  onChange={(e) => setScheduleModal((p) => ({ ...p, service_engineer: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold bg-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Select Authorized Service Engineer --</option>
                  {(scheduleModal.engineersAvailability?.length ? scheduleModal.engineersAvailability.map((e) => e.name) : SERVICE_ENGINEER_OPTIONS).map((name) => {
                    const eng = scheduleModal.engineersAvailability.find((e) => e.name.toLowerCase() === name.toLowerCase());
                    const isAvail = eng ? eng.available : true;
                    return (
                      <option
                        key={name}
                        value={name}
                        disabled={!isAvail}
                        className={!isAvail ? 'text-gray-400 bg-gray-50' : 'text-gray-900'}
                      >
                        {name} {isAvail ? '(Available)' : `(Booked until ${eng?.conflict?.booking_end_date || 'busy'})`}
                      </option>
                    );
                  })}
                </select>

                {/* Quick Selection Buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {(scheduleModal.engineersAvailability?.length ? scheduleModal.engineersAvailability.map((e) => e.name) : SERVICE_ENGINEER_OPTIONS).map((name) => {
                    const eng = scheduleModal.engineersAvailability.find((e) => e.name.toLowerCase() === name.toLowerCase());
                    const isAvail = eng ? eng.available : true;
                    const isSelected = scheduleModal.service_engineer === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={!isAvail}
                        onClick={() => {
                          if (isAvail) setScheduleModal((p) => ({ ...p, service_engineer: name }));
                        }}
                        className={`text-[11px] px-3 py-1.5 rounded-lg font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
                          !isAvail
                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed line-through'
                            : isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-400'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${isAvail ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span>{name}</span>
                        <span className="text-[9px] font-normal">{isAvail ? 'Free' : 'Booked'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Start Date & Arrival Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Expected Arrival Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={getTodayDate()}
                    value={scheduleModal.expected_arrival_date}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScheduleModal((p) => ({ ...p, expected_arrival_date: val }));
                      checkAvailability(val, scheduleModal.installation_duration);
                    }}
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block">Today or later (same-day urgent fixes permitted)</span>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Expected Arrival Time <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={scheduleModal.expected_arrival_time}
                    onChange={(e) => setScheduleModal((p) => ({ ...p, expected_arrival_time: e.target.value }))}
                    placeholder="e.g. 10:00 AM"
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Installation Duration <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={scheduleModal.installation_duration}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScheduleModal((p) => ({ ...p, installation_duration: val }));
                      checkAvailability(scheduleModal.expected_arrival_date, val);
                    }}
                    placeholder="e.g. 1 Day"
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {['1 Day', '2 Days', '3 Days', '4 Days', '5 Days'].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setScheduleModal((p) => ({ ...p, installation_duration: d }));
                        checkAvailability(scheduleModal.expected_arrival_date, d);
                      }}
                      className={`text-[10px] px-2.5 py-1 rounded-md font-semibold border transition cursor-pointer ${
                        scheduleModal.installation_duration === d
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">Scheduling Instructions (Optional)</label>
                <input
                  type="text"
                  value={scheduleModal.remarks}
                  onChange={(e) => setScheduleModal((p) => ({ ...p, remarks: e.target.value }))}
                  placeholder="e.g. Client confirmed site gate access will be ready at 10 AM"
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScheduleModal((p) => ({ ...p, open: false }))}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={scheduleModal.submitting}
                  className="px-5 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {scheduleModal.submitting ? 'Saving Schedule...' : 'Save Schedule & Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
