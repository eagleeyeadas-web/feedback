import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchCoordinatorBookings,
  saveCoordinatorBookingApi,
  fetchCoordinatorBookingHistory,
  extendCoordinatorRoomBookingApi,
  updateCoordinatorReturnTicketApi,
  fetchCoordinatorNotifications,
  markCoordinatorNotificationReadApi,
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
  deleteCoordinatorExtensionRequest,
  deleteAllCoordinatorExtensionRequests,
  deleteCoordinatorRestDayRequest,
  deleteAllCoordinatorRestDayRequests,
  deleteCoordinatorLeaveRequest,
  deleteAllCoordinatorLeaveRequests,
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
  Ticket,
  CalendarPlus,
  Paperclip,
  Bell,
  ArrowUpRight,
} from 'lucide-react';

const SERVICE_ENGINEER_OPTIONS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDateString(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  return dateObj.toISOString().split('T')[0];
}

function addDaysToDate(dateStr, days = 1) {
  const d = parseDateParts(dateStr);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + Number(days));
  return formatDateString(d);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return 'Not scheduled';
  const d = parseDateParts(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function CoordinatorWorkspace() {
  const { token, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Primary Workspace State
  const [activeTab, setActiveTab] = useState('outbound'); // 'outbound' | 'accommodation' | 'pending_returns' | 'confirmed_returns' | 'extension_reviews' | 'booking_issues' | 'history' | 'calendar'
  const [scheduleSubTab, setScheduleSubTab] = useState('approvals'); // 'approvals' | 'calendar' | 'conflicts' | 'affected'
  const [checklists, setChecklists] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    in_progress: 0,
    completed: 0,
    not_required: 0,
    total: 0,
    return_ticket_required: 0,
    extension_required: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Schedule & Notifications State
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [restDayRequests, setRestDayRequests] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [scheduleConflicts, setScheduleConflicts] = useState([]);
  const [affectedBookings, setAffectedBookings] = useState([]);
  const [coordinatorNotifications, setCoordinatorNotifications] = useState([]);
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
  const [selectedTravelMethod, setSelectedTravelMethod] = useState('ALL');
  const [selectedRoomMethod, setSelectedRoomMethod] = useState('ALL');
  const [selectedOutboundStatus, setSelectedOutboundStatus] = useState('ALL');
  const [selectedAccommodationStatus, setSelectedAccommodationStatus] = useState('ALL');
  const [selectedReturnStatus, setSelectedReturnStatus] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState('');

  // Modal / Manage Booking State
  const [manageBookingModal, setManageBookingModal] = useState(null);
  const [modalActiveTab, setModalActiveTab] = useState('outbound'); // 'outbound' | 'accommodation' | 'extend_room' | 'return_ticket' | 'notes'
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [auditHistory, setAuditHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(false);

  // Safe Checklist Deletion States
  const [deleteSingleModal, setDeleteSingleModal] = useState(null); // { checklist, checking, eligibility, error, submitting }
  const [deleteAllModal, setDeleteAllModal] = useState(null); // { loading, preview, confirmedCountInput, error, submitting, result }
  const [cancelChecklistModal, setCancelChecklistModal] = useState(null); // { checklist, reason, submitting, error }

  const isAuthorizedCoordinator = true;

  // Booking Form State
  const [formData, setFormData] = useState({
    booking_status: 'IN_PROGRESS',

    // Section 1: Outbound Travel
    outbound_status: 'Required',
    outbound_mode: 'Bus',
    outbound_method: 'Government bus', // 'Government bus' | 'Private travels'
    outbound_operator: '',
    outbound_origin: '',
    outbound_destination: '',
    outbound_departure_datetime: '',
    outbound_boarding_point: '',
    outbound_arrival_location: '',
    outbound_estimated_arrival_time: '',
    outbound_fare: '',
    outbound_currency: 'INR',
    outbound_ticket_reference: '',
    outbound_attachment_url: '',
    outbound_attachment_name: '',
    outbound_notes: '',
    outbound_booked_by_name: '',
    travel_required: true,
    travel_type: 'Bus',
    departure_city: '',
    destination: '',
    travel_datetime: '',
    ticket_reference: '',
    travel_notes: '',

    // Section 2: Room Accommodation
    accommodation_status: 'Required',
    accommodation_type: 'Online booking', // 'Online booking' | 'Offline booking'
    hotel_name: '',
    hotel_platform: '',
    hotel_address: '',
    hotel_contact: '',
    check_in_date: '',
    check_out_date: '',
    initial_check_out_date: '',
    extra_nights: 0,
    number_of_rooms: 1,
    number_of_occupants: 1,
    price_per_night: '',
    total_cost: '',
    hotel_booking_reference: '',
    offline_contact_person: '',
    payment_status: 'Unpaid', // 'Unpaid' | 'Advance Paid' | 'Fully Paid' | 'Pay at Property'
    payment_method: '', // 'Cash' | 'UPI' | 'Bank Transfer' | 'Company Card' | 'Other'
    offline_notes: '',
    accommodation_attachment_url: '',
    accommodation_attachment_name: '',
    accommodation_notes: '',
    accommodation_history: [],
    accommodation_required: true,

    // Section 3: Room Extension Action Form
    extend_new_check_out_date: '',
    extend_extra_nights: 1,
    extend_reference_details: '',
    extend_notes: '',
    extend_attachment_url: '',
    extend_attachment_name: '',

    // Section 4: Return Ticket Booking
    return_task_id: '',
    return_status: 'Not Yet Required',
    return_mode: 'Bus',
    return_method: 'Government bus', // 'Government bus' | 'Private travels'
    return_operator: '',
    return_departure_datetime: '',
    return_origin: '',
    return_destination: '',
    return_boarding_point: '',
    return_arrival_location: '',
    return_estimated_arrival_time: '',
    return_fare: '',
    return_currency: 'INR',
    return_ticket_reference: '',
    return_attachment_url: '',
    return_attachment_name: '',
    return_urgency: 'Normal',
    return_notes: '',
    return_task_created: false,
    return_task_completed: false,
    actual_completion_datetime: '',
    report_submission_datetime: '',

    // Section 5: Personnel & Coordinator Notes
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
        tab: 'all',
        search: searchTerm,
        engineer: selectedEngineer,
        status: selectedStatus,
        travelMethod: selectedTravelMethod,
        roomMethod: selectedRoomMethod,
        outboundStatus: selectedOutboundStatus,
        accommodationStatus: selectedAccommodationStatus,
        returnStatus: selectedReturnStatus,
        date: selectedDate,
        limit: 150,
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
  }, [
    token,
    searchTerm,
    selectedEngineer,
    selectedStatus,
    selectedTravelMethod,
    selectedRoomMethod,
    selectedOutboundStatus,
    selectedAccommodationStatus,
    selectedReturnStatus,
    selectedDate,
  ]);

  // Load Schedule & Availability Data + Notifications
  const loadScheduleData = useCallback(async () => {
    if (!token) return;
    setLoadingSchedule(true);
    try {
      const [extRes, restRes, leaveRes, confRes, affRes, notifRes] = await Promise.all([
        fetchCoordinatorExtensionRequests(token, { status: 'ALL' }).catch(() => ({ requests: [] })),
        fetchCoordinatorRestDayRequests(token, { status: 'ALL' }).catch(() => ({ rest_days: [] })),
        fetchCoordinatorLeaveRequests(token, { status: 'ALL' }).catch(() => ({ leaves: [] })),
        fetchCoordinatorScheduleConflicts(token).catch(() => ({ conflicts: [] })),
        fetchCoordinatorAffectedBookings(token).catch(() => ({ affected_bookings: [] })),
        fetchCoordinatorNotifications(token).catch(() => ({ notifications: [] })),
      ]);

      setExtensionRequests(extRes.requests || []);
      setRestDayRequests(restRes.rest_days || []);
      setLeaveRequests(leaveRes.leaves || []);
      setScheduleConflicts(confRes.conflicts || []);
      setAffectedBookings(affRes.affected_bookings || []);
      setCoordinatorNotifications(notifRes.notifications || []);
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

  // Availability-date extensions are governed exclusively by HR
  const pendingApprovalsCount = pendingRest.length + pendingLeaves.length;

  // Auto-open modal if navigated from notification link (e.g. /coordinator?view=xyz&action=return_ticket)
  useEffect(() => {
    const viewId = searchParams.get('view');
    const action = searchParams.get('action');
    if (viewId && checklists.length > 0 && !manageBookingModal) {
      const target = checklists.find((c) => c.id === viewId);
      if (target) {
        const initialTab = action === 'return_ticket' ? 'return_ticket' : (action === 'extend_room' ? 'extend_room' : 'outbound');
        openManageModal(target, initialTab);
      }
    }
  }, [searchParams, checklists, manageBookingModal]);

  // Specific tasks requiring Coordinator attention
  const returnTicketTasks = useMemo(
    () => checklists.filter((chk) => chk.coordinator_booking?.return_status === 'Booking Required'),
    [checklists]
  );
  const roomExtensionTasks = useMemo(
    () => checklists.filter((chk) => chk.coordinator_booking?.accommodation_status === 'Extension Required'),
    [checklists]
  );

  // Section 1: Outbound Travel
  const outboundList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      if (selectedTravelMethod !== 'ALL' && b.outbound_method !== selectedTravelMethod) return false;
      return true;
    });
  }, [checklists, selectedTravelMethod]);

  // Section 2: Room Bookings
  const accommodationList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      if (selectedRoomMethod !== 'ALL' && b.accommodation_type !== selectedRoomMethod) return false;
      return true;
    });
  }, [checklists, selectedRoomMethod]);

  // Section 3: Pending Return Tickets (Sorted by Urgency: Overdue -> Urgent -> Approaching -> Normal, then date)
  const pendingReturnsList = useMemo(() => {
    const list = checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      const st = b.return_status;
      return (
        st === 'Booking Required' ||
        st === 'In Progress' ||
        st === 'Booking Issue' ||
        (chk.actual_completion_datetime && st !== 'Confirmed' && st !== 'Cancelled')
      );
    });
    const urgencyWeight = { Overdue: 4, Urgent: 3, Approaching: 2, Normal: 1 };
    return [...list].sort((a, b) => {
      const uA = urgencyWeight[a.coordinator_booking?.return_urgency] || 1;
      const uB = urgencyWeight[b.coordinator_booking?.return_urgency] || 1;
      if (uB !== uA) return uB - uA;
      const tA = new Date(a.actual_completion_datetime || a.created_at).getTime();
      const tB = new Date(b.actual_completion_datetime || b.created_at).getTime();
      return tB - tA;
    });
  }, [checklists]);

  // Section 4: Confirmed Return Tickets
  const confirmedReturnsList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      return b.return_status === 'Confirmed';
    });
  }, [checklists]);

  // Section 5: Extension-Related Booking Reviews (Approved extensions requiring room/travel logistics adjustments)
  const extensionReviewsList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      return (
        b.accommodation_status === 'Extension Required' ||
        b.schedule_flagged_for_review === true ||
        extensionRequests.some((e) => e.checklist_id === chk.id && e.status === 'APPROVED')
      );
    });
  }, [checklists, extensionRequests]);

  // Section 6: Booking Issues
  const bookingIssuesList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      return (
        b.booking_status === 'BOOKING_ISSUE' ||
        b.return_status === 'Booking Issue' ||
        b.outbound_status === 'Cancelled' ||
        Boolean(b.booking_issue_reason)
      );
    });
  }, [checklists]);

  // Section 7: Travel and Accommodation History
  const historyList = useMemo(() => {
    return checklists.filter((chk) => {
      const b = chk.coordinator_booking || {};
      return (
        b.booking_status === 'COMPLETED' ||
        b.booking_status === 'NOT_REQUIRED' ||
        (b.outbound_status === 'Confirmed' && b.accommodation_status === 'Confirmed')
      );
    });
  }, [checklists]);

  // Current active section items
  const currentSectionList = useMemo(() => {
    switch (activeTab) {
      case 'outbound':
        return outboundList;
      case 'accommodation':
        return accommodationList;
      case 'pending_returns':
        return pendingReturnsList;
      case 'confirmed_returns':
        return confirmedReturnsList;
      case 'extension_reviews':
        return extensionReviewsList;
      case 'booking_issues':
        return bookingIssuesList;
      case 'history':
        return historyList;
      default:
        return checklists;
    }
  }, [activeTab, outboundList, accommodationList, pendingReturnsList, confirmedReturnsList, extensionReviewsList, bookingIssuesList, historyList, checklists]);

  // Deletion Handlers for Coordinator Requests (Test/History Cleanup)
  const handleDeleteExtensionRequest = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete this availability date request for ${name || 'technician'}?`)) {
      return;
    }
    try {
      await deleteCoordinatorExtensionRequest(token, id);
      showToast('Availability date request deleted successfully');
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to delete request');
    }
  };

  const handleDeleteAllExtensionRequests = async () => {
    const total = extensionRequests.length;
    if (!window.confirm(`Are you sure you want to delete all ${total} availability date request(s)? This will clear testing and development requests.`)) {
      return;
    }
    try {
      const res = await deleteAllCoordinatorExtensionRequests(token);
      showToast(`Cleared ${res.deletedCount || total} availability date request(s)`);
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to clear extension requests');
    }
  };

  const handleDeleteRestDayRequest = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete this rest day request for ${name || 'technician'}?`)) {
      return;
    }
    try {
      await deleteCoordinatorRestDayRequest(token, id);
      showToast('Rest day request deleted successfully');
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to delete rest day request');
    }
  };

  const handleDeleteAllRestDayRequests = async () => {
    const total = restDayRequests.length;
    if (!window.confirm(`Are you sure you want to delete all ${total} rest day request(s)? This will clear testing and development requests.`)) {
      return;
    }
    try {
      const res = await deleteAllCoordinatorRestDayRequests(token);
      showToast(`Cleared ${res.deletedCount || total} rest day request(s)`);
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to clear rest day requests');
    }
  };

  const handleDeleteLeaveRequest = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete this leave request for ${name || 'technician'}?`)) {
      return;
    }
    try {
      await deleteCoordinatorLeaveRequest(token, id);
      showToast('Leave request deleted successfully');
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to delete leave request');
    }
  };

  const handleDeleteAllLeaveRequests = async () => {
    const total = leaveRequests.length;
    if (!window.confirm(`Are you sure you want to delete all ${total} leave request(s)? This will clear testing and development requests.`)) {
      return;
    }
    try {
      const res = await deleteAllCoordinatorLeaveRequests(token);
      showToast(`Cleared ${res.deletedCount || total} leave request(s)`);
      loadScheduleData();
    } catch (err) {
      showToast(err.message || 'Failed to clear leave requests');
    }
  };

  // Open Manage Booking Modal with optional initial active tab
  const openManageModal = async (chk, initialTab = 'outbound') => {
    setManageBookingModal(chk);
    setModalActiveTab(initialTab);
    setModalError('');
    setShowHistorySection(false);

    const b = chk.coordinator_booking || {};

    let formattedOutboundDatetime = '';
    const outTime = b.outbound_departure_datetime || b.travel_datetime;
    if (outTime) {
      const d = new Date(outTime);
      if (!isNaN(d.getTime())) {
        formattedOutboundDatetime = d.toISOString().slice(0, 16);
      }
    } else if (chk.expected_arrival_date) {
      const timeStr = chk.expected_arrival_time || '08:00';
      formattedOutboundDatetime = `${chk.expected_arrival_date}T${timeStr.slice(0, 5)}`;
    }

    let formattedReturnDatetime = '';
    if (b.return_departure_datetime) {
      const d = new Date(b.return_departure_datetime);
      if (!isNaN(d.getTime())) {
        formattedReturnDatetime = d.toISOString().slice(0, 16);
      }
    } else if (chk.actual_completion_datetime) {
      const d = new Date(chk.actual_completion_datetime);
      if (!isNaN(d.getTime())) {
        formattedReturnDatetime = d.toISOString().slice(0, 16);
      }
    }

    const checkIn = b.check_in_date || chk.current_expected_arrival_date || chk.expected_arrival_date || '';
    const checkOut = b.check_out_date || chk.current_booking_end_date || chk.booking_end_date || checkIn;
    const initialCheckOut = b.initial_check_out_date || checkOut;

    const proposedCheckOut = chk.current_booking_end_date && chk.current_booking_end_date !== checkOut
      ? chk.current_booking_end_date
      : addDaysToDate(checkOut, 1);

    setFormData({
      booking_status: b.booking_status && b.booking_status !== 'PENDING' ? b.booking_status : 'IN_PROGRESS',

      // Outbound
      outbound_status: b.outbound_status || (b.travel_required ? 'Pending' : 'Required'),
      outbound_mode: b.outbound_mode || b.travel_type || 'Bus',
      outbound_method: b.outbound_method || 'Government bus',
      outbound_operator: b.outbound_operator || '',
      outbound_origin: b.outbound_origin || b.departure_city || 'Chennai',
      outbound_destination: b.outbound_destination || b.destination || chk.client_location || '',
      outbound_departure_datetime: formattedOutboundDatetime,
      outbound_boarding_point: b.outbound_boarding_point || '',
      outbound_arrival_location: b.outbound_arrival_location || chk.client_location || '',
      outbound_estimated_arrival_time: b.outbound_estimated_arrival_time || '',
      outbound_fare: b.outbound_fare || '',
      outbound_currency: b.outbound_currency || 'INR',
      outbound_ticket_reference: b.outbound_ticket_reference || b.ticket_reference || '',
      outbound_attachment_url: b.outbound_attachment_url || '',
      outbound_attachment_name: b.outbound_attachment_name || '',
      outbound_notes: b.outbound_notes || b.travel_notes || '',
      outbound_booked_by_name: b.outbound_booked_by_name || '',
      travel_required: b.outbound_status !== 'Cancelled',
      travel_type: b.outbound_mode || b.travel_type || 'Bus',
      departure_city: b.outbound_origin || b.departure_city || 'Chennai',
      destination: b.outbound_destination || b.destination || chk.client_location || '',
      travel_datetime: formattedOutboundDatetime,
      ticket_reference: b.outbound_ticket_reference || b.ticket_reference || '',
      travel_notes: b.travel_notes || '',

      // Accommodation
      accommodation_status: b.accommodation_status || 'Required',
      accommodation_type: b.accommodation_type || 'Online booking',
      hotel_name: b.hotel_name || '',
      hotel_platform: b.hotel_platform || '',
      hotel_address: b.hotel_address || '',
      hotel_contact: b.hotel_contact || '',
      check_in_date: checkIn,
      check_out_date: checkOut,
      initial_check_out_date: initialCheckOut,
      extra_nights: b.extra_nights || 0,
      number_of_rooms: b.number_of_rooms || 1,
      number_of_occupants: b.number_of_occupants || 1,
      price_per_night: b.price_per_night || '',
      total_cost: b.total_cost || '',
      hotel_booking_reference: b.hotel_booking_reference || '',
      offline_contact_person: b.offline_contact_person || '',
      payment_status: b.payment_status || 'Unpaid',
      payment_method: b.payment_method || '',
      offline_notes: b.offline_notes || '',
      accommodation_attachment_url: b.accommodation_attachment_url || '',
      accommodation_attachment_name: b.accommodation_attachment_name || '',
      accommodation_notes: b.accommodation_notes || '',
      accommodation_history: Array.isArray(b.accommodation_history) ? b.accommodation_history : [],
      accommodation_required: b.accommodation_status !== 'Cancelled',

      // Room Extension Action
      extend_new_check_out_date: proposedCheckOut,
      extend_extra_nights: 1,
      extend_reference_details: '',
      extend_notes: '',
      extend_attachment_url: '',
      extend_attachment_name: '',

      // Return Ticket
      return_task_id: b.return_task_id || '',
      return_status: b.return_status || (chk.installation_status === 'Completed' || chk.actual_completion_datetime ? 'Booking Required' : 'Not Yet Required'),
      return_mode: b.return_mode || 'Bus',
      return_method: b.return_method || 'Government bus',
      return_operator: b.return_operator || '',
      return_departure_datetime: formattedReturnDatetime,
      return_origin: b.return_origin || chk.client_location || '',
      return_destination: b.return_destination || b.outbound_origin || 'Chennai',
      return_boarding_point: b.return_boarding_point || '',
      return_arrival_location: b.return_arrival_location || b.outbound_origin || 'Chennai',
      return_estimated_arrival_time: b.return_estimated_arrival_time || '',
      return_fare: b.return_fare || '',
      return_currency: b.return_currency || 'INR',
      return_ticket_reference: b.return_ticket_reference || '',
      return_attachment_url: b.return_attachment_url || '',
      return_attachment_name: b.return_attachment_name || '',
      return_urgency: b.return_urgency || 'Normal',
      return_notes: b.return_notes || '',
      return_task_created: Boolean(b.return_task_created),
      return_task_completed: Boolean(b.return_task_completed),
      actual_completion_datetime: b.actual_completion_datetime || chk.actual_completion_datetime || '',
      report_submission_datetime: b.report_submission_datetime || '',

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

  // Submit General Booking Updates
  const handleSubmitBooking = async (targetStatus = null) => {
    if (!manageBookingModal) return;
    setModalError('');

    // Validation: Outbound confirmation details
    if (formData.outbound_status === 'Confirmed' && !formData.outbound_ticket_reference && !formData.outbound_attachment_url) {
      setModalError('Cannot mark Outbound Travel as Confirmed without a ticket reference/PNR or receipt attachment.');
      return;
    }

    // Validation: Accommodation confirmation details
    if (formData.accommodation_status === 'Confirmed') {
      if (formData.accommodation_type === 'Online booking' && !formData.hotel_booking_reference && !formData.accommodation_attachment_url) {
        setModalError('Online room booking requires a booking confirmation number or receipt attachment to confirm.');
        return;
      }
      if (formData.accommodation_type === 'Offline booking' && !formData.hotel_name) {
        setModalError('Please specify the accommodation/hotel name for the offline booking.');
        return;
      }
    }

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

  // Submit Extension of Room Booking
  const handleExtendRoomSubmit = async () => {
    if (!manageBookingModal) return;
    if (!formData.extend_new_check_out_date) {
      setModalError('Please specify the revised checkout date for the room extension.');
      return;
    }
    setModalError('');
    setSubmittingModal(true);

    try {
      await extendCoordinatorRoomBookingApi(token, manageBookingModal.id, {
        new_check_out_date: formData.extend_new_check_out_date,
        extra_nights: formData.extend_extra_nights,
        reference_details: formData.extend_reference_details,
        notes: formData.extend_notes,
        attachment_url: formData.extend_attachment_url,
        attachment_name: formData.extend_attachment_name,
      });

      showToast(`Room booking extended to ${formData.extend_new_check_out_date} successfully!`);
      setManageBookingModal(null);
      await loadBookings(true);
      await loadScheduleData();
    } catch (err) {
      console.error('Failed to extend room booking:', err);
      setModalError(err.message || 'Failed to extend room booking');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Submit Return Ticket Booking
  const handleReturnTicketSubmit = async (isConfirm = false) => {
    if (!manageBookingModal) return;
    setModalError('');

    if (isConfirm && !formData.return_ticket_reference && !formData.return_attachment_url) {
      setModalError('Cannot mark Return Ticket as Confirmed without recording the ticket reference/PNR or attaching a receipt.');
      return;
    }

    setSubmittingModal(true);

    try {
      const targetStatus = isConfirm ? 'Confirmed' : (formData.return_ticket_reference ? 'Confirmed' : formData.return_status || 'In Progress');
      await updateCoordinatorReturnTicketApi(token, manageBookingModal.id, {
        return_method: formData.return_method,
        return_operator: formData.return_operator,
        return_departure_datetime: formData.return_departure_datetime,
        return_origin: formData.return_origin,
        return_destination: formData.return_destination,
        return_boarding_point: formData.return_boarding_point,
        return_arrival_location: formData.return_arrival_location,
        return_estimated_arrival_time: formData.return_estimated_arrival_time,
        return_fare: formData.return_fare,
        return_currency: formData.return_currency,
        return_ticket_reference: formData.return_ticket_reference,
        return_status: targetStatus,
        return_attachment_url: formData.return_attachment_url,
        return_attachment_name: formData.return_attachment_name,
        return_notes: formData.return_notes,
      });

      showToast(isConfirm || targetStatus === 'Confirmed' ? 'Return ticket confirmed successfully!' : 'Return ticket details saved.');
      setManageBookingModal(null);
      await loadBookings(true);
      await loadScheduleData();
    } catch (err) {
      console.error('Failed to update return ticket:', err);
      setModalError(err.message || 'Failed to update return ticket');
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <AlertCircle size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Pending Logistics</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.pending}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shrink-0">
            <CalendarPlus size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider block">Room Extension Req</span>
            <span className="text-xl font-black text-purple-800 mt-0.5 block">{roomExtensionTasks.length}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
            <Ticket size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">Return Ticket Req</span>
            <span className="text-xl font-black text-amber-900 mt-0.5 block">{returnTicketTasks.length}</span>
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

      {/* Action Required: Return Ticket Booking Banner */}
      {returnTicketTasks.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-l-4 border-amber-500 p-4 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Ticket size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-black text-gray-900">
                  Installation completed — return ticket booking required
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-200 text-amber-900">
                  {returnTicketTasks.length} {returnTicketTasks.length === 1 ? 'Job' : 'Jobs'}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                Technician completed installation checklist. Book the return ticket manually based on actual completion date and travel requirements.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {returnTicketTasks.slice(0, 3).map((chk) => (
                  <button
                    key={chk.id}
                    type="button"
                    onClick={() => openManageModal(chk, 'return_ticket')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-900 transition cursor-pointer"
                  >
                    <span>{chk.checklist_number}</span>
                    <span className="text-amber-600">({chk.service_engineer})</span>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
                {returnTicketTasks.length > 3 && (
                  <span className="text-xs text-gray-500 self-center">
                    +{returnTicketTasks.length - 3} more
                  </span>
                )}
              </div>
            </div>
          </div>
          {returnTicketTasks[0] && (
            <button
              type="button"
              onClick={() => openManageModal(returnTicketTasks[0], 'return_ticket')}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Ticket size={14} />
              <span>Book Return Ticket</span>
            </button>
          )}
        </div>
      )}

      {/* Action Required: Room Extension Needed Banner */}
      {roomExtensionTasks.length > 0 && (
        <div className="bg-gradient-to-r from-purple-500/10 via-purple-500/5 to-transparent border-l-4 border-purple-600 p-4 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center shrink-0">
              <CalendarPlus size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-black text-gray-900">
                  Approved Schedule Extension — Room Extension Required
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-purple-200 text-purple-900">
                  {roomExtensionTasks.length} {roomExtensionTasks.length === 1 ? 'Room' : 'Rooms'}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                Schedule extension was approved. Confirm extra nights with hotel provider, update room checkout date, and attach updated confirmation.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {roomExtensionTasks.slice(0, 3).map((chk) => (
                  <button
                    key={chk.id}
                    type="button"
                    onClick={() => openManageModal(chk, 'extend_room')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-300 text-[11px] font-bold text-purple-900 transition cursor-pointer"
                  >
                    <span>{chk.checklist_number}</span>
                    <span className="text-purple-600">Checkout: {chk.coordinator_booking?.check_out_date || 'N/A'}</span>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
                {roomExtensionTasks.length > 3 && (
                  <span className="text-xs text-gray-500 self-center">
                    +{roomExtensionTasks.length - 3} more
                  </span>
                )}
              </div>
            </div>
          </div>
          {roomExtensionTasks[0] && (
            <button
              type="button"
              onClick={() => openManageModal(roomExtensionTasks[0], 'extend_room')}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <CalendarPlus size={14} />
              <span>Extend Room Booking</span>
            </button>
          )}
        </div>
      )}

      {/* Main Navigation Tabs - 8 Dedicated Workflow Sections */}
      <div className="flex border-b border-gray-200 overflow-x-auto gap-1 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('outbound')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'outbound'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Bus size={15} className="text-purple-600" />
          <span>1. Outbound Travel</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-purple-100 text-purple-800">
            {outboundList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('accommodation')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'accommodation'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Hotel size={15} className="text-blue-600" />
          <span>2. Room Bookings</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-blue-100 text-blue-800">
            {accommodationList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pending_returns')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'pending_returns'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Clock size={15} className="text-amber-600" />
          <span>3. Pending Return Tickets</span>
          {pendingReturnsList.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-100 text-amber-800 animate-pulse">
              {pendingReturnsList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('confirmed_returns')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'confirmed_returns'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <CheckCircle2 size={15} className="text-emerald-600" />
          <span>4. Confirmed Return Tickets</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-emerald-100 text-emerald-800">
            {confirmedReturnsList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('extension_reviews')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'extension_reviews'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <CalendarPlus size={15} className="text-purple-600" />
          <span>5. Extension Reviews</span>
          {extensionReviewsList.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-100 text-rose-800">
              {extensionReviewsList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('booking_issues')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'booking_issues'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <AlertTriangle size={15} className="text-rose-600" />
          <span>6. Booking Issues</span>
          {bookingIssuesList.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-100 text-rose-800">
              {bookingIssuesList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <History size={15} className="text-gray-600" />
          <span>7. Booking History</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-gray-100 text-gray-700">
            {historyList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`py-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'calendar'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Calendar size={15} className="text-indigo-600" />
          <span>8. Technician Calendar</span>
          {pendingApprovalsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-100 text-rose-800 animate-pulse">
              {pendingApprovalsCount}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================
          CARD WORKFLOW SECTIONS 1 - 7
          ============================================================ */}
      {activeTab !== 'calendar' && (
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

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                id="btn-delete-all-checklists"
                onClick={openDeleteAllModal}
                disabled={loading || refreshing}
                className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 border border-rose-300 rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Delete all eligible draft/test checklists safely"
              >
                <Trash2 size={14} className="text-rose-600" />
                <span>Delete All / Clean Test Jobs</span>
              </button>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs space-y-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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
                  <option value="ALL">All Overall Statuses</option>
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

            {/* Workflow 3-Status Filter Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-500 shrink-0 text-[11px] flex items-center gap-1">
                  <Bus size={12} className="text-purple-600" />
                  <span>Outbound:</span>
                </span>
                <select
                  value={selectedOutboundStatus}
                  onChange={(e) => setSelectedOutboundStatus(e.target.value)}
                  className="w-full p-1.5 border border-purple-200 rounded-xl focus:outline-hidden focus:border-purple-500 font-semibold text-gray-700 bg-purple-50/30 cursor-pointer text-[11px]"
                >
                  <option value="ALL">All Outbound Statuses</option>
                  <option value="Required">Required</option>
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-500 shrink-0 text-[11px] flex items-center gap-1">
                  <Hotel size={12} className="text-blue-600" />
                  <span>Room:</span>
                </span>
                <select
                  value={selectedAccommodationStatus}
                  onChange={(e) => setSelectedAccommodationStatus(e.target.value)}
                  className="w-full p-1.5 border border-blue-200 rounded-xl focus:outline-hidden focus:border-blue-500 font-semibold text-gray-700 bg-blue-50/30 cursor-pointer text-[11px]"
                >
                  <option value="ALL">All Room Statuses</option>
                  <option value="Required">Required</option>
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Extension Required">Extension Required</option>
                  <option value="Extension Pending">Extension Pending</option>
                  <option value="Extended">Extended</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-500 shrink-0 text-[11px] flex items-center gap-1">
                  <Ticket size={12} className="text-amber-600" />
                  <span>Return:</span>
                </span>
                <select
                  value={selectedReturnStatus}
                  onChange={(e) => setSelectedReturnStatus(e.target.value)}
                  className="w-full p-1.5 border border-amber-200 rounded-xl focus:outline-hidden focus:border-amber-500 font-semibold text-gray-700 bg-amber-50/30 cursor-pointer text-[11px]"
                >
                  <option value="ALL">All Return Statuses</option>
                  <option value="Not Yet Required">Not Yet Required</option>
                  <option value="Booking Required">Booking Required</option>
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {/* Travel Method & Room Booking Method Selection Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-500 shrink-0 text-[11px] flex items-center gap-1">
                  <Bus size={12} className="text-purple-600" />
                  <span>Travel Method:</span>
                </span>
                <select
                  value={selectedTravelMethod}
                  onChange={(e) => setSelectedTravelMethod(e.target.value)}
                  className="w-full p-1.5 border border-purple-200 rounded-xl focus:outline-hidden focus:border-purple-500 font-semibold text-gray-700 bg-purple-50/20 cursor-pointer text-[11px]"
                >
                  <option value="ALL">All Travel Methods</option>
                  <option value="Government bus">Government bus</option>
                  <option value="Private travels">Private travels</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-500 shrink-0 text-[11px] flex items-center gap-1">
                  <Hotel size={12} className="text-blue-600" />
                  <span>Room Method:</span>
                </span>
                <select
                  value={selectedRoomMethod}
                  onChange={(e) => setSelectedRoomMethod(e.target.value)}
                  className="w-full p-1.5 border border-blue-200 rounded-xl focus:outline-hidden focus:border-blue-500 font-semibold text-gray-700 bg-blue-50/20 cursor-pointer text-[11px]"
                >
                  <option value="ALL">All Room Booking Methods</option>
                  <option value="Online booking">Online booking</option>
                  <option value="Offline booking">Offline booking</option>
                </select>
              </div>
            </div>
          </div>

          {/* Booking Cards Grid */}
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <span className="text-xs text-gray-500 font-medium">Loading checklists and booking records...</span>
            </div>
          ) : currentSectionList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs space-y-2">
              <CalendarCheck className="w-10 h-10 text-gray-300 mx-auto" />
              <h3 className="text-sm font-bold text-gray-800">
                {activeTab === 'outbound' ? 'No outbound travel tasks match filters' :
                 activeTab === 'accommodation' ? 'No room bookings match filters' :
                 activeTab === 'pending_returns' ? 'No pending return tickets' :
                 activeTab === 'confirmed_returns' ? 'No confirmed return tickets' :
                 activeTab === 'extension_reviews' ? 'No extension reviews pending' :
                 activeTab === 'booking_issues' ? 'No booking issues reported' :
                 activeTab === 'history' ? 'No historical bookings found' :
                 'No checklists found'}
              </h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                {activeTab === 'pending_returns'
                  ? 'Return ticket tasks are automatically created when the technician submits the Post-Installation Form.'
                  : 'Adjust filters or search parameters above to locate specific bookings.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentSectionList.map((chk) => {
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

                    {/* Travel & Accommodation 3-Workflow Section */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {/* 1. Outbound Ticket */}
                      <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/20 space-y-1.5 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1 font-bold text-gray-800 text-[11px]">
                              <Bus size={13} className="text-purple-600 shrink-0" />
                              <span>Outbound</span>
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                (b.outbound_status || 'Required') === 'Confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (b.outbound_status || 'Required') === 'Pending'
                                  ? 'bg-amber-100 text-amber-800'
                                  : (b.outbound_status || 'Required') === 'Cancelled'
                                  ? 'bg-gray-100 text-gray-600'
                                  : 'bg-purple-100 text-purple-800'
                              }`}
                            >
                              {b.outbound_status || 'Required'}
                            </span>
                          </div>
                          {b.outbound_status === 'Cancelled' ? (
                            <p className="text-[11px] text-gray-400 italic mt-1">Travel not required / cancelled</p>
                          ) : (
                            <div className="text-[11px] text-gray-600 space-y-0.5 mt-1">
                              <div className="font-semibold text-gray-900 truncate">
                                {b.outbound_origin || b.departure_city || 'City'} → {b.outbound_destination || b.destination || 'Site'}
                              </div>
                              <div className="text-gray-500 text-[10px]">
                                {b.outbound_mode || b.travel_type || 'Bus'}
                                {(b.outbound_departure_datetime || b.travel_datetime) && (
                                  <span> • {new Date(b.outbound_departure_datetime || b.travel_datetime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                )}
                              </div>
                              {(b.outbound_ticket_reference || b.ticket_reference) && (
                                <div className="font-mono text-purple-700 text-[10px]">
                                  Ref: {b.outbound_ticket_reference || b.ticket_reference}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 2. Room Accommodation */}
                      <div className={`p-2.5 rounded-xl border flex flex-col justify-between space-y-1.5 ${
                        b.accommodation_status === 'Extension Required'
                          ? 'border-purple-300 bg-purple-50/50 ring-1 ring-purple-300'
                          : 'border-blue-200/80 bg-blue-50/20'
                      }`}>
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1 font-bold text-gray-800 text-[11px]">
                              <Hotel size={13} className="text-blue-600 shrink-0" />
                              <span>Room</span>
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                b.accommodation_status === 'Extension Required'
                                  ? 'bg-rose-100 text-rose-800 animate-pulse border border-rose-300'
                                  : b.accommodation_status === 'Extended'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : (b.accommodation_status || 'Required') === 'Confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (b.accommodation_status || 'Required') === 'Pending'
                                  ? 'bg-amber-100 text-amber-800'
                                  : (b.accommodation_status || 'Required') === 'Cancelled'
                                  ? 'bg-gray-100 text-gray-600'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {b.accommodation_status || 'Required'}
                            </span>
                          </div>
                          {b.accommodation_status === 'Cancelled' ? (
                            <p className="text-[11px] text-gray-400 italic mt-1">Room not required</p>
                          ) : (
                            <div className="text-[11px] text-gray-600 space-y-0.5 mt-1">
                              <div className="font-semibold text-gray-900 truncate">
                                {b.hotel_name || 'Hotel / Provider'}
                              </div>
                              <div className="text-[10px] text-indigo-700 font-bold flex items-center gap-1 bg-indigo-50/80 px-1 py-0.5 rounded">
                                <Calendar size={10} className="shrink-0" />
                                <span>Checkout: {b.check_out_date || chk.booking_end_date || 'Not recorded'}</span>
                              </div>
                              {b.extra_nights > 0 && (
                                <div className="text-[10px] font-bold text-purple-700">
                                  +{b.extra_nights} extra night(s)
                                </div>
                              )}
                              {b.hotel_booking_reference && (
                                <div className="font-mono text-blue-700 text-[10px] truncate">
                                  Ref: {b.hotel_booking_reference}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 3. Return Ticket */}
                      <div className={`p-2.5 rounded-xl border flex flex-col justify-between space-y-1.5 ${
                        (b.return_status || 'Not Yet Required') === 'Booking Required'
                          ? 'border-amber-400 bg-amber-50/40 ring-1 ring-amber-300'
                          : 'border-gray-200 bg-gray-50/30'
                      }`}>
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1 font-bold text-gray-800 text-[11px]">
                              <Ticket size={13} className="text-amber-600 shrink-0" />
                              <span>Return</span>
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                (b.return_status || 'Not Yet Required') === 'Booking Required'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse'
                                  : (b.return_status || 'Not Yet Required') === 'Confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (b.return_status || 'Not Yet Required') === 'Pending'
                                  ? 'bg-blue-100 text-blue-800'
                                  : (b.return_status || 'Not Yet Required') === 'Cancelled'
                                  ? 'bg-gray-100 text-gray-600'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {b.return_status || 'Not Yet Required'}
                            </span>
                          </div>
                          {(b.return_status || 'Not Yet Required') === 'Not Yet Required' ? (
                            <p className="text-[10px] text-gray-400 italic mt-1 leading-snug">
                              Awaiting Post-Installation submission
                            </p>
                          ) : (b.return_status || 'Not Yet Required') === 'Booking Required' ? (
                            <div className="mt-1 space-y-1">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold text-amber-900 leading-tight">
                                  Return booking required
                                </p>
                                {b.return_urgency && (
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                    b.return_urgency === 'Overdue'
                                      ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                                      : b.return_urgency === 'Urgent'
                                      ? 'bg-amber-200 text-amber-900 border border-amber-300'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    {b.return_urgency}
                                  </span>
                                )}
                              </div>
                              {chk.actual_completion_datetime && (
                                <p className="text-[9px] text-amber-800">
                                  <strong>Completed:</strong> {new Date(chk.actual_completion_datetime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </p>
                              )}
                              {(b.return_task_created_at || b.updated_at) && (
                                <p className="text-[9px] text-gray-500">
                                  <strong>Task Created:</strong> {new Date(b.return_task_created_at || b.updated_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => openManageModal(chk, 'return_ticket')}
                                className="mt-1 w-full py-1 px-2 text-[10px] font-bold text-amber-900 bg-amber-200/80 hover:bg-amber-300 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <Ticket size={11} />
                                <span>Book Return Ticket Now</span>
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-gray-600 space-y-0.5 mt-1">
                              <div className="font-semibold text-gray-900 truncate">
                                {b.return_origin || 'Site'} → {b.return_destination || 'Base'}
                              </div>
                              <div className="text-gray-500 text-[10px]">
                                {b.return_mode || 'Bus'}
                                {b.return_departure_datetime && (
                                  <span> • {new Date(b.return_departure_datetime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                )}
                              </div>
                              {b.return_ticket_reference && (
                                <div className="font-mono text-amber-800 text-[10px]">
                                  Ref: {b.return_ticket_reference}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        id={`btn-delete-checklist-${chk.id}`}
                        onClick={() => openDeleteSingleModal(chk)}
                        className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        title="Delete checklist safely"
                      >
                        <Trash2 size={13} />
                        <span>Delete</span>
                      </button>

                      <div className="flex items-center gap-1.5 ml-auto">
                        {b.accommodation_status === 'Extension Required' && (
                          <button
                            type="button"
                            onClick={() => openManageModal(chk, 'extend_room')}
                            className="px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-300 rounded-xl shadow-2xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <CalendarPlus size={13} />
                            <span>Extend Room</span>
                          </button>
                        )}

                        {b.return_status === 'Booking Required' && (
                          <button
                            type="button"
                            onClick={() => openManageModal(chk, 'return_ticket')}
                            className="px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xl shadow-2xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <Ticket size={13} />
                            <span>Book Return</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openManageModal(chk, 'outbound')}
                          className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <CalendarCheck size={14} />
                          <span>Manage Logistics</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          SECTION 8: TECHNICIAN AVAILABILITY CALENDAR & MANAGEMENT
          ============================================================ */}
      {(activeTab === 'calendar' || activeTab === 'schedule') && (
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
              {/* 1A. Notice: Availability Date Extensions Governed by HR */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-xs text-xs text-emerald-950 space-y-2">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Shield className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="text-sm font-black">Technician Extension Requests Governed by HR</span>
                </div>
                <p className="text-emerald-800 text-xs leading-relaxed">
                  Per the updated organization workflow, technician availability-date extension requests are submitted directly to and approved by <strong>HR</strong>.
                </p>
                <div className="bg-white/80 border border-emerald-100 rounded-xl p-3 text-[11px] text-gray-700 space-y-1">
                  <div className="font-semibold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Coordinator's Responsibilities Upon HR Approval:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-gray-600 pl-1">
                    <li>Review existing room booking and checkout date.</li>
                    <li>Determine whether additional nights are required.</li>
                    <li>Review outbound travel arrangements if necessary.</li>
                    <li>Update booking records and confirm attachments under <strong>Affected Travel/Room Bookings</strong>.</li>
                  </ul>
                </div>
              </div>

              {/* 1B. Rest Day Requests */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                      <Moon className="w-4 h-4 text-indigo-600" />
                      <span>Pending Rest-Day Requests ({pendingRest.length})</span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Technicians requested recovery rest days.
                    </p>
                  </div>
                  {isAuthorizedCoordinator && restDayRequests.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteAllRestDayRequests}
                      className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Delete all rest day requests (test/history cleanup)"
                    >
                      <Trash2 size={13} />
                      <span>Delete All Rest Days ({restDayRequests.length})</span>
                    </button>
                  )}
                </div>

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

                        <div className="flex items-center justify-between pt-1">
                          {isAuthorizedCoordinator && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRestDayRequest(r.id, r.engineer_name)}
                              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Delete this rest day request"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              type="button"
                              onClick={() => openDecisionModal('REST', 'REJECT', r)}
                              className="px-3.5 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition cursor-pointer"
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
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 1C. Leave Requests */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                      <CalendarOff className="w-4 h-4 text-rose-600" />
                      <span>Pending Leave Requests ({pendingLeaves.length})</span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Technicians applied for leave.
                    </p>
                  </div>
                  {isAuthorizedCoordinator && leaveRequests.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteAllLeaveRequests}
                      className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Delete all leave requests (test/history cleanup)"
                    >
                      <Trash2 size={13} />
                      <span>Delete All Leaves ({leaveRequests.length})</span>
                    </button>
                  )}
                </div>

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

                        <div className="flex items-center justify-between pt-1">
                          {isAuthorizedCoordinator && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLeaveRequest(l.id, l.engineer_name)}
                              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Delete this leave request"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              type="button"
                              onClick={() => openDecisionModal('LEAVE', 'REJECT', l)}
                              className="px-3.5 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition cursor-pointer"
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
          MANAGE TRAVEL & ROOM BOOKING MODAL (WORKFLOW ENHANCED)
          ============================================================ */}
      {manageBookingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-gray-100 my-8 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    {manageBookingModal.checklist_number}
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs font-semibold text-gray-700">{manageBookingModal.client_name}</span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                    <User size={12} />
                    <span>{manageBookingModal.service_engineer || 'Unassigned'}</span>
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-black text-gray-900 mt-1 flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-indigo-600" />
                  <span>Travel &amp; Accommodation Coordination</span>
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

            {/* Workflow Navigation Sub-Tabs */}
            <div className="flex border-b border-gray-200 overflow-x-auto gap-1 text-xs font-bold pb-1">
              <button
                type="button"
                onClick={() => setModalActiveTab('outbound')}
                className={`px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  modalActiveTab === 'outbound'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Bus size={14} />
                <span>1. Outbound Ticket</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] ${modalActiveTab === 'outbound' ? 'bg-purple-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {formData.outbound_status}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModalActiveTab('accommodation')}
                className={`px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  modalActiveTab === 'accommodation'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Hotel size={14} />
                <span>2. Room Booking</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] ${modalActiveTab === 'accommodation' ? 'bg-blue-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {formData.accommodation_status}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModalActiveTab('extend_room')}
                className={`px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  modalActiveTab === 'extend_room'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <CalendarPlus size={14} />
                <span>3. Extend Room</span>
                {formData.accommodation_status === 'Extension Required' && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setModalActiveTab('return_ticket')}
                className={`px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  modalActiveTab === 'return_ticket'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Ticket size={14} />
                <span>4. Return Ticket</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                  formData.return_status === 'Booking Required'
                    ? 'bg-amber-200 text-amber-900 font-black'
                    : modalActiveTab === 'return_ticket'
                    ? 'bg-amber-800 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}>
                  {formData.return_status}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModalActiveTab('history')}
                className={`px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  modalActiveTab === 'history'
                    ? 'bg-gray-800 text-white shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <History size={14} />
                <span>Audit &amp; Notes</span>
              </button>
            </div>

            {/* Modal Body Form Panels */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              {/* PANEL 1: OUTBOUND TICKET */}
              {modalActiveTab === 'outbound' && (
                <div className="space-y-4">
                  <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-2xl flex items-start gap-2.5">
                    <Info size={16} className="text-purple-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-purple-900">Outbound Travel Booking Policy</p>
                      <p className="text-[11px] text-purple-800 mt-0.5">
                        Coordinator manually books technician outbound travel to reach customer location. Tickets are not purchased automatically.
                      </p>
                    </div>
                  </div>

                  {/* Outbound Travel Method Selection */}
                  <div className="bg-purple-50/50 p-3 rounded-2xl border border-purple-200 space-y-2">
                    <label className="block text-gray-800 font-bold text-xs">Outbound Travel Method *</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, outbound_method: 'Government bus' })}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          formData.outbound_method === 'Government bus'
                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Bus size={14} />
                        <span>1. Government bus</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, outbound_method: 'Private travels' })}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          formData.outbound_method === 'Private travels'
                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Bus size={14} />
                        <span>2. Private travels</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Travel Operator / Bus Service Name</label>
                      <input
                        type="text"
                        value={formData.outbound_operator}
                        onChange={(e) => setFormData({ ...formData, outbound_operator: e.target.value })}
                        placeholder={formData.outbound_method === 'Government bus' ? 'e.g. SETC, KSRTC, APSRTC' : 'e.g. SRS Travels, Orange Travels'}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Outbound Booking Status</label>
                      <select
                        value={formData.outbound_status}
                        onChange={(e) => setFormData({ ...formData, outbound_status: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-bold text-purple-700"
                      >
                        <option value="Required">Required</option>
                        <option value="Pending">Pending (Not yet purchased)</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Departure Location / Origin</label>
                      <input
                        type="text"
                        value={formData.outbound_origin}
                        onChange={(e) => setFormData({ ...formData, outbound_origin: e.target.value, departure_city: e.target.value })}
                        placeholder="e.g. Chennai Central"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Destination</label>
                      <input
                        type="text"
                        value={formData.outbound_destination}
                        onChange={(e) => setFormData({ ...formData, outbound_destination: e.target.value, destination: e.target.value })}
                        placeholder="e.g. Coimbatore Site"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Boarding Point</label>
                      <input
                        type="text"
                        value={formData.outbound_boarding_point}
                        onChange={(e) => setFormData({ ...formData, outbound_boarding_point: e.target.value })}
                        placeholder="e.g. Koyambedu Bus Stand / Gandhipuram"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Departure Date &amp; Time</label>
                      <input
                        type="datetime-local"
                        value={formData.outbound_departure_datetime}
                        onChange={(e) => setFormData({ ...formData, outbound_departure_datetime: e.target.value, travel_datetime: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Arrival Location (Site / Stand)</label>
                      <input
                        type="text"
                        value={formData.outbound_arrival_location}
                        onChange={(e) => setFormData({ ...formData, outbound_arrival_location: e.target.value })}
                        placeholder="e.g. Gandhipuram Stand / Customer Site"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Estimated Arrival Time</label>
                      <input
                        type="time"
                        value={formData.outbound_estimated_arrival_time}
                        onChange={(e) => setFormData({ ...formData, outbound_estimated_arrival_time: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Fare Amount</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.outbound_fare}
                          onChange={(e) => setFormData({ ...formData, outbound_fare: e.target.value })}
                          placeholder="Fare e.g. 750"
                          className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                        />
                        <select
                          value={formData.outbound_currency}
                          onChange={(e) => setFormData({ ...formData, outbound_currency: e.target.value })}
                          className="w-20 px-2 py-2 bg-white border border-gray-200 rounded-xl font-bold text-gray-700"
                        >
                          <option value="INR">INR (₹)</option>
                          <option value="USD">USD ($)</option>
                          <option value="EUR">EUR (€)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Ticket Reference / PNR</label>
                      <input
                        type="text"
                        value={formData.outbound_ticket_reference}
                        onChange={(e) => setFormData({ ...formData, outbound_ticket_reference: e.target.value, ticket_reference: e.target.value })}
                        placeholder="PNR / Ticket No / Booking Ref"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-gray-700 font-semibold mb-1">Ticket Attachment URL / Receipt Link</label>
                      <input
                        type="text"
                        value={formData.outbound_attachment_url}
                        onChange={(e) => setFormData({ ...formData, outbound_attachment_url: e.target.value })}
                        placeholder="https://... ticket pdf or receipt link"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-gray-700 font-semibold mb-1">Outbound Travel Notes</label>
                      <input
                        type="text"
                        value={formData.outbound_notes}
                        onChange={(e) => setFormData({ ...formData, outbound_notes: e.target.value })}
                        placeholder="Platform number, seat number, driver contact if private travels..."
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={submittingModal}
                      onClick={() => {
                        setFormData({ ...formData, outbound_status: 'Pending' });
                        handleSubmitBooking();
                      }}
                      className="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-300 rounded-xl font-bold transition cursor-pointer"
                    >
                      Save as Pending (Not Yet Purchased)
                    </button>
                    <button
                      type="button"
                      disabled={submittingModal || (!formData.outbound_ticket_reference && !formData.outbound_attachment_url)}
                      onClick={() => {
                        setFormData({ ...formData, outbound_status: 'Confirmed' });
                        handleSubmitBooking();
                      }}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>Confirm Outbound Travel</span>
                    </button>
                  </div>
                </div>
              )}

              {/* PANEL 2: ROOM BOOKING (ONLINE & OFFLINE) */}
              {modalActiveTab === 'accommodation' && (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-start gap-2.5">
                    <Info size={16} className="text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-blue-900">Room Booking Policy (Online &amp; Offline)</p>
                      <p className="text-[11px] text-blue-800 mt-0.5">
                        Coordinator manually arranges technician accommodation. Supports both online platform bookings and offline lodge arrangements. Offline bookings do not require an online confirmation number.
                      </p>
                    </div>
                  </div>

                  {/* Room Booking Method Selection */}
                  <div className="bg-blue-50/50 p-3 rounded-2xl border border-blue-200 space-y-2">
                    <label className="block text-gray-800 font-bold text-xs">Room Booking Method *</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, accommodation_type: 'Online booking' })}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          formData.accommodation_type === 'Online booking'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Hotel size={14} />
                        <span>1. Online booking</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, accommodation_type: 'Offline booking' })}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          formData.accommodation_type === 'Offline booking'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Building2 size={14} />
                        <span>2. Offline booking</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                    <div className="sm:col-span-2">
                      <label className="block text-gray-700 font-semibold mb-1">
                        {formData.accommodation_type === 'Offline booking' ? 'Hotel / Lodge / Accommodation Name *' : 'Hotel or Accommodation Name *'}
                      </label>
                      <input
                        type="text"
                        value={formData.hotel_name}
                        onChange={(e) => setFormData({ ...formData, hotel_name: e.target.value })}
                        placeholder={formData.accommodation_type === 'Offline booking' ? 'e.g. Sri Krishna Lodge / Anand Bhavan Residency' : 'e.g. Grand Residency Hotel'}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    {formData.accommodation_type === 'Online booking' ? (
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">Booking Platform</label>
                        <select
                          value={formData.hotel_platform}
                          onChange={(e) => setFormData({ ...formData, hotel_platform: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                        >
                          <option value="">Select Platform</option>
                          <option value="MakeMyTrip">MakeMyTrip</option>
                          <option value="Agoda">Agoda</option>
                          <option value="Booking.com">Booking.com</option>
                          <option value="Goibibo">Goibibo</option>
                          <option value="OYO">OYO</option>
                          <option value="Direct Website">Direct Website</option>
                          <option value="Other">Other Platform</option>
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">Person / Property Contacted</label>
                        <input
                          type="text"
                          value={formData.offline_contact_person}
                          onChange={(e) => setFormData({ ...formData, offline_contact_person: e.target.value })}
                          placeholder="e.g. Mr. Ramesh (Front Desk Manager)"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Accommodation Status</label>
                      <select
                        value={formData.accommodation_status}
                        onChange={(e) => setFormData({ ...formData, accommodation_status: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-bold text-blue-700"
                      >
                        <option value="Required">Required</option>
                        <option value="Pending">Pending</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Extension Required">Extension Required</option>
                        <option value="Extension Pending">Extension Pending</option>
                        <option value="Extended">Extended</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Property Address</label>
                      <input
                        type="text"
                        value={formData.hotel_address}
                        onChange={(e) => setFormData({ ...formData, hotel_address: e.target.value })}
                        placeholder="Street, City, Near Landmark"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Contact Phone Number</label>
                      <input
                        type="text"
                        value={formData.hotel_contact}
                        onChange={(e) => setFormData({ ...formData, hotel_contact: e.target.value })}
                        placeholder="Hotel / Owner phone number"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Check-in Date</label>
                      <input
                        type="date"
                        value={formData.check_in_date}
                        onChange={(e) => setFormData({ ...formData, check_in_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Check-out Date</label>
                      <input
                        type="date"
                        value={formData.check_out_date}
                        onChange={(e) => setFormData({ ...formData, check_out_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-bold text-blue-700"
                      />
                      {formData.initial_check_out_date && formData.initial_check_out_date !== formData.check_out_date && (
                        <span className="text-[10px] text-gray-400 mt-0.5 block">
                          Initial planned checkout: {formData.initial_check_out_date}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Number of Rooms</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.number_of_rooms}
                        onChange={(e) => setFormData({ ...formData, number_of_rooms: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Number of Occupants</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.number_of_occupants}
                        onChange={(e) => setFormData({ ...formData, number_of_occupants: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">
                        {formData.accommodation_type === 'Offline booking' ? 'Agreed Price Per Night (₹)' : 'Price Per Night (₹)'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.price_per_night}
                        onChange={(e) => setFormData({ ...formData, price_per_night: e.target.value })}
                        placeholder="e.g. 1200"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">Total Cost (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.total_cost}
                        onChange={(e) => setFormData({ ...formData, total_cost: e.target.value })}
                        placeholder="Total cost e.g. 2400"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                      />
                    </div>

                    {formData.accommodation_type === 'Online booking' ? (
                      <div className="sm:col-span-2">
                        <label className="block text-gray-700 font-semibold mb-1">Booking Confirmation Number</label>
                        <input
                          type="text"
                          value={formData.hotel_booking_reference}
                          onChange={(e) => setFormData({ ...formData, hotel_booking_reference: e.target.value })}
                          placeholder="e.g. MMT-109923 / AG-88219"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Payment Status</label>
                          <select
                            value={formData.payment_status}
                            onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          >
                            <option value="Unpaid">Unpaid / Pay at Property</option>
                            <option value="Advance Paid">Advance Paid</option>
                            <option value="Fully Paid">Fully Paid</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Payment Method</label>
                          <select
                            value={formData.payment_method}
                            onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          >
                            <option value="">Select Method</option>
                            <option value="Cash">Cash</option>
                            <option value="UPI">UPI (GPay / PhonePe / Paytm)</option>
                            <option value="Bank Transfer">Bank Transfer / IMPS</option>
                            <option value="Company Card">Company Card</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-gray-700 font-semibold mb-1">Offline Arrangement Notes</label>
                          <textarea
                            rows={2}
                            value={formData.offline_notes}
                            onChange={(e) => setFormData({ ...formData, offline_notes: e.target.value })}
                            placeholder="Spoke with lodge owner, payment on arrival agreed, AC double room held..."
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>
                      </>
                    )}

                    <div className="sm:col-span-2">
                      <label className="block text-gray-700 font-semibold mb-1">
                        {formData.accommodation_type === 'Offline booking' ? 'Receipt / Payment Proof / Visiting Card Attachment URL' : 'Receipt / Voucher Confirmation Attachment URL'}
                      </label>
                      <input
                        type="text"
                        value={formData.accommodation_attachment_url}
                        onChange={(e) => setFormData({ ...formData, accommodation_attachment_url: e.target.value })}
                        placeholder="https://... attachment link"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={submittingModal}
                      onClick={() => {
                        setFormData({ ...formData, accommodation_status: 'Pending' });
                        handleSubmitBooking();
                      }}
                      className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-300 rounded-xl font-bold transition cursor-pointer"
                    >
                      Save as Pending
                    </button>
                    <button
                      type="button"
                      disabled={submittingModal || !formData.hotel_name || (formData.accommodation_type === 'Online booking' && !formData.hotel_booking_reference && !formData.accommodation_attachment_url)}
                      onClick={() => {
                        setFormData({ ...formData, accommodation_status: 'Confirmed' });
                        handleSubmitBooking();
                      }}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>Confirm Room Booking</span>
                    </button>
                  </div>
                </div>
              )}

              {/* PANEL 3: EXTEND ROOM BOOKING */}
              {modalActiveTab === 'extend_room' && (
                <div className="space-y-4">
                  <div className={`p-3 rounded-2xl border flex items-start gap-2.5 ${
                    formData.accommodation_status === 'Extension Required'
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'bg-purple-50 border-purple-200 text-purple-900'
                  }`}>
                    <CalendarPlus size={18} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Schedule Extension Room Adjustment</p>
                      <p className="text-[11px] mt-0.5">
                        {formData.accommodation_status === 'Extension Required'
                          ? 'Technical team extension approved. Confirm extra nights with accommodation provider and record updated checkout date below.'
                          : 'Update the room booking checkout date when extra nights are needed. Historical room dates and audit log are preserved.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-200">
                    <div>
                      <span className="text-gray-500 font-medium block">Current Room Checkout Date:</span>
                      <span className="text-sm font-black text-indigo-700 block mt-0.5">
                        {formData.check_out_date || 'Not recorded'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 font-medium block">Original Initial Checkout Date:</span>
                      <span className="text-sm font-semibold text-gray-700 block mt-0.5">
                        {formData.initial_check_out_date || formData.check_out_date || 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">Revised Check-out Date *</label>
                        <input
                          type="date"
                          value={formData.extend_new_check_out_date}
                          onChange={(e) => setFormData({ ...formData, extend_new_check_out_date: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-bold text-purple-800"
                        />
                      </div>

                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">Extra Nights</label>
                        <input
                          type="number"
                          min="1"
                          value={formData.extend_extra_nights}
                          onChange={(e) => setFormData({ ...formData, extend_extra_nights: Number(e.target.value) })}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-gray-700 font-semibold mb-1">Provider Extension Confirmation / Reference</label>
                        <input
                          type="text"
                          value={formData.extend_reference_details}
                          onChange={(e) => setFormData({ ...formData, extend_reference_details: e.target.value })}
                          placeholder="e.g. EXT-CONF-1092 / Room 304 extended 1 night"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-gray-700 font-semibold mb-1">Updated Voucher / Confirmation Attachment URL</label>
                        <input
                          type="text"
                          value={formData.extend_attachment_url}
                          onChange={(e) => setFormData({ ...formData, extend_attachment_url: e.target.value })}
                          placeholder="https://... attachment link"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-gray-700 font-semibold mb-1">Extension Notes &amp; Communication Details</label>
                        <textarea
                          rows={2}
                          value={formData.extend_notes}
                          onChange={(e) => setFormData({ ...formData, extend_notes: e.target.value })}
                          placeholder="Spoke with hotel desk manager, extra night approved and confirmed..."
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        disabled={submittingModal || !formData.extend_new_check_out_date}
                        onClick={handleExtendRoomSubmit}
                        className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <CalendarPlus size={14} />
                        <span>Confirm Room Extension</span>
                      </button>
                    </div>
                  </div>

                  {/* Accommodation Audit History */}
                  {Array.isArray(formData.accommodation_history) && formData.accommodation_history.length > 0 && (
                    <div className="p-3 bg-purple-50/40 rounded-xl border border-purple-200/60 space-y-2">
                      <h4 className="font-bold text-purple-900 text-xs">Room Modification History</h4>
                      <div className="space-y-1.5">
                        {formData.accommodation_history.map((hist, idx) => (
                          <div key={idx} className="p-2 bg-white rounded-lg border border-purple-100 text-[11px] text-gray-700">
                            <div className="flex justify-between font-bold text-purple-800">
                              <span>Extended from {hist.previous_check_out_date} → {hist.new_check_out_date}</span>
                              <span className="text-[10px] text-gray-400">{new Date(hist.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="text-gray-500 mt-0.5">
                              {hist.reference_details ? `Ref: ${hist.reference_details} • ` : ''}
                              {hist.notes || 'Extension recorded'} (By {hist.recorded_by})
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PANEL 4: RETURN TICKET */}
              {modalActiveTab === 'return_ticket' && (
                <div className="space-y-4">
                  {formData.return_status === 'Not Yet Required' && !manageBookingModal.actual_completion_datetime && manageBookingModal.installation_status !== 'Completed' ? (
                    <div className="p-6 bg-gray-50 border border-gray-200 rounded-2xl text-center space-y-3">
                      <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto">
                        <Ticket size={24} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-gray-900">Return Ticket Not Yet Required</h4>
                        <p className="text-xs text-gray-600 max-w-md mx-auto mt-1">
                          Return tickets are NOT required or booked when Sales first assigns the job.
                          This task will trigger automatically once the technician successfully submits the Post-Installation Form.
                        </p>
                      </div>
                      <div className="p-3 bg-white rounded-xl border border-gray-200 max-w-sm mx-auto text-left text-[11px] text-gray-500">
                        <div>• Checklist: <span className="font-bold text-gray-800">{manageBookingModal.checklist_number}</span></div>
                        <div>• Technician: <span className="font-bold text-gray-800">{manageBookingModal.service_engineer}</span></div>
                        <div>• Status: <span className="font-bold text-amber-600">Pending Post-Installation Form</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-2.5">
                        <Ticket size={18} className="text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-900">Installation completed — return ticket booking required</p>
                          <p className="text-[11px] text-amber-800 mt-0.5">
                            Post-Installation Form was successfully submitted. Record return travel details manually based on actual completion date and travel requirements.
                          </p>
                          {manageBookingModal.actual_completion_datetime && (
                            <p className="text-[10px] text-amber-700 mt-1 font-mono">
                              Actual Completion: {new Date(manageBookingModal.actual_completion_datetime).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Return Travel Method Selection */}
                      <div className="bg-amber-50/60 p-3 rounded-2xl border border-amber-200 space-y-2">
                        <label className="block text-gray-800 font-bold text-xs">Return Travel Method *</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, return_method: 'Government bus' })}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                              formData.return_method === 'Government bus'
                                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <Bus size={14} />
                            <span>1. Government bus</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, return_method: 'Private travels' })}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                              formData.return_method === 'Private travels'
                                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <Bus size={14} />
                            <span>2. Private travels</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Return Travel Operator</label>
                          <input
                            type="text"
                            value={formData.return_operator}
                            onChange={(e) => setFormData({ ...formData, return_operator: e.target.value })}
                            placeholder={formData.return_method === 'Government bus' ? 'e.g. SETC, TNSTC, KSRTC' : 'e.g. SRS Travels, Orange Travels'}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Return Task Status</label>
                          <select
                            value={formData.return_status}
                            onChange={(e) => setFormData({ ...formData, return_status: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-bold text-amber-800"
                          >
                            <option value="Booking Required">Booking Required</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Confirmed">Booking Confirmed</option>
                            <option value="Booking Issue">Booking Issue</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Departure Location (Customer Site)</label>
                          <input
                            type="text"
                            value={formData.return_origin}
                            onChange={(e) => setFormData({ ...formData, return_origin: e.target.value })}
                            placeholder="e.g. Coimbatore Customer Site"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Return Destination (Base / Home)</label>
                          <input
                            type="text"
                            value={formData.return_destination}
                            onChange={(e) => setFormData({ ...formData, return_destination: e.target.value })}
                            placeholder="e.g. Chennai Central / Home Base"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Boarding Point</label>
                          <input
                            type="text"
                            value={formData.return_boarding_point}
                            onChange={(e) => setFormData({ ...formData, return_boarding_point: e.target.value })}
                            placeholder="e.g. Gandhipuram Stand / Hotel Pickup"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Return Departure Date &amp; Time</label>
                          <input
                            type="datetime-local"
                            value={formData.return_departure_datetime}
                            onChange={(e) => setFormData({ ...formData, return_departure_datetime: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Arrival Location</label>
                          <input
                            type="text"
                            value={formData.return_arrival_location}
                            onChange={(e) => setFormData({ ...formData, return_arrival_location: e.target.value })}
                            placeholder="e.g. Chennai Central / Koyambedu"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Estimated Arrival Time</label>
                          <input
                            type="time"
                            value={formData.return_estimated_arrival_time}
                            onChange={(e) => setFormData({ ...formData, return_estimated_arrival_time: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Return Fare</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={formData.return_fare}
                              onChange={(e) => setFormData({ ...formData, return_fare: e.target.value })}
                              placeholder="Fare e.g. 850"
                              className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                            />
                            <select
                              value={formData.return_currency}
                              onChange={(e) => setFormData({ ...formData, return_currency: e.target.value })}
                              className="w-20 px-2 py-2 bg-white border border-gray-200 rounded-xl font-bold text-gray-700"
                            >
                              <option value="INR">INR (₹)</option>
                              <option value="USD">USD ($)</option>
                              <option value="EUR">EUR (€)</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-gray-700 font-semibold mb-1">Ticket Reference / PNR</label>
                          <input
                            type="text"
                            value={formData.return_ticket_reference}
                            onChange={(e) => setFormData({ ...formData, return_ticket_reference: e.target.value })}
                            placeholder="PNR / Ticket Number"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium font-mono"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-gray-700 font-semibold mb-1">Return Ticket Attachment URL / Receipt Link</label>
                          <input
                            type="text"
                            value={formData.return_attachment_url}
                            onChange={(e) => setFormData({ ...formData, return_attachment_url: e.target.value })}
                            placeholder="https://... or ticket link"
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-gray-700 font-semibold mb-1">Return Travel Notes</label>
                          <input
                            type="text"
                            value={formData.return_notes}
                            onChange={(e) => setFormData({ ...formData, return_notes: e.target.value })}
                            placeholder="e.g. Booked via SETC online portal, seat 14..."
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          type="button"
                          disabled={submittingModal}
                          onClick={() => handleReturnTicketSubmit(false)}
                          className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl font-bold transition cursor-pointer"
                        >
                          Save Return Ticket Details
                        </button>

                        <button
                          type="button"
                          disabled={submittingModal || (!formData.return_ticket_reference && !formData.return_attachment_url)}
                          onClick={() => handleReturnTicketSubmit(true)}
                          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Check size={14} />
                          <span>Confirm Return Booking</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PANEL 5: AUDIT & NOTES */}
              {modalActiveTab === 'history' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1">Coordinator Notes</label>
                    <textarea
                      value={formData.coordinator_notes}
                      onChange={(e) => setFormData({ ...formData, coordinator_notes: e.target.value })}
                      rows={3}
                      placeholder="Notes, driver contact, bus boarding point, special hotel requests..."
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                    <h4 className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                      <History size={13} className="text-indigo-600" />
                      <span>Audit Trail &amp; Modification History</span>
                    </h4>

                    {auditHistory.length === 0 ? (
                      <p className="text-gray-400 text-center py-3">No past updates recorded yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {auditHistory.map((h) => (
                          <div key={h.id} className="p-2.5 bg-white rounded-xl border border-gray-200/80 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900">
                                {h.action} → <span className="font-mono text-indigo-700">{h.new_status}</span>
                              </span>
                              <span className="text-gray-400 text-[10px]">
                                {new Date(h.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-gray-600 mt-1">
                              By {h.changed_by_email || 'Coordinator'}: {h.notes || 'Status updated'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                disabled={submittingModal}
                onClick={() => setManageBookingModal(null)}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition"
              >
                Close
              </button>

              <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={submittingModal}
                  onClick={() => handleSubmitBooking('IN_PROGRESS')}
                  className="flex-1 sm:flex-initial px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer border border-indigo-200 flex items-center justify-center gap-1.5"
                >
                  <Save size={14} />
                  <span>Save Arrangements</span>
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
                  <span>Confirm Overall Completed</span>
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
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-950 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-800 text-xs">
                    <AlertTriangle size={16} className="text-rose-600 shrink-0" />
                    <span>Permanent Workflow Deletion</span>
                  </div>
                  <p className="text-[11px] text-rose-900 leading-relaxed">
                    Deleting this checklist permanently deletes the original checklist and all records created specifically from it, including:
                  </p>
                  <ul className="list-disc list-inside text-[11px] text-rose-800 space-y-0.5 pl-1">
                    <li>Original checklist data and intake details</li>
                    <li>Store Bill of Materials (BOM) & material requests</li>
                    <li>Service Engineer appointments & booking schedules</li>
                    <li>Coordinator travel/hotel bookings & audit logs</li>
                    <li>Technician jobs, completion reports, expenses & return receipts</li>
                    <li>Checklist-specific notifications & workflow entries</li>
                  </ul>
                </div>

                {deleteSingleModal.eligibility?.dependentRecordsBreakdown && deleteSingleModal.eligibility.dependentRecordsBreakdown.length > 0 ? (
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5 text-xs">
                    <span className="font-bold text-amber-950 block text-[11px]">
                      Records to be deleted with this checklist ({deleteSingleModal.eligibility.impact?.totalDependentRecords || 0} total):
                    </span>
                    <div className="grid grid-cols-1 gap-1 text-[11px]">
                      {deleteSingleModal.eligibility.dependentRecordsBreakdown.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-amber-900 bg-white/70 px-2 py-1 rounded border border-amber-200/60 font-medium">
                          <span>{item.label}</span>
                          <span className="font-bold font-mono bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded text-[10px]">
                            {item.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[11px] text-gray-600 text-center">
                    No active dependent records found. Only the draft checklist itself will be removed.
                  </div>
                )}
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
                <button
                  type="button"
                  id="btn-confirm-delete-single"
                  disabled={deleteSingleModal.submitting || deleteSingleModal.checking}
                  onClick={handleConfirmDeleteSingle}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {deleteSingleModal.submitting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  <span>Confirm Delete Entire Workflow</span>
                </button>
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
