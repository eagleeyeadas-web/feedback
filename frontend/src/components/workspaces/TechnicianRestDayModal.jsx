import React, { useState } from 'react';
import {
  Moon,
  Calendar,
  AlertTriangle,
  X,
  Send,
  Info,
} from 'lucide-react';
import { submitTechnicianRestDayRequest } from '../../lib/api';

const REST_REASONS = [
  'Rest after long-distance travel journey',
  'Rest after multi-day continuous installation',
  'Company rest-day policy entitlement',
  'Fatigue management following overnight travel',
  'Other operational rest requirement',
];

export default function TechnicianRestDayModal({
  token,
  user,
  checklists = [],
  onClose,
  onSuccess,
}) {
  const [restStartDate, setRestStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [restEndDate, setRestEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedChecklistId, setSelectedChecklistId] = useState('');
  const [selectedReason, setSelectedReason] = useState(REST_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!restStartDate) {
      setError('Start date is required.');
      return;
    }
    if (restEndDate < restStartDate) {
      setError('End date cannot be before start date.');
      return;
    }

    const finalReason = selectedReason === 'Other operational rest requirement' && customReason.trim()
      ? customReason.trim()
      : selectedReason;

    const matchedChecklist = checklists.find((c) => c.id === selectedChecklistId);

    setSubmitting(true);
    try {
      const res = await submitTechnicianRestDayRequest(token, {
        engineer_name: user?.full_name || user?.email || '',
        checklist_id: selectedChecklistId || null,
        checklist_number: matchedChecklist ? matchedChecklist.checklist_number : null,
        rest_start_date: restStartDate,
        rest_end_date: restEndDate,
        reason: finalReason,
        notes: notes.trim(),
      });

      if (onSuccess) onSuccess(res.rest_day || res);
      onClose();
    } catch (err) {
      console.error('Failed to submit rest-day request:', err);
      setError(err.message || 'Failed to submit rest day request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wider">
              Health & Rest Policy
            </span>
            <h2 className="text-lg font-black text-gray-900 mt-1 flex items-center gap-2">
              <Moon className="w-5 h-5 text-indigo-600" />
              <span>Request Rest Day</span>
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
                Rest Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={restStartDate}
                onChange={(e) => {
                  setRestStartDate(e.target.value);
                  if (restEndDate < e.target.value) setRestEndDate(e.target.value);
                }}
                required
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Rest End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={restEndDate}
                min={restStartDate}
                onChange={(e) => setRestEndDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Related Installation Checklist (Optional)
            </label>
            <select
              value={selectedChecklistId}
              onChange={(e) => setSelectedChecklistId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
            >
              <option value="">-- No Specific Job / Standalone --</option>
              {checklists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.checklist_number} — {c.client_name} ({c.client_location || 'Site'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Reason for Rest <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
            >
              {REST_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {selectedReason === 'Other operational rest requirement' && (
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Specify Reason <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                required
                placeholder="Describe reason..."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-gray-700 font-semibold mb-1">
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any details for the Coordinator..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-medium text-gray-900 focus:outline-hidden focus:border-indigo-500"
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
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send size={14} />
              <span>{submitting ? 'Submitting...' : 'Submit Rest Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
