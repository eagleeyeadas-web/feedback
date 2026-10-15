import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchCoordinatorBookings,
  saveCoordinatorBookingApi,
  fetchCoordinatorBookingHistory,
  fetchCoordinatorExtensionRequests,
  approveCoordinatorExtensionRequest,
  rejectCoordinatorExtensionRequest,
  fetchCoordinatorRestDayRequests,
  approveCoordinatorRestDay,
  rejectCoordinatorRestDay,
  fetchCoordinatorLeaveRequests,
  approveCoordinatorLeave,
  rejectCoordinatorLeave,
  fetchCoordinatorScheduleConflicts,
  fetchCoordinatorAffectedBookings,
  fetchChecklistDeletionPreviewApi,
  deleteAllEligibleChecklistsApi,
  checkChecklistDeletionEligibilityApi,
  deleteChecklistApi,
  cancelChecklistApi,
} from '../../../lib/api';
import EngineerAvailabilityCalendar from '../../../components/workspaces/EngineerAvailabilityCalendar';
import {
  CalendarCheck,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  MapPin,
  ExternalLink,
  Bus,
  Hotel,
  User,
  Users,
  Car,
  FileText,
  X,
  Save,
  Check,
  RefreshCw,
  Info,
  Calendar,
  Phone,
  History,
  Shield,
  Send,
  AlertTriangle,
  Moon,
  CalendarOff,
  ArrowRight,
  CheckSquare,
  XCircle,
  Trash2,
  Trash,
  Ban,
} from 'lucide-react';

