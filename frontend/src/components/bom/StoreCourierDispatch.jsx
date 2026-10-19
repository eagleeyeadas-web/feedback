import { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Truck,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Phone,
  MapPin,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Layers,
  User,
  Info,
  Calendar,
  X,
  ShieldAlert,
  ArrowRight,
  FileCheck,
  RotateCcw,
} from 'lucide-react';
import {
  fetchCourieredChecklists,
  fetchCourierCompanies,
  dispatchChecklistViaCourierApi,
  updateCourierStatusApi,
  recordCourierReturnApi,
} from '../../lib/api';

export default function StoreCourierDispatch({ token, onSelectChecklist }) {
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [jobTypeFilter, setJobTypeFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [toastMessage, setToastMessage] = useState('');

  // Companies list
  const [companies, setCompanies] = useState([]);

  // Dispatch Modal State
  const [dispatchModalChecklist, setDispatchModalChecklist] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({
    courier_company: 'DTDC',
    custom_courier_company: '',
    tracking_number: '',
    dispatch_date: new Date().toISOString().split('T')[0],
    expected_delivery_date: '',
    delivery_notes: '',
  });
  const [submittingDispatch, setSubmittingDispatch] = useState(false);
  const [dispatchError, setDispatchError] = useState('');

  // Status Update Modal State
  const [statusModalDispatch, setStatusModalDispatch] = useState(null);
  const [statusForm, setStatusForm] = useState({
    delivery_status: 'In Transit',
    notes: '',
    received_by_person: '',
  });
  const [submittingStatus, setSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Return to Store Modal State
  const [returnModalDispatch, setReturnModalDispatch] = useState(null);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnError, setReturnError] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [courierData, compList] = await Promise.all([
        fetchCourieredChecklists(token, {
          search,
          status: statusFilter,
          page,
          limit: 20,
        }),
        fetchCourierCompanies(token).catch(() => ['DTDC', 'ST Courier', 'The Professional Couriers', 'Blue Dart', 'Delhivery', 'Speed Post (India Post)', 'Other']),
      ]);

      setChecklists(courierData.checklists || []);
      setTotalPages(courierData.totalPages || 1);
      setTotalCount(courierData.totalCount || 0);
      setCompanies(compList || []);
    } catch (err) {
      console.error('Failed to load couriered checklists:', err);
      setError(err.message || 'Failed to load courier dispatch records');
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = (id) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Open Dispatch Modal
  const handleOpenDispatchModal = (checklist) => {
    setDispatchModalChecklist(checklist);
    setDispatchForm({
      courier_company: 'DTDC',
      custom_courier_company: '',
      tracking_number: '',
      dispatch_date: new Date().toISOString().split('T')[0],
      expected_delivery_date: '',
      delivery_notes: '',
    });
    setDispatchError('');
  };

  // Submit Dispatch
  const handleSubmitDispatch = async (e) => {
    e.preventDefault();
    if (!dispatchModalChecklist) return;

    const company = dispatchForm.courier_company === 'Other'
      ? dispatchForm.custom_courier_company.trim()
      : dispatchForm.courier_company.trim();

    if (!company) {
      setDispatchError('Courier company name is required.');
      return;
    }
    if (!dispatchForm.tracking_number.trim()) {
      setDispatchError('Tracking / Consignment number is required.');
      return;
    }

    setSubmittingDispatch(true);
    setDispatchError('');
    try {
      await dispatchChecklistViaCourierApi(token, {
        checklist_id: dispatchModalChecklist.id,
        courier_company: company,
        tracking_number: dispatchForm.tracking_number.trim(),
        dispatch_date: dispatchForm.dispatch_date,
        expected_delivery_date: dispatchForm.expected_delivery_date || null,
        delivery_notes: dispatchForm.delivery_notes.trim(),
      });

      showToast(`Dispatched ${dispatchModalChecklist.checklist_number} via ${company}! Stock deducted atomically.`);
      setDispatchModalChecklist(null);
      await loadData();
    } catch (err) {
      console.error('Failed to dispatch via courier:', err);
      setDispatchError(err.message || 'Failed to dispatch checklist');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  // Open Status Update Modal
  const handleOpenStatusModal = (dispatch) => {
    setStatusModalDispatch(dispatch);
    setStatusForm({
      delivery_status: dispatch.delivery_status || 'In Transit',
      notes: dispatch.delivery_notes || '',
      received_by_person: '',
    });
    setStatusError('');
  };

  // Submit Status Update
  const handleSubmitStatus = async (e) => {
    e.preventDefault();
    if (!statusModalDispatch) return;

    setSubmittingStatus(true);
    setStatusError('');
    try {
      const payload = {
        delivery_status: statusForm.delivery_status,
        notes: statusForm.notes.trim(),
        delivery_confirmation: statusForm.received_by_person
          ? { received_by: statusForm.received_by_person.trim(), confirmed_at: new Date().toISOString() }
          : null,
      };

      await updateCourierStatusApi(token, statusModalDispatch.id, payload);
      showToast(`Updated courier status for ${statusModalDispatch.checklist_number} to "${statusForm.delivery_status}"`);
      setStatusModalDispatch(null);
      await loadData();
    } catch (err) {
      console.error('Failed to update courier status:', err);
      setStatusError(err.message || 'Failed to update courier status');
    } finally {
      setSubmittingStatus(false);
    }
  };

  // Open Return to Store Modal
  const handleOpenReturnModal = (dispatch) => {
    setReturnModalDispatch(dispatch);
    setReturnRemarks('');
    setReturnError('');
  };

  // Submit Return to Store
  const handleSubmitReturn = async (e) => {
    e.preventDefault();
    if (!returnModalDispatch) return;

    setSubmittingReturn(true);
    setReturnError('');
    try {
      await recordCourierReturnApi(token, returnModalDispatch.id, {
        remarks: returnRemarks.trim() || 'Returned to store',
      });
      showToast(`Processed return for ${returnModalDispatch.checklist_number}. Stock credited back to store.`);
      setReturnModalDispatch(null);
      await loadData();
    } catch (err) {
      console.error('Failed to process courier return:', err);
      setReturnError(err.message || 'Failed to process courier return');
    } finally {
      setSubmittingReturn(false);
    }
  };

  // Compute summary stats
  const pendingDispatchCount = checklists.filter((c) => !c.dispatch || c.dispatch.delivery_status === 'Not Dispatched').length;
  const inTransitCount = checklists.filter((c) => c.dispatch?.delivery_status === 'Dispatched' || c.dispatch?.delivery_status === 'In Transit').length;
  const deliveredCount = checklists.filter((c) => c.dispatch?.delivery_status === 'Delivered').length;
  const exceptionCount = checklists.filter((c) => c.dispatch?.delivery_status === 'Delivery Exception' || c.dispatch?.delivery_status === 'Cancelled').length;

  // Filter checklists by job type
  const filteredChecklists = checklists.filter((c) => {
    if (jobTypeFilter !== 'All' && c.installation_or_service !== jobTypeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-purple-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce border border-purple-400">
          <CheckCircle2 className="w-5 h-5 text-purple-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-purple-500/30 text-purple-200 rounded-md border border-purple-400/30 uppercase tracking-wider">
            Store Manager — Product Courier Workflow
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Truck className="w-7 h-7 text-purple-300" /> Courier Dispatch & Tracking
          </h1>
          <p className="text-xs text-white/80 mt-1 max-w-xl">
            Verify device and BOM material stock, record courier consignment numbers, issue dispatch stock atomically, and track deliveries for both Installation and Service jobs.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Courier List</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-purple-50 rounded-lg text-purple-600">
            <Package size={22} />
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">Total Couriered Jobs</div>
            <div className="text-xl font-bold text-gray-900">{totalCount}</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-amber-50 rounded-lg text-amber-600">
            <Clock size={22} />
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">Awaiting Dispatch</div>
            <div className="text-xl font-bold text-amber-600">{pendingDispatchCount}</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
            <Truck size={22} />
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">In Transit</div>
            <div className="text-xl font-bold text-blue-600">{inTransitCount}</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">Delivered to Site</div>
            <div className="text-xl font-bold text-emerald-600">{deliveredCount}</div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search checklist #, client name, tracking number, courier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500"
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Job Type Filter */}
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-200 text-xs">
            <span className="text-[10px] text-gray-400 uppercase font-bold px-1.5">Type:</span>
            {['All', 'Installation', 'Service'].map((t) => (
              <button
                key={t}
                onClick={() => setJobTypeFilter(t)}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  jobTypeFilter === t ? 'bg-purple-600 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg p-2 font-medium bg-white focus:outline-none focus:border-purple-500"
          >
            <option value="All">All Delivery Statuses</option>
            <option value="NOT_DISPATCHED">Awaiting Dispatch</option>
            <option value="DISPATCHED">Dispatched</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="DELIVERY_EXCEPTION">Delivery Exception</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Couriered Checklists List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 text-center text-gray-400 rounded-2xl border border-gray-200">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-600 mb-2" />
            <p className="text-xs font-semibold">Loading couriered job dispatches...</p>
          </div>
        ) : filteredChecklists.length === 0 ? (
          <div className="bg-white p-12 text-center text-gray-400 rounded-2xl border border-gray-200">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-700">No Product Couriered Checklists Found</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              Sales-created checklists marked with delivery method "Product Couriered" will appear here for stock verification, BOM allocation, and courier dispatch.
            </p>
          </div>
        ) : (
          filteredChecklists.map((item) => {
            const isExpanded = expandedCards.has(item.id);
            const dispatch = item.dispatch;
            const isDispatched = Boolean(dispatch && dispatch.delivery_status !== 'Not Dispatched');
            const isDelivered = dispatch?.delivery_status === 'Delivered';
            const isException = dispatch?.delivery_status === 'Delivery Exception';
            const isCancelled = dispatch?.delivery_status === 'Cancelled';
            const isService = item.installation_or_service === 'Service';

            const reqDevices = item.device_configurations || [];
            const bomItems = item.bom_snapshot?.items || [];

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border transition-all shadow-xs overflow-hidden ${
                  isDelivered
                    ? 'border-emerald-200 ring-1 ring-emerald-500/10'
                    : isException || isCancelled
                    ? 'border-rose-200 ring-1 ring-rose-500/10'
                    : isDispatched
                    ? 'border-blue-200 ring-1 ring-blue-500/10'
                    : item.has_shortage
                    ? 'border-amber-200 ring-1 ring-amber-500/20'
                    : 'border-gray-200'
                }`}
              >
                {/* Header Row */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50/50 border-b border-gray-100">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-sm text-purple-700">{item.checklist_number}</span>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        isService
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-blue-100 text-blue-800 border border-blue-300'
                      }`}>
                        {item.installation_or_service || 'Installation'}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                        📦 Product Couriered
                      </span>
                      {/* Courier Status Badge */}
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        isDelivered
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : isException
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : isCancelled
                          ? 'bg-gray-100 text-gray-700 border border-gray-300'
                          : isDispatched
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {dispatch?.delivery_status || 'Awaiting Dispatch'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 pt-1">
                      <div className="font-bold text-gray-900">{item.client_name}</div>
                      <div className="flex items-center gap-1 font-mono text-[11px] text-gray-500">
                        <Phone size={12} /> {item.client_mobile}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-gray-500">
                        <MapPin size={12} /> {item.client_location || 'Location Not Specified'}
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    {!isDispatched ? (
                      <button
                        type="button"
                        onClick={() => handleOpenDispatchModal(item)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Truck size={14} />
                        <span>Verify & Dispatch Courier</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenStatusModal(dispatch)}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg border border-blue-200 transition flex items-center gap-1 cursor-pointer"
                        >
                          <Clock size={12} />
                          <span>Update Status</span>
                        </button>

                        {(isException || isCancelled) && !dispatch.returned_to_store && (
                          <button
                            type="button"
                            onClick={() => handleOpenReturnModal(dispatch)}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw size={12} />
                            <span>Record Return to Store</span>
                          </button>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition cursor-pointer"
                      title={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Dispatch Tracking Banner if Dispatched */}
                {dispatch && (
                  <div className="p-4 bg-purple-50/50 border-b border-purple-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">Courier Partner</span>
                      <span className="font-bold text-purple-900">{dispatch.courier_company}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">Tracking / Consignment #</span>
                      <span className="font-mono font-bold text-gray-900">{dispatch.tracking_number}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">Dispatch Date</span>
                      <span className="font-medium text-gray-800">{dispatch.dispatch_date}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">Delivery Status</span>
                      <span className="font-bold text-emerald-700">{dispatch.delivery_status}</span>
                      {dispatch.actual_delivery_date && (
                        <span className="text-[10px] text-gray-400 block font-mono">
                          {new Date(dispatch.actual_delivery_date).toLocaleDateString('en-IN')}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Shortage Flag Alert if Not Dispatched & Shortage exists */}
                {!isDispatched && item.has_shortage && (
                  <div className="p-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs font-semibold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Stock Shortage Detected ({item.shortage_count} item(s) insufficient). Please replenish stock in the store before dispatching package.
                    </span>
                  </div>
                )}

                {/* Expanded Details: Devices & BOM Materials Breakdown */}
                {isExpanded && (
                  <div className="p-5 space-y-4 bg-white text-xs">
                    {/* Required Devices Section */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <HardDrive size={14} className="text-purple-600" />
                        1. Required Camera Devices to Courier
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                              <th className="py-2 px-3">Device Type</th>
                              <th className="py-2 px-3">Quantity Required</th>
                              <th className="py-2 px-3">Vehicles</th>
                              <th className="py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {reqDevices.map((d, i) => (
                              <tr key={i} className="hover:bg-gray-50/50">
                                <td className="py-2 px-3 font-bold text-gray-900">{d.device_type}</td>
                                <td className="py-2 px-3 font-mono font-bold text-purple-700">{d.number_of_devices || 1} Nos.</td>
                                <td className="py-2 px-3 text-gray-600">{d.number_of_vehicles || 1}</td>
                                <td className="py-2 px-3">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isDispatched ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {isDispatched ? 'Issued & Dispatched' : 'Pending Dispatch'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* BOM Materials Section (Installation only) */}
                    {!isService ? (
                      <div>
                        <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Layers size={14} className="text-indigo-600" />
                          2. BOM Installation Materials to Courier
                        </h4>
                        {bomItems.length === 0 ? (
                          <div className="p-3 bg-gray-50 text-gray-500 rounded-lg text-xs italic">
                            No installation BOM materials calculated for this device configuration.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                                  <th className="py-2 px-3">Material Name</th>
                                  <th className="py-2 px-3">Quantity Required</th>
                                  <th className="py-2 px-3">Unit</th>
                                  <th className="py-2 px-3">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-medium">
                                {bomItems.map((m, i) => (
                                  <tr key={i} className="hover:bg-gray-50/50">
                                    <td className="py-2 px-3 font-bold text-gray-900">{m.material_name}</td>
                                    <td className="py-2 px-3 font-mono font-bold text-indigo-700">
                                      {m.total_quantity !== undefined ? m.total_quantity : m.total_required_quantity}
                                    </td>
                                    <td className="py-2 px-3 text-gray-600">{m.unit || 'Nos.'}</td>
                                    <td className="py-2 px-3">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        isDispatched ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                                      }`}>
                                        {isDispatched ? 'Issued & Dispatched' : 'Pending Dispatch'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
                        Service Job: Standard Installation BOM is not generated for service jobs unless explicitly configured.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* DISPATCH COURIER MODAL */}
      {dispatchModalChecklist && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-bold text-gray-900">
                  Verify Stock & Dispatch via Courier
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDispatchModalChecklist(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-purple-50 rounded-xl border border-purple-100 text-xs text-purple-900 space-y-1">
              <div className="font-bold flex items-center justify-between">
                <span>Checklist: {dispatchModalChecklist.checklist_number}</span>
                <span className="uppercase text-[10px] bg-purple-200/80 px-2 py-0.5 rounded font-mono">
                  {dispatchModalChecklist.installation_or_service}
                </span>
              </div>
              <div>Client: <span className="font-bold">{dispatchModalChecklist.client_name}</span> ({dispatchModalChecklist.client_mobile})</div>
              <div>Location: <span className="font-medium">{dispatchModalChecklist.client_location}</span></div>
            </div>

            {dispatchError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{dispatchError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitDispatch} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Courier Company / Partner <span className="text-rose-500">*</span>
                </label>
                <select
                  value={dispatchForm.courier_company}
                  onChange={(e) => setDispatchForm((p) => ({ ...p, courier_company: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 font-semibold bg-white"
                  required
                >
                  {companies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {dispatchForm.courier_company === 'Other' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Enter Courier Company Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Navata Road Transport / Porter"
                    value={dispatchForm.custom_courier_company}
                    onChange={(e) => setDispatchForm((p) => ({ ...p, custom_courier_company: e.target.value }))}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Tracking / Consignment Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DTDC-9876543210 / STC789654"
                  value={dispatchForm.tracking_number}
                  onChange={(e) => setDispatchForm((p) => ({ ...p, tracking_number: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 font-mono font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Dispatch Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={dispatchForm.dispatch_date}
                    onChange={(e) => setDispatchForm((p) => ({ ...p, dispatch_date: e.target.value }))}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Expected Delivery Date
                  </label>
                  <input
                    type="date"
                    min={dispatchForm.dispatch_date}
                    value={dispatchForm.expected_delivery_date}
                    onChange={(e) => setDispatchForm((p) => ({ ...p, expected_delivery_date: e.target.value }))}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Delivery Notes / Consignment Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. 1 carton containing 2 camera units and wiring kit booked via DTDC Ambattur branch."
                  value={dispatchForm.delivery_notes}
                  onChange={(e) => setDispatchForm((p) => ({ ...p, delivery_notes: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setDispatchModalChecklist(null)}
                  disabled={submittingDispatch}
                  className="px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDispatch}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingDispatch ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Confirm Dispatch & Deduct Stock</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UPDATE STATUS MODAL */}
      {statusModalDispatch && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" /> Update Delivery Status
              </h3>
              <button
                type="button"
                onClick={() => setStatusModalDispatch(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl text-xs space-y-1">
              <div className="font-bold text-gray-900">{statusModalDispatch.checklist_number}</div>
              <div className="text-gray-500 font-mono">Courier: {statusModalDispatch.courier_company} | Tracking: {statusModalDispatch.tracking_number}</div>
            </div>

            {statusError && (
              <div className="p-3 bg-rose-50 text-rose-800 rounded-xl text-xs font-semibold">
                {statusError}
              </div>
            )}

            <form onSubmit={handleSubmitStatus} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Delivery Status <span className="text-rose-500">*</span>
                </label>
                <select
                  value={statusForm.delivery_status}
                  onChange={(e) => setStatusForm((p) => ({ ...p, delivery_status: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-bold bg-white"
                  required
                >
                  <option value="Dispatched">Dispatched</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Delivered">Delivered (Package Arrived at Customer Site)</option>
                  <option value="Delivery Exception">Delivery Exception (Address issue, customer delayed)</option>
                  <option value="Cancelled">Cancelled (Returned shipment)</option>
                </select>
              </div>

              {statusForm.delivery_status === 'Delivered' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Received By (Person / Contact on site)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Client Security Officer / Raman"
                    value={statusForm.received_by_person}
                    onChange={(e) => setStatusForm((p) => ({ ...p, received_by_person: e.target.value }))}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-emerald-600 block mt-1 font-medium">
                    ✓ Once marked Delivered, the checklist will become ready for technician scheduling! Stock is not deducted again.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Status Notes / Delivery Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Package reached Coimbatore hub, out for delivery today."
                  value={statusForm.notes}
                  onChange={(e) => setStatusForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setStatusModalDispatch(null)}
                  disabled={submittingStatus}
                  className="px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingStatus}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingStatus ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>Save Status</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD RETURN TO STORE MODAL */}
      {returnModalDispatch && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-rose-600" /> Record Return to Store
              </h3>
              <button
                type="button"
                onClick={() => setReturnModalDispatch(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-900 space-y-1">
              <div className="font-bold">Checklist: {returnModalDispatch.checklist_number}</div>
              <div>Courier: {returnModalDispatch.courier_company} ({returnModalDispatch.tracking_number})</div>
              <p className="text-[11px] text-rose-800 pt-1">
                This transaction will credit all dispatched items back into store inventory with an auditable ledger record.
              </p>
            </div>

            {returnError && (
              <div className="p-3 bg-rose-50 text-rose-800 rounded-xl text-xs font-semibold">
                {returnError}
              </div>
            )}

            <form onSubmit={handleSubmitReturn} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Reason for Return / Store Verification Notes <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Shipment rejected by customer. All 2 camera units and materials verified intact and restocked."
                  value={returnRemarks}
                  onChange={(e) => setReturnRemarks(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setReturnModalDispatch(null)}
                  disabled={submittingReturn}
                  className="px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingReturn ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  <span>Credit Back to Store</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
