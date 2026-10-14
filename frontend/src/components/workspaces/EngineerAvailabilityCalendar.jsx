import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Search,
  Filter,
  Wrench,
  Bus,
  Moon,
  CalendarOff,
  AlertCircle,
  Eye,
  X,
  ExternalLink,
} from 'lucide-react';
import { fetchEngineersCalendar } from '../../lib/api';

const SERVICE_ENGINEERS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function EngineerAvailabilityCalendar({
  token,
  onSelectChecklist,
  onCreateWithEngineer,
  initialView = 'week',
}) {
  const [loading, setLoading] = useState(true);
  const [calendarData, setCalendarData] = useState(null);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState(initialView); // 'day' | 'week' | 'month'
  const [selectedEngineer, setSelectedEngineer] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [error, setError] = useState(null);

  // Selected Commitment Modal
  const [activeModalItem, setActiveModalItem] = useState(null);

  const loadCalendar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Calculate end date based on view mode
      const [y, m, d] = startDate.split('-').map(Number);
      const endObj = new Date(Date.UTC(y, m - 1, d));

      if (viewMode === 'day') {
        // 1 day
      } else if (viewMode === 'month') {
        endObj.setUTCDate(endObj.getUTCDate() + 29); // 30 days
      } else {
        // week (7 days)
        endObj.setUTCDate(endObj.getUTCDate() + 6);
      }
      const end = endObj.toISOString().split('T')[0];

      const res = await fetchEngineersCalendar(token, {
        startDate,
        endDate: end,
        view: viewMode,
        engineerId: selectedEngineer,
        statusFilter: selectedStatus,
      });
      setCalendarData(res);
    } catch (err) {
      console.error('Failed to load engineer calendar:', err);
      setError('Could not load availability schedule. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, [token, startDate, viewMode, selectedEngineer, selectedStatus]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const handlePrev = () => {
    const [y, m, d] = startDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    const step = viewMode === 'day' ? 1 : (viewMode === 'month' ? 30 : 7);
    dObj.setUTCDate(dObj.getUTCDate() - step);
    setStartDate(dObj.toISOString().split('T')[0]);
  };

  const handleNext = () => {
    const [y, m, d] = startDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    const step = viewMode === 'day' ? 1 : (viewMode === 'month' ? 30 : 7);
    dObj.setUTCDate(dObj.getUTCDate() + step);
    setStartDate(dObj.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    setStartDate(new Date().toISOString().split('T')[0]);
  };

  const formatDateHeader = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const dayNum = dt.getUTCDate();
    const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return { dayName, dayNum, month };
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const summary = calendarData?.summary || {
    total_engineers: 4,
    available: 0,
    assigned: 0,
    in_progress: 0,
    traveling: 0,
    resting: 0,
    on_leave: 0,
    conflicts: 0,
  };

  // Helper for status badge style and icon
  const getStatusBadge = (status, commitment) => {
    switch (status) {
      case 'AVAILABLE':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100',
          dot: 'bg-emerald-500',
          label: 'Available',
          icon: CheckCircle2,
        };
      case 'ASSIGNED':
        return {
          bg: 'bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100',
          dot: 'bg-sky-500',
          label: commitment?.checklist_number ? commitment.checklist_number.replace('EE-INST-', '') : 'Assigned',
          icon: Clock,
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
          bg: 'bg-purple-100 text-purple-900 border-purple-300 hover:bg-purple-200',
          dot: 'bg-purple-500',
          label: 'Traveling',
          icon: Bus,
        };
      case 'REST':
        return {
          bg: 'bg-indigo-100 text-indigo-900 border-indigo-300 hover:bg-indigo-200',
          dot: 'bg-indigo-500',
          label: 'Rest Day',
          icon: Moon,
        };
      case 'LEAVE':
        return {
          bg: 'bg-rose-100 text-rose-900 border-rose-300 hover:bg-rose-200',
          dot: 'bg-rose-500',
          label: 'On Leave',
          icon: CalendarOff,
        };
      case 'CONFLICT':
        return {
          bg: 'bg-red-100 text-red-900 border-red-400 animate-pulse hover:bg-red-200',
          dot: 'bg-red-600',
          label: 'Conflict!',
          icon: AlertTriangle,
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-800 border-gray-300',
          dot: 'bg-gray-400',
          label: 'Unavailable',
          icon: Clock,
        };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden space-y-4 p-4 sm:p-5">
      {/* 1. Header with View Controls, Navigation, and Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-100">
        <div>
          <span className="text-[10px] font-extrabold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 uppercase tracking-wider">
            Live Resource Tracking
          </span>
          <h3 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2 mt-1">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Technician Availability Calendar</span>
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time multi-dimensional schedule for Mathi, Guna, Sakthivel, and Kamalesh across assignments, extensions, rest, and leave.
          </p>
        </div>

        {/* View Mode & Date Navigator */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Selector (Day, Week, Month) */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                viewMode === 'day' ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                viewMode === 'week' ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                viewMode === 'month' ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Month
            </button>
          </div>

          {/* Date Navigator */}
          <button
            onClick={handleToday}
            className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
          >
            Today
          </button>

          <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl p-0.5">
            <button
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
              onClick={handleNext}
              title="Next"
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Real Calculated Availability Summary Bar at selected date */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 bg-gray-50/80 p-3 rounded-xl border border-gray-200 text-xs">
        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-gray-200">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
          <div>
            <span className="text-[10px] text-gray-500 uppercase block font-semibold">Engineers</span>
            <span className="font-black text-gray-900">{summary.total_engineers}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-emerald-200">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
          <div>
            <span className="text-[10px] text-emerald-600 uppercase block font-semibold">Available</span>
            <span className="font-black text-emerald-700">{summary.available}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-sky-200">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
          <div>
            <span className="text-[10px] text-sky-600 uppercase block font-semibold">Assigned</span>
            <span className="font-black text-sky-700">{summary.assigned}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-amber-200">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
          <div>
            <span className="text-[10px] text-amber-600 uppercase block font-semibold">Working</span>
            <span className="font-black text-amber-700">{summary.in_progress}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-purple-200">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
          <div>
            <span className="text-[10px] text-purple-600 uppercase block font-semibold">Traveling</span>
            <span className="font-black text-purple-700">{summary.traveling}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-indigo-200">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0" />
          <div>
            <span className="text-[10px] text-indigo-600 uppercase block font-semibold">Resting</span>
            <span className="font-black text-indigo-700">{summary.resting}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-rose-200">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
          <div>
            <span className="text-[10px] text-rose-600 uppercase block font-semibold">On Leave</span>
            <span className="font-black text-rose-700">{summary.on_leave}</span>
          </div>
        </div>
      </div>

      {/* 3. Filters (Engineer & Status) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-500 font-semibold">
          <Filter size={14} />
          <span>Filters:</span>
        </div>

        <select
          value={selectedEngineer}
          onChange={(e) => setSelectedEngineer(e.target.value)}
          className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-medium text-gray-700 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
        >
          <option value="ALL">All 4 Engineers</option>
          {SERVICE_ENGINEERS.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-medium text-gray-700 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
        >
          <option value="ALL">All Statuses</option>
          <option value="AVAILABLE">Available</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">On Installation/Service</option>
          <option value="REST">Rest Day</option>
          <option value="LEAVE">On Leave</option>
          <option value="TRAVEL">Traveling</option>
          <option value="CONFLICT">Schedule Conflict</option>
        </select>
      </div>

      {/* 4. Calendar Grid */}
      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-semibold">Calculating live engineer availability...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : calendarData?.schedule ? (
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-left border-collapse text-xs min-w-[750px]">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="py-2.5 px-3 font-semibold text-gray-600 uppercase text-[10px] tracking-wider w-40">
                  Service Engineer
                </th>
                {calendarData.dates.map((dateStr) => {
                  const { dayName, dayNum, month } = formatDateHeader(dateStr);
                  const isToday = dateStr === todayStr;
                  return (
                    <th
                      key={dateStr}
                      className={`py-2 px-1 text-center border-l border-gray-100 ${
                        isToday ? 'bg-indigo-50/70 text-indigo-900 font-extrabold' : 'text-gray-600'
                      }`}
                    >
                      <div className="text-[10px] font-medium uppercase text-gray-400">{dayName}</div>
                      <div className={`text-xs ${isToday ? 'font-bold text-indigo-700' : 'font-semibold'}`}>
                        {dayNum} {month}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calendarData.schedule.map(({ engineer, days, warnings }) => (
                <tr key={engineer.id} className="hover:bg-gray-50/60 transition-colors">
                  {/* Engineer Info */}
                  <td className="py-3 px-3">
                    <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      {engineer.name}
                    </div>
                    {warnings && warnings.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/80" title={warnings[0].message}>
                        <AlertCircle size={10} className="shrink-0" />
                        <span className="truncate max-w-[110px]">Warning Pending</span>
                      </div>
                    )}
                  </td>

                  {/* Day Cells */}
                  {days.map(({ date, status, status_label, is_available, commitment, commitments }) => {
                    const isToday = date === todayStr;
                    const badge = getStatusBadge(status, commitment);
                    const IconComp = badge.icon;

                    return (
                      <td
                        key={date}
                        className={`py-2 px-1 text-center border-l border-gray-100 align-middle ${
                          isToday ? 'bg-indigo-50/20' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (commitment || (commitments && commitments.length > 0)) {
                              setActiveModalItem({
                                date,
                                engineer,
                                status,
                                status_label,
                                commitment,
                                commitments,
                              });
                            } else if (onCreateWithEngineer) {
                              onCreateWithEngineer(engineer.name, date);
                            }
                          }}
                          className={`inline-flex flex-col items-center justify-center w-full py-1.5 px-1 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${badge.bg}`}
                          title={`${engineer.name}: ${status_label} (${date})`}
                        >
                          <div className="flex items-center gap-1">
                            <IconComp size={10} className="shrink-0" />
                            <span className="truncate max-w-[55px] font-extrabold">{badge.label}</span>
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

      {/* 5. Accessible Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-[11px] text-gray-500 border-t border-gray-100">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 inline-block" />
            <span className="font-semibold text-gray-700">Available</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-sky-100 border border-sky-300 inline-block" />
            <span className="font-semibold text-gray-700">Assigned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />
            <span className="font-semibold text-gray-700">On Site</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 border border-purple-300 inline-block" />
            <span className="font-semibold text-gray-700">Traveling</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300 inline-block" />
            <span className="font-semibold text-gray-700">Rest Day</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" />
            <span className="font-semibold text-gray-700">On Leave</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 border border-red-400 inline-block" />
            <span className="font-semibold text-red-700">Conflict</span>
          </div>
        </div>

        <span className="text-[10px] text-gray-400">
          Click any assigned item to view schedule details or history.
        </span>
      </div>

      {/* 6. Commitment Detail Modal */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-gray-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {activeModalItem.status_label}
                </span>
                <h4 className="text-base font-bold text-gray-900 mt-1">
                  {activeModalItem.engineer.name} — {activeModalItem.date}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalItem(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Commitment Details */}
            {activeModalItem.commitment && (
              <div className="bg-gray-50 rounded-xl p-3.5 space-y-2 text-xs">
                {activeModalItem.commitment.checklist_number && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Checklist:</span>
                    <span className="font-mono font-bold text-indigo-700">{activeModalItem.commitment.checklist_number}</span>
                  </div>
                )}
                {activeModalItem.commitment.client_name && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Client:</span>
                    <span className="font-bold text-gray-900">{activeModalItem.commitment.client_name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500 font-medium">Scheduled Range:</span>
                  <span className="font-semibold text-gray-800">
                    {activeModalItem.commitment.start_date} to {activeModalItem.commitment.end_date}
                  </span>
                </div>
                {activeModalItem.commitment.effective_end_date && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Early Completion Released:</span>
                    <span>{activeModalItem.commitment.effective_end_date}</span>
                  </div>
                )}
                {activeModalItem.commitment.reason && (
                  <div className="pt-1 border-t border-gray-200">
                    <span className="text-gray-500 font-medium block">Reason / Notes:</span>
                    <p className="text-gray-800 mt-0.5">{activeModalItem.commitment.reason}</p>
                  </div>
                )}
              </div>
            )}

            {/* Multi-commitment conflict list */}
            {activeModalItem.commitments && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertTriangle size={14} /> Conflicting Overlapping Commitments:
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {activeModalItem.commitments.map((c, idx) => (
                    <div key={idx} className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs">
                      <span className="font-bold text-red-900">{c.type}: {c.checklist_number || c.reason || 'Booking'}</span>
                      <div className="text-gray-600 text-[11px]">{c.start_date} to {c.effective_end_date || c.end_date}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              {activeModalItem.commitment?.checklist_id && onSelectChecklist && (
                <button
                  type="button"
                  onClick={() => {
                    const cid = activeModalItem.commitment.checklist_id;
                    setActiveModalItem(null);
                    onSelectChecklist(cid);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition flex items-center gap-1 cursor-pointer"
                >
                  <Eye size={14} />
                  <span>View Checklist</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveModalItem(null)}
                className="px-3.5 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
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
