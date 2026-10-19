import { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
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
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  fetchCourieredChecklists,
  confirmCourierCustomerInstalledApi,
  requestCourierTechnicianApi,
  scheduleCourierTechnicianApi,
  fetchEngineersAvailabilityApi,
} from '../../lib/api';

const SERVICE_ENGINEER_OPTIONS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function SalesCourieredOrders({ token, onSelectChecklist }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
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

  const getTomorrowDate = () => {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    return today.toISOString().split('T')[0];
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
      showToast('Technician installation requested. Complete the scheduling details to assign an engineer.');
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

  // Status Classifier for Filters
  const getOrderFilterCategory = (item) => {
    const isCompleted = (item.installation_status || '').toLowerCase() === 'completed';
    if (isCompleted) return 'COMPLETED';

    const courierStatus = item.courier_dispatch_status || (item.dispatch ? item.dispatch.delivery_status : 'Pending Dispatch');
    const instStatus = (item.installation_status || '').trim();

    if (instStatus === 'Installation Required') return 'INSTALLATION_REQUIRED';
    if (instStatus === 'Assigned' && item.service_engineer) return 'SCHEDULED';

    if (courierStatus === 'Delivered') return 'DELIVERED_AWAITING_CONFIRMATION';
    if (courierStatus === 'In Transit') return 'IN_TRANSIT';
    if (courierStatus === 'Dispatched') return 'DISPATCHED';

    return 'AWAITING_DISPATCH';
  };

  // Filtered orders list
  const filteredOrders = orders.filter((item) => {
    if (statusFilter === 'ALL') return true;
    const cat = getOrderFilterCategory(item);
    if (statusFilter === 'AWAITING_DISPATCH') return cat === 'AWAITING_DISPATCH';
    if (statusFilter === 'IN_TRANSIT') return cat === 'IN_TRANSIT' || cat === 'DISPATCHED';
    if (statusFilter === 'DELIVERED') return cat === 'DELIVERED_AWAITING_CONFIRMATION';
    if (statusFilter === 'INSTALLATION_REQUIRED') return cat === 'INSTALLATION_REQUIRED';
    if (statusFilter === 'SCHEDULED') return cat === 'SCHEDULED';
    if (statusFilter === 'COMPLETED') return cat === 'COMPLETED';
    return true;
  });

  // KPI Counts
  const counts = {
    total: orders.length,
    awaitingDispatch: orders.filter((o) => getOrderFilterCategory(o) === 'AWAITING_DISPATCH').length,
    inTransit: orders.filter((o) => getOrderFilterCategory(o) === 'IN_TRANSIT' || getOrderFilterCategory(o) === 'DISPATCHED').length,
    delivered: orders.filter((o) => getOrderFilterCategory(o) === 'DELIVERED_AWAITING_CONFIRMATION').length,
    installationRequired: orders.filter((o) => getOrderFilterCategory(o) === 'INSTALLATION_REQUIRED').length,
    scheduled: orders.filter((o) => getOrderFilterCategory(o) === 'SCHEDULED').length,
    completed: orders.filter((o) => getOrderFilterCategory(o) === 'COMPLETED').length,
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-indigo-900 text-white px-5 py-3.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce border border-indigo-400">
          <CheckCircle2 className="w-5 h-5 text-indigo-300" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-blue-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-indigo-500/30 text-indigo-200 rounded-md border border-indigo-400/30 uppercase tracking-wider">
            Sales Post-Delivery Lifecycle
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="w-7 h-7 text-indigo-300" /> Couriered Orders Follow-up
          </h1>
          <p className="text-xs text-white/80 mt-1 max-w-2xl leading-relaxed">
            Follow up on customer orders dispatched directly via courier. Once delivered, confirm whether the customer installed independently or requires a technician assigned on the same order.
          </p>
        </div>

        <button
          onClick={loadOrders}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Orders</span>
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'ALL' ? 'bg-indigo-50/70 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Total Couriered</span>
          <span className="text-xl font-black text-gray-900 mt-1 block">{counts.total}</span>
        </div>

        <div
          onClick={() => setStatusFilter('AWAITING_DISPATCH')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'AWAITING_DISPATCH' ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Awaiting Dispatch</span>
          <span className="text-xl font-black text-amber-900 mt-1 block">{counts.awaitingDispatch}</span>
        </div>

        <div
          onClick={() => setStatusFilter('IN_TRANSIT')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'IN_TRANSIT' ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">In Transit</span>
          <span className="text-xl font-black text-blue-900 mt-1 block">{counts.inTransit}</span>
        </div>

        <div
          onClick={() => setStatusFilter('DELIVERED')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'DELIVERED' ? 'bg-purple-50 border-purple-500 ring-1 ring-purple-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">Awaiting Confirm</span>
          <span className="text-xl font-black text-purple-900 mt-1 block">{counts.delivered}</span>
        </div>

        <div
          onClick={() => setStatusFilter('INSTALLATION_REQUIRED')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'INSTALLATION_REQUIRED' ? 'bg-rose-50 border-rose-500 ring-1 ring-rose-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Need Technician</span>
          <span className="text-xl font-black text-rose-900 mt-1 block">{counts.installationRequired}</span>
        </div>

        <div
          onClick={() => setStatusFilter('COMPLETED')}
          className={`p-4 rounded-xl border shadow-xs cursor-pointer transition-all ${
            statusFilter === 'COMPLETED' ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Completed</span>
          <span className="text-xl font-black text-emerald-900 mt-1 block">{counts.completed}</span>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search checklist #, client name, tracking number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500"
            />
          </div>
          {search && (
            <button onClick={() => setSearch('')} className="text-xs text-gray-500 hover:text-gray-800 font-semibold cursor-pointer">
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { id: 'ALL', label: 'All Couriered' },
            { id: 'AWAITING_DISPATCH', label: 'Awaiting Dispatch' },
            { id: 'IN_TRANSIT', label: 'In Transit' },
            { id: 'DELIVERED', label: 'Delivered — Awaiting Confirmation' },
            { id: 'INSTALLATION_REQUIRED', label: 'Needs Scheduling' },
            { id: 'SCHEDULED', label: 'Scheduled' },
            { id: 'COMPLETED', label: 'Completed' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === f.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-gray-900">Couriered Orders Lifecycle</h3>
          </div>
          <span className="text-xs text-gray-500 font-medium">Showing {filteredOrders.length} orders</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-500 uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Checklist No.</th>
                <th className="py-3 px-4">Client &amp; Contact</th>
                <th className="py-3 px-4">Device Requested</th>
                <th className="py-3 px-4">Courier Status</th>
                <th className="py-3 px-4">Tracking Info</th>
                <th className="py-3 px-4">Order Status</th>
                <th className="py-3 px-4 text-right">Available Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                      <span>Loading couriered orders...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-400">
                    <p className="font-semibold text-gray-500">No couriered orders found matching the filter.</p>
                    <p className="text-[11px] text-gray-400 mt-1">Checklists created with "Product Couriered" will appear here.</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((item) => {
                  const courierStatus = item.courier_dispatch_status || item.dispatch?.delivery_status || 'Pending Dispatch';
                  const isDelivered = courierStatus === 'Delivered';
                  const isCompleted = (item.installation_status || '').toLowerCase() === 'completed';
                  const isCustomerInstalled = item.completion_type === 'CUSTOMER_INSTALLED';
                  const isTechnicianInstalled = item.completion_type === 'TECHNICIAN_INSTALLED' || item.has_completion_report;
                  const isInstallationRequired = item.installation_status === 'Installation Required';
                  const isScheduled = Boolean(item.service_engineer && item.expected_arrival_date && !isCompleted);

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-indigo-700">
                        <button
                          type="button"
                          onClick={() => onSelectChecklist && onSelectChecklist(item.id)}
                          className="hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>{item.checklist_number}</span>
                          <ExternalLink className="w-3 h-3 text-gray-400" />
                        </button>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900">{item.client_name}</div>
                        <div className="text-[11px] text-gray-500 font-mono flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-gray-400" />
                          <span>{item.client_mobile || '—'}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-gray-400" />
                          <span className="truncate max-w-[180px]">{item.client_location || '—'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-gray-900">{item.device_type}</div>
                        <div className="text-[11px] text-gray-500">
                          {item.number_of_devices} Nos. ({item.installation_or_service || 'Installation'})
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            courierStatus === 'Delivered'
                              ? 'bg-emerald-100 text-emerald-800'
                              : courierStatus === 'In Transit' || courierStatus === 'Dispatched'
                              ? 'bg-blue-100 text-blue-800'
                              : courierStatus === 'Delivery Exception'
                              ? 'bg-rose-100 text-rose-800'
                              : courierStatus === 'Cancelled'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          <Truck className="w-3 h-3" />
                          <span>{courierStatus}</span>
                        </span>
                      </td>

                      <td className="py-3 px-4 text-gray-600">
                        {item.dispatch?.tracking_number ? (
                          <div className="space-y-0.5">
                            <div className="font-bold font-mono text-gray-900">{item.dispatch.tracking_number}</div>
                            <div className="text-[10px] text-gray-500">{item.dispatch.courier_company}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-[11px]">Awaiting Dispatch</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {isCompleted ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              {isCustomerInstalled
                                ? 'Completed — Customer Installed'
                                : 'Completed — Tech Installed'}
                            </span>
                            {item.completed_at && (
                              <div className="text-[10px] text-gray-400">
                                {new Date(item.completed_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        ) : isScheduled ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                              <Calendar className="w-3 h-3 text-blue-600" />
                              <span>Scheduled: {item.service_engineer}</span>
                            </span>
                            <div className="text-[10px] text-gray-500">
                              Start: {item.expected_arrival_date} ({item.installation_duration || '1 Day'})
                            </div>
                          </div>
                        ) : isInstallationRequired ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            <span>Installation Required</span>
                          </span>
                        ) : isDelivered ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                            <Clock className="w-3 h-3 text-purple-600" />
                            <span>Awaiting Customer Decision</span>
                          </span>
                        ) : (
                          <span className="text-gray-500 text-[11px]">Courier In Progress</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* If Delivered and awaiting customer confirmation: provide Outcome A and Outcome B */}
                          {isDelivered && !isCompleted && !isScheduled && !isInstallationRequired && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenCustomerInstalledModal(item)}
                                className="px-2.5 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                title="Customer has confirmed they installed independently"
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Customer Installed</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenScheduleModal(item)}
                                className="px-2.5 py-1.5 text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 rounded-lg flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                title="Customer requires our technical team to install"
                              >
                                <Wrench className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Assign Technician</span>
                              </button>
                            </>
                          )}

                          {/* If Installation Required: provide Assign & Schedule button */}
                          {isInstallationRequired && !isCompleted && !isScheduled && (
                            <button
                              type="button"
                              onClick={() => handleOpenScheduleModal(item)}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              <span>Schedule Engineer</span>
                            </button>
                          )}

                          {/* View details */}
                          <button
                            type="button"
                            onClick={() => onSelectChecklist && onSelectChecklist(item.id)}
                            className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg cursor-pointer"
                            title="View Checklist Details"
                          >
                            <ChevronRight className="w-4 h-4" />
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
                  <option value="">-- Select One of 4 Authorized Service Engineers --</option>
                  {SERVICE_ENGINEER_OPTIONS.map((name) => {
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
                  {SERVICE_ENGINEER_OPTIONS.map((name) => {
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
                    min={getTomorrowDate()}
                    value={scheduleModal.expected_arrival_date}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScheduleModal((p) => ({ ...p, expected_arrival_date: val }));
                      checkAvailability(val, scheduleModal.installation_duration);
                    }}
                    className="w-full p-2.5 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block">Tomorrow or later</span>
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
