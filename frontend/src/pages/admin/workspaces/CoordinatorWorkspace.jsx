import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchCoordinatorBookings,
  saveCoordinatorBookingApi,
  fetchCoordinatorBookingHistory,
  updateCoordinatorOutboundStatusApi,
  updateCoordinatorRoomStatusApi,
  updateCoordinatorReturnStatusApi,
  fetchCoordinatorScheduleConflicts,
  fetchCoordinatorNotifications,
  markCoordinatorNotificationReadApi,
} from '../../../lib/api';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building,
  Bus,
  Ticket,
  AlertTriangle,
  History,
  RefreshCw,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Shield,
  Calendar,
  Check,
  Eye,
  Bell,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = parseDateParts(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Status Badges & Styling Configuration
const STATUS_STYLES = {
  Pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  'Pending Review': {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    dot: 'bg-purple-500',
  },
  Booked: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
  Confirmed: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  Cancelled: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    dot: 'bg-rose-500',
  },
};

export default function CoordinatorWorkspace() {
  const { token, user, signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active Navigation Section: 'outbound' | 'room' | 'return' | 'extensions' | 'conflicts'
  const [activeSection, setActiveSection] = useState('outbound');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data States
  const [checklists, setChecklists] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [stats, setStats] = useState({
    outbound_pending: 0,
    outbound_booked: 0,
    outbound_confirmed: 0,
    outbound_cancelled: 0,
    outbound_total: 0,
    room_pending: 0,
    room_pending_review: 0,
    room_booked: 0,
    room_confirmed: 0,
    room_cancelled: 0,
    room_total: 0,
    return_pending: 0,
    return_booked: 0,
    return_confirmed: 0,
    return_cancelled: 0,
    return_total: 0,
    extension_reviews: 0,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', message: '' }

  // Status update state: map of checklistId -> selected status for each section
  const [statusDrafts, setStatusDrafts] = useState({});
  const [savingStatusId, setSavingStatusId] = useState(null);

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');

  // History / Audit Modal State
  const [historyModal, setHistoryModal] = useState({
    open: false,
    checklistId: null,
    checklistNumber: '',
    logs: [],
    loading: false,
  });

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Show Toast Helper
  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Fetch Core Coordinator Data
  const loadDashboardData = useCallback(
    async (isManualRefresh = false) => {
      if (!token) return;
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const [bookingsRes, conflictsRes, notifsRes] = await Promise.allSettled([
          fetchCoordinatorBookings(token, { limit: 200, tab: 'all' }),
          fetchCoordinatorScheduleConflicts(token),
          fetchCoordinatorNotifications(token),
        ]);

        if (bookingsRes.status === 'fulfilled' && bookingsRes.value) {
          const list = bookingsRes.value.checklists || [];
          setChecklists(list);
          if (bookingsRes.value.stats) {
            setStats(bookingsRes.value.stats);
          }
        }

        if (conflictsRes.status === 'fulfilled' && conflictsRes.value) {
          setConflicts(conflictsRes.value.conflicts || []);
        }

        if (notifsRes.status === 'fulfilled' && notifsRes.value) {
          setNotifications(notifsRes.value.notifications || []);
        }
      } catch (err) {
        showToast('error', err.message || 'Failed to load coordinator data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Handle Status Selection Change in Local Draft State
  const handleDraftChange = (checklistId, newStatus) => {
    setStatusDrafts((prev) => ({
      ...prev,
      [checklistId]: newStatus,
    }));
  };

  // Save Status Updates (Outbound, Room, or Return)
  const handleSaveStatus = async (item, sectionType) => {
    const checklistId = item.id;
    const booking = item.coordinator_booking || {};
    const selectedStatus =
      statusDrafts[checklistId] ||
      (sectionType === 'outbound'
        ? booking.outbound_status
        : sectionType === 'room'
        ? booking.accommodation_status
        : booking.return_status);

    if (!selectedStatus) return;

    setSavingStatusId(checklistId);
    try {
      if (sectionType === 'outbound') {
        await updateCoordinatorOutboundStatusApi(token, checklistId, selectedStatus);
      } else if (sectionType === 'room') {
        await updateCoordinatorRoomStatusApi(token, checklistId, selectedStatus);
      } else if (sectionType === 'return') {
        await updateCoordinatorReturnStatusApi(token, checklistId, selectedStatus);
      }

      showToast('success', `${sectionType === 'outbound' ? 'Outbound travel' : sectionType === 'room' ? 'Room booking' : 'Return ticket'} status updated to "${selectedStatus}".`);

      // Clear draft for this row
      setStatusDrafts((prev) => {
        const next = { ...prev };
        delete next[checklistId];
        return next;
      });

      // Refresh data
      await loadDashboardData(false);
    } catch (err) {
      showToast('error', err.message || 'Failed to update status. Please try again.');
    } finally {
      setSavingStatusId(null);
    }
  };

  // Open History Audit Trail
  const openHistory = async (checklistId, checklistNumber) => {
    setHistoryModal({
      open: true,
      checklistId,
      checklistNumber,
      logs: [],
      loading: true,
    });
    try {
      const res = await fetchCoordinatorBookingHistory(token, checklistId);
      setHistoryModal((prev) => ({
        ...prev,
        logs: res.history || [],
        loading: false,
      }));
    } catch (err) {
      showToast('error', 'Failed to fetch history logs');
      setHistoryModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Filtered Checklist Datasets
  const filteredChecklists = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();

    return checklists.filter((item) => {
      const cb = item.coordinator_booking || {};
      const jobNum = (item.checklist_number || item.id || '').toLowerCase();
      const tech = (item.service_engineer || '').toLowerCase();
      const client = (item.client_name || '').toLowerCase();
      const loc = (item.client_location || cb.outbound_destination || '').toLowerCase();

      const matchesSearch =
        !term ||
        jobNum.includes(term) ||
        tech.includes(term) ||
        client.includes(term) ||
        loc.includes(term);

      if (!matchesSearch) return false;

      if (activeSection === 'outbound') {
        return true;
      }

      if (activeSection === 'room') {
        return true;
      }

      if (activeSection === 'return') {
        // Return tickets section: strictly show ONLY jobs where return-ticket request was created
        return Boolean(cb.return_task_created && cb.return_status && cb.return_status !== 'Not Required Yet');
      }

      if (activeSection === 'extensions') {
        // Extension Reviews section: strictly show jobs genuinely requiring review
        return cb.accommodation_status === 'Pending Review';
      }

      return true;
    });
  }, [checklists, searchTerm, activeSection]);

  // Sidebar live count badges
  const navBadges = {
    outbound: stats.outbound_pending,
    room: (stats.room_pending || 0) + (stats.room_pending_review || 0),
    return: stats.return_pending,
    extensions: stats.extension_reviews,
    conflicts: conflicts.length,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800">
      {/* ============================================================ */}
      {/* 1. HEADER */}
      {/* ============================================================ */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & System Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-hidden"
              aria-label="Toggle navigation menu"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-xs">
                EE
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-base leading-tight tracking-tight">
                    Eagle Eye SafDrive
                  </span>
                  <span className="hidden sm:inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    Travel & Room Logistics
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">Enterprise Fleet Safety</p>
              </div>
            </div>
          </div>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="relative p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="Notifications"
              >
                <Bell className="w-5 h-5" />
                {notifications.some((n) => !n.is_read) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white" />
                )}
              </button>

              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-40">
                  <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-700 uppercase tracking-wider">
                      Coordinator Notifications
                    </span>
                    <button
                      onClick={() => setShowNotifDropdown(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4 text-center">No notifications</p>
                    ) : (
                      notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className="p-3 hover:bg-slate-50 transition-colors">
                          <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.message}</p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {formatDisplayDate(n.created_at)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Coordinator Info */}
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-900 truncate max-w-[200px]">
                {user?.email || 'coordinator@eagleeye.com'}
              </span>
              <span className="text-[11px] text-blue-600 font-medium flex items-center justify-end gap-1">
                <Shield className="w-3 h-3 text-blue-600" />
                Coordinator
              </span>
            </div>

            <span className="inline-flex md:hidden px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              Coordinator
            </span>

            {/* Sign Out Button */}
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to sign out?')) {
                  signOut();
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-red-700 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all animate-in fade-in slide-in-from-bottom-2 ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. BODY LAYOUT: SIDEBAR + MAIN CONTENT */}
      {/* ============================================================ */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex gap-6">
        {/* Left Sidebar */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-20 w-64 bg-white lg:bg-transparent border-r lg:border-r-0 border-slate-200 p-4 lg:p-0 flex flex-col gap-1 transition-transform duration-200 ease-in-out shrink-0 ${
            sidebarOpen ? 'translate-x-0 shadow-xl lg:shadow-none' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <div className="lg:hidden flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
            <span className="font-semibold text-xs text-slate-400 uppercase tracking-wider">
              Coordinator Menu
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-1">
            {/* Outbound Travel */}
            <button
              onClick={() => {
                setActiveSection('outbound');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === 'outbound'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Bus className={`w-4 h-4 ${activeSection === 'outbound' ? 'text-white' : 'text-slate-400'}`} />
                <span>Outbound Travel</span>
              </div>
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  activeSection === 'outbound'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {navBadges.outbound}
              </span>
            </button>

            {/* Room Bookings */}
            <button
              onClick={() => {
                setActiveSection('room');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === 'room'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Building className={`w-4 h-4 ${activeSection === 'room' ? 'text-white' : 'text-slate-400'}`} />
                <span>Room Bookings</span>
              </div>
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  activeSection === 'room'
                    ? 'bg-white/20 text-white'
                    : 'bg-purple-100 text-purple-800'
                }`}
              >
                {navBadges.room}
              </span>
            </button>

            {/* Return Tickets */}
            <button
              onClick={() => {
                setActiveSection('return');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === 'return'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Ticket className={`w-4 h-4 ${activeSection === 'return' ? 'text-white' : 'text-slate-400'}`} />
                <span>Return Tickets</span>
              </div>
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  activeSection === 'return'
                    ? 'bg-white/20 text-white'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {navBadges.return}
              </span>
            </button>

            {/* Extension Reviews */}
            <button
              onClick={() => {
                setActiveSection('extensions');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === 'extensions'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Clock className={`w-4 h-4 ${activeSection === 'extensions' ? 'text-white' : 'text-purple-500'}`} />
                <span>Extension Reviews</span>
              </div>
              {navBadges.extensions > 0 && (
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                    activeSection === 'extensions'
                      ? 'bg-white/20 text-white'
                      : 'bg-purple-100 text-purple-800 font-bold'
                  }`}
                >
                  {navBadges.extensions}
                </span>
              )}
            </button>

            {/* Schedule Conflicts */}
            <button
              onClick={() => {
                setActiveSection('conflicts');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === 'conflicts'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className={`w-4 h-4 ${activeSection === 'conflicts' ? 'text-white' : 'text-rose-500'}`} />
                <span>Schedule Conflicts</span>
              </div>
              {navBadges.conflicts > 0 && (
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                    activeSection === 'conflicts'
                      ? 'bg-white/20 text-white'
                      : 'bg-rose-100 text-rose-800 font-bold'
                  }`}
                >
                  {navBadges.conflicts}
                </span>
              )}
            </button>
          </div>

          {/* Quick Info Box in Sidebar */}
          <div className="mt-6 p-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600">
            <p className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Coordinator Role
            </p>
            <p className="leading-relaxed">
              Manage travel & room booking statuses directly. No transport or hotel booking details required.
            </p>
          </div>
        </aside>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-10 lg:hidden"
          />
        )}

        {/* ============================================================ */}
        {/* 3. MAIN CONTENT WORKSPACE */}
        {/* ============================================================ */}
        <main className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Top Actions: Search & Refresh */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by Job ID, Technician, Destination..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-xs"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => loadDashboardData(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
                <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 7. DASHBOARD SUMMARY CARDS (DYNAMIC PER ACTIVE VIEW) */}
          {/* ============================================================ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {activeSection === 'outbound' && (
              <>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider block mb-1">
                    Pending
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.outbound_pending}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider block mb-1">
                    Booked
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.outbound_booked}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider block mb-1">
                    Confirmed
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.outbound_confirmed}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider block mb-1">
                    Cancelled
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.outbound_cancelled}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hidden lg:block">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Jobs
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.outbound_total}</span>
                </div>
              </>
            )}

            {activeSection === 'room' && (
              <>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider block mb-1">
                    Pending
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_pending}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-purple-200 bg-purple-50/30 shadow-xs">
                  <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider block mb-1">
                    Pending Review
                  </span>
                  <span className="text-2xl font-bold text-purple-900">{stats.room_pending_review}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider block mb-1">
                    Booked
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_booked}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider block mb-1">
                    Confirmed
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_confirmed}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hidden lg:block">
                  <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider block mb-1">
                    Cancelled
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_cancelled}</span>
                </div>
              </>
            )}

            {activeSection === 'return' && (
              <>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider block mb-1">
                    Pending
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.return_pending}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider block mb-1">
                    Booked
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.return_booked}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider block mb-1">
                    Confirmed
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.return_confirmed}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider block mb-1">
                    Cancelled
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.return_cancelled}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hidden lg:block">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Active Requests
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.return_total}</span>
                </div>
              </>
            )}

            {activeSection === 'extensions' && (
              <>
                <div className="bg-white p-3.5 rounded-xl border border-purple-300 bg-purple-50/40 shadow-xs">
                  <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider block mb-1">
                    Awaiting Review
                  </span>
                  <span className="text-2xl font-bold text-purple-900">{stats.extension_reviews}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider block mb-1">
                    Rooms Confirmed
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_confirmed}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider block mb-1">
                    Rooms Booked
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_booked}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Rooms
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{stats.room_total}</span>
                </div>
              </>
            )}

            {activeSection === 'conflicts' && (
              <>
                <div className="bg-white p-3.5 rounded-xl border border-rose-300 bg-rose-50/40 shadow-xs">
                  <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider block mb-1">
                    Active Conflicts
                  </span>
                  <span className="text-2xl font-bold text-rose-900">{conflicts.length}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider block mb-1">
                    Engineers Involved
                  </span>
                  <span className="text-2xl font-bold text-slate-900">
                    {new Set(conflicts.map((c) => c.engineer_name)).size}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* ============================================================ */}
          {/* TABLES CONTAINER */}
          {/* ============================================================ */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                <p className="text-sm">Loading live logistics data...</p>
              </div>
            ) : (
              <>
                {/* -------------------------------------------------------- */}
                {/* 2. OUTBOUND TRAVEL TABLE */}
                {/* -------------------------------------------------------- */}
                {activeSection === 'outbound' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-3.5 w-12 text-center">#</th>
                          <th className="py-3 px-3.5">Job ID</th>
                          <th className="py-3 px-3.5">Technician</th>
                          <th className="py-3 px-3.5">Travel Date</th>
                          <th className="py-3 px-3.5">Destination</th>
                          <th className="py-3 px-3.5">Current Status</th>
                          <th className="py-3 px-3.5">Update Status</th>
                          <th className="py-3 px-3.5 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredChecklists.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                              No outbound travel records found
                            </td>
                          </tr>
                        ) : (
                          filteredChecklists.map((item, idx) => {
                            const cb = item.coordinator_booking || {};
                            const currentStatus = cb.outbound_status || 'Pending';
                            const selectedDraft = statusDrafts[item.id] || currentStatus;
                            const isChanged = selectedDraft !== currentStatus;
                            const isSaving = savingStatusId === item.id;
                            const badgeStyle = STATUS_STYLES[currentStatus] || STATUS_STYLES.Pending;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs">
                                  {idx + 1}
                                </td>
                                <td className="py-3 px-3.5 font-medium text-slate-900">
                                  <button
                                    onClick={() => openHistory(item.id, item.checklist_number)}
                                    className="hover:underline hover:text-blue-600 text-left cursor-pointer"
                                    title="View audit history"
                                  >
                                    {item.checklist_number || item.id.slice(0, 8)}
                                  </button>
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {item.service_engineer || 'Unassigned'}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {formatDisplayDate(
                                    cb.outbound_departure_datetime || cb.travel_datetime || item.expected_arrival_date
                                  )}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {cb.outbound_destination || cb.destination || item.client_location || '—'}
                                </td>
                                <td className="py-3 px-3.5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot}`} />
                                    {currentStatus}
                                  </span>
                                </td>
                                <td className="py-3 px-3.5">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </td>
                                <td className="py-3 px-3.5 text-right pr-4">
                                  <button
                                    onClick={() => handleSaveStatus(item, 'outbound')}
                                    disabled={!isChanged || isSaving}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                      isChanged
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    {isSaving ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span>Save</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* -------------------------------------------------------- */}
                {/* 3. ROOM BOOKINGS TABLE */}
                {/* -------------------------------------------------------- */}
                {activeSection === 'room' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-3.5 w-12 text-center">#</th>
                          <th className="py-3 px-3.5">Job ID</th>
                          <th className="py-3 px-3.5">Technician</th>
                          <th className="py-3 px-3.5">Original Date</th>
                          <th className="py-3 px-3.5">Revised Date</th>
                          <th className="py-3 px-3.5">Destination</th>
                          <th className="py-3 px-3.5">Current Status</th>
                          <th className="py-3 px-3.5">Update Status</th>
                          <th className="py-3 px-3.5 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredChecklists.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-12 text-center text-slate-400 text-sm">
                              No room booking records found
                            </td>
                          </tr>
                        ) : (
                          filteredChecklists.map((item, idx) => {
                            const cb = item.coordinator_booking || {};
                            const currentStatus = cb.accommodation_status || 'Pending';
                            const selectedDraft = statusDrafts[item.id] || currentStatus;
                            const isChanged = selectedDraft !== currentStatus;
                            const isSaving = savingStatusId === item.id;
                            const badgeStyle = STATUS_STYLES[currentStatus] || STATUS_STYLES.Pending;

                            const origDate =
                              cb.original_installation_date ||
                              item.original_expected_arrival_date ||
                              item.expected_arrival_date;
                            const revDate = cb.revised_installation_date;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs">
                                  {idx + 1}
                                </td>
                                <td className="py-3 px-3.5 font-medium text-slate-900">
                                  <button
                                    onClick={() => openHistory(item.id, item.checklist_number)}
                                    className="hover:underline hover:text-blue-600 text-left cursor-pointer"
                                    title="View audit history"
                                  >
                                    {item.checklist_number || item.id.slice(0, 8)}
                                  </button>
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {item.service_engineer || 'Unassigned'}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {formatDisplayDate(origDate)}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700 font-medium">
                                  {revDate ? (
                                    <span className="text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                                      {formatDisplayDate(revDate)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {cb.outbound_destination || item.client_location || '—'}
                                </td>
                                <td className="py-3 px-3.5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot}`} />
                                    {currentStatus}
                                  </span>
                                </td>
                                <td className="py-3 px-3.5">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Pending Review">Pending Review</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </td>
                                <td className="py-3 px-3.5 text-right pr-4">
                                  <button
                                    onClick={() => handleSaveStatus(item, 'room')}
                                    disabled={!isChanged || isSaving}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                      isChanged
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    {isSaving ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span>Save</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* -------------------------------------------------------- */}
                {/* 4. RETURN TICKETS TABLE */}
                {/* -------------------------------------------------------- */}
                {activeSection === 'return' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-3.5 w-12 text-center">#</th>
                          <th className="py-3 px-3.5">Job ID</th>
                          <th className="py-3 px-3.5">Technician</th>
                          <th className="py-3 px-3.5">Post-Install Submission</th>
                          <th className="py-3 px-3.5">Destination</th>
                          <th className="py-3 px-3.5">Current Status</th>
                          <th className="py-3 px-3.5">Update Status</th>
                          <th className="py-3 px-3.5 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredChecklists.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                              No return-ticket requests awaiting coordinator action.
                              <br />
                              <span className="text-xs text-slate-400 mt-1 block">
                                Return-ticket requests are created only after the associated technician submits the post-installation form.
                              </span>
                            </td>
                          </tr>
                        ) : (
                          filteredChecklists.map((item, idx) => {
                            const cb = item.coordinator_booking || {};
                            const currentStatus = cb.return_status || 'Pending';
                            const selectedDraft = statusDrafts[item.id] || currentStatus;
                            const isChanged = selectedDraft !== currentStatus;
                            const isSaving = savingStatusId === item.id;
                            const badgeStyle = STATUS_STYLES[currentStatus] || STATUS_STYLES.Pending;

                            const submissionDate =
                              cb.report_submission_datetime ||
                              cb.actual_completion_datetime ||
                              item.actual_completion_datetime;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs">
                                  {idx + 1}
                                </td>
                                <td className="py-3 px-3.5 font-medium text-slate-900">
                                  <button
                                    onClick={() => openHistory(item.id, item.checklist_number)}
                                    className="hover:underline hover:text-blue-600 text-left cursor-pointer"
                                    title="View audit history"
                                  >
                                    {item.checklist_number || item.id.slice(0, 8)}
                                  </button>
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {item.service_engineer || 'Unassigned'}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {formatDisplayDate(submissionDate)}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {cb.return_destination || cb.outbound_origin || 'Base Office'}
                                </td>
                                <td className="py-3 px-3.5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot}`} />
                                    {currentStatus}
                                  </span>
                                </td>
                                <td className="py-3 px-3.5">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </td>
                                <td className="py-3 px-3.5 text-right pr-4">
                                  <button
                                    onClick={() => handleSaveStatus(item, 'return')}
                                    disabled={!isChanged || isSaving}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                      isChanged
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    {isSaving ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span>Save</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* -------------------------------------------------------- */}
                {/* 5. EXTENSION REVIEWS TABLE */}
                {/* -------------------------------------------------------- */}
                {activeSection === 'extensions' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-3.5">Job ID</th>
                          <th className="py-3 px-3.5">Technician</th>
                          <th className="py-3 px-3.5">Previous Date</th>
                          <th className="py-3 px-3.5">Revised Date</th>
                          <th className="py-3 px-3.5">Room Booking Status</th>
                          <th className="py-3 px-3.5">Update Status</th>
                          <th className="py-3 px-3.5 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredChecklists.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                              No room bookings currently awaiting extension review.
                              <br />
                              <span className="text-xs text-slate-400 mt-1 block">
                                When an installation schedule date is extended or changed, the affected room booking automatically appears here.
                              </span>
                            </td>
                          </tr>
                        ) : (
                          filteredChecklists.map((item) => {
                            const cb = item.coordinator_booking || {};
                            const currentStatus = cb.accommodation_status || 'Pending Review';
                            const selectedDraft = statusDrafts[item.id] || currentStatus;
                            const isChanged = selectedDraft !== currentStatus;
                            const isSaving = savingStatusId === item.id;

                            const origDate =
                              cb.original_installation_date ||
                              item.original_expected_arrival_date ||
                              item.expected_arrival_date;
                            const revDate = cb.revised_installation_date || item.current_booking_end_date;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3.5 font-medium text-slate-900">
                                  <button
                                    onClick={() => openHistory(item.id, item.checklist_number)}
                                    className="hover:underline hover:text-blue-600 text-left cursor-pointer"
                                    title="View audit history"
                                  >
                                    {item.checklist_number || item.id.slice(0, 8)}
                                  </button>
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {item.service_engineer || 'Unassigned'}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700">
                                  {formatDisplayDate(origDate)}
                                </td>
                                <td className="py-3 px-3.5 text-purple-700 font-semibold">
                                  {formatDisplayDate(revDate)}
                                </td>
                                <td className="py-3 px-3.5">
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                    {currentStatus}
                                  </span>
                                </td>
                                <td className="py-3 px-3.5">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer"
                                  >
                                    <option value="Pending Review">Pending Review</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                    <option value="Pending">Pending</option>
                                  </select>
                                </td>
                                <td className="py-3 px-3.5 text-right pr-4">
                                  <button
                                    onClick={() => handleSaveStatus(item, 'room')}
                                    disabled={!isChanged || isSaving}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                      isChanged
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    {isSaving ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span>Save Room Status</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* -------------------------------------------------------- */}
                {/* 6. SCHEDULE CONFLICTS TABLE */}
                {/* -------------------------------------------------------- */}
                {activeSection === 'conflicts' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-3.5">Job ID</th>
                          <th className="py-3 px-3.5">Technician</th>
                          <th className="py-3 px-3.5">Conflicting Dates</th>
                          <th className="py-3 px-3.5">Conflict Description</th>
                          <th className="py-3 px-3.5">Review Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {conflicts.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">
                              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                              No technician schedule conflicts detected. All schedules are aligned.
                            </td>
                          </tr>
                        ) : (
                          conflicts.map((c, idx) => {
                            const jobId =
                              c.commitment_a?.checklist_number ||
                              c.commitment_a?.checklist_id ||
                              c.commitment_b?.checklist_number ||
                              'N/A';
                            const dates = `${formatDisplayDate(c.overlap_start)} – ${formatDisplayDate(
                              c.overlap_end
                            )}`;
                            const desc = `Overlap between ${c.commitment_a?.title || c.commitment_a?.type || 'Job A'} and ${
                              c.commitment_b?.title || c.commitment_b?.type || 'Job B'
                            }`;

                            return (
                              <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3.5 font-medium text-slate-900 font-mono text-xs">
                                  {jobId}
                                </td>
                                <td className="py-3 px-3.5 text-slate-700 font-medium">
                                  {c.engineer_name}
                                </td>
                                <td className="py-3 px-3.5 text-rose-700 font-semibold">
                                  {dates}
                                </td>
                                <td className="py-3 px-3.5 text-slate-600 max-w-xs">{desc}</td>
                                <td className="py-3 px-3.5">
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                    <AlertTriangle className="w-3 h-3 text-rose-500" />
                                    Conflict Detected
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* AUDIT HISTORY MODAL */}
      {/* ============================================================ */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  Audit History: {historyModal.checklistNumber}
                </h3>
              </div>
              <button
                onClick={() => setHistoryModal({ ...historyModal, open: false })}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-100">
              {historyModal.loading ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                  Loading history trail...
                </div>
              ) : historyModal.logs.length === 0 ? (
                <p className="py-8 text-center text-slate-400 text-xs">
                  No previous audit records recorded for this booking.
                </p>
              ) : (
                historyModal.logs.map((log, i) => (
                  <div key={log.id || i} className="py-3 first:pt-0 last:pb-0 text-xs">
                    <div className="flex items-center justify-between text-slate-500 mb-1">
                      <span className="font-semibold text-slate-800">{log.action}</span>
                      <span>{formatDisplayDate(log.created_at)}</span>
                    </div>
                    <p className="text-slate-600">{log.notes || 'No notes provided'}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Changed by: {log.changed_by_email || 'Coordinator'}</span>
                      {log.new_status && (
                        <span>
                          • Status: <strong>{log.new_status}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setHistoryModal({ ...historyModal, open: false })}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
