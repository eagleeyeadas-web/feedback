import React, { useState } from 'react';
import {
  Clock,
  Calendar,
  AlertTriangle,
  X,
  Send,
  Plus,
  Bus,
  Moon,
  Info,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { submitTechnicianScheduleExtension } from '../../lib/api';

const EXTENSION_REASONS = [
  'Installation work taking longer than expected',
  'Extra camera devices being installed on site',
  'Additional wiring / vehicle fabrication required',
  'Long-distance travel or site access delay',
  'Client requested additional vehicle installation',
  'Adverse weather or site conditions',
  'Other operational site reason',
];

export default function TechnicianScheduleExtensionModal({
  token,
  checklist,
  onClose,
  onSuccess,
}) {
  const [requestedCompletionDate, setRequestedCompletionDate] = useState(() => {
    const curEnd = checklist?.current_booking_end_date || checklist?.booking_end_date || checklist?.expected_arrival_date;
    if (curEnd) {
      const [y, m, d] = curEnd.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + 1);
      return dt.toISOString().split('T')[0];
    }
    return '';
  });

  const [additionalWorkingDays, setAdditionalWorkingDays] = useState(1);
  const [requestedReturnTravelDate, setRequestedReturnTravelDate] = useState('');
  const [restDayRequested, setRestDayRequested] = useState(false);
  const [requestedRestDate, setRequestedRestDate] = useState('');
  const [selectedReason, setSelectedReason] = useState(EXTENSION_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const originalDates = {
    arrival_date: checklist?.original_expected_arrival_date || checklist?.expected_arrival_date,
    arrival_time: checklist?.original_expected_arrival_time || checklist?.expected_arrival_time,
    duration: checklist?.original_installation_duration || checklist?.installation_duration || '1 Day',
    completion_date: checklist?.original_booking_end_date || checklist?.booking_end_date,
  };

  const currentDates = {
    arrival_date: checklist?.current_expected_arrival_date || checklist?.expected_arrival_date,
    arrival_time: checklist?.current_expected_arrival_time || checklist?.expected_arrival_time,
    duration: checklist?.current_installation_duration || checklist?.installation_duration || '1 Day',
    completion_date: checklist?.current_booking_end_date || checklist?.booking_end_date,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!requestedCompletionDate) {
      setError('Please select the requested revised completion date.');
      return;
    }

    const arrivalDate = currentDates.arrival_date;
    if (requestedCompletionDate < arrivalDate) {
      setError(`Revised completion date cannot be before arrival date (${arrivalDate}).`);
      return;
    }

    if (restDayRequested && !requestedRestDate) {
      setError('Please select the requested rest date.');
      return;
    }

    const finalReason = selectedReason === 'Other operational site reason' && customReason.trim()
      ? customReason.trim()
      : selectedReason;

    setSubmitting(true);
    try {
      const res = await submitTechnicianScheduleExtension(token, checklist.id, {
        requested_completion_date: requestedCompletionDate,
        requested_return_travel_date: requestedReturnTravelDate || null,
        additional_working_days: parseInt(additionalWorkingDays, 10) || 1,
        rest_day_requested: Boolean(restDayRequested),
        requested_rest_date: restDayRequested ? requestedRestDate : null,
        reason: finalReason,
        notes: notes.trim(),
      });

      if (onSuccess) {
        onSuccess(res.extension || res);
      }
      onClose();
    } catch (err) {
      console.error('Failed to submit extension request:', err);
      setError(err.message || 'Failed to submit extension request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-gray-100 my-8 space-y-5 animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider">
                Field Schedule Action
              </span>
              <span className="text-xs font-mono font-bold text-gray-500">{checklist?.checklist_number}</span>
            </div>
            <h2 className="text-lg font-black text-gray-900 mt-1 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span>Request Schedule Extension</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Submit an extension for Coordinator approval if installation requires extra days, return travel revision, or post-job rest.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Schedule Context Box: Original vs Current */}
        <div className="grid grid-cols-2 gap-3 p-3.5 bg-gray-50 rounded-2xl border border-gray-200 text-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
              Original Planned Schedule
            </span>
            <div className="font-semibold text-gray-800">
              Arrival: {originalDates.arrival_date} ({originalDates.arrival_time})
            </div>
            <div className="text-gray-600 text-[11px]">
              Planned Duration: <span className="font-bold text-gray-900">{originalDates.duration}</span>
            </div>
            <div className="text-gray-600 text-[11px]">
              Planned End: <span className="font-bold text-gray-900">{originalDates.completion_date || originalDates.arrival_date}</span>
            </div>
          </div>

          <div className="space-y-1 border-l border-gray-200 pl-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">
              Current Expected Schedule
            </span>
            <div className="font-semibold text-gray-800">
              Arrival: {currentDates.arrival_date} ({currentDates.arrival_time})
            </div>
            <div className="text-gray-600 text-[11px]">
              Current Duration: <span className="font-bold text-gray-900">{currentDates.duration}</span>
            </div>
            <div className="text-gray-600 text-[11px]">
              Current Expected End: <span className="font-bold text-gray-900">{currentDates.completion_date || currentDates.arrival_date}</span>
            </div>
          </div>
        </div>

        {/* Extension Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Section 1: Additional Installation Workdays */}
          <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200 space-y-3">
            <h4 className="font-bold text-gray-900 flex items-center gap-1.5 text-xs text-amber-900">
              <Plus className="w-4 h-4 text-amber-600" />
              <span>1. Additional Installation / Service Workdays</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Requested Revised Completion Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={requestedCompletionDate}
                  min={currentDates.arrival_date}
                  onChange={(e) => setRequestedCompletionDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Additional Working Days <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="14"
                  value={additionalWorkingDays}
                  onChange={(e) => setAdditionalWorkingDays(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Return Travel Date (Distinct from workdays) */}
          <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-200 space-y-2">
            <h4 className="font-bold text-gray-900 flex items-center gap-1.5 text-xs text-purple-900">
              <Bus className="w-4 h-4 text-purple-600" />
              <span>2. Return Travel Date (When applicable)</span>
            </h4>
            <p className="text-[11px] text-gray-500">
              If extended installation requires shifting your bus ticket or return travel, specify the new return departure date.
            </p>
            <div>
              <input
                type="date"
                value={requestedReturnTravelDate}
                min={requestedCompletionDate || currentDates.arrival_date}
                onChange={(e) => setRequestedReturnTravelDate(e.target.value)}
                className="w-full sm:w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-purple-500"
              />
            </div>
          </div>

          {/* Section 3: Rest Day Request (Distinct from workdays) */}
          <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-200 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-gray-900 flex items-center gap-1.5 text-xs text-indigo-900">
                <Moon className="w-4 h-4 text-indigo-600" />
                <span>3. Post-Job Rest Day (Optional)</span>
              </h4>
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restDayRequested}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRestDayRequested(checked);
                    if (checked && !requestedRestDate && requestedCompletionDate) {
                      const [y, m, d] = requestedCompletionDate.split('-').map(Number);
                      const dt = new Date(Date.UTC(y, m - 1, d));
                      dt.setUTCDate(dt.getUTCDate() + 1);
                      setRequestedRestDate(dt.toISOString().split('T')[0]);
                    }
                  }}
                  className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Request Rest Day</span>
              </label>
            </div>

            {restDayRequested && (
              <div className="pt-2 border-t border-indigo-100">
                <label className="block text-gray-700 font-semibold mb-1">
                  Requested Rest Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={requestedRestDate}
                  min={requestedCompletionDate || currentDates.arrival_date}
                  onChange={(e) => setRequestedRestDate(e.target.value)}
                  required={restDayRequested}
                  className="w-full sm:w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  An approved rest day blocks future job bookings on this date and allows you time to recuperate after multi-day work.
                </p>
              </div>
            )}
          </div>

          {/* Section 4: Reason & Operational Notes */}
          <div className="space-y-3">
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Reason for Extension <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
              >
                {EXTENSION_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {selectedReason === 'Other operational site reason' && (
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Specify Operational Reason <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Describe why extra time is required..."
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            )}

            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Optional Notes for Coordinator
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any site context, ticket references, or logistics details..."
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send size={14} />
              <span>{submitting ? 'Submitting...' : 'Submit Extension Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
