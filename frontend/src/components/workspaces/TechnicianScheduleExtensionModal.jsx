import React, { useState, useEffect } from 'react';
import { X, ChevronDown, AlertTriangle, Clock } from 'lucide-react';
import { submitTechnicianScheduleExtension, fetchTechnicianExtensionRequests } from '../../lib/api';

const EXTENSION_REASONS = [
  'Installation taking longer than expected',
  'Additional work required',
  'Travel or site delay',
  'Other',
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
  const scheduledEndDate =
    checklist?.current_booking_end_date ||
    checklist?.booking_end_date ||
    checklist?.current_expected_arrival_date ||
    checklist?.expected_arrival_date ||
    '';

  const arrivalDate =
    checklist?.current_expected_arrival_date ||
    checklist?.expected_arrival_date ||
    '';

  // Rule: Scheduled end date is the final working day and is inclusive.
  // Technician's earliest availability date is strictly the next calendar day (scheduled end date + 1 day).
  const currentAvailabilityDate = scheduledEndDate
    ? addDaysToDate(scheduledEndDate, 1)
    : (arrivalDate ? addDaysToDate(arrivalDate, 1) : '');

  // Earliest date the technician can extend work through is scheduledEndDate + 1 day
  const minCompletionDate = scheduledEndDate
    ? addDaysToDate(scheduledEndDate, 1)
    : (arrivalDate ? addDaysToDate(arrivalDate, 1) : '');

  const [requestedCompletionDate, setRequestedCompletionDate] = useState(() => {
    return scheduledEndDate ? addDaysToDate(scheduledEndDate, 1) : '';
  });

  const [selectedReason, setSelectedReason] = useState(EXTENSION_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');

  const [pendingRequest, setPendingRequest] = useState(() => checklist?.pending_extension || null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Check for any active pending request for this checklist to prevent duplicates
  useEffect(() => {
    let isMounted = true;
    if (checklist?.id && token && !checklist?.pending_extension) {
      fetchTechnicianExtensionRequests(token, checklist.id)
        .then((res) => {
          if (!isMounted) return;
          const pending = (res.requests || []).find((r) => r.status === 'PENDING');
          if (pending) {
            setPendingRequest(pending);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [checklist?.id, checklist?.pending_extension, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!requestedCompletionDate) {
      setError('Please select the extended work completion date.');
      return;
    }

    if (arrivalDate && requestedCompletionDate < arrivalDate) {
      setError(`Extended work date cannot be before arrival date (${arrivalDate}).`);
      return;
    }

    if (scheduledEndDate && requestedCompletionDate <= scheduledEndDate) {
      setError(
        `Extended work date must be after current scheduled completion date (${formatDisplayDate(scheduledEndDate)}).`
      );
      return;
    }

    const finalReason =
      selectedReason === 'Other' && customReason.trim()
        ? customReason.trim()
        : selectedReason;

    if (selectedReason === 'Other' && !customReason.trim()) {
      setError('Please specify the reason for date change.');
      return;
    }

    const days = scheduledEndDate && requestedCompletionDate
      ? Math.max(1, diffDaysBetween(scheduledEndDate, requestedCompletionDate))
      : 1;

    setSubmitting(true);
    try {
      const res = await submitTechnicianScheduleExtension(token, checklist.id, {
        requested_completion_date: requestedCompletionDate,
        additional_working_days: days,
        reason: finalReason,
        notes: notes.trim(),
      });

      if (onSuccess) {
        onSuccess(res.extension || res);
      }
      onClose();
    } catch (err) {
      console.error('Failed to submit availability date request:', err);
      setError(err.message || 'Failed to submit availability date request. Please try again.');
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
            <h2 className="text-base font-bold text-gray-900">Update Availability Date</h2>
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

        {/* Case 1: Pending Request already exists - show details and prevent duplicate */}
        {pendingRequest ? (
          <div className="space-y-3.5 text-xs">
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Availability Date Request Pending Review</span>
              </div>
              <p className="text-[11px] text-amber-700">
                An availability date update request has already been submitted for this checklist and is awaiting HR review. Duplicate submissions are not permitted.
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Current Availability Date:</span>
                <span className="font-bold text-gray-900 font-mono">
                  {formatDisplayDate(
                    addDaysToDate(
                      pendingRequest.current_dates?.completion_date ||
                      pendingRequest.current_completion_date ||
                      scheduledEndDate,
                      1
                    )
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Extend Work Through (Inclusive):</span>
                <span className="font-semibold text-gray-700 font-mono">
                  {formatDisplayDate(pendingRequest.requested_completion_date)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Requested New Availability Date:</span>
                <span className="font-bold text-amber-700 font-mono">
                  {formatDisplayDate(addDaysToDate(pendingRequest.requested_completion_date, 1))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Reason for Date Change:</span>
                <span className="font-semibold text-gray-800 text-right max-w-[60%]">
                  {pendingRequest.reason}
                </span>
              </div>
              {pendingRequest.notes && (
                <div className="pt-1.5 border-t border-gray-200">
                  <span className="text-gray-500 font-medium block mb-0.5">Additional Notes:</span>
                  <p className="text-gray-800 bg-white p-2 rounded-lg border border-gray-100">
                    {pendingRequest.notes}
                  </p>
                </div>
              )}
              <div className="flex justify-between pt-1 text-[11px] text-gray-500 border-t border-gray-200">
                <span>Status:</span>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold uppercase text-[10px]">
                  {pendingRequest.status}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-gray-100">
              <button
                type="button"
                id="close-pending-extension-btn"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          /* Case 2: New Request Form */
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            {/* Current Availability Date (Read-Only) */}
            <div className="bg-gray-50 border border-gray-200/80 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs">
              <div>
                <span className="text-gray-600 font-medium block">Current Availability Date</span>
                {scheduledEndDate && (
                  <span className="text-[10px] text-gray-400">
                    Work ends {formatDisplayDate(scheduledEndDate)} (inclusive)
                  </span>
                )}
              </div>
              <span className="font-bold text-gray-900 font-mono text-sm">
                {formatDisplayDate(currentAvailabilityDate)}
              </span>
            </div>

            {/* Extend Work End Date (Required Date Picker) */}
            <div>
              <label htmlFor="new-completion-date" className="block text-gray-700 font-semibold mb-1">
                Extend Work Through Date (Final Working Day) <span className="text-red-500">*</span>
              </label>
              <input
                id="new-completion-date"
                type="date"
                min={minCompletionDate}
                value={requestedCompletionDate}
                onChange={(e) => setRequestedCompletionDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
              />
              {requestedCompletionDate && (
                <div className="mt-1.5 p-2 bg-amber-50/80 border border-amber-200/80 rounded-lg text-amber-900 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-amber-800">New Earliest Availability Date:</span>
                  <span className="font-bold font-mono text-amber-900">
                    {formatDisplayDate(addDaysToDate(requestedCompletionDate, 1))}
                  </span>
                </div>
              )}
            </div>

            {/* Reason for Date Change (Required Dropdown) */}
            <div>
              <label htmlFor="extension-reason" className="block text-gray-700 font-semibold mb-1">
                Reason for Date Change <span className="text-red-500">*</span>
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

            {/* Custom reason input if 'Other' is selected */}
            {selectedReason === 'Other' && (
              <div>
                <label htmlFor="custom-reason" className="block text-gray-700 font-semibold mb-1">
                  Specify Reason <span className="text-red-500">*</span>
                </label>
                <input
                  id="custom-reason"
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Specify reason for date change..."
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                />
              </div>
            )}

            {/* Optional Expandable "Additional notes" Textarea */}
            <div className="border-t border-gray-100 pt-2">
              <button
                type="button"
                id="toggle-additional-notes-btn"
                onClick={() => setShowNotes((prev) => !prev)}
                className="flex items-center justify-between w-full py-1 text-xs font-semibold text-gray-600 hover:text-gray-900 cursor-pointer transition"
              >
                <span className="flex items-center gap-1.5">
                  <span>Additional notes (optional)</span>
                  {notes.trim() && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  )}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                    showNotes ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {showNotes && (
                <div className="pt-2 animate-in fade-in">
                  <textarea
                    id="additional-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Add any specific context or details for HR..."
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition resize-none text-xs"
                  />
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
                  'Submit Availability Date Request'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
