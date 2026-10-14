import React, { useState, useEffect } from 'react';
import {
  History,
  X,
  Calendar,
  Clock,
  ArrowRight,
  User,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { fetchScheduleRevisionHistory } from '../../lib/api';

export default function ScheduleHistoryModal({ token, checklist, onClose }) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!checklist?.id || !token) return;
    setLoading(true);
    fetchScheduleRevisionHistory(token, checklist.id)
      .then((res) => setHistory(res.history || []))
      .catch((err) => setError(err.message || 'Failed to load schedule history'))
      .finally(() => setLoading(false));
  }, [checklist?.id, token]);

  const originalDates = {
    arrival: checklist?.original_expected_arrival_date || checklist?.expected_arrival_date,
    duration: checklist?.original_installation_duration || checklist?.installation_duration,
    end: checklist?.original_booking_end_date || checklist?.booking_end_date,
  };

  const currentDates = {
    arrival: checklist?.current_expected_arrival_date || checklist?.expected_arrival_date,
    duration: checklist?.current_installation_duration || checklist?.installation_duration,
    end: checklist?.current_booking_end_date || checklist?.booking_end_date,
    revision: checklist?.schedule_revision_number || 0,
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in fade-in zoom-in-95 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider">
                Audit Trail
              </span>
              <span className="font-mono text-xs font-bold text-gray-500">{checklist?.checklist_number}</span>
            </div>
            <h3 className="text-base font-black text-gray-900 mt-1 flex items-center gap-1.5">
              <History className="w-5 h-5 text-indigo-600" />
              <span>Schedule Revision History</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Current vs Original comparison card */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-200 text-xs shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase text-gray-500 block">Original Schedule</span>
            <div className="font-bold text-gray-900 mt-0.5">{originalDates.arrival} ({originalDates.duration})</div>
            <div className="text-[11px] text-gray-500">Planned End: {originalDates.end}</div>
          </div>
          <div className="border-l border-gray-200 pl-3">
            <span className="text-[10px] font-bold uppercase text-indigo-600 block">Current Schedule (Rev #{currentDates.revision})</span>
            <div className="font-bold text-gray-900 mt-0.5">{currentDates.arrival} ({currentDates.duration})</div>
            <div className="text-[11px] text-indigo-600 font-semibold">Expected End: {currentDates.end}</div>
          </div>
        </div>

        {/* Revisions Timeline */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-3">
          {loading ? (
            <div className="py-10 text-center text-gray-400">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading schedule revision history...</p>
            </div>
          ) : error ? (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-xs">
              <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-1.5" />
              <p className="font-semibold text-gray-600">No Schedule Revisions Recorded</p>
              <p className="text-[11px] text-gray-400 mt-0.5">This checklist is running on its original planned schedule.</p>
            </div>
          ) : (
            history.map((rev, idx) => (
              <div key={rev.id || idx} className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-2 text-xs shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded font-mono font-black text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200">
                    Revision #{rev.revision_number}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium">
                    {new Date(rev.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-gray-700 bg-gray-50 p-2 rounded-lg font-medium">
                  <div>
                    <span className="text-gray-400 text-[10px] block">Previous:</span>
                    <span className="font-bold">{rev.previous_schedule?.arrival_date}</span> ({rev.previous_schedule?.duration})
                  </div>
                  <ArrowRight size={14} className="text-gray-400 shrink-0 mx-1" />
                  <div>
                    <span className="text-indigo-600 text-[10px] block font-semibold">Revised To:</span>
                    <span className="font-black text-indigo-900">{rev.new_schedule?.arrival_date}</span> ({rev.new_schedule?.duration})
                  </div>
                </div>

                <div className="text-[11px] text-gray-600">
                  <span className="font-bold text-gray-700">Reason:</span> {rev.reason}
                </div>

                <div className="text-[10px] text-gray-400 flex items-center gap-1.5 pt-1 border-t border-gray-100">
                  <User size={10} />
                  <span>Changed by {rev.changed_by_email || 'Staff'} ({rev.changed_by_role || 'COORDINATOR'})</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-2 border-t border-gray-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
