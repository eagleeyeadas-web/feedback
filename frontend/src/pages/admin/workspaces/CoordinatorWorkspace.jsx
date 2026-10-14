import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchCoordinatorBookings,
  saveCoordinatorBookingApi,
  fetchCoordinatorBookingHistory,
} from '../../../lib/api';
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
} from 'lucide-react';

const SERVICE_ENGINEER_OPTIONS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function CoordinatorWorkspace() {
  const { token, user } = useAuth();

  // Primary Workspace State
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed'
  const [checklists, setChecklists] = useState([]);
  const [stats, setStats] = useState({ pending: 0, in_progress: 0, completed: 0, not_required: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEngineer, setSelectedEngineer] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState('');

  // Modal / Manage Booking State
  const [manageBookingModal, setManageBookingModal] = useState(null); // stores active checklist object
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [auditHistory, setAuditHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(false);

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
        tab: activeTab,
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

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Open Manage Booking Modal
  const openManageModal = async (chk) => {
    setManageBookingModal(chk);
    setModalError('');
    setShowHistorySection(false);

    const b = chk.coordinator_booking || {};

    // Format travel datetime for HTML datetime-local input
    let formattedDatetime = '';
    if (b.travel_datetime) {
      const d = new Date(b.travel_datetime);
      if (!isNaN(d.getTime())) {
        formattedDatetime = d.toISOString().slice(0, 16);
      }
    } else if (chk.expected_arrival_date) {
      // Default suggested travel datetime: morning of scheduled arrival
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

    // Load audit history
    if (chk.id) {
      setLoadingHistory(true);
      try {
        const histRes = await fetchCoordinatorBookingHistory(token, chk.id);
        setAuditHistory(histRes.history || []);
      } catch (e) {
        setAuditHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    }
  };

  // Submit Booking Form
  const handleSubmitBooking = async (targetStatus) => {
    setModalError('');
    if (!manageBookingModal || submittingModal) return;

    const payload = {
      ...formData,
      booking_status: targetStatus || formData.booking_status,
      assigned_engineer: manageBookingModal.service_engineer,
    };

    // Client-side validation for COMPLETED status
    if (payload.booking_status === 'COMPLETED') {
      const errors = [];
      if (payload.travel_required) {
        if (!payload.departure_city.trim()) errors.push('Departure city is required for travel booking.');
        if (!payload.destination.trim()) errors.push('Destination is required for travel booking.');
        if (!payload.travel_datetime) errors.push('Travel date and time are required for travel booking.');
      }
      if (payload.accommodation_required) {
        if (!payload.hotel_name.trim()) errors.push('Hotel / room booking name is required.');
        if (!payload.check_in_date) errors.push('Check-in date is required.');
        if (!payload.check_out_date) errors.push('Check-out date is required.');
      }

      if (errors.length > 0) {
        setModalError(errors.join(' '));
        return;
      }
    }

    setSubmittingModal(true);
    try {
      await saveCoordinatorBookingApi(token, manageBookingModal.id, payload);
      showToast(`Booking details saved for ${manageBookingModal.checklist_number}! Status: ${payload.booking_status}`);
      setManageBookingModal(null);
      await loadBookings(true);
    } catch (err) {
      setModalError(err.message || 'Failed to save booking');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 size={13} className="text-emerald-600" />
            <span>Bookings Completed</span>
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <Clock size={13} className="text-blue-600 animate-pulse" />
            <span>Arrangements In Progress</span>
          </span>
        );
      case 'NOT_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700 border border-gray-300">
            <span>Not Required</span>
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertCircle size={13} className="text-amber-600" />
            <span>Pending Arrangements</span>
          </span>
        );
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
            <span>Travel & Accommodation Logistics</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Arrange bus tickets and room accommodations for assigned Service Engineers based on Sales installation checklists.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => loadBookings(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <AlertCircle size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Pending</span>
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
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Completed</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.completed}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-600 shrink-0">
            <CalendarCheck size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Total Active</span>
            <span className="text-xl font-black text-gray-900 mt-0.5 block">{stats.total}</span>
          </div>
        </div>
      </div>

      {/* Main Section: Tabs & Search/Filter Controls */}
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'pending'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-xl'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Clock size={16} />
            <span>Pending Bookings</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-100 text-amber-800">
              {stats.pending + stats.in_progress}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
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
        </div>

        {/* Filter and Search Bar */}
        <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search checklist #, client, location..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-medium"
            />
          </div>

          {/* Service Engineer Dropdown */}
          <div>
            <select
              value={selectedEngineer}
              onChange={(e) => setSelectedEngineer(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-gray-700 bg-white"
            >
              <option value="ALL">All Service Engineers</option>
              {SERVICE_ENGINEER_OPTIONS.map((eng) => (
                <option key={eng} value={eng}>
                  Engineer: {eng}
                </option>
              ))}
            </select>
          </div>

          {/* Booking Status Dropdown */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-gray-700 bg-white"
            >
              <option value="ALL">All Booking Statuses</option>
              <option value="PENDING">Pending Arrangements</option>
              <option value="IN_PROGRESS">Arrangements In Progress</option>
              <option value="COMPLETED">Completed Bookings</option>
              <option value="NOT_REQUIRED">Not Required</option>
            </select>
          </div>

          {/* Scheduled Date Filter */}
          <div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-gray-700 bg-white"
            />
          </div>
        </div>

        {/* Checklists List / Cards */}
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
                ? 'All eligible Sales checklists have travel and room arrangements confirmed, or no pending checklists match the current filters.'
                : 'Confirmed bookings and completed travel arrangements will appear here for historical tracking.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {checklists.map((chk) => {
              const b = chk.coordinator_booking || {};
              const hasTravel = Boolean(b.travel_required);
              const hasAccom = Boolean(b.accommodation_required);

              return (
                <div
                  key={chk.id}
                  className="bg-white rounded-2xl border border-gray-200 shadow-xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4 hover:border-indigo-200"
                >
                  {/* Card Top: Checklist Number, Job Type & Booking Status */}
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-indigo-900 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-200">
                            {chk.checklist_number}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              chk.installation_or_service === 'Service'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {chk.installation_or_service || 'Installation'}
                          </span>
                        </div>
                        <h3 className="text-sm font-black text-gray-900 mt-1.5">{chk.client_name}</h3>
                      </div>

                      <div>{renderStatusBadge(chk.booking_status)}</div>
                    </div>

                    {/* Location & Google Maps Link */}
                    <div className="flex items-start gap-1.5 text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                      <MapPin size={15} className="text-rose-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{chk.client_location || 'Location not specified'}</span>
                        {chk.google_maps_location && (
                          <a
                            href={chk.google_maps_location}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline mt-0.5 ml-2"
                          >
                            <span>Open Google Maps</span>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Operational Details Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-gray-50/60 p-2 rounded-lg">
                        <span className="text-[10px] text-gray-400 font-bold uppercase block">Service Engineer</span>
                        <span className="font-bold text-gray-900 flex items-center gap-1 mt-0.5">
                          <User size={12} className="text-indigo-600" />
                          <span>{chk.service_engineer || 'Unassigned'}</span>
                        </span>
                      </div>

                      <div className="bg-gray-50/60 p-2 rounded-lg">
                        <span className="text-[10px] text-gray-400 font-bold uppercase block">Scheduled Arrival</span>
                        <span className="font-bold text-gray-900 flex items-center gap-1 mt-0.5 font-mono">
                          <Calendar size={12} className="text-indigo-600" />
                          <span>
                            {chk.expected_arrival_date || 'N/A'}{' '}
                            {chk.expected_arrival_time ? `(${chk.expected_arrival_time.slice(0, 5)})` : ''}
                          </span>
                        </span>
                      </div>

                      <div className="bg-gray-50/60 p-2 rounded-lg">
                        <span className="text-[10px] text-gray-400 font-bold uppercase block">Vehicles & Devices</span>
                        <span className="font-semibold text-gray-800 flex items-center gap-1 mt-0.5">
                          <Car size={12} className="text-gray-500" />
                          <span>
                            {chk.number_of_vehicles || 1} Veh. • {chk.device_type} ({chk.number_of_devices || 1} Nos.)
                          </span>
                        </span>
                      </div>

                      <div className="bg-gray-50/60 p-2 rounded-lg">
                        <span className="text-[10px] text-gray-400 font-bold uppercase block">Arrangements</span>
                        <div className="flex items-center gap-1 mt-0.5 text-[11px]">
                          {hasTravel ? (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold flex items-center gap-0.5">
                              <Bus size={10} /> Bus
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[10px]">No travel</span>
                          )}
                          <span className="text-gray-300">•</span>
                          {hasAccom ? (
                            <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold flex items-center gap-0.5">
                              <Hotel size={10} /> Room
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[10px]">No room</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sales Remarks / Travel Notes */}
                    {chk.remarks && (
                      <div className="text-[11px] text-gray-600 bg-amber-50/60 border border-amber-200/60 p-2 rounded-lg">
                        <strong className="text-amber-900 font-bold">Sales Note:</strong> {chk.remarks}
                      </div>
                    )}
                  </div>

                  {/* Card Bottom: Manage Booking Action */}
                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">
                      {b.updated_at ? `Updated: ${new Date(b.updated_at).toLocaleDateString()}` : 'New checklist from Sales'}
                    </span>

                    <button
                      type="button"
                      onClick={() => openManageModal(chk)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <CalendarCheck size={14} />
                      <span>{chk.booking_status === 'COMPLETED' ? 'View / Edit Booking' : 'Manage Booking'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================
          BOOKING DETAILS MODAL (MANAGE BOOKING)
          ============================================================ */}
      {manageBookingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full my-8 p-5 sm:p-7 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-indigo-900 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-200">
                    {manageBookingModal.checklist_number}
                  </span>
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {manageBookingModal.installation_or_service || 'Job'}
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-black text-gray-900 mt-1">
                  Manage Travel &amp; Room Booking: {manageBookingModal.client_name}
                </h2>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <MapPin size={12} className="text-rose-500" />
                  <span>{manageBookingModal.client_location}</span>
                  {manageBookingModal.google_maps_location && (
                    <a
                      href={manageBookingModal.google_maps_location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline font-bold inline-flex items-center gap-0.5 ml-1"
                    >
                      <span>Map Link</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setManageBookingModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Error Banner */}
            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2">
                <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Checklist Reference Information */}
            <div className="bg-indigo-50/50 border border-indigo-100 p-3 rounded-2xl text-xs grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Service Engineer</span>
                <span className="font-bold text-indigo-950 flex items-center gap-1 mt-0.5">
                  <User size={12} className="text-indigo-600" />
                  <span>{manageBookingModal.service_engineer || 'Unassigned'}</span>
                </span>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Scheduled Date</span>
                <span className="font-bold text-indigo-950 font-mono mt-0.5 block">
                  {manageBookingModal.expected_arrival_date}{' '}
                  {manageBookingModal.expected_arrival_time ? `(${manageBookingModal.expected_arrival_time.slice(0, 5)})` : ''}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Vehicles & Devices</span>
                <span className="font-semibold text-indigo-950 mt-0.5 block">
                  {manageBookingModal.number_of_vehicles || 1} Veh • {manageBookingModal.number_of_devices || 1} Devices
                </span>
              </div>

              {manageBookingModal.remarks && (
                <div className="col-span-2 sm:col-span-3 pt-1 border-t border-indigo-100/60 text-[11px] text-gray-600">
                  <strong className="text-indigo-900 font-bold">Sales Remarks:</strong> {manageBookingModal.remarks}
                </div>
              )}
            </div>

            {/* Booking Form Tabs / Sections */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {/* ==========================================
                  SECTION 1: BUS / TRAVEL BOOKING
                  ========================================== */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Bus size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-900">Bus / Travel Booking</h4>
                      <p className="text-[11px] text-gray-500">Arrange transit for the service engineer</p>
                    </div>
                  </div>

                  {/* Travel Required Toggle */}
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, travel_required: false }))}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        !formData.travel_required
                          ? 'bg-white text-gray-800 shadow-xs'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Not Required
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, travel_required: true }))}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        formData.travel_required
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Required
                    </button>
                  </div>
                </div>

                {formData.travel_required && (
                  <div className="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs animate-in fade-in">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Travel Type</label>
                      <select
                        value={formData.travel_type}
                        onChange={(e) => setFormData((prev) => ({ ...prev, travel_type: e.target.value }))}
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500 bg-white"
                      >
                        <option value="Bus">Bus</option>
                        <option value="Other">Other (Train / Flight / Cab)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Departure City *</label>
                      <input
                        type="text"
                        value={formData.departure_city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, departure_city: e.target.value }))}
                        placeholder="e.g. Chennai / Coimbatore"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Destination *</label>
                      <input
                        type="text"
                        value={formData.destination}
                        onChange={(e) => setFormData((prev) => ({ ...prev, destination: e.target.value }))}
                        placeholder="e.g. Salem / Trichy"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Travel Date &amp; Time *</label>
                      <input
                        type="datetime-local"
                        value={formData.travel_datetime}
                        onChange={(e) => setFormData((prev) => ({ ...prev, travel_datetime: e.target.value }))}
                        className="w-full p-2 border border-gray-200 rounded-xl font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Ticket Booking Reference <span className="font-normal text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.ticket_reference}
                        onChange={(e) => setFormData((prev) => ({ ...prev, ticket_reference: e.target.value }))}
                        placeholder="e.g. PNR / Ticket #123456"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Travel Notes <span className="font-normal text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.travel_notes}
                        onChange={(e) => setFormData((prev) => ({ ...prev, travel_notes: e.target.value }))}
                        placeholder="e.g. Boarding at Koyambedu Gate 3"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ==========================================
                  SECTION 2: ROOM / ACCOMMODATION BOOKING
                  ========================================== */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                      <Hotel size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-900">Room / Accommodation Booking</h4>
                      <p className="text-[11px] text-gray-500">Arrange lodging near the client installation site</p>
                    </div>
                  </div>

                  {/* Accommodation Required Toggle */}
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, accommodation_required: false }))}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        !formData.accommodation_required
                          ? 'bg-white text-gray-800 shadow-xs'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Not Required
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, accommodation_required: true }))}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        formData.accommodation_required
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Required
                    </button>
                  </div>
                </div>

                {formData.accommodation_required && (
                  <div className="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs animate-in fade-in">
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-gray-700 mb-1">Hotel / Room Booking Name *</label>
                      <input
                        type="text"
                        value={formData.hotel_name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, hotel_name: e.target.value }))}
                        placeholder="e.g. Grand Residency Hotel, Near Bus Stand"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Check-in Date *</label>
                      <input
                        type="date"
                        value={formData.check_in_date}
                        onChange={(e) => setFormData((prev) => ({ ...prev, check_in_date: e.target.value }))}
                        className="w-full p-2 border border-gray-200 rounded-xl font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Check-out Date *</label>
                      <input
                        type="date"
                        value={formData.check_out_date}
                        onChange={(e) => setFormData((prev) => ({ ...prev, check_out_date: e.target.value }))}
                        className="w-full p-2 border border-gray-200 rounded-xl font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Number of Rooms *</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.number_of_rooms}
                        onChange={(e) => setFormData((prev) => ({ ...prev, number_of_rooms: e.target.value }))}
                        className="w-full p-2 border border-gray-200 rounded-xl font-bold font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Hotel Booking Reference <span className="font-normal text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.hotel_booking_reference}
                        onChange={(e) => setFormData((prev) => ({ ...prev, hotel_booking_reference: e.target.value }))}
                        placeholder="e.g. Res #78901 / Room 302"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block font-bold text-gray-700 mb-1">
                        Accommodation Notes <span className="font-normal text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.accommodation_notes}
                        onChange={(e) => setFormData((prev) => ({ ...prev, accommodation_notes: e.target.value }))}
                        placeholder="e.g. Early check-in requested; complimentary breakfast included"
                        className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ==========================================
                  SECTION 3: PERSONNEL & COORDINATOR NOTES
                  ========================================== */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-2xs text-xs">
                <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                  <Users size={14} className="text-gray-500" />
                  <span>Personnel &amp; Internal Coordinator Notes</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">
                      Assigned Service Engineer <span className="font-normal text-gray-400">(from Sales)</span>
                    </label>
                    <div className="p-2 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 flex items-center gap-2">
                      <User size={14} className="text-indigo-600" />
                      <span>{manageBookingModal.service_engineer}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">
                      Additional Personnel <span className="font-normal text-gray-400">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.additional_personnel}
                      onChange={(e) => setFormData((prev) => ({ ...prev, additional_personnel: e.target.value }))}
                      placeholder="e.g. Accompanying trainee / assistant"
                      className="w-full p-2 border border-gray-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Coordinator Internal Notes <span className="font-normal text-gray-400">(Optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={formData.coordinator_notes}
                    onChange={(e) => setFormData((prev) => ({ ...prev, coordinator_notes: e.target.value }))}
                    placeholder="e.g. Communicated with technician via call; tickets dispatched on WhatsApp."
                    className="w-full p-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none font-medium"
                  />
                </div>
              </div>

              {/* Informative WhatsApp Callout */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl text-xs text-emerald-900 flex items-start gap-2.5">
                <Send size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed text-[11px]">
                  <strong>WhatsApp Ticket Logistics:</strong> Share bus tickets and hotel reservation vouchers
                  directly with <strong>{manageBookingModal.service_engineer}</strong> via WhatsApp. Once all arrangements
                  are in place, click <strong>Confirm &amp; Complete</strong> below.
                </div>
              </div>

              {/* History / Audit Log Collapsible */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowHistorySection(!showHistorySection)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-indigo-600 transition cursor-pointer"
                >
                  <History size={14} />
                  <span>{showHistorySection ? 'Hide Booking Audit History' : 'View Booking Audit History'}</span>
                </button>

                {showHistorySection && (
                  <div className="mt-2 bg-gray-50 p-3 rounded-2xl border border-gray-200 space-y-2 text-xs max-h-40 overflow-y-auto">
                    {loadingHistory ? (
                      <p className="text-gray-400 text-center py-2">Loading audit trail...</p>
                    ) : auditHistory.length === 0 ? (
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

            {/* Modal Footer: Action Buttons */}
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
                {/* Option to mark as NOT REQUIRED if neither is needed */}
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

                {/* Save In Progress Draft */}
                <button
                  type="button"
                  disabled={submittingModal}
                  onClick={() => handleSubmitBooking('IN_PROGRESS')}
                  className="flex-1 sm:flex-initial px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer border border-indigo-200 flex items-center justify-center gap-1.5"
                >
                  <Save size={14} />
                  <span>Save as In Progress</span>
                </button>

                {/* Confirm & Complete */}
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
    </div>
  );
}