const SERVICE_ENGINEER_OPTIONS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function CoordinatorWorkspace() {
  const { token, user } = useAuth();

  // Primary Workspace State
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed' | 'schedule'
  const [scheduleSubTab, setScheduleSubTab] = useState('approvals'); // 'approvals' | 'calendar' | 'conflicts' | 'affected'
  const [checklists, setChecklists] = useState([]);
  const [stats, setStats] = useState({ pending: 0, in_progress: 0, completed: 0, not_required: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Schedule Management State
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [restDayRequests, setRestDayRequests] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [scheduleConflicts, setScheduleConflicts] = useState([]);
  const [affectedBookings, setAffectedBookings] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // Decision Modal State (Approve / Reject for Extension, Rest Day, Leave)
  const [decisionModal, setDecisionModal] = useState(null); // { type: 'EXTENSION' | 'REST' | 'LEAVE', action: 'APPROVE' | 'REJECT', item: obj }
  const [decisionNotes, setDecisionNotes] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState('');

  // Filters State for Bookings
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEngineer, setSelectedEngineer] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState('');

  // Modal / Manage Booking State
  const [manageBookingModal, setManageBookingModal] = useState(null);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [auditHistory, setAuditHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(false);

  // Safe Checklist Deletion States
  const [deleteSingleModal, setDeleteSingleModal] = useState(null); // { checklist, checking, eligibility, error, submitting }
  const [deleteAllModal, setDeleteAllModal] = useState(null); // { loading, preview, confirmedCountInput, error, submitting, result }
  const [cancelChecklistModal, setCancelChecklistModal] = useState(null); // { checklist, reason, submitting, error }

  const isAuthorizedCoordinator = Boolean(
    user && (user.role === 'COORDINATOR' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')
  );

  // Booking Form State
  const [formData, setFormData] = useState({
    booking_status: 'IN_PROGRESS',
    travel_required: false,
    travel_type: 'Bus',
    departure_city: '',
    destination: '',
    travel_datetime: '',
    ticket_reference: '',
    travel_notes: '',
    accommodation_required: false,
    hotel_name: '',
    check_in_date: '',
    check_out_date: '',
    number_of_rooms: 1,
    hotel_booking_reference: '',
    accommodation_notes: '',
    additional_personnel: '',
    coordinator_notes: '',
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  // Load Bookings Data from API
  const loadBookings = useCallback(async (isSilent = false) => {
    if (!token) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetchCoordinatorBookings(token, {
        tab: activeTab === 'schedule' ? 'pending' : activeTab,
        search: searchTerm,
        engineer: selectedEngineer,
        status: selectedStatus,
        date: selectedDate,
        limit: 100,
      });

      setChecklists(res.checklists || []);
      if (res.stats) setStats(res.stats);
    } catch (err) {
      console.error('Failed to load coordinator bookings:', err);
      showToast(err.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, activeTab, searchTerm, selectedEngineer, selectedStatus, selectedDate]);

  // Load Schedule & Availability Data
  const loadScheduleData = useCallback(async () => {
    if (!token) return;
    setLoadingSchedule(true);
    try {
      const [extRes, restRes, leaveRes, confRes, affRes] = await Promise.all([
        fetchCoordinatorExtensionRequests(token, { status: 'ALL' }).catch(() => ({ requests: [] })),
        fetchCoordinatorRestDayRequests(token, { status: 'ALL' }).catch(() => ({ rest_days: [] })),
        fetchCoordinatorLeaveRequests(token, { status: 'ALL' }).catch(() => ({ leaves: [] })),
        fetchCoordinatorScheduleConflicts(token).catch(() => ({ conflicts: [] })),
        fetchCoordinatorAffectedBookings(token).catch(() => ({ affected_bookings: [] })),
      ]);

      setExtensionRequests(extRes.requests || []);
      setRestDayRequests(restRes.rest_days || []);
      setLeaveRequests(leaveRes.leaves || []);
      setScheduleConflicts(confRes.conflicts || []);
      setAffectedBookings(affRes.affected_bookings || []);
    } catch (err) {
      console.error('Failed to load schedule data:', err);
    } finally {
      setLoadingSchedule(false);
    }
  }, [token]);

  useEffect(() => {
    loadBookings();
    loadScheduleData();
  }, [loadBookings, loadScheduleData]);

  const pendingExtensions = useMemo(
    () => extensionRequests.filter((e) => e.status === 'PENDING'),
    [extensionRequests]
  );
  const pendingRest = useMemo(
    () => restDayRequests.filter((r) => r.status === 'PENDING'),
    [restDayRequests]
  );
  const pendingLeaves = useMemo(
    () => leaveRequests.filter((l) => l.status === 'PENDING'),
    [leaveRequests]
  );

  const pendingApprovalsCount = pendingExtensions.length + pendingRest.length + pendingLeaves.length;

  // Open Manage Booking Modal
  const openManageModal = async (chk) => {
    setManageBookingModal(chk);
    setModalError('');
    setShowHistorySection(false);

    const b = chk.coordinator_booking || {};

    let formattedDatetime = '';
    if (b.travel_datetime) {
      const d = new Date(b.travel_datetime);
      if (!isNaN(d.getTime())) {
        formattedDatetime = d.toISOString().slice(0, 16);
      }
    } else if (chk.expected_arrival_date) {
      const timeStr = chk.expected_arrival_time || '08:00';
      formattedDatetime = `${chk.expected_arrival_date}T${timeStr.slice(0, 5)}`;
    }

    setFormData({
      booking_status: b.booking_status && b.booking_status !== 'PENDING' ? b.booking_status : 'IN_PROGRESS',
      travel_required: Boolean(b.travel_required),
      travel_type: b.travel_type || 'Bus',
      departure_city: b.departure_city || '',
      destination: b.destination || chk.client_location || '',
      travel_datetime: formattedDatetime,
      ticket_reference: b.ticket_reference || '',
      travel_notes: b.travel_notes || '',
      accommodation_required: Boolean(b.accommodation_required),
      hotel_name: b.hotel_name || '',
      check_in_date: b.check_in_date || chk.expected_arrival_date || '',
      check_out_date: b.check_out_date || chk.booking_end_date || chk.expected_arrival_date || '',
      number_of_rooms: b.number_of_rooms || 1,
      hotel_booking_reference: b.hotel_booking_reference || '',
      accommodation_notes: b.accommodation_notes || '',
      additional_personnel: b.additional_personnel || '',
      coordinator_notes: b.coordinator_notes || '',
    });

    setLoadingHistory(true);
    try {
      const res = await fetchCoordinatorBookingHistory(token, chk.id);
      setAuditHistory(res.history || []);
    } catch (err) {
      console.warn('Could not load booking history:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Submit Booking Updates
  const handleSubmitBooking = async (targetStatus = null) => {
    if (!manageBookingModal) return;
    setModalError('');
    setSubmittingModal(true);

    try {
      const payload = {
        ...formData,
        booking_status: targetStatus || formData.booking_status,
      };

      await saveCoordinatorBookingApi(token, manageBookingModal.id, payload);
      showToast('Booking details saved successfully!');
      setManageBookingModal(null);
      loadBookings(true);
      loadScheduleData();
    } catch (err) {
      console.error('Failed to save booking:', err);
      setModalError(err.message || 'Failed to save booking details');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Open Decision Modal for Extension, Rest Day, or Leave
  const openDecisionModal = (type, action, item) => {
    setDecisionModal({ type, action, item });
    setDecisionNotes('');
    setDecisionError('');
  };

  // Execute Decision
  const handleExecuteDecision = async () => {
    if (!decisionModal) return;
    const { type, action, item } = decisionModal;
    setDecisionError('');
    setSubmittingDecision(true);

    try {
      if (type === 'EXTENSION') {
        if (action === 'APPROVE') {
          await approveCoordinatorExtensionRequest(token, item.id, decisionNotes);
          showToast(`Availability date update for ${item.checklist_number} approved! Current schedule and engineer availability updated.`);
        } else {
          await rejectCoordinatorExtensionRequest(token, item.id, decisionNotes);
          showToast(`Availability date update for ${item.checklist_number} rejected.`);
        }
      } else if (type === 'REST') {
        if (action === 'APPROVE') {
          await approveCoordinatorRestDay(token, item.id, decisionNotes);
          showToast(`Rest day for ${item.engineer_name} approved!`);
        } else {
          await rejectCoordinatorRestDay(token, item.id, decisionNotes);
          showToast(`Rest day for ${item.engineer_name} rejected.`);
        }
      } else if (type === 'LEAVE') {
        if (action === 'APPROVE') {
          await approveCoordinatorLeave(token, item.id, decisionNotes);
          showToast(`Leave for ${item.engineer_name} approved!`);
        } else {
          await rejectCoordinatorLeave(token, item.id, decisionNotes);
          showToast(`Leave for ${item.engineer_name} rejected.`);
        }
      }

      setDecisionModal(null);
      setCalendarRefreshKey((k) => k + 1);
      loadScheduleData();
      loadBookings(true);
    } catch (err) {
      console.error('Decision execution error:', err);
      setDecisionError(err.message || 'Failed to execute decision');
    } finally {
      setSubmittingDecision(false);
    }
  };

  // Safe Deletion Handlers
  const openDeleteSingleModal = async (chk) => {
    setDeleteSingleModal({
      checklist: chk,
      checking: true,
      eligibility: null,
      error: '',
      submitting: false,
    });

    try {
      const eligibility = await checkChecklistDeletionEligibilityApi(token, chk.id);
      setDeleteSingleModal((prev) => (prev ? { ...prev, checking: false, eligibility } : null));
    } catch (err) {
      setDeleteSingleModal((prev) => (prev ? { ...prev, checking: false, error: err.message || 'Failed to check eligibility' } : null));
    }
  };

  const handleConfirmDeleteSingle = async () => {
    if (!deleteSingleModal || !deleteSingleModal.checklist) return;
    setDeleteSingleModal((prev) => ({ ...prev, submitting: true, error: '' }));

    try {
      const res = await deleteChecklistApi(token, deleteSingleModal.checklist.id);
      showToast(res.message || `Checklist ${deleteSingleModal.checklist.checklist_number} successfully deleted.`);
      setDeleteSingleModal(null);
      await loadBookings(true);
    } catch (err) {
      setDeleteSingleModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete checklist',
        eligibility: err.reasons ? { ...prev.eligibility, reasons: err.reasons, canCancel: err.canCancel } : prev.eligibility,
      }));
    }
  };

  const openDeleteAllModal = async () => {
    setDeleteAllModal({
      loading: true,
      preview: null,
      confirmedCountInput: '',
      error: '',
      submitting: false,
      result: null,
    });

    try {
      const preview = await fetchChecklistDeletionPreviewApi(token);
      setDeleteAllModal((prev) => (prev ? { ...prev, loading: false, preview } : null));
    } catch (err) {
      setDeleteAllModal((prev) => (prev ? { ...prev, loading: false, error: err.message || 'Failed to load deletion preview' } : null));
    }
  };

  const handleConfirmDeleteAll = async () => {
    if (!deleteAllModal || !deleteAllModal.preview) return;
    const { preview, confirmedCountInput } = deleteAllModal;

    if (Number(confirmedCountInput) !== preview.eligibleCount) {
      setDeleteAllModal((prev) => ({
        ...prev,
        error: `Please enter the exact count of eligible checklists (${preview.eligibleCount}) to confirm.`,
      }));
      return;
    }

    setDeleteAllModal((prev) => ({ ...prev, submitting: true, error: '' }));

    try {
      const res = await deleteAllEligibleChecklistsApi(token, preview.eligibleCount);
      setDeleteAllModal((prev) => ({ ...prev, submitting: false, result: res }));
      showToast(res.message || 'Batch deletion completed successfully.');
      await loadBookings(true);
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete eligible checklists',
        preview: err.preview || prev.preview,
      }));
    }
  };

  const openCancelModal = (chk) => {
    setCancelChecklistModal({
      checklist: chk,
      reason: 'Cancelled by Coordinator',
      submitting: false,
      error: '',
    });
  };

  const handleConfirmCancelChecklist = async () => {
    if (!cancelChecklistModal || !cancelChecklistModal.checklist) return;
    setCancelChecklistModal((prev) => ({ ...prev, submitting: true, error: '' }));

    try {
      const res = await cancelChecklistApi(token, cancelChecklistModal.checklist.id, cancelChecklistModal.reason);
      showToast(res.message || `Checklist ${cancelChecklistModal.checklist.checklist_number} cancelled.`);
      setCancelChecklistModal(null);
      if (deleteSingleModal) setDeleteSingleModal(null);
      await loadBookings(true);
    } catch (err) {
      setCancelChecklistModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to cancel checklist',
      }));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 border border-gray-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wider">
              Coordinator Workspace
            </span>
            <span className="text-xs text-gray-400">•</span>
            <span className="text-xs text-gray-500 font-medium">Eagle Eye SafDrive</span>
          </div>
          <h1 className="text-lg sm:text-xl font-black text-gray-900 mt-1 flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-indigo-600" />
            <span>Travel, Logistics & Availability Management</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Coordinate bus tickets, room accommodations, technician availability, schedule extensions, and leave requests.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              loadBookings(true);
              loadScheduleData();
            }}
            disabled={loading || refreshing || loadingSchedule}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing || loadingSchedule ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <AlertCircle size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Pending Bookings</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.pending}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">In Progress</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.in_progress}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Completed Bookings</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.completed}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">Pending Approvals</span>
            <span className="text-xl font-black text-rose-700 mt-0.5 block">{pendingApprovalsCount}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Schedule Conflicts</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{scheduleConflicts.length}</span>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'pending'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Clock size={16} />
          <span>Pending Travel Bookings</span>
          <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-100 text-amber-800">
            {stats.pending + stats.in_progress}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'completed'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <CheckCircle2 size={16} />
          <span>Completed Bookings</span>
          <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-emerald-100 text-emerald-800">
            {stats.completed + stats.not_required}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'schedule'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Users size={16} />
          <span>Schedule &amp; Availability Management</span>
          {pendingApprovalsCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-100 text-rose-800 animate-pulse">
              {pendingApprovalsCount}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================
          TAB 1 & 2: TRAVEL & ROOM BOOKINGS (PENDING / COMPLETED)
          ============================================================ */}
      {(activeTab === 'pending' || activeTab === 'completed') && (
        <div className="space-y-4">
          {/* Sales Initiated Installation Checklists Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="text-indigo-600 shrink-0" size={18} />
                <h3 className="text-sm sm:text-base font-bold text-gray-900">
                  Sales Initiated Installation Checklists
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                  {stats.total || checklists.length} Jobs
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Review sales-created installation checklists, coordinate travel logistics, or manage checklist records.
              </p>
            </div>

            {isAuthorizedCoordinator && (
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  id="btn-delete-all-checklists"
                  onClick={openDeleteAllModal}
                  disabled={loading || refreshing}
                  className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 border border-rose-300 rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} className="text-rose-600" />
                  <span>Delete All Checklists</span>
                </button>
              </div>
            )}
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search checklist #, client, location..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl focus:outline-hidden focus:border-indigo-500 font-medium"
              />
            </div>

            <div>
              <select
                value={selectedEngineer}
                onChange={(e) => setSelectedEngineer(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-xl focus:outline-hidden focus:border-indigo-500 font-semibold text-gray-700 bg-white cursor-pointer"
              >
                <option value="ALL">All Service Engineers</option>
                {SERVICE_ENGINEER_OPTIONS.map((eng) => (
                  <option key={eng} value={eng}>
                    Engineer: {eng}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-xl focus:outline-hidden focus:border-indigo-500 font-semibold text-gray-700 bg-white cursor-pointer"
              >
                <option value="ALL">All Booking Statuses</option>
                <option value="PENDING">Pending Arrangements</option>
                <option value="IN_PROGRESS">Arrangements In Progress</option>
                <option value="COMPLETED">Completed Bookings</option>
                <option value="NOT_REQUIRED">Not Required</option>
              </select>
            </div>

            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-xl focus:outline-hidden focus:border-indigo-500 font-semibold text-gray-700 bg-white"
              />
            </div>
          </div>

          {/* Booking Cards Grid */}
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <span className="text-xs text-gray-500 font-medium">Loading checklists and booking records...</span>
            </div>
          ) : checklists.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs space-y-2">
              <CalendarCheck className="w-10 h-10 text-gray-300 mx-auto" />
              <h3 className="text-sm font-bold text-gray-800">
                {activeTab === 'pending' ? 'No pending bookings' : 'No completed bookings found'}
              </h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                {activeTab === 'pending'
                  ? 'All eligible Sales checklists have travel and room arrangements confirmed, or no pending checklists match current filters.'
                  : 'Confirmed bookings and completed travel arrangements will appear here for historical tracking.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {checklists.map((chk) => {
                const b = chk.coordinator_booking || {};
                const isFlaggedForReview = Boolean(b.schedule_flagged_for_review);

                return (
                  <div
                    key={chk.id}
                    className={`bg-white p-5 rounded-2xl border transition-all space-y-4 shadow-xs ${
                      isFlaggedForReview
                        ? 'border-amber-400 bg-amber-50/20 ring-1 ring-amber-300'
                        : 'border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    {/* Flagged Review Alert */}
                    {isFlaggedForReview && (
                      <div className="p-2.5 bg-amber-100/80 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle size={14} className="text-amber-700 shrink-0" />
                          <span>Schedule Change: Return Travel / Hotel Review Required</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openManageModal(chk)}
                          className="px-2 py-0.5 bg-amber-700 text-white rounded font-bold text-[10px] hover:bg-amber-800 transition"
                        >
                          Review Now
                        </button>
                      </div>
                    )}

                    {/* Top Row: Checklist Number & Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {chk.checklist_number}
                          </span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                            {chk.installation_or_service || 'Installation'}
                          </span>
                        </div>
                        <h3 className="text-sm font-black text-gray-900 mt-1">{chk.client_name}</h3>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin size={12} className="text-gray-400 shrink-0" />
                          <span>{chk.client_location || 'Location Not Specified'}</span>
                        </p>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 ${
                          b.booking_status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : b.booking_status === 'NOT_REQUIRED'
                            ? 'bg-gray-100 text-gray-600 border border-gray-200'
                            : b.booking_status === 'IN_PROGRESS'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {b.booking_status || 'PENDING'}
                      </span>
                    </div>

                    {/* Schedule and Engineer Details */}
                    <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200 text-xs space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-gray-500 font-medium">Assigned Engineer:</span>
                        <span className="font-bold text-gray-900 flex items-center gap-1">
                          <User size={12} className="text-indigo-600" />
                          <span>{chk.service_engineer || 'Unassigned'}</span>
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 font-medium">Current Schedule:</span>
                        <span className="font-semibold text-gray-800">
                          {chk.current_expected_arrival_date || chk.expected_arrival_date} ({chk.current_installation_duration || chk.installation_duration || '1 Day'})
                        </span>
                      </div>
                      {chk.original_expected_arrival_date && chk.original_expected_arrival_date !== (chk.current_expected_arrival_date || chk.expected_arrival_date) && (
                        <div className="flex justify-between text-[11px] text-gray-400">
                          <span>Original Planned:</span>
                          <span>{chk.original_expected_arrival_date}</span>
                        </div>
                      )}
                    </div>

                    {/* Travel & Accommodation Snapshot */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl border border-gray-200 bg-white space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-gray-800 text-[11px]">
                          <Bus size={14} className="text-purple-600" />
                          <span>Bus / Travel</span>
                        </div>
                        {b.travel_required ? (
                          <div className="text-[11px] text-gray-600 space-y-0.5">
                            <div><span className="font-semibold">{b.departure_city || 'City'}</span> → <span className="font-semibold">{b.destination || 'Site'}</span></div>
                            {b.ticket_reference && <div className="font-mono text-purple-700">Ref: {b.ticket_reference}</div>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No travel required</span>
                        )}
                      </div>

                      <div className="p-2.5 rounded-xl border border-gray-200 bg-white space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-gray-800 text-[11px]">
                          <Hotel size={14} className="text-blue-600" />
                          <span>Accommodation</span>
                        </div>
                        {b.accommodation_required ? (
                          <div className="text-[11px] text-gray-600 space-y-0.5">
                            <div className="font-semibold truncate">{b.hotel_name || 'Hotel'}</div>
                            {b.hotel_booking_reference && <div className="font-mono text-blue-700">Ref: {b.hotel_booking_reference}</div>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No room required</span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      {isAuthorizedCoordinator && (
                        <button
                          type="button"
                          id={`btn-delete-checklist-${chk.id}`}
                          onClick={() => openDeleteSingleModal(chk)}
                          className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                          title="Delete checklist safely"
                        >
                          <Trash2 size={13} />
                          <span>Delete</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openManageModal(chk)}
                        className="ml-auto px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <CalendarCheck size={14} />
                        <span>Manage Logistics</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          TAB 3: SCHEDULE & AVAILABILITY MANAGEMENT SECTION
          ============================================================ */}
      {activeTab === 'schedule' && (
        <div className="space-y-5">
          {/* Sub-tab Navigation */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
            <button
              type="button"
              onClick={() => setScheduleSubTab('approvals')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                scheduleSubTab === 'approvals'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <CheckSquare size={14} />
              <span>Pending Approvals</span>
              {pendingApprovalsCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-500 text-white">
                  {pendingApprovalsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setScheduleSubTab('calendar')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                scheduleSubTab === 'calendar'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Calendar size={14} />
              <span>Technician Calendar</span>
            </button>

            <button
              type="button"
              onClick={() => setScheduleSubTab('conflicts')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                scheduleSubTab === 'conflicts'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <AlertTriangle size={14} />
              <span>Schedule Conflicts ({scheduleConflicts.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setScheduleSubTab('affected')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                scheduleSubTab === 'affected'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Bus size={14} />
              <span>Affected Travel/Room Bookings ({affectedBookings.length})</span>
            </button>
          </div>

          {/* SUB-SECTION 1: PENDING APPROVALS */}
          {scheduleSubTab === 'approvals' && (
            <div className="space-y-6">
              {/* 1A. Availability Date Requests */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-600" />
                      <span>Pending Availability Date Requests ({pendingExtensions.length})</span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Technicians requested revised availability dates for ongoing installations.
                    </p>
                  </div>
                </div>

                {pendingExtensions.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-xl text-xs text-gray-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                    <span>No pending availability date requests requiring approval.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingExtensions.map((ext) => (
                      <div key={ext.id} className="p-4 bg-amber-50/40 border border-amber-200 rounded-2xl space-y-3 text-xs">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-gray-200">
                              {ext.checklist_number}
                            </span>
                            <h4 className="font-black text-gray-900 mt-1">{ext.client_name}</h4>
                            {ext.client_location && (
                              <p className="text-gray-500 text-[11px]">{ext.client_location}</p>
                            )}
                          </div>
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[10px] uppercase">
                            Pending Review
                          </span>
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-amber-100 space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-gray-500 font-medium">Service Engineer:</span>
                            <span className="font-bold text-gray-900">{ext.engineer_name || ext.technician_name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500 font-medium">Current Availability Date:</span>
                            <span className="font-semibold text-gray-700 font-mono">
                              {ext.current_dates?.completion_date || ext.current_completion_date || 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between text-amber-900 font-bold">
                            <span>Requested New Availability Date:</span>
                            <span className="font-mono text-amber-700">{ext.requested_completion_date}</span>
                          </div>
                          <div className="pt-1.5 border-t border-gray-100 text-gray-700">
                            <span className="font-bold text-gray-800">Reason for Date Change:</span> {ext.reason}
                          </div>
                          {ext.notes && (
                            <div className="text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100">
                              <span className="font-bold text-gray-700">Additional Notes:</span> {ext.notes}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            id={`reject-ext-${ext.id}`}
                            onClick={() => openDecisionModal('EXTENSION', 'REJECT', ext)}
                            className="px-3.5 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition cursor-pointer"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            id={`approve-ext-${ext.id}`}
                            onClick={() => openDecisionModal('EXTENSION', 'APPROVE', ext)}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <Check size={14} />
                            <span>Approve</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 1B. Rest Day Requests */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <Moon className="w-4 h-4 text-indigo-600" />
                  <span>Pending Rest-Day Requests ({pendingRest.length})</span>
                </h3>

                {pendingRest.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-xl text-xs text-gray-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                    <span>No pending rest day requests.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingRest.map((r) => (
                      <div key={r.id} className="p-4 bg-indigo-50/40 border border-indigo-200 rounded-2xl space-y-3 text-xs">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-bold text-gray-900">{r.engineer_name}</span>
                            {r.checklist_number && (
                              <p className="text-[11px] font-mono text-indigo-600 mt-0.5">Job: {r.checklist_number}</p>
                            )}
                          </div>
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[10px] uppercase">
                            Pending
                          </span>
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-indigo-100 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Rest Period:</span>
                            <span className="font-bold text-gray-900">{r.rest_start_date} to {r.rest_end_date}</span>
                          </div>
                          <div className="text-gray-700 pt-1 border-t border-gray-100">
                            <span className="font-bold text-gray-800">Reason:</span> {r.reason}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => openDecisionModal('REST', 'REJECT', r)}
                            className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition cursor-pointer"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => openDecisionModal('REST', 'APPROVE', r)}
                            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <Check size={14} />
                            <span>Approve Rest</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 1C. Leave Requests */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <CalendarOff className="w-4 h-4 text-rose-600" />
                  <span>Pending Leave Requests ({pendingLeaves.length})</span>
                </h3>

                {pendingLeaves.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-xl text-xs text-gray-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                    <span>No pending leave requests.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingLeaves.map((l) => (
                      <div key={l.id} className="p-4 bg-rose-50/40 border border-rose-200 rounded-2xl space-y-3 text-xs">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-bold text-gray-900">{l.engineer_name}</span>
                            <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                              {l.leave_type} Leave
                            </span>
                          </div>
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px] uppercase">
                            Pending
                          </span>
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-rose-100 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Leave Dates:</span>
                            <span className="font-bold text-gray-900">{l.leave_start_date} to {l.leave_end_date}</span>
                          </div>
                          <div className="text-gray-700 pt-1 border-t border-gray-100">
                            <span className="font-bold text-gray-800">Reason:</span> {l.reason}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => openDecisionModal('LEAVE', 'REJECT', l)}
                            className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition cursor-pointer"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => openDecisionModal('LEAVE', 'APPROVE', l)}
                            className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs transition cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <Check size={14} />
                            <span>Approve Leave</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUB-SECTION 2: CALENDAR */}
          {scheduleSubTab === 'calendar' && (
            <EngineerAvailabilityCalendar
              key={calendarRefreshKey}
              token={token}
              onSelectChecklist={(cid) => {
                const found = checklists.find((c) => c.id === cid);
                if (found) openManageModal(found);
              }}
            />
          )}

          {/* SUB-SECTION 3: CONFLICTS */}
          {scheduleSubTab === 'conflicts' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4 text-xs">
              <div>
                <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>Detected Schedule Conflicts ({scheduleConflicts.length})</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Overlapping commitments or assignments requiring Coordinator intervention and resolution.
                </p>
              </div>

              {scheduleConflicts.length === 0 ? (
                <div className="p-8 text-center bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-1.5" />
                  <p className="font-bold">Zero Scheduling Conflicts Detected!</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">All 4 service engineers have distinct, non-overlapping assignments.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {scheduleConflicts.map((conf, idx) => (
                    <div key={idx} className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between font-bold text-red-900">
                        <span>Engineer: {conf.engineer_name}</span>
                        <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-red-200">
                          Overlap: {conf.overlap_start} to {conf.overlap_end}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                        <div className="bg-white p-2.5 rounded-lg border border-red-100">
                          <span className="font-bold text-red-700 block">Commitment 1:</span>
                          <div>{conf.commitment_a?.type}: {conf.commitment_a?.checklist_number || conf.commitment_a?.reason || 'Booking'}</div>
                          <div className="text-gray-400">{conf.commitment_a?.start_date} to {conf.commitment_a?.end_date}</div>
                        </div>
                        <div className="bg-white p-2.5 rounded-lg border border-red-100">
                          <span className="font-bold text-red-700 block">Commitment 2:</span>
                          <div>{conf.commitment_b?.type}: {conf.commitment_b?.checklist_number || conf.commitment_b?.reason || 'Booking'}</div>
                          <div className="text-gray-400">{conf.commitment_b?.start_date} to {conf.commitment_b?.end_date}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-SECTION 4: AFFECTED TRAVEL / ROOM BOOKINGS */}
          {scheduleSubTab === 'affected' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4 text-xs">
              <div>
                <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <Bus className="w-4 h-4 text-purple-600" />
                  <span>Affected Travel &amp; Accommodation Bookings ({affectedBookings.length})</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Bookings where approved schedule extensions or rest days modified completion dates, requiring manual ticket or hotel date adjustments.
                </p>
              </div>

              {affectedBookings.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-xl text-gray-500">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                  <p className="font-bold">No Bookings Flagged for Date Review</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">All tickets and accommodation dates match current job schedules.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {affectedBookings.map((chk) => (
                    <div key={chk.id} className="p-4 bg-amber-50/50 border border-amber-300 rounded-xl flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-gray-200">
                            {chk.checklist_number}
                          </span>
                          <span className="font-bold text-gray-900">{chk.client_name}</span>
                        </div>
                        <p className="text-[11px] text-amber-900 font-medium">
                          {chk.coordinator_booking?.schedule_review_reason || 'Schedule revised. Return travel or accommodation dates may require manual update.'}
                        </p>
                        <div className="text-[10px] text-gray-500">
                          Current End Date: <span className="font-bold text-gray-800">{chk.current_booking_end_date || chk.booking_end_date}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openManageModal(chk)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition cursor-pointer shrink-0"
                      >
                        Adjust Booking
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          COORDINATOR DECISION MODAL (APPROVE / REJECT)
          ============================================================ */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in fade-in zoom-in-95 text-xs">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <span
                  className={`px-2 py-0.5 rounded font-black text-[10px] uppercase ${
                    decisionModal.action === 'APPROVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {decisionModal.action} {decisionModal.type === 'EXTENSION' ? 'AVAILABILITY DATE UPDATE' : decisionModal.type}
                </span>
                <h4 className="text-base font-black text-gray-900 mt-1">
                  Confirm {decisionModal.action === 'APPROVE' ? 'Approval' : 'Rejection'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {decisionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{decisionError}</span>
              </div>
            )}

            <p className="text-gray-600">
              Are you sure you want to {decisionModal.action.toLowerCase()} this {decisionModal.type === 'EXTENSION' ? 'availability date update' : decisionModal.type.toLowerCase()} request?
              {decisionModal.action === 'APPROVE' && ' Availability and current expected schedules will be updated atomically.'}
            </p>

            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Coordinator Decision Notes / Remarks
              </label>
              <textarea
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                rows={3}
                placeholder="Optional notes or instructions for the technician..."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                disabled={submittingDecision}
                onClick={() => setDecisionModal(null)}
                className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingDecision}
                onClick={handleExecuteDecision}
                className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  decisionModal.action === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {submittingDecision ? 'Processing...' : `Confirm ${decisionModal.action === 'APPROVE' ? 'Approval' : 'Rejection'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MANAGE TRAVEL & ROOM BOOKING MODAL (EXISTING)
          ============================================================ */}
      {manageBookingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-gray-100 my-8 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    {manageBookingModal.checklist_number}
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs font-semibold text-gray-700">{manageBookingModal.client_name}</span>
                </div>
                <h2 className="text-base sm:text-lg font-black text-gray-900 mt-1 flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-indigo-600" />
                  <span>Travel &amp; Accommodation Arrangements</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setManageBookingModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {modalError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Modal Body Form */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              {/* Section 1: Travel */}
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-gray-900">
                    <Bus size={16} className="text-purple-600" />
                    <span>Travel / Bus Booking</span>
                  </div>
                  <label className="flex items-center gap-1.5 font-bold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.travel_required}
                      onChange={(e) => setFormData({ ...formData, travel_required: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Travel Required</span>
                  </label>
                </div>

                {formData.travel_required && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-200/60">
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Departure City</label>
                      <input
                        type="text"
                        value={formData.departure_city}
                        onChange={(e) => setFormData({ ...formData, departure_city: e.target.value })}
                        placeholder="e.g. Chennai"
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Destination</label>
                      <input
                        type="text"
                        value={formData.destination}
                        onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                        placeholder="e.g. Coimbatore"
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Travel Date &amp; Time</label>
                      <input
                        type="datetime-local"
                        value={formData.travel_datetime}
                        onChange={(e) => setFormData({ ...formData, travel_datetime: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Ticket Reference / PNR</label>
                      <input
                        type="text"
                        value={formData.ticket_reference}
                        onChange={(e) => setFormData({ ...formData, ticket_reference: e.target.value })}
                        placeholder="PNR / Ticket Number"
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Room / Accommodation */}
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-gray-900">
                    <Hotel size={16} className="text-blue-600" />
                    <span>Hotel / Room Accommodation</span>
                  </div>
                  <label className="flex items-center gap-1.5 font-bold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.accommodation_required}
                      onChange={(e) => setFormData({ ...formData, accommodation_required: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Accommodation Required</span>
                  </label>
                </div>

                {formData.accommodation_required && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-200/60">
                    <div className="sm:col-span-2">
                      <label className="block text-gray-600 font-semibold mb-1">Hotel / Lodge Name</label>
                      <input
                        type="text"
                        value={formData.hotel_name}
                        onChange={(e) => setFormData({ ...formData, hotel_name: e.target.value })}
                        placeholder="e.g. Grand Residency"
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Check-in Date</label>
                      <input
                        type="date"
                        value={formData.check_in_date}
                        onChange={(e) => setFormData({ ...formData, check_in_date: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Check-out Date</label>
                      <input
                        type="date"
                        value={formData.check_out_date}
                        onChange={(e) => setFormData({ ...formData, check_out_date: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Hotel Booking Ref / Confirmation</label>
                      <input
                        type="text"
                        value={formData.hotel_booking_reference}
                        onChange={(e) => setFormData({ ...formData, hotel_booking_reference: e.target.value })}
                        placeholder="e.g. BOOK-88219"
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-semibold mb-1">Number of Rooms</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.number_of_rooms}
                        onChange={(e) => setFormData({ ...formData, number_of_rooms: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Coordinator Notes */}
              <div>
                <label className="block text-gray-700 font-semibold mb-1">Coordinator Notes</label>
                <textarea
                  value={formData.coordinator_notes}
                  onChange={(e) => setFormData({ ...formData, coordinator_notes: e.target.value })}
                  rows={2}
                  placeholder="Notes, driver contact, bus boarding point..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Audit Trail Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowHistorySection(!showHistorySection)}
                  className="text-indigo-600 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <History size={12} />
                  <span>{showHistorySection ? 'Hide' : 'View'} Booking History</span>
                </button>

                {showHistorySection && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2 max-h-36 overflow-y-auto">
                    {auditHistory.length === 0 ? (
                      <p className="text-gray-400 text-center py-2">No past updates recorded yet.</p>
                    ) : (
                      auditHistory.map((h) => (
                        <div key={h.id} className="pb-2 border-b border-gray-200/60 last:border-0 last:pb-0">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-gray-800">
                              {h.action} → <span className="font-mono text-indigo-700">{h.new_status}</span>
                            </span>
                            <span className="text-gray-400 text-[10px]">
                              {new Date(h.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            By {h.changed_by_email || 'Coordinator'}: {h.notes || 'Status updated'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                disabled={submittingModal}
                onClick={() => setManageBookingModal(null)}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition"
              >
                Cancel
              </button>

              <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-2">
                {!formData.travel_required && !formData.accommodation_required && (
                  <button
                    type="button"
                    disabled={submittingModal}
                    onClick={() => handleSubmitBooking('NOT_REQUIRED')}
                    className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer border border-gray-200"
                  >
                    Mark Not Required
                  </button>
                )}

                <button
                  type="button"
                  disabled={submittingModal}
                  onClick={() => handleSubmitBooking('IN_PROGRESS')}
                  className="flex-1 sm:flex-initial px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer border border-indigo-200 flex items-center justify-center gap-1.5"
                >
                  <Save size={14} />
                  <span>Save as In Progress</span>
                </button>

                <button
                  type="button"
                  disabled={submittingModal}
                  onClick={() => handleSubmitBooking('COMPLETED')}
                  className="flex-1 sm:flex-initial px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submittingModal ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>Confirm &amp; Complete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL 1: SAFE INDIVIDUAL CHECKLIST DELETION CONFIRMATION
          ============================================================ */}
      {deleteSingleModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-gray-200 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Confirm Checklist Deletion</h3>
                  <p className="text-xs text-gray-500">Safeguards protect operational history and stock records</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteSingleModal(null)}
                disabled={deleteSingleModal.submitting}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Checklist Identification */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Checklist Number:</span>
                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                  {deleteSingleModal.checklist.checklist_number}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Client Name:</span>
                <span className="font-bold text-gray-900">{deleteSingleModal.checklist.client_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Current Status:</span>
                <span className="font-bold text-gray-800">{deleteSingleModal.checklist.installation_status || 'Assigned'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Assigned Engineer:</span>
                <span className="font-semibold text-gray-700">{deleteSingleModal.checklist.service_engineer || 'Unassigned'}</span>
              </div>
            </div>

            {/* Eligibility Checking Spinner */}
            {deleteSingleModal.checking ? (
              <div className="p-6 bg-gray-50 rounded-2xl text-center space-y-2 border border-gray-200">
                <div className="w-7 h-7 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-semibold text-gray-700">Validating operational dependencies...</p>
                <p className="text-[11px] text-gray-500">Checking completion reports, stock ledger, expenses, and travel bookings</p>
              </div>
            ) : deleteSingleModal.eligibility?.isEligible ? (
              /* Case A: Record is safe unprocessed draft */
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <span>Eligible for Permanent Deletion</span>
                </div>
                <p className="text-xs text-emerald-700">
                  This checklist is an unprocessed draft with no completion reports, stock movements, technician expenses, or arranged travel.
                  Any engineer reservation will be released immediately.
                </p>
              </div>
            ) : (
              /* Case B: Record has dependencies and is protected */
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-300 space-y-3">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                  <span>Permanent Deletion Blocked</span>
                </div>
                <p className="text-xs text-amber-800">
                  This checklist cannot be permanently deleted because it has active business records:
                </p>
                <ul className="list-disc list-inside text-xs text-amber-900 space-y-1 font-medium bg-amber-100/60 p-2.5 rounded-xl border border-amber-200">
                  {(deleteSingleModal.eligibility?.reasons || []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-700">
                  Completed business records and inventory accountability must be preserved.
                  You may <strong>Cancel the Checklist</strong> instead to release the engineer.
                </p>
              </div>
            )}

            {/* Error Message */}
            {deleteSingleModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{deleteSingleModal.error}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={deleteSingleModal.submitting}
                onClick={() => setDeleteSingleModal(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                {/* Cancellation Fallback Button if Protected */}
                {!deleteSingleModal.checking && !deleteSingleModal.eligibility?.isEligible && (
                  <button
                    type="button"
                    onClick={() => {
                      const chk = deleteSingleModal.checklist;
                      setDeleteSingleModal(null);
                      openCancelModal(chk);
                    }}
                    className="px-4 py-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Ban size={14} />
                    <span>Cancel Assignment Instead</span>
                  </button>
                )}

                {/* Permanent Delete Button if Eligible */}
                {!deleteSingleModal.checking && deleteSingleModal.eligibility?.isEligible && (
                  <button
                    type="button"
                    id="btn-confirm-delete-single"
                    disabled={deleteSingleModal.submitting}
                    onClick={handleConfirmDeleteSingle}
                    className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {deleteSingleModal.submitting ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    <span>Confirm Permanent Deletion</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL 2: SAFE DELETE ALL CHECKLISTS CONFIRMATION
          ============================================================ */}
      {deleteAllModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full border border-gray-200 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Delete All Checklists</h3>
                  <p className="text-xs text-gray-500">Safe batch deletion with dependency validation</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteAllModal(null)}
                disabled={deleteAllModal.submitting}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Loading Preview */}
            {deleteAllModal.loading ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-8 h-8 border-3 border-rose-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-bold text-gray-800">Evaluating database dependencies...</p>
                <p className="text-[11px] text-gray-500">
                  Analyzing all checklists for completion reports, stock ledger movements, and active bookings
                </p>
              </div>
            ) : deleteAllModal.result ? (
              /* Success / Result View */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>Batch Deletion Complete</span>
                  </div>
                  <p className="text-xs text-emerald-800">{deleteAllModal.result.message}</p>
                </div>

                <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="font-bold text-gray-500 text-[10px] uppercase">Evaluated</div>
                    <div className="text-lg font-black text-gray-900 mt-0.5">{deleteAllModal.result.totalProcessed}</div>
                  </div>
                  <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                    <div className="font-bold text-rose-700 text-[10px] uppercase">Deleted</div>
                    <div className="text-lg font-black text-rose-700 mt-0.5">{deleteAllModal.result.deletedCount}</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <div className="font-bold text-amber-800 text-[10px] uppercase">Protected</div>
                    <div className="text-lg font-black text-amber-800 mt-0.5">{deleteAllModal.result.skippedCount}</div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteAllModal(null)}
                    className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Confirmation & Breakdown View */
              <div className="space-y-4">
                {/* Metric Badges Breakdown */}
                <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200">
                    <div className="font-bold text-gray-500 text-[10px] uppercase">Total Checklists</div>
                    <div className="text-lg font-black text-gray-900 mt-0.5">{deleteAllModal.preview?.totalCount || 0}</div>
                  </div>
                  <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200">
                    <div className="font-bold text-rose-700 text-[10px] uppercase">Eligible Drafts</div>
                    <div className="text-lg font-black text-rose-700 mt-0.5">{deleteAllModal.preview?.eligibleCount || 0}</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                    <div className="font-bold text-amber-800 text-[10px] uppercase">Protected Records</div>
                    <div className="text-lg font-black text-amber-800 mt-0.5">{deleteAllModal.preview?.protectedCount || 0}</div>
                  </div>
                </div>

                {/* Explanation Banner */}
                <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 text-xs text-gray-600 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-gray-800">
                    <Info size={14} className="text-indigo-600 shrink-0" />
                    <span>Safeguards & Protection Policy</span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Active assignments, completed reports, inventory stock ledger transactions, expenses, and travel bookings
                    prevent permanent deletion to preserve operational history and stock accountability.
                    Only safe, unprocessed drafts will be deleted.
                  </p>
                </div>

                {/* Eligible vs Protected Details */}
                {deleteAllModal.preview?.eligibleCount > 0 ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-rose-900">
                        <span>Checklists to be Permanently Deleted ({deleteAllModal.preview.eligibleCount}):</span>
                      </div>
                      <div className="max-h-28 overflow-y-auto space-y-1 text-xs">
                        {deleteAllModal.preview.eligibleChecklists.map((c) => (
                          <div key={c.id} className="flex justify-between items-center bg-white p-1.5 px-2.5 rounded-lg border border-rose-100">
                            <span className="font-mono font-bold text-rose-700">{c.checklist_number}</span>
                            <span className="text-gray-700 truncate max-w-xs">{c.client_name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Explicit Count Confirmation Input */}
                    <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 text-xs">
                      <label className="font-bold text-gray-800 block">
                        Confirm Eligible Count:
                        <span className="text-gray-500 font-normal ml-1">
                          Type <strong className="text-rose-700 font-mono font-black">{deleteAllModal.preview.eligibleCount}</strong> below to confirm deletion.
                        </span>
                      </label>
                      <input
                        type="text"
                        id="input-confirm-count"
                        value={deleteAllModal.confirmedCountInput}
                        onChange={(e) =>
                          setDeleteAllModal((prev) => ({
                            ...prev,
                            confirmedCountInput: e.target.value.trim(),
                            error: '',
                          }))
                        }
                        placeholder={`Type ${deleteAllModal.preview.eligibleCount} to confirm`}
                        className="w-full p-2.5 border border-gray-300 rounded-xl focus:border-rose-500 focus:outline-hidden font-mono font-bold text-center text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-300 text-center space-y-1">
                    <AlertTriangle size={20} className="text-amber-600 mx-auto" />
                    <h4 className="text-xs font-bold text-amber-900">No Eligible Draft Checklists</h4>
                    <p className="text-[11px] text-amber-700">
                      All {deleteAllModal.preview?.totalCount || 0} checklist(s) are protected by operational history, stock records, or active assignments.
                    </p>
                  </div>
                )}

                {/* Error Banner */}
                {deleteAllModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    <span>{deleteAllModal.error}</span>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={deleteAllModal.submitting}
                    onClick={() => setDeleteAllModal(null)}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition"
                  >
                    Cancel
                  </button>

                  {deleteAllModal.preview?.eligibleCount > 0 && (
                    <button
                      type="button"
                      id="btn-confirm-delete-all"
                      disabled={
                        deleteAllModal.submitting ||
                        Number(deleteAllModal.confirmedCountInput) !== deleteAllModal.preview?.eligibleCount
                      }
                      onClick={handleConfirmDeleteAll}
                      className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {deleteAllModal.submitting ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      <span>Delete {deleteAllModal.preview?.eligibleCount} Eligible Checklists</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL 3: CANCEL CHECKLIST WORKFLOW FALLBACK
          ============================================================ */}
      {cancelChecklistModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full border border-gray-200 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Ban size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Cancel Checklist</h3>
                  <p className="text-xs text-gray-500">Releases engineer while preserving operational records</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancelChecklistModal(null)}
                disabled={cancelChecklistModal.submitting}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Checklist:</span>
                <span className="font-mono font-bold text-indigo-700">{cancelChecklistModal.checklist.checklist_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Client:</span>
                <span className="font-bold text-gray-900">{cancelChecklistModal.checklist.client_name}</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="font-bold text-gray-700 block">Cancellation Reason:</label>
              <textarea
                rows={2}
                value={cancelChecklistModal.reason}
                onChange={(e) =>
                  setCancelChecklistModal((prev) => ({ ...prev, reason: e.target.value }))
                }
                placeholder="Reason for cancelling this checklist..."
                className="w-full p-2.5 border border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            {cancelChecklistModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{cancelChecklistModal.error}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={cancelChecklistModal.submitting}
                onClick={() => setCancelChecklistModal(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition"
              >
                Back
              </button>
              <button
                type="button"
                id="btn-confirm-cancel-checklist"
                disabled={cancelChecklistModal.submitting}
                onClick={handleConfirmCancelChecklist}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {cancelChecklistModal.submitting ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Ban size={14} />
                )}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
