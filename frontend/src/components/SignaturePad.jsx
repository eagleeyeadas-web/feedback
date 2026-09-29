import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactSignatureCanvas from 'react-signature-canvas';
import { X, Eraser, Check, Trash2, PenTool, CheckCircle2, RotateCcw } from 'lucide-react';

export default function SignaturePad({ value, onChange, error, id = "signature" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEmptyCanvas, setIsEmptyCanvas] = useState(true);
  const [canvasError, setCanvasError] = useState('');
  const sigRef = useRef(null);
  const containerRef = useRef(null);

  // Prevent background scrolling on html and body when portal modal is active
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.touchAction = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.touchAction = '';
    };
  }, [isOpen]);

  // Resize canvas resolution dynamically to match container bounds exactly
  const resizeCanvas = useCallback(() => {
    if (containerRef.current && sigRef.current) {
      const canvas = sigRef.current.getCanvas();
      const rect = containerRef.current.getBoundingClientRect();
      const savedData = !sigRef.current.isEmpty() ? sigRef.current.toDataURL() : null;

      canvas.width = rect.width;
      canvas.height = rect.height;

      if (savedData) {
        sigRef.current.fromDataURL(savedData);
        setIsEmptyCanvas(false);
      } else if (value) {
        sigRef.current.fromDataURL(value);
        setIsEmptyCanvas(false);
      } else {
        sigRef.current.clear();
        setIsEmptyCanvas(true);
      }
    }
  }, [value]);

  // Resize listener on orientation change or window resize
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      resizeCanvas();
    }, 60);

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('orientationchange', resizeCanvas);
    };
  }, [isOpen, resizeCanvas]);

  const handleOpenModal = () => {
    setCanvasError('');
    setIsOpen(true);
  };

  const handleCancelModal = () => {
    setIsOpen(false);
    setCanvasError('');
  };

  const handleClearCanvas = () => {
    if (sigRef.current) {
      sigRef.current.clear();
      setIsEmptyCanvas(true);
      setCanvasError('');
    }
  };

  const handleRemoveSignature = () => {
    if (sigRef.current) {
      sigRef.current.clear();
    }
    onChange('');
    setIsEmptyCanvas(true);
  };

  const handleConfirmSignature = () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setCanvasError('Please draw your signature before confirming.');
      return;
    }

    try {
      const trimmedCanvas = sigRef.current.getTrimmedCanvas();
      const dataUrl = trimmedCanvas.toDataURL('image/png');
      onChange(dataUrl);
      setIsOpen(false);
      setCanvasError('');
    } catch {
      const dataUrl = sigRef.current.toDataURL('image/png');
      onChange(dataUrl);
      setIsOpen(false);
      setCanvasError('');
    }
  };

  // React Portal Modal Element rendered directly into document.body
  const modalPortal = isOpen ? createPortal(
    <div
      className="fixed inset-0 z-[999999] bg-white flex flex-col w-screen h-[100dvh] overflow-hidden select-none"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 999999,
        background: '#FFFFFF',
        overflow: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* ===== TOP SECTION ===== */}
      <div className="h-14 sm:h-16 px-4 bg-white border-b border-gray-200 flex items-center justify-between shadow-xs z-20 shrink-0">
        <button
          type="button"
          onClick={handleCancelModal}
          className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-gray-700 hover:text-navy hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
        >
          <X size={22} />
          <span>Close</span>
        </button>

        <h3 className="text-base sm:text-lg font-bold text-navy text-center">
          Customer Signature
        </h3>

        <button
          type="button"
          onClick={handleClearCanvas}
          className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
        >
          <Eraser size={18} />
          <span>Clear</span>
        </button>
      </div>

      {/* ===== MIDDLE SECTION (CANVAS AREA) ===== */}
      <div className="flex-1 relative bg-white p-3 sm:p-5 flex flex-col justify-center items-center overflow-hidden">
        <div
          ref={containerRef}
          className="relative w-full h-full border border-gray-300 rounded-xl bg-white shadow-xs flex items-center justify-center overflow-hidden"
          style={{ touchAction: 'none' }}
        >
          <ReactSignatureCanvas
            ref={sigRef}
            canvasProps={{
              className: 'w-full h-full cursor-crosshair',
              style: { touchAction: 'none' },
            }}
            penColor="#000000"
            minWidth={2}
            maxWidth={4.5}
            velocityFilterWeight={0.7}
            onBegin={() => {
              setIsEmptyCanvas(false);
              setCanvasError('');
            }}
          />
        </div>

        {canvasError && (
          <div className="mt-2 text-xs sm:text-sm text-red-600 font-semibold bg-red-50 border border-red-200 px-3 py-1.5 rounded-md">
            {canvasError}
          </div>
        )}
      </div>

      {/* ===== BOTTOM SECTION ===== */}
      <div className="h-16 sm:h-20 px-4 sm:px-6 bg-white border-t border-gray-200 flex items-center justify-between shadow-md z-20 shrink-0">
        <button
          type="button"
          onClick={handleCancelModal}
          className="px-4 sm:px-5 py-2.5 sm:py-3 border border-gray-300 hover:border-gray-400 text-gray-700 text-sm font-semibold rounded-xl transition-all cursor-pointer"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleConfirmSignature}
          className="flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 bg-red-accent hover:bg-red-hover text-white text-sm sm:text-base font-bold rounded-xl shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95"
        >
          <Check size={20} />
          <span>Confirm Signature</span>
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div id={id}>
      {/* ===== CASE 1: SIGNATURE PREVIEW (Signature exists) ===== */}
      {value ? (
        <div className="border border-green-200 bg-green-50/40 rounded-xl p-4 transition-all duration-200 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
              <CheckCircle2 size={18} className="text-green-600" />
              Digital Signature Captured
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenModal}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-navy text-navy bg-white hover:bg-navy hover:text-white transition-all duration-200 cursor-pointer"
              >
                <RotateCcw size={14} />
                Re-sign Signature
              </button>
              <button
                type="button"
                onClick={handleRemoveSignature}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-all duration-200 cursor-pointer"
                title="Remove signature"
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg p-3 border border-gray-200 flex items-center justify-center min-h-[100px]">
            <img
              src={value}
              alt="Customer Signature Preview"
              className="max-h-24 max-w-full object-contain"
            />
          </div>
        </div>
      ) : (
        /* ===== CASE 2: NO SIGNATURE YET ===== */
        <div className="border-2 border-dashed border-gray-300 bg-gray-50/50 hover:bg-gray-50 rounded-xl p-5 text-center transition-all duration-200">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-navy/10 text-navy flex items-center justify-center">
              <PenTool size={24} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-navy mb-1">
                Digital Signature Required
              </h4>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                Please add your signature to confirm customer verification &amp; feedback submission.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenModal}
              className="mt-1 flex items-center gap-2 px-5 py-2.5 bg-navy text-white text-sm font-semibold rounded-lg hover:bg-navy-light shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer"
            >
              <PenTool size={16} />
              Add Digital Signature
            </button>
          </div>
        </div>
      )}

      {/* Validation error message if signature is missing on submit */}
      {error && !value && (
        <p className="form-error mt-2 text-xs text-red-600 font-medium flex items-center gap-1">
          <span>⚠️</span> {error}
        </p>
      )}

      {/* Render Full Screen Modal into document.body via React Portal */}
      {modalPortal}
    </div>
  );
}
