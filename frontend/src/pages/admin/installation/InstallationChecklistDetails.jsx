import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { fetchInstallationChecklistDetail } from '../../../lib/api';
import { toPng } from 'html-to-image';
import {
  ArrowLeft,
  Edit,
  Printer,
  Image as ImageIcon,
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
} from 'lucide-react';

export default function InstallationChecklistDetails({ id: propId, onEdit, onBack }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const routeParams = useParams();
  const [searchParams] = useSearchParams();

  const checklistId = propId || routeParams.id;
  const documentRef = useRef(null);

  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

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
  }, [token, checklistId, searchParams]);

  useEffect(() => {
    if (checklist && searchParams.get('action') === 'download') {
      setTimeout(() => {
        handleDownloadImage();
      }, 600);
    }
  }, [checklist]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDownloadImage = async () => {
    if (!documentRef.current || !checklist) return;
    setDownloadingImage(true);
    try {
      // High-quality PNG generation with html-to-image
      const dataUrl = await toPng(documentRef.current, {
        quality: 0.98,
        pixelRatio: 2, // 2x Retina resolution for sharp text
        backgroundColor: '#ffffff',
        cacheBust: true,
      });

      const link = document.createElement('a');
      const filename = `EagleEye-Installation-${checklist.checklist_number}.png`;
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast(`Image downloaded: ${filename}`);
    } catch (err) {
      console.error('Image generation error:', err);
      alert('Failed to generate PNG image. Please try again.');
    } finally {
      setDownloadingImage(false);
    }
  };

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
          <button
            onClick={handleEditClick}
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <Edit size={15} />
            <span>Edit</span>
          </button>

          <button
            onClick={handleDownloadImage}
            disabled={downloadingImage}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            <ImageIcon size={15} />
            <span>{downloadingImage ? 'Generating Image...' : 'Download as Image'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-navy hover:bg-blue-900 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Printer size={15} />
            <span>Print</span>
          </button>

          <button
            onClick={handleBackClick}
            className="px-3.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            Back
          </button>
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

      {/* Bottom Actions Bar (Hidden on Print) */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between no-print">
        <button
          onClick={handleBackClick}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-navy px-4 py-2 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Back to Checklists</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleEditClick}
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <Edit size={15} />
            <span>Edit</span>
          </button>

          <button
            onClick={handleDownloadImage}
            disabled={downloadingImage}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            <ImageIcon size={15} />
            <span>{downloadingImage ? 'Generating Image...' : 'Download as Image'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-navy hover:bg-blue-900 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Printer size={15} />
            <span>Print</span>
          </button>
        </div>
      </div>
    </div>
  );
}
