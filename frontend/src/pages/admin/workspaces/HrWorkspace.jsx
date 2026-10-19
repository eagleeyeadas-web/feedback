import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
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
  Info,
  CalendarPlus,
  RefreshCw,
  Sliders,
  History,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import {
  fetchHrAvailabilityOverview,
  setHrManualAvailability,
  reverseHrManualAvailability,
  fetchHrExtensionRequests,
  approveHrExtensionRequest,
  rejectHrExtensionRequest,
  fetchHrOverdueRecords,
  triggerHrOverdueCheck,
} from '../../../lib/api';
import EngineerAvailabilityCalendar from '../../../components/workspaces/EngineerAvailabilityCalendar';

const FOUR_AUTHORIZED_ENGINEERS = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

export default function HrWorkspace() {
  const { token, user } = useAuth();

  const [activeTab, setActiveTab] = useState('availability'); // 'availability' | 'extensions' | 'calendar' | 'overdue'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // 1. Availability Management State
  const [engineers, setEngineers] = useState([]);
  const [activeOverrideModal, setActiveOverrideModal] = useState(null); // engineer object or null
  const [overrideForm, setOverrideForm] = useState({
    manual_status: 'Unavailable',
    reason: '',
    effective_start_datetime: '',
    effective_end_datetime: '',
    confirmed: false,
  });
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [activeReverseModal, setActiveReverseModal] = useState(null); // override object
  const [reverseReason, setReverseReason] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [activeHistoryModal, setActiveHistoryModal] = useState(null); // engineer object

  // 2. Extension Requests State
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [extensionFilter, setExtensionFilter] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'
  const [activeExtensionModal, setActiveExtensionModal] = useState(null); // { request, action: 'approve' | 'reject' }
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  // 3. Overdue & Late Completion Records State
  const [overdueRecords, setOverdueRecords] = useState([]);
  const [overdueFilter, setOverdueFilter] = useState('ALL'); // 'ALL' | 'Overdue — Extension Not Requested' | 'Overdue — Extension Approval Pending' | 'Overdue — Extension Rejected' | 'Late Completion Recorded'
  const [overdueScanning, setOverdueScanning] = useState(false);

  // Load Data
  const loadOverviewData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [availRes, extRes, overdueRes] = await Promise.all([
        fetchHrAvailabilityOverview(token),
        fetchHrExtensionRequests(token, { status: extensionFilter !== 'ALL' ? extensionFilter : undefined }),
        fetchHrOverdueRecords(token, { category: overdueFilter !== 'ALL' ? overdueFilter : undefined }),
      ]);

      if (availRes?.engineers) {
        setEngineers(availRes.engineers);
      }
      if (extRes?.requests) {
        setExtensionRequests(extRes.requests);
      }
      if (overdueRes?.records) {
        setOverdueRecords(overdueRes.records);
      }
    } catch (err) {
      console.error('Failed to load HR workspace data:', err);
      setError(err.message || 'Failed to load HR workspace data');
    } finally {
      setLoading(false);
    }
  }, [token, extensionFilter, overdueFilter]);

  const handleRunOverdueScan = async () => {
    if (!token) return;
    setOverdueScanning(true);
    try {
      const res = await triggerHrOverdueCheck(token);
      showFlash(`Overdue detection scan completed: ${res.overdueCount || 0} overdue job(s) identified across ${res.processedCount || 0} active checklists.`);
      await loadOverviewData();
    } catch (err) {
      alert(`Overdue scan failed: ${err.message}`);
    } finally {
      setOverdueScanning(false);
    }
  };

  useEffect(() => {
    loadOverviewData();
  }, [loadOverviewData]);

  // Handle flash messages
  const showFlash = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // -------------------------------------------------------------
  // Manual Availability Override Handlers
  // -------------------------------------------------------------
  const openOverrideModal = (eng) => {
    const now = new Date();
    // format as YYYY-MM-DDTHH:mm
    const nowLocalStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    setActiveOverrideModal(eng);
    setOverrideForm({
      manual_status: eng.manual_status === 'Available' ? 'Unavailable' : 'Available',
      reason: '',
      effective_start_datetime: nowLocalStr,
      effective_end_datetime: '',
      confirmed: false,
    });
  };

  const handleApplyOverride = async (e) => {
    e.preventDefault();
    if (!activeOverrideModal) return;

    if (!overrideForm.reason.trim()) {
      alert('A valid reason is required for manual availability overrides.');
      return;
    }
    if (!overrideForm.confirmed) {
      alert('Please confirm the manual override before saving.');
      return;
    }

    setOverrideSubmitting(true);
    try {
      const res = await setHrManualAvailability(token, {
        engineer_id: activeOverrideModal.id,
        engineer_name: activeOverrideModal.name,
        manual_status: overrideForm.manual_status,
        reason: overrideForm.reason.trim(),
        effective_start_datetime: new Date(overrideForm.effective_start_datetime).toISOString(),
        effective_end_datetime: overrideForm.effective_end_datetime
          ? new Date(overrideForm.effective_end_datetime).toISOString()
          : null,
        confirmed: true,
      });

      showFlash(
        res.warning
          ? `Override saved with notice: ${res.warning}`
          : `Manual availability for ${activeOverrideModal.name} set to ${overrideForm.manual_status}.`
      );

      setActiveOverrideModal(null);
      await loadOverviewData();
    } catch (err) {
      alert(`Error applying override: ${err.message}`);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleReverseOverride = async (e) => {
    e.preventDefault();
    if (!activeReverseModal) return;

    setReverseSubmitting(true);
    try {
      await reverseHrManualAvailability(token, activeReverseModal.id, reverseReason.trim());
      showFlash('Manual override reversed. Schedule and availability recalculated from actual constraints.');
      setActiveReverseModal(null);
      setReverseReason('');
      await loadOverviewData();
    } catch (err) {
      alert(`Error reversing override: ${err.message}`);
    } finally {
      setReverseSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // Extension Request Decision Handlers
  // -------------------------------------------------------------
  const handleExtensionDecision = async () => {
    if (!activeExtensionModal) return;
    const { request, action } = activeExtensionModal;

    setDecisionSubmitting(true);
    try {
      if (action === 'approve') {
        await approveHrExtensionRequest(token, request.id, {
          decision_notes: decisionNotes.trim(),
        });
        showFlash(
          `Extension request for ${request.checklist_number} APPROVED. Official schedule updated and Coordinator notified to review travel & room booking.`
        );
      } else {
        await rejectHrExtensionRequest(token, request.id, {
          decision_notes: decisionNotes.trim(),
        });
        showFlash(`Extension request for ${request.checklist_number} REJECTED. Official schedule left unchanged.`);
      }

      setActiveExtensionModal(null);
      setDecisionNotes('');
      await loadOverviewData();
    } catch (err) {
      alert(`Error processing decision: ${err.message}`);
    } finally {
      setDecisionSubmitting(false);
    }
  };

  // Metric Computations
  const pendingExtensionsCount = extensionRequests.filter((r) => r.status === 'PENDING').length;
  const activeOverridesCount = engineers.filter((e) => e.active_override).length;
  const discrepancyCount = engineers.filter((e) => e.has_discrepancy).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 1. Header Banner & Identity */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-emerald-800/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-emerald-500/10 to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                <Shield size={13} />
                Human Resources Department
              </span>
              <span className="text-xs text-emerald-200/70 font-mono">Eagle Eye SafDrive</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Technician Availability & Schedule Governance
            </h1>
            <p className="text-sm text-emerald-100/80 mt-1 max-w-2xl">
              Authoritative management of technician extension requests, manual availability controls for the four authorized service engineers, and real-time scheduling coordination.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadOverviewData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition border border-white/10 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Data</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-emerald-800/60">
          <div className="bg-black/20 backdrop-blur-xs rounded-2xl p-4 border border-white/5">
            <span className="text-xs text-emerald-200/70 block font-semibold">Service Engineers</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-white">{engineers.length || 4}</span>
              <span className="text-[10px] text-emerald-300 font-mono font-bold">Authorized Core</span>
            </div>
          </div>

          <div className="bg-black/20 backdrop-blur-xs rounded-2xl p-4 border border-white/5">
            <span className="text-xs text-emerald-200/70 block font-semibold">Pending Extensions</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-300">{pendingExtensionsCount}</span>
              <span className="text-[10px] text-amber-200 font-bold">Needs Review</span>
            </div>
          </div>

          <div className="bg-black/20 backdrop-blur-xs rounded-2xl p-4 border border-white/5">
            <span className="text-xs text-emerald-200/70 block font-semibold">Active Manual Overrides</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-white">{activeOverridesCount}</span>
              <span className="text-[10px] text-teal-300 font-bold">In Effect</span>
            </div>
          </div>

          <div className="bg-black/20 backdrop-blur-xs rounded-2xl p-4 border border-white/5">
            <span className="text-xs text-emerald-200/70 block font-semibold">Status Warnings</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-2xl font-black ${discrepancyCount > 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
                {discrepancyCount}
              </span>
              <span className="text-[10px] text-gray-300 font-bold">Discrepancies</span>
            </div>
          </div>
        </div>
      </div>

      {/* Success Notification Alert */}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs sm:text-sm font-semibold flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs sm:text-sm font-semibold flex items-center gap-3">
          <AlertTriangle size={18} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Primary Navigation Tabs */}
      <div className="flex border-b border-gray-200 gap-2 sm:gap-4 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('availability')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'availability'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Sliders size={16} />
          <span>Technician Availability Management</span>
          {activeOverridesCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-emerald-100 text-emerald-800">
              {activeOverridesCount} Active
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('extensions')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'extensions'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl'
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
          onClick={() => setActiveTab('calendar')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'calendar'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Calendar size={16} />
          <span>Technician Availability Calendar</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('overdue')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'overdue'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Clock size={16} />
          <span>Overdue & Late Completion</span>
          {overdueRecords.filter((r) => !r.resolved).length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-100 text-rose-800">
              {overdueRecords.filter((r) => !r.resolved).length}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================
          TAB 1: TECHNICIAN AVAILABILITY MANAGEMENT (THE 4 ENGINEERS)
          ============================================================ */}
      {activeTab === 'availability' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
            <div>
              <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                <span>Core Service Engineers</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-gray-100 text-gray-700">
                  Mathi • Guna • Sakthivel • Kamalesh
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                View calculated schedule commitments, apply manual overrides, and review discrepancy alerts. Manual availability never silently erases active assignments or approved leaves.
              </p>
            </div>
          </div>

          {/* Engineer Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {engineers.map((eng) => {
              const hasActiveOverride = Boolean(eng.active_override);
              const override = eng.active_override;

              return (
                <div
                  key={eng.id}
                  className={`bg-white rounded-2xl border transition shadow-xs overflow-hidden flex flex-col justify-between ${
                    eng.has_discrepancy
                      ? 'border-amber-300 ring-2 ring-amber-100'
                      : hasActiveOverride
                      ? 'border-teal-300 ring-1 ring-teal-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="p-5 space-y-4">
                    {/* Header: Name and Effective Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black text-gray-900">{eng.name}</h3>
                          <span className="text-[11px] text-gray-500 font-medium">({eng.phone})</span>
                        </div>
                        <span className="text-xs text-gray-500 font-medium">{eng.role}</span>
                      </div>

                      {/* Effective Operational Status Badge */}
                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider ${
                            eng.effective_operational_status === 'AVAILABLE'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : eng.effective_operational_status === 'UNAVAILABLE'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}
                        >
                          {eng.effective_operational_status === 'AVAILABLE' ? (
                            <UserCheck size={14} />
                          ) : (
                            <UserX size={14} />
                          )}
                          <span>Effective: {eng.effective_operational_status}</span>
                        </span>
                      </div>
                    </div>

                    {/* Status Comparison Table */}
                    <div className="grid grid-cols-2 gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-200/70 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">
                          Calculated Schedule
                        </span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              eng.calculated_status === 'AVAILABLE'
                                ? 'bg-emerald-500'
                                : eng.calculated_status === 'OVERDUE'
                                ? 'bg-rose-600 animate-pulse'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span className="font-bold text-gray-900">{eng.calculated_status}</span>
                        </div>
                        {eng.current_commitment && (
                          <span className="text-[11px] text-gray-600 block mt-0.5 truncate">
                            {eng.current_commitment.checklist_number
                              ? `Checklist #${eng.current_commitment.checklist_number}`
                              : eng.current_commitment.type}
                          </span>
                        )}
                      </div>

                      <div className="border-l border-gray-200 pl-3">
                        <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">
                          Manual Override
                        </span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              eng.manual_status === 'Available'
                                ? 'bg-teal-500'
                                : eng.manual_status === 'Unavailable'
                                ? 'bg-rose-500'
                                : 'bg-gray-300'
                            }`}
                          />
                          <span className="font-bold text-gray-900">
                            {eng.manual_status === 'None' ? 'None (Automatic)' : eng.manual_status}
                          </span>
                        </div>
                        {override && (
                          <span className="text-[10px] text-gray-500 block mt-0.5 truncate" title={override.reason}>
                            {override.reason}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Discrepancy Alert Banner */}
                    {eng.has_discrepancy && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block">Schedule Discrepancy:</span>
                          <span className="text-amber-800">{eng.discrepancy_warning}</span>
                        </div>
                      </div>
                    )}

                    {/* Active Override Details (if set) */}
                    {override && (
                      <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 text-xs space-y-1.5">
                        <div className="flex items-center justify-between text-teal-900 font-bold">
                          <span>Active Override Details</span>
                          <span className="text-[10px] px-2 py-0.5 bg-teal-200/80 rounded font-mono">
                            {override.effective_end_datetime ? 'Temporary' : 'Indefinite'}
                          </span>
                        </div>
                        <p className="text-teal-800 text-[11px]">
                          <strong>Reason:</strong> {override.reason}
                        </p>
                        <p className="text-teal-700 text-[10px]">
                          <strong>Effective:</strong> {new Date(override.effective_start_datetime).toLocaleString()}
                          {override.effective_end_datetime &&
                            ` → ${new Date(override.effective_end_datetime).toLocaleString()}`}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Card Action Footer */}
                  <div className="p-4 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveHistoryModal(eng)}
                      className="text-xs font-bold text-gray-600 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
                    >
                      <History size={13} />
                      <span>History ({eng.history?.length || 0})</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {hasActiveOverride && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveReverseModal(override);
                            setReverseReason('');
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw size={13} />
                          <span>Reverse</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openOverrideModal(eng)}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition flex items-center gap-1 cursor-pointer"
                      >
                        <Sliders size={13} />
                        <span>Manage Status</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================
          TAB 2: TECHNICIAN EXTENSION REQUESTS
          ============================================================ */}
      {activeTab === 'extensions' && (
        <div className="space-y-5">
          {/* Filter Sub-nav */}
          <div className="flex items-center justify-between gap-4 flex-wrap bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Filter:</span>
              {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setExtensionFilter(status)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                    extensionFilter === status
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {status === 'ALL' ? 'All Requests' : status}
                </button>
              ))}
            </div>

            <span className="text-xs text-gray-500">
              Showing <strong>{extensionRequests.length}</strong> {extensionFilter.toLowerCase()} extension requests
            </span>
          </div>

          {/* Extension Requests List */}
          {extensionRequests.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
              <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-sm font-bold text-gray-900">No {extensionFilter.toLowerCase()} extension requests</h3>
              <p className="text-xs text-gray-500 mt-1">
                Technician availability-date requests will appear here when submitted.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {extensionRequests.map((req) => {
                const isPending = req.status === 'PENDING';
                const originalEnd =
                  req.current_dates?.completion_date ||
                  req.original_dates?.completion_date ||
                  req.current_completion_date ||
                  'N/A';
                const requestedEnd = req.requested_completion_date || 'N/A';

                return (
                  <div
                    key={req.id}
                    className={`bg-white rounded-2xl border p-5 transition shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5 ${
                      isPending ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {req.checklist_number}
                        </span>

                        <span className="text-sm font-black text-gray-900">{req.technician_name}</span>

                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            req.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'REJECTED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800 animate-pulse'
                          }`}
                        >
                          {req.status}
                        </span>

                        {req.client_name && (
                          <span className="text-xs text-gray-500">• {req.client_name}</span>
                        )}
                      </div>

                      {/* Date Change Comparison */}
                      <div className="flex items-center gap-3 text-xs bg-gray-50 p-2.5 rounded-xl border border-gray-100 max-w-xl">
                        <div>
                          <span className="text-[10px] text-gray-500 font-bold block">Current Completion Date</span>
                          <span className="font-semibold text-gray-800">{originalEnd}</span>
                        </div>
                        <ChevronRight size={14} className="text-gray-400 shrink-0" />
                        <div>
                          <span className="text-[10px] text-indigo-600 font-bold block">Requested New Date</span>
                          <span className="font-black text-indigo-700">
                            {requestedEnd} (+{req.additional_working_days || 1} Days)
                          </span>
                        </div>
                        {req.rest_day_requested && (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-800 rounded">
                            Rest Day: {req.requested_rest_date || 'Requested'}
                          </span>
                        )}
                      </div>

                      {/* Reason & Notes */}
                      <div className="text-xs space-y-1">
                        <p className="text-gray-700">
                          <strong>Reason:</strong> {req.reason}
                        </p>
                        {req.notes && (
                          <p className="text-gray-500 text-[11px]">
                            <strong>Notes:</strong> {req.notes}
                          </p>
                        )}
                        <span className="text-[10px] text-gray-400 block">
                          Submitted: {new Date(req.created_at).toLocaleString()}
                        </span>
                      </div>

                      {/* Historical Decision Details if already reviewed */}
                      {!isPending && req.coordinator_decision_notes && (
                        <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
                          <strong>HR Decision Notes:</strong> {req.coordinator_decision_notes}
                        </div>
                      )}
                    </div>

                    {/* Pending Action Buttons */}
                    {isPending && (
                      <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveExtensionModal({ request: req, action: 'reject' });
                            setDecisionNotes('');
                          }}
                          className="px-4 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer"
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveExtensionModal({ request: req, action: 'approve' });
                            setDecisionNotes('');
                          }}
                          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Check size={14} />
                          <span>Approve Extension</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          TAB 3: TECHNICIAN AVAILABILITY CALENDAR
          ============================================================ */}
      {activeTab === 'calendar' && (
        <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <div>
              <h2 className="text-base font-black text-gray-900">Multi-Engineer Scheduling Calendar</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Comprehensive calendar combining active assignments, HR-approved extensions, approved leave/rest days, travel constraints, and HR manual overrides.
              </p>
            </div>
          </div>

          <EngineerAvailabilityCalendar token={token} />
        </div>
      )}

      {/* ============================================================
          TAB 4: OVERDUE & LATE COMPLETION RECORDS
          ============================================================ */}
      {activeTab === 'overdue' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
            <div>
              <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                <AlertCircle className="text-rose-600" size={18} />
                <span>Overdue Installations & Late-Completion Governance</span>
              </h2>
              <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                Automatic 24/7 detection for jobs continuing beyond scheduled end dates. Tracks late completion records, unrequested overdues, pending extension requests, and preserves official schedule history.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRunOverdueScan}
                disabled={overdueScanning}
                className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={13} className={overdueScanning ? 'animate-spin' : ''} />
                <span>{overdueScanning ? 'Scanning Overdue...' : 'Run Overdue Scan'}</span>
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-gray-500 mr-1">Filter Category:</span>
              {[
                { key: 'ALL', label: 'All Records' },
                { key: 'Overdue — Extension Not Requested', label: 'Extension Not Requested', color: 'rose' },
                { key: 'Overdue — Extension Approval Pending', label: 'Approval Pending', color: 'amber' },
                { key: 'Overdue — Extension Rejected', label: 'Extension Rejected', color: 'purple' },
                { key: 'Late Completion Recorded', label: 'Late Completion Recorded', color: 'blue' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setOverdueFilter(f.key)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                    overdueFilter === f.key
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-gray-500">
              Showing <strong>{overdueRecords.length}</strong> record(s)
            </span>
          </div>

          {/* Overdue Records List */}
          {overdueRecords.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-sm font-bold text-gray-900">No overdue or late completion records</h3>
              <p className="text-xs text-gray-500 mt-1">
                All scheduled installation jobs are proceeding on schedule or properly extended.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {overdueRecords.map((item) => {
                const isLateComp = item.category === 'Late Completion Recorded';
                const isNoExt = item.category === 'Overdue — Extension Not Requested';
                const isPendingExt = item.category === 'Overdue — Extension Approval Pending';
                const isRejectedExt = item.category === 'Overdue — Extension Rejected';

                const badgeStyle = isNoExt
                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                  : isPendingExt
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : isRejectedExt
                  ? 'bg-purple-100 text-purple-800 border-purple-300'
                  : 'bg-blue-100 text-blue-800 border-blue-300';

                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl border p-5 transition shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5 ${
                      !item.resolved ? 'border-rose-300 ring-1 ring-rose-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-black font-mono text-gray-900">
                          {item.checklist_number}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeStyle}`}>
                          {item.category}
                        </span>
                        {item.resolved ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                            Resolved
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                            Active Overdue
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-1">
                        <div>
                          <span className="text-gray-400 block font-semibold text-[11px]">Customer & Location</span>
                          <span className="font-bold text-gray-800">{item.client_name}</span>
                          <span className="text-gray-500 block text-[11px]">{item.client_location || 'N/A'}</span>
                        </div>

                        <div>
                          <span className="text-gray-400 block font-semibold text-[11px]">Assigned Technician</span>
                          <span className="font-bold text-gray-800">{item.technician_name}</span>
                        </div>

                        <div>
                          <span className="text-gray-400 block font-semibold text-[11px]">Scheduled Dates</span>
                          <span className="font-semibold text-gray-700">
                            {item.scheduled_start_date || 'N/A'} → <strong>{item.scheduled_end_date || 'N/A'}</strong>
                          </span>
                        </div>

                        <div>
                          <span className="text-gray-400 block font-semibold text-[11px]">
                            {isLateComp ? 'Actual Completion & Form Submission' : 'Overdue Detected'}
                          </span>
                          {item.actual_completion_at ? (
                            <span className="font-bold text-emerald-800 block">
                              Completed: {new Date(item.actual_completion_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                            </span>
                          ) : (
                            <span className="font-bold text-rose-700 block">
                              Incomplete (Past {item.scheduled_end_date})
                            </span>
                          )}
                          {item.post_installation_submitted_at && (
                            <span className="text-gray-500 block text-[10px]">
                              Submitted: {new Date(item.post_installation_submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      {isPendingExt && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('extensions')}
                          className="px-3.5 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
                        >
                          <span>Review Extension</span>
                          <ChevronRight size={14} />
                        </button>
                      )}
                      <a
                        href={`/admin/workspaces/coordinator?checklistId=${item.checklist_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                      >
                        <ExternalLink size={13} />
                        <span>View Checklist</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          MODAL: SET MANUAL AVAILABILITY OVERRIDE
          ============================================================ */}
      {activeOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 max-w-lg w-full overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-emerald-900 text-white">
              <div>
                <h3 className="text-sm font-black">Manage Manual Availability</h3>
                <p className="text-xs text-emerald-200">{activeOverrideModal.name} (Service Engineer)</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveOverrideModal(null)}
                className="text-white/70 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleApplyOverride} className="p-6 space-y-4">
              {/* Status Radio Toggle */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-2">Availability Status</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold cursor-pointer transition ${
                      overrideForm.manual_status === 'Available'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="manual_status"
                      value="Available"
                      checked={overrideForm.manual_status === 'Available'}
                      onChange={() => setOverrideForm((prev) => ({ ...prev, manual_status: 'Available' }))}
                      className="sr-only"
                    />
                    <UserCheck size={16} />
                    <span>Available</span>
                  </label>

                  <label
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold cursor-pointer transition ${
                      overrideForm.manual_status === 'Unavailable'
                        ? 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-200'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="manual_status"
                      value="Unavailable"
                      checked={overrideForm.manual_status === 'Unavailable'}
                      onChange={() => setOverrideForm((prev) => ({ ...prev, manual_status: 'Unavailable' }))}
                      className="sr-only"
                    />
                    <UserX size={16} />
                    <span>Unavailable</span>
                  </label>
                </div>
              </div>

              {/* Hard Conflict Warning in Modal */}
              {overrideForm.manual_status === 'Available' && activeOverrideModal.calculated_status !== 'AVAILABLE' && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-black">
                    <AlertTriangle size={15} className="text-amber-600" />
                    <span>Active Commitment Conflict Notice</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    {activeOverrideModal.name} currently has active commitments ({activeOverrideModal.calculated_status}). Setting manual availability to "Available" will <strong>NOT</strong> silently erase active job assignments, approved leave, or rest days.
                  </p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Reason for Override <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  value={overrideForm.reason}
                  onChange={(e) => setOverrideForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. Training session / Temporary medical leave / Special availability override"
                  className="w-full text-xs p-3 rounded-xl border border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Effective Start & End Datetime */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Effective Start <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={overrideForm.effective_start_datetime}
                    onChange={(e) =>
                      setOverrideForm((prev) => ({ ...prev, effective_start_datetime: e.target.value }))
                    }
                    className="w-full text-xs p-2.5 rounded-xl border border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Effective End <span className="text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={overrideForm.effective_end_datetime}
                    onChange={(e) =>
                      setOverrideForm((prev) => ({ ...prev, effective_end_datetime: e.target.value }))
                    }
                    className="w-full text-xs p-2.5 rounded-xl border border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-gray-400">Leave blank for indefinite override</span>
                </div>
              </div>

              {/* Confirmation Checkbox */}
              <div className="pt-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideForm.confirmed}
                    onChange={(e) => setOverrideForm((prev) => ({ ...prev, confirmed: e.target.checked }))}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-gray-700 leading-snug">
                    I confirm this manual availability override for <strong>{activeOverrideModal.name}</strong>.
                  </span>
                </label>
              </div>

              {/* Modal Buttons */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setActiveOverrideModal(null)}
                  className="px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={overrideSubmitting || !overrideForm.confirmed}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {overrideSubmitting ? 'Saving...' : 'Apply Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: REVERSE MANUAL OVERRIDE
          ============================================================ */}
      {activeReverseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 bg-rose-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black">Reverse Manual Override</h3>
                <p className="text-xs text-rose-200">{activeReverseModal.engineer_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveReverseModal(null)}
                className="text-white/70 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReverseOverride} className="p-6 space-y-4">
              <p className="text-xs text-gray-600">
                Reversing this override will restore calculated availability based on actual scheduled assignments, approved leaves, and rest days.
              </p>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Reason for Reversal</label>
                <input
                  type="text"
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="e.g. Returned from leave / Availability normalized"
                  className="w-full text-xs p-2.5 rounded-xl border border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setActiveReverseModal(null)}
                  className="px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={reverseSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {reverseSubmitting ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: OVERRIDE HISTORY AUDIT TRAIL
          ============================================================ */}
      {activeHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 max-w-2xl w-full overflow-hidden max-h-[85vh] flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-900 text-white">
              <div>
                <h3 className="text-sm font-black">Availability Override History</h3>
                <p className="text-xs text-gray-300">{activeHistoryModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveHistoryModal(null)}
                className="text-white/70 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {activeHistoryModal.history?.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">No past manual overrides recorded.</p>
              ) : (
                activeHistoryModal.history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/70 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                          item.manual_status === 'Available'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {item.manual_status}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-gray-800">
                      <strong>Reason:</strong> {item.reason}
                    </p>

                    <div className="text-[10px] text-gray-500 flex flex-wrap gap-x-4">
                      <span>Effective: {new Date(item.effective_start_datetime).toLocaleDateString()}</span>
                      {item.effective_end_datetime && (
                        <span>Expiry: {new Date(item.effective_end_datetime).toLocaleDateString()}</span>
                      )}
                      <span>By: {item.created_by_email}</span>
                    </div>

                    {item.reversal_reason && (
                      <div className="mt-1 pt-1 border-t border-gray-200 text-[10px] text-rose-700">
                        <strong>Reversed:</strong> {item.reversal_reason} ({new Date(item.reversed_at).toLocaleDateString()})
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveHistoryModal(null)}
                className="px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200 rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: APPROVE / REJECT EXTENSION REQUEST
          ============================================================ */}
      {activeExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 max-w-lg w-full overflow-hidden animate-in zoom-in-95">
            <div
              className={`p-5 text-white flex items-center justify-between ${
                activeExtensionModal.action === 'approve' ? 'bg-emerald-800' : 'bg-rose-900'
              }`}
            >
              <div>
                <h3 className="text-sm font-black">
                  {activeExtensionModal.action === 'approve'
                    ? 'Approve Availability Extension'
                    : 'Reject Availability Extension'}
                </h3>
                <p className="text-xs text-white/80">{activeExtensionModal.request.checklist_number}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveExtensionModal(null)}
                className="text-white/70 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs space-y-1">
                <p>
                  <strong>Technician:</strong> {activeExtensionModal.request.technician_name}
                </p>
                <p>
                  <strong>Requested Date:</strong> {activeExtensionModal.request.requested_completion_date} (+
                  {activeExtensionModal.request.additional_working_days || 1} Days)
                </p>
                <p>
                  <strong>Reason:</strong> {activeExtensionModal.request.reason}
                </p>
              </div>

              {activeExtensionModal.action === 'approve' ? (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs space-y-1.5">
                  <span className="font-bold block">Notice to Coordinator:</span>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    Approving this extension will update the official work schedule and automatically notify the Coordinator:
                    <br />
                    <em>"Date Extended — Review Room Booking and Travel Arrangements."</em>
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs space-y-1.5">
                  <span className="font-bold block">Rejection Policy:</span>
                  <p className="text-[11px] text-rose-800 leading-relaxed">
                    The official schedule will remain unchanged. The technician will be notified of the rejection and recorded reason. No notification will be sent to the Coordinator.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  {activeExtensionModal.action === 'approve' ? 'Optional Decision Notes' : 'Reason for Rejection *'}
                </label>
                <textarea
                  rows={2}
                  required={activeExtensionModal.action === 'reject'}
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder={
                    activeExtensionModal.action === 'approve'
                      ? 'e.g. Approved extra day for calibration.'
                      : 'e.g. Rejected due to next scheduled assignment.'
                  }
                  className="w-full text-xs p-3 rounded-xl border border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setActiveExtensionModal(null)}
                  className="px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={decisionSubmitting}
                  onClick={handleExtensionDecision}
                  className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50 ${
                    activeExtensionModal.action === 'approve'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {decisionSubmitting
                    ? 'Processing...'
                    : activeExtensionModal.action === 'approve'
                    ? 'Confirm Approval'
                    : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
