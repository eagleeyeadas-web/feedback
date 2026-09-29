import { useState } from 'react';
import { CheckCircle2, Download, FileText, Copy, Check, RotateCcw } from 'lucide-react';
import { getFeedbackPDFUrl } from '../lib/api';

export default function SuccessPage({ feedbackId, onReset }) {
  const [copied, setCopied] = useState(false);

  const handleDownload = () => {
    const url = getFeedbackPDFUrl(feedbackId);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EagleEye_Feedback_${feedbackId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyId = () => {
    if (feedbackId) {
      navigator.clipboard.writeText(feedbackId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-6 sm:p-10 text-center animate-slide-up relative overflow-hidden">
        {/* Top Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-navy via-navy-light to-red-accent" />

        {/* Company Logo */}
        <div className="flex justify-center mb-6">
          <img
            src="/logo.png"
            alt="Eagle Eye SafDrive Logo"
            className="h-16 sm:h-20 w-auto object-contain"
          />
        </div>

        {/* Success Animated Badge */}
        <div className="w-20 h-20 bg-green-100/80 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner animate-pulse-glow">
          <CheckCircle2 size={48} className="text-green-600 stroke-[2.2]" />
        </div>

        {/* Thank You Title */}
        <h2 className="text-2xl sm:text-3xl font-extrabold text-navy tracking-tight mb-2">
          Thank You!
        </h2>
        <p className="text-sm sm:text-base font-semibold text-green-700 mb-3">
          Feedback Submitted Successfully!
        </p>

        {/* Corporate Message */}
        <p className="text-xs sm:text-sm text-gray-600 leading-relaxed max-w-md mx-auto mb-6">
          We sincerely appreciate your valuable feedback. Your responses have been securely stored in our system to help <strong>EAGLE EYE SAFDRIVE PVT LTD</strong> deliver safer, higher quality vehicle safety &amp; fleet solutions.
        </p>

        {/* Feedback ID Confirmation Card */}
        <div className="bg-gray-50 border border-gray-200/80 rounded-2xl p-4.5 mb-6 text-left shadow-xs relative">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={15} className="text-navy" />
              Reference Feedback ID
            </span>
            <button
              type="button"
              onClick={handleCopyId}
              className="flex items-center gap-1 text-[11px] font-semibold text-navy hover:text-red-accent px-2 py-1 rounded bg-white border border-gray-200 transition-all cursor-pointer"
              title="Copy Feedback ID"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>

          <div className="bg-white rounded-xl p-3 border border-gray-200 flex items-center justify-between">
            <p className="text-lg sm:text-xl font-bold text-navy tracking-wider font-mono">
              {feedbackId}
            </p>
            <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200">
              ✓ Saved &amp; Verified
            </span>
          </div>

          <p className="text-[11px] text-gray-400 mt-2 text-center">
            Save this ID for your records or future reference.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 bg-navy hover:bg-navy-light
                       text-white font-bold py-3.5 px-5 rounded-xl transition-all duration-200
                       shadow-md hover:shadow-lg active:scale-[0.98] cursor-pointer text-sm"
          >
            <Download size={18} />
            Download PDF Copy
          </button>

          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400
                         text-gray-700 font-semibold py-3.5 px-4 rounded-xl transition-all duration-200
                         hover:bg-gray-50 cursor-pointer text-sm"
            >
              <RotateCcw size={16} />
              Submit Another
            </button>
          )}
        </div>

        {/* Footer Slogan */}
        <div className="mt-8 pt-5 border-t border-gray-100 flex flex-col items-center gap-1">
          <p className="text-xs font-semibold text-gray-500">
            EAGLE EYE SAFDRIVE PVT LTD
          </p>
          <p className="text-xs font-bold text-navy italic">
            Safer Vehicles, Safer Roads.
          </p>
        </div>
      </div>
    </div>
  );
}
