import { useState, useEffect } from 'react';
import {
  X,
  Bus,
  Calendar,
  Clock,
  MapPin,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Ticket,
  Eye,
} from 'lucide-react';
import { submitTechnicianReturnTicketApi, uploadTicketReceiptApi } from '../../lib/api';

export default function TechnicianReturnTicketModal({
  isOpen,
  onClose,
  task,
  token,
  onSuccess,
}) {
  const [method, setMethod] = useState('Government bus');
  const [bookingDate, setBookingDate] = useState('');
  const [travelDatetime, setTravelDatetime] = useState('');
  const [boardingPoint, setBoardingPoint] = useState('');
  const [destination, setDestination] = useState('');
  const [operator, setOperator] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (task) {
      const b = task.coordinator_booking || task;
      setMethod(b.return_method || 'Government bus');
      setBookingDate(b.return_booking_date || new Date().toISOString().split('T')[0]);

      // Format datetime-local
      let depIso = b.return_departure_datetime || '';
      if (depIso && depIso.includes('T')) {
        depIso = depIso.slice(0, 16);
      }
      setTravelDatetime(depIso);

      setBoardingPoint(b.return_boarding_point || b.return_origin || task.client_location || '');
      setDestination(b.return_destination || 'Base Office');
      setOperator(b.return_operator || '');
      setTicketRef(b.return_ticket_reference || '');
      setNotes(b.return_notes || '');
      setAttachmentUrl(b.return_attachment_url || '');
      setAttachmentName(b.return_attachment_name || '');
      setSelectedFile(null);
      setError('');
    }
  }, [task]);

  if (!isOpen || !task) return null;

  const isCorrection = task.return_status === 'Needs Correction';
  const isViewOnly = task.return_status === 'Verified/Completed' || task.return_status === 'Submitted for Verification';

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must not exceed 10MB');
      return;
    }

    setSelectedFile(file);
    setAttachmentName(file.name);
    setError('');

    // Pre-upload or convert to data URL for preview
    setUploadingFile(true);
    try {
      const uploadRes = await uploadTicketReceiptApi(token, file, task.checklist_id);
      if (uploadRes?.attachment_url) {
        setAttachmentUrl(uploadRes.attachment_url);
        setAttachmentName(uploadRes.attachment_name || file.name);
      }
    } catch (err) {
      console.warn('Direct upload error, reading local preview:', err.message);
      const reader = new FileReader();
      reader.onload = () => {
        setAttachmentUrl(reader.result);
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!travelDatetime) {
      setError('Please select the travel departure date and time.');
      return;
    }
    if (!boardingPoint.trim()) {
      setError('Please enter the departure / boarding point.');
      return;
    }
    if (!destination.trim()) {
      setError('Please enter the destination.');
      return;
    }
    if (!operator.trim()) {
      setError('Please enter the operator or travel service name.');
      return;
    }

    setLoading(true);

    try {
      let finalAttachmentUrl = attachmentUrl;
      let finalAttachmentName = attachmentName;

      // If user selected file but hasn't uploaded yet
      if (selectedFile && !finalAttachmentUrl) {
        setUploadingFile(true);
        const upRes = await uploadTicketReceiptApi(token, selectedFile, task.checklist_id);
        finalAttachmentUrl = upRes.attachment_url;
        finalAttachmentName = upRes.attachment_name;
      }

      const payload = {
        return_method: method,
        return_booking_date: bookingDate,
        return_departure_datetime: travelDatetime,
        return_boarding_point: boardingPoint.trim(),
        return_destination: destination.trim(),
        return_operator: operator.trim(),
        return_ticket_reference: ticketRef.trim(),
        return_notes: notes.trim(),
        return_attachment_url: finalAttachmentUrl,
        return_attachment_name: finalAttachmentName,
      };

      await submitTechnicianReturnTicketApi(token, task.checklist_id, payload);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to submit return ticket details:', err);
      setError(err.message || 'Failed to submit return ticket details. Please try again.');
    } finally {
      setLoading(false);
      setUploadingFile(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-8 border border-gray-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-purple-900 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-md">
              <Ticket className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Return Journey Ticket Booking</span>
                {isCorrection && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500 text-white uppercase tracking-wider">
                    Needs Correction
                  </span>
                )}
                {isViewOnly && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500 text-white uppercase tracking-wider">
                    {task.return_status}
                  </span>
                )}
              </h2>
              <p className="text-xs text-indigo-200 mt-0.5">
                Checklist: <strong className="text-white font-mono">{task.checklist_number}</strong> • {task.client_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs text-gray-700 flex-1">
          {/* Correction Reason Alert */}
          {isCorrection && task.return_correction_reason && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-900">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-xs">Coordinator Requested Corrections:</h4>
                <p className="mt-1 text-xs text-rose-800 leading-relaxed font-medium">
                  "{task.return_correction_reason}"
                </p>
                {task.return_correction_requested_at && (
                  <span className="text-[10px] text-rose-600 block mt-1">
                    Requested on: {new Date(task.return_correction_requested_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Job Overview Card */}
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500 font-medium">Customer Site / Location:</span>
              <span className="font-bold text-gray-900 flex items-center gap-1">
                <MapPin size={12} className="text-indigo-600" />
                {task.client_location || 'Customer Site'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500 font-medium">Installation Completion Time:</span>
              <span className="font-semibold text-gray-800 flex items-center gap-1">
                <Clock size={12} className="text-emerald-600" />
                {task.actual_completion_datetime
                  ? new Date(task.actual_completion_datetime).toLocaleString()
                  : 'Site Work Completed'}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Travel Method Selection */}
          <div className="space-y-2">
            <label className="block font-bold text-gray-800 text-xs">
              Return Travel Method <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'Government bus', label: 'Government Bus', desc: 'KSRTC, SETC, APSRTC, etc.' },
                { id: 'Private travels', label: 'Private Travels', desc: 'Private Sleeper / Semi-Sleeper coach' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isViewOnly}
                  onClick={() => setMethod(opt.id)}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                    method === opt.id
                      ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <Bus size={16} className={method === opt.id ? 'text-indigo-600 shrink-0 mt-0.5' : 'text-gray-400 shrink-0 mt-0.5'} />
                  <div>
                    <div className="font-bold text-xs text-gray-900">{opt.label}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Dates Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Booking Date
              </label>
              <input
                type="date"
                disabled={isViewOnly}
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Travel Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                disabled={isViewOnly}
                value={travelDatetime}
                onChange={(e) => setTravelDatetime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                required
              />
            </div>
          </div>

          {/* Boarding Point & Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Boarding Point <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={isViewOnly}
                value={boardingPoint}
                onChange={(e) => setBoardingPoint(e.target.value)}
                placeholder="e.g. Majestic Bus Station, Gandhinagar"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Destination <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={isViewOnly}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Chennai Central / Base Office"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                required
              />
            </div>
          </div>

          {/* Operator & Ticket/PNR */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Operator / Service Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={isViewOnly}
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="e.g. KSRTC Airavat, SRS Travels, VRL"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-gray-700 text-xs mb-1">
                Ticket / PNR Number <span className="text-gray-400 font-normal">(if available)</span>
              </label>
              <input
                type="text"
                disabled={isViewOnly}
                value={ticketRef}
                onChange={(e) => setTicketRef(e.target.value)}
                placeholder="e.g. PNR-98218392"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Ticket Receipt Upload */}
          <div className="space-y-1.5">
            <label className="block font-bold text-gray-700 text-xs">
              Upload Ticket / Receipt <span className="text-gray-400 font-normal">(Image or PDF)</span>
            </label>
            {!isViewOnly && (
              <div className="flex items-center gap-3">
                <label className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl border border-gray-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition">
                  <Upload size={14} />
                  <span>Choose Ticket File</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {uploadingFile && (
                  <span className="text-xs text-indigo-600 flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Uploading...
                  </span>
                )}
                {attachmentName && (
                  <span className="text-xs text-gray-600 font-medium truncate max-w-xs flex items-center gap-1">
                    <FileText size={12} className="text-indigo-600 shrink-0" />
                    {attachmentName}
                  </span>
                )}
              </div>
            )}

            {attachmentUrl && (
              <div className="mt-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-700 font-semibold">
                  <FileText size={14} className="text-indigo-600" />
                  <span>{attachmentName || 'Ticket Attachment'}</span>
                </div>
                <a
                  href={attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg flex items-center gap-1 transition"
                >
                  <Eye size={12} />
                  <span>View Ticket</span>
                </a>
              </div>
            )}
          </div>

          {/* Booking Notes */}
          <div>
            <label className="block font-bold text-gray-700 text-xs mb-1">
              Booking Notes / Details <span className="text-gray-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              disabled={isViewOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Seat 12 Lower Sleeper, Boarding at Platform 4"
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-gray-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl text-xs hover:bg-gray-50 transition"
            >
              Close
            </button>
            {!isViewOnly && (
              <button
                type="submit"
                disabled={loading || uploadingFile}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-extrabold text-xs rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Submitting for Verification...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>{isCorrection ? 'Resubmit Corrected Details' : 'Submit for Coordinator Verification'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
