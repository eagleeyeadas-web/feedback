import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { fetchInstallationChecklistDetail, downloadInstallationPDF } from '../../../lib/api';
import { downloadInstallationExcel } from '../../../lib/excelHelper';
import {
  ArrowLeft,
  Edit,
  FileSpreadsheet,
  FileDown,
  CheckCircle2,
  AlertTriangle,
  User,
  HardDrive,
  CreditCard,
  Calendar,
  Users,
  FileText,
  MapPin,
  ExternalLink,
  CheckSquare,
  Clock,
  Package,
  Wrench,
  ShieldCheck,
} from 'lucide-react';

export default function InstallationChecklistDetails({ id: propId, onEdit, onBack }) {
  const { session, role } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const routeParams = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const checklistId = propId || routeParams.id;
  const documentRef = useRef(null);
  const isGeneratingRef = useRef(false);
  const autoDownloadedRef = useRef(false);

  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Workflow Modal States
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showTechModal, setShowTechModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showDiscModal, setShowDiscModal] = useState(false);

  useEffect(() => {
    autoDownloadedRef.current = false;
  }, [checklistId]);

  useEffect(() => {
    if (!token || !checklistId) return;
    setLoading(true);
    setError(null);

    fetchInstallationChecklistDetail(token, checklistId)
      .then((data) => {
        setChecklist(data);

        // Auto trigger action if query param present
        const action = searchParams.get('action');
        if (action === 'print') {
          setTimeout(() => window.print(), 500);
        }
      })
      .catch((err) => {
        console.error('Error fetching checklist details:', err);
        setError(err.message || 'Failed to fetch checklist details');
      })
      .finally(() => setLoading(false));
  }, [token, checklistId]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDownloadPdf = async () => {
    // Synchronously guard against concurrent PDF generation calls
    if (isGeneratingRef.current || !checklist || !token) {
      return;
    }

    isGeneratingRef.current = true;
    setDownloadingPdf(true);

    try {
      const blob = await downloadInstallationPDF(token, checklist.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `EagleEye-Installation-${checklist.checklist_number}.pdf`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`PDF downloaded: ${filename}`);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert(err.message || 'Failed to generate PDF. Please try again.');
    } finally {
      isGeneratingRef.current = false;
      setDownloadingPdf(false);
    }
  };

  useEffect(() => {
    if (!checklist || searchParams.get('action') !== 'download') return;

    if (autoDownloadedRef.current) return;
    autoDownloadedRef.current = true;

    // Clean up action from searchParams so subsequent re-renders never re-trigger auto download
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('action');
    setSearchParams(newParams, { replace: true });

    const timer = setTimeout(() => {
      handleDownloadPdf();
    }, 400);

    return () => clearTimeout(timer);
  }, [checklist, searchParams, setSearchParams]);

  const handlePrint = () => {
    window.print();
  };

  const handleEditClick = () => {
    if (onEdit) onEdit(checklistId);
    else navigate(`/admin/installation-checklists/${checklistId}/edit`);
  };

  const handleBackClick = () => {
    if (onBack) onBack();
    else navigate('/admin/installation-checklists');
  };

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="bg-white p-12 rounded-2xl border border-gray-100 shadow-sm text-center">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-gray-500">Loading installation checklist details...</p>
      </div>
    );
  }

  if (error || !checklist) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-rose-100 shadow-sm text-center text-rose-600 space-y-3">
        <AlertTriangle className="mx-auto" size={32} />
        <p className="text-sm font-semibold">{error || 'Checklist not found'}</p>
        <button
          onClick={handleBackClick}
          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl transition-colors cursor-pointer"
        >
          Back to List
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium animate-bounce no-print">
          <CheckCircle2 size={18} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header Actions (Hidden on Print) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print">
        <div>
          <button
            onClick={handleBackClick}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-navy transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back to Installation Checklists</span>
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-navy">{checklist.checklist_number}</h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
              checklist.installation_status === 'Completed'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-blue-100 text-blue-800'
            }`}>
              {checklist.installation_status}
            </span>
          </div>
        </div>

          <div className="flex flex-wrap items-center gap-2">
          {/* Stage 2: Store Issue */}
          {(role === 'STORE_MANAGER' || role === 'ADMIN') && (
            <button
              onClick={() => setShowIssueModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Package size={15} />
              <span>Issue Stock</span>
            </button>
          )}

          {/* Stage 3: Technical Report */}
          {(role === 'TECHNICAL' || role === 'ADMIN') && (
            <button
              onClick={() => setShowTechModal(true)}
              className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Wrench size={15} />
              <span>Submit Tech Report</span>
            </button>
          )}

          {/* Stage 4: Declare Return */}
          {(role === 'TECHNICAL' || role === 'ADMIN') && (
            <button
              onClick={() => setShowReturnModal(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <ArrowLeft size={15} />
              <span>Declare Return</span>
            </button>
          )}

          {/* Stage 5: Verify Store Return */}
          {(role === 'STORE_MANAGER' || role === 'ADMIN') && (
            <button
              onClick={() => setShowVerifyModal(true)}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <ShieldCheck size={15} />
              <span>Verify Physical Return</span>
            </button>
          )}

          {/* Stage 6: Admin Resolve Discrepancy */}
          {role === 'ADMIN' && checklist.reconciliation_status === 'DISCREPANCY_OPEN' && (
            <button
              onClick={() => setShowDiscModal(true)}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <AlertTriangle size={15} />
              <span>Resolve Discrepancy</span>
            </button>
          )}

          <button
            onClick={handleEditClick}
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold px-3 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <Edit size={15} />
            <span>Edit</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          >
            <FileDown size={15} />
            <span>{downloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {/* WORKFLOW RECONCILIATION STAGE TRACKER */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3 no-print">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-navy uppercase tracking-wider flex items-center gap-2">
            <Clock size={16} className="text-blue-600" /> 7-Stage Installation & Stock Reconciliation Status
          </h3>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            checklist.reconciliation_status === 'FULLY_RECONCILED'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              : checklist.reconciliation_status === 'DISCREPANCY_OPEN'
              ? 'bg-red-100 text-red-800 border border-red-300'
              : 'bg-blue-100 text-blue-800 border border-blue-300'
          }`}>
            {checklist.reconciliation_status || 'INITIATED'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
          <div className="p-2.5 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 font-medium">
            <span className="block font-bold text-[10px] uppercase text-emerald-600">Stage 1</span>
            Sales Checklist Created
          </div>
          <div className={`p-2.5 rounded-xl border font-medium ${
            ['STORE_ISSUED', 'SITE_WORK_COMPLETED', 'PENDING_STORE_VERIFICATION', 'DISCREPANCY_OPEN', 'FULLY_RECONCILED'].includes(checklist.reconciliation_status)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
            <span className="block font-bold text-[10px] uppercase text-gray-500">Stage 2</span>
            Store Issued Stock
          </div>
          <div className={`p-2.5 rounded-xl border font-medium ${
            ['SITE_WORK_COMPLETED', 'PENDING_STORE_VERIFICATION', 'DISCREPANCY_OPEN', 'FULLY_RECONCILED'].includes(checklist.reconciliation_status)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
            <span className="block font-bold text-[10px] uppercase text-gray-500">Stage 3</span>
            Tech Site Completion
          </div>
          <div className={`p-2.5 rounded-xl border font-medium ${
            ['PENDING_STORE_VERIFICATION', 'DISCREPANCY_OPEN', 'FULLY_RECONCILED'].includes(checklist.reconciliation_status)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
            <span className="block font-bold text-[10px] uppercase text-gray-500">Stage 4</span>
            Returns Declared
          </div>
          <div className={`p-2.5 rounded-xl border font-medium ${
            ['DISCREPANCY_OPEN', 'FULLY_RECONCILED'].includes(checklist.reconciliation_status)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
            <span className="block font-bold text-[10px] uppercase text-gray-500">Stage 5</span>
            Store Verified Returns
          </div>
          <div className={`p-2.5 rounded-xl border font-medium ${
            checklist.reconciliation_status === 'FULLY_RECONCILED'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : checklist.reconciliation_status === 'DISCREPANCY_OPEN'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
            <span className="block font-bold text-[10px] uppercase text-gray-500">Stage 6 & 7</span>
            Reconciled
          </div>
        </div>
      </div>

      {/* PRINTABLE / IMAGE DOCUMENT CONTAINER */}
      <div
        id="printable-checklist-document"
        ref={documentRef}
        className="bg-white p-8 sm:p-10 rounded-2xl shadow-md border border-gray-200 space-y-8 text-gray-900 font-sans"
        style={{ minWidth: '320px' }}
      >
        {/* BRANDING HEADER */}
        <div className="border-b-2 border-navy/20 pb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/logo.png"
              alt="Eagle Eye Safdrive"
              className="h-14 w-auto object-contain"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-navy tracking-tight uppercase">
                EAGLE EYE / SAFDRIVE
              </h1>
              <p className="text-xs font-bold text-blue-700 tracking-wider uppercase">
                INSTALLATION INITIATION CHECKLIST
              </p>
              <p className="text-[11px] text-gray-500">Advanced Vehicle Telematics & Camera Systems</p>
            </div>
          </div>

          <div className="sm:text-right bg-blue-50/70 p-3.5 rounded-xl border border-blue-100 shrink-0">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Checklist Number</div>
            <div className="text-base font-black font-mono text-navy">{checklist.checklist_number}</div>
            <div className="text-[11px] text-gray-600 mt-1">
              Date: <strong className="text-gray-900">{formatDate(checklist.created_at)}</strong>
            </div>
          </div>
        </div>

        {/* SUMMARY BADGES */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-xl border border-gray-100 text-xs">
          <div>
            <span className="text-gray-500 text-[11px] block">Installation / Service</span>
            <span className="font-bold text-blue-900">{checklist.installation_or_service}</span>
          </div>
          <div>
            <span className="text-gray-500 text-[11px] block">Installation Status</span>
            <span className="font-bold text-emerald-800">{checklist.installation_status}</span>
          </div>
          <div>
            <span className="text-gray-500 text-[11px] block">Payment Status</span>
            <span className="font-bold text-amber-800">{checklist.payment_status}</span>
          </div>
          <div>
            <span className="text-gray-500 text-[11px] block">Confirmed Price</span>
            <span className="font-bold text-navy font-mono">{formatCurrency(checklist.confirmed_price)}</span>
          </div>
        </div>

        {/* SECTION 1: 1. CLIENT DETAILS */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <User size={15} className="text-blue-600" />
            1. CLIENT DETAILS
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Client Name</span>
              <span className="font-bold text-gray-900 text-sm">{checklist.client_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Client Mobile Number</span>
              <span className="font-bold text-gray-900 text-sm font-mono">{checklist.client_mobile}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Client Location</span>
              <span className="font-bold text-gray-900 flex items-center gap-1">
                <MapPin size={13} className="text-blue-600" />
                {checklist.client_location || '—'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Google Maps Location</span>
              {checklist.google_maps_location ? (
                <a
                  href={checklist.google_maps_location}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-600 hover:underline font-mono text-[11px] flex items-center gap-1 truncate"
                >
                  <ExternalLink size={12} />
                  {checklist.google_maps_location}
                </a>
              ) : (
                <span className="font-medium text-gray-400">Not provided</span>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 2: 2. DEVICE DETAILS & EXTRA DEVICE DETAILS */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <HardDrive size={15} className="text-blue-600" />
            2. DEVICE DETAILS
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Type of Device</span>
              <span className="font-bold text-gray-900">{checklist.device_type}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Number of Devices</span>
              <span className="font-bold text-gray-900">{checklist.number_of_devices}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Number of Vehicles</span>
              <span className="font-bold text-gray-900">{checklist.number_of_vehicles}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Extra Devices to be Carried?</span>
              <span className="font-bold text-blue-700">{checklist.extra_devices ? 'Yes' : 'No'}</span>
            </div>

            {checklist.extra_devices && (
              <>
                <div className="col-span-2 sm:col-span-2">
                  <span className="text-gray-500 block text-[11px]">Type of Extra Device</span>
                  <span className="font-bold text-gray-900">{checklist.extra_device_type || '—'}</span>
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <span className="text-gray-500 block text-[11px]">Number of Extra Devices to be Carried</span>
                  <span className="font-bold text-gray-900">{checklist.extra_device_count || '—'}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* SECTION 3: 3. PRICING & PAYMENT */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <CreditCard size={15} className="text-blue-600" />
            3. PRICING & PAYMENT DETAILS
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Confirmed Price with Client</span>
              <span className="font-bold text-navy font-mono text-sm">{formatCurrency(checklist.confirmed_price)}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Payment Method</span>
              <span className="font-bold text-gray-900">{checklist.payment_method || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Advance Received?</span>
              <span className="font-bold text-gray-900">
                {checklist.advance_received ? `Yes (${formatCurrency(checklist.advance_amount)})` : 'No'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Pending Payment?</span>
              <span className="font-bold text-gray-900">
                {checklist.pending_payment ? `Yes (${formatCurrency(checklist.pending_amount)})` : 'No'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Advance Amount Received</span>
              <span className="font-bold text-emerald-700 font-mono">
                {checklist.advance_received ? formatCurrency(checklist.advance_amount) : '₹0'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Pending Payment Amount</span>
              <span className="font-bold text-rose-700 font-mono">
                {checklist.pending_payment ? formatCurrency(checklist.pending_amount) : '₹0'}
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 4: 4. INSTALLATION DETAILS */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <Calendar size={15} className="text-blue-600" />
            4. INSTALLATION DETAILS
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Installation Duration</span>
              <span className="font-bold text-gray-900">{checklist.installation_duration || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Vehicle Type</span>
              <span className="font-bold text-gray-900">{checklist.vehicle_type || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Installation or Service</span>
              <span className="font-bold text-gray-900">{checklist.installation_or_service}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Expected Date of Arrival at Client Place</span>
              <span className="font-bold text-gray-900">{formatDate(checklist.expected_arrival_date)}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Expected Time of Arrival at Client Place</span>
              <span className="font-bold text-gray-900 font-mono">{checklist.expected_arrival_time || '—'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 5: 5. INSTALLATION TEAM */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <Users size={15} className="text-blue-600" />
            5. INSTALLATION TEAM
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Team Member 1 – Service Engineer</span>
              <span className="font-bold text-gray-900">{checklist.service_engineer || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Team Member 2 – Service Assistant</span>
              <span className="font-bold text-gray-900">{checklist.service_assistant || '—'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 6: 6. FINAL CONFIRMATION */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
            <CheckSquare size={15} className="text-blue-600" />
            6. FINAL CONFIRMATION
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div>
              <span className="text-gray-500 block text-[11px]">Installation Status</span>
              <span className="font-bold text-blue-900">{checklist.installation_status}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Payment Status</span>
              <span className="font-bold text-amber-800">{checklist.payment_status}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Client Confirmation</span>
              <span className={`font-bold ${checklist.client_confirmation === 'Confirmed' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {checklist.client_confirmation}
              </span>
            </div>
          </div>
        </div>

        {/* REMARKS & NOTES */}
        {checklist.remarks && (
          <div className="space-y-3">
            <h3 className="text-xs font-black text-navy uppercase tracking-wider pb-1 border-b border-gray-200 flex items-center gap-2">
              <FileText size={15} className="text-blue-600" />
              REMARKS
            </h3>
            <div className="text-xs bg-gray-50/50 p-4 rounded-xl border border-gray-100 text-gray-800 leading-relaxed font-mono whitespace-pre-wrap">
              {checklist.remarks}
            </div>
          </div>
        )}

        {/* FOOTER & SIGNATURE STAMP */}
        <div className="pt-6 border-t border-gray-200 flex items-center justify-between text-[11px] text-gray-500">
          <div>
            <p className="font-bold text-navy">EAGLE EYE SAFDRIVE MANAGEMENT</p>
            <p className="text-[10px]">Official Installation Initiation Record • Confidential</p>
          </div>
          <div className="text-right">
            <div className="w-32 border-b border-gray-400 mb-1" />
            <p className="font-semibold text-gray-700">Authorized Signature</p>
          </div>
        </div>
      </div>

      {/* WORKFLOW STAGE 2: STORE ISSUE MODAL */}
      {showIssueModal && (
        <IssueStockModal
          checklist={checklist}
          token={token}
          onClose={() => setShowIssueModal(false)}
          onSuccess={() => {
            setShowIssueModal(false);
            showToast('Stock issued successfully!');
            fetchInstallationChecklistDetail(token, checklistId).then(setChecklist);
          }}
        />
      )}

      {/* WORKFLOW STAGE 3: TECHNICAL REPORT MODAL */}
      {showTechModal && (
        <TechReportModal
          checklist={checklist}
          token={token}
          onClose={() => setShowTechModal(false)}
          onSuccess={() => {
            setShowTechModal(false);
            showToast('Technical report submitted!');
            fetchInstallationChecklistDetail(token, checklistId).then(setChecklist);
          }}
        />
      )}

      {/* WORKFLOW STAGE 4: DECLARE RETURN MODAL */}
      {showReturnModal && (
        <DeclareReturnModal
          checklist={checklist}
          token={token}
          onClose={() => setShowReturnModal(false)}
          onSuccess={() => {
            setShowReturnModal(false);
            showToast('Return declaration submitted to Store Manager!');
            fetchInstallationChecklistDetail(token, checklistId).then(setChecklist);
          }}
        />
      )}

      {/* WORKFLOW STAGE 5: VERIFY STORE RETURN MODAL */}
      {showVerifyModal && (
        <VerifyReturnModal
          checklist={checklist}
          token={token}
          onClose={() => setShowVerifyModal(false)}
          onSuccess={() => {
            setShowVerifyModal(false);
            showToast('Store return physically verified!');
            fetchInstallationChecklistDetail(token, checklistId).then(setChecklist);
          }}
        />
      )}

      {/* WORKFLOW STAGE 6: ADMIN RESOLVE DISCREPANCY MODAL */}
      {showDiscModal && (
        <ResolveDiscModal
          checklist={checklist}
          token={token}
          onClose={() => setShowDiscModal(false)}
          onSuccess={() => {
            setShowDiscModal(false);
            showToast('Discrepancy resolved!');
            fetchInstallationChecklistDetail(token, checklistId).then(setChecklist);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   WORKFLOW MODAL SUB-COMPONENTS
   ============================================================ */

function IssueStockModal({ checklist, token, onClose, onSuccess }) {
  const [qty, setQty] = useState(checklist.number_of_devices || 1);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/installations/${checklist.id}/issue-stock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_type: checklist.device_type,
          quantity: parseInt(qty, 10),
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to issue stock');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-navy flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-600" /> Store Manager: Issue Stock (Stage 2)
        </h3>
        <p className="text-xs text-gray-500">
          Check inventory and issue physical devices for job {checklist.checklist_number}.
        </p>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Requested Device Type</label>
            <input type="text" value={checklist.device_type} disabled className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-700 font-semibold" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Actual Quantity to Issue</label>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Store Dispatch Notes</label>
            <textarea
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Serial numbers or dispatch box details..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Deducting Stock...' : 'Confirm Stock Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TechReportModal({ checklist, token, onClose, onSuccess }) {
  const [form, setForm] = useState({
    devices_carried_qty: checklist.number_of_devices || 1,
    devices_installed_qty: checklist.number_of_devices || 1,
    devices_unused_qty: 0,
    devices_damaged_qty: 0,
    devices_missing_qty: 0,
    completion_status: 'Completed',
    remarks: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/installations/${checklist.id}/technical-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit technical report');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-navy flex items-center gap-2">
          <Wrench className="w-5 h-5 text-purple-600" /> Technical Team: Site Completion Report (Stage 3)
        </h3>
        <p className="text-xs text-gray-500">Record actual devices carried, installed, unused, damaged, or missing at client site.</p>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Carried Quantity</label>
              <input type="number" min="0" value={form.devices_carried_qty} onChange={(e) => setForm({ ...form, devices_carried_qty: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" required />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Installed Quantity</label>
              <input type="number" min="0" value={form.devices_installed_qty} onChange={(e) => setForm({ ...form, devices_installed_qty: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" required />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Unused (Return)</label>
              <input type="number" min="0" value={form.devices_unused_qty} onChange={(e) => setForm({ ...form, devices_unused_qty: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Damaged</label>
              <input type="number" min="0" value={form.devices_damaged_qty} onChange={(e) => setForm({ ...form, devices_damaged_qty: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Missing</label>
              <input type="number" min="0" value={form.devices_missing_qty} onChange={(e) => setForm({ ...form, devices_missing_qty: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1">Completion Status</label>
            <select value={form.completion_status} onChange={(e) => setForm({ ...form, completion_status: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm font-semibold">
              <option value="Completed">Completed</option>
              <option value="In Progress">In Progress</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1">Technician Site Remarks</label>
            <textarea rows="2" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Installation notes or site issues encountered..." className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {loading ? 'Submitting...' : 'Submit Tech Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeclareReturnModal({ checklist, token, onClose, onSuccess }) {
  const [qty, setQty] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/installations/${checklist.id}/declare-return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_type: checklist.device_type,
          declared_return_qty: parseInt(qty, 10),
          remarks,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to declare returns');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-navy flex items-center gap-2">
          <ArrowLeft className="w-5 h-5 text-indigo-600" /> Technical Team: Declare Unused Returns (Stage 4)
        </h3>
        <p className="text-xs text-gray-500">Declare unused items to be returned to store. (Pending Store Physical Verification).</p>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Declared Return Quantity</label>
            <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" required />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Return Condition Remarks</label>
            <textarea rows="2" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Condition of returned devices..." className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Submitting...' : 'Declare Returns'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VerifyReturnModal({ checklist, token, onClose, onSuccess }) {
  const [returnRecord, setReturnRecord] = useState(null);
  const [acceptedQty, setAcceptedQty] = useState(0);
  const [damagedQty, setDamagedQty] = useState(0);
  const [missingQty, setMissingQty] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Fetch pending return for this checklist
    fetch('/api/admin/inventory/discrepancies', { headers: { Authorization: `Bearer ${token}` } })
      .then(() => fetch(`/api/admin/installations/${checklist.id}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then((res) => res.json())
      .then((data) => {
        if (data.returns && data.returns.length > 0) {
          const latest = data.returns[0];
          setReturnRecord(latest);
          setAcceptedQty(latest.declared_return_qty || 0);
        } else {
          setReturnRecord({ id: null, declared_return_qty: 0, device_type: checklist.device_type });
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [checklist.id, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!returnRecord?.id) {
      setError('No return declaration record found to verify. Please ask Technical team to declare returns first.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/admin/installations/${checklist.id}/verify-return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          return_id: returnRecord.id,
          accepted_usable_qty: parseInt(acceptedQty, 10) || 0,
          damaged_qty: parseInt(damagedQty, 10) || 0,
          missing_qty: parseInt(missingQty, 10) || 0,
          remarks,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify store return');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-navy flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" /> Store Manager: Physical Return Verification (Stage 5)
        </h3>
        <p className="text-xs text-gray-500">Physically inspect returned devices. Only usable returned stock is credited back to inventory.</p>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

        {loading ? (
          <p className="text-xs text-gray-400 text-center py-4">Fetching declared return record...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {returnRecord && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <span className="font-semibold text-blue-900 block">Declared Return by Tech:</span>
                <span className="text-sm font-bold text-blue-700">{returnRecord.declared_return_qty} units of {returnRecord.device_type}</span>
              </div>
            )}

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Accepted Usable Quantity (Credits Usable Stock)</label>
              <input type="number" min="0" value={acceptedQty} onChange={(e) => setAcceptedQty(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm text-emerald-700 font-bold" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Damaged Quantity</label>
                <input type="number" min="0" value={damagedQty} onChange={(e) => setDamagedQty(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm text-red-600 font-bold" />
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Missing Quantity</label>
                <input type="number" min="0" value={missingQty} onChange={(e) => setMissingQty(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm text-amber-600 font-bold" />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Verification Remarks</label>
              <textarea rows="2" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Physical inspection report..." className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {submitting ? 'Verifying...' : 'Verify & Credit Usable Stock'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ResolveDiscModal({ checklist, token, onClose, onSuccess }) {
  const [discId, setDiscId] = useState(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/inventory/discrepancies', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        const item = (data || []).find((d) => d.checklist_id === checklist.id && d.status === 'OPEN');
        if (item) setDiscId(item.id);
      })
      .catch((err) => console.error(err));
  }, [checklist.id, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!discId) {
      setError('No open discrepancy record found for this checklist.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/installations/${checklist.id}/resolve-discrepancy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          discrepancy_id: discId,
          resolution_notes: notes,
          status: 'RESOLVED_ADMIN_APPROVED',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve discrepancy');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-navy flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" /> Admin: Resolve Discrepancy (Stage 6)
        </h3>
        <p className="text-xs text-gray-500">Review open inventory discrepancy and log authorized resolution notes.</p>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Resolution Explanation / Audit Notes *</label>
            <textarea
              rows="3"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain why the discrepancy occurred and authorized adjustment..."
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {loading ? 'Resolving...' : 'Approve & Reconcile Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

