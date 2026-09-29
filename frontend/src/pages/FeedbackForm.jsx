import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Send } from 'lucide-react';
import { feedbackSchema } from '../schemas/feedbackSchema';
import { submitFeedback } from '../lib/api';
import FormField from '../components/FormField';
import StarRating from '../components/StarRating';
import SignaturePad from '../components/SignaturePad';
import Navbar from '../components/Navbar';
import SuccessPage from './SuccessPage';

export default function FeedbackForm() {
  const [submitState, setSubmitState] = useState({ status: 'idle', data: null, error: null });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      customerName: '',
      phoneNumber: '',
      companyName: '',
      email: '',
      vehicleNumber: '',
      imeiNumber: '',
      vehicleType: '',
      productService: '',
      serviceDate: '',
      technician: '',
      ratingProductQuality: 0,
      ratingInstallation: 0,
      ratingPerformance: 0,
      ratingProfessionalism: 0,
      ratingSupport: 0,
      issueResolved: undefined,
      improvementSuggestions: '',
      additionalComments: '',
      signature: '',
    },
  });

  const watchedValues = watch();

  const handleResetForm = () => {
    reset();
    setSubmitState({ status: 'idle', data: null, error: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onInvalid = useCallback((formErrors) => {
    const firstErrorKey = Object.keys(formErrors)[0];
    if (firstErrorKey) {
      const errorEl = document.getElementById(firstErrorKey) ||
                      document.querySelector(`[name="${firstErrorKey}"]`) ||
                      document.querySelector(`.form-error`);
      if (errorEl) {
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        errorEl.focus?.();
      }
    }
  }, []);

  const onSubmit = useCallback(async (data) => {
    if (submitState.status === 'loading') return;
    setSubmitState({ status: 'loading', data: null, error: null });

    try {
      const result = await submitFeedback(data);
      setSubmitState({ status: 'success', data: result, error: null });
    } catch (err) {
      setSubmitState({ status: 'error', data: null, error: err.message });
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }, [submitState.status]);

  // Show success page
  if (submitState.status === 'success' && submitState.data) {
    return (
      <SuccessPage
        feedbackId={submitState.data.feedbackId}
        onReset={handleResetForm}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 w-full overflow-y-auto">
      {/* Header */}
      <Navbar />

      {/* Form */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-20">
        <div className="text-center mb-6 flex flex-col items-center">
          <img
            src="/logo.png"
            alt="Eagle Eye SafDrive Logo"
            className="h-16 sm:h-20 w-auto object-contain mb-3 drop-shadow-xs"
          />
          <h2 className="text-xl sm:text-2xl font-bold text-navy">Customer Feedback Form</h2>
          <p className="text-sm text-gray-500 mt-1">
            Your feedback helps us improve our services
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
          {/* ====== SECTION 1: CUSTOMER & VEHICLE DETAILS ====== */}
          <div className="form-section animate-slide-up">
            <div className="section-header">Customer &amp; Vehicle Details</div>
            <div className="form-section-body grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Customer Name" required id="customerName" error={errors.customerName?.message}>
                <input
                  id="customerName"
                  type="text"
                  className="form-input"
                  placeholder="Enter full name"
                  {...register('customerName')}
                />
              </FormField>

              <FormField label="Phone Number" required id="phoneNumber" error={errors.phoneNumber?.message}>
                <input
                  id="phoneNumber"
                  type="tel"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  {...register('phoneNumber')}
                />
              </FormField>

              <FormField label="Company / Fleet Name" id="companyName" error={errors.companyName?.message}>
                <input
                  id="companyName"
                  type="text"
                  className="form-input"
                  placeholder="Optional"
                  {...register('companyName')}
                />
              </FormField>

              <FormField label="Email Address" id="email" error={errors.email?.message}>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="Optional"
                  {...register('email')}
                />
              </FormField>

              <FormField label="Vehicle Number" id="vehicleNumber" error={errors.vehicleNumber?.message}>
                <input
                  id="vehicleNumber"
                  type="text"
                  className="form-input"
                  placeholder="e.g., TN 47 AB 1234"
                  {...register('vehicleNumber')}
                />
              </FormField>

              <FormField
                label="IMEI Number"
                required
                id="imeiNumber"
                error={errors.imeiNumber?.message}
                hint="15-digit device IMEI number"
              >
                <input
                  id="imeiNumber"
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="Enter 15-digit IMEI"
                  maxLength={15}
                  {...register('imeiNumber')}
                />
              </FormField>

              <FormField
                label="Vehicle Type"
                required
                id="vehicleType"
                error={errors.vehicleType?.message}
                hint="e.g., Truck, Bus, Car, 16 Wheeler"
              >
                <input
                  id="vehicleType"
                  type="text"
                  className="form-input"
                  placeholder="Type your vehicle type"
                  {...register('vehicleType')}
                />
              </FormField>

              <FormField label="Product / Service Name" required id="productService" error={errors.productService?.message}>
                <input
                  id="productService"
                  type="text"
                  className="form-input"
                  placeholder="Enter product or service"
                  {...register('productService')}
                />
              </FormField>

              <FormField label="Service Date" required id="serviceDate" error={errors.serviceDate?.message}>
                <input
                  id="serviceDate"
                  type="date"
                  className="form-input"
                  {...register('serviceDate')}
                />
              </FormField>

              <FormField label="Technician / Representative" required id="technician" error={errors.technician?.message}>
                <input
                  id="technician"
                  type="text"
                  className="form-input"
                  placeholder="Service representative name"
                  {...register('technician')}
                />
              </FormField>
            </div>
          </div>

          {/* ====== SECTION 2: SERVICE RATINGS ====== */}
          <div className="form-section animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="section-header">Service Ratings</div>
            <div className="form-section-body space-y-1 divide-y divide-gray-100">
              <StarRating
                id="ratingProductQuality"
                label="Product Quality"
                value={watchedValues.ratingProductQuality}
                onChange={(v) => setValue('ratingProductQuality', v, { shouldValidate: true })}
                error={errors.ratingProductQuality?.message}
              />
              <StarRating
                id="ratingInstallation"
                label="Installation / Service"
                value={watchedValues.ratingInstallation}
                onChange={(v) => setValue('ratingInstallation', v, { shouldValidate: true })}
                error={errors.ratingInstallation?.message}
              />
              <StarRating
                id="ratingPerformance"
                label="Product Performance"
                value={watchedValues.ratingPerformance}
                onChange={(v) => setValue('ratingPerformance', v, { shouldValidate: true })}
                error={errors.ratingPerformance?.message}
              />
              <StarRating
                id="ratingProfessionalism"
                label="Technician Professionalism"
                value={watchedValues.ratingProfessionalism}
                onChange={(v) => setValue('ratingProfessionalism', v, { shouldValidate: true })}
                error={errors.ratingProfessionalism?.message}
              />
              <StarRating
                id="ratingSupport"
                label="Customer Support"
                value={watchedValues.ratingSupport}
                onChange={(v) => setValue('ratingSupport', v, { shouldValidate: true })}
                error={errors.ratingSupport?.message}
              />
            </div>
          </div>

          {/* ====== SECTION 3: ISSUE RESOLUTION ====== */}
          <div id="issueResolved" className="form-section animate-slide-up" style={{ animationDelay: '0.15s' }}>
            <div className="section-header">Issue Resolution</div>
            <div className="form-section-body">
              <p className="text-sm text-gray-700 mb-3 font-medium">
                Was the issue resolved to your satisfaction?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                {['Yes', 'Partially', 'No'].map((option) => (
                  <label
                    key={option}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border cursor-pointer
                      transition-all duration-200 flex-1
                      ${watchedValues.issueResolved === option
                        ? 'border-navy bg-navy/5 ring-1 ring-navy/20'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    <input
                      type="radio"
                      value={option}
                      {...register('issueResolved')}
                      className="w-4 h-4 text-navy accent-navy"
                    />
                    <span className="text-sm font-medium text-gray-700">{option}</span>
                  </label>
                ))}
              </div>
              {errors.issueResolved && (
                <p className="form-error mt-2">{errors.issueResolved.message}</p>
              )}
            </div>
          </div>

          {/* ====== SECTION 4: IMPROVEMENT SUGGESTIONS ====== */}
          <div className="form-section animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <div className="section-header">Improvement Suggestions</div>
            <div className="form-section-body">
              <p className="text-sm text-gray-700 mb-2">
                What could we improve to serve you better?
              </p>
              <textarea
                id="improvementSuggestions"
                rows={3}
                className="form-input resize-y"
                placeholder="Share your suggestions..."
                {...register('improvementSuggestions')}
              />
            </div>
          </div>

          {/* ====== SECTION 5: ADDITIONAL COMMENTS ====== */}
          <div className="form-section animate-slide-up" style={{ animationDelay: '0.25s' }}>
            <div className="section-header">Additional Comments</div>
            <div className="form-section-body">
              <p className="text-sm text-gray-700 mb-2">
                Do you have any additional comments or suggestions?
              </p>
              <textarea
                id="additionalComments"
                rows={3}
                className="form-input resize-y"
                placeholder="Any other feedback..."
                {...register('additionalComments')}
              />
            </div>
          </div>

          {/* ====== SECTION 6: DIGITAL SIGNATURE ====== */}
          <div className="form-section animate-slide-up" style={{ animationDelay: '0.3s' }}>
            <div className="section-header">Customer Digital Signature</div>
            <div className="form-section-body">
              <SignaturePad
                id="signature"
                value={watchedValues.signature}
                onChange={(dataUrl) => setValue('signature', dataUrl, { shouldValidate: true })}
                error={errors.signature?.message}
              />
            </div>
          </div>

          {/* ====== VALIDATION ERRORS SUMMARY ====== */}
          {Object.keys(errors).length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3.5 mb-4 text-xs text-amber-800 animate-fade-in">
              <p className="font-bold flex items-center gap-1.5 mb-1 text-amber-900">
                <span>⚠️</span> Please complete all required fields before submitting:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-1 text-amber-800">
                {Object.entries(errors).map(([key, err]) => (
                  <li key={key}>{err?.message || `${key} is required`}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ====== SUBMIT ====== */}
          {submitState.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">
              <strong>Error:</strong> {submitState.error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitState.status === 'loading'}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {submitState.status === 'loading' ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={18} />
                Submit Feedback
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
