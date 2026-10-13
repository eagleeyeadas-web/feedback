import { useState, useEffect, useRef } from 'react';
import { calculateBomRequirements } from '../../lib/api';
import { Layers, AlertTriangle, CheckCircle2, Calculator, Info, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export default function BomRequirementSummary({
  deviceType,
  numberOfDevices,
  deviceConfigurations,
  token,
  jobType = 'Installation',
  onCalculated,
}) {
  const [calculation, setCalculation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const lastRequestRef = useRef('');

  // Service jobs do not perform BOM calculations
  const isServiceJob = jobType === 'Service';

  // Normalize inputs: either deviceConfigurations array or legacy deviceType + numberOfDevices
  const configs = Array.isArray(deviceConfigurations) && deviceConfigurations.length > 0
    ? deviceConfigurations
    : deviceType
      ? [{ device_type: deviceType, number_of_devices: numberOfDevices, number_of_vehicles: numberOfDevices }]
      : [];

  const hasEmptyOrInvalid = configs.some((c) => {
    const qty = parseInt(c.number_of_devices, 10);
    return isNaN(qty) || qty <= 0;
  });

  const totalDevicesCount = configs.reduce((sum, c) => sum + (parseInt(c.number_of_devices, 10) || 0), 0);

  useEffect(() => {
    if (isServiceJob) {
      setCalculation(null);
      if (onCalculated) onCalculated(null);
      return;
    }

    if (configs.length === 0) {
      setCalculation(null);
      if (onCalculated) onCalculated(null);
      return;
    }

    if (hasEmptyOrInvalid) {
      setCalculation({
        configured: false,
        warning: 'All device quantities must be positive whole numbers greater than 0 (no zero, negative, or blank quantities allowed).',
        items: [],
      });
      if (onCalculated) onCalculated(null);
      return;
    }

    const payloadConfigs = configs.map((c) => ({
      device_type: c.device_type,
      number_of_devices: parseInt(c.number_of_devices, 10) || 1,
      number_of_vehicles: parseInt(c.number_of_vehicles, 10) || parseInt(c.number_of_devices, 10) || 1,
    }));

    const requestId = JSON.stringify(payloadConfigs) + `_${jobType}`;
    lastRequestRef.current = requestId;
    setLoading(true);
    setError(null);

    calculateBomRequirements(token, {
      device_configurations: payloadConfigs,
      job_type: jobType,
    })
      .then((data) => {
        // Prevent race conditions
        if (lastRequestRef.current === requestId) {
          setCalculation(data);
          if (onCalculated) {
            onCalculated(data.configured ? data : null);
          }
        }
      })
      .catch((err) => {
        if (lastRequestRef.current === requestId) {
          console.error('BOM calculation error:', err);
          setError(err.message || 'Failed to calculate material requirements');
          if (onCalculated) onCalculated(null);
        }
      })
      .finally(() => {
        if (lastRequestRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [JSON.stringify(configs), token, jobType, isServiceJob]);

  if (isServiceJob || configs.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-5 shadow-xs transition-all space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
              Automatic Bill of Materials (BOM) Requirements
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />}
            </h4>
            <p className="text-[11px] text-gray-500">
              Combined material requirements for <strong className="text-gray-800">{totalDevicesCount} total device(s)</strong> across {configs.length} device configuration(s)
            </p>
          </div>
        </div>

        {calculation?.configured && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
              {configs.length > 1 ? `${configs.length} Device Types Combined` : `Active BOM v${calculation.bom_version || 1}`}
            </span>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Auto-Calculated
            </span>
          </div>
        )}
      </div>

      {/* Invalid Quantity Warning */}
      {hasEmptyOrInvalid && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Invalid Device Quantities</p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              Please enter positive whole numbers (1 or more) for all selected device configurations. Zero, negative, or blank quantities cannot be calculated.
            </p>
          </div>
        </div>
      )}

      {/* Unconfigured BOM Warning (Requirement 9: show warning and do not display incomplete calculation as final) */}
      {!hasEmptyOrInvalid && calculation && !calculation.configured && (
        <div className="p-4 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl text-xs space-y-2 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Incomplete BOM Configuration - Calculation Not Final</span>
          </div>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            {calculation.warning || 'One or more selected device types do not have an active configured Bill of Materials (BOM). Material requirements cannot be assumed as zero or displayed as final until all selected device types have configured BOMs.'}
          </p>
          {Array.isArray(calculation.unconfigured_device_types) && calculation.unconfigured_device_types.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] font-semibold text-amber-900">Unconfigured device types:</span>
              {calculation.unconfigured_device_types.map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 font-bold text-[10px]">
                  {t}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-amber-700 font-medium pt-1">
            Tip: An authorized Store Manager can configure missing BOMs in the Store Manager Workspace under the BOM Management tab.
          </p>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Calculated Materials Combined Table */}
      {!hasEmptyOrInvalid && calculation?.configured && Array.isArray(calculation.items) && calculation.items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-700">
              Total Combined Materials Required ({calculation.items.length} distinct items):
            </span>
            {configs.length > 1 && (
              <button
                type="button"
                onClick={() => setShowBreakdown((prev) => !prev)}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                {showBreakdown ? (
                  <>
                    Hide Device Breakdown <ChevronUp className="w-3 h-3" />
                  </>
                ) : (
                  <>
                    View Breakdown by Device Type <ChevronDown className="w-3 h-3" />
                  </>
                )}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/90 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-12 text-center">#</th>
                  <th className="py-2.5 px-4">Material Required</th>
                  {configs.length === 1 && (
                    <th className="py-2.5 px-4 text-center">Min Qty / Device</th>
                  )}
                  <th className="py-2.5 px-4 text-center">Total Devices</th>
                  <th className="py-2.5 px-4 text-center">Total Required Qty</th>
                  <th className="py-2.5 px-4 text-center">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calculation.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-indigo-50/30 transition-colors">
                    <td className="py-2.5 px-3 text-center text-[11px] font-mono text-gray-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-gray-900">
                      <div>{item.material_name}</div>
                      {showBreakdown && Array.isArray(item.breakdown) && item.breakdown.length > 1 && (
                        <div className="text-[10px] text-gray-500 font-normal mt-1 space-y-0.5 pl-2 border-l-2 border-indigo-200">
                          {item.breakdown.map((b, bIdx) => (
                            <div key={bIdx}>
                              {b.device_type}: {b.quantity_per_device} {item.unit} × {b.number_of_devices} dev = <strong className="text-gray-700">{b.subtotal} {item.unit}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    {configs.length === 1 && (
                      <td className="py-2.5 px-4 text-center font-mono text-gray-600">
                        {item.quantity_per_device || (item.breakdown?.[0]?.quantity_per_device ?? '—')}
                      </td>
                    )}
                    <td className="py-2.5 px-4 text-center font-mono text-gray-600">
                      {totalDevicesCount}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="inline-block px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-900 font-bold font-mono text-xs border border-indigo-200">
                        {item.total_quantity}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center font-medium text-gray-600">
                      {item.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Formula & Policy Note */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-gray-500 bg-white p-3 rounded-xl border border-gray-100 gap-2">
            <span className="flex items-center gap-1.5 text-indigo-950 font-medium">
              <Calculator className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              Calculated using each device type's configured BOM. Shared materials combined for overall installation.
            </span>
            <span className="flex items-center gap-1 text-gray-400 shrink-0">
              <Info className="w-3.5 h-3.5 shrink-0" />
              Stock is not deducted when a checklist is created; issuance occurs via Store Manager.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
