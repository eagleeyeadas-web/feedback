import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  FileText,
  UserCheck,
  UserX,
  Shield,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Info,
  CalendarPlus,
  RefreshCw,
  Sliders,
  History,
  AlertCircle,
  Filter,
  Users,
  Moon,
  CalendarOff,
  Briefcase,
  Wrench,
  Bus,
  CheckSquare,
} from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchHrAvailabilityOverview,
  fetchHrAvailabilityCalendar,
  setHrManualAvailability,
  reverseHrManualAvailability,
  fetchHrExtensionRequests,
  approveHrExtensionRequest,
  rejectHrExtensionRequest,
  fetchHrOverdueRecords,
  triggerHrOverdueCheck,
} from '../../../lib/api';

const FOUR_AUTHORIZED_ENGINEERS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

const MANUAL_STATUS_OPTIONS = [
  {
    key: 'Available',
    label: 'Available',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    selectedClass: 'ring-2 ring-emerald-600 bg-emerald-50 border-emerald-400 text-emerald-950 font-bold',
    dotColor: 'bg-emerald-500',
    description: 'Engineer may be considered for new assignments, subject to scheduling validation.',
  },
  {
    key: 'Not Available',
    label: 'Not Available',
    badgeClass: 'bg-gray-100 text-gray-800 border-gray-300',
    selectedClass: 'ring-2 ring-gray-600 bg-gray-100 border-gray-400 text-gray-950 font-bold',
    dotColor: 'bg-gray-500',
    description: 'Engineer must not receive new assignments during the selected period.',
  },
  {
    key: 'Rest Day',
    label: 'Rest Day',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-300',
    selectedClass: 'ring-2 ring-purple-600 bg-purple-50 border-purple-400 text-purple-950 font-bold',
    dotColor: 'bg-purple-500',
    description: 'Engineer is resting and should not receive new assignments.',
  },
  {
    key: 'On Leave',
    label: 'On Leave',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
    selectedClass: 'ring-2 ring-rose-600 bg-rose-50 border-rose-400 text-rose-950 font-bold',
    dotColor: 'bg-rose-500',
    description: 'Engineer is on approved leave, subject to the existing leave workflow.',
  },
];

