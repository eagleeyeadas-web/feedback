import { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Search,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { fetchEngineersCalendar } from '../../lib/api';

export default function EngineerAvailabilityCalendar({ token, onSelectChecklist, onCreateWithEngineer }) {
  const [loading, setLoading] = useState(true);
  const [calendarData, setCalendarData] = useState(null);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [error, setError] = useState(null);

  // Quick Date Range Availability Checker State
  const [checkDate, setCheckDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [checkDays, setCheckDays] = useState(1);

  const loadCalendar = async (start) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch 10 days of schedule starting from 'start'
      const [y, m, d] = start.split('-').map(Number);
      const endObj = new Date(Date.UTC(y, m - 1, d));
      endObj.setUTCDate(endObj.getUTCDate() + 9);
      const end = endObj.toISOString().split('T')[0];

      const res = await fetchEngineersCalendar(token, { startDate: start, endDate: end });
      setCalendarData(res);
    } catch (err) {
      console.error('Failed to load engineer calendar:', err);
      setError('Could not load availability schedule. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar(startDate);
  }, [token, startDate]);

  const handlePrev = () => {
    const [y, m, d] = startDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    dObj.setUTCDate(dObj.getUTCDate() - 7);
    setStartDate(dObj.toISOString().split('T')[0]);
  };

  const handleNext = () => {
    const [y, m, d] = startDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    dObj.setUTCDate(dObj.getUTCDate() + 7);
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

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden space-y-4 p-5">
      {/* Header bar with timeline navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-gray-100">
        <div>
          <span className="text-[10px] font-extrabold px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 uppercase tracking-wider">
            Live Field Resource Schedule
          </span>
          <h3 className="text-base font-bold text-navy flex items-center gap-2 mt-1">
            <Users className="w-5 h-5 text-blue-600" />
            Service Engineer Availability Calendar
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time schedule for Mathi, Guna, Sakthivel, and Kamalesh across scheduled installation dates.
          </p>
        </div>

        {/* Date Navigator */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={handleToday}
            className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
          >
            Today
          </button>
          <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={handlePrev}
              title="Previous 7 Days"
              className="p-1 text-gray-600 hover:text-navy hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono font-bold px-2 text-gray-700">
              {calendarData?.start_date} – {calendarData?.end_date}
            </span>
            <button
              onClick={handleNext}
              title="Next 7 Days"
              className="p-1 text-gray-600 hover:text-navy hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Timeline Grid */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-medium">Checking live engineer bookings...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : calendarData?.schedule ? (
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-left border-collapse text-xs min-w-[700px]">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="py-2.5 px-3 font-semibold text-gray-600 uppercase text-[10px] tracking-wider w-44">
                  Service Engineer
                </th>
                {calendarData.dates.map((dateStr) => {
                  const { dayName, dayNum, month } = formatDateHeader(dateStr);
                  const isToday = dateStr === todayStr;
                  return (
                    <th
                      key={dateStr}
                      className={`py-2 px-1 text-center border-l border-gray-100 ${
                        isToday ? 'bg-blue-50/70 text-blue-900 font-extrabold' : 'text-gray-600'
                      }`}
                    >
                      <div className="text-[10px] font-medium uppercase text-gray-400">{dayName}</div>
                      <div className={`text-xs ${isToday ? 'font-bold text-blue-700' : 'font-semibold'}`}>
                        {dayNum} {month}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calendarData.schedule.map(({ engineer, days, total_booked_days }) => (
                <tr key={engineer.id} className="hover:bg-gray-50/60 transition-colors">
                  {/* Engineer Info */}
                  <td className="py-3 px-3">
                    <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      {engineer.name}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {total_booked_days > 0 ? (
                        <span className="text-purple-700 font-medium">{total_booked_days} day(s) booked</span>
                      ) : (
                        <span className="text-emerald-700 font-medium">100% Free</span>
                      )}
                    </div>
                  </td>

                  {/* Day Cells */}
                  {days.map(({ date, is_available, booking }) => {
                    const isToday = date === todayStr;
                    return (
                      <td
                        key={date}
                        className={`py-2 px-1 text-center border-l border-gray-100 align-middle ${
                          isToday ? 'bg-blue-50/30' : ''
                        }`}
                      >
                        {is_available ? (
                          <div
                            className="inline-flex items-center justify-center w-full py-1.5 px-1 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold border border-emerald-200/60"
                            title={`${engineer.name} is Available on ${date}`}
                          >
                            Free
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              if (booking?.checklist_id && onSelectChecklist) {
                                onSelectChecklist(booking.checklist_id);
                              }
                            }}
                            className="inline-flex flex-col items-center justify-center w-full py-1 px-1 bg-purple-100 text-purple-900 rounded text-[9px] font-bold border border-purple-300 shadow-2xs cursor-pointer hover:bg-purple-200 transition-colors"
                            title={`Booked for ${booking?.checklist_number} (${booking?.booking_start_date} to ${booking?.booking_end_date})`}
                          >
                            <span className="font-extrabold text-[9px] truncate max-w-[65px]">
                              {booking?.checklist_number ? booking.checklist_number.replace('EE-INST-', '') : 'Booked'}
                            </span>
                            <span className="text-[8px] font-medium text-purple-700 uppercase">Booked</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Legend & Quick Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[11px] text-gray-500 border-t border-gray-100">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 inline-block" />
            <span className="font-medium text-gray-700">Available (Selectable for new jobs)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 border border-purple-300 inline-block" />
            <span className="font-medium text-gray-700">Booked (Locked to prevent double-booking)</span>
          </div>
        </div>

        <span className="text-[10px] text-gray-400">
          Overlapping dates are automatically blocked when saving new checklist assignments.
        </span>
      </div>
    </div>
  );
}
