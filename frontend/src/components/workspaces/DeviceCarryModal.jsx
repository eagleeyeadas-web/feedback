import { useState, useEffect } from 'react';
import { Package, Truck, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { submitDeviceCarryRecord } from '../../lib/api';

export default function DeviceCarryModal({ checklist, token, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generalRemarks, setGeneralRemarks] = useState('');

  // Extract device types issued or requested
  const initialItems = [];

  // Main requested device
  if (checklist?.device_type) {
    initialItems.push({
      device_type: checklist.device_type,
      quantity_issued: checklist.number_of_devices || 1,
      quantity_carried: '', // Must be manually recorded, not prefilled
      discrepancy_reason: '',
    });
  }

  // Extra requested devices
  if (checklist?.extra_devices && checklist?.extra_device_type) {
    initialItems.push({
      device_type: checklist.extra_device_type,
      quantity_issued: checklist.extra_device_count || 1,
      quantity_carried: '', // Must be manually recorded
      discrepancy_reason: '',
    });
  }

  const [items, setItems] = useState(initialItems);

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const validateForm = () => {
    for (const item of items) {
      if (item.quantity_carried === '' || item.quantity_carried === null) {
        return `Please enter physical quantity carried for ${item.device_type}`;
      }

      const carried = parseInt(item.quantity_carried, 10);
      const issued = parseInt(item.quantity_issued, 10);

      if (isNaN(carried) || carried < 0) {
        return `Quantity carried for ${item.device_type} must be 0 or greater`;
      }

      if (carried > issued) {
        return `Actual quantity carried (${carried}) cannot exceed quantity issued (${issued}) for ${item.device_type} without authorized additional issue`;
      }

      if (carried !== issued && (!item.discrepancy_reason || !item.discrepancy_reason.trim())) {
        return `Explanation remark is required for ${item.device_type} because actual carried (${carried}) differs from issued (${issued})`;
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
          quantity_issued: parseInt(i.quantity_issued, 10),
          quantity_carried: parseInt(i.quantity_carried, 10),
          discrepancy_reason: i.discrepancy_reason,
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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-md">
              Mandatory Pre-Installation
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
              <span className="font-semibold text-gray-800">{checklist.expected_arrival_date} ({checklist.expected_arrival_time})</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">Service Team</span>
              <span className="font-semibold text-gray-800">{checklist.service_engineer || 'Assigned Eng'}</span>
            </div>
          </div>
        </div>

        {/* Info Alert */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            <Package className="w-4 h-4 text-blue-600" /> Physical Verification Requirement
          </p>
          <p className="text-[11px] text-blue-700">
            Please count and enter the actual physical devices you are carrying to the client site. Quantities are not auto-copied.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Carry Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            {items.map((item, idx) => {
              const issued = parseInt(item.quantity_issued, 10) || 0;
              const carried = item.quantity_carried !== '' ? parseInt(item.quantity_carried, 10) : null;
              const diff = carried !== null ? carried - issued : null;
              const isDiff = diff !== null && diff !== 0;

              return (
                <div key={idx} className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-2">
                    <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-purple-600" /> {item.device_type}
                    </span>
                    <span className="text-xs text-gray-500 font-medium">
                      Store Issued: <strong className="text-blue-700 font-mono">{issued} units</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">
                        Actual Physical Qty Carried <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={issued}
                        placeholder="Enter verified carried count..."
                        value={item.quantity_carried}
                        onChange={(e) => handleItemChange(idx, 'quantity_carried', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none font-bold text-gray-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Discrepancy / Variance</label>
                      <div
                        className={`px-3 py-2 rounded-lg border text-xs font-bold font-mono ${
                          diff === 0
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : isDiff
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-gray-50 border-gray-200 text-gray-400'
                        }`}
                      >
                        {diff === null
                          ? 'Awaiting input'
                          : diff === 0
                          ? '0 (Exact match)'
                          : `${diff} unit(s) shortfall`}
                      </div>
                    </div>
                  </div>

                  {isDiff && (
                    <div className="animate-in fade-in duration-200">
                      <label className="block text-xs font-semibold text-amber-900 mb-1">
                        Discrepancy Reason / Remark <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Explain why carried quantity differs from issued..."
                        value={item.discrepancy_reason}
                        onChange={(e) => handleItemChange(idx, 'discrepancy_reason', e.target.value)}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none bg-amber-50/50"
                        required
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Overall Technician Remarks (Optional)</label>
            <textarea
              rows="2"
              value={generalRemarks}
              onChange={(e) => setGeneralRemarks(e.target.value)}
              placeholder="Any additional notes regarding physical device dispatch..."
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
