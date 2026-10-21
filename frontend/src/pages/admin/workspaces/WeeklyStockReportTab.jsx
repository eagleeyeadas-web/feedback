import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Package,
  Layers,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileSpreadsheet,
  X,
  Printer,
  Info,
} from 'lucide-react';
import { fetchWeeklyStockReportApi, downloadWeeklyStockReportPdfApi } from '../../../lib/api';

/**
 * Returns the previous completed Monday–Sunday week in Asia/Kolkata timezone
 */
export function calculateDefaultCompletedWeek(refDate = new Date()) {
  const istStr = refDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [y, m, d] = istStr.split('-').map(Number);
  const istDate = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = istDate.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const currentMonday = new Date(istDate);
  currentMonday.setUTCDate(istDate.getUTCDate() - daysSinceMonday);

  const prevMonday = new Date(currentMonday);
  prevMonday.setUTCDate(currentMonday.getUTCDate() - 7);

  const prevSunday = new Date(prevMonday);
  prevSunday.setUTCDate(prevMonday.getUTCDate() + 6);

  return {
    startDate: prevMonday.toISOString().split('T')[0],
    endDate: prevSunday.toISOString().split('T')[0],
  };
}

/**
 * Shifts a YYYY-MM-DD date string by a given number of days
 */
export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

/**
 * Formats a YYYY-MM-DD date string into "12 Oct 2026"
 */
