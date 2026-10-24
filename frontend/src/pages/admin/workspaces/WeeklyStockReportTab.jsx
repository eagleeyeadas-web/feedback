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
  Clock,
  User,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileSpreadsheet,
  X,
  ExternalLink,
  MapPin,
  Info,
  Check,
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
  const [expandedTechnicians, setExpandedTechnicians] = useState({});
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

  // Initialize all technician accordions to expanded once data arrives
  useEffect(() => {
    if (reportData?.technicianInstallationReport?.technicians) {
      const initialMap = {};
      reportData.technicianInstallationReport.technicians.forEach((t) => {
        initialMap[t.technicianName] = true;
      });
      setExpandedTechnicians(initialMap);
    }
  }, [reportData]);

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

  // Expand / Collapse all technicians
  const toggleAllTechnicians = () => {
    const techs = reportData?.technicianInstallationReport?.technicians || [];
    const allExpanded = techs.every((t) => expandedTechnicians[t.technicianName]);
    const nextState = {};
    techs.forEach((t) => {
      nextState[t.technicianName] = !allExpanded;
    });
    setExpandedTechnicians(nextState);
  };

  const techReport =
    reportData?.technicianInstallationReport ||
    reportData?.technician_installation_report ||
    null;

  const totalCompletedInstallations =
    techReport?.summary?.totalCompletedInstallations ??
    techReport?.summary?.total_completed_installations ??
    0;

  const totalDevicesInstalled =
    techReport?.summary?.totalDevicesInstalled ??
    techReport?.summary?.total_devices_installed ??
    0;

  const activeTechnicians = techReport?.technicians || [];

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
                Review completed installations grouped by technician, client and devices, and download the official weekly PDF report.
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
              Weekly Installations Summary
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-black text-orange-600">
                {totalCompletedInstallations} Installations
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-sm font-black text-blue-700">
                {totalDevicesInstalled} Devices
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Active across {activeTechnicians.length} Service Engineers
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MAIN SECTION: TECHNICIAN-WISE INSTALLATION REPORT
          ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {/* Section Header */}
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-gray-900">
                Technician-Wise Installation Report
              </h2>
              {techReport && (
                <span className="text-[10px] font-mono bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-bold">
                  {totalCompletedInstallations} Completed Installations • {totalDevicesInstalled} Devices
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Completed installations grouped by technician, client and devices.
            </p>
          </div>

          {reportData && activeTechnicians.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAllTechnicians}
                className="text-xs font-bold text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                {activeTechnicians.every((t) => expandedTechnicians[t.technicianName])
                  ? 'Collapse All'
                  : 'Expand All'}
              </button>
            </div>
          )}
        </div>

        {/* Section Content */}
        <div className="p-5 space-y-4">
          {!reportData ? (
            <div className="py-12 text-center text-gray-400">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-30 text-orange-500" />
              <p className="font-semibold text-gray-600">No report generated yet</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Select a week range and click <strong>Generate Report</strong> above to view technician installations.
              </p>
            </div>
          ) : activeTechnicians.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-xs">
              No service engineers configured or found.
            </div>
          ) : (
            activeTechnicians.map((tech) => {
              const isExpanded = Boolean(expandedTechnicians[tech.technicianName]);
              const installations = tech.installations || [];
              const instCount = tech.completedInstallationsCount ?? tech.completed_installations_count ?? 0;
              const devCount = tech.totalDevicesInstalled ?? tech.total_devices_installed ?? 0;

              return (
                <div
                  key={tech.technicianName}
                  className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs transition-all"
                >
                  {/* Accordion Header */}
                  <div
                    onClick={() => toggleTechnicianAccordion(tech.technicianName)}
                    className="p-4 bg-gray-50/80 hover:bg-gray-100/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
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
                          {!tech.isActive && (
                            <span className="text-[9px] font-semibold text-gray-500 bg-gray-200 px-1.5 py-0.2 rounded">
                              Historical
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {instCount === 0
                            ? '0 completed installations this week'
                            : `${instCount} client installation${instCount === 1 ? '' : 's'} completed`}
                        </div>
                      </div>
                    </div>

                    {/* Summary badges and chevron */}
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-800 shadow-2xs font-mono">
                        <span className="text-gray-500 font-sans font-medium">Installations: </span>
                        <span className="text-orange-600 font-bold">{instCount}</span>
                      </span>

                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-800 shadow-2xs font-mono">
                        <span className="text-gray-500 font-sans font-medium">Devices: </span>
                        <span className="text-blue-600 font-bold">{devCount}</span>
                      </span>

                      <div className="p-1 text-gray-400 hover:text-gray-600 ml-1">
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
                      {installations.length === 0 ? (
                        <div className="py-6 text-center text-gray-400 text-xs italic bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                          No completed installations recorded for {tech.technicianName} during this reporting period.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs min-w-[650px]">
                            <thead>
                              <tr className="bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                <th className="py-2.5 px-3 text-center w-12">#</th>
                                <th className="py-2.5 px-4">Client Name</th>
                                <th className="py-2.5 px-3">Installed Date</th>
                                <th className="py-2.5 px-4">Device Type</th>
                                <th className="py-2.5 px-3 text-right">Quantity</th>
                                <th className="py-2.5 px-4">Location</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {installations.map((inst, instIdx) => {
                                const devices =
                                  inst.devices && inst.devices.length > 0
                                    ? inst.devices
                                    : [{ device_type: 'Device', quantity: 1 }];

                                const rowSpan = devices.length;

                                return devices.map((dev, devIdx) => (
                                  <tr
                                    key={`${inst.checklistId || instIdx}-${dev.deviceType}-${devIdx}`}
                                    className={`hover:bg-gray-50/60 transition-colors ${
                                      instIdx % 2 === 1 ? 'bg-slate-50/25' : ''
                                    }`}
                                  >
                                    {/* Grouped Client Columns (Row 0 Only) */}
                                    {devIdx === 0 && (
                                      <>
                                        <td
                                          rowSpan={rowSpan}
                                          className="py-3 px-3 text-center font-mono text-gray-400 text-xs align-top border-r border-gray-100/80"
                                        >
                                          {inst.serialNumber || instIdx + 1}
                                        </td>
                                        <td
                                          rowSpan={rowSpan}
                                          className="py-3 px-4 font-bold text-gray-900 align-top border-r border-gray-100/80"
                                        >
                                          <div className="flex flex-col gap-0.5">
                                            <span className="text-xs text-gray-900 break-words font-black">
                                              {inst.clientName}
                                            </span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                              <span className="text-[10px] font-mono text-blue-600 font-semibold">
                                                {inst.checklistNumber}
                                              </span>
                                              {inst.is_additional_customer && (
                                                <span className="text-[9px] bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.2 rounded font-semibold">
                                                  Extra Installation
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                        <td
                                          rowSpan={rowSpan}
                                          className="py-3 px-3 font-medium text-gray-700 whitespace-nowrap align-top border-r border-gray-100/80"
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                            <span>{inst.installedDate}</span>
                                          </div>
                                        </td>
                                      </>
                                    )}

                                    {/* Ungrouped Device Columns (Every Row) */}
                                    <td className="py-3 px-4 font-bold text-gray-800">
                                      <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                                        <span>{dev.deviceType || dev.device_type}</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right font-mono font-black text-orange-600 text-xs">
                                      {dev.quantity}
                                    </td>

                                    {/* Grouped Location Column (Row 0 Only) */}
                                    {devIdx === 0 && (
                                      <td
                                        rowSpan={rowSpan}
                                        className="py-3 px-4 text-gray-600 align-top border-l border-gray-100/80"
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex items-start gap-1.5">
                                            <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                                            <span className="break-words text-xs text-gray-700 font-medium">
                                              {inst.installationLocation || inst.location}
                                            </span>
                                          </div>

                                          {inst.googleMapsLink && (
                                            <a
                                              href={inst.googleMapsLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title="View location in Google Maps"
                                              className="p-1 rounded-md text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-colors flex-shrink-0"
                                            >
                                              <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                          )}
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ));
                              })}
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
                    Eagle Eye SafDrive Pvt Ltd • Official Printable A4 Layout
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
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs bg-slate-50/50">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-6">
                {/* Header Banner */}
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

                {/* Metadata Summary Pill */}
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                  <div className="font-bold text-gray-900">
                    Technician-Wise Installation Summary
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-700">
                      Total Completed Installations: <strong className="text-orange-600 font-mono">{totalCompletedInstallations}</strong>
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="font-semibold text-gray-700">
                      Total Devices Installed: <strong className="text-blue-700 font-mono">{totalDevicesInstalled}</strong>
                    </span>
                  </div>
                </div>

                {/* Technician-Wise Installation Report Content */}
                <div className="space-y-4">
                  {activeTechnicians.map((tech) => {
                    const installations = tech.installations || [];
                    return (
                      <div
                        key={tech.technicianName}
                        className="border border-gray-200 rounded-xl overflow-hidden"
                      >
                        <div className="p-3 bg-slate-100 flex items-center justify-between border-b border-gray-200">
                          <span className="font-bold text-sm text-gray-900">
                            {tech.technicianName}
                          </span>
                          <span className="text-xs font-bold text-orange-600 font-mono">
                            {tech.completedInstallationsCount || 0} Installations • {tech.totalDevicesInstalled || 0} Devices Installed
                          </span>
                        </div>

                        {installations.length === 0 ? (
                          <div className="p-4 text-center text-gray-400 italic text-xs">
                            No completed installations recorded for {tech.technicianName} during this reporting period.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                <tr>
                                  <th className="py-2 px-3 text-center w-10">#</th>
                                  <th className="py-2 px-3">Client Name</th>
                                  <th className="py-2 px-3">Installed Date</th>
                                  <th className="py-2 px-3">Device Type</th>
                                  <th className="py-2 px-3 text-right">Quantity</th>
                                  <th className="py-2 px-3">Location</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {installations.map((inst, instIdx) => {
                                  const devices =
                                    inst.devices && inst.devices.length > 0
                                      ? inst.devices
                                      : [{ device_type: 'Device', quantity: 1 }];

                                  return devices.map((dev, devIdx) => (
                                    <tr key={`${instIdx}-${devIdx}`}>
                                      {devIdx === 0 && (
                                        <>
                                          <td
                                            rowSpan={devices.length}
                                            className="py-2 px-3 text-center font-mono text-gray-400 align-top"
                                          >
                                            {inst.serialNumber || instIdx + 1}
                                          </td>
                                          <td
                                            rowSpan={devices.length}
                                            className="py-2 px-3 font-bold text-gray-900 align-top"
                                          >
                                            {inst.clientName}
                                          </td>
                                          <td
                                            rowSpan={devices.length}
                                            className="py-2 px-3 text-gray-600 align-top whitespace-nowrap"
                                          >
                                            {inst.installedDate}
                                          </td>
                                        </>
                                      )}
                                      <td className="py-2 px-3 text-gray-800 font-medium">
                                        {dev.deviceType || dev.device_type}
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono font-bold text-orange-600">
                                        {dev.quantity}
                                      </td>
                                      {devIdx === 0 && (
                                        <td
                                          rowSpan={devices.length}
                                          className="py-2 px-3 text-gray-600 align-top"
                                        >
                                          {inst.installationLocation || inst.location}
                                        </td>
                                      )}
                                    </tr>
                                  ));
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-white border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                This preview reflects the exact layout and data included in the downloaded PDF.
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