export default function HrWorkspace() {
  const { token, user } = useAuth();

  // Exactly 3 main tabs: 'calendar' (default), 'extensions', 'overdue'
  const [activeTab, setActiveTab] = useState('calendar');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Summary counts
  const [engineersList, setEngineersList] = useState([]);
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [overdueRecords, setOverdueRecords] = useState([]);

  // Calendar State
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState(null);
  const [calendarData, setCalendarData] = useState(null);
  const [calendarView, setCalendarView] = useState('week'); // 'day' | 'week' | 'month'
  const [calendarStartDate, setCalendarStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [engineerFilter, setEngineerFilter] = useState('ALL');

  // Right-Side Status Editor State
  const [selectedCell, setSelectedCell] = useState(null); // { engineer, date, dayData }
  const [editorStatus, setEditorStatus] = useState('Available');
  const [editorNotes, setEditorNotes] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSuccess, setEditorSuccess] = useState(null);
  const [editorError, setEditorError] = useState(null);

  // Extension Requests tab state
  const [extensionFilter, setExtensionFilter] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'
  const [activeExtensionModal, setActiveExtensionModal] = useState(null); // { request, action: 'approve' | 'reject' }
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  // Overdue tab state
  const [overdueFilter, setOverdueFilter] = useState('ALL');
  const [overdueScanning, setOverdueScanning] = useState(false);

  // Flash message helper
  const showFlash = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // 1. Load Overview summary data (counts, pending extensions, overdue jobs)
  const loadSummaryData = useCallback(async () => {
    if (!token) return;
    try {
      const [availRes, extRes, overdueRes] = await Promise.all([
        fetchHrAvailabilityOverview(token).catch(() => ({ engineers: [] })),
        fetchHrExtensionRequests(token, { status: 'PENDING' }).catch(() => ({ requests: [] })),
        fetchHrOverdueRecords(token, { resolved: 'false' }).catch(() => ({ records: [] })),
      ]);

      if (availRes?.engineers) {
        setEngineersList(availRes.engineers);
      }
      if (extRes?.requests) {
        setExtensionRequests(extRes.requests);
      }
      if (overdueRes?.records) {
        setOverdueRecords(overdueRes.records);
      }
    } catch (err) {
      console.error('Failed to load summary counts:', err);
    }
  }, [token]);

  // 2. Load Calendar Schedule Data
  const loadCalendarData = useCallback(async () => {
    if (!token) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const res = await fetchHrAvailabilityCalendar(token, {
        startDate: calendarStartDate,
        view: calendarView,
        engineerId: engineerFilter !== 'ALL' ? engineerFilter : undefined,
      });
      setCalendarData(res);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
      setCalendarError(err.message || 'Failed to load technician availability calendar. Please retry.');
    } finally {
      setCalendarLoading(false);
    }
  }, [token, calendarStartDate, calendarView, engineerFilter]);

  // Initial load
  useEffect(() => {
    loadSummaryData();
    loadCalendarData();
  }, [loadSummaryData, loadCalendarData]);

  // Calendar Navigation
  const handlePrev = () => {
    const [y, m, d] = calendarStartDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    const step = calendarView === 'day' ? 1 : calendarView === 'month' ? 30 : 7;
    dObj.setUTCDate(dObj.getUTCDate() - step);
    setCalendarStartDate(dObj.toISOString().split('T')[0]);
  };

  const handleNext = () => {
    const [y, m, d] = calendarStartDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    const step = calendarView === 'day' ? 1 : calendarView === 'month' ? 30 : 7;
    dObj.setUTCDate(dObj.getUTCDate() + step);
    setCalendarStartDate(dObj.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    setCalendarStartDate(new Date().toISOString().split('T')[0]);
  };

  // Helper to map calendar cell status to default editor manual status
  const mapStatusToEditorOption = (cellStatus) => {
    if (cellStatus === 'UNAVAILABLE') return 'Not Available';
    if (cellStatus === 'REST') return 'Rest Day';
    if (cellStatus === 'LEAVE') return 'On Leave';
    return 'Available';
  };

  // Cell click handler: selects cell and populates the status editor
  const handleCellClick = (engineer, day) => {
    setSelectedCell({
      engineer,
      date: day.date,
      dayData: day,
    });
    setEditorStatus(mapStatusToEditorOption(day.status));
    setEditorNotes('');
    setEditorSuccess(null);
    setEditorError(null);
  };

  // Save manual availability change from right-side editor
  const handleUpdateAvailability = async (e) => {
    e?.preventDefault();
    if (!selectedCell || !token) return;

    setEditorSaving(true);
    setEditorError(null);
    setEditorSuccess(null);

    try {
      const payload = {
        engineer_id: selectedCell.engineer.id,
        engineer_name: selectedCell.engineer.name,
        date: selectedCell.date,
        selected_date: selectedCell.date,
        manual_status: editorStatus,
        reason: editorNotes || `Set to ${editorStatus} by HR`,
        notes: editorNotes,
        confirmed: true,
      };

      const res = await setHrManualAvailability(token, payload);

      const msg = res.message || `Updated availability for ${selectedCell.engineer.name} on ${selectedCell.date} to "${editorStatus}".`;
      setEditorSuccess(msg);
      showFlash(msg);

      // Refresh calendar & summary counts
      await Promise.all([loadCalendarData(), loadSummaryData()]);

      // Update current selected cell's dayData status label
      setSelectedCell((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          dayData: {
            ...prev.dayData,
            status: editorStatus === 'Available' ? 'AVAILABLE' : editorStatus === 'Not Available' ? 'UNAVAILABLE' : editorStatus === 'Rest Day' ? 'REST' : 'LEAVE',
            status_label: `${editorStatus} (HR)`,
          },
        };
      });
    } catch (err) {
      console.error('Failed to update availability:', err);
      setEditorError(err.message || 'Failed to update technician availability.');
    } finally {
      setEditorSaving(false);
    }
  };

  // Overdue row action: Open engineer's calendar date and highlight editor
  const handleOpenOverdueInCalendar = (record) => {
    const targetDate = record.original_scheduled_end_date || record.original_scheduled_start_date || new Date().toISOString().split('T')[0];
    const engName = record.assigned_service_engineer_name || record.engineer_name || 'Guna';

    setCalendarStartDate(targetDate);
    setActiveTab('calendar');

    // Find engineer or set dummy cell until calendar reloads
    setSelectedCell({
      engineer: {
        id: record.assigned_service_engineer_id || engName,
        name: engName,
      },
      date: targetDate,
      dayData: {
        date: targetDate,
        status: 'OVERDUE',
        status_label: `Overdue (Job #${record.checklist_number || 'N/A'})`,
        commitment: {
          checklist_number: record.checklist_number,
          client_name: record.customer_name,
          location: record.job_location,
        },
      },
    });
    setEditorStatus('Not Available');
    setEditorNotes(`Reviewing overdue job #${record.checklist_number || ''}`);
  };

  // Run overdue scan
  const handleRunOverdueScan = async () => {
    if (!token) return;
    setOverdueScanning(true);
    try {
      const res = await triggerHrOverdueCheck(token);
      showFlash(`Overdue detection scan completed: ${res.overdueCount || 0} overdue job(s) identified.`);
      await Promise.all([loadSummaryData(), loadCalendarData()]);
    } catch (err) {
      alert(`Overdue scan failed: ${err.message}`);
    } finally {
      setOverdueScanning(false);
    }
  };

  // Extension request decision
  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!activeExtensionModal || !token) return;
    setDecisionSubmitting(true);
    const { request, action } = activeExtensionModal;

    try {
      if (action === 'approve') {
        await approveHrExtensionRequest(token, request.id, { notes: decisionNotes });
        showFlash(`Approved extension for ${request.checklist_number} to ${request.requested_completion_date}.`);
      } else {
        await rejectHrExtensionRequest(token, request.id, { rejection_reason: decisionNotes });
        showFlash(`Rejected extension request for ${request.checklist_number}.`);
      }
      setActiveExtensionModal(null);
      setDecisionNotes('');
      await Promise.all([loadSummaryData(), loadCalendarData()]);
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setDecisionSubmitting(false);
    }
  };

  // Format date headers for calendar columns
  const formatDateHeader = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const dayNum = dt.getUTCDate();
    const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return { dayName, dayNum, month };
  };

  // Cell status styling helper
  const getCellBadgeProps = (status, commitment) => {
    switch (status) {
      case 'AVAILABLE':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/80',
          dot: 'bg-emerald-500',
          label: 'Available',
          icon: CheckCircle2,
        };
      case 'COMPLETED':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/80',
          dot: 'bg-emerald-600',
          label: commitment?.checklist_number ? commitment.checklist_number.replace('EE-INST-', '') : 'Completed',
          icon: CheckCircle2,
        };
      case 'ASSIGNED':
        return {
          bg: 'bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100',
          dot: 'bg-sky-500',
          label: commitment?.checklist_number ? commitment.checklist_number.replace('EE-INST-', '') : 'Assigned',
          icon: Briefcase,
        };
      case 'IN_PROGRESS':
        return {
          bg: 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200',
          dot: 'bg-amber-500 animate-pulse',
          label: 'On Site',
          icon: Wrench,
        };
      case 'TRAVEL':
        return {
          bg: 'bg-purple-50 text-purple-800 border-purple-300 hover:bg-purple-100',
          dot: 'bg-purple-500',
          label: 'Traveling',
          icon: Bus,
        };
      case 'REST':
        return {
          bg: 'bg-purple-50 text-purple-900 border-purple-300 hover:bg-purple-100',
          dot: 'bg-purple-600',
          label: 'Rest Day',
          icon: Moon,
        };
      case 'LEAVE':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100',
          dot: 'bg-rose-500',
          label: 'On Leave',
          icon: CalendarOff,
        };
      case 'OVERDUE':
        return {
          bg: 'bg-rose-100 text-rose-900 border-rose-400 animate-pulse hover:bg-rose-200',
          dot: 'bg-rose-600',
          label: commitment?.checklist_number ? `${commitment.checklist_number.replace('EE-INST-', '')} (Overdue)` : 'Overdue',
          icon: AlertTriangle,
        };
      case 'CONFLICT':
        return {
          bg: 'bg-rose-50 text-rose-900 border-rose-400 hover:bg-rose-100',
          dot: 'bg-rose-600',
          label: 'Conflict!',
          icon: AlertTriangle,
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200/80',
          dot: 'bg-gray-400',
          label: 'Not Available',
          icon: Clock,
        };
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const pendingExtensionsCount = extensionRequests.filter((r) => r.status === 'PENDING').length;
  const activeOverdueCount = overdueRecords.filter((r) => !r.resolved).length;

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header & Compact Summary Row */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        {/* Title & Subtitle */}
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-extrabold tracking-wider text-emerald-800 uppercase">
            HUMAN RESOURCES DEPARTMENT — Eagle Eye SafDrive
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
            Technician Availability
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 max-w-3xl">
            View and manage the availability of service engineers. Click on any date to update their availability.
          </p>
        </div>

        {/* Compact Summary Row (Engineers: 4, Pending Extensions, Overdue Jobs) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50/90 rounded-xl border border-gray-200">
            <div className="w-9 h-9 rounded-lg bg-gray-200/80 flex items-center justify-center text-gray-700 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-gray-500 uppercase font-bold block">Engineers</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-black text-gray-900">4</span>
                <span className="text-[10px] text-gray-500 font-medium">(Mathi, Guna, Sakthivel, Kamalesh)</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('extensions')}
            className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-left transition cursor-pointer group ${
              pendingExtensionsCount > 0
                ? 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200'
                : 'bg-gray-50 hover:bg-gray-100/80 border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                pendingExtensionsCount > 0 ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'
              }`}>
                <CalendarPlus className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-gray-600 uppercase font-bold block">Pending Extensions</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-black ${pendingExtensionsCount > 0 ? 'text-amber-900' : 'text-gray-900'}`}>
                    {pendingExtensionsCount}
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Click to review</span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('overdue')}
            className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-left transition cursor-pointer group ${
              activeOverdueCount > 0
                ? 'bg-rose-50/70 hover:bg-rose-100/70 border-rose-200'
                : 'bg-gray-50 hover:bg-gray-100/80 border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                activeOverdueCount > 0 ? 'bg-rose-200 text-rose-800' : 'bg-gray-200 text-gray-600'
              }`}>
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-gray-600 uppercase font-bold block">Overdue Jobs</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-black ${activeOverdueCount > 0 ? 'text-rose-900' : 'text-gray-900'}`}>
                    {activeOverdueCount}
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Click to review</span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition" />
          </button>
        </div>
      </div>

      {/* Success Notification Alert */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs sm:text-sm font-semibold flex items-center gap-3 shadow-xs">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs sm:text-sm font-semibold flex items-center gap-3 shadow-xs">
          <AlertTriangle size={18} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Navigation Tabs (Only 3 Tabs) */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto bg-white px-2 pt-2 rounded-t-xl border-x">
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'calendar'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/60 rounded-t-lg'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Calendar size={16} />
          <span>Availability Calendar</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('extensions')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'extensions'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/60 rounded-t-lg'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <CalendarPlus size={16} />
          <span>Extension Requests</span>
          {pendingExtensionsCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-200 text-amber-900">
              {pendingExtensionsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('overdue')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'overdue'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/60 rounded-t-lg'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Clock size={16} />
          <span>Overdue Jobs</span>
          {activeOverdueCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-200 text-rose-900">
              {activeOverdueCount}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================
          TAB 1: AVAILABILITY CALENDAR (CALENDAR-FIRST INTERFACE)
          ============================================================ */}
      {activeTab === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* Main Calendar View (~75% on desktop: lg:col-span-3) */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-xs p-4 sm:p-5 space-y-4">
            {/* Calendar Controls & Navigation Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              {/* Left: View Mode (Day, Week, Month) */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setCalendarView('day')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      calendarView === 'day' ? 'bg-white text-emerald-800 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarView('week')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      calendarView === 'week' ? 'bg-white text-emerald-800 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarView('month')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      calendarView === 'month' ? 'bg-white text-emerald-800 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Month
                  </button>
                </div>

                {/* Today button */}
                <button
                  type="button"
                  onClick={handleToday}
                  className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
                >
                  Today
                </button>
              </div>

              {/* Right: Date Navigator, Month/Year Selector, Engineer Filter */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Date Navigator (< Date >) */}
                <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl p-0.5">
                  <button
                    type="button"
                    onClick={handlePrev}
                    title="Previous"
                    className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono font-bold px-2.5 text-gray-800">
                    {calendarData?.start_date} {calendarData?.end_date && calendarData.end_date !== calendarData.start_date ? `– ${calendarData.end_date}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleNext}
                    title="Next"
                    className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Jump to Date Input */}
                <input
                  type="date"
                  value={calendarStartDate}
                  onChange={(e) => setCalendarStartDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-600"
                  title="Jump to date"
                />

                {/* Engineer Filter */}
                <select
                  value={engineerFilter}
                  onChange={(e) => setEngineerFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-600 cursor-pointer"
                >
                  <option value="ALL">All 4 Engineers</option>
                  {FOUR_AUTHORIZED_ENGINEERS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={loadCalendarData}
                  disabled={calendarLoading}
                  className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl border border-gray-200 transition cursor-pointer"
                  title="Refresh calendar"
                >
                  <RefreshCw className={`w-4 h-4 ${calendarLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Error Message with Retry */}
            {calendarError && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{calendarError}</span>
                </div>
                <button
                  type="button"
                  onClick={loadCalendarData}
                  className="px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Calendar Grid Table */}
            {calendarLoading ? (
              <div className="py-20 text-center text-gray-400">
                <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-600">Loading technician availability schedule...</p>
              </div>
            ) : calendarData?.schedule ? (
              <div className="overflow-x-auto pb-2">
                <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-200">
                      <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider w-44">
                        Service Engineer
                      </th>
                      {calendarData.dates.map((dateStr) => {
                        const { dayName, dayNum, month } = formatDateHeader(dateStr);
                        const isToday = dateStr === todayStr;
                        return (
                          <th
                            key={dateStr}
                            className={`py-2 px-1 text-center border-l border-gray-100 ${
                              isToday ? 'bg-emerald-50/70 text-emerald-950 font-black' : 'text-gray-600'
                            }`}
                          >
                            <div className="text-[10px] font-medium uppercase text-gray-400">{dayName}</div>
                            <div className={`text-xs ${isToday ? 'font-black text-emerald-800' : 'font-semibold'}`}>
                              {dayNum} {month}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {calendarData.schedule.map(({ engineer, days, warnings }) => (
                      <tr key={engineer.id} className="hover:bg-gray-50/50 transition-colors">
                        {/* Engineer Info */}
                        <td className="py-3 px-3 align-middle">
                          <div className="font-black text-gray-900 text-xs flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                            {engineer.name}
                          </div>
                          <span className="text-[10px] text-gray-400 block font-medium mt-0.5">
                            Service Engineer
                          </span>
                        </td>

                        {/* Day Cells */}
                        {days.map((day) => {
                          const isToday = day.date === todayStr;
                          const isSelected = selectedCell && selectedCell.engineer.id === engineer.id && selectedCell.date === day.date;
                          const badge = getCellBadgeProps(day.status, day.commitment);
                          const IconComp = badge.icon;

                          return (
                            <td
                              key={day.date}
                              className={`py-2 px-1 text-center border-l border-gray-100 align-middle ${
                                isToday ? 'bg-emerald-50/20' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleCellClick(engineer, day)}
                                className={`relative inline-flex flex-col items-center justify-center w-full py-2 px-1.5 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
                                  badge.bg
                                } ${
                                  isSelected
                                    ? 'ring-2 ring-emerald-600 ring-offset-1 shadow-xs font-black scale-102 z-10'
                                    : ''
                                }`}
                                title={`${engineer.name}: ${day.status_label} (${day.date}). Click to edit.`}
                              >
                                <div className="flex items-center gap-1">
                                  <IconComp size={11} className="shrink-0" />
                                  <span className="truncate max-w-[65px] font-black">{badge.label}</span>
                                </div>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Simple Color Legend */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-bold text-gray-700">Legend:</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 inline-block" />
                  <span className="font-semibold text-gray-700">Available</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-gray-100 border border-gray-300 inline-block" />
                  <span className="font-semibold text-gray-700">Not Available</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-purple-100 border border-purple-300 inline-block" />
                  <span className="font-semibold text-gray-700">Rest Day</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" />
                  <span className="font-semibold text-gray-700">On Leave</span>
                </div>
              </div>
              <span className="text-[10px] text-gray-400">
                Click any cell to update availability
              </span>
            </div>
          </div>

          {/* Right-Side Status Editor (~25% on desktop: lg:col-span-1) */}
          <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-200 shadow-xs p-5 space-y-4 sticky top-4">
            {selectedCell ? (
              <form onSubmit={handleUpdateAvailability} className="space-y-4">
                {/* Header & Close */}
                <div className="flex items-start justify-between pb-3 border-b border-gray-100">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
                      Update Availability
                    </span>
                    <h3 className="text-base font-black text-gray-900 mt-0.5">
                      {selectedCell.engineer.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCell(null)}
                    className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition cursor-pointer"
                    title="Close editor"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Selected Date & Current Effective Availability */}
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-medium">Selected Date:</span>
                    <span className="font-mono font-bold text-gray-900">{selectedCell.date}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-medium">Effective Period:</span>
                    <span className="font-semibold text-emerald-800">{selectedCell.date} (1 day)</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-gray-200">
                    <span className="text-gray-500 font-medium">Current Status:</span>
                    <span className="font-black text-gray-900">
                      {selectedCell.dayData.status_label || selectedCell.dayData.status}
                    </span>
                  </div>
                </div>

                {/* Conflict / Active Commitment Warning Callout */}
                {selectedCell.dayData.commitment && (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-300 text-xs text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-950">
                      <AlertTriangle size={14} className="text-amber-700 shrink-0" />
                      <span>Active Commitment on Date</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-800">
                      Technician is assigned to job #{selectedCell.dayData.commitment.checklist_number || selectedCell.dayData.commitment.id}
                      {selectedCell.dayData.commitment.client_name ? ` (${selectedCell.dayData.commitment.client_name})` : ''}.
                      Marking &quot;Available&quot; records HR&apos;s administrative intent, but will NOT release the active assignment or permit conflicting jobs.
                    </p>
                  </div>
                )}

                {/* Selectable Statuses (Exactly 4 Options) */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-800 block">
                    Select New Status:
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {MANUAL_STATUS_OPTIONS.map((opt) => {
                      const isSelected = editorStatus === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setEditorStatus(opt.key)}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-start gap-2.5 ${
                            isSelected
                              ? opt.selectedClass
                              : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${opt.dotColor}`} />
                          <div>
                            <div className="text-xs font-black text-gray-900 flex items-center justify-between">
                              <span>{opt.label}</span>
                              {isSelected && <Check size={14} className="text-emerald-700" />}
                            </div>
                            <p className="text-[10px] text-gray-500 font-normal mt-0.5 leading-snug">
                              {opt.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Notes / Reason field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 flex justify-between">
                    <span>Reason / Notes (Optional)</span>
                    <span className="text-[10px] text-gray-400 font-normal">Audit logged</span>
                  </label>
                  <textarea
                    rows={2}
                    value={editorNotes}
                    onChange={(e) => setEditorNotes(e.target.value)}
                    placeholder="e.g., Scheduled off, personal request, or post-overdue review"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-hidden focus:border-emerald-600 focus:bg-white resize-none"
                  />
                </div>

                {/* Feedback messages */}
                {editorSuccess && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                    <span>{editorSuccess}</span>
                  </div>
                )}
                {editorError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0 text-rose-600" />
                    <span>{editorError}</span>
                  </div>
                )}

                {/* Submit & Close Buttons */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={editorSaving}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {editorSaving ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Updating...</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>Update Availability</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedCell(null)}
                    className="py-2.5 px-3 border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-12 px-2 text-gray-400 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 mx-auto">
                  <Calendar size={22} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
                    Quick Availability Editor
                  </h4>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    Click any date cell in the calendar to view details and update an engineer&apos;s availability.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 2: EXTENSION REQUESTS
          ============================================================ */}
      {activeTab === 'extensions' && (
        <div className="space-y-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
          {/* Header & Filter Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div>
              <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                <span>Schedule Extension Requests</span>
                {pendingExtensionsCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                    {pendingExtensionsCount} Pending
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Technician requests to extend job schedules beyond original completion date.
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-gray-100 p-0.5 rounded-xl border border-gray-200 text-xs font-bold">
              {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setExtensionFilter(f)}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    extensionFilter === f ? 'bg-white text-emerald-800 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Extension List */}
          {extensionRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CalendarPlus className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-xs font-semibold text-gray-600">No extension requests matching filter &quot;{extensionFilter}&quot;.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {extensionRequests
                .filter((req) => (extensionFilter === 'ALL' ? true : req.status === extensionFilter))
                .map((req) => (
                  <div
                    key={req.id}
                    className="p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-gray-900 text-sm">{req.checklist_number}</span>
                        <span className="text-xs font-bold text-gray-700">• {req.customer_name || 'Client'}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            req.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800'
                              : req.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          <strong>Engineer:</strong> {req.engineer_name || req.technician_name}
                        </span>
                        <span>
                          <strong>Requested Extension:</strong> {req.requested_completion_date}
                        </span>
                        <span>
                          <strong>Current Completion:</strong> {req.current_completion_date || 'N/A'}
                        </span>
                      </div>
                      {req.reason && (
                        <p className="text-xs text-gray-500 italic mt-1">
                          &quot;{req.reason}&quot;
                        </p>
                      )}
                    </div>

                    {req.status === 'PENDING' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveExtensionModal({ request: req, action: 'approve' })}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                        >
                          <Check size={14} />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveExtensionModal({ request: req, action: 'reject' })}
                          className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                        >
                          <X size={14} />
                          <span>Reject</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          TAB 3: OVERDUE JOBS (TABLE / LIST)
          ============================================================ */}
      {activeTab === 'overdue' && (
        <div className="space-y-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
          {/* Header & Scanning Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div>
              <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                <span>Overdue Jobs & Late Completion Management</span>
                {activeOverdueCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                    {activeOverdueCount} Active
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Jobs where scheduled end date passed without submitted completion report. HR manually reviews availability.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRunOverdueScan}
              disabled={overdueScanning}
              className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={overdueScanning ? 'animate-spin' : ''} />
              <span>{overdueScanning ? 'Scanning...' : 'Run Overdue Scan'}</span>
            </button>
          </div>

          {/* Overdue Table */}
          {overdueRecords.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2" />
              <p className="text-xs font-semibold text-gray-600">No overdue installation jobs detected. All checklists on schedule.</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-left border-collapse text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Job / Checklist #</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Customer & Location</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Engineer</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Scheduled Start / End</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Approved Extension</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Overdue Status</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Report Status</th>
                    <th className="py-2.5 px-3 font-bold text-gray-700 uppercase text-[10px] tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {overdueRecords.map((rec) => {
                    const label = rec.category || (rec.extension_status === 'PENDING'
                      ? 'Overdue — Extension Approval Pending'
                      : rec.extension_status === 'REJECTED'
                      ? 'Overdue — Extension Rejected'
                      : rec.resolved
                      ? 'Late Completion Recorded'
                      : 'Overdue — Extension Not Requested');

                    return (
                      <tr key={rec.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-3 font-black text-gray-900">
                          {rec.checklist_number}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-gray-800">{rec.customer_name || 'Client'}</div>
                          <div className="text-[10px] text-gray-500">{rec.job_location || 'Site Location'}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-gray-800">{rec.assigned_service_engineer_name || rec.engineer_name}</span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-gray-600">
                          <div>{rec.original_scheduled_start_date || '—'}</div>
                          <div className="text-rose-700 font-bold">{rec.original_scheduled_end_date || '—'}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-gray-600">
                          {rec.approved_extended_end_date || '—'}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full inline-block ${
                              label.includes('Pending')
                                ? 'bg-amber-100 text-amber-900'
                                : label.includes('Rejected')
                                ? 'bg-rose-100 text-rose-900'
                                : label.includes('Late Completion')
                                ? 'bg-purple-100 text-purple-900'
                                : 'bg-red-100 text-red-900'
                            }`}
                          >
                            {label}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[11px]">
                          {rec.report_submitted || rec.resolved ? (
                            <span className="text-emerald-700 font-bold flex items-center gap-1">
                              <CheckCircle2 size={12} /> Submitted
                            </span>
                          ) : (
                            <span className="text-rose-600 font-semibold flex items-center gap-1">
                              <Clock size={12} /> Pending Submission
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleOpenOverdueInCalendar(rec)}
                            className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1"
                            title="Open engineer availability editor for this date"
                          >
                            <Calendar size={12} />
                            <span>Open in Calendar</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Decision Modal for Extension Approval / Rejection */}
      {activeExtensionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">
                  {activeExtensionModal.action === 'approve' ? 'Approve Extension Request' : 'Reject Extension Request'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Checklist {activeExtensionModal.request.checklist_number} • {activeExtensionModal.request.engineer_name || activeExtensionModal.request.technician_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveExtensionModal(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleDecisionSubmit} className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
                <div><strong>Requested Completion:</strong> {activeExtensionModal.request.requested_completion_date}</div>
                {activeExtensionModal.request.reason && (
                  <div><strong>Technician Reason:</strong> &quot;{activeExtensionModal.request.reason}&quot;</div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  Decision Notes / Reason:
                </label>
                <textarea
                  rows={3}
                  required={activeExtensionModal.action === 'reject'}
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder={
                    activeExtensionModal.action === 'approve'
                      ? 'Optional note for coordinator travel and accommodation review'
                      : 'Provide explicit rejection reason'
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-hidden focus:border-emerald-600 focus:bg-white resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveExtensionModal(null)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={decisionSubmitting}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeExtensionModal.action === 'approve'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {decisionSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>{activeExtensionModal.action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