export function formatDateReadable(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WeeklyStockReportTab({ token, user }) {
  // Week Selection state (Default: previous completed Mon-Sun in Asia/Kolkata)
  const [weekRange, setWeekRange] = useState(() => calculateDefaultCompletedWeek());

  // Report state
  const [reportData, setReportData] = useState(null);
  const [reportLoadedForRange, setReportLoadedForRange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // UI view toggles
  const [viewAllSummaryItems, setViewAllSummaryItems] = useState(false);
  const [expandedTechnicians, setExpandedTechnicians] = useState({
    Mathi: true,
    Guna: true,
    Sakthivel: true,
    Kamalesh: true,
    'Unassigned Recipient': false,
  });
  const [movementSearchQuery, setMovementSearchQuery] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('ALL');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Rapid click protection refs
  const isGeneratingRef = useRef(false);
  const isDownloadingRef = useRef(false);

  // Check if current report matches current selected week
  const isReportStale =
    reportLoadedForRange &&
    (reportLoadedForRange.startDate !== weekRange.startDate ||
      reportLoadedForRange.endDate !== weekRange.endDate);

  const canPreviewOrDownload =
    Boolean(reportData) && !isReportStale && !loading;

  // Handle Previous Week Navigation
  const handlePreviousWeek = () => {
    setWeekRange((prev) => ({
      startDate: shiftDate(prev.startDate, -7),
      endDate: shiftDate(prev.endDate, -7),
    }));
    setSuccessMessage('');
  };

  // Handle Next Week Navigation
  const handleNextWeek = () => {
    setWeekRange((prev) => ({
      startDate: shiftDate(prev.startDate, 7),
      endDate: shiftDate(prev.endDate, 7),
    }));
    setSuccessMessage('');
  };

  // Handle Generate Report
  const handleGenerateReport = async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const data = await fetchWeeklyStockReportApi(token, {
        startDate: weekRange.startDate,
        endDate: weekRange.endDate,
      });

      setReportData(data);
      setReportLoadedForRange({ ...weekRange });
      setSuccessMessage(
        `Report generated successfully for ${data.reportPeriod.formattedRange}`
      );
    } catch (err) {
      console.error('Error generating weekly stock report:', err);
      setErrorMessage(err.message || 'Failed to generate weekly stock report');
    } finally {
      setLoading(false);
      isGeneratingRef.current = false;
    }
  };

  // Handle Download PDF
  const handleDownloadPdf = async () => {
    if (!canPreviewOrDownload) return;
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setDownloadingPdf(true);
    setErrorMessage('');

    try {
      const blob = await downloadWeeklyStockReportPdfApi(token, {
        startDate: weekRange.startDate,
        endDate: weekRange.endDate,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SafDrive_Weekly_Stock_Report_${weekRange.startDate}_to_${weekRange.endDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccessMessage(
        `PDF downloaded: SafDrive_Weekly_Stock_Report_${weekRange.startDate}_to_${weekRange.endDate}.pdf`
      );
    } catch (err) {
      console.error('Error downloading weekly stock report PDF:', err);
      setErrorMessage(err.message || 'Failed to download report PDF');
    } finally {
      setDownloadingPdf(false);
      isDownloadingRef.current = false;
    }
  };

  // Toggle single technician accordion
  const toggleTechnicianAccordion = (techName) => {
    setExpandedTechnicians((prev) => ({
      ...prev,
      [techName]: !prev[techName],
    }));
  };

  // Filtered movements
  const filteredMovements = (reportData?.stockMovements || []).filter((m) => {
    if (movementTypeFilter !== 'ALL' && m.type !== movementTypeFilter) {
      return false;
    }
    if (movementSearchQuery.trim()) {
      const q = movementSearchQuery.toLowerCase();
      const matchItem = m.itemName?.toLowerCase().includes(q);
      const matchTech = m.technicianName?.toLowerCase().includes(q);
      const matchChecklist = m.checklistNumber?.toLowerCase().includes(q);
      const matchUser = m.performedBy?.toLowerCase().includes(q);
      const matchRemarks = m.remarks?.toLowerCase().includes(q);
      return matchItem || matchTech || matchChecklist || matchUser || matchRemarks;
    }
    return true;
  });

  // Display items in summary (all or active)
  const summaryItemsToDisplay = (reportData?.stockSummary || []).filter((item) => {
    if (viewAllSummaryItems) return true;
    // By default show all items or items with any activity/balance
    return true;
  });

  return (
    <div className="space-y-6">
      {/* ============================================================
          REPORT HEADING & BRANDING HEADER
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100 flex-shrink-0">
              <FileSpreadsheet className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                  Store Management
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  Asia/Kolkata
                </span>
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight mt-1">
                Weekly Stock Maintenance Report
              </h1>
              <p className="text-xs text-gray-500 mt-1">
                View physical stock summary, movement history, technician-wise issuance and download PDF report.
              </p>
            </div>
          </div>

          {/* Report Status Indicator */}
          <div className="flex items-center gap-2 self-start md:self-center">
            {reportData && !isReportStale && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Report Ready
              </span>
            )}
            {isReportStale && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" />
                Week Changed (Regenerate Required)
              </span>
            )}
            {!reportData && !loading && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                <Clock className="w-3.5 h-3.5" />
                No Report Generated
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          WEEK SELECTOR & REPORT ACTIONS CONTROL CARD
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Week Selector Control */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200">
              <button
                type="button"
                onClick={handlePreviousWeek}
                disabled={loading}
                title="Go to Previous Week (Mon-Sun)"
                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-white transition-all disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="px-3 py-1.5 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-orange-600" />
                <div className="text-left">
                  <div className="text-[11px] font-bold text-gray-900 leading-tight">
                    {formatDateReadable(weekRange.startDate)} — {formatDateReadable(weekRange.endDate)}
                  </div>
                  <div className="text-[10px] font-semibold text-gray-400">
                    Monday to Sunday (7 days)
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleNextWeek}
                disabled={loading}
                title="Go to Next Week (Mon-Sun)"
                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-white transition-all disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick jump to Previous Completed Week */}
            <button
              type="button"
              onClick={() => {
                setWeekRange(calculateDefaultCompletedWeek());
                setSuccessMessage('');
              }}
              disabled={loading}
              className="text-xs font-semibold text-gray-600 hover:text-orange-600 px-2.5 py-1.5 rounded-lg border border-dashed border-gray-300 hover:border-orange-300 transition-colors cursor-pointer"
            >
              Reset to Last Completed Week
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Generate Report Button */}
            <button
              type="button"
              id="generate-weekly-report-btn"
              onClick={handleGenerateReport}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Generating Report...' : 'Generate Report'}</span>
            </button>

            {/* Preview Report Button */}
            <button
              type="button"
              id="preview-weekly-report-btn"
              onClick={() => setPreviewModalOpen(true)}
              disabled={!canPreviewOrDownload}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eye className="w-4 h-4" />
              <span>Preview Report</span>
            </button>

            {/* Download PDF Button */}
            <button
              type="button"
              id="download-weekly-report-pdf-btn"
              onClick={handleDownloadPdf}
              disabled={!canPreviewOrDownload || downloadingPdf}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className={`w-4 h-4 ${downloadingPdf ? 'animate-bounce' : ''}`} />
              <span>{downloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Success Banner */}
        {successMessage && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              onClick={() => setSuccessMessage('')}
              className="text-emerald-500 hover:text-emerald-700 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage('')}
              className="text-rose-500 hover:text-rose-700 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Week Stale Warning Banner */}
        {isReportStale && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>
                The selected week was changed. Please click <strong>Generate Report</strong> to calculate data for the new period. Preview and Download are disabled until regenerated.
              </span>
            </div>
            <button
              type="button"
              onClick={handleGenerateReport}
              className="underline font-bold hover:text-amber-900 cursor-pointer"
            >
              Generate Now
            </button>
          </div>
        )}

        {/* Critical Rule Reminder */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 text-[11px] text-gray-500">
          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <span>
            <strong>Inventory Scope:</strong> Store Manager maintains actual physical loose stock only. Calculated virtual device-sets (2CH Live, 4CH Recording, etc.) belong exclusively in Sales Checklist Creation and are excluded from this report.
          </span>
        </div>
      </div>

      {/* ============================================================
          REPORT METADATA CARDS (WHEN GENERATED)
          ============================================================ */}
      {reportData && !isReportStale && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Report Period
            </div>
            <div className="text-sm font-black text-gray-900 mt-1">
              {reportData.reportPeriod.formattedRange}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {reportData.reportPeriod.timezone} (Inclusive)
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Generated On
            </div>
            <div className="text-sm font-black text-gray-900 mt-1">
              {reportData.metadata.generatedOn}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Asia/Kolkata Business Standard
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Generated By
            </div>
            <div className="text-sm font-black text-gray-900 mt-1 truncate">
              {reportData.metadata.generatedBy}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Store Manager Workspace
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Reconciliation Audit
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {reportData.stockReconciliation?.isFullyReconciled ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-black text-emerald-700">100% Balanced</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-black text-amber-700">
                    {reportData.stockReconciliation?.summary?.varianceCount} Discrepancy Found
                  </span>
                </>
              )}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {reportData.stockMovements?.length || 0} Total Transactions Processed
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SECTION 1: WEEKLY STOCK SUMMARY (PHYSICAL STOCK ONLY)
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-gray-900">
                Weekly Stock Summary (Physical Stock Only)
              </h2>
              <span className="text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold">
                {reportData?.stockSummary?.length || 12} Products
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Opening stock, weekly inflows, issuances, verified usable returns, adjustments, and closing stock.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewAllSummaryItems((v) => !v)}
              className="text-xs font-bold text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              {viewAllSummaryItems ? 'Collapse Active View' : 'View All Items'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/80 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="py-3 px-3 text-center w-12">#</th>
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-3 text-center">Unit</th>
                <th className="py-3 px-4 text-right">Opening Stock</th>
                <th className="py-3 px-4 text-right text-emerald-700">Stock Added</th>
                <th className="py-3 px-4 text-right text-orange-700">Issued</th>
                <th className="py-3 px-4 text-right text-blue-700">Returned</th>
                <th className="py-3 px-4 text-right">Adjustments</th>
                <th className="py-3 px-4 text-right font-black text-gray-900 bg-gray-50">Closing Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {!reportData ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="font-semibold text-gray-500">No report generated yet</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Select a week range and click <strong>Generate Report</strong> above.
                    </p>
                  </td>
                </tr>
              ) : summaryItemsToDisplay.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-400">
                    No physical stock items found.
                  </td>
                </tr>
              ) : (
                summaryItemsToDisplay.map((item) => {
                  const hasDiscrepancy =
                    reportData.stockReconciliation?.itemsWithVariance?.some(
                      (v) => v.productName === item.name
                    );

                  return (
                    <tr
                      key={item.id || item.name}
                      className={`hover:bg-gray-50/70 transition-colors ${
                        hasDiscrepancy ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-3 text-center text-gray-400 font-mono text-[11px]">
                        {item.index}
                      </td>
                      <td className="py-3 px-4 font-bold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span>{item.name}</span>
                          {item.type === 'DEVICE' ? (
                            <span className="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-mono font-semibold">
                              Device
                            </span>
                          ) : (
                            <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded font-mono font-semibold">
                              Material
                            </span>
                          )}
                          {hasDiscrepancy && (
                            <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold">
                              Variance
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center text-gray-500 font-mono text-[11px]">
                        {item.unit}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-gray-700">
                        {item.openingStock}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                        {item.stockAdded > 0 ? `+${item.stockAdded}` : 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-orange-600">
                        {item.issued > 0 ? `-${item.issued}` : 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-blue-600">
                        {item.returned > 0 ? `+${item.returned}` : 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-700">
                        {item.adjustments > 0
                          ? `+${item.adjustments}`
                          : item.adjustments < 0
                          ? item.adjustments
                          : 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-sm text-gray-900 bg-gray-50/50">
                        {item.closingStock}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================
          SECTION 2: STOCK MOVEMENT HISTORY
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-gray-900">
                Stock Movement History
              </h2>
              <span className="text-[10px] font-mono bg-gray-100 text-gray-700 border border-gray-200 px-2 py-0.5 rounded-full font-bold">
                {reportData?.stockMovements?.length || 0} Movements
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Audit log of all physical receipts, issuances, returns, courier deductions and adjustments.
            </p>
          </div>

          {/* Movement Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search item, tech, checklist..."
              value={movementSearchQuery}
              onChange={(e) => setMovementSearchQuery(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-500 w-48"
            />

            <select
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white font-medium text-gray-700 focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All Types</option>
              <option value="STOCK_ADDITION">Stock Addition</option>
              <option value="MATERIAL_ISSUANCE">Material Issuance</option>
              <option value="DEVICE_ISSUANCE">Device Issuance</option>
              <option value="VERIFIED_RETURN">Verified Return</option>
              <option value="COURIER_DISPATCH">Courier Dispatch</option>
              <option value="STOCK_ADJUSTMENT">Stock Adjustment</option>
              <option value="REVERSAL_VOID">Reversal / Void</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="py-2.5 px-3 text-center w-12">#</th>
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3">Item</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-2 text-center">Unit</th>
                <th className="py-2.5 px-3 text-right">Before</th>
                <th className="py-2.5 px-3 text-right">After</th>
                <th className="py-2.5 px-3">Technician / Recipient</th>
                <th className="py-2.5 px-3">Checklist No.</th>
                <th className="py-2.5 px-3">Performed By</th>
                <th className="py-2.5 px-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {!reportData ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-gray-400">
                    Generate a report to view movement history.
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-gray-400">
                    No physical stock movements recorded during this period.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const isPositive =
                    m.type === 'STOCK_ADDITION' || m.type === 'VERIFIED_RETURN';
                  const isVoid =
                    m.isVoid || m.type === 'REVERSAL_VOID';

                  return (
                    <tr
                      key={m.id || `${m.date}-${m.index}`}
                      className={`hover:bg-gray-50/70 transition-colors ${
                        isVoid ? 'bg-rose-50/20 text-gray-400' : ''
                      }`}
                    >
                      <td className="py-2 px-3 text-center text-gray-400 font-mono text-[11px]">
                        {m.index}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600 font-mono text-[11px]">
                        {m.dateTime}
                      </td>
                      <td className="py-2 px-3 font-bold text-gray-900 whitespace-nowrap">
                        {m.itemName}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.type === 'STOCK_ADDITION'
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.type === 'VERIFIED_RETURN'
                              ? 'bg-blue-100 text-blue-800'
                              : m.type === 'COURIER_DISPATCH'
                              ? 'bg-purple-100 text-purple-800'
                              : m.type === 'REVERSAL_VOID' || isVoid
                              ? 'bg-rose-100 text-rose-800 line-through'
                              : m.type === 'STOCK_ADJUSTMENT'
                              ? 'bg-gray-200 text-gray-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          {m.type?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-bold ${
                          isPositive
                            ? 'text-emerald-600'
                            : isVoid
                            ? 'text-gray-400'
                            : 'text-orange-600'
                        }`}
                      >
                        {isPositive ? `+${m.quantity}` : `-${m.quantity}`}
                      </td>
                      <td className="py-2 px-2 text-center font-mono text-gray-500 text-[11px]">
                        {m.unit}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-gray-500">
                        {m.balanceBefore !== null && m.balanceBefore !== undefined
                          ? m.balanceBefore
                          : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-gray-800">
                        {m.balanceAfter !== null && m.balanceAfter !== undefined
                          ? m.balanceAfter
                          : '—'}
                      </td>
                      <td className="py-2 px-3 font-medium text-gray-800 whitespace-nowrap">
                        {m.technicianName || '—'}
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold text-blue-600 whitespace-nowrap">
                        {m.checklistNumber || '—'}
                      </td>
                      <td className="py-2 px-3 text-gray-600 whitespace-nowrap">
                        {m.performedBy || 'System'}
                      </td>
                      <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate" title={m.remarks}>
                        {m.remarks || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================
          SECTION 3: TECHNICIAN-WISE MATERIAL ISSUANCE SUMMARY
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-gray-900">
              Technician-Wise Material Issuance Summary
            </h2>
            <span className="text-[10px] font-mono bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-bold">
              4 Named Technicians + Unassigned
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Strict attribution to Mathi, Guna, Sakthivel, Kamalesh, and Unassigned Recipient. Units are never combined.
          </p>
        </div>

        <div className="p-5 space-y-4">
          {!reportData ? (
            <div className="py-8 text-center text-gray-400">
              Generate report to view technician issuance breakdown.
            </div>
          ) : (
            (reportData.technicianIssuance || []).map((tech) => {
              const isExpanded = expandedTechnicians[tech.technicianName];
              const hasIssuances = (tech.issuances || []).length > 0;

              return (
                <div
                  key={tech.technicianName}
                  className="border border-gray-200 rounded-xl overflow-hidden"
                >
                  {/* Accordion Header */}
                  <div
                    onClick={() => toggleTechnicianAccordion(tech.technicianName)}
                    className="p-4 bg-gray-50/70 hover:bg-gray-100/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-gray-900">
                            {tech.technicianName}
                          </span>
                          <span className="text-[10px] font-semibold text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                            {tech.issuances?.length || 0} Issuance Events
                          </span>
                        </div>
                        {tech.uniqueChecklistCount > 0 && (
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            Active across {tech.uniqueChecklistCount} checklist jobs
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Summary pills for each item (incompatible units kept separate) */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tech.itemTotals?.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">
                          No items issued this week
                        </span>
                      ) : (
                        tech.itemTotals?.map((it) => (
                          <span
                            key={it.name}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-800 shadow-2xs font-mono"
                          >
                            <span className="text-gray-500 font-sans">{it.name}: </span>
                            <span className="font-bold text-orange-600">
                              {it.quantity} {it.unit}
                            </span>
                          </span>
                        ))
                      )}

                      <div className="p-1 text-gray-400 hover:text-gray-600 ml-2">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Accordion Content Table */}
                  {isExpanded && (
                    <div className="p-4 bg-white border-t border-gray-200">
                      {!hasIssuances ? (
                        <p className="text-xs text-gray-400 italic py-2">
                          No material issuance records logged for {tech.technicianName} during this week.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-gray-50/50 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                <th className="py-2 px-3">Date & Time</th>
                                <th className="py-2 px-3">Checklist No.</th>
                                <th className="py-2 px-3">Item</th>
                                <th className="py-2 px-3 text-right">Quantity</th>
                                <th className="py-2 px-2 text-center">Unit</th>
                                <th className="py-2 px-3">Issued By</th>
                                <th className="py-2 px-3">Remarks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tech.issuances.map((iss, i) => (
                                <tr key={iss.id || i} className="hover:bg-gray-50/50">
                                  <td className="py-2 px-3 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                                    {iss.dateTime}
                                  </td>
                                  <td className="py-2 px-3 font-mono font-bold text-blue-600 whitespace-nowrap">
                                    {iss.checklistNumber || '—'}
                                  </td>
                                  <td className="py-2 px-3 font-bold text-gray-900">
                                    {iss.itemName}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-orange-600">
                                    {iss.quantity}
                                  </td>
                                  <td className="py-2 px-2 text-center font-mono text-gray-500 text-[11px]">
                                    {iss.unit}
                                  </td>
                                  <td className="py-2 px-3 text-gray-600">
                                    {iss.issuedBy || 'Store Manager'}
                                  </td>
                                  <td className="py-2 px-3 text-gray-500 max-w-xs truncate" title={iss.remarks}>
                                    {iss.remarks || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ============================================================
          SECTION 4: MATERIAL USAGE AND RETURN RECONCILIATION
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-gray-900">
              Material Usage and Return Reconciliation
            </h2>
            <span className="text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold">
              Installation Materials Only
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Strict separation: Only accepted, store-verified physical returns increase usable inventory. Technician-reported returns awaiting store verification do not alter inventory. Screws are non-returnable.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50/80 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-3 text-center">Unit</th>
                <th className="py-3 px-4 text-right">Issued</th>
                <th className="py-3 px-4 text-right">Used (Reported)</th>
                <th className="py-3 px-4 text-right">Returned (Reported)</th>
                <th className="py-3 px-4 text-right text-emerald-700 font-bold">
                  Verified Usable
                </th>
                <th className="py-3 px-4 text-right text-amber-700 font-bold">
                  Awaiting Verification
                </th>
                <th className="py-3 px-4 text-right text-rose-700">Damaged / Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!reportData ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">
                    Generate report to view material usage & returns.
                  </td>
                </tr>
              ) : (
                (reportData.materialReconciliation || []).map((mat) => (
                  <tr key={mat.name} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-bold text-gray-900">
                      <div className="flex items-center gap-2">
                        <span>{mat.name}</span>
                        {mat.isScrew && (
                          <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-mono">
                            Non-returnable consumable
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center text-gray-500 font-mono text-[11px]">
                      {mat.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-gray-700">
                      {mat.issued}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-gray-700">
                      {mat.used}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-gray-700">
                      {mat.isScrew ? (
                        <span className="text-gray-400 italic">Not Tracked</span>
                      ) : (
                        mat.reportedReturned
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                      {mat.isScrew ? (
                        <span className="text-gray-400 italic">Not Tracked</span>
                      ) : (
                        mat.verifiedUsable
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-amber-600">
                      {mat.isScrew ? (
                        <span className="text-gray-400 italic">Not Tracked</span>
                      ) : (
                        mat.awaitingVerification
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600">
                      {mat.isScrew ? (
                        <span className="text-gray-400 italic">Not Tracked</span>
                      ) : (
                        mat.damagedMissing
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================
          SECTION 5: LOW-STOCK & ZERO-STOCK ALERTS
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-gray-900">
              Low-Stock and Zero-Stock Alerts
            </h2>
            <span className="text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-bold">
              Configured Thresholds Only
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Strict threshold compliance: Only items with explicitly configured minimum stock levels are monitored.
          </p>
        </div>

        <div className="p-5">
          {!reportData ? (
            <div className="py-6 text-center text-gray-400 text-xs">
              Generate report to check stock threshold alerts.
            </div>
          ) : (reportData.lowStockAlerts || []).length === 0 ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="font-bold">Healthy Physical Stock Levels</p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  All inventory items with configured minimum safety levels are currently well-stocked.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {reportData.lowStockAlerts.map((alert) => (
                <div
                  key={alert.name}
                  className={`p-4 rounded-xl border flex flex-col justify-between ${
                    alert.severity === 'CRITICAL'
                      ? 'bg-rose-50/50 border-rose-200'
                      : alert.severity === 'WARNING'
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-sm text-gray-900">{alert.name}</h3>
                      <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                        Configured Min: {alert.minStock} {alert.unit}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        alert.severity === 'CRITICAL'
                          ? 'bg-rose-100 text-rose-700 border border-rose-300'
                          : alert.severity === 'WARNING'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {alert.status}
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-200/50 flex items-center justify-between text-xs">
                    <span className="text-gray-500">Current Stock:</span>
                    <span className="font-mono font-black text-sm text-gray-900">
                      {alert.currentStock} {alert.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          SECTION 6: STOCK RECONCILIATION & VARIANCE AUDIT
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-gray-900">
              Stock Reconciliation and Variance Detection
            </h2>
            <span className="text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold">
              Mathematical Verification
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">
            Expected Closing Stock = Opening Stock + Stock Added + Accepted Returns − Issued − Dispatched + Net Adjustments
          </p>
        </div>

        <div className="p-5">
          {!reportData ? (
            <div className="py-6 text-center text-gray-400 text-xs">
              Generate report to view reconciliation variance audit.
            </div>
          ) : reportData.stockReconciliation?.isFullyReconciled ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="font-bold">Perfect Mathematical Reconciliation</p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  Every physical stock item reconciles exactly: calculated balances match authoritative physical ledger records with 0 variance.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="font-bold">Reconciliation Discrepancies Detected</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    {reportData.stockReconciliation?.itemsWithVariance?.length} items show a variance between calculated balance from weekly movements and authoritative ledger closing balance. Review the affected items below:
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50/80 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2.5 px-3">Item</th>
                      <th className="py-2.5 px-3 text-right">Calculated Closing</th>
                      <th className="py-2.5 px-3 text-right">Actual Ledger Balance</th>
                      <th className="py-2.5 px-3 text-right text-rose-700 font-bold">Variance</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reportData.stockReconciliation?.itemsWithVariance?.map((v) => (
                      <tr key={v.productName} className="hover:bg-gray-50">
                        <td className="py-2.5 px-3 font-bold text-gray-900">
                          {v.productName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {v.calculatedClosing} {v.unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {v.actualLedgerBalance} {v.unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                          {v.variance > 0 ? `+${v.variance}` : v.variance} {v.unit}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700">
                            Discrepancy
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          PREVIEW MODAL (FULL REPORT PREVIEW)
          ============================================================ */}
      {previewModalOpen && reportData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-600 rounded-xl text-white">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight text-white">
                    Report Preview — {reportData.reportPeriod.formattedRange}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Eagle Eye SafDrive Pvt Ltd • Multi-Page Printable Layout
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-orange-600 hover:bg-orange-700 text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingPdf ? 'Downloading...' : 'Download PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs bg-slate-50/50">
              {/* Document Header Representation */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs">
                <div className="flex justify-between items-start border-b border-gray-200 pb-4">
                  <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">
                      EAGLE EYE SAFDRIVE PVT LTD
                    </h2>
                    <h3 className="text-xs font-bold text-orange-600 uppercase tracking-widest mt-0.5">
                      Weekly Stock Maintenance Report
                    </h3>
                  </div>
                  <div className="text-right text-[11px] text-gray-500 space-y-0.5">
                    <div>
                      <strong>Reporting Period:</strong> {reportData.reportPeriod.formattedRange}
                    </div>
                    <div>
                      <strong>Generated On:</strong> {reportData.metadata.generatedOn}
                    </div>
                    <div>
                      <strong>Generated By:</strong> {reportData.metadata.generatedBy}
                    </div>
                  </div>
                </div>

                {/* Preview Section 1: Physical Stock Summary */}
                <div className="mt-5">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px] mb-2">
                    1. Weekly Physical Stock Summary
                  </h4>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-gray-100 text-gray-600 font-bold uppercase">
                        <tr>
                          <th className="py-2 px-2 text-center">#</th>
                          <th className="py-2 px-3">Item</th>
                          <th className="py-2 px-2 text-center">Unit</th>
                          <th className="py-2 px-3 text-right">Opening</th>
                          <th className="py-2 px-3 text-right">Added</th>
                          <th className="py-2 px-3 text-right">Issued</th>
                          <th className="py-2 px-3 text-right">Returned</th>
                          <th className="py-2 px-3 text-right">Adjust</th>
                          <th className="py-2 px-3 text-right font-bold">Closing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-mono">
                        {reportData.stockSummary.map((item) => (
                          <tr key={item.name}>
                            <td className="py-1.5 px-2 text-center text-gray-400">{item.index}</td>
                            <td className="py-1.5 px-3 font-sans font-bold text-gray-900">{item.name}</td>
                            <td className="py-1.5 px-2 text-center text-gray-500">{item.unit}</td>
                            <td className="py-1.5 px-3 text-right">{item.openingStock}</td>
                            <td className="py-1.5 px-3 text-right text-emerald-600">{item.stockAdded}</td>
                            <td className="py-1.5 px-3 text-right text-orange-600">{item.issued}</td>
                            <td className="py-1.5 px-3 text-right text-blue-600">{item.returned}</td>
                            <td className="py-1.5 px-3 text-right">{item.adjustments}</td>
                            <td className="py-1.5 px-3 text-right font-black text-gray-900 bg-gray-50">{item.closingStock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Preview Section 2: Technician-wise Issuance Totals */}
                <div className="mt-5">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px] mb-2">
                    2. Technician-Wise Material Issuance
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {reportData.technicianIssuance.map((t) => (
                      <div key={t.technicianName} className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                        <div className="font-bold text-xs text-gray-900">{t.technicianName}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {t.issuances.length} issuance events • {t.uniqueChecklistCount} jobs
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.itemTotals.length === 0 ? (
                            <span className="text-[10px] text-gray-400 italic">No issuance</span>
                          ) : (
                            t.itemTotals.map((it) => (
                              <span key={it.name} className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-gray-200">
                                {it.name}: <strong>{it.quantity} {it.unit}</strong>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preview Section 3: Material Usage Reconciliation */}
                <div className="mt-5">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px] mb-2">
                    3. Material Usage & Return Reconciliation
                  </h4>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="bg-gray-100 text-gray-600 font-bold uppercase">
                        <tr>
                          <th className="py-1.5 px-2">Material</th>
                          <th className="py-1.5 px-2 text-center">Unit</th>
                          <th className="py-1.5 px-2 text-right">Issued</th>
                          <th className="py-1.5 px-2 text-right">Used</th>
                          <th className="py-1.5 px-2 text-right">Reported Return</th>
                          <th className="py-1.5 px-2 text-right text-emerald-700 font-bold">Verified Usable</th>
                          <th className="py-1.5 px-2 text-right text-amber-700 font-bold">Awaiting Verification</th>
                          <th className="py-1.5 px-2 text-right text-rose-700">Damaged / Missing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-mono">
                        {reportData.materialReconciliation.map((m) => (
                          <tr key={m.name}>
                            <td className="py-1.5 px-2 font-sans font-bold text-gray-900">{m.name}</td>
                            <td className="py-1.5 px-2 text-center text-gray-500">{m.unit}</td>
                            <td className="py-1.5 px-2 text-right">{m.issued}</td>
                            <td className="py-1.5 px-2 text-right">{m.used}</td>
                            <td className="py-1.5 px-2 text-right">{m.isScrew ? 'Not Tracked' : m.reportedReturned}</td>
                            <td className="py-1.5 px-2 text-right text-emerald-600 font-bold">{m.isScrew ? 'Not Tracked' : m.verifiedUsable}</td>
                            <td className="py-1.5 px-2 text-right text-amber-600 font-bold">{m.isScrew ? 'Not Tracked' : m.awaitingVerification}</td>
                            <td className="py-1.5 px-2 text-right text-rose-600">{m.isScrew ? 'Not Tracked' : m.damagedMissing}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Preview Section 4: Alerts & Variance Audit */}
                <div className="mt-5">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px] mb-2">
                    4. Alerts & Reconciliation Status
                  </h4>
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-xs text-gray-900">
                        {reportData.stockReconciliation?.isFullyReconciled
                          ? '100% Balanced Mathematical Reconciliation'
                          : 'Reconciliation Discrepancies Present'}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {reportData.stockMovements?.length || 0} total movement records processed.
                      </div>
                    </div>
                    <div>
                      {reportData.stockReconciliation?.isFullyReconciled ? (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                          Reconciled (0 Variance)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                          {reportData.stockReconciliation?.summary?.varianceCount} Variances
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-white border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                This preview reflects the exact data rendered in the downloaded PDF.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  Close Preview
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Multi-Page PDF</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
