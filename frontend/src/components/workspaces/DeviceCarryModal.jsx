import { useState } from 'react';
import { Package, Truck, AlertTriangle, CheckCircle2, X, Plus, Trash2 } from 'lucide-react';
import { submitDeviceCarryRecord } from '../../lib/api';

const SUPPORTED_DEVICE_TYPES = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

export default function DeviceCarryModal({ checklist, token, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generalRemarks, setGeneralRemarks] = useState('');

  // Start with one empty row for dynamic device selection
  const [items, setItems] = useState([
    {
      device_type: '',
      quantity_carried: '',
    },
  ]);

  const handleAddRow = () => {
    if (items.length >= SUPPORTED_DEVICE_TYPES.length) {
      return;
    }
    // Find first unselected device type
    const selectedTypes = new Set(items.map((i) => i.device_type).filter(Boolean));
    const nextAvailable = SUPPORTED_DEVICE_TYPES.find((t) => !selectedTypes.has(t)) || '';

    setItems((prev) => [
      ...prev,
      {
        device_type: nextAvailable,
        quantity_carried: '',
      },
    ]);
  };

  const handleRemoveRow = (index) => {
    if (items.length === 1) {
      // Reset single row
      setItems([{ device_type: '', quantity_carried: '' }]);
    } else {
      setItems((prev) => prev.filter((_, idx) => idx !== index));
    }
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const validateForm = () => {
    if (!items || items.length === 0) {
      return 'Please add at least one device type and quantity to carry.';
    }

    const selectedTypes = new Set();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.device_type || !item.device_type.trim()) {
        return `Please select a Device Type for row #${i + 1}`;
      }

      if (selectedTypes.has(item.device_type)) {
        return `Duplicate device type selected: "${item.device_type}". Please combine quantities into a single row.`;
      }
      selectedTypes.add(item.device_type);

      if (item.quantity_carried === '' || item.quantity_carried === null) {
        return `Please enter Quantity to Carry for "${item.device_type}"`;
      }

      const num = Number(item.quantity_carried);
      if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
        return `Quantity to Carry for "${item.device_type}" must be a positive whole number greater than 0`;
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationErr = validateForm();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        items: items.map((i) => ({
          device_type: i.device_type,
          quantity_carried: parseInt(i.quantity_carried, 10),
        })),
        remarks: generalRemarks,
      };

      const result = await submitDeviceCarryRecord(token, checklist.id, payload);
      onSuccess(result);
    } catch (err) {
      console.error('Error submitting carry record:', err);
      setError(err.message || 'Failed to submit pre-installation carry record');
    } finally {
      setLoading(false);
    }
  };

  // Set of selected types to disable in dropdown
  const selectedTypeSet = new Set(items.map((i) => i.device_type).filter(Boolean));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-purple-100 text-purple-800 rounded-md">
              Pre-Installation Device Carry Form
            </span>
            <h3 className="text-lg font-extrabold text-gray-900 mt-1 flex items-center gap-2">
              <Truck className="w-5 h-5 text-purple-600" /> Record Physical Devices Carried to Site
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Reference Information */}
        <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200/70 text-xs space-y-2">
          <div className="font-semibold text-gray-700 uppercase tracking-wider text-[11px] border-b border-gray-200/60 pb-1">
            Job Reference Information
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-400 block text-[10px]">Checklist No.</span>
              <span className="font-mono font-bold text-purple-700">{checklist.checklist_number}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">Client Name</span>
              <span className="font-bold text-gray-900">{checklist.client_name}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">Installation Schedule</span>
              <span className="font-semibold text-gray-800">
                {checklist.expected_arrival_date} ({checklist.expected_arrival_time})
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">Service Team</span>
              <span className="font-semibold text-gray-800">{checklist.service_engineer || 'Assigned Eng'}</span>
            </div>
          </div>

          {/* Original Sales Request Info Badge */}
          <div className="pt-2 border-t border-gray-200/50 flex flex-wrap items-center justify-between text-[11px] text-gray-600">
            <span>Original Sales Device Request:</span>
            <span className="font-bold text-navy">
              {checklist.device_type} ({checklist.number_of_devices} units)
              {checklist.extra_devices && checklist.extra_device_type
                ? ` + ${checklist.extra_device_count} ${checklist.extra_device_type}`
                : ''}
            </span>
          </div>
        </div>

        {/* Info Banner */}
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            <Package className="w-4 h-4 text-purple-600" /> Technician Device Declaration
          </p>
          <p className="text-[11px] text-purple-800">
            Select the device types and actual quantities you are carrying to the site. Click <strong>Add Device</strong> to add extra device rows.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Dynamic Device Selection Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white">
            <div className="bg-gray-50 p-3 border-b border-gray-200 grid grid-cols-12 gap-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              <div className="col-span-6 sm:col-span-7">Device Type</div>
              <div className="col-span-4 sm:col-span-4 text-right sm:text-left">Quantity to Carry</div>
              <div className="col-span-2 sm:col-span-1 text-center">Action</div>
            </div>

            <div className="divide-y divide-gray-100 p-2 space-y-2">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-3 items-center py-1.5 px-2 text-xs">
                  {/* Device Type Select Dropdown */}
                  <div className="col-span-6 sm:col-span-7">
                    <select
                      value={item.device_type}
                      onChange={(e) => handleItemChange(index, 'device_type', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                      required
                    >
                      <option value="">-- Select Device Type --</option>
                      {SUPPORTED_DEVICE_TYPES.map((typeOption) => {
                        const isSelectedElsewhere =
                          selectedTypeSet.has(typeOption) && item.device_type !== typeOption;
                        return (
                          <option key={typeOption} value={typeOption} disabled={isSelectedElsewhere}>
                            {typeOption} {isSelectedElsewhere ? '(Already selected)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Quantity to Carry Input */}
                  <div className="col-span-4 sm:col-span-4">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Qty (e.g. 1, 2, 4)"
                      value={item.quantity_carried}
                      onChange={(e) => handleItemChange(index, 'quantity_carried', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 focus:ring-2 focus:ring-purple-500 outline-none"
                      required
                    />
                  </div>

                  {/* Remove Row Button */}
                  <div className="col-span-2 sm:col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(index)}
                      title="Remove device row"
                      className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Device Row Action */}
            <div className="p-3 bg-gray-50/70 border-t border-gray-200 flex items-center justify-between">
              <button
                type="button"
                onClick={handleAddRow}
                disabled={items.length >= SUPPORTED_DEVICE_TYPES.length}
                className="px-3 py-1.5 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>Add Device</span>
              </button>

              <span className="text-[11px] text-gray-500">
                {items.length} device type(s) selected
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Overall Technician Remarks (Optional)
            </label>
            <textarea
              rows="2"
              value={generalRemarks}
              onChange={(e) => setGeneralRemarks(e.target.value)}
              placeholder="Any additional notes regarding site dispatch..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? 'Submitting Carry Record...' : 'Submit Carry Record & Ready to Start'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
