import React, { useState } from 'react';
import {
  CalendarOff,
  Calendar,
  AlertTriangle,
  X,
  Send,
} from 'lucide-react';
import { submitTechnicianLeaveRequest } from '../../lib/api';

const LEAVE_TYPES = ['Casual', 'Sick', 'Emergency', 'Annual', 'Personal'];

export default function TechnicianLeaveModal({
  token,
  user,
  onClose,
  onSuccess,
}) {
  const [leaveStartDate, setLeaveStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [leaveEndDate, setLeaveEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [leaveType, setLeaveType] = useState('Casual');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!leaveStartDate) {
      setError('Start date is required.');
      return;
    }
    if (leaveEndDate < leaveStartDate) {
      setError('End date cannot be before start date.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason for the leave request is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitTechnicianLeaveRequest(token, {
        engineer_name: user?.full_name || user?.email || '',
        leave_start_date: leaveStartDate,
        leave_end_date: leaveEndDate,
        leave_type: leaveType,
        reason: reason.trim(),
        notes: notes.trim(),
      });

      if (onSuccess) onSuccess(res.leave || res);
      onClose();
    } catch (err) {
      console.error('Failed to submit leave request:', err);
      setError(err.message || 'Failed to submit leave request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200 uppercase tracking-wider">
              Time Off Request
            </span>
            <h2 className="text-lg font-black text-gray-900 mt-1 flex items-center gap-2">
              <CalendarOff className="w-5 h-5 text-rose-600" />
              <span>Request Leave</span>
            </h2>
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
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Leave Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={leaveStartDate}
                onChange={(e) => {
                  setLeaveStartDate(e.target.value);
                  if (leaveEndDate < e.target.value) setLeaveEndDate(e.target.value);
                }}
                required
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Leave End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={leaveEndDate}
                min={leaveStartDate}
                onChange={(e) => setLeaveEndDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-rose-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Leave Type <span className="text-red-500">*</span>
            </label>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-rose-500 cursor-pointer"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>{t} Leave</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Reason for Leave <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="e.g. Family function, medical visit, personal..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Additional Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any details for the Coordinator..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-rose-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
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
              className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send size={14} />
              <span>{submitting ? 'Submitting...' : 'Submit Leave Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
