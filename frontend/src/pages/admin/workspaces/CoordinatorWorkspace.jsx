import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../lib/supabase';
import {
  fetchCoordinatorBookings,
  saveCoordinatorBookingApi,
  fetchCoordinatorBookingHistory,
  updateCoordinatorOutboundStatusApi,
  updateCoordinatorRoomStatusApi,
  updateCoordinatorReturnStatusApi,
  fetchCoordinatorScheduleConflicts,
  deleteCoordinatorScheduleConflict,
  clearAllCoordinatorScheduleConflicts,
  fetchCoordinatorNotifications,
  markCoordinatorNotificationReadApi,
  markCoordinatorAllNotificationsReadApi,
  deleteAllCoordinatorNotifications,
  fetchInstallationCompletionReport,
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
  Trash2,
  Menu,
  X,
  ChevronRight,
  Calendar,
  Check,
  CheckCheck,
  Eye,
  Bell,
  ArrowRight,
  Sparkles,
  UserCheck,
  MapPin,
  FileText,
  Inbox,
  Wrench,
  Loader2,
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

const SECTION_NAMES = {
  outbound: 'Outbound Travel',
  room: 'Room Bookings',
  return: 'Return Tickets',
  extensions: 'Extension Reviews',
  conflicts: 'Schedule Conflicts',
};

export default function CoordinatorWorkspace() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active Navigation Section: 'outbound' | 'room' | 'return' | 'extensions' | 'conflicts'
  const sectionParam = searchParams.get('tab') || searchParams.get('section');
  const [activeSection, setActiveSectionState] = useState(() => {
    if (['outbound', 'room', 'return', 'extensions', 'conflicts'].includes(sectionParam)) {
      return sectionParam;
    }
    return 'outbound';
  });

  const setActiveSection = (sec) => {
    setActiveSectionState(sec);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', sec);
        return next;
      },
      { replace: true }
    );
  };

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

  // Post-Installation Completion Report Modal State
  const [reportModal, setReportModal] = useState({
    open: false,
    checklistId: null,
    checklistNumber: '',
    clientName: '',
    serviceEngineer: '',
    report: null,
    loading: false,
    error: null,
  });

  // Notifications State
  const [notifications, setNotifications] = useState([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Schedule Conflict Deletion State
  const [deletingConflictId, setDeletingConflictId] = useState(null);
  const [confirmClearAllConflicts, setConfirmClearAllConflicts] = useState(false);

  // Show Toast Helper
  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Delete Individual Schedule Conflict from History
  const handleDeleteConflict = async (c) => {
    if (!c || !token) return;
    const conflictId = c.id || `${c.engineer_id}_${c.commitment_a?.id}_${c.commitment_b?.id}_${c.overlap_start}_${c.overlap_end}`;
    setDeletingConflictId(conflictId);
    try {
      await deleteCoordinatorScheduleConflict(token, conflictId);
      setConflicts((prev) =>
        prev.filter((item) => {
          const itemId =
            item.id ||
            `${item.engineer_id}_${item.commitment_a?.id}_${item.commitment_b?.id}_${item.overlap_start}_${item.overlap_end}`;
          return itemId !== conflictId;
        })
      );
      showToast('success', 'Schedule conflict deleted from history');
    } catch (err) {
      console.error('Failed to delete conflict:', err);
      showToast('error', err.message || 'Failed to delete conflict from history');
    } finally {
      setDeletingConflictId(null);
    }
  };

  // Clear All Schedule Conflicts from History
  const handleClearAllConflicts = async () => {
    if (!token || conflicts.length === 0) return;
    setDeletingConflictId('ALL');
    try {
      const ids = conflicts.map(
        (c) =>
          c.id ||
          `${c.engineer_id}_${c.commitment_a?.id}_${c.commitment_b?.id}_${c.overlap_start}_${c.overlap_end}`
      );
      await clearAllCoordinatorScheduleConflicts(token, ids);
      setConflicts([]);
      setConfirmClearAllConflicts(false);
      showToast('success', 'All schedule conflict history cleared successfully');
    } catch (err) {
      console.error('Failed to clear conflict history:', err);
      showToast('error', err.message || 'Failed to clear schedule conflict history');
    } finally {
      setDeletingConflictId(null);
    }
  };

  const openReportModal = useCallback(
    async (checklistId, checklistNumber = '', clientName = '', serviceEngineer = '') => {
      setReportModal({
        open: true,
        checklistId,
        checklistNumber,
        clientName,
        serviceEngineer,
        report: null,
        loading: true,
        error: null,
      });
      try {
        const rep = await fetchInstallationCompletionReport(token, checklistId);
        setReportModal((prev) => ({
          ...prev,
          report: rep,
          loading: false,
        }));
      } catch (err) {
        setReportModal((prev) => ({
          ...prev,
          loading: false,
          error: err.message || 'Failed to load completion report',
        }));
      }
    },
    [token]
  );

  // Close drawer on Escape key and prevent body scrolling when open
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen]);

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

  // Live Notifications & Tasks Auto-Sync (Supabase Realtime + Visibility-Aware Live Interval)
  useEffect(() => {
    if (!token) return;

    let channel = null;
    try {
      if (supabase && typeof supabase.channel === 'function') {
        channel = supabase
          .channel('coordinator_workspace_notifs')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_notifications' },
            (payload) => {
              if (
                payload.new?.target_role === 'COORDINATOR' ||
                !payload.new?.target_role ||
                payload.eventType === 'DELETE'
              ) {
                // Refresh notifications immediately and refresh tasks silently in background
                fetchCoordinatorNotifications(token)
                  .then((res) => {
                    if (res?.notifications) {
                      setNotifications(res.notifications);
                    }
                  })
                  .catch(() => {});
                fetchCoordinatorBookings(token, { limit: 200, tab: 'all' })
                  .then((res) => {
                    if (res?.checklists) setChecklists(res.checklists);
                    if (res?.stats) setStats(res.stats);
                  })
                  .catch(() => {});
              }
            }
          )
          .subscribe();
      }
    } catch (realtimeErr) {
      console.warn('Realtime subscription fallback:', realtimeErr.message);
    }

    // High-reliability live interval (every 15s when active tab is visible)
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchCoordinatorNotifications(token)
          .then((res) => {
            if (res?.notifications) {
              setNotifications((prev) => {
                const prevUnread = prev.filter((n) => !n.is_read).length;
                const newUnread = res.notifications.filter((n) => !n.is_read).length;
                if (newUnread > prevUnread || res.notifications.length > prev.length) {
                  // New notification arrived! Silently sync bookings task list
                  fetchCoordinatorBookings(token, { limit: 200, tab: 'all' })
                    .then((bRes) => {
                      if (bRes?.checklists) setChecklists(bRes.checklists);
                      if (bRes?.stats) setStats(bRes.stats);
                    })
                    .catch(() => {});
                }
                return res.notifications;
              });
            }
          })
          .catch(() => {});
      }
    }, 15000);

    return () => {
      clearInterval(intervalId);
      if (channel && supabase && typeof supabase.removeChannel === 'function') {
        supabase.removeChannel(channel);
      }
    };
  }, [token]);

  // Deep link support: auto-open report if query parameters exist (?tab=return&checklist=...&openReport=true)
  useEffect(() => {
    const chkParam = searchParams.get('checklist');
    const openReportParam = searchParams.get('openReport');
    const actionParam = searchParams.get('action');
    if (chkParam && (openReportParam === 'true' || actionParam === 'review_report')) {
      const match = checklists.find((c) => c.id === chkParam);
      openReportModal(
        chkParam,
        match?.checklist_number || '',
        match?.client_name || '',
        match?.service_engineer || ''
      );
    }
  }, [searchParams, checklists, openReportModal]);

  // Click on Notification item in dropdown
  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      try {
        await markCoordinatorNotificationReadApi(token, notif.id);
      } catch (err) {
        console.warn('Failed to mark notification read:', err);
      }
    }
    setShowNotifDropdown(false);

    const chkId = notif.checklist_id || notif.metadata?.checklist_id;
    const chkNum = notif.checklist_number || notif.metadata?.checklist_number;
    const clientName = notif.metadata?.client_name || '';
    const techName = notif.metadata?.technician_name || '';

    if (
      notif.type === 'POST_INSTALLATION_REPORT_SUBMITTED' ||
      notif.type?.includes('RETURN_TICKET') ||
      notif.metadata?.task_type === 'POST_INSTALLATION_REPORT' ||
      notif.title?.includes('Post-Installation')
    ) {
      setActiveSection('return');
      if (chkNum) setSearchTerm(chkNum);
      if (chkId) {
        openReportModal(chkId, chkNum, clientName, techName);
      }
    } else if (chkNum) {
      setSearchTerm(chkNum);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await markCoordinatorAllNotificationsReadApi(token);
      showToast('success', 'All notifications marked as read');
    } catch (err) {
      showToast('error', 'Failed to mark all as read');
    }
  };

  const handleClearAllNotifications = async () => {
    setNotifications([]);
    try {
      await deleteAllCoordinatorNotifications(token);
      showToast('success', 'Notifications cleared');
    } catch (err) {
      showToast('error', 'Failed to clear notifications');
    }
  };

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

      showToast(
        'success',
        `${
          sectionType === 'outbound'
            ? 'Outbound travel'
            : sectionType === 'room'
            ? 'Room booking'
            : 'Return ticket'
        } status updated to "${selectedStatus}".`
      );

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
    <div className="w-full flex flex-col lg:flex-row items-start gap-4 lg:gap-6 font-sans text-slate-800">
      {/* Toast Notification Banner */}
      {toast && (
        <div
          className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 z-50 flex items-center gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-xl shadow-lg border text-xs sm:text-sm font-medium transition-all animate-in fade-in slide-in-from-bottom-2 ${
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
          <span className="truncate">{toast.message}</span>
        </div>
      )}

      {/* Mobile Backdrop for Sidebar Drawer */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* ============================================================ */}
      {/* 1. MOBILE NAVIGATION DRAWER (< lg)                           */}
      {/* ============================================================ */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-2xl p-4 flex flex-col justify-between transition-transform duration-200 ease-in-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Coordinator Navigation Drawer"
      >
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                Coordinator Sections
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              aria-label="Close navigation drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="space-y-1.5 w-full" aria-label="Coordinator Mobile Sections">
            {/* Outbound Travel */}
            <button
              type="button"
              onClick={() => {
                setActiveSection('outbound');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeSection === 'outbound'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Bus className={`w-4 h-4 shrink-0 ${activeSection === 'outbound' ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">Outbound Travel</span>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-bold rounded-full tabular-nums shrink-0 ${
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
              type="button"
              onClick={() => {
                setActiveSection('room');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeSection === 'room'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Building className={`w-4 h-4 shrink-0 ${activeSection === 'room' ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">Room Bookings</span>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-bold rounded-full tabular-nums shrink-0 ${
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
              type="button"
              onClick={() => {
                setActiveSection('return');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeSection === 'return'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Ticket className={`w-4 h-4 shrink-0 ${activeSection === 'return' ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">Return Tickets</span>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-bold rounded-full tabular-nums shrink-0 ${
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
              type="button"
              onClick={() => {
                setActiveSection('extensions');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeSection === 'extensions'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Clock className={`w-4 h-4 shrink-0 ${activeSection === 'extensions' ? 'text-white' : 'text-purple-500'}`} />
                <span className="truncate">Extension Reviews</span>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-bold rounded-full tabular-nums shrink-0 ${
                  activeSection === 'extensions'
                    ? 'bg-white/20 text-white'
                    : 'bg-purple-100 text-purple-800 font-bold'
                }`}
              >
                {navBadges.extensions}
              </span>
            </button>

            {/* Schedule Conflicts */}
            <button
              type="button"
              onClick={() => {
                setActiveSection('conflicts');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeSection === 'conflicts'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className={`w-4 h-4 shrink-0 ${activeSection === 'conflicts' ? 'text-white' : 'text-rose-500'}`} />
                <span className="truncate">Schedule Conflicts</span>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-bold rounded-full tabular-nums shrink-0 ${
                  activeSection === 'conflicts'
                    ? 'bg-white/20 text-white'
                    : 'bg-rose-100 text-rose-800 font-bold'
                }`}
              >
                {navBadges.conflicts}
              </span>
            </button>
          </nav>
        </div>

        {/* Quick Info Box in Mobile Drawer */}
        <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 shrink-0">
          <p className="font-bold text-slate-800 mb-0.5 flex items-center gap-1.5 text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            Coordinator Role
          </p>
          <p className="leading-snug text-[10px] text-slate-500">
            Manage travel & room booking statuses directly. Verification and audits persist live.
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. DESKTOP SIDEBAR NAVIGATION (>= lg)                        */}
      {/* ============================================================ */}
      <aside className="hidden lg:flex flex-col gap-1 w-60 shrink-0 sticky top-20">
        <nav className="space-y-1 w-full" aria-label="Coordinator Desktop Sections">
          {/* Outbound Travel */}
          <button
            type="button"
            onClick={() => setActiveSection('outbound')}
            className={`w-full flex items-center justify-between px-3.5 h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeSection === 'outbound'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Bus className={`w-4 h-4 shrink-0 ${activeSection === 'outbound' ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate">Outbound Travel</span>
            </div>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full tabular-nums shrink-0 ${
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
            type="button"
            onClick={() => setActiveSection('room')}
            className={`w-full flex items-center justify-between px-3.5 h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeSection === 'room'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Building className={`w-4 h-4 shrink-0 ${activeSection === 'room' ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate">Room Bookings</span>
            </div>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full tabular-nums shrink-0 ${
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
            type="button"
            onClick={() => setActiveSection('return')}
            className={`w-full flex items-center justify-between px-3.5 h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeSection === 'return'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Ticket className={`w-4 h-4 shrink-0 ${activeSection === 'return' ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate">Return Tickets</span>
            </div>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full tabular-nums shrink-0 ${
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
            type="button"
            onClick={() => setActiveSection('extensions')}
            className={`w-full flex items-center justify-between px-3.5 h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeSection === 'extensions'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Clock className={`w-4 h-4 shrink-0 ${activeSection === 'extensions' ? 'text-white' : 'text-purple-500'}`} />
              <span className="truncate">Extension Reviews</span>
            </div>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full tabular-nums shrink-0 ${
                activeSection === 'extensions'
                  ? 'bg-white/20 text-white'
                  : 'bg-purple-100 text-purple-800 font-bold'
              }`}
            >
              {navBadges.extensions}
            </span>
          </button>

          {/* Schedule Conflicts */}
          <button
            type="button"
            onClick={() => setActiveSection('conflicts')}
            className={`w-full flex items-center justify-between px-3.5 h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeSection === 'conflicts'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle className={`w-4 h-4 shrink-0 ${activeSection === 'conflicts' ? 'text-white' : 'text-rose-500'}`} />
              <span className="truncate">Schedule Conflicts</span>
            </div>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full tabular-nums shrink-0 ${
                activeSection === 'conflicts'
                  ? 'bg-white/20 text-white'
                  : 'bg-rose-100 text-rose-800 font-bold'
              }`}
            >
              {navBadges.conflicts}
            </span>
          </button>
        </nav>

        {/* Quick Info Box in Desktop Sidebar */}
        <div className="mt-4 p-3.5 rounded-xl bg-slate-100/80 border border-slate-200 text-xs text-slate-600">
          <p className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            Coordinator Role
          </p>
          <p className="leading-relaxed text-[11px] text-slate-600">
            Manage travel & room booking statuses directly. Verification and audits persist live.
          </p>
        </div>
      </aside>

      {/* ============================================================ */}
      {/* 3. MAIN CONTENT WORKSPACE                                    */}
      {/* ============================================================ */}
      <main className="flex-1 flex flex-col gap-4 sm:gap-5 min-w-0 w-full">
        {/* Top Actions: Search, Notifications & Refresh Toolbar */}
        <div className="flex flex-col gap-2.5 sm:gap-3 w-full">
          {/* Row 1: Sections button (mobile only) + Search Input taking full remaining width */}
          <div className="flex items-center gap-2 w-full">
            {/* Mobile Sections Toggle (visible on < lg) */}
            <button
              type="button"
              id="coordinator-sections-toggle"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center justify-center gap-1.5 h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-2xs shrink-0 cursor-pointer min-w-[92px]"
              aria-label="Open sections navigation drawer"
            >
              <Menu className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Sections</span>
            </button>

            {/* Search Input (flexible width) */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search Job ID, Tech, Destination..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-9 pr-8 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-2xs"
                aria-label="Search records by Job ID, technician, or destination"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
                  title="Clear search"
                  aria-label="Clear search text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Desktop Action Controls (sm+) */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {/* Coordinator In-App Notifications Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  id="coordinator-notifications-button-desktop"
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="relative inline-flex items-center justify-center h-10 w-10 bg-white border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                  title="Coordinator Notifications"
                  aria-label="View coordinator notifications"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.some((n) => !n.is_read) && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow-xs">
                      {notifications.filter((n) => !n.is_read).length > 9 ? '9+' : notifications.filter((n) => !n.is_read).length}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div className="absolute right-0 mt-2 w-88 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                          Notifications
                        </span>
                        {notifications.some((n) => !n.is_read) && (
                          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                            {notifications.filter((n) => !n.is_read).length} new
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {notifications.some((n) => !n.is_read) && (
                          <button
                            type="button"
                            onClick={handleMarkAllNotificationsRead}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer inline-flex items-center gap-1"
                            title="Mark all as read"
                          >
                            <CheckCheck className="w-3 h-3" />
                            <span>Mark read</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowNotifDropdown(false)}
                          className="text-xs text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
                          aria-label="Close notifications"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-1.5">
                          <Inbox className="w-6 h-6 text-slate-300" />
                          <p className="text-xs font-medium">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.slice(0, 15).map((n) => (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={`p-3 text-left transition-colors cursor-pointer ${
                              !n.is_read ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                                <span>{n.title}</span>
                              </p>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {formatDisplayDate(n.created_at)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                              {n.message}
                            </p>
                            {(n.type === 'POST_INSTALLATION_REPORT_SUBMITTED' ||
                              n.title?.includes('Post-Installation') ||
                              n.checklist_id) && (
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-[10px] font-mono text-slate-400">
                                  {n.checklist_number || n.metadata?.checklist_number || ''}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800">
                                  <span>Review Report</span>
                                  <ArrowRight className="w-3 h-3" />
                                </span>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={() => loadDashboardData(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Refresh dashboard data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
                <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* Row 2 on Mobile (< sm): Section label on left, Notifications & Refresh on right */}
          <div className="flex sm:hidden items-center justify-between gap-2 w-full pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                View:
              </span>
              <span className="text-xs font-bold text-slate-800 truncate">
                {SECTION_NAMES[activeSection]}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 tabular-nums shrink-0">
                {filteredChecklists.length}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Mobile In-App Notifications Button */}
              <div className="relative">
                <button
                  type="button"
                  id="coordinator-notifications-button-mobile"
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="relative inline-flex items-center justify-center h-9 w-9 bg-white border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                  title="Coordinator Notifications"
                  aria-label="View coordinator notifications"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.some((n) => !n.is_read) && (
                    <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white shadow-xs">
                      {notifications.filter((n) => !n.is_read).length > 9 ? '9+' : notifications.filter((n) => !n.is_read).length}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div className="absolute right-0 mt-2 w-[calc(100vw-28px)] max-w-xs bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                    <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                          Notifications
                        </span>
                        {notifications.some((n) => !n.is_read) && (
                          <span className="px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                            {notifications.filter((n) => !n.is_read).length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {notifications.some((n) => !n.is_read) && (
                          <button
                            type="button"
                            onClick={handleMarkAllNotificationsRead}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                          >
                            Mark read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowNotifDropdown(false)}
                          className="text-xs text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
                          aria-label="Close notifications"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="p-5 text-center text-slate-400 flex flex-col items-center gap-1">
                          <Inbox className="w-5 h-5 text-slate-300" />
                          <p className="text-xs font-medium">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.slice(0, 15).map((n) => (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={`p-2.5 text-left transition-colors cursor-pointer ${
                              !n.is_read ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-xs font-bold text-slate-800 flex items-center gap-1">
                                {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                                <span>{n.title}</span>
                              </p>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {formatDisplayDate(n.created_at)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                              {n.message}
                            </p>
                            {(n.type === 'POST_INSTALLATION_REPORT_SUBMITTED' ||
                              n.title?.includes('Post-Installation') ||
                              n.checklist_id) && (
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className="text-[10px] font-mono text-slate-400">
                                  {n.checklist_number || n.metadata?.checklist_number || ''}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600">
                                  <span>Review Report</span>
                                  <ArrowRight className="w-3 h-3" />
                                </span>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile Refresh Button */}
              <button
                type="button"
                onClick={() => loadDashboardData(true)}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Refresh data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
                <span className="hidden xs:inline">{refreshing ? '...' : 'Refresh'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 4. DASHBOARD SUMMARY CARDS (DYNAMIC PER ACTIVE VIEW)         */}
        {/* ============================================================ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3">
          {activeSection === 'outbound' && (
            <>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider block mb-0.5 truncate">
                  Pending
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.outbound_pending}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-blue-700 uppercase tracking-wider block mb-0.5 truncate">
                  Booked
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.outbound_booked}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-0.5 truncate">
                  Confirmed
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.outbound_confirmed}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-rose-700 uppercase tracking-wider block mb-0.5 truncate">
                  Cancelled
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.outbound_cancelled}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300 col-span-2 sm:col-span-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block mb-0.5 truncate">
                  Total Jobs
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.outbound_total}
                </span>
              </div>
            </>
          )}

          {activeSection === 'room' && (
            <>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider block mb-0.5 truncate">
                  Pending
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_pending}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-purple-200 bg-purple-50/20 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-purple-300">
                <span className="text-[10px] sm:text-xs font-bold text-purple-700 uppercase tracking-wider block mb-0.5 truncate">
                  Pending Review
                </span>
                <span className="text-lg sm:text-2xl font-black text-purple-900 tabular-nums leading-none">
                  {stats.room_pending_review}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-blue-700 uppercase tracking-wider block mb-0.5 truncate">
                  Booked
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_booked}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-0.5 truncate">
                  Confirmed
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_confirmed}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300 col-span-2 sm:col-span-1">
                <span className="text-[10px] sm:text-xs font-bold text-rose-700 uppercase tracking-wider block mb-0.5 truncate">
                  Cancelled
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_cancelled}
                </span>
              </div>
            </>
          )}

          {activeSection === 'return' && (
            <>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider block mb-0.5 truncate">
                  Pending
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.return_pending}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-blue-700 uppercase tracking-wider block mb-0.5 truncate">
                  Booked
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.return_booked}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-0.5 truncate">
                  Confirmed
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.return_confirmed}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-rose-700 uppercase tracking-wider block mb-0.5 truncate">
                  Cancelled
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.return_cancelled}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300 col-span-2 sm:col-span-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block mb-0.5 truncate">
                  Active Requests
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.return_total}
                </span>
              </div>
            </>
          )}

          {activeSection === 'extensions' && (
            <>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-purple-200 bg-purple-50/20 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-purple-300">
                <span className="text-[10px] sm:text-xs font-bold text-purple-700 uppercase tracking-wider block mb-0.5 truncate">
                  Awaiting Review
                </span>
                <span className="text-lg sm:text-2xl font-black text-purple-900 tabular-nums leading-none">
                  {stats.extension_reviews}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-0.5 truncate">
                  Rooms Confirmed
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_confirmed}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-blue-700 uppercase tracking-wider block mb-0.5 truncate">
                  Rooms Booked
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_booked}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block mb-0.5 truncate">
                  Total Rooms
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {stats.room_total}
                </span>
              </div>
            </>
          )}

          {activeSection === 'conflicts' && (
            <>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-rose-300">
                <span className="text-[10px] sm:text-xs font-bold text-rose-700 uppercase tracking-wider block mb-0.5 truncate">
                  Active Conflicts
                </span>
                <span className="text-lg sm:text-2xl font-black text-rose-900 tabular-nums leading-none">
                  {conflicts.length}
                </span>
              </div>
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between min-h-[64px] sm:min-h-[76px] transition-all hover:border-slate-300">
                <span className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider block mb-0.5 truncate">
                  Engineers Involved
                </span>
                <span className="text-lg sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                  {new Set(conflicts.map((c) => c.engineer_name)).size}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/* 5. RECORDS CONTAINER: RESPONSIVE CARDS (MOBILE) & TABLE (DESKTOP) */}
        {/* ============================================================ */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-8 sm:p-12 flex flex-col items-center justify-center text-slate-400">
              <RefreshCw className="w-7 h-7 sm:w-8 sm:h-8 animate-spin text-blue-600 mb-2" />
              <p className="text-xs sm:text-sm font-medium">Loading live logistics data...</p>
            </div>
          ) : (
            <>
              {/* -------------------------------------------------------- */}
              {/* SECTION: OUTBOUND TRAVEL                                 */}
              {/* -------------------------------------------------------- */}
              {activeSection === 'outbound' && (
                <>
                  {filteredChecklists.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center text-slate-400">
                      <Bus className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-slate-600">
                        No outbound travel records found
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Mobile Record Cards (< md) */}
                      <div className="block md:hidden divide-y divide-slate-100 p-2.5 sm:p-3 space-y-3">
                        {filteredChecklists.map((item) => {
                          const cb = item.coordinator_booking || {};
                          const currentStatus = cb.outbound_status || 'Pending';
                          const selectedDraft = statusDrafts[item.id] || currentStatus;
                          const isChanged = selectedDraft !== currentStatus;
                          const isSaving = savingStatusId === item.id;
                          const badgeStyle = STATUS_STYLES[currentStatus] || STATUS_STYLES.Pending;
                          const travelDate =
                            cb.outbound_departure_datetime || cb.travel_datetime || item.expected_arrival_date;
                          const destination =
                            cb.outbound_destination || cb.destination || item.client_location || '—';

                          return (
                            <div
                              key={item.id}
                              className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2.5 transition-all"
                            >
                              {/* Header: Job ID + Status Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openHistory(item.id, item.checklist_number)}
                                  className="text-xs font-mono font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                                  title="View audit history"
                                >
                                  <span>{item.checklist_number || item.id.slice(0, 8)}</span>
                                  <History size={12} className="text-slate-400" />
                                </button>
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                  <span>{currentStatus}</span>
                                </span>
                              </div>

                              {/* Technician & Client */}
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                                  <UserCheck size={13} className="text-blue-600 shrink-0" />
                                  <span className="truncate">{item.service_engineer || 'Unassigned Technician'}</span>
                                </div>
                                {item.client_name && (
                                  <p className="text-[11px] text-slate-600 truncate pl-4.5">
                                    Client: {item.client_name}
                                  </p>
                                )}
                              </div>

                              {/* Date & Destination */}
                              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Travel Date
                                  </span>
                                  <div className="flex items-center gap-1 text-slate-700 font-medium mt-0.5">
                                    <Calendar size={12} className="text-slate-400 shrink-0" />
                                    <span>{formatDisplayDate(travelDate)}</span>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Destination
                                  </span>
                                  <div className="flex items-center gap-1 text-slate-700 font-medium mt-0.5">
                                    <MapPin size={12} className="text-slate-400 shrink-0" />
                                    <span className="truncate" title={destination}>
                                      {destination}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Status Update Dropdown + Save Button */}
                              <div className="pt-1 flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="w-full h-9 bg-white border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    aria-label="Update outbound travel status"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveStatus(item, 'outbound')}
                                  disabled={!isChanged || isSaving}
                                  className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    isChanged
                                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
                                  }`}
                                >
                                  {isSaving ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>Save</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (>= md) */}
                      <div className="hidden md:block overflow-x-auto w-full">
                        <table className="w-full min-w-[960px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                              <th className="py-3 px-3.5 w-12 text-center">#</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Job ID</th>
                              <th className="py-3 px-3.5 w-44 whitespace-nowrap">Technician</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Travel Date</th>
                              <th className="py-3 px-3.5 min-w-[140px]">Destination</th>
                              <th className="py-3 px-3.5 w-36 whitespace-nowrap">Current Status</th>
                              <th className="py-3 px-3.5 w-40 whitespace-nowrap">Update Status</th>
                              <th className="py-3 px-3.5 w-24 text-right pr-5 whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredChecklists.map((item, idx) => {
                              const cb = item.coordinator_booking || {};
                              const currentStatus = cb.outbound_status || 'Pending';
                              const selectedDraft = statusDrafts[item.id] || currentStatus;
                              const isChanged = selectedDraft !== currentStatus;
                              const isSaving = savingStatusId === item.id;
                              const badgeStyle = STATUS_STYLES[currentStatus] || STATUS_STYLES.Pending;

                              return (
                                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                  <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs align-middle">
                                    {idx + 1}
                                  </td>
                                  <td className="py-3 px-3.5 font-medium text-slate-900 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => openHistory(item.id, item.checklist_number)}
                                      className="hover:underline hover:text-blue-600 font-mono text-xs text-left cursor-pointer transition-colors"
                                      title="View audit history"
                                    >
                                      {item.checklist_number || item.id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-800 font-medium align-middle whitespace-nowrap">
                                    {item.service_engineer || 'Unassigned'}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-600 align-middle whitespace-nowrap text-xs">
                                    {formatDisplayDate(
                                      cb.outbound_departure_datetime || cb.travel_datetime || item.expected_arrival_date
                                    )}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-700 align-middle">
                                    <span
                                      className="line-clamp-2"
                                      title={cb.outbound_destination || cb.destination || item.client_location || '—'}
                                    >
                                      {cb.outbound_destination || cb.destination || item.client_location || '—'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                      <span>{currentStatus}</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <select
                                      value={selectedDraft}
                                      onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                      className="w-36 h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs font-medium text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    >
                                      <option value="Pending">Pending</option>
                                      <option value="Booked">Booked</option>
                                      <option value="Confirmed">Confirmed</option>
                                      <option value="Cancelled">Cancelled</option>
                                    </select>
                                  </td>
                                  <td className="py-3 px-3.5 text-right pr-5 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStatus(item, 'outbound')}
                                      disabled={!isChanged || isSaving}
                                      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                        isChanged
                                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                      title={isChanged ? 'Save status change' : 'No changes to save'}
                                    >
                                      {isSaving ? (
                                        <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                                      ) : (
                                        <Check className="w-3 h-3 shrink-0" />
                                      )}
                                      <span>Save</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* -------------------------------------------------------- */}
              {/* SECTION: ROOM BOOKINGS                                   */}
              {/* -------------------------------------------------------- */}
              {activeSection === 'room' && (
                <>
                  {filteredChecklists.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center text-slate-400">
                      <Building className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-slate-600">
                        No room booking records found
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Mobile Record Cards (< md) */}
                      <div className="block md:hidden divide-y divide-slate-100 p-2.5 sm:p-3 space-y-3">
                        {filteredChecklists.map((item) => {
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
                          const destination = cb.outbound_destination || item.client_location || '—';

                          return (
                            <div
                              key={item.id}
                              className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2.5 transition-all"
                            >
                              {/* Header: Job ID + Status Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openHistory(item.id, item.checklist_number)}
                                  className="text-xs font-mono font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                                  title="View audit history"
                                >
                                  <span>{item.checklist_number || item.id.slice(0, 8)}</span>
                                  <History size={12} className="text-slate-400" />
                                </button>
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                  <span>{currentStatus}</span>
                                </span>
                              </div>

                              {/* Technician & Client */}
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                                  <UserCheck size={13} className="text-blue-600 shrink-0" />
                                  <span className="truncate">{item.service_engineer || 'Unassigned Technician'}</span>
                                </div>
                                {item.client_name && (
                                  <p className="text-[11px] text-slate-600 truncate pl-4.5">
                                    Client: {item.client_name}
                                  </p>
                                )}
                              </div>

                              {/* Dates & Destination */}
                              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Schedule Dates
                                  </span>
                                  <div className="text-slate-700 font-medium mt-0.5 space-y-0.5">
                                    <div className="flex items-center gap-1">
                                      <Calendar size={12} className="text-slate-400 shrink-0" />
                                      <span>Orig: {formatDisplayDate(origDate)}</span>
                                    </div>
                                    {revDate && (
                                      <div className="text-[11px] font-bold text-purple-700 flex items-center gap-1">
                                        <Clock size={11} className="text-purple-500 shrink-0" />
                                        <span>Rev: {formatDisplayDate(revDate)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Destination / City
                                  </span>
                                  <div className="flex items-center gap-1 text-slate-700 font-medium mt-0.5">
                                    <MapPin size={12} className="text-slate-400 shrink-0" />
                                    <span className="truncate" title={destination}>
                                      {destination}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Status Update Dropdown + Save Button */}
                              <div className="pt-1 flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="w-full h-9 bg-white border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    aria-label="Update room booking status"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Pending Review">Pending Review</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveStatus(item, 'room')}
                                  disabled={!isChanged || isSaving}
                                  className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    isChanged
                                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
                                  }`}
                                >
                                  {isSaving ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>Save</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (>= md) */}
                      <div className="hidden md:block overflow-x-auto w-full">
                        <table className="w-full min-w-[960px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                              <th className="py-3 px-3.5 w-12 text-center">#</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Job ID</th>
                              <th className="py-3 px-3.5 w-44 whitespace-nowrap">Technician</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Original Date</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Revised Date</th>
                              <th className="py-3 px-3.5 min-w-[140px]">Destination</th>
                              <th className="py-3 px-3.5 w-36 whitespace-nowrap">Current Status</th>
                              <th className="py-3 px-3.5 w-40 whitespace-nowrap">Update Status</th>
                              <th className="py-3 px-3.5 w-24 text-right pr-5 whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredChecklists.map((item, idx) => {
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
                                  <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs align-middle">
                                    {idx + 1}
                                  </td>
                                  <td className="py-3 px-3.5 font-medium text-slate-900 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => openHistory(item.id, item.checklist_number)}
                                      className="hover:underline hover:text-blue-600 font-mono text-xs text-left cursor-pointer transition-colors"
                                      title="View audit history"
                                    >
                                      {item.checklist_number || item.id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-800 font-medium align-middle whitespace-nowrap">
                                    {item.service_engineer || 'Unassigned'}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-600 align-middle whitespace-nowrap text-xs">
                                    {formatDisplayDate(origDate)}
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap text-xs">
                                    {revDate ? (
                                      <span className="inline-flex items-center text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                                        {formatDisplayDate(revDate)}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-700 align-middle">
                                    <span
                                      className="line-clamp-2"
                                      title={cb.outbound_destination || item.client_location || '—'}
                                    >
                                      {cb.outbound_destination || item.client_location || '—'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                      <span>{currentStatus}</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <select
                                      value={selectedDraft}
                                      onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                      className="w-36 h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs font-medium text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    >
                                      <option value="Pending">Pending</option>
                                      <option value="Pending Review">Pending Review</option>
                                      <option value="Booked">Booked</option>
                                      <option value="Confirmed">Confirmed</option>
                                      <option value="Cancelled">Cancelled</option>
                                    </select>
                                  </td>
                                  <td className="py-3 px-3.5 text-right pr-5 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStatus(item, 'room')}
                                      disabled={!isChanged || isSaving}
                                      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                        isChanged
                                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                      title={isChanged ? 'Save status change' : 'No changes to save'}
                                    >
                                      {isSaving ? (
                                        <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                                      ) : (
                                        <Check className="w-3 h-3 shrink-0" />
                                      )}
                                      <span>Save</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* -------------------------------------------------------- */}
              {/* SECTION: RETURN TICKETS                                  */}
              {/* -------------------------------------------------------- */}
              {activeSection === 'return' && (
                <>
                  {filteredChecklists.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center text-slate-400">
                      <Ticket className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-slate-600">
                        No return-ticket requests awaiting coordinator action.
                      </p>
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        Return-ticket requests are created automatically after the associated technician submits the post-installation form.
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Mobile Record Cards (< md) */}
                      <div className="block md:hidden divide-y divide-slate-100 p-2.5 sm:p-3 space-y-3">
                        {filteredChecklists.map((item) => {
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
                          const returnDest = cb.return_destination || cb.outbound_origin || 'Base Office';

                          return (
                            <div
                              key={item.id}
                              className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2.5 transition-all"
                            >
                              {/* Header: Job ID + Status Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openHistory(item.id, item.checklist_number)}
                                  className="text-xs font-mono font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                                  title="View audit history"
                                >
                                  <span>{item.checklist_number || item.id.slice(0, 8)}</span>
                                  <History size={12} className="text-slate-400" />
                                </button>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openReportModal(item.id, item.checklist_number, item.client_name, item.service_engineer)}
                                    className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-[10px] font-bold cursor-pointer transition-colors inline-flex items-center gap-1"
                                    title="View Post-Installation Report"
                                  >
                                    <FileText size={11} />
                                    <span>Report</span>
                                  </button>
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                    <span>{currentStatus}</span>
                                  </span>
                                </div>
                              </div>

                              {/* Technician & Client */}
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                                  <UserCheck size={13} className="text-blue-600 shrink-0" />
                                  <span className="truncate">{item.service_engineer || 'Unassigned Technician'}</span>
                                </div>
                                {item.client_name && (
                                  <p className="text-[11px] text-slate-600 truncate pl-4.5">
                                    Client: {item.client_name}
                                  </p>
                                )}
                              </div>

                              {/* Submission & Return Details */}
                              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Post-Install Done
                                  </span>
                                  <div className="flex items-center gap-1 text-slate-700 font-medium mt-0.5">
                                    <Clock size={12} className="text-slate-400 shrink-0" />
                                    <span>{formatDisplayDate(submissionDate)}</span>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Return Route
                                  </span>
                                  <div className="flex items-center gap-1 text-slate-700 font-medium mt-0.5">
                                    <MapPin size={12} className="text-slate-400 shrink-0" />
                                    <span className="truncate" title={returnDest}>
                                      {cb.return_boarding_point ? `${cb.return_boarding_point} → ` : ''}
                                      {returnDest}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Self-booked details (if submitted by technician) */}
                              {(cb.return_operator || cb.return_ticket_reference || cb.return_attachment_url) && (
                                <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-200/60 text-xs space-y-1">
                                  <span className="text-[10px] font-bold uppercase text-amber-800 block">
                                    Technician Booking Details
                                  </span>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-700">
                                    {cb.return_operator && (
                                      <span>
                                        <strong>Operator:</strong> {cb.return_operator}
                                      </span>
                                    )}
                                    {cb.return_ticket_reference && (
                                      <span className="font-mono text-purple-700">
                                        <strong>Ref:</strong> {cb.return_ticket_reference}
                                      </span>
                                    )}
                                    {cb.return_attachment_url && (
                                      <a
                                        href={cb.return_attachment_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 font-bold hover:underline inline-flex items-center gap-1"
                                      >
                                        <FileText size={11} />
                                        <span>Attachment</span>
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Status Update Dropdown + Save Button */}
                              <div className="pt-1 flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="w-full h-9 bg-white border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    aria-label="Update return ticket status"
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveStatus(item, 'return')}
                                  disabled={!isChanged || isSaving}
                                  className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    isChanged
                                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
                                  }`}
                                >
                                  {isSaving ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>Save</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (>= md) */}
                      <div className="hidden md:block overflow-x-auto w-full">
                        <table className="w-full min-w-[960px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                              <th className="py-3 px-3.5 w-12 text-center">#</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Job ID</th>
                              <th className="py-3 px-3.5 w-44 whitespace-nowrap">Technician</th>
                              <th className="py-3 px-3.5 w-36 whitespace-nowrap">Post-Install Submission</th>
                              <th className="py-3 px-3.5 min-w-[140px]">Destination</th>
                              <th className="py-3 px-3.5 w-36 whitespace-nowrap">Current Status</th>
                              <th className="py-3 px-3.5 w-40 whitespace-nowrap">Update Status</th>
                              <th className="py-3 px-3.5 w-24 text-right pr-5 whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredChecklists.map((item, idx) => {
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
                                  <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-xs align-middle">
                                    {idx + 1}
                                  </td>
                                  <td className="py-3 px-3.5 font-medium text-slate-900 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => openHistory(item.id, item.checklist_number)}
                                      className="hover:underline hover:text-blue-600 font-mono text-xs text-left cursor-pointer transition-colors"
                                      title="View audit history"
                                    >
                                      {item.checklist_number || item.id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-800 font-medium align-middle whitespace-nowrap">
                                    {item.service_engineer || 'Unassigned'}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-600 align-middle whitespace-nowrap text-xs">
                                    {formatDisplayDate(submissionDate)}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-700 align-middle">
                                    <span
                                      className="line-clamp-2"
                                      title={cb.return_destination || cb.outbound_origin || 'Base Office'}
                                    >
                                      {cb.return_destination || cb.outbound_origin || 'Base Office'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dot} shrink-0`} />
                                      <span>{currentStatus}</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <select
                                      value={selectedDraft}
                                      onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                      className="w-36 h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs font-medium text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    >
                                      <option value="Pending">Pending</option>
                                      <option value="Booked">Booked</option>
                                      <option value="Confirmed">Confirmed</option>
                                      <option value="Cancelled">Cancelled</option>
                                    </select>
                                  </td>
                                  <td className="py-3 px-3.5 text-right pr-5 align-middle whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => openReportModal(item.id, item.checklist_number, item.client_name, item.service_engineer)}
                                        className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-all cursor-pointer"
                                        title="View Post-Installation Report"
                                      >
                                        <FileText className="w-3 h-3 shrink-0" />
                                        <span>Report</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveStatus(item, 'return')}
                                        disabled={!isChanged || isSaving}
                                        className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                          isChanged
                                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                        }`}
                                        title={isChanged ? 'Save status change' : 'No changes to save'}
                                      >
                                        {isSaving ? (
                                          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                                        ) : (
                                          <Check className="w-3 h-3 shrink-0" />
                                        )}
                                        <span>Save</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* -------------------------------------------------------- */}
              {/* SECTION: EXTENSION REVIEWS                               */}
              {/* -------------------------------------------------------- */}
              {activeSection === 'extensions' && (
                <>
                  {filteredChecklists.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center text-slate-400">
                      <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-slate-600">
                        No room bookings currently awaiting extension review.
                      </p>
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        When an installation schedule date is extended or changed, the affected room booking automatically appears here.
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Mobile Record Cards (< md) */}
                      <div className="block md:hidden divide-y divide-slate-100 p-2.5 sm:p-3 space-y-3">
                        {filteredChecklists.map((item) => {
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
                            <div
                              key={item.id}
                              className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2.5 transition-all"
                            >
                              {/* Header: Job ID + Status Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openHistory(item.id, item.checklist_number)}
                                  className="text-xs font-mono font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                                  title="View audit history"
                                >
                                  <span>{item.checklist_number || item.id.slice(0, 8)}</span>
                                  <History size={12} className="text-slate-400" />
                                </button>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                                  <span>{currentStatus}</span>
                                </span>
                              </div>

                              {/* Technician */}
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                                  <UserCheck size={13} className="text-blue-600 shrink-0" />
                                  <span className="truncate">{item.service_engineer || 'Unassigned Technician'}</span>
                                </div>
                                {item.client_name && (
                                  <p className="text-[11px] text-slate-600 truncate pl-4.5">
                                    Client: {item.client_name}
                                  </p>
                                )}
                              </div>

                              {/* Schedule Comparison */}
                              <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-purple-50/30 border border-purple-100 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Previous Date
                                  </span>
                                  <div className="text-slate-700 font-medium mt-0.5">
                                    {formatDisplayDate(origDate)}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-purple-700 block">
                                    Revised Date
                                  </span>
                                  <div className="text-purple-800 font-bold mt-0.5">
                                    {formatDisplayDate(revDate)}
                                  </div>
                                </div>
                              </div>

                              {/* Status Update Dropdown + Save Button */}
                              <div className="pt-1 flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={selectedDraft}
                                    onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                    className="w-full h-9 bg-white border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    aria-label="Update room status for extension"
                                  >
                                    <option value="Pending Review">Pending Review</option>
                                    <option value="Booked">Booked</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Cancelled">Cancelled</option>
                                    <option value="Pending">Pending</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveStatus(item, 'room')}
                                  disabled={!isChanged || isSaving}
                                  className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    isChanged
                                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
                                  }`}
                                >
                                  {isSaving ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>Save</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (>= md) */}
                      <div className="hidden md:block overflow-x-auto w-full">
                        <table className="w-full min-w-[920px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Job ID</th>
                              <th className="py-3 px-3.5 w-44 whitespace-nowrap">Technician</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Previous Date</th>
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Revised Date</th>
                              <th className="py-3 px-3.5 w-36 whitespace-nowrap">Room Booking Status</th>
                              <th className="py-3 px-3.5 w-40 whitespace-nowrap">Update Status</th>
                              <th className="py-3 px-3.5 w-40 text-right pr-5 whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredChecklists.map((item) => {
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
                                  <td className="py-3 px-3.5 font-medium text-slate-900 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => openHistory(item.id, item.checklist_number)}
                                      className="hover:underline hover:text-blue-600 font-mono text-xs text-left cursor-pointer transition-colors"
                                      title="View audit history"
                                    >
                                      {item.checklist_number || item.id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-800 font-medium align-middle whitespace-nowrap">
                                    {item.service_engineer || 'Unassigned'}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-600 align-middle whitespace-nowrap text-xs">
                                    {formatDisplayDate(origDate)}
                                  </td>
                                  <td className="py-3 px-3.5 text-purple-700 font-semibold align-middle whitespace-nowrap text-xs">
                                    {formatDisplayDate(revDate)}
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                                      <span>{currentStatus}</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                                    <select
                                      value={selectedDraft}
                                      onChange={(e) => handleDraftChange(item.id, e.target.value)}
                                      className="w-36 h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs font-medium text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-100 cursor-pointer shadow-2xs"
                                    >
                                      <option value="Pending Review">Pending Review</option>
                                      <option value="Booked">Booked</option>
                                      <option value="Confirmed">Confirmed</option>
                                      <option value="Cancelled">Cancelled</option>
                                      <option value="Pending">Pending</option>
                                    </select>
                                  </td>
                                  <td className="py-3 px-3.5 text-right pr-5 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStatus(item, 'room')}
                                      disabled={!isChanged || isSaving}
                                      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                        isChanged
                                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                      title={isChanged ? 'Save status change' : 'No changes to save'}
                                    >
                                      {isSaving ? (
                                        <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                                      ) : (
                                        <Check className="w-3 h-3 shrink-0" />
                                      )}
                                      <span>Save Room Status</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* -------------------------------------------------------- */}
              {/* SECTION: SCHEDULE CONFLICTS                              */}
              {/* -------------------------------------------------------- */}
              {activeSection === 'conflicts' && (
                <>
                  {conflicts.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center text-slate-400">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                      <p className="text-xs sm:text-sm font-semibold text-slate-700">
                        No technician schedule conflicts detected
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        All technician assignment dates and service commitments are fully aligned.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Schedule Conflict History Actions Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 border-b border-rose-100 bg-rose-50/20">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                          <span className="text-xs sm:text-sm font-bold text-slate-800">
                            Conflict Records ({conflicts.length})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmClearAllConflicts(true)}
                          disabled={deletingConflictId === 'ALL'}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 active:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer transition-colors shadow-2xs w-full sm:w-auto"
                          title="Delete all conflict history records"
                        >
                          {deletingConflictId === 'ALL' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                          )}
                          <span>Clear Conflict History</span>
                        </button>
                      </div>

                      {/* Mobile Record Cards (< md) */}
                      <div className="block md:hidden divide-y divide-slate-100 p-2.5 sm:p-3 space-y-3">
                        {conflicts.map((c, idx) => {
                          const conflictId =
                            c.id ||
                            `${c.engineer_id}_${c.commitment_a?.id}_${c.commitment_b?.id}_${c.overlap_start}_${c.overlap_end}`;
                          const isDeleting = deletingConflictId === conflictId;
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
                            <div
                              key={c.id || idx}
                              className="bg-white rounded-xl border border-rose-200 bg-rose-50/10 p-3 shadow-2xs space-y-2.5 transition-all"
                            >
                              {/* Header: Job ID + Conflict Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-mono font-bold text-slate-900">
                                  {jobId}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                                  <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                                  <span>Conflict Detected</span>
                                </span>
                              </div>

                              {/* Technician */}
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                                  <UserCheck size={13} className="text-rose-600 shrink-0" />
                                  <span>{c.engineer_name}</span>
                                </div>
                              </div>

                              {/* Conflicting Date Range */}
                              <div className="p-2 rounded-lg bg-rose-50/40 border border-rose-100 text-xs">
                                <span className="text-[10px] uppercase font-bold text-rose-500 block">
                                  Conflicting Dates
                                </span>
                                <div className="text-rose-800 font-bold mt-0.5 flex items-center gap-1">
                                  <Calendar size={12} className="text-rose-400 shrink-0" />
                                  <span>{dates}</span>
                                </div>
                              </div>

                              {/* Description (no clipping or ellipsis) */}
                              <div className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                                  Conflict Details
                                </span>
                                {desc}
                              </div>

                              {/* Card Footer: Delete Action */}
                              <div className="pt-2 border-t border-rose-100/70 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteConflict(c)}
                                  disabled={isDeleting}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 active:bg-rose-100 border border-rose-200 cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
                                  title="Delete conflict from history"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                  )}
                                  <span>Delete Conflict</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (>= md) */}
                      <div className="hidden md:block overflow-x-auto w-full">
                        <table className="w-full min-w-[850px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                              <th className="py-3 px-3.5 w-32 whitespace-nowrap">Job ID</th>
                              <th className="py-3 px-3.5 w-40 whitespace-nowrap">Technician</th>
                              <th className="py-3 px-3.5 w-48 whitespace-nowrap">Conflicting Dates</th>
                              <th className="py-3 px-3.5 min-w-[200px]">Conflict Description</th>
                              <th className="py-3 px-3.5 w-36 text-center whitespace-nowrap">Review Status</th>
                              <th className="py-3 px-3.5 w-24 text-center pr-5 whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {conflicts.map((c, idx) => {
                              const conflictId =
                                c.id ||
                                `${c.engineer_id}_${c.commitment_a?.id}_${c.commitment_b?.id}_${c.overlap_start}_${c.overlap_end}`;
                              const isDeleting = deletingConflictId === conflictId;
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
                                <tr key={c.id || idx} className="hover:bg-slate-50/80 transition-colors">
                                  <td className="py-3 px-3.5 font-medium text-slate-900 font-mono text-xs align-middle whitespace-nowrap">
                                    {jobId}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-800 font-medium align-middle whitespace-nowrap">
                                    {c.engineer_name}
                                  </td>
                                  <td className="py-3 px-3.5 text-rose-700 font-semibold align-middle whitespace-nowrap text-xs">
                                    {dates}
                                  </td>
                                  <td className="py-3 px-3.5 text-slate-600 align-middle">
                                    <span className="line-clamp-2" title={desc}>
                                      {desc}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 text-center align-middle whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                      <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                                      <span>Conflict Detected</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3.5 text-center pr-5 align-middle whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteConflict(c)}
                                      disabled={isDeleting}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 active:bg-rose-100 border border-rose-200 cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
                                      title="Delete conflict from history"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                      ) : (
                                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                      )}
                                      <span>Delete</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {/* ============================================================ */}
      {/* 6. AUDIT HISTORY MODAL                                       */}
      {/* ============================================================ */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <History className="w-4 h-4 text-blue-600 shrink-0" />
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                  Audit History: {historyModal.checklistNumber}
                </h3>
              </div>
              <button
                onClick={() => setHistoryModal({ ...historyModal, open: false })}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 cursor-pointer shrink-0"
                aria-label="Close audit history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-4 overflow-y-auto flex-1 divide-y divide-slate-100 text-xs">
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
                      <span className="text-[11px]">{formatDisplayDate(log.created_at)}</span>
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
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 cursor-pointer shadow-2xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* POST-INSTALLATION COMPLETION REPORT PREVIEW MODAL            */}
      {/* ============================================================ */}
      {reportModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-install-report-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="post-install-report-title" className="font-bold text-sm sm:text-base text-slate-800 truncate">
                    Post-Installation Completion Report
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    Checklist: <span className="font-mono font-semibold text-slate-700">{reportModal.checklistNumber || reportModal.checklistId}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReportModal({ ...reportModal, open: false })}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
                aria-label="Close report modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
              {reportModal.loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="text-xs font-semibold">Loading completion report details...</span>
                </div>
              ) : reportModal.error ? (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  <p className="font-bold mb-1">Failed to load report</p>
                  <p>{reportModal.error}</p>
                </div>
              ) : reportModal.report ? (
                <>
                  {/* Meta Overview Card */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Service Engineer</span>
                      <span className="font-semibold text-slate-800">{reportModal.serviceEngineer || reportModal.report.technician_name || 'Assigned Technician'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Client / Customer</span>
                      <span className="font-semibold text-slate-800 truncate block">{reportModal.clientName || reportModal.report.client_name || 'Customer Site'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Submitted At</span>
                      <span className="font-medium text-slate-700">
                        {reportModal.report.submitted_at ? formatDisplayDate(reportModal.report.submitted_at) : 'Just now'}
                      </span>
                    </div>
                  </div>

                  {/* Device Reconciliation Metrics */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-blue-600" />
                      <span>Device Reconciliation Summary</span>
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-center">
                        <span className="text-[10px] uppercase font-bold text-emerald-700 block">Installed</span>
                        <span className="text-lg font-black text-emerald-800 tabular-nums">
                          {reportModal.report.devices_installed_qty ?? reportModal.report.total_devices_installed ?? 0}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/80 text-center">
                        <span className="text-[10px] uppercase font-bold text-blue-700 block">Carried</span>
                        <span className="text-lg font-black text-blue-800 tabular-nums">
                          {reportModal.report.devices_carried_qty ?? reportModal.report.total_devices_carried ?? 0}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-purple-50/60 border border-purple-200/80 text-center">
                        <span className="text-[10px] uppercase font-bold text-purple-700 block">To Return</span>
                        <span className="text-lg font-black text-purple-800 tabular-nums">
                          {reportModal.report.devices_unused_qty ?? reportModal.report.total_devices_to_return ?? 0}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 text-center">
                        <span className="text-[10px] uppercase font-bold text-amber-700 block">Damaged/Missing</span>
                        <span className="text-lg font-black text-amber-800 tabular-nums">
                          {(reportModal.report.devices_damaged_qty || 0) + (reportModal.report.devices_missing_qty || 0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Itemized Device Breakdown */}
                  {Array.isArray(reportModal.report.items) && reportModal.report.items.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Itemized Devices</h4>
                      <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="p-2 sm:px-3">Device</th>
                              <th className="p-2 text-center">Carried</th>
                              <th className="p-2 text-center">Installed</th>
                              <th className="p-2 text-center">Return</th>
                              <th className="p-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {reportModal.report.items.map((it, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/60">
                                <td className="p-2 sm:px-3 font-semibold">{it.device_type || it.item_name}</td>
                                <td className="p-2 text-center tabular-nums">{it.quantity_carried ?? 0}</td>
                                <td className="p-2 text-center font-bold text-emerald-700 tabular-nums">{it.quantity_installed ?? 0}</td>
                                <td className="p-2 text-center tabular-nums text-purple-700">{it.quantity_to_return ?? 0}</td>
                                <td className="p-2 text-slate-500 text-[11px] truncate max-w-[120px]">
                                  {it.discrepancy_reason || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Technician Remarks */}
                  {reportModal.report.remarks && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Technician Remarks</span>
                      <p className="text-slate-700 italic">"{reportModal.report.remarks}"</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  No post-installation report records found for this checklist.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:px-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setReportModal({ ...reportModal, open: false })}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 cursor-pointer shadow-2xs"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  setReportModal({ ...reportModal, open: false });
                  setActiveSection('return');
                  if (reportModal.checklistNumber) {
                    setSearchTerm(reportModal.checklistNumber);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer shadow-xs transition-colors"
              >
                <span>Review Return Ticket Task</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 8. CLEAR CONFLICT HISTORY CONFIRMATION MODAL                 */}
      {/* ============================================================ */}
      {confirmClearAllConflicts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Clear Conflict History?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  This will remove all {conflicts.length} active schedule conflict records from your conflict history.
                </p>
              </div>
            </div>
            <div className="p-3 bg-rose-50/70 border border-rose-100 rounded-xl text-xs text-rose-800">
              Deleted conflicts will no longer appear in your active schedule conflicts list or sidebar badge count.
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearAllConflicts(false)}
                disabled={deletingConflictId === 'ALL'}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 cursor-pointer shadow-2xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllConflicts}
                disabled={deletingConflictId === 'ALL'}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl cursor-pointer shadow-xs transition-colors disabled:opacity-50"
              >
                {deletingConflictId === 'ALL' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Clear All Conflicts</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
