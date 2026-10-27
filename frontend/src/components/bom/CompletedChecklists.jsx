import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  Calendar,
  Truck,
  Wrench,
  Search,
  Download,
  Eye,
  RefreshCw,
  Phone,
  MapPin,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Package,
  Layers,
  Clock,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { fetchCompletedChecklistsApi } from '../../lib/api';

export default function CompletedChecklists({ token, onSelectChecklist }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Persistence State
  const [checklists, setChecklists] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    customer_self_installed: 0,
    other_completed: 0,
    this_month: 0,
  });

  // Filters & Search
  const [search, setSearch] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('All');
  const [reasonFilter, setReasonFilter] = useState('All');
  const [dateRangeFilter, setDateRangeFilter] = useState('This Month');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Read-only Details Modal State
  const [selectedChecklist, setSelectedChecklist] = useState(null);

  // Load Completed Checklists from API
  const loadCompletedChecklists = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchCompletedChecklistsApi(token, {
        search: search.trim(),
        jobType: jobTypeFilter,
        completionReason: reasonFilter,
        dateRange: dateRangeFilter,
        page,
        limit,
      });

      setChecklists(data.checklists || []);
      setTotalCount(data.pagination?.totalCount || (data.checklists || []).length);
      setTotalPages(data.pagination?.totalPages || 1);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Error loading completed checklists:', err);
      setError(err.message || 'Failed to load completed checklists');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, search, jobTypeFilter, reasonFilter, dateRangeFilter, page, limit]);

  useEffect(() => {
    loadCompletedChecklists();
  }, [loadCompletedChecklists]);

  // Current Month Label (e.g. "Completed in Oct 2026")
  const currentMonthLabel = useMemo(() => {
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'short' });
    const year = now.getFullYear();
    return `Completed in ${month} ${year}`;
  }, []);

  // Format Date and Time
  const formatDateTime = (dateStr) => {
    if (!dateStr) return { date: '—', time: '—' };
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return { date: dateStr, time: '' };
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const strHours = String(hours).padStart(2, '0');
      return {
        date: `${day}/${month}/${year}`,
        time: `${strHours}:${minutes} ${ampm}`,
      };
    } catch {
      return { date: dateStr, time: '' };
    }
  };

  // Export to CSV
  const handleExportCsv = () => {
    if (!checklists || checklists.length === 0) {
      alert('No completed checklists available to export.');
      return;
    }

    const headers = [
      '#',
      'Checklist Number',
      'Customer Name',
      'Customer Mobile',
      'Customer Location',
      'Job Type',
      'Completion Reason',
      'Completed By',
      'Completed Date',
      'Completed Time',
      'Notes',
    ];

    const rows = checklists.map((item, idx) => {
      const { date, time } = formatDateTime(item.completed_at);
      return [
        (page - 1) * limit + idx + 1,
        `"${item.checklist_number || ''}"`,
        `"${(item.client_name || '').replace(/"/g, '""')}"`,
        `"${item.client_mobile || ''}"`,
        `"${(item.client_location || '').replace(/"/g, '""')}"`,
        `"${item.job_type || item.installation_or_service || 'Product Courier'}"`,
        `"${item.completion_reason || 'Customer Self-Installation'}"`,
        `"${item.completed_by || 'Sales'}"`,
        `"${date}"`,
        `"${time}"`,
        `"${(item.completion_notes || item.remarks || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Completed_Checklists_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const showingFrom = totalCount > 0 ? (page - 1) * limit + 1 : 0;
  const showingTo = Math.min(page * limit, totalCount);

  return (
    <div className="space-y-5">
      {/* 1. DARK PAGE BANNER */}
      <div className="bg-gradient-to-r from-[#59260B] via-[#451B07] to-[#1E0B03] text-white p-5 rounded-2xl shadow-sm border border-amber-950/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold px-2.5 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-400/30 uppercase tracking-wider inline-block">
            STORE &amp; INVENTORY WORKSPACE
          </span>
          <h1 className="text-2xl font-black mt-2 flex items-center gap-2.5 text-white">
            <CheckCircle2 className="w-7 h-7 text-amber-400 shrink-0" />
            <span>Completed Checklists</span>
          </h1>
          <p className="text-xs text-white/80 mt-1 max-w-2xl font-normal">
            View checklists marked as Completed by Sales (e.g., customer self-installation or no stock issuance required).
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadCompletedChecklists(true)}
          disabled={loading || refreshing}
          className="self-start md:self-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* 2. SUMMARY KPI CARDS (Derived from actual persisted records) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Completed Checklists */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-gray-700 block">Total Completed Checklists</span>
            <span className="text-2xl font-black text-gray-900 leading-tight block mt-0.5">
              {summary.total ?? totalCount}
            </span>
            <span className="text-[11px] text-gray-400 block mt-0.5">All completed checklists</span>
          </div>
        </div>

        {/* Card 2: Customer Self-Installation */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <Truck className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-gray-700 block">Customer Self-Installation</span>
            <span className="text-2xl font-black text-gray-900 leading-tight block mt-0.5">
              {summary.customer_self_installed ?? 0}
            </span>
            <span className="text-[11px] text-gray-400 block mt-0.5">No stock issuance required</span>
          </div>
        </div>

        {/* Card 3: Other Completed */}
        <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0">
            <Wrench className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-gray-700 block">Other Completed</span>
            <span className="text-2xl font-black text-gray-900 leading-tight block mt-0.5">
              {summary.other_completed ?? 0}
            </span>
            <span className="text-[11px] text-gray-400 block mt-0.5">Service / Non-stock checklists</span>
          </div>
        </div>

        {/* Card 4: This Month */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-gray-700 block">This Month</span>
            <span className="text-2xl font-black text-gray-900 leading-tight block mt-0.5">
              {summary.this_month ?? 0}
            </span>
            <span className="text-[11px] text-gray-400 block mt-0.5">{currentMonthLabel}</span>
          </div>
        </div>
      </div>

      {/* 3. SEARCH & FILTERS BAR */}
      <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        {/* Search input */}
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Checklist #, Customer Name, Mobile, or Location..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 font-medium text-gray-800 placeholder:text-gray-400"
          />
        </div>

        {/* Filter dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 font-semibold">Job Type:</span>
            <select
              value={jobTypeFilter}
              onChange={(e) => {
                setJobTypeFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-blue-500"
            >
              <option value="All">All</option>
              <option value="Product Courier">Product Courier</option>
              <option value="Service">Service</option>
              <option value="Installation">Installation</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 font-semibold">Completion Reason:</span>
            <select
              value={reasonFilter}
              onChange={(e) => {
                setReasonFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-blue-500"
            >
              <option value="All">All</option>
              <option value="Customer Self-Installation">Customer Self-Installation</option>
              <option value="Completed - No Stock Required">Completed — No Stock Required</option>
              <option value="Other Completed">Other Completed</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 font-semibold">Date Range:</span>
            <select
              value={dateRangeFilter}
              onChange={(e) => {
                setDateRangeFilter(e.target.value);
                setPage(1);
              }}
              className="py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-800 focus:outline-none focus:border-blue-500"
            >
              <option value="This Month">This Month</option>
              <option value="Today">Today</option>
              <option value="This Week">This Week</option>
              <option value="Last Month">Last Month</option>
              <option value="All Time">All Time</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="py-1.5 px-3 rounded-lg text-gray-700 bg-white hover:bg-gray-50 font-bold border border-gray-200 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="Export filtered records to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* 4. COMPLETED CHECKLISTS TABLE */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-2xs overflow-hidden">
        {/* Table Title Bar */}
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-900 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-sm font-black text-gray-900 tracking-tight">
              Completed Checklists List
            </h2>
          </div>

          {/* Pagination controls */}
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span>
              Showing {showingFrom} - {showingTo} of {totalCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="w-7 h-7 text-amber-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-gray-600">Loading completed checklists...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-xs font-bold text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => loadCompletedChecklists()}
              className="px-3 py-1.5 text-xs font-bold bg-amber-600 text-white rounded-lg hover:bg-amber-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : checklists.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CheckCircle2 className="w-9 h-9 text-gray-300 mx-auto" />
            <h3 className="text-xs font-bold text-gray-800">No Completed Checklists Found</h3>
            <p className="text-[11px] text-gray-500 max-w-md mx-auto">
              {search || jobTypeFilter !== 'All' || reasonFilter !== 'All' || dateRangeFilter !== 'All Time'
                ? 'No records match the current search or filter criteria.'
                : 'When Sales marks a checklist as Completed (e.g. for customer self-installation or non-stock service jobs), it will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/70 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-3.5 w-10 text-center">#</th>
                  <th className="py-3 px-3.5">CHECKLIST #</th>
                  <th className="py-3 px-3.5">CUSTOMER DETAILS</th>
                  <th className="py-3 px-3.5">JOB TYPE</th>
                  <th className="py-3 px-3.5">COMPLETION REASON</th>
                  <th className="py-3 px-3.5">COMPLETED BY</th>
                  <th className="py-3 px-3.5">COMPLETED DATE</th>
                  <th className="py-3 px-3.5">NOTES</th>
                  <th className="py-3 px-3.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checklists.map((item, idx) => {
                  const rowNumber = (page - 1) * limit + idx + 1;
                  const { date, time } = formatDateTime(item.completed_at);
                  const isCourier = item.job_type === 'Product Courier' || item.delivery_method === 'Product Couriered';
                  const isService = item.job_type === 'Service' || item.installation_or_service === 'Service';
                  const reason = item.completion_reason || (isCourier ? 'Customer Self-Installation' : (isService ? 'Completed - No Stock Required' : 'Completed — Standard'));

                  return (
                    <tr key={item.id || item.checklist_number} className="hover:bg-gray-50/80 transition-colors">
                      {/* 1. Row number */}
                      <td className="py-3.5 px-3.5 text-center font-bold text-gray-500 text-xs">
                        {rowNumber}
                      </td>

                      {/* 2. Checklist number */}
                      <td className="py-3.5 px-3.5 font-mono font-semibold text-gray-700 whitespace-nowrap text-xs">
                        {item.checklist_number}
                      </td>

                      {/* 3. Customer details */}
                      <td className="py-3.5 px-3.5">
                        <div className="space-y-1">
                          <span className="font-bold text-gray-900 block leading-tight text-xs">
                            {item.client_name || 'Customer'}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                            {item.client_mobile && (
                              <span className="inline-flex items-center gap-1 font-medium">
                                <Phone size={11} className="text-blue-500 shrink-0" />
                                <span>{item.client_mobile}</span>
                              </span>
                            )}
                            {item.client_location && (
                              <span className="inline-flex items-center gap-1 font-medium truncate max-w-[200px]">
                                <MapPin size={11} className="text-purple-500 shrink-0" />
                                <span className="truncate">{item.client_location}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 4. Job type */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        {isCourier ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                            Product Courier
                          </span>
                        ) : isService ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                            Service
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            Installation
                          </span>
                        )}
                      </td>

                      {/* 5. Completion reason */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        {reason.toLowerCase().includes('self') ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Customer Self-Installation
                          </span>
                        ) : reason.toLowerCase().includes('no stock') ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            Completed - No Stock Required
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                            {reason}
                          </span>
                        )}
                      </td>

                      {/* 6. Completed by */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <div>
                          <span className="font-bold text-gray-800 block text-xs">
                            {item.completed_by || item.salesperson_name || 'Sales'}
                          </span>
                          <span className="text-[10px] text-gray-400 block font-medium">
                            (Sales)
                          </span>
                        </div>
                      </td>

                      {/* 7. Completed date and time */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <div>
                          <span className="font-medium text-gray-800 block text-xs">
                            {date}
                          </span>
                          <span className="text-[10px] text-gray-400 block font-medium">
                            {time}
                          </span>
                        </div>
                      </td>

                      {/* 8. Notes */}
                      <td className="py-3.5 px-3.5 max-w-[220px]">
                        <p className="text-[11px] text-gray-600 line-clamp-2 leading-relaxed">
                          {item.completion_notes || item.remarks || '—'}
                        </p>
                      </td>

                      {/* 9. Actions */}
                      <td className="py-3.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedChecklist(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50/60 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer transition-colors shadow-2xs"
                        >
                          <Eye size={13} className="shrink-0" />
                          <span>View Details</span>
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

      {/* 5. READ-ONLY DETAIL VIEW MODAL */}
      {selectedChecklist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span>Completed Checklist Details</span>
                    <span className="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      {selectedChecklist.checklist_number}
                    </span>
                  </h3>
                  <span className="text-[11px] text-gray-500">
                    Read-only audit and completion record
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedChecklist(null)}
                className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Notice Banner */}
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-emerald-900 leading-relaxed">
                  <strong>Checklist Completed Successfully.</strong> This checklist was marked as completed by Sales. No pending stock issuance or technician installation actions are required.
                </div>
              </div>

              {/* Grid: Customer Details & Completion Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Panel 1: Customer Details */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2.5">
                  <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Customer Information
                  </h4>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-gray-500 block text-[10px]">Client / Company Name</span>
                      <span className="font-bold text-gray-900">{selectedChecklist.client_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px]">Mobile Number</span>
                      <span className="font-medium text-gray-800">{selectedChecklist.client_mobile || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px]">Location</span>
                      <span className="font-medium text-gray-800">{selectedChecklist.client_location || '—'}</span>
                    </div>
                    {selectedChecklist.google_maps_location && (
                      <a
                        href={selectedChecklist.google_maps_location}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline pt-1"
                      >
                        <ExternalLink size={11} />
                        <span>View Google Maps</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Panel 2: Completion Metadata */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2.5">
                  <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Completion Record
                  </h4>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-gray-500 block text-[10px]">Status</span>
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 mt-0.5">
                        Completed
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px]">Completion Reason</span>
                      <span className="font-semibold text-gray-900">
                        {selectedChecklist.completion_reason || 'Customer Self-Installation'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px]">Completed By</span>
                      <span className="font-semibold text-gray-800">
                        {selectedChecklist.completed_by || selectedChecklist.salesperson_name || 'Sales'} (Sales)
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px]">Completion Date &amp; Time</span>
                      <span className="font-medium text-gray-800">
                        {formatDateTime(selectedChecklist.completed_at).date} {formatDateTime(selectedChecklist.completed_at).time}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Panel 3: Job Specifications & Device Configs */}
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Job Specifications &amp; Devices
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 block text-[10px]">Job Type</span>
                    <span className="font-bold text-gray-800">
                      {selectedChecklist.job_type || selectedChecklist.installation_or_service || 'Product Courier'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">Delivery Method</span>
                    <span className="font-bold text-gray-800">
                      {selectedChecklist.delivery_method || 'Product Couriered'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">Vehicle Type</span>
                    <span className="font-bold text-gray-800">
                      {selectedChecklist.vehicle_type || 'Truck'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">Total Devices</span>
                    <span className="font-bold text-gray-800">
                      {selectedChecklist.number_of_devices || 1} Nos.
                    </span>
                  </div>
                </div>

                {/* Device Configurations Table */}
                {Array.isArray(selectedChecklist.device_configurations) && selectedChecklist.device_configurations.length > 0 && (
                  <div className="pt-2">
                    <span className="text-gray-500 block text-[10px] mb-1.5 font-semibold">Configured Products</span>
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-100/70 text-gray-500 text-[10px] uppercase font-bold">
                          <tr>
                            <th className="py-2 px-3">Device Model</th>
                            <th className="py-2 px-3 text-center">Quantity</th>
                            <th className="py-2 px-3 text-center">Vehicles</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {selectedChecklist.device_configurations.map((cfg, cIdx) => (
                            <tr key={cIdx}>
                              <td className="py-2 px-3 font-semibold text-gray-800">{cfg.device_type}</td>
                              <td className="py-2 px-3 text-center font-mono">{cfg.number_of_devices}</td>
                              <td className="py-2 px-3 text-center font-mono">{cfg.number_of_vehicles || 1}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Panel 4: Completion Notes & Customer Remarks */}
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Confirmation Notes &amp; Remarks
                </h4>
                <p className="text-xs text-gray-700 bg-white p-3 rounded-lg border border-gray-200 font-medium leading-relaxed whitespace-pre-wrap">
                  {selectedChecklist.completion_notes || selectedChecklist.remarks || 'No notes provided.'}
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-3 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setSelectedChecklist(null)}
                className="px-4 py-2 text-xs font-bold text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-xl transition-colors cursor-pointer shadow-2xs"
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
