import React, { useState } from 'react';
import { X, ChevronDown, AlertTriangle } from 'lucide-react';
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

function addDaysToDate(dateStr, days) {
  const d = parseDateParts(dateStr);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + Number(days));
  return formatDateString(d);
}

function diffDaysBetween(startDateStr, endDateStr) {
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  if (!s || !e) return 1;
  const diffTime = e.getTime() - s.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
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

export default function TechnicianScheduleExtensionModal({
  token,
  checklist,
  onClose,
  onSuccess,
}) {
  const currentCompletionDate =
    checklist?.current_booking_end_date ||
    checklist?.booking_end_date ||
    checklist?.current_expected_arrival_date ||
    checklist?.expected_arrival_date ||
    '';

  const arrivalDate =
    checklist?.current_expected_arrival_date ||
    checklist?.expected_arrival_date ||
    '';

  const minCompletionDate = currentCompletionDate
    ? addDaysToDate(currentCompletionDate, 1)
    : arrivalDate;

  const [additionalWorkingDays, setAdditionalWorkingDays] = useState(1);
  const [requestedCompletionDate, setRequestedCompletionDate] = useState(() => {
    return currentCompletionDate ? addDaysToDate(currentCompletionDate, 1) : '';
  });

  const [selectedReason, setSelectedReason] = useState(EXTENSION_REASONS[0]);
  const [customReason, setCustomReason] = useState('');

  // Optional "More options" state
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [requestedReturnTravelDate, setRequestedReturnTravelDate] = useState('');
  const [restDayRequested, setRestDayRequested] = useState(false);
  const [requestedRestDate, setRequestedRestDate] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Sync date when user edits working days
  const handleWorkingDaysChange = (e) => {
    const val = e.target.value;
    setAdditionalWorkingDays(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && currentCompletionDate) {
      setRequestedCompletionDate(addDaysToDate(currentCompletionDate, num));
    }
  };

  // Sync working days when user edits completion date
  const handleCompletionDateChange = (e) => {
    const val = e.target.value;
    setRequestedCompletionDate(val);
    if (currentCompletionDate && val) {
      const diff = diffDaysBetween(currentCompletionDate, val);
      if (diff >= 1) {
        setAdditionalWorkingDays(diff);
      }
    }
  };

  const handleRestDayToggle = (e) => {
    const checked = e.target.checked;
    setRestDayRequested(checked);
    if (checked && !requestedRestDate) {
      setRequestedRestDate(addDaysToDate(requestedCompletionDate || currentCompletionDate, 1));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!requestedCompletionDate) {
      setError('Please select the new completion date.');
      return;
    }

    const days = parseInt(additionalWorkingDays, 10);
    if (isNaN(days) || days < 1) {
      setError('Additional working days must be at least 1.');
      return;
    }

    if (arrivalDate && requestedCompletionDate < arrivalDate) {
      setError(`New completion date cannot be before arrival date (${arrivalDate}).`);
      return;
    }

    if (restDayRequested && !requestedRestDate) {
      setError('Please select the requested rest date.');
      return;
    }

    const finalReason =
      selectedReason === 'Other operational site reason' && customReason.trim()
        ? customReason.trim()
        : selectedReason;

    if (selectedReason === 'Other operational site reason' && !customReason.trim()) {
      setError('Please specify the operational reason.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitTechnicianScheduleExtension(token, checklist.id, {
        requested_completion_date: requestedCompletionDate,
        requested_return_travel_date: requestedReturnTravelDate || null,
        additional_working_days: days,
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
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-gray-100 my-auto space-y-4 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Extend Schedule</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {checklist?.checklist_number ? `#${checklist.checklist_number}` : 'Checklist'}
            </p>
          </div>
          <button
            type="button"
            id="close-extension-modal-btn"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Compact Summary Card: Current Expected Completion Date */}
        <div className="bg-gray-50 border border-gray-200/80 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-gray-600 font-medium">Current Expected Completion</span>
          <span className="font-bold text-gray-900 font-mono">
            {formatDisplayDate(currentCompletionDate)}
          </span>
        </div>

        {/* Extension Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* New Completion Date */}
          <div>
            <label htmlFor="new-completion-date" className="block text-gray-700 font-semibold mb-1">
              New Completion Date <span className="text-red-500">*</span>
            </label>
            <input
              id="new-completion-date"
              type="date"
              min={minCompletionDate}
              value={requestedCompletionDate}
              onChange={handleCompletionDateChange}
              required
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
            />
          </div>

          {/* Additional Working Days */}
          <div>
            <label htmlFor="additional-working-days" className="block text-gray-700 font-semibold mb-1">
              Additional Working Days <span className="text-red-500">*</span>
            </label>
            <input
              id="additional-working-days"
              type="number"
              min="1"
              max="14"
              value={additionalWorkingDays}
              onChange={handleWorkingDaysChange}
              required
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
            />
          </div>

          {/* Reason for Extension */}
          <div>
            <label htmlFor="extension-reason" className="block text-gray-700 font-semibold mb-1">
              Reason for Extension <span className="text-red-500">*</span>
            </label>
            <select
              id="extension-reason"
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              required
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer transition"
            >
              {EXTENSION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {selectedReason === 'Other operational site reason' && (
            <div>
              <label htmlFor="custom-reason" className="block text-gray-700 font-semibold mb-1">
                Specify Operational Reason <span className="text-red-500">*</span>
              </label>
              <input
                id="custom-reason"
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe reason for extension..."
                required
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
              />
            </div>
          )}

          {/* More Options Collapsible */}
          <div className="border-t border-gray-100 pt-2">
            <button
              type="button"
              id="toggle-more-options-btn"
              onClick={() => setShowMoreOptions((prev) => !prev)}
              className="flex items-center justify-between w-full py-1 text-xs font-semibold text-gray-600 hover:text-gray-900 cursor-pointer transition"
            >
              <span className="flex items-center gap-1.5">
                <span>More options</span>
                {(requestedReturnTravelDate || restDayRequested || notes) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" title="Options configured" />
                )}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                  showMoreOptions ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showMoreOptions && (
              <div className="space-y-3 pt-2.5 animate-in fade-in">
                {/* Return Travel Date (optional) */}
                <div>
                  <label htmlFor="return-travel-date" className="block text-gray-700 font-semibold mb-1">
                    Return Travel Date <span className="text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="return-travel-date"
                    type="date"
                    min={requestedCompletionDate || minCompletionDate}
                    value={requestedReturnTravelDate}
                    onChange={(e) => setRequestedReturnTravelDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                  />
                </div>

                {/* Request Rest Day (optional checkbox/toggle) */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      id="request-rest-day-checkbox"
                      checked={restDayRequested}
                      onChange={handleRestDayToggle}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className="text-gray-700 font-semibold">Request Rest Day</span>
                  </label>

                  {restDayRequested && (
                    <div className="pl-6 pt-1">
                      <label htmlFor="requested-rest-date" className="block text-gray-700 font-semibold mb-1">
                        Requested Rest Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="requested-rest-date"
                        type="date"
                        min={requestedCompletionDate || minCompletionDate}
                        value={requestedRestDate}
                        onChange={(e) => setRequestedRestDate(e.target.value)}
                        required={restDayRequested}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                      />
                    </div>
                  )}
                </div>

                {/* Optional Notes for Coordinator */}
                <div>
                  <label htmlFor="coordinator-notes" className="block text-gray-700 font-semibold mb-1">
                    Optional Notes for Coordinator
                  </label>
                  <textarea
                    id="coordinator-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Details for coordinator (tickets, site delay, etc.)..."
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
            <button
              type="button"
              id="cancel-extension-btn"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-extension-btn"
              disabled={submitting}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                'Submit Request'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
