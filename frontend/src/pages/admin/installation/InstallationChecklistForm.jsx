import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import {
  createInstallationChecklist,
  updateInstallationChecklist,
  fetchInstallationChecklistDetail,
} from '../../../lib/api';
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertTriangle,
  User,
  HardDrive,
  CreditCard,
  Calendar,
  Users,
  FileText,
  MapPin,
  Link as LinkIcon,
  HelpCircle,
  CheckSquare,
} from 'lucide-react';

const DEVICE_OPTIONS = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

const VEHICLE_OPTIONS = ['Lorry', 'Truck', 'Bus', 'Heavy Vehicle', 'Other'];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Credit', 'Other'];
const INSTALLATION_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled'];
const PAYMENT_STATUSES = ['Paid', 'Partially Paid', 'Pending'];

export default function InstallationChecklistForm({ id: propId, onSaved, onCancel }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const routeParams = useParams();
  
  const checklistId = propId || routeParams.id;
  const isEditMode = Boolean(checklistId);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEditMode);
  const [error, setError] = useState(null);
  const [successToast, setSuccessToast] = useState(null);

  // Form State matching all 27 questions exactly
  const [formData, setFormData] = useState({
    client_name: '',
    client_mobile: '',
    client_location: '',
    google_maps_location: '',
    device_type: DEVICE_OPTIONS[0],
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: '',
    payment_method: 'UPI',
    advance_received: false,
    advance_amount: '',
    pending_payment: false,
    pending_amount: '',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    custom_vehicle_type: '',
    expected_arrival_date: new Date().toISOString().split('T')[0],
    expected_arrival_time: '10:00',
    installation_or_service: 'Installation',
    service_engineer: '',
    service_assistant: '',
    installation_status: 'Pending',
    payment_status: 'Pending',
    remarks: '',
    client_confirmation: 'Confirmed',
  });

  const [checklistNumber, setChecklistNumber] = useState('');

  // Fetch checklist data if editing
  useEffect(() => {
    if (isEditMode && token) {
      setFetching(true);
      fetchInstallationChecklistDetail(token, checklistId)
        .then((data) => {
          setChecklistNumber(data.checklist_number);
          const isCustomVehicle = data.vehicle_type && !VEHICLE_OPTIONS.includes(data.vehicle_type);
          setFormData({
            client_name: data.client_name || '',
            client_mobile: data.client_mobile || '',
            client_location: data.client_location || '',
            google_maps_location: data.google_maps_location || '',
            device_type: data.device_type || DEVICE_OPTIONS[0],
            number_of_devices: data.number_of_devices || 1,
            number_of_vehicles: data.number_of_vehicles || 1,
            confirmed_price: data.confirmed_price !== null ? String(data.confirmed_price) : '',
            payment_method: data.payment_method || 'UPI',
            advance_received: Boolean(data.advance_received),
            advance_amount: data.advance_amount !== null ? String(data.advance_amount) : '',
            pending_payment: Boolean(data.pending_payment),
            pending_amount: data.pending_amount !== null ? String(data.pending_amount) : '',
            installation_duration: data.installation_duration || '',
            vehicle_type: isCustomVehicle ? 'Other' : (data.vehicle_type || 'Truck'),
            custom_vehicle_type: isCustomVehicle ? data.vehicle_type : '',
            expected_arrival_date: data.expected_arrival_date || '',
            expected_arrival_time: data.expected_arrival_time || '',
            installation_or_service: data.installation_or_service || 'Installation',
            service_engineer: data.service_engineer || '',
            service_assistant: data.service_assistant || '',
            installation_status: data.installation_status || 'Pending',
            payment_status: data.payment_status || 'Pending',
            remarks: data.remarks || '',
            client_confirmation: data.client_confirmation || 'Confirmed',
          });
        })
        .catch((err) => {
          console.error('Error fetching checklist for edit:', err);
          setError(err.message || 'Failed to load checklist details');
        })
        .finally(() => setFetching(false));
    }
  }, [isEditMode, checklistId, token]);

  const handleChange = (field, val) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: val };

      // Auto clear conditional section data if toggled to false
      if (field === 'advance_received' && !val) {
        next.advance_amount = '';
      }
      if (field === 'pending_payment' && !val) {
        next.pending_amount = '';
      }

      // Automatic payment status logic recalculation when prices change
      if (['confirmed_price', 'advance_received', 'advance_amount', 'pending_payment', 'pending_amount'].includes(field)) {
        const confPrice = Number(next.confirmed_price) || 0;
        const advAmt = next.advance_received ? (Number(next.advance_amount) || 0) : 0;
        const pendAmt = next.pending_payment ? (Number(next.pending_amount) || 0) : 0;

        if (confPrice > 0 && advAmt + pendAmt >= confPrice && pendAmt === 0) {
          next.payment_status = 'Paid';
        } else if (advAmt > 0 && advAmt < confPrice) {
          next.payment_status = 'Partially Paid';
        } else if (advAmt === 0 && pendAmt > 0) {
          next.payment_status = 'Pending';
        }
      }

      return next;
    });
  };

  const validateForm = () => {
    if (!formData.client_name.trim()) return 'Client Name is required';
    if (!formData.client_mobile.trim()) return 'Client Mobile Number is required';
    
    // Indian Mobile Number validation (10 digits starting 6-9)
    const cleanMobile = formData.client_mobile.replace(/\s+/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return 'Please enter a valid 10-digit Indian Mobile Number (e.g., 9876543210)';
    }

    if (!formData.client_location.trim()) return 'Client Location is required';

    if (Number(formData.number_of_devices) <= 0) return 'Number of Devices must be greater than 0';
    if (Number(formData.number_of_vehicles) <= 0) return 'Number of Vehicles must be greater than 0';

    const confPrice = Number(formData.confirmed_price);
    if (isNaN(confPrice) || confPrice < 0) return 'Please enter a valid Confirmed Price (>= 0)';

    if (formData.advance_received) {
      const advAmt = Number(formData.advance_amount);
      if (isNaN(advAmt) || advAmt < 0) return 'Please enter a valid Advance Amount Received (>= 0)';
    }

    if (formData.pending_payment) {
      const pendAmt = Number(formData.pending_amount);
      if (isNaN(pendAmt) || pendAmt < 0) return 'Please enter a valid Pending Payment Amount (>= 0)';
    }

    const advAmt = formData.advance_received ? (Number(formData.advance_amount) || 0) : 0;
    const pendAmt = formData.pending_payment ? (Number(formData.pending_amount) || 0) : 0;

    if (advAmt + pendAmt > confPrice) {
      return `Advance Amount (₹${advAmt}) + Pending Amount (₹${pendAmt}) cannot exceed Confirmed Price (₹${confPrice})`;
    }

    if (!formData.installation_duration.trim()) return 'Installation Duration is required';
    if (formData.vehicle_type === 'Other' && !formData.custom_vehicle_type.trim()) {
      return 'Custom vehicle type is required when "Other" vehicle type is selected';
    }

    if (!formData.expected_arrival_date) return 'Expected Date of Arrival is required';
    if (!formData.expected_arrival_time) return 'Expected Time of Arrival is required';

    if (!formData.service_engineer.trim()) return 'Team Member 1 – Service Engineer is required';
    if (!formData.service_assistant.trim()) return 'Team Member 2 – Service Assistant is required';

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        client_name: formData.client_name.trim(),
        client_mobile: formData.client_mobile.trim(),
        client_location: formData.client_location.trim(),
        google_maps_location: formData.google_maps_location.trim() || null,
        device_type: formData.device_type,
        number_of_devices: Number(formData.number_of_devices),
        number_of_vehicles: Number(formData.number_of_vehicles),
        extra_devices: false,
        extra_device_type: null,
        extra_device_count: null,
        confirmed_price: Number(formData.confirmed_price) || 0,
        payment_method: formData.payment_method,
        advance_received: formData.advance_received,
        advance_amount: formData.advance_received ? (Number(formData.advance_amount) || 0) : 0,
        pending_payment: formData.pending_payment,
        pending_amount: formData.pending_payment ? (Number(formData.pending_amount) || 0) : 0,
        installation_duration: formData.installation_duration.trim(),
        vehicle_type: formData.vehicle_type === 'Other' ? formData.custom_vehicle_type.trim() : formData.vehicle_type,
        expected_arrival_date: formData.expected_arrival_date,
        expected_arrival_time: formData.expected_arrival_time,
        installation_or_service: formData.installation_or_service,
        service_engineer: formData.service_engineer.trim(),
        service_assistant: formData.service_assistant.trim(),
        installation_status: formData.installation_status,
        payment_status: formData.payment_status,
        remarks: formData.remarks.trim() || null,
        client_confirmation: formData.client_confirmation,
      };

      let result;
      if (isEditMode) {
        result = await updateInstallationChecklist(token, checklistId, payload);
        setSuccessToast('Installation Checklist updated successfully.');
      } else {
        result = await createInstallationChecklist(token, payload);
        setSuccessToast('Installation Checklist created successfully.');
      }

      setTimeout(() => {
        if (onSaved) {
          onSaved(result.id);
        } else {
          navigate(`/admin/installation-checklists/${result.id}`);
        }
      }, 1000);
    } catch (err) {
      console.error('Save checklist error:', err);
      setError(err.message || 'Failed to save installation checklist');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (onCancel) onCancel();
    else navigate('/admin/installation-checklists');
  };

  const confPriceNum = Number(formData.confirmed_price) || 0;
  const advAmtNum = formData.advance_received ? (Number(formData.advance_amount) || 0) : 0;
  const pendAmtNum = formData.pending_payment ? (Number(formData.pending_amount) || 0) : 0;

  if (fetching) {
    return (
      <div className="bg-white p-12 rounded-2xl border border-gray-100 shadow-sm text-center">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-gray-500">Fetching installation checklist details...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-5 py-3.5 rounded-xl shadow-xl flex items-center gap-2 text-sm font-semibold animate-bounce">
          <CheckCircle2 size={20} />
          <span>{successToast}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-navy transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back to Installation Checklists</span>
          </button>
          <h2 className="text-xl font-bold text-navy">
            {isEditMode ? `Edit Installation Checklist (${checklistNumber})` : 'Create Installation Checklist'}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Fill in the 11 sections matching the official Installation Initiation Checklist.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            <Save size={16} />
            <span>{loading ? 'Saving Checklist...' : isEditMode ? 'Update Checklist' : 'Save Checklist'}</span>
          </button>
        </div>
      </div>

      {/* SECTION 1 — FORM INTRODUCTION */}
      <div className="bg-gradient-to-r from-navy to-blue-900 text-white p-6 rounded-2xl shadow-sm space-y-2">
        <h3 className="text-lg font-bold tracking-wide uppercase">EAGLE EYE SAFDRIVE</h3>
        <p className="text-xs text-blue-200">
          INSTALLATION INITIATION CHECKLIST — Please fill all required fields carefully.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs">
          <AlertTriangle size={18} className="shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 2 — 1. CLIENT DETAILS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <User className="text-blue-600" size={18} />
            1. CLIENT DETAILS
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Client Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.client_name}
                onChange={(e) => handleChange('client_name', e.target.value)}
                placeholder="e.g. Acme Transports Ltd."
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Client Mobile Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={formData.client_mobile}
                onChange={(e) => handleChange('client_mobile', e.target.value)}
                placeholder="10-digit Indian Mobile (e.g. 9876543210)"
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Client Location <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  required
                  value={formData.client_location}
                  onChange={(e) => handleChange('client_location', e.target.value)}
                  placeholder="e.g. Chennai Yard / Salem Depot"
                  className="w-full text-xs pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Google Maps Location (URL)
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="url"
                  value={formData.google_maps_location}
                  onChange={(e) => handleChange('google_maps_location', e.target.value)}
                  placeholder="https://maps.google.com/?q=..."
                  className="w-full text-xs pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3 — 2. DEVICE DETAILS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <HardDrive className="text-blue-600" size={18} />
            2. DEVICE DETAILS
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Type of Device <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.device_type}
                onChange={(e) => handleChange('device_type', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                {DEVICE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Number of Devices <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={formData.number_of_devices}
                onChange={(e) => handleChange('number_of_devices', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Number of Vehicles <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={formData.number_of_vehicles}
                onChange={(e) => handleChange('number_of_vehicles', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-semibold"
              />
            </div>
          </div>
        </div>

        {/* SECTION 5 — 3. PRICING & PAYMENT */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <CreditCard className="text-blue-600" size={18} />
            3. PRICING & PAYMENT
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Confirmed Price with Client (₹) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
                <input
                  type="number"
                  min="0"
                  required
                  value={formData.confirmed_price}
                  onChange={(e) => handleChange('confirmed_price', e.target.value)}
                  placeholder="50000"
                  className="w-full text-xs pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Payment Method <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.payment_method}
                onChange={(e) => handleChange('payment_method', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ADVANCE PAYMENT DETAILS & PENDING PAYMENT DETAILS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {/* Advance Received */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">
                  Advance Received? <span className="text-rose-500">*</span>
                </span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="advance_received"
                      checked={formData.advance_received === true}
                      onChange={() => handleChange('advance_received', true)}
                    />
                    <span>Yes</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="advance_received"
                      checked={formData.advance_received === false}
                      onChange={() => handleChange('advance_received', false)}
                    />
                    <span>No</span>
                  </label>
                </div>
              </div>

              {/* SECTION 6 — ADVANCE PAYMENT DETAILS (CONDITIONAL) */}
              {formData.advance_received && (
                <div className="pt-2 border-t border-gray-200/60">
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                    Advance Amount Received (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.advance_amount}
                    onChange={(e) => handleChange('advance_amount', e.target.value)}
                    placeholder="20000"
                    className="w-full text-xs p-2 border border-gray-200 rounded-lg bg-white font-mono font-bold"
                  />
                </div>
              )}
            </div>

            {/* Pending Payment */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">
                  Pending Payment? <span className="text-rose-500">*</span>
                </span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="pending_payment"
                      checked={formData.pending_payment === true}
                      onChange={() => handleChange('pending_payment', true)}
                    />
                    <span>Yes</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="pending_payment"
                      checked={formData.pending_payment === false}
                      onChange={() => handleChange('pending_payment', false)}
                    />
                    <span>No</span>
                  </label>
                </div>
              </div>

              {/* SECTION 8 — PENDING PAYMENT AMOUNT (CONDITIONAL) */}
              {formData.pending_payment && (
                <div className="pt-2 border-t border-gray-200/60">
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                    Pending Payment Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.pending_amount}
                    onChange={(e) => handleChange('pending_amount', e.target.value)}
                    placeholder="30000"
                    className="w-full text-xs p-2 border border-gray-200 rounded-lg bg-white font-mono font-bold"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Payment Summary Bar */}
          <div className="p-4 bg-gradient-to-r from-blue-900 to-navy text-white rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div>
              <span className="text-[11px] text-white/70 block">Payment Summary & Auto Status</span>
              <span className="text-sm font-bold">
                Confirmed: ₹{confPriceNum.toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex items-center gap-6 text-xs font-medium">
              <div>
                <span className="text-white/60 block text-[10px]">Advance</span>
                <span className="text-emerald-300 font-bold">₹{advAmtNum.toLocaleString('en-IN')}</span>
              </div>
              <div>
                <span className="text-white/60 block text-[10px]">Pending</span>
                <span className="text-rose-300 font-bold">₹{pendAmtNum.toLocaleString('en-IN')}</span>
              </div>
              <div>
                <span className="text-white/60 block text-[10px]">Calculated Status</span>
                <span className="bg-white/20 text-white px-2.5 py-0.5 rounded text-[11px] font-bold">
                  {formData.payment_status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 9 — 4. INSTALLATION DETAILS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <Calendar className="text-blue-600" size={18} />
            4. INSTALLATION DETAILS
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Installation Duration <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.installation_duration}
                onChange={(e) => handleChange('installation_duration', e.target.value)}
                placeholder="e.g. 2 Hours / 1 Day / 2 Days"
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Vehicle Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.vehicle_type}
                onChange={(e) => handleChange('vehicle_type', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              >
                {VEHICLE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {formData.vehicle_type === 'Other' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Custom Vehicle Type <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.custom_vehicle_type}
                  onChange={(e) => handleChange('custom_vehicle_type', e.target.value)}
                  placeholder="e.g. Crane / Tractor / Ambulance"
                  className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Installation or Service <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="installation_or_service"
                    checked={formData.installation_or_service === 'Installation'}
                    onChange={() => handleChange('installation_or_service', 'Installation')}
                  />
                  <span>Installation</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="installation_or_service"
                    checked={formData.installation_or_service === 'Service'}
                    onChange={() => handleChange('installation_or_service', 'Service')}
                  />
                  <span>Service</span>
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Expected Date of Arrival at Client Place <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={formData.expected_arrival_date}
                onChange={(e) => handleChange('expected_arrival_date', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Expected Time of Arrival at Client Place <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                required
                value={formData.expected_arrival_time}
                onChange={(e) => handleChange('expected_arrival_time', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* SECTION 10 — 5. INSTALLATION TEAM */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <Users className="text-blue-600" size={18} />
            5. INSTALLATION TEAM
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Team Member 1 – Service Engineer <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.service_engineer}
                onChange={(e) => handleChange('service_engineer', e.target.value)}
                placeholder="Name of Service Engineer"
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Team Member 2 – Service Assistant <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.service_assistant}
                onChange={(e) => handleChange('service_assistant', e.target.value)}
                placeholder="Name of Service Assistant"
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* SECTION 11 — 6. FINAL CONFIRMATION */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2 pb-3 border-b border-gray-100">
            <CheckSquare className="text-blue-600" size={18} />
            6. FINAL CONFIRMATION
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Installation Status <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.installation_status}
                onChange={(e) => handleChange('installation_status', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-semibold"
              >
                {INSTALLATION_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Payment Status <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.payment_status}
                onChange={(e) => handleChange('payment_status', e.target.value)}
                className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 font-semibold"
              >
                {PAYMENT_STATUSES.map((pst) => (
                  <option key={pst} value={pst}>
                    {pst}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Client Confirmation <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="client_confirmation"
                    checked={formData.client_confirmation === 'Confirmed'}
                    onChange={() => handleChange('client_confirmation', 'Confirmed')}
                  />
                  <span>Confirmed</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="client_confirmation"
                    checked={formData.client_confirmation === 'Not Confirmed'}
                    onChange={() => handleChange('client_confirmation', 'Not Confirmed')}
                  />
                  <span>Not Confirmed</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Remarks</label>
            <textarea
              rows={3}
              value={formData.remarks}
              onChange={(e) => handleChange('remarks', e.target.value)}
              placeholder="Enter any additional notes, location instructions, accessories details, or technician comments..."
              className="w-full text-xs p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Submit Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="px-5 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-6 py-2.5 rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
          >
            <Save size={16} />
            <span>{loading ? 'Saving Checklist...' : isEditMode ? 'Update Installation Checklist' : 'Create Installation Checklist'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
